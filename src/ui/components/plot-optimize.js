/**
 * 剧情优化助手面板组件
 * @module ui/components/plot-optimize
 */

import APIAdapter from "@api/adapter";
import { getGlobalConfig, getGlobalSettings, updateGlobalSettings } from "@config/config-manager";
import { detectExtensionPath } from "@core/constants";
import Logger from "@core/logger";
import { getJailbreakPrefix } from "@memory/jailbreak";
import { loadPromptTemplate } from "@utils/prompt-template";
import { filterContentByRole } from "@utils/tag-filter";
import { getWorldBookEntries, getWorldBookList } from "@worldbook/api";

// 进度追踪器引用（将在初始化时设置）
let progressTracker = null;

// 搜索面板引用（用于获取采纳的历史事件）
let searchPanelGetter = null;

/**
 * 设置进度追踪器引用
 * @param {Object} tracker - 进度追踪器实例
 */
export function setPlotPanelProgressTracker(tracker) {
    progressTracker = tracker;
    Logger.info("[剧情优化] 进度追踪器已设置:", !!tracker);
    if (tracker) {
        Logger.info(
            "[剧情优化] tracker.addTask 方法存在:",
            typeof tracker.addTask === "function",
        );
    }
}

/**
 * 设置搜索面板获取函数
 * @param {Function} getter - 获取搜索面板的函数
 */
export function setSearchPanelGetter(getter) {
    searchPanelGetter = getter;
}

// 浮动面板 z-index 管理
let panelZIndex = 1000002;
function bringPanelToFront(panel) {
    if (panel) panel.style.zIndex = ++panelZIndex;
}

// 来源标签映射
const SOURCE_LABELS = {
    // === 通用条件块 ===
    jailbreak: "[条件块] 破限词",
    main: "[条件块] 主提示词 (mainPrompt → <数据注入区>前)",
    user: "[条件块] 核心用户消息 <核心用户消息>",
    // === 记忆/总结世界书专用 ===
    worldbook: "[条件块] 世界书内容 <世界书内容>",
    context: "[条件块] 前文内容 <前文内容>",
    auxiliary: "[条件块] 辅助提示词 (systemPrompt → <数据注入区>后)",
    // === 剧情优化专用 ===
    plot_worldbooks: "[剧情优化] 世界书内容 <世界书内容>",
    plot_panel_worldbooks: "[剧情优化] 面板世界书内容 <面板世界书内容>",
    plot_char_desc: "[剧情优化] 角色描述 <角色设定>",
    plot_context: "[剧情优化] 前文内容 <前文内容>",
    plot_historical: "[剧情优化] 历史事件回忆 <历史事件回忆>",
    plot_user_msg: "[剧情优化] 核心用户消息 <核心用户消息>",
    plot_history: "[剧情优化] 历史对话记录 <历史对话记录>",
    plot_input: "[剧情优化] 面板用户输入 <最新用户消息>",
};

// 默认流程配置缓存
let DEFAULT_FLOW_CONFIG = null;

/**
 * 从配置文件加载流程配置
 * @param {boolean} forceReload - 是否强制重新加载，忽略缓存
 */
async function loadFlowConfigFromFile(forceReload = false) {
    // 如果不是强制重新加载，并且已经加载过配置，直接返回
    if (!forceReload && DEFAULT_FLOW_CONFIG !== null) {
        return DEFAULT_FLOW_CONFIG;
    }

    try {
        const basePath = await detectExtensionPath();
        const configPath = `${basePath}/flow-configs/default.json?_t=${Date.now()}`;
        const response = await fetch(configPath, { cache: "no-store" });

        if (response.ok) {
            const config = await response.json();
            const flowConfig = {};

            // 转换为内部格式
            for (const [key, value] of Object.entries(config.configs)) {
                if (value.sources && Array.isArray(value.sources)) {
                    flowConfig[key] = value.sources;
                }
            }

            // 更新全局默认配置
            DEFAULT_FLOW_CONFIG = flowConfig;
            Logger.debug("[流程配置] 已从配置文件加载默认配置", flowConfig);
            return flowConfig;
        } else {
            Logger.warn("[流程配置] 配置文件不存在或无法访问");
        }
    } catch (error) {
        Logger.warn("[流程配置] 加载配置文件失败:", error);
    }

    // 如果加载失败，使用一个空配置作为fallback
    const fallbackConfig = {};
    DEFAULT_FLOW_CONFIG = fallbackConfig;
    Logger.debug("[流程配置] 使用空配置作为fallback");
    return fallbackConfig;
}

/**
 * 基于流程配置构建 promptParts
 * @param {string} flowType - 流程类型（记忆世界书、总结世界书、索引合并、剧情优化）
 * @param {Object} sourceContents - 各个来源的内容对象，key 为 source，value 为 content
 * @returns {Promise<Array>} - 按照流程配置顺序排列的 promptParts
 */
async function buildPromptPartsByFlowConfig(flowType, sourceContents) {
    const settings = getGlobalSettings();
    const savedOrder = settings.promptPartsOrder || {};
    const defaultConfig = await loadFlowConfigFromFile();

    Logger.debug("[流程配置] savedOrder:", savedOrder);
    Logger.debug("[流程配置] defaultConfig:", defaultConfig);

    const sourceOrder = savedOrder[flowType] || defaultConfig[flowType];

    Logger.debug("[流程配置] flowType:", flowType, "sourceOrder:", sourceOrder);

    if (!sourceOrder || !Array.isArray(sourceOrder)) {
        Logger.warn(`[流程配置] 未找到 "${flowType}" 的流程配置，使用默认顺序`);
        return Object.entries(sourceContents).map(([source, content]) => ({
            label: SOURCE_LABELS[source] || source,
            content: content,
            source: source,
        }));
    }

    const promptParts = [];

    // 按照流程配置的顺序添加来源块
    for (const source of sourceOrder) {
        if (sourceContents.hasOwnProperty(source)) {
            promptParts.push({
                label: SOURCE_LABELS[source] || source,
                content: sourceContents[source],
                source: source,
            });
        }
    }

    // 添加未在流程配置中定义的来源块（保持原顺序）
    for (const [source, content] of Object.entries(sourceContents)) {
        if (!sourceOrder.includes(source)) {
            promptParts.push({
                label: SOURCE_LABELS[source] || source,
                content: content,
                source: source,
            });
        }
    }

    Logger.debug("[流程配置] 构建的 promptParts 数量:", promptParts.length);

    return promptParts;
}

// ============================================================================
// 剧情优化助手面板功能
// ============================================================================

// 剧情优化面板状态
let plotPanelSelectedBooks = new Set();
let plotPanelSelectedEntries = {}; // {bookName: [uid1, uid2, ...]}
let plotPanelCurrentPreview = ""; // 当前预览的内容
let plotPanelIsGenerating = false; // 是否正在生成
let plotPanelCurrentResolve = null; // Promise resolve
let plotPanelCurrentReject = null; // Promise reject
let plotPanelOtherTasksCompleted = false; // 其他任务是否已完成
let plotPanelChatHistory = []; // 对话历史记录
let plotPanelWorldBooksCache = []; // 世界书列表缓存
let plotPanelEntriesCache = {}; // 世界书条目缓存 {bookName: entries[]}
let plotPanelOriginalUserMessage = ""; // 酒馆原始用户消息

// 剧情优化面板拖动状态
let plotPanelIsDragging = false;
let plotPanelDragOffset = { x: 0, y: 0 };

/**
 * 启动剧情优化会话（返回 Promise 等待用户确认）
 * @param {Object} options - 选项
 * @returns {Promise} 返回用户选择结果 { action: "confirm"|"skip", content: string }
 */
export function startPlotOptimizeSession(options = {}) {
    console.log(
        "[记忆管理并发系统] [剧情优化] ===== startPlotOptimizeSession 被调用 =====",
    );
    console.log(
        "[记忆管理并发系统] [剧情优化] progressTracker 状态:",
        !!progressTracker,
    );
    return new Promise((resolve, reject) => {
        plotPanelCurrentResolve = resolve;
        plotPanelCurrentReject = reject;
        plotPanelOtherTasksCompleted = false;

        // 保存酒馆原始用户消息
        plotPanelOriginalUserMessage = options.userMessage || "";

        showPlotOptimizePanel();

        // 如果有上下文信息，显示提示
        if (options.userMessage) {
            updatePlotPanelStatus("正在为您优化剧情...");
        }

        // 自动开始生成
        console.log(
            "[记忆管理并发系统] [剧情优化] 准备调用 generatePlotOptimize",
        );
        generatePlotOptimize("");
    });
}

/**
 * 更新其他任务状态（显示在面板中）
 */
