/**
 * 流程配置弹窗模块
 * @module ui/modals/flow-config
 */

import Logger from '@core/logger';
import { detectExtensionPath, getExtensionPath } from '@core/constants';
import { getGlobalSettings, updateGlobalSettings } from '@config/config-manager';

// 默认来源配置（从配置文件动态加载）
let DEFAULT_FLOW_CONFIG = null;

// 流程配置缓存键（存储在 global settings 中）
const FLOW_CONFIG_CACHE_KEY = '__cachedDefaultFlowConfig__';

// 来源标签映射
export const SOURCE_LABELS = {
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
    plot_history: "[剧情优化] 历史对话记录",
    plot_input: "[剧情优化] 面板用户输入 <最新用户消息>",
};

// 流程类型与调用功能的映射说明（用于UI悬停提示）
const FLOW_TYPE_DESCRIPTIONS = {
    "记忆世界书": "调用功能：记忆世界书处理",
    "总结世界书": "调用功能：总结世界书处理、记忆搜索助手",
    "索引合并": "调用功能：索引合并处理",
    "剧情优化": "调用功能：剧情优化助手",
};

/**
 * 从配置文件加载流程配置
 * @param {boolean} forceReload - 是否强制重新加载（从服务器重新加载）
 * @returns {Promise<Object>} 流程配置对象
 */
export async function loadFlowConfigFromFile(forceReload = false) {
    // 如果不是强制重新加载，并且已有内存缓存，直接返回
    if (!forceReload && DEFAULT_FLOW_CONFIG !== null) {
        return DEFAULT_FLOW_CONFIG;
    }

    const settings = getGlobalSettings();
    const cachedConfig = settings[FLOW_CONFIG_CACHE_KEY];

    // 1. 优先使用持久化缓存（非强制刷新时）
    if (!forceReload && cachedConfig && Object.keys(cachedConfig).length > 0) {
        DEFAULT_FLOW_CONFIG = cachedConfig;
        Logger.debug("[流程配置] 使用持久化缓存", cachedConfig);
        return cachedConfig;
    }

    // 2. 持久化缓存不存在，从服务器获取
    try {
        await detectExtensionPath();
        const basePath = getExtensionPath();
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

            // 更新内存缓存
            DEFAULT_FLOW_CONFIG = flowConfig;

            // 3. 服务器获取成功，保存到持久化缓存
            try {
                updateGlobalSettings({ [FLOW_CONFIG_CACHE_KEY]: flowConfig });
                Logger.debug("[流程配置] 已保存到持久化缓存", flowConfig);
            } catch (cacheError) {
                Logger.warn("[流程配置] 保存持久化缓存失败:", cacheError);
            }

            return flowConfig;
        } else {
            Logger.warn("[流程配置] 配置文件不存在或无法访问");
        }
    } catch (error) {
        Logger.warn("[流程配置] 从服务器获取失败:", error);
    }

    // 4. 服务器获取失败，尝试使用持久化缓存（即使是强制刷新模式）
    if (cachedConfig && Object.keys(cachedConfig).length > 0) {
        DEFAULT_FLOW_CONFIG = cachedConfig;
        Logger.warn("[流程配置] 服务器获取失败，使用持久化缓存");
        return cachedConfig;
    }

    // 5. 没有任何缓存，使用空配置
    const fallbackConfig = {};
    DEFAULT_FLOW_CONFIG = fallbackConfig;
    Logger.debug("[流程配置] 无持久化缓存，使用空配置");
    return fallbackConfig;
}

/**
 * 获取默认流程配置
 * @returns {Object|null} 默认流程配置
 */
export function getDefaultFlowConfig() {
    return DEFAULT_FLOW_CONFIG;
}

/**
 * 基于流程配置构建 promptParts
 * @param {string} flowType - 流程类型（记忆世界书、总结世界书、索引合并、剧情优化）
 * @param {Object} sourceContents - 各个来源的内容对象，key 为 source，value 为 content
 * @returns {Promise<Array>} - 按照流程配置顺序排列的 promptParts
 */