export function updatePlotPanelOtherTasksStatus(
    completed,
    total,
    results = null,
) {
    const statusEl = document.getElementById("mm-plot-other-tasks-status");

    if (!statusEl) {
        // 动态创建状态元素
        const statusContainer = document.querySelector(".mm-plot-panel-status");
        if (statusContainer) {
            const otherStatus = document.createElement("div");
            otherStatus.id = "mm-plot-other-tasks-status";
            otherStatus.className = "mm-plot-other-tasks";
            otherStatus.style.cssText =
                "margin-top: 4px; font-size: 0.85em; color: var(--mm-text-muted);";
            statusContainer.appendChild(otherStatus);
        }
    }

    const el = document.getElementById("mm-plot-other-tasks-status");
    if (!el) return;

    if (completed < total) {
        el.innerHTML = `
        <i class="fa-solid fa-spinner fa-spin"></i>
        其他任务: ${completed}/${total}
      `;
    } else {
        el.innerHTML = `
        <i class="fa-solid fa-check-circle" style="color: var(--mm-success);"></i>
        其他任务已完成
      `;
        plotPanelOtherTasksCompleted = true;

        // 如果已有预览内容，更新状态提示
        if (plotPanelCurrentPreview && !plotPanelIsGenerating) {
            updatePlotPanelStatus("其他任务已完成，等待您确认剧情优化...");
        }
    }
}

/**
 * 显示剧情优化面板
 */
export function showPlotOptimizePanel() {
    const panel = document.getElementById("mm-plot-optimize-panel");
    if (!panel) {
        Logger.warn("[剧情优化] 面板元素不存在");
        return;
    }

    // 重置面板位置，让CSS初始定位生效
    panel.style.left = "";
    panel.style.top = "";
    panel.style.right = "";
    panel.style.bottom = "";
    panel.style.transform = "";

    panel.classList.add("mm-visible");

    // 默认折叠世界书选择区域
    const worldbookSection = panel.querySelector(".mm-plot-worldbook-section");
    if (worldbookSection && !worldbookSection.classList.contains("collapsed")) {
        worldbookSection.classList.add("collapsed");
    }

    // 初始化面板状态
    resetPlotPanelPreview();
    loadPlotPanelWorldBooks();
    updatePlotPanelButtons(false);

    // 设置欢迎消息时间
    const welcomeTime = document.getElementById("mm-plot-welcome-time");
    if (welcomeTime) {
        welcomeTime.textContent = formatPlotChatTime();
    }

    Logger.debug("[剧情优化] 面板已显示");
}

/**
 * 隐藏剧情优化面板
 */
export function hidePlotOptimizePanel() {
    const panel = document.getElementById("mm-plot-optimize-panel");
    if (panel) {
        panel.classList.remove("mm-visible");
    }

    // 清除其他任务状态元素
    const otherTasksEl = document.getElementById("mm-plot-other-tasks-status");
    if (otherTasksEl) {
        otherTasksEl.remove();
    }

    // 重置状态
    plotPanelOtherTasksCompleted = false;
}

/**
 * 关闭剧情优化面板（终止任务并关闭）
 */
export function closePlotOptimizePanel() {
    Logger.log("[剧情优化] 关闭面板");

    // 终止正在进行的剧情优化任务
    if (progressTracker) {
        progressTracker.stopTask("plot_optimize");
    }

    // 重置生成状态
    plotPanelIsGenerating = false;

    // 移除正在输入动画
    removePlotTypingMessage();

    // 如果有 Promise（会话模式），拒绝它
    if (plotPanelCurrentResolve) {
        const resolve = plotPanelCurrentResolve;
        plotPanelCurrentResolve = null;
        plotPanelCurrentReject = null;
        resolve({ action: "cancel", content: null });
    }

    // 清除对话历史
    plotPanelChatHistory = [];

    // 重置按钮状态
    updatePlotPanelButtons(false);
    updatePlotPanelStatus("等待生成...");

    // 隐藏面板
    hidePlotOptimizePanel();
}

/**
 * 检查剧情优化是否启用
 */
export function isPlotOptimizeEnabled() {
    const settings = getGlobalSettings();
    return settings.enablePlotOptimize === true;
}

/**
 * 构建剧情优化的预览信息（用于发送前检查）
 * 使用 buildPromptPartsByFlowConfig 确保与实际发送顺序一致
 */
export async function buildPlotOptimizePreview(
    plotConfig,
    userMessage,
    chatContext,
) {
    // 1. 收集所有来源内容（与 callPlotOptimizeApi 保持一致）

    // 获取破限词
    const jailbreakPrefix = getJailbreakPrefix ? getJailbreakPrefix() : "";

    // 获取提示词模板
    let mainPrompt = "";
    let auxiliaryPrompt = "";
    if (plotConfig.promptFile) {
        try {
            const promptTemplate = await loadPromptTemplate(
                plotConfig.promptFile,
            );
            mainPrompt = promptTemplate?.mainPrompt || "";
            auxiliaryPrompt = promptTemplate?.systemPrompt || "";
        } catch (e) {
            Logger.warn("[剧情优化预览] 加载提示词模板失败:", e);
            mainPrompt = "加载失败";
        }
    } else {
        mainPrompt = "使用默认提示词";
    }

    // 获取全局配置的世界书内容
    let globalWorldbookContent = "";
    const globalSelectedBooks = plotConfig.selectedBooks || [];
    const globalSelectedEntries = plotConfig.selectedEntries || {};
    for (const bookName of globalSelectedBooks) {
        try {
            const entries = await getWorldBookEntries(bookName);
            const selectedUids = globalSelectedEntries[bookName] || [];
            // 如果该世界书有选中的条目，则只使用选中的条目；否则使用所有启用的条目
            const hasSelectedEntries = selectedUids.length > 0;
            for (const entry of entries) {
                if (entry.disable === true) continue; // 跳过禁用的条目
                // 如果有选中条目，只包含选中的条目
                if (hasSelectedEntries && !selectedUids.includes(String(entry.uid))) {
                    continue;
                }
                const entryName =
                    entry.comment || entry.key?.[0] || "未命名";
                const content = entry.content || "";
                if (content.trim()) {
                    globalWorldbookContent += `【${entryName}】\n${content}\n\n`;
                }
            }
        } catch (e) {
            Logger.warn(`[剧情优化预览] 加载全局世界书 "${bookName}" 失败:`, e);
        }
    }
    // 使用标签包裹世界书内容
    if (globalWorldbookContent.trim()) {
        globalWorldbookContent = `<世界书内容>\n${globalWorldbookContent.trim()}\n</世界书内容>`;
    }

    // 注意：面板世界书内容不在预览阶段加载
    // 面板世界书只有在用户打开剧情优化面板后才会选择和加载
    // 因此在预览阶段，面板世界书内容应该为空
    let panelWorldbookContent = "";

    // 获取角色描述
    let characterDescription = "";
    if (plotConfig.includeCharDescription !== false) {
        try {
            if (typeof SillyTavern !== "undefined" && SillyTavern.getContext) {
                const context = SillyTavern.getContext();
                const char = context.characters?.[context.characterId];
                if (char) {
                    let charContent = char.description || "";
                    if (char.personality) {
                        charContent += `\n\n【性格特点】\n${char.personality}`;
                    }
                    if (char.scenario) {
                        charContent += `\n\n【场景设定】\n${char.scenario}`;
                    }
                    // 使用标签包裹角色描述
                    if (charContent.trim()) {
                        characterDescription = `<角色设定>\n${charContent.trim()}\n</角色设定>`;
                    }
                }
            }
        } catch (e) {
            Logger.warn("[剧情优化预览] 获取角色描述失败:", e);
        }
    }

    // [标签过滤调用点3] 剧情优化助手预览 - 获取前文内容
    let contextContent = "";
    const contextRounds = plotConfig.contextRounds ?? 5;
    if (contextRounds > 0 && chatContext && chatContext.length > 0) {
        const globalConfig = getGlobalConfig();
        const tagFilterConfig = globalConfig.contextTagFilter;

        const recentMessages = chatContext.slice(-contextRounds * 2);
        contextContent = recentMessages
            .map((m) => {
                const isUser = m.is_user;
                const role = isUser ? "user" : "assistant";
                let content = m.mes || "";

                // 使用 filterContentByRole 处理标签过滤（支持新旧配置格式）
                content = filterContentByRole(content, tagFilterConfig, isUser);

                return `${role}: ${content}`;
            })
            .join("\n\n");
        // 使用标签包裹前文内容
        if (contextContent.trim()) {
            contextContent = `<前文内容>\n${contextContent.trim()}\n</前文内容>`;
        }
    }

    // 获取历史事件回忆
    const searchPanel = searchPanelGetter ? searchPanelGetter() : null;
    let adoptedHistorical = searchPanel
        ? searchPanel.getAdoptedHistoricalMemories()
        : "";
    // 使用标签包裹历史事件回忆（如果还没有标签）
    if (
        adoptedHistorical &&
        adoptedHistorical.trim() &&
        !adoptedHistorical.includes("<历史事件回忆>")
    ) {
        adoptedHistorical = `<历史事件回忆>\n${adoptedHistorical.trim()}\n</历史事件回忆>`;
    }

    // 获取核心用户消息
    const wrappedUserMessage = userMessage
        ? `<核心用户消息>\n${userMessage}\n</核心用户消息>`
        : "";

    // 获取历史对话记录
    let historyContent =
        plotPanelChatHistory && plotPanelChatHistory.length > 0
            ? plotPanelChatHistory
                  .map(
                      (msg) =>
                          `${msg.role === "user" ? "用户" : "AI"}: ${
                              msg.content
                          }`,
                  )
                  .join("\n\n")
            : "";
    // 使用标签包裹历史对话记录
    if (historyContent.trim()) {
        historyContent = `<历史对话记录>\n${historyContent.trim()}\n</历史对话记录>`;
    }

    // 获取面板输入（使用 <最新用户消息> 标签）
    const plotInputEl =
        /** @type {HTMLInputElement|HTMLTextAreaElement|null} */ (
            document.getElementById("mm-plot-user-input")
        );
    let plotInput = plotInputEl ? plotInputEl.value || "" : "";
    if (plotInput.trim()) {
        plotInput = `<最新用户消息>\n${plotInput.trim()}\n</最新用户消息>`;
    }

    // 2. 构建来源内容对象
    const sourceContents = {
        jailbreak: jailbreakPrefix || "",
        main: mainPrompt || "",
        plot_worldbooks: globalWorldbookContent || "",
        plot_panel_worldbooks: panelWorldbookContent || "",
        plot_char_desc: characterDescription || "",
        plot_context: contextContent || "",
        plot_historical: adoptedHistorical || "",
        auxiliary: auxiliaryPrompt || "",
        plot_user_msg: wrappedUserMessage || "",
        plot_history: historyContent || "",
        plot_input: plotInput || "",
    };

    // 调试日志：显示收集到的内容长度
    Logger.debug("[剧情优化预览] sourceContents 各项长度:", {
        jailbreak: (jailbreakPrefix || "").length,
        main: (mainPrompt || "").length,
        plot_worldbooks: (globalWorldbookContent || "").length,
        plot_char_desc: (characterDescription || "").length,
        plot_context: (contextContent || "").length,
        plot_historical: (adoptedHistorical || "").length,
        auxiliary: (auxiliaryPrompt || "").length,
        plot_user_msg: (wrappedUserMessage || "").length,
        plot_history: (historyContent || "").length,
        plot_input: (plotInput || "").length,
    });
    Logger.debug("[剧情优化预览] plotConfig:", {
        promptFile: plotConfig.promptFile,
        selectedBooks: plotConfig.selectedBooks,
        includeCharDescription: plotConfig.includeCharDescription,
        contextRounds: plotConfig.contextRounds,
    });
    Logger.debug("[剧情优化预览] chatContext 长度:", chatContext?.length || 0);

    // 3. 使用流程配置构建 promptParts（确保顺序与实际发送一致）
    const promptParts = await buildPromptPartsByFlowConfig(
        "剧情优化",
        sourceContents,
    );

    // 4. 生成兼容的 prompt 字符串（用于向后兼容）
    const prompt = promptParts
        .filter((part) => part.content && part.content.trim())
        .map((part) => `【${part.label}】\n${part.content}`)
        .join("\n\n");

    return {
        category: "剧情优化",
        source: "剧情优化助手",
        model: plotConfig.model || "未指定模型",
        promptParts: promptParts,
        prompt: prompt,
        aiConfig: {
            apiFormat: plotConfig.apiFormat || "openai",
            apiUrl: plotConfig.apiUrl,
            apiKey: plotConfig.apiKey,
            model: plotConfig.model,
            maxTokens: plotConfig.maxTokens || 2000,
            temperature: plotConfig.temperature || 0.7,
            responsePath:
                plotConfig.responsePath || "choices.0.message.content",
        },
        taskType: "plot_optimize",
    };
}

/**
 * 最小化/恢复面板
 */
function togglePlotPanelMinimize() {
    Logger.log("[剧情优化] togglePlotPanelMinimize 被调用");
    const panel = document.getElementById("mm-plot-optimize-panel");
    Logger.log("[剧情优化] 面板元素:", !!panel);
    if (panel) {
        const wasMinimized = panel.classList.contains("mm-minimized");
        panel.classList.toggle("mm-minimized");
        const isMinimized = panel.classList.contains("mm-minimized");
        Logger.log(
            "[剧情优化] 最小化状态: 之前=",
            wasMinimized,
            ", 现在=",
            isMinimized,
        );
    } else {
        Logger.warn("[剧情优化] 面板元素不存在，无法切换最小化状态");
    }
}

/**
 * 格式化时间戳
 */
function formatPlotChatTime(date = new Date()) {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
}

/**
 * 添加聊天消息到面板
 * @param {string} content - 消息内容
 * @param {string} type - 消息类型: 'user' | 'ai' | 'system' | 'typing'
 * @param {object} options - 额外选项
 */
function addPlotChatMessage(content, type = "ai", options = {}) {
    const container = document.getElementById("mm-plot-chat-container");
    if (!container) return null;

    const messageDiv = document.createElement("div");
    messageDiv.className = `mm-plot-message mm-plot-message-${type}`;
    if (options.className) {
        messageDiv.className += ` ${options.className}`;
    }
    if (options.id) {
        messageDiv.id = options.id;
    }

    // 头像
    const avatarDiv = document.createElement("div");
    avatarDiv.className = "mm-plot-avatar";
    if (type === "user") {
        avatarDiv.innerHTML = `<i class="fa-solid fa-user"></i>`;
    } else if (type === "ai" || type === "typing") {
        avatarDiv.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i>`;
    }

    // 气泡
    const bubbleDiv = document.createElement("div");
    bubbleDiv.className = "mm-plot-bubble";

    // 内容
    const contentDiv = document.createElement("div");
    contentDiv.className = "mm-plot-bubble-content";
    if (options.streaming) {
        contentDiv.classList.add("streaming");
    }

    if (type === "typing") {
        contentDiv.innerHTML = `
        <span class="mm-plot-typing-dot"></span>
        <span class="mm-plot-typing-dot"></span>
        <span class="mm-plot-typing-dot"></span>
      `;
    } else {
        contentDiv.textContent = content;
    }

    // 时间戳
    const timeDiv = document.createElement("div");
    timeDiv.className = "mm-plot-bubble-time";
    timeDiv.textContent = formatPlotChatTime();

    bubbleDiv.appendChild(contentDiv);
    if (type !== "typing") {
        bubbleDiv.appendChild(timeDiv);
    }

    if (type !== "system") {
        messageDiv.appendChild(avatarDiv);
    }
    messageDiv.appendChild(bubbleDiv);

    container.appendChild(messageDiv);

    // 滚动到底部
    container.scrollTop = container.scrollHeight;

    return { messageDiv, contentDiv, timeDiv };
}

/**
 * 移除正在输入的消息
 */
function removePlotTypingMessage() {
    const typing = document.querySelector(".mm-plot-message-typing");
    if (typing) {
        typing.remove();
    }
}

/**
 * 重置聊天容器
 */
function resetPlotPanelPreview() {
    const container = document.getElementById("mm-plot-chat-container");
    if (container) {
        container.innerHTML = `
        <!-- 第一条消息：核心欢迎语 -->
        <div class="mm-plot-message mm-plot-message-ai mm-plot-message-welcome">
          <div class="mm-plot-avatar">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
          </div>
          <div class="mm-plot-bubble">
            <div class="mm-plot-bubble-content">您好！我是剧情优化助手，我将根据你的需求提供更合适的优化方案。</div>
            <div class="mm-plot-bubble-time">${formatPlotChatTime()}</div>
          </div>
        </div>
        <!-- 第二条消息：补充提醒（单独一条） -->
        <div class="mm-plot-message mm-plot-message-ai">
          <div class="mm-plot-avatar">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
          </div>
          <div class="mm-plot-bubble">
            <div class="mm-plot-bubble-content">若跑偏，请提醒回归核心用户消息和遵循格式要求。</div>
            <div class="mm-plot-bubble-time">${formatPlotChatTime()}</div>
          </div>
        </div>
        `;
    }
    plotPanelCurrentPreview = "";
    plotPanelChatHistory = []; // 重置对话历史
    updatePlotPanelStatus("等待生成...");
}

/**
 * 更新面板状态文本
 */
function updatePlotPanelStatus(text) {
    const statusEl = document.getElementById("mm-plot-status-text");
    if (statusEl) {
        statusEl.textContent = text;
    }
}

/**
 * 更新操作按钮状态
 */
function updatePlotPanelButtons(hasPreview) {
    const acceptBtn = document.getElementById("mm-plot-accept-btn");
    const rejectBtn = document.getElementById("mm-plot-reject-btn");
    const regenerateBtn = document.getElementById("mm-plot-regenerate-btn");

    if (acceptBtn) acceptBtn.disabled = !hasPreview;
    if (rejectBtn) rejectBtn.disabled = !hasPreview;
    if (regenerateBtn) regenerateBtn.disabled = !hasPreview;
}

/**
 * 加载面板中的世界书列表
 * @param {boolean} forceRefresh - 是否强制刷新缓存
 */
async function loadPlotPanelWorldBooks(forceRefresh = false) {
    const container = document.getElementById("mm-plot-worldbook-list");
    const loadingEl = document.getElementById("mm-plot-worldbook-loading");
    const emptyEl = document.getElementById("mm-plot-worldbook-empty");
    const noResultsEl = document.getElementById("mm-plot-worldbook-no-results");

    if (!container) {
        return;
    }

    // 从配置加载已选中的世界书（使用独立的面板世界书配置，与API设置分开）
    const settings = getGlobalSettings();
    const plotConfig = settings.plotOptimizeConfig || {};
    // 使用 panelSelectedBooks/panelSelectedEntries，与 selectedBooks/selectedEntries（API设置用）分开
    plotPanelSelectedBooks = new Set(plotConfig.panelSelectedBooks || []);
    plotPanelSelectedEntries = { ...(plotConfig.panelSelectedEntries || {}) };

    if (loadingEl) loadingEl.style.display = "flex";
    if (emptyEl) emptyEl.style.display = "none";
    if (noResultsEl) noResultsEl.style.display = "none";
    container.innerHTML = "";

    try {
        // 使用缓存或重新获取
        if (forceRefresh || plotPanelWorldBooksCache.length === 0) {
            plotPanelWorldBooksCache = await getWorldBookList();
            plotPanelEntriesCache = {}; // 清空条目缓存
        }
        const worldBooks = plotPanelWorldBooksCache;

        if (loadingEl) loadingEl.style.display = "none";

        if (worldBooks.length === 0) {
            if (emptyEl) emptyEl.style.display = "flex";
            updatePlotPanelWorldbookBadge();
            return;
        }

        // 渲染世界书列表
        renderPlotPanelWorldBooks(worldBooks);
        updatePlotPanelWorldbookBadge();

        // 绑定搜索框事件
        bindPlotPanelSearchEvents();
    } catch (error) {
        Logger.error("加载世界书列表失败:", error);
        if (loadingEl) loadingEl.style.display = "none";
        container.innerHTML =
            '<div class="mm-plot-empty"><i class="fa-solid fa-exclamation-circle"></i><span>加载失败</span></div>';
    }
}

/**
 * 渲染世界书列表
 * @param {Array} worldBooks - 世界书列表
 * @param {string} searchTerm - 搜索关键词（可选）
 */
function renderPlotPanelWorldBooks(worldBooks, searchTerm = "") {
    const container = document.getElementById("mm-plot-worldbook-list");
    const noResultsEl = document.getElementById("mm-plot-worldbook-no-results");
    const emptyEl = document.getElementById("mm-plot-worldbook-empty");

    if (!container) return;
    container.innerHTML = "";

    const searchLower = searchTerm.toLowerCase().trim();
    let hasVisibleBooks = false;

    for (const book of worldBooks) {
        // 检查世界书名是否匹配搜索词
        const bookNameLower = book.name.toLowerCase();
        const bookMatches = !searchLower || bookNameLower.includes(searchLower);

        // 检查条目是否匹配搜索词（如果有缓存）
        const cachedEntries = plotPanelEntriesCache[book.name] || [];
        let matchingEntries = [];
        if (searchLower && cachedEntries.length > 0) {
            matchingEntries = cachedEntries.filter((entry) => {
                const displayName = entry.comment || entry.key?.[0] || "";
                return displayName.toLowerCase().includes(searchLower);
            });
        }

        // 如果世界书名不匹配且没有匹配的条目，跳过
        if (searchLower && !bookMatches && matchingEntries.length === 0) {
            continue;
        }

        hasVisibleBooks = true;

        const bookItem = document.createElement("div");
        bookItem.className = "mm-plot-book-item";
        bookItem.dataset.bookName = book.name;

        const isSelected = plotPanelSelectedBooks.has(book.name);
        if (isSelected) bookItem.classList.add("selected");

        // 高亮显示匹配的文本
        const displayBookName =
            searchLower && bookMatches
                ? highlightSearchText(book.name, searchTerm)
                : book.name;

        // 条目数量显示（-1 表示未加载）
        const entryCountText =
            book.entryCount >= 0 ? `${book.entryCount} 条目` : "";

        bookItem.innerHTML = `
        <div class="mm-plot-book-header">
          <input type="checkbox" class="mm-plot-book-checkbox" ${
              isSelected ? "checked" : ""
          }>
          <span class="mm-plot-book-name">${displayBookName}</span>
          <span class="mm-plot-book-count">${entryCountText}</span>
          <i class="fa-solid fa-chevron-right mm-plot-book-expand"></i>
        </div>
        <div class="mm-plot-book-entries"></div>
      `;

        const checkbox = bookItem.querySelector(".mm-plot-book-checkbox");
        const expandIcon = bookItem.querySelector(".mm-plot-book-expand");
        const bookHeader = bookItem.querySelector(".mm-plot-book-header");
        const entriesContainer = bookItem.querySelector(
            ".mm-plot-book-entries",
        );

        // 勾选世界书
        checkbox.addEventListener("change", (e) => {
            e.stopPropagation();
            if (e.target.checked) {
                plotPanelSelectedBooks.add(book.name);
                bookItem.classList.add("selected");
            } else {
                plotPanelSelectedBooks.delete(book.name);
                delete plotPanelSelectedEntries[book.name];
                bookItem.classList.remove("selected");
            }
            updatePlotPanelWorldbookBadge();
            savePlotPanelWorldbookSelection(); // 保存面板世界书选择
        });

        // 点击书名也可以展开/收起
        bookHeader.addEventListener("click", async (e) => {
            if (e.target.tagName === "INPUT") return; // 忽略复选框点击
            e.stopPropagation();
            const isExpanded = bookItem.classList.contains("expanded");

            if (!isExpanded) {
                bookItem.classList.add("expanded");
                await loadPlotPanelBookEntries(
                    book.name,
                    entriesContainer,
                    searchTerm,
                );
            } else {
                bookItem.classList.remove("expanded");
            }
        });

        // 点击展开图标
        expandIcon.addEventListener("click", async (e) => {
            e.stopPropagation();
            const isExpanded = bookItem.classList.contains("expanded");

            if (!isExpanded) {
                bookItem.classList.add("expanded");
                await loadPlotPanelBookEntries(
                    book.name,
                    entriesContainer,
                    searchTerm,
                );
            } else {
                bookItem.classList.remove("expanded");
            }
        });

        container.appendChild(bookItem);

        // 如果搜索时有匹配的条目，自动展开
        if (searchLower && matchingEntries.length > 0 && !bookMatches) {
            bookItem.classList.add("expanded");
            loadPlotPanelBookEntries(book.name, entriesContainer, searchTerm);
        }
    }

    // 显示无结果提示
    if (noResultsEl) {
        noResultsEl.style.display =
            !hasVisibleBooks && searchLower ? "flex" : "none";
    }
    if (emptyEl) {
        emptyEl.style.display =
            !hasVisibleBooks && !searchLower ? "flex" : "none";
    }
}

/**
 * 高亮搜索文本
 * 修复：先转义 HTML，再添加高亮标签，防止 XSS 攻击
 */
function highlightSearchText(text, searchTerm) {
    if (!searchTerm) return text;

    // 先转义 HTML 特殊字符
    const div = document.createElement("div");
    div.textContent = text;
    const escapedText = div.innerHTML;

    // 再进行高亮替换
    const regex = new RegExp(
        `(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
        "gi",
    );
    return escapedText.replace(
        regex,
        '<span class="mm-search-highlight">$1</span>',
    );
}

/**
 * 绑定搜索框事件
 */
function bindPlotPanelSearchEvents() {
    const searchInput = document.getElementById(
        "mm-plot-worldbook-search-input",
    );
    const clearBtn = document.getElementById("mm-plot-worldbook-search-clear");

    if (!searchInput) return;

    // 防抖搜索
    let searchTimeout = null;
    searchInput.addEventListener("input", (e) => {
        const searchTerm = e.target.value;

        // 显示/隐藏清除按钮
        if (clearBtn) {
            clearBtn.style.display = searchTerm ? "block" : "none";
        }

        // 防抖处理
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            renderPlotPanelWorldBooks(plotPanelWorldBooksCache, searchTerm);
        }, 200);
    });

    // 清除按钮
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            searchInput.value = "";
            clearBtn.style.display = "none";
            renderPlotPanelWorldBooks(plotPanelWorldBooksCache, "");
            searchInput.focus();
        });
    }
}