export async function buildPromptPartsByFlowConfig(flowType, sourceContents) {
    const settings = getGlobalSettings();
    const savedOrder = settings.promptPartsOrder || {};
    const defaultConfig = await loadFlowConfigFromFile();
    const sourceOrder = savedOrder[flowType] || defaultConfig[flowType];

    if (!sourceOrder || !Array.isArray(sourceOrder)) {
        Logger.warn(
            `[流程配置] 未找到 "${flowType}" 的流程配置，使用默认顺序`,
        );
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

    return promptParts;
}

/**
 * 显示流程配置弹窗
 */
export async function showFlowConfigModal() {
    const modal = document.getElementById("mm-flow-config-modal");
    if (modal) {
        modal.classList.add("mm-modal-visible");
        await renderFlowConfigList();
    }
}

/**
 * 隐藏流程配置弹窗
 */
export function hideFlowConfigModal() {
    const modal = document.getElementById("mm-flow-config-modal");
    if (modal) {
        modal.classList.remove("mm-modal-visible");
    }
}

/**
 * 渲染流程配置列表
 * @param {Object|null} savedOrder - 保存的排序配置，如果为null则从配置中获取
 */
export async function renderFlowConfigList(savedOrder = null) {
    const container = document.getElementById("mm-flow-config-list");
    const emptyState = document.getElementById("mm-flow-config-empty");
    if (!container) return;

    // 如果没有传入savedOrder，从配置中获取
    if (!savedOrder) {
        const settings = getGlobalSettings();
        savedOrder = settings.promptPartsOrder || {};
    }
    const defaultConfig = await loadFlowConfigFromFile();

    container.innerHTML = "";
    container.style.display = "block";
    if (emptyState) emptyState.style.display = "none";

    // 遍历所有功能分组
    Object.keys(defaultConfig).forEach((category) => {
        const defaultSources = defaultConfig[category];
        // 使用保存的顺序，如果没有则使用默认顺序
        let sources = savedOrder[category] || [...defaultSources];

        // 确保所有默认来源都包含在sources中，同时保留用户自定义的顺序
        // 检查是否有保存的用户配置
        if (savedOrder[category] && savedOrder[category].length > 0) {
            // 使用保存的用户配置
            sources = [...savedOrder[category]];

            // 检查是否有缺失的来源
            const missingSources = defaultSources.filter(
                (source) => !sources.includes(source),
            );

            if (missingSources.length > 0) {
                Logger.log(
                    `[流程配置] 为 ${category} 发现缺失的来源: ${missingSources.join(
                        ", ",
                    )}`,
                );

                // 将缺失的来源插入到它们在默认配置中的相对位置
                for (const missingSource of missingSources) {
                    // 找到缺失来源在默认配置中的位置
                    const defaultIndex =
                        defaultSources.indexOf(missingSource);

                    // 在用户配置中找到合适的插入位置：
                    // 插入到所有在默认配置中排在它前面的来源之后
                    let insertIndex = sources.length;

                    // 遍历默认配置中排在missingSource前面的所有来源
                    for (let i = defaultIndex - 1; i >= 0; i--) {
                        const prevSource = defaultSources[i];
                        const prevSourceIndex = sources.indexOf(prevSource);

                        if (prevSourceIndex >= 0) {
                            // 找到了一个在missingSource前面的来源，插入到它后面
                            insertIndex = prevSourceIndex + 1;
                            break;
                        }
                    }

                    // 插入缺失的来源
                    sources.splice(insertIndex, 0, missingSource);
                    Logger.log(
                        `[流程配置] 为 ${category} 在位置 ${insertIndex} 添加了缺失的来源: ${missingSource}`,
                    );
                }
            }
        } else {
            // 没有保存的用户配置，使用默认配置
            sources = [...defaultSources];
        }

        const card = document.createElement("div");
        card.className = "mm-collapse-card"; // 默认折叠，不添加 expanded
        card.dataset.category = category;

        // 过滤掉jailbreak来源块，不在界面上显示（但仍然保留在配置中）
        const visibleSources = sources.filter(
            (source) => source !== "jailbreak",
        );

        // 获取流程类型的悬停提示说明
        const flowTypeDescription = FLOW_TYPE_DESCRIPTIONS[category] || "";

        card.innerHTML = `
        <div class="mm-collapse-header mm-flow-group-header">
          <div class="mm-collapse-title">
            <i class="fa-solid fa-folder"></i>
            <span title="${flowTypeDescription.replace(/"/g, '&quot;')}">${category}</span>
            <i class="fa-solid fa-circle-question mm-flow-hint-icon" title="${flowTypeDescription.replace(/"/g, '&quot;')}" style="margin-left: 6px; font-size: 12px; opacity: 0.6; cursor: help;"></i>
            <span class="mm-collapse-badge">${visibleSources.length} 项</span>
          </div>
          <i class="fa-solid fa-chevron-down mm-collapse-arrow"></i>
        </div>
        <div class="mm-collapse-body">
          <div class="mm-flow-source-list" data-category="${category}">
            ${visibleSources
                .map(
                    (source) => `
              <div class="mm-flow-source-item" draggable="true" data-source="${source}">
                <i class="fa-solid fa-grip-vertical mm-drag-handle"></i>
                <span class="mm-flow-source-name">${
                    SOURCE_LABELS[source] || source
                }</span>
              </div>
            `,
                )
                .join("")}
          </div>
        </div>
      `;

        const header = card.querySelector(".mm-collapse-header");
        header.addEventListener("click", () => {
            card.classList.toggle("expanded");
            const arrow = card.querySelector(".mm-collapse-arrow");
            if (arrow) {
                arrow.classList.toggle(
                    "fa-chevron-up",
                    card.classList.contains("expanded"),
                );
                arrow.classList.toggle(
                    "fa-chevron-down",
                    !card.classList.contains("expanded"),
                );
            }
        });

        container.appendChild(card);
        initFlowSourceDrag(card.querySelector(".mm-flow-source-list"));
    });
}

/**
 * 初始化流程来源拖拽功能
 * @param {HTMLElement} listContainer - 列表容器元素
 */
function initFlowSourceDrag(listContainer) {
    if (!listContainer) return;
    let draggedItem = null;

    listContainer
        .querySelectorAll(".mm-flow-source-item")
        .forEach((item) => {
            item.addEventListener("dragstart", (e) => {
                draggedItem = item;
                item.classList.add("mm-dragging");
                e.dataTransfer.effectAllowed = "move";
            });

            item.addEventListener("dragend", () => {
                item.classList.remove("mm-dragging");
                draggedItem = null;
                listContainer
                    .querySelectorAll(".mm-flow-source-item")
                    .forEach((i) => {
                        i.classList.remove(
                            "mm-drag-over-top",
                            "mm-drag-over-bottom",
                        );
                    });
                // 拖拽结束后自动保存
                autoSaveFlowConfig();
            });

            item.addEventListener("dragover", (e) => {
                e.preventDefault();
                if (!draggedItem || draggedItem === item) return;
                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                item.classList.remove(
                    "mm-drag-over-top",
                    "mm-drag-over-bottom",
                );
                item.classList.add(
                    e.clientY < midY
                        ? "mm-drag-over-top"
                        : "mm-drag-over-bottom",
                );
            });

            item.addEventListener("dragleave", () => {
                item.classList.remove(
                    "mm-drag-over-top",
                    "mm-drag-over-bottom",
                );
            });

            item.addEventListener("drop", (e) => {
                e.preventDefault();
                if (!draggedItem || draggedItem === item) return;
                const rect = item.getBoundingClientRect();
                if (e.clientY < rect.top + rect.height / 2) {
                    listContainer.insertBefore(draggedItem, item);
                } else {
                    listContainer.insertBefore(
                        draggedItem,
                        item.nextSibling,
                    );
                }
                item.classList.remove(
                    "mm-drag-over-top",
                    "mm-drag-over-bottom",
                );
            });
        });
}

/**
 * 自动保存流程配置（静默保存，不关闭弹窗）
 */
export function autoSaveFlowConfig() {
    const container = document.getElementById("mm-flow-config-list");
    if (!container) return;

    const newOrder = {};
    container.querySelectorAll(".mm-flow-source-list").forEach((list) => {
        const category = list.dataset.category;
        const sources = [];

        // 1. 始终将jailbreak放在最顶部（即使在界面上隐藏）
        sources.push("jailbreak");

        // 2. 添加界面上可见的其他来源
        list.querySelectorAll(".mm-flow-source-item").forEach((item) => {
            sources.push(item.dataset.source);
        });

        if (sources.length > 0) {
            newOrder[category] = sources;
        }
    });

    const settings = getGlobalSettings();
    settings.promptPartsOrder = newOrder;
    updateGlobalSettings(settings);

    Logger.debug("[流程配置] 已自动保存来源排序配置");
}

/**
 * 保存流程配置（带视觉反馈）
 */
export function saveFlowConfig() {
    const container = document.getElementById("mm-flow-config-list");
    if (!container) return;

    const newOrder = {};
    container.querySelectorAll(".mm-flow-source-list").forEach((list) => {
        const category = list.dataset.category;
        const sources = [];

        // 1. 始终将jailbreak放在最顶部（即使在界面上隐藏）
        sources.push("jailbreak");

        // 2. 添加界面上可见的其他来源
        list.querySelectorAll(".mm-flow-source-item").forEach((item) => {
            sources.push(item.dataset.source);
        });

        if (sources.length > 0) {
            newOrder[category] = sources;
        }
    });

    const settings = getGlobalSettings();
    settings.promptPartsOrder = newOrder;
    updateGlobalSettings(settings);

    Logger.log("[流程配置] 已保存来源排序配置", newOrder);

    // 视觉反馈：显示保存成功提示
    const saveBtn = document.getElementById("mm-flow-config-save");
    if (saveBtn) {
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> 已保存';
        saveBtn.disabled = true;
        setTimeout(() => {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }, 2000);
    }
}

/**
 * 重置流程配置
 */
export async function resetFlowConfig() {
    if (
        !confirm(
            "确定要恢复默认流程配置吗？这将使用配置文件的最新配置覆盖当前的自定义排序。",
        )
    )
        return;

    try {
        // 强制从配置文件重新加载最新的默认配置
        const promptPartsOrder = await loadFlowConfigFromFile(true);

        const settings = getGlobalSettings();
        // 只更新流程配置，保留其他用户设置
        settings.promptPartsOrder = promptPartsOrder;
        // 保存到本地存储
        updateGlobalSettings(settings);

        Logger.log(
            "[流程配置] 已从配置文件恢复默认流程配置",
            promptPartsOrder,
        );

        await renderFlowConfigList();
    } catch (error) {
        Logger.error("[流程配置] 恢复默认配置失败:", error);

        // 出错时清空用户配置，让系统下次使用默认配置
        const settings = getGlobalSettings();
        // 只更新流程配置，保留其他用户设置
        settings.promptPartsOrder = {};
        // 保存到本地存储
        updateGlobalSettings(settings);

        Logger.log("[流程配置] 已恢复默认流程配置");
        await renderFlowConfigList();
    }
}

/**
 * 导入流程配置
 */
export async function importFlowConfig() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const config = JSON.parse(text);

            // 验证配置格式
            if (!config.configs || typeof config.configs !== "object") {
                throw new Error("配置文件格式错误：缺少 configs 字段");
            }

            // 转换为 promptPartsOrder 格式
            const promptPartsOrder = {};
            for (const [key, value] of Object.entries(config.configs)) {
                if (value.sources && Array.isArray(value.sources)) {
                    promptPartsOrder[key] = value.sources;
                }
            }

            // 保存配置
            const settings = getGlobalSettings();
            settings.promptPartsOrder = promptPartsOrder;
            updateGlobalSettings(settings);

            Logger.log("[流程配置] 已导入配置", promptPartsOrder);
            await renderFlowConfigList();
            alert("流程配置导入成功！");
        } catch (error) {
            Logger.error("[流程配置] 导入失败:", error);
            alert(`导入失败: ${error.message}`);
        }
    };

    input.click();
}