/**
 * 加载世界书条目
 * @param {string} bookName - 世界书名称
 * @param {HTMLElement} container - 容器元素
 * @param {string} searchTerm - 搜索关键词（可选）
 */
async function loadPlotPanelBookEntries(bookName, container, searchTerm = "") {
    container.innerHTML =
        '<div class="mm-plot-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>加载中...</span></div>';

    try {
        // 使用缓存或重新获取
        let entries;
        if (plotPanelEntriesCache[bookName]) {
            entries = plotPanelEntriesCache[bookName];
        } else {
            entries = await getWorldBookEntries(bookName);
            plotPanelEntriesCache[bookName] = entries;
        }

        container.innerHTML = "";

        if (entries.length === 0) {
            container.innerHTML =
                '<div class="mm-plot-entry-item" style="justify-content: center; color: var(--mm-text-muted);">暂无条目</div>';
            return;
        }

        const selectedUids = plotPanelSelectedEntries[bookName] || [];
        const searchLower = searchTerm.toLowerCase().trim();

        // 过滤和排序条目（匹配的在前）
        let filteredEntries = entries;
        if (searchLower) {
            filteredEntries = entries.filter((entry) => {
                const displayName = entry.comment || entry.key?.[0] || "";
                return displayName.toLowerCase().includes(searchLower);
            });

            // 如果有搜索词但没有匹配的条目，显示所有条目
            if (filteredEntries.length === 0) {
                filteredEntries = entries;
            }
        }

        for (const entry of filteredEntries) {
            const entryItem = document.createElement("div");
            entryItem.className = "mm-plot-entry-item";

            const uid = entry.uid?.toString() || "";
            const isSelected = selectedUids.includes(uid);
            const rawDisplayName = entry.comment || entry.key?.[0] || "未命名";

            // 高亮搜索词
            const displayName = searchLower
                ? highlightSearchText(rawDisplayName, searchTerm)
                : rawDisplayName;

            entryItem.innerHTML = `
          <input type="checkbox" class="mm-plot-entry-checkbox" data-uid="${uid}" ${
              isSelected ? "checked" : ""
          }>
          <span class="mm-plot-entry-name">${displayName}</span>
        `;

            const entryCheckbox = entryItem.querySelector(
                ".mm-plot-entry-checkbox",
            );
            entryCheckbox.addEventListener("change", (e) => {
                e.stopPropagation();
                const entryUid = e.target.dataset.uid;

                if (!plotPanelSelectedEntries[bookName]) {
                    plotPanelSelectedEntries[bookName] = [];
                }

                if (e.target.checked) {
                    if (
                        !plotPanelSelectedEntries[bookName].includes(entryUid)
                    ) {
                        plotPanelSelectedEntries[bookName].push(entryUid);
                    }
                } else {
                    plotPanelSelectedEntries[bookName] =
                        plotPanelSelectedEntries[bookName].filter(
                            (id) => id !== entryUid,
                        );
                }
                savePlotPanelWorldbookSelection(); // 保存面板世界书选择
            });

            container.appendChild(entryItem);
        }
    } catch (error) {
        Logger.error(`加载世界书 ${bookName} 条目失败:`, error);
        container.innerHTML =
            '<div class="mm-plot-entry-item" style="color: var(--mm-danger);">加载失败</div>';
    }
}

/**
 * 更新世界书徽章
 */
function updatePlotPanelWorldbookBadge() {
    const badge = document.getElementById("mm-plot-worldbook-badge");
    const countEl = document.getElementById("mm-plot-books-count");

    if (badge) badge.textContent = `已选 ${plotPanelSelectedBooks.size}`;
    if (countEl) countEl.textContent = plotPanelSelectedBooks.size;
}

/**
 * 保存面板世界书选择到配置（独立于API设置中的世界书选择）
 */
function savePlotPanelWorldbookSelection() {
    const settings = getGlobalSettings();
    const plotConfig = settings.plotOptimizeConfig || {};

    updateGlobalSettings({
        plotOptimizeConfig: {
            ...plotConfig,
            panelSelectedBooks: Array.from(plotPanelSelectedBooks),
            panelSelectedEntries: { ...plotPanelSelectedEntries },
        },
    });
}

/**
 * 初始化剧情优化面板世界书区域的拖拽调整高度功能
 * 拖拽世界书区域底部手柄，同时调整世界书区域和整个面板的高度
 */
function initPlotWorldbookResize() {
    const resizeHandle = document.getElementById(
        "mm-plot-worldbook-resize-handle",
    );
    const plotPanel = document.getElementById("mm-plot-optimize-panel");
    const worldbookSection = document.getElementById(
        "mm-plot-worldbook-section",
    );

    if (!resizeHandle || !plotPanel || !worldbookSection) {
        Logger.warn("initPlotWorldbookResize: 未找到必要元素");
        return;
    }

    let isResizing = false;
    let startY = 0;
    let startWorldbookHeight = 0;
    let startPanelHeight = 0;
    const minWorldbookHeight = 80; // 世界书区域最小高度
    const maxWorldbookHeight = 600; // 世界书区域最大高度

    const onMouseDown = (e) => {
        // 如果是折叠状态或最小化状态，不允许调整
        if (worldbookSection.classList.contains("collapsed")) return;
        if (plotPanel.classList.contains("mm-minimized")) return;

        isResizing = true;
        startY = e.clientY || e.touches?.[0]?.clientY || 0;
        startWorldbookHeight = worldbookSection.offsetHeight;
        startPanelHeight = plotPanel.offsetHeight;

        resizeHandle.classList.add("resizing");
        worldbookSection.classList.add("resizing");
        plotPanel.classList.add("resizing");
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";

        e.preventDefault();
        e.stopPropagation();
    };

    const onMouseMove = (e) => {
        if (!isResizing) return;

        const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
        const deltaY = clientY - startY;

        // 计算新的世界书区域高度
        let newWorldbookHeight = startWorldbookHeight + deltaY;
        newWorldbookHeight = Math.max(
            minWorldbookHeight,
            Math.min(maxWorldbookHeight, newWorldbookHeight),
        );

        // 计算实际变化量
        const actualDelta = newWorldbookHeight - startWorldbookHeight;

        // 计算新的面板高度
        let newPanelHeight = startPanelHeight + actualDelta;
        const maxPanelHeight = window.innerHeight * 0.9;
        const minPanelHeight = 300;
        newPanelHeight = Math.max(
            minPanelHeight,
            Math.min(maxPanelHeight, newPanelHeight),
        );

        // 应用高度
        worldbookSection.style.height = `${newWorldbookHeight}px`;
        worldbookSection.style.maxHeight = `${newWorldbookHeight}px`;
        plotPanel.style.height = `${newPanelHeight}px`;
        plotPanel.style.maxHeight = `${newPanelHeight}px`;

        e.preventDefault();
    };

    const onMouseUp = () => {
        if (!isResizing) return;

        isResizing = false;
        resizeHandle.classList.remove("resizing");
        worldbookSection.classList.remove("resizing");
        plotPanel.classList.remove("resizing");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
    };

    // 鼠标事件
    resizeHandle.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // 触摸事件（移动端支持）
    resizeHandle.addEventListener("touchstart", onMouseDown, {
        passive: false,
    });
    document.addEventListener("touchmove", onMouseMove, { passive: false });
    document.addEventListener("touchend", onMouseUp);

    Logger.debug("initPlotWorldbookResize: 世界书区域拖拽调整高度功能已初始化");
}

/**
 * 初始化剧情优化面板聊天区域的拖拽调整高度功能
 */
function initPlotChatResize() {
    const resizeHandle = document.getElementById("mm-plot-chat-resize-handle");
    const plotPanel = document.getElementById("mm-plot-optimize-panel");
    const chatContainer = document.getElementById("mm-plot-chat-container");

    if (!resizeHandle || !plotPanel || !chatContainer) {
        Logger.warn("initPlotChatResize: 未找到必要元素");
        return;
    }

    let isResizing = false;
    let startY = 0;
    let startChatHeight = 0;
    const minChatHeight = 150; // 聊天区域最小高度
    const maxChatHeight = window.innerHeight * 0.7; // 聊天区域最大高度

    const onMouseDown = (e) => {
        // 如果是最小化状态，不允许调整
        if (plotPanel.classList.contains("mm-minimized")) return;

        isResizing = true;
        startY = e.clientY || e.touches?.[0]?.clientY || 0;
        startChatHeight = chatContainer.offsetHeight;

        resizeHandle.classList.add("resizing");
        chatContainer.classList.add("resizing");
        plotPanel.classList.add("resizing");
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";

        e.preventDefault();
        e.stopPropagation();
    };

    const onMouseMove = (e) => {
        if (!isResizing) return;

        const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
        const deltaY = clientY - startY;

        // 计算新的聊天区域高度
        let newChatHeight = startChatHeight + deltaY;
        newChatHeight = Math.max(
            minChatHeight,
            Math.min(maxChatHeight, newChatHeight),
        );

        // 应用高度
        chatContainer.style.height = `${newChatHeight}px`;
        chatContainer.style.maxHeight = `${newChatHeight}px`;
        chatContainer.style.minHeight = `${newChatHeight}px`;

        e.preventDefault();
    };

    const onMouseUp = () => {
        if (!isResizing) return;

        isResizing = false;
        resizeHandle.classList.remove("resizing");
        chatContainer.classList.remove("resizing");
        plotPanel.classList.remove("resizing");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
    };

    // 鼠标事件
    resizeHandle.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // 触摸事件（移动端支持）
    resizeHandle.addEventListener("touchstart", onMouseDown, {
        passive: false,
    });
    document.addEventListener("touchmove", onMouseMove, { passive: false });
    document.addEventListener("touchend", onMouseUp);

    Logger.debug("initPlotChatResize: 聊天区域拖拽调整高度功能已初始化");
}

/**
 * 获取最近聊天上下文
 */