/**
 * 导出流程配置
 */
export function exportFlowConfig() {
    const settings = getGlobalSettings();
    const promptPartsOrder = settings.promptPartsOrder || {};

    // 转换为配置文件格式
    const config = {
        version: 1,
        name: "自定义流程配置",
        description: "用户自定义的流程配置",
        configs: {},
    };

    // 将 promptPartsOrder 转换为配置格式
    for (const [key, sources] of Object.entries(promptPartsOrder)) {
        config.configs[key] = {
            description: `${key}功能的来源顺序配置`,
            sources: sources,
        };
    }

    // 如果没有自定义配置，使用默认配置
    if (Object.keys(config.configs).length === 0) {
        for (const [key, sources] of Object.entries(DEFAULT_FLOW_CONFIG || {})) {
            config.configs[key] = {
                description: `${key}功能的来源顺序配置`,
                sources: sources,
            };
        }
    }

    // 生成文件名
    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, -5);
    const filename = `flow-config-${timestamp}.json`;

    // 下载文件
    const blob = new Blob([JSON.stringify(config, null, 2)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    Logger.log("[流程配置] 已导出配置", config);
}

/**
 * 初始化流程配置弹窗拖拽缩放功能
 */
export function initFlowConfigResize() {
    const modal = document.getElementById("mm-flow-config-modal");
    const resizeHandle = document.getElementById("mm-flow-config-resize");

    if (!modal || !resizeHandle) return;

    const modalContent = modal.querySelector(
        ".mm-flow-config-modal-content",
    );

    if (!modalContent) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    function handleResizeStart(e) {
        isResizing = true;
        // 支持触摸事件
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        // 获取当前计算后的高度
        startHeight = modalContent.getBoundingClientRect().height;
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
    }

    function handleResizeMove(e) {
        if (!isResizing) return;
        // 支持触摸事件
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const deltaY = clientY - startY;
        const newHeight = Math.max(
            300,
            Math.min(startHeight + deltaY, window.innerHeight * 0.9),
        );
        modalContent.style.height = `${newHeight}px`;
        e.preventDefault();
    }

    function handleResizeEnd() {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        }
    }

    // 鼠标事件
    resizeHandle.addEventListener("mousedown", handleResizeStart);
    document.addEventListener("mousemove", handleResizeMove);
    document.addEventListener("mouseup", handleResizeEnd);

    // 触摸事件
    resizeHandle.addEventListener("touchstart", handleResizeStart, {
        passive: false,
    });
    document.addEventListener("touchmove", handleResizeMove, {
        passive: false,
    });
    document.addEventListener("touchend", handleResizeEnd);
}

/**
 * 绑定流程配置弹窗事件
 */
export function bindFlowConfigEvents() {
    // 保存按钮
    document.getElementById("mm-flow-config-save")
        ?.addEventListener("click", saveFlowConfig);

    // 重置按钮
    document.getElementById("mm-flow-config-reset")
        ?.addEventListener("click", resetFlowConfig);

    // 导入按钮
    document.getElementById("mm-flow-config-import")
        ?.addEventListener("click", importFlowConfig);

    // 导出按钮
    document.getElementById("mm-flow-config-export")
        ?.addEventListener("click", exportFlowConfig);

    // 关闭按钮
    document.getElementById("mm-flow-config-close")
        ?.addEventListener("click", hideFlowConfigModal);

    // 初始化拖拽缩放
    initFlowConfigResize();
}