async function getRecentChatContext() {
    try {
        if (typeof SillyTavern !== "undefined" && SillyTavern.getContext) {
            const { chat } = SillyTavern.getContext();
            if (chat && chat.length > 0) {
                // 获取剧情优化配置中的上下文轮次
                const settings = getGlobalSettings();
                const plotConfig = settings.plotOptimizeConfig || {};
                const contextRounds = plotConfig.contextRounds ?? 5;

                // 每轮包含用户消息+助手回复，所以消息数 = 轮次 * 2
                const maxMessages = contextRounds * 2;
                if (maxMessages <= 0) return "";

                // [标签过滤调用点4] 剧情优化助手面板 - 获取前文内容
                const globalConfig = getGlobalConfig();
                const tagFilterConfig = globalConfig.contextTagFilter;

                const recentMessages = chat.slice(-maxMessages);
                let context = "";
                for (const msg of recentMessages) {
                    const isUser = msg.is_user || msg.role === "user";
                    const name = msg.name || (isUser ? "用户" : "角色");
                    let content = msg.mes || msg.content || "";

                    // 使用 filterContentByRole 处理标签过滤（支持新旧配置格式）
                    content = filterContentByRole(content, tagFilterConfig, isUser);

                    if (content.trim()) {
                        context += `${name}: ${content}\n`;
                    }
                }
                // 使用标签包裹前文内容
                if (context.trim()) {
                    return `<前文内容>\n${context.trim()}\n</前文内容>`;
                }
                return "";
            }
        }
    } catch (error) {
        Logger.warn("获取最近聊天上下文失败:", error);
    }
    return "";
}

/**
 * 调用剧情优化 API
 * @param {string} userInput - 用户输入的调整需求
 * @param {boolean} forceGenerate - 是否强制生成最终结果（跳过需求确认）
 * @returns {Promise<string>} - AI 生成的剧情优化建议
 */
async function callPlotOptimizeApi(userInput = "", forceGenerate = false) {
    const settings = getGlobalSettings();
    const plotConfig = settings.plotOptimizeConfig || {};

    // 检查必要配置
    if (!plotConfig.apiUrl || !plotConfig.model) {
        throw new Error("请先配置剧情优化的 API 设置");
    }

    // 加载剧情优化提示词模板
    let promptTemplate = null;
    if (plotConfig.promptFile) {
        try {
            promptTemplate = await loadPromptTemplate(plotConfig.promptFile);
            Logger.debug("[剧情优化] 加载提示词模板:", plotConfig.promptFile);
        } catch (e) {
            Logger.warn("[剧情优化] 加载提示词模板失败:", e);
        }
    }

    // 统一模式 - 不再区分对话模式和分析模式
    Logger.debug("[剧情优化] 使用统一模式");

    // 获取上下文数据
    const chatContext = await getRecentChatContext();

    // 获取面板选择的世界书条目内容（剧情优化助手面板中选择的）
    let panelWorldbookContent = "";
    const panelSelectedBooks = Array.from(plotPanelSelectedBooks);
    const panelSelectedEntries = plotPanelSelectedEntries;

    for (const bookName of panelSelectedBooks) {
        try {
            const entries = await getWorldBookEntries(bookName);
            const entryUids = panelSelectedEntries[bookName] || [];
            const targetEntries =
                entryUids.length > 0
                    ? entries.filter((e) =>
                          entryUids.includes(e.uid?.toString()),
                      )
                    : entries;

            for (const entry of targetEntries) {
                const entryName = entry.comment || entry.key?.[0] || "未命名";
                const content = entry.content || "";
                if (content.trim()) {
                    panelWorldbookContent += `【${entryName}】\n${content}\n\n`;
                }
            }
        } catch (e) {
            Logger.warn(`[剧情优化] 加载面板世界书 "${bookName}" 失败:`, e);
        }
    }
    // 使用标签包裹面板世界书内容
    if (panelWorldbookContent.trim()) {
        panelWorldbookContent = `<面板世界书内容>\n${panelWorldbookContent.trim()}\n</面板世界书内容>`;
    }

    // 获取全局配置的世界书内容
    let globalWorldbookContent = "";
    const globalSelectedBooks = plotConfig.selectedBooks || [];
    const globalSelectedEntries = plotConfig.selectedEntries || {};
    for (const bookName of globalSelectedBooks) {
        try {
            const entries = await getWorldBookEntries(bookName);
            const selectedUids = globalSelectedEntries[bookName] || [];
            // 如果该世界书有选中的条目，则只使用选中的条目；否则使用所有启用的条目
            const hasSelectedEntries = selectedUids.length > 0;
            for (const entry of entries) {
                if (entry.disable === true) continue; // 跳过禁用的条目
                // 如果有选中条目，只包含选中的条目
                if (hasSelectedEntries && !selectedUids.includes(String(entry.uid))) {
                    continue;
                }
                const entryName =
                    entry.comment || entry.key?.[0] || "未命名";
                const content = entry.content || "";
                if (content.trim()) {
                    globalWorldbookContent += `【${entryName}】\n${content}\n\n`;
                }
            }
        } catch (e) {
            Logger.warn(`[剧情优化] 加载全局世界书 "${bookName}" 失败:`, e);
        }
    }
    // 使用标签包裹全局世界书内容
    if (globalWorldbookContent.trim()) {
        globalWorldbookContent = `<世界书内容>\n${globalWorldbookContent.trim()}\n</世界书内容>`;
    }

    // 获取角色描述（如果启用）
    let characterDescription = "";
    if (plotConfig.includeCharDescription !== false) {
        try {
            if (typeof SillyTavern !== "undefined" && SillyTavern.getContext) {
                const context = SillyTavern.getContext();
                const char = context.characters?.[context.characterId];
                if (char) {
                    let charContent = char.description || "";
                    if (char.personality) {
                        charContent += `\n\n【性格特点】\n${char.personality}`;
                    }
                    if (char.scenario) {
                        charContent += `\n\n【场景设定】\n${char.scenario}`;
                    }
                    // 使用标签包裹角色描述
                    if (charContent.trim()) {
                        characterDescription = `<角色设定>\n${charContent.trim()}\n</角色设定>`;
                    }
                }
            }
        } catch (e) {
            Logger.warn("[剧情优化] 获取角色描述失败:", e);
        }
    }

    // 获取历史事件回忆
    const searchPanel = searchPanelGetter ? searchPanelGetter() : null;
    let adoptedHistorical = searchPanel
        ? searchPanel.getAdoptedHistoricalMemories()
        : "";
    // 使用标签包裹历史事件回忆（如果还没有标签）
    if (
        adoptedHistorical &&
        adoptedHistorical.trim() &&
        !adoptedHistorical.includes("<历史事件回忆>")
    ) {
        adoptedHistorical = `<历史事件回忆>\n${adoptedHistorical.trim()}\n</历史事件回忆>`;
    }

    // 获取破限词（如果有）
    const jailbreakPrefix = getJailbreakPrefix ? getJailbreakPrefix() : "";

    // ========== 统一模式构建消息 ==========
    // 使用流程配置构建 promptParts
    let systemPrompt = "";
    let messages = [];

    const mainPrompt = promptTemplate?.mainPrompt || "";
    const auxiliaryPrompt = promptTemplate?.systemPrompt || "";

    // 构建来源内容对象
    // 为核心用户消息添加标签包裹
    const wrappedOriginalUserMessage = plotPanelOriginalUserMessage
        ? `<核心用户消息>\n${plotPanelOriginalUserMessage}\n</核心用户消息>`
        : "";
    // 为面板用户输入添加标签包裹
    const wrappedUserInput = userInput
        ? `<最新用户消息>\n${userInput}\n</最新用户消息>`
        : "";

    // 构建历史对话记录内容并添加标签
    let historyContentForApi =
        plotPanelChatHistory
            .map(
                (msg) =>
                    `${msg.role === "user" ? "用户" : "AI"}: ${msg.content}`,
            )
            .join("\n") || "";
    if (historyContentForApi.trim()) {
        historyContentForApi = `<历史对话记录>\n${historyContentForApi.trim()}\n</历史对话记录>`;
    }

    const sourceContents = {
        jailbreak: jailbreakPrefix || "",
        main: mainPrompt || "",
        plot_worldbooks: globalWorldbookContent || "", // 全局配置的世界书
        plot_panel_worldbooks: panelWorldbookContent || "", // 面板选择的世界书内容
        plot_char_desc: characterDescription || "",
        plot_context: chatContext || "",
        plot_historical: adoptedHistorical || "",
        auxiliary: auxiliaryPrompt || "",
        plot_user_msg: wrappedOriginalUserMessage || "",
        plot_history: historyContentForApi || "",
        plot_input: wrappedUserInput || "",
    };

    // 使用流程配置构建 promptParts
    const promptParts = await buildPromptPartsByFlowConfig(
        "剧情优化",
        sourceContents,
    );

    Logger.log("[剧情优化] promptParts 数量:", promptParts.length);
    Logger.log(
        "[剧情优化] promptParts 各项:",
        promptParts.map((p) => ({
            source: p.source,
            label: p.label,
            hasContent: !!(p.content && p.content.trim()),
            contentLength: (p.content || "").length,
        })),
    );

    // 构建完整的用户消息
    let userMessageContent = "";
    for (const part of promptParts) {
        if (part.content.trim()) {
            userMessageContent += part.label + "\n" + part.content + "\n\n";
        }
    }

    Logger.log(
        "[剧情优化] userMessageContent 长度:",
        userMessageContent.length,
    );

    // 构建消息列表
    // 首先添加基础用户消息（包含所有上下文）
    messages.push({ role: "user", content: userMessageContent });

    // 6. 添加历史对话记录（如果有）
    if (plotPanelChatHistory.length > 0) {
        for (const msg of plotPanelChatHistory) {
            messages.push(msg);
        }
    }

    // 7. 添加当前用户输入（如果有且不是第一条消息）
    // 注意：plot_input 已经在 sourceContents 中通过流程配置添加了
    // 只有当有历史对话时，才需要作为新消息单独添加
    if (userInput && plotPanelChatHistory.length > 0) {
        // 有历史对话时，作为新消息添加（不需要再包标签，因为是多轮对话的新输入）
        messages.push({ role: "user", content: userInput });
    }

    Logger.log(
        "[剧情优化] 最终消息列表:",
        messages.map((m) => ({
            role: m.role,
            contentLength: (m.content || "").length,
            contentPreview: (m.content || "").substring(0, 100) + "...",
        })),
    );

    // 统一模式使用空的系统提示词，所有内容都在用户消息中
    systemPrompt = "";

    // 调用 API
    const apiConfig = {
        apiFormat: plotConfig.apiFormat || "openai",
        apiUrl: plotConfig.apiUrl,
        apiKey: plotConfig.apiKey,
        model: plotConfig.model,
        maxTokens: plotConfig.maxTokens || 2000,
        temperature: plotConfig.temperature || 0.7,
        taskId: "plot_optimize",
        source: "剧情优化",
    };

    // 创建 abort controller 并设置给进度追踪器
    const abortController = new AbortController();
    if (progressTracker) {
        progressTracker.setTaskAbortController(
            "plot_optimize",
            abortController,
        );
        // 立即更新进度为 5%，确保进度条显示
        progressTracker.updateStreamProgress("plot_optimize", 5);
        Logger.info("[剧情优化] 已设置 AbortController 并更新初始进度");
    }

    const response = await APIAdapter.callWithMessages(
        apiConfig,
        systemPrompt,
        messages,
        "plot_optimize",
        2,
        abortController.signal,
    );

    // 更新对话历史记录（用于多轮对话）
    if (userInput) {
        plotPanelChatHistory.push({ role: "user", content: userInput });
    }
    plotPanelChatHistory.push({ role: "assistant", content: response });

    return response;
}

/**
 * 生成剧情优化建议
 */
async function generatePlotOptimize(userInput = "") {
    Logger.log("[剧情优化] ===== generatePlotOptimize 进入函数 =====");
    Logger.log("[剧情优化] plotPanelIsGenerating =", plotPanelIsGenerating);
    Logger.log("[剧情优化] progressTracker 存在:", !!progressTracker);

    if (plotPanelIsGenerating) {
        Logger.log("[剧情优化] 已在生成中，跳过");
        return;
    }

    plotPanelIsGenerating = true;
    updatePlotPanelButtons(false);
    updatePlotPanelStatus("正在生成...");

    // 如果有用户输入，先显示用户消息
    if (userInput) {
        addPlotChatMessage(userInput, "user");
    }

    // 显示正在输入动画
    addPlotChatMessage("", "typing", {
        className: "mm-plot-message-typing",
    });

    // 添加到进度追踪
    Logger.log("[剧情优化] 准备添加进度任务");
    if (progressTracker) {
        Logger.log("[剧情优化] 调用 progressTracker.addTask");
        try {
            // 确保任务被正确添加，并且进度UI被显示
            // addTask 已经设置了 status: "running"，不需要再调用 startTask
            progressTracker.addTask("plot_optimize", "剧情优化", "plot");
            Logger.log("[剧情优化] addTask 调用成功");
            // 立即更新进度为5%，确保进度条有初始显示
            progressTracker.updateStreamProgress("plot_optimize", 5);
        } catch (e) {
            Logger.error("[剧情优化] addTask 调用失败:", e);
        }
    } else {
        Logger.warn("[剧情优化] progressTracker 未设置，无法显示进度条");
    }

    try {
        const response = await callPlotOptimizeApi(userInput);

        // 移除正在输入动画，显示 AI 响应
        removePlotTypingMessage();
        addPlotChatMessage(response, "ai");

        // 生成完成，启用按钮
        plotPanelCurrentPreview = response;
        updatePlotPanelStatus("生成完成");
        updatePlotPanelButtons(true);

        if (progressTracker) {
            Logger.log("[剧情优化] 调用 progressTracker.completeTask");
            progressTracker.completeTask("plot_optimize", true);
        }
    } catch (error) {
        // 移除正在输入动画
        removePlotTypingMessage();

        // 检查是否是用户取消
        if (error.message === "用户取消了请求") {
            Logger.log("[剧情优化] 用户取消了请求");
            updatePlotPanelStatus("已取消");
            // 不显示错误消息，只是静默取消
        } else {
            Logger.error("[剧情优化] 生成失败:", error);
            addPlotChatMessage(`生成失败: ${error.message}`, "system");
            updatePlotPanelStatus("生成失败");

            if (progressTracker) {
                Logger.log(
                    "[剧情优化] 调用 progressTracker.completeTask (失败)",
                );
                progressTracker.completeTask(
                    "plot_optimize",
                    false,
                    error.message,
                );
            }
        }
    } finally {
        plotPanelIsGenerating = false;
    }
}

/**
 * 接受剧情优化建议
 */
function acceptPlotOptimize() {
    if (!plotPanelCurrentPreview) return;

    const content = plotPanelCurrentPreview;

    // 如果有 Promise resolve，说明是会话模式
    if (plotPanelCurrentResolve) {
        Logger.log("[剧情优化] 用户接受优化建议（会话模式）");
        const resolve = plotPanelCurrentResolve;
        plotPanelCurrentResolve = null;
        plotPanelCurrentReject = null;

        // 清除对话历史
        plotPanelChatHistory = [];
        Logger.debug("[剧情优化] 已清除对话历史");

        hidePlotOptimizePanel();
        resolve({ action: "confirm", content: content });
        return;
    }

    // 非会话模式：将内容注入到酒馆输入框并自动发送
    const textarea = document.getElementById("send_textarea");
    if (textarea) {
        textarea.value = content;
        textarea.focus();
        // 触发 input 事件让酒馆知道内容已更改
        textarea.dispatchEvent(new Event("input", { bubbles: true }));

        // 自动发送消息 - 使用多种方法确保发送成功
        let sent = false;
        if (typeof SillyTavern !== "undefined" && SillyTavern.getContext) {
            try {
                const context = SillyTavern.getContext();
                if (typeof context.Generate === "function") {
                    Logger.log("[剧情优化] 使用 Generate 函数发送");
                    context.Generate("normal");
                    sent = true;
                }
            } catch (e) {
                Logger.warn("[剧情优化] Generate 调用失败:", e);
            }
        }

        // 备用方法：使用 jQuery 触发
        if (!sent) {
            Logger.log("[剧情优化] 使用备用方法发送");
            if (typeof jQuery !== "undefined") {
                jQuery("#send_but").trigger("click");
            } else if (typeof $ !== "undefined") {
                $("#send_but").trigger("click");
            } else {
                // 最后的备用方法：直接触发点击事件
                const sendBtn = document.getElementById("send_but");
                if (sendBtn) {
                    const clickEvent = new MouseEvent("click", {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                    });
                    sendBtn.dispatchEvent(clickEvent);
                }
            }
        }
    }

    Logger.log("[剧情优化] 已接受优化建议");

    // 清除对话历史
    plotPanelChatHistory = [];
    Logger.debug("[剧情优化] 已清除对话历史");

    hidePlotOptimizePanel();
}

/**
 * 拒绝剧情优化建议
 */
function rejectPlotOptimize() {
    Logger.log("[剧情优化] rejectPlotOptimize 被调用");
    // 如果有 Promise resolve，说明是会话模式
    if (plotPanelCurrentResolve) {
        Logger.log("[剧情优化] 用户跳过优化（会话模式）");
        const resolve = plotPanelCurrentResolve;
        plotPanelCurrentResolve = null;
        plotPanelCurrentReject = null;

        // 清除对话历史
        plotPanelChatHistory = [];
        Logger.debug("[剧情优化] 已清除对话历史");

        hidePlotOptimizePanel();
        resolve({ action: "skip", content: null });
        return;
    }

    Logger.log("[剧情优化] 已拒绝优化建议");

    // 清除对话历史
    plotPanelChatHistory = [];
    Logger.debug("[剧情优化] 已清除对话历史");

    hidePlotOptimizePanel();
}

/**
 * 重新生成
 * 清除历史记录，重新生成剧情优化建议
 */
function regeneratePlotOptimize() {
    Logger.log("[剧情优化] 重新生成被调用，清除历史记录");

    // 清除对话历史，让 AI 从头开始生成
    plotPanelChatHistory = [];

    // 清除当前预览
    plotPanelCurrentPreview = "";

    // 获取用户输入（如果有）
    const input = document.getElementById("mm-plot-user-input");
    const userInput = input ? input.value.trim() : "";

    // 重新生成
    generatePlotOptimize(userInput);
}

/**
 * 发送用户调整需求
 */
function sendPlotUserInput() {
    const input = document.getElementById("mm-plot-user-input");
    if (!input) {
        return;
    }

    const userInput = input.value.trim();

    if (!userInput && !plotPanelCurrentPreview) {
        // 没有输入也没有预览，执行初始生成
        generatePlotOptimize("");
    } else {
        // 有输入，执行调整生成
        generatePlotOptimize(userInput);
    }

    input.value = "";
}

/**
 * 绑定剧情优化面板事件
 */
export function bindPlotOptimizePanelEvents() {
    const panel = document.getElementById("mm-plot-optimize-panel");
    if (!panel) {
        Logger.warn("[剧情优化] 面板元素不存在，跳过事件绑定");
        return;
    }

    // 最小化按钮
    const minimizeBtn = document.getElementById("mm-plot-minimize");
    if (minimizeBtn) {
        minimizeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            togglePlotPanelMinimize();
        });
    }

    // 关闭按钮
    const closeBtn = document.getElementById("mm-plot-close-btn");
    if (closeBtn) {
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            closePlotOptimizePanel();
        });
    }

    // 世界书折叠
    try {
        const worldbookToggle = document.getElementById(
            "mm-plot-worldbook-toggle",
        );
        if (worldbookToggle) {
            worldbookToggle.addEventListener("click", () => {
                const panel = document.getElementById("mm-plot-optimize-panel");
                const section = document.getElementById(
                    "mm-plot-worldbook-section",
                );
                if (!section || !panel) return;

                const isCollapsed = section.classList.contains("collapsed");
                const currentSectionHeight = section.offsetHeight;
                const currentPanelHeight = panel.offsetHeight;

                if (isCollapsed) {
                    section.classList.remove("collapsed");
                    section.style.height = "";
                    section.style.maxHeight = "";
                    panel.style.height = "";
                    panel.style.maxHeight = "";
                } else {
                    const headerHeight = 40;
                    const heightDiff = currentSectionHeight - headerHeight;
                    section.classList.add("collapsed");
                    const newPanelHeight = Math.max(
                        300,
                        currentPanelHeight - heightDiff,
                    );
                    panel.style.height = `${newPanelHeight}px`;
                    panel.style.maxHeight = `${newPanelHeight}px`;
                }
            });
        }
    } catch (err) {
        Logger.error("[剧情优化] 世界书折叠事件绑定出错:", err);
    }

    // 世界书区域拖拽调整高度
    try {
        initPlotWorldbookResize();
    } catch (err) {
        Logger.error("[剧情优化] initPlotWorldbookResize 出错:", err);
    }

    // 聊天区域拖拽调整高度
    try {
        initPlotChatResize();
    } catch (err) {
        Logger.error("[剧情优化] initPlotChatResize 出错:", err);
    }

    // 世界书刷新
    document
        .getElementById("mm-plot-worldbook-refresh")
        ?.addEventListener("click", (e) => {
            e.stopPropagation();
            const searchInput = document.getElementById(
                "mm-plot-worldbook-search-input",
            );
            if (searchInput) searchInput.value = "";
            const clearBtn = document.getElementById(
                "mm-plot-worldbook-search-clear",
            );
            if (clearBtn) clearBtn.style.display = "none";
            loadPlotPanelWorldBooks(true);
        });

    // 发送按钮
    const sendBtn = document.getElementById("mm-plot-send-btn");
    if (sendBtn) {
        // 移除可能存在的旧事件
        const newSendBtn = sendBtn.cloneNode(true);
        sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);

        newSendBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            sendPlotUserInput();
        });
    }

    // 输入框回车
    document
        .getElementById("mm-plot-user-input")
        ?.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                sendPlotUserInput();
            }
        });

    // 接受按钮
    const acceptBtn = document.getElementById("mm-plot-accept-btn");
    if (acceptBtn) {
        acceptBtn.addEventListener("click", () => {
            acceptPlotOptimize();
        });
    }

    // 拒绝按钮
    const rejectBtn = document.getElementById("mm-plot-reject-btn");
    if (rejectBtn) {
        rejectBtn.addEventListener("click", () => {
            rejectPlotOptimize();
        });
    }

    // 重新生成按钮
    const regenerateBtn = document.getElementById("mm-plot-regenerate-btn");
    if (regenerateBtn) {
        regenerateBtn.addEventListener("click", () => {
            regeneratePlotOptimize();
        });
    }

    // 初始化拖动功能
    initPlotPanelDrag();

    Logger.debug("[剧情优化] 面板事件已绑定");
}

/**
 * 初始化剧情优化面板拖动功能
 */
function initPlotPanelDrag() {
    const panel = document.getElementById("mm-plot-optimize-panel");
    const header = panel?.querySelector(".mm-plot-panel-header");

    if (!panel || !header) {
        return;
    }

    // 点击置顶
    panel.addEventListener("mousedown", () => bringPanelToFront(panel));
    panel.addEventListener("touchstart", () => bringPanelToFront(panel), {
        passive: true,
    });

    // 开始拖动
    const startDrag = (clientX, clientY) => {
        plotPanelIsDragging = true;
        const rect = panel.getBoundingClientRect();
        plotPanelDragOffset.x = clientX - rect.left;
        plotPanelDragOffset.y = clientY - rect.top;
        panel.style.transform = "none";
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.style.transition = "none";
        panel.classList.add("mm-dragging");
    };

    // 拖动中
    const drag = (clientX, clientY) => {
        if (!plotPanelIsDragging) return;
        const x = clientX - plotPanelDragOffset.x;
        const y = clientY - plotPanelDragOffset.y;

        const maxX = window.innerWidth - panel.offsetWidth;
        const maxY = window.innerHeight - panel.offsetHeight;

        panel.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
        panel.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
    };

    // 停止拖动
    const stopDrag = () => {
        if (plotPanelIsDragging) {
            plotPanelIsDragging = false;
            panel.classList.remove("mm-dragging");
            panel.style.transition = "";
        }
    };

    // 鼠标事件
    header.addEventListener("mousedown", (e) => {
        if (e.target.closest("button")) {
            return;
        }
        startDrag(e.clientX, e.clientY);
    });

    document.addEventListener("mousemove", (e) => {
        if (plotPanelIsDragging) {
            drag(e.clientX, e.clientY);
        }
    });

    document.addEventListener("mouseup", () => {
        stopDrag();
    });

    // 触摸事件支持
    header.addEventListener(
        "touchstart",
        (e) => {
            if (e.target.closest("button")) return;
            e.preventDefault();
            const touch = e.touches[0];
            startDrag(touch.clientX, touch.clientY);
        },
        { passive: false },
    );

    document.addEventListener(
        "touchmove",
        (e) => {
            if (plotPanelIsDragging) {
                e.preventDefault();
                const touch = e.touches[0];
                drag(touch.clientX, touch.clientY);
            }
        },
        { passive: false },
    );

    document.addEventListener("touchend", () => {
        stopDrag();
    });

    Logger.log("[剧情优化] 拖动功能已初始化完成");
}

/**
 * 初始化剧情优化面板
 */
export function initPlotOptimizePanel() {
    bindPlotOptimizePanelEvents();
    Logger.debug("[剧情优化] 面板已初始化");
}

// 兼容旧代码的函数别名
export function showPlotOptimizeModal() {
    showPlotOptimizePanel();
}

export function hidePlotOptimizeModal() {
    hidePlotOptimizePanel();
}

/**
 * 从选中的世界书获取关键词
 */
export function extractKeywordsFromSelectedBooks() {
    const keywords = [];
    for (const [bookName, uids] of Object.entries(plotPanelSelectedEntries)) {
        for (const uid of uids) {
            keywords.push(`${bookName}:${uid}`);
        }
    }
    return keywords.join(", ");
}

/**
 * 从选中的世界书获取记忆内容
 */
export async function getMemoryContentFromSelectedBooks() {
    const contents = [];

    for (const bookName of plotPanelSelectedBooks) {
        try {
            const entries = await getWorldBookEntries(bookName);
            const selectedUids = plotPanelSelectedEntries[bookName] || [];

            // 如果选中了世界书但没有选择具体条目，则获取所有条目
            const targetEntries =
                selectedUids.length > 0
                    ? entries.filter((e) =>
                          selectedUids.includes(e.uid?.toString()),
                      )
                    : entries;

            if (targetEntries.length > 0) {
                let bookContent = `【世界书: ${bookName}】\n`;
                for (const entry of targetEntries) {
                    const name = entry.comment || entry.key?.[0] || "未命名";
                    bookContent += `[${name}]\n${entry.content || ""}\n\n`;
                }
                contents.push(bookContent);
            }
        } catch (error) {
            Logger.warn(`获取世界书 "${bookName}" 内容失败:`, error);
        }
    }

    return contents.join("\n");
}

/**
 * 获取角色描述
 */
export function getCharacterDescription() {
    try {
        if (typeof SillyTavern !== "undefined" && SillyTavern.getContext) {
            const { characters } = SillyTavern.getContext();
            if (characters && characters.length > 0) {
                const char = characters[0];
                return `名称: ${char.name || "未知"}\n描述: ${
                    char.description || "无"
                }`;
            }
        }
    } catch (error) {
        Logger.warn("获取角色描述失败:", error);
    }
    return "角色信息不可用";
}

/**
 * 获取默认模型
 */
export function getDefaultModel() {
    const globalConfig = getGlobalConfig();
    return globalConfig.openaiModel || "gpt-4";
}

/**
 * HTML 转义
 */
export function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, "<br>");
}
