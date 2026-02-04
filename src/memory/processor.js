/**
 * 记忆处理核心模块
 * @module memory/processor
 */

import APIAdapter from "@api/adapter";
import {
    getGlobalConfig,
    getGlobalSettings,
    getMemoryConfig,
    getSummaryConfig,
    isPluginEnabled,
    getEnabledProviders,
} from "@config/config-manager";
import Logger from "@core/logger";
import { getContext } from "@core/sillytavern-api";
import { getProgressTracker } from "@ui/components/progress-tracker";
import { getMessageProgressPanel } from "@ui/components/message-progress";
import { setFloatBallProcessing } from "@ui/float-ball";
import { setMenuButtonProcessing } from "@ui/menu-button";
import { showRequestPreview } from "@ui/modals/request-preview";
import { showSummaryCheckModal } from "@ui/modals/summary-check";
import { showMultiAISelectionModal } from "@ui/modals/multi-ai-selection";
import { buildMessagesFromPreset, getPromptPresetById } from "@ui/modals/prompt-preset";
import { isPlotOptimizeEnabled, buildPlotOptimizePreview } from "@ui/components/plot-optimize";
import { filterContentByRole, getRecentContext } from "@utils";
import {
    getPromptTemplate as loadPromptTemplateFromFile,
    getHistoricalPromptTemplate as loadHistoricalPromptTemplateFromFile,
} from "@utils/prompt-template";
import { classifyWorldBooks, getImportedWorldBooks } from "@worldbook/api";
import { formatAsWorldBook, getSummaryContent } from "@worldbook/parser";
import { refreshWorldBookList } from "@worldbook/refresh";
import { getJailbreakPrefix } from "./jailbreak";
import {
    buildDataInjection,
    buildUserPrompt,
    injectDataToPrompt,
    replacePromptVariables,
} from "./prompt-builder";
import { mergeResults } from "./result-merger";
import { collectAllRequestInfos } from "./request-collector";

// 创建模块专用日志记录器
const log = Logger.createModuleLogger("记忆处理");

// 模块级变量
let abortController = null;

// 搜索面板和剧情优化面板的引用（通过注入设置）
let memorySearchPanelGetter = null;
let performMemorySearchFn = null;
let startPlotOptimizeSessionFn = null;
let updatePlotPanelOtherTasksStatusFn = null;

/**
 * 设置记忆搜索面板获取函数
 * @param {Function} getter
 */
export function setMemorySearchPanelGetter(getter) {
    memorySearchPanelGetter = getter;
}

/**
 * 设置执行记忆搜索函数
 * @param {Function} fn
 */
export function setPerformMemorySearchFn(fn) {
    performMemorySearchFn = fn;
}

/**
 * 设置剧情优化会话启动函数
 * @param {Function} fn
 */
export function setStartPlotOptimizeSessionFn(fn) {
    startPlotOptimizeSessionFn = fn;
}

/**
 * 设置更新剧情优化面板其他任务状态函数
 * @param {Function} fn
 */
export function setUpdatePlotPanelOtherTasksStatusFn(fn) {
    updatePlotPanelOtherTasksStatusFn = fn;
}

/**
 * 获取当前聊天上下文
 * @returns {Array} 聊天记录数组
 */
export function getCurrentChatContext() {
    try {
        const context = getContext();
        if (context && context.chat) {
            return context.chat;
        }
        return [];
    } catch (e) {
        log.error("获取聊天上下文失败:", e);
        return [];
    }
}

/**
 * 获取提示词模板
 * @returns {Promise<object>} 提示词模板
 */
export async function getPromptTemplate() {
    try {
        // 尝试从文件加载提示词模板
        const template = await loadPromptTemplateFromFile();
        if (template) {
            return template;
        }
    } catch (error) {
        log.warn("从文件加载提示词模板失败，使用默认模板:", error);
    }

    // 尝试从配置中获取自定义模板
    const globalSettings = getGlobalSettings();
    if (globalSettings.customPromptTemplate) {
        return globalSettings.customPromptTemplate;
    }

    // 返回默认模板
    return {
        mainPrompt: `你是一个记忆检索助手。根据提供的世界书内容和用户消息，提取相关的历史事件回忆。

<数据注入区>

请根据以上信息，提取与用户消息相关的历史事件回忆。`,
        systemPrompt: `输出格式要求：
- 只输出相关的历史事件回忆
- 使用简洁的语言
- 按相关性排序`,
    };
}

/**
 * 获取历史事件回忆提示词模板（总结世界书专用）
 * @returns {Promise<object>} 提示词模板
 */
export async function getHistoricalPromptTemplate() {
    try {
        // 尝试从文件加载历史事件提示词模板
        const template = await loadHistoricalPromptTemplateFromFile();
        if (template) {
            return template;
        }
    } catch (error) {
        log.warn("从文件加载历史事件提示词模板失败，使用默认模板:", error);
    }

    // 尝试从配置中获取自定义模板
    const globalSettings = getGlobalSettings();
    if (globalSettings.historicalPromptTemplate) {
        return globalSettings.historicalPromptTemplate;
    }

    return {
        mainPrompt: `你是一个历史事件回忆助手。根据提供的总结内容和用户消息，提取相关的历史事件。

<数据注入区>

请根据以上信息，提取与用户消息相关的历史事件。`,
        systemPrompt: `输出格式要求：
- 只输出相关的历史事件
- 使用简洁的语言
- 按时间顺序排列`,
    };
}

/**
 * 处理单个分类
 * @param {string} category 分类名称
 * @param {object} data 分类数据 { index: [], details: [] }
 * @param {string} userMessage 用户消息
 * @param {string} context 上下文
 * @param {AbortSignal} signal 中止信号
 * @returns {Promise<object|null>} 处理结果
 */
export async function processCategory(
    category,
    data,
    userMessage,
    context,
    signal,
) {
    const progressTracker = getProgressTracker();
    const taskId = `memory_${category}`;

    try {
        progressTracker?.startTask(taskId);

        const aiConfig = getMemoryConfig(category);
        const globalConfig = getGlobalConfig();

        // 构建数据注入
        const dataInjection = buildDataInjection({
            worldBookContent: formatAsWorldBook(data.index, data.details),
            context: context,
            userMessage: userMessage,
        });

        // 获取提示词模板
        const template = await getPromptTemplate();
        const prompt = injectDataToPrompt(template, dataInjection);

        // 替换变量
        const baseSystemPrompt = replacePromptVariables(
            prompt.systemPrompt,
            aiConfig,
            globalConfig,
        );

        // 添加破限词前缀
        const finalSystemPrompt =
            getJailbreakPrefix() + "\n\n" + baseSystemPrompt;

        // 构建用户提示词
        const finalUserMessage = buildUserPrompt(userMessage);

        // 调用 API（添加 taskId 以支持流式进度更新）
        const response = await APIAdapter.call(
            { ...aiConfig, taskId },
            finalSystemPrompt,
            finalUserMessage,
            signal,
        );

        progressTracker?.completeTask(taskId, true);

        return {
            source: category,
            category: category,
            type: "memory",
            rawMemory: response,
            detailKeys: data.details
                ? data.details.map((d) => d.keys?.[0]).filter(Boolean)
                : [],
        };
    } catch (error) {
        if (error.name === "AbortError") {
            progressTracker?.completeTask(taskId, false, "已取消");
            throw error;
        }
        log.error(`处理分类 "${category}" 失败:`, error);
        progressTracker?.completeTask(taskId, false, error.message);
        return null;
    }
}

/**
 * 处理总结世界书
 * @param {object} book 世界书对象
 * @param {string} userMessage 用户消息
 * @param {string} context 上下文
 * @param {AbortSignal} signal 中止信号
 * @returns {Promise<object|null>} 处理结果
 */
export async function processSummaryBook(book, userMessage, context, signal) {
    const progressTracker = getProgressTracker();
    const taskId = `summary_${book.name}`;

    try {
        progressTracker?.startTask(taskId);

        const aiConfig = getSummaryConfig(book.name);
        const globalConfig = getGlobalConfig();

        // 获取总结内容
        const summaryContent = getSummaryContent(book);

        // 构建数据注入
        const dataInjection = buildDataInjection({
            worldBookContent: summaryContent,
            context: context,
            userMessage: userMessage,
        });

        // 使用历史事件回忆提示词模板
        const template = await getHistoricalPromptTemplate();
        const prompt = injectDataToPrompt(template, dataInjection);

        // 替换变量
        const baseSystemPrompt = replacePromptVariables(
            prompt.systemPrompt,
            aiConfig,
            globalConfig,
        );

        // 添加破限词前缀
        const finalSystemPrompt =
            getJailbreakPrefix() + "\n\n" + baseSystemPrompt;

        // 构建用户提示词
        const finalUserMessage = buildUserPrompt(userMessage);

        // 调用 API（添加 taskId 以支持流式进度更新）
        const response = await APIAdapter.call(
            { ...aiConfig, taskId },
            finalSystemPrompt,
            finalUserMessage,
            signal,
        );

        progressTracker?.completeTask(taskId, true);

        return {
            source: book.name,
            category: book.name,
            type: "summary",
            rawMemory: response,
            bookName: book.name,
        };
    } catch (error) {
        if (error.name === "AbortError") {
            progressTracker?.completeTask(taskId, false, "已取消");
            throw error;
        }
        log.error(`处理总结世界书 "${book.name}" 失败:`, error);
        progressTracker?.completeTask(taskId, false, error.message);
        return null;
    }
}

/**
 * 收集所有分类的索引内容（用于索引合并模式）
 * @param {Array} memoryBooks 记忆世界书数组
 * @returns {object} { content: string, categories: string[], detailKeys: string[] }
 */
export function collectAllCategoryIndex(memoryBooks) {
    let content = "";
    const categories = [];
    const detailKeys = [];

    for (const { book, categories: bookCategories } of memoryBooks) {
        for (const [category, data] of Object.entries(bookCategories)) {
            if (data.index && data.index.length > 0) {
                categories.push(category);
                content += `=== ${category} Index ===\n`;
                for (const entry of data.index) {
                    content += `[${entry.comment}]\n${entry.content}\n\n`;
                }

                // 收集详情关键词
                if (data.details) {
                    for (const detail of data.details) {
                        if (detail.keys && detail.keys.length > 0) {
                            detailKeys.push(detail.keys[0]);
                        }
                    }
                }
            }
        }
    }

    return { content, categories, detailKeys };
}

/**
 * 处理索引合并
 * @param {string} mergedContent 合并后的索引内容
 * @param {string} userMessage 用户消息
 * @param {string} context 上下文
 * @param {AbortSignal} signal 中止信号
 * @param {object} config 索引合并配置
 * @param {Array} detailKeys 详情关键词数组
 * @returns {Promise<object|null>} 处理结果
 */
export async function processIndexMerge(
    mergedContent,
    userMessage,
    context,
    signal,
    config,
    detailKeys,
) {
    const progressTracker = getProgressTracker();
    const taskId = "index_merge";

    try {
        progressTracker?.startTask(taskId);

        const globalConfig = getGlobalConfig();

        // 构建数据注入
        const dataInjection = buildDataInjection({
            worldBookContent: mergedContent,
            context: context,
            userMessage: userMessage,
        });

        // 获取提示词模板
        const template = await getPromptTemplate();
        const prompt = injectDataToPrompt(template, dataInjection);

        // 替换变量
        const baseSystemPrompt = replacePromptVariables(
            prompt.systemPrompt,
            config,
            globalConfig,
        );

        // 添加破限词前缀
        const finalSystemPrompt =
            getJailbreakPrefix() + "\n\n" + baseSystemPrompt;

        // 构建用户提示词
        const finalUserMessage = buildUserPrompt(userMessage);

        // 调用 API（添加 taskId 以支持流式进度更新）
        const response = await APIAdapter.call(
            { ...config, taskId },
            finalSystemPrompt,
            finalUserMessage,
            signal,
        );

        progressTracker?.completeTask(taskId, true);

        return {
            source: "索引合并",
            category: "索引合并",
            type: "merge",
            rawMemory: response,
            detailKeys: detailKeys,
        };
    } catch (error) {
        if (error.name === "AbortError") {
            progressTracker?.completeTask(taskId, false, "已取消");
            throw error;
        }
        log.error("处理索引合并失败:", error);
        progressTracker?.completeTask(taskId, false, error.message);
        return null;
    }
}

/**
 * 核心处理函数 - 处理记忆并返回结果
 * @param {string} userMessage 用户消息
 * @returns {Promise<string|object|null>} 处理结果
 */
export async function processMemoryForMessage(userMessage) {
    console.warn("[记忆处理-调试] ===== processMemoryForMessage 函数被调用 =====");
    log.groupCollapsed("处理记忆请求");
    log.log("开始处理记忆...");

    if (!isPluginEnabled()) {
        log.log("插件未启用，跳过处理");
        console.warn("[记忆处理-调试] 插件未启用，跳过");
        log.groupEnd();
        return null;
    }
    console.warn("[记忆处理-调试] 检查点1: 插件已启用");

    // 发送前先刷新世界书列表，确保数据是最新的
    await refreshWorldBookList();
    console.warn("[记忆处理-调试] 检查点2: 世界书列表已刷新");

    const startTime = Date.now();
    setMenuButtonProcessing(true);
    setFloatBallProcessing(true);

    // 创建 AbortController
    abortController = new AbortController();
    const signal = abortController.signal;

    // 获取进度追踪器
    const progressTracker = getProgressTracker();

    try {
        const worldBooks = await getImportedWorldBooks();
        console.warn("[记忆处理-调试] 检查点3: 世界书数量 =", worldBooks.length);

        if (worldBooks.length === 0) {
            log.warn("未导入任何世界书，跳过处理");
            console.warn("[记忆处理-调试] 没有世界书，跳过处理");
            log.groupEnd();
            return null;
        }

        const { memoryBooks, summaryBooks, unknownBooks } =
            classifyWorldBooks(worldBooks);
        console.warn("[记忆处理-调试] 检查点4: 记忆书=", memoryBooks.length, "总结书=", summaryBooks.length);

        log.debug(
            `世界书分类结果: 记忆世界书 ${memoryBooks.length} 个, 总结世界书 ${summaryBooks.length} 个, 未识别 ${unknownBooks.length} 个`,
        );

        if (unknownBooks.length > 0) {
            log.warn(`有 ${unknownBooks.length} 个未识别的世界书被跳过`);
        }

        // 获取当前聊天历史作为上下文
        const chat = getCurrentChatContext();
        const globalConfig = getGlobalConfig();
        const globalSettings = getGlobalSettings();
        const contextRounds = globalConfig.contextRounds ?? 5;
        // [标签过滤调用点1] getRecentContext 内部会应用标签过滤（见 src/utils/message.js）
        const context = getRecentContext(chat, contextRounds);

        // 获取标签过滤配置（用于最近剧情截取）
        // [标签过滤调用点2] 用于处理最后一条助手消息的末尾
        const tagFilterConfig = globalConfig.contextTagFilter;

        // 从最后一条助手消息中截取末尾（使用配置的字数，默认200）
        const recentPlotLength = globalSettings.recentPlotLength ?? 200;
        let latestContext = "";
        if (
            globalSettings.enableRecentPlot !== false &&
            chat &&
            chat.length > 0
        ) {
            let lastAssistantMsg = null;
            for (let i = chat.length - 1; i >= 0; i--) {
                const msg = chat[i];
                const isUser = msg.is_user || msg.role === "user";
                if (!isUser) {
                    lastAssistantMsg = msg;
                    break;
                }
            }

            if (lastAssistantMsg) {
                let content =
                    lastAssistantMsg.content || lastAssistantMsg.mes || "";

                // 使用 filterContentByRole 处理标签过滤（AI消息 = false）
                content = filterContentByRole(content, tagFilterConfig, false);

                latestContext = content.slice(-recentPlotLength).trim();
            }
        }

        // 检查是否启用索引合并模式
        const useIndexMerge =
            globalSettings.sendIndexOnly && globalSettings.indexMergeEnabled;
        console.warn("[记忆处理-调试] 检查点5: showRequestPreview =", globalSettings.showRequestPreview);

        // 收集索引数据（如果需要）
        let mergedIndexData = null;
        if (useIndexMerge) {
            mergedIndexData = collectAllCategoryIndex(memoryBooks);
        }

        // 收集请求信息并显示预览
        if (globalSettings.showRequestPreview) {
            console.warn("[记忆处理-调试] 检查点6: 进入预览流程");
            // 使用新的收集函数获取完整的请求信息
            const requestInfos = await collectAllRequestInfos(
                memoryBooks,
                summaryBooks,
                userMessage,
                context,
                useIndexMerge,
                mergedIndexData,
            );
            console.warn("[记忆处理-调试] 检查点7: requestInfos 数量 =", requestInfos.length);

            // 如果启用了剧情优化，添加剧情优化的预览信息
            if (isPlotOptimizeEnabled()) {
                console.warn("[记忆处理-调试] 检查点7a: isPlotOptimizeEnabled() = true");
                const plotConfig = globalSettings.plotOptimizeConfig || {};
                if (plotConfig.apiUrl && plotConfig.model) {
                    try {
                        // 获取聊天上下文
                        const stContext = getContext();
                        const chatContext = stContext?.chat || [];

                        log.debug("[剧情优化] 构建预览 - plotConfig:", plotConfig);
                        log.debug("[剧情优化] 构建预览 - userMessage 长度:", userMessage?.length || 0);
                        log.debug("[剧情优化] 构建预览 - chatContext 长度:", chatContext?.length || 0);
                        log.debug("[剧情优化] 构建预览 - stContext:", stContext ? "存在" : "不存在");

                        const plotPreview = await buildPlotOptimizePreview(
                            plotConfig,
                            userMessage,
                            chatContext,
                        );

                        log.debug("[剧情优化] 构建预览完成 - promptParts 数量:", plotPreview?.promptParts?.length || 0);

                        requestInfos.push(plotPreview);
                    } catch (e) {
                        log.warn("[剧情优化] 构建预览失败:", e);
                        // 即使失败也添加一个错误提示
                        requestInfos.push({
                            category: "剧情优化",
                            source: "剧情优化助手",
                            model: plotConfig.model || "未指定模型",
                            promptParts: [
                                {
                                    label: "错误信息",
                                    content: `[剧情优化预览构建失败: ${e.message}]`,
                                    source: "error",
                                },
                            ],
                            prompt: "[剧情优化预览构建失败]",
                            taskType: "plot_optimize",
                        });
                    }
                }
            }

            if (requestInfos.length > 0) {
                // 显示请求预览
                console.warn("[记忆处理-调试] 检查点8: 显示预览弹窗");
                const previewResult = await showRequestPreview(requestInfos);
                console.warn("[记忆处理-调试] 检查点9: 预览结果 =", previewResult?.confirmed);
                if (!previewResult || !previewResult.confirmed) {
                    log.warn("用户取消了API请求");
                    // 隐藏进度面板
                    const msgPanel = getMessageProgressPanel();
                    if (msgPanel) {
                        msgPanel.hide();
                    }
                    return { cancelled: true };
                }
            } else {
                log.warn("没有可预览的请求信息");
            }
        }
        console.warn("[记忆处理-调试] 检查点10: 预览流程完成，进入剧情优化检查");

        // 获取记忆搜索助手设置
        const memorySearchSettings = {
            enabled: globalSettings.enableInteractiveSearch === true,
        };

        // 检查剧情优化是否启用
        const plotOptimizeEnabled = globalSettings.enablePlotOptimize === true;
        log.log("[剧情优化] 启用状态:", plotOptimizeEnabled, "startPlotOptimizeSessionFn:", !!startPlotOptimizeSessionFn);

        // 启动记忆搜索助手面板（如果启用）
        let searchPromise = null;
        let searchPanel = null;
        if (memorySearchSettings.enabled && summaryBooks.length > 0) {
            if (performMemorySearchFn) {
                log.log("启动记忆搜索助手...");
                searchPanel = memorySearchPanelGetter ? memorySearchPanelGetter() : null;
                searchPromise = performMemorySearchFn(userMessage, {
                    targetCount: globalSettings.maxHistoryEvents || 5,
                    context: context,
                });
            } else {
                log.warn("记忆搜索函数未设置");
            }
        }

        // 启动剧情优化面板（如果启用）
        let plotPromise = null;
        if (plotOptimizeEnabled) {
            if (startPlotOptimizeSessionFn) {
                log.log("启动剧情优化助手...");
                plotPromise = startPlotOptimizeSessionFn({
                    userMessage: userMessage,
                });
            } else {
                log.warn("剧情优化会话启动函数未设置");
            }
        }

        // 收集所有任务信息用于进度追踪
        const taskInfoList = [];
        const tasks = [];
        const taskAbortControllers = new Map();

        if (useIndexMerge) {
            // 索引合并模式
            log.log("[索引合并模式] 启用，将合并所有分类的索引内容");

            // 如果还没有收集索引数据，现在收集
            if (!mergedIndexData) {
                mergedIndexData = collectAllCategoryIndex(memoryBooks);
            }

            if (mergedIndexData.content) {
                const taskId = "index_merge";
                const taskController = new AbortController();
                taskAbortControllers.set(taskId, taskController);

                const indexMergeConfig = globalSettings.indexMergeConfig || {};

                taskInfoList.push({
                    id: taskId,
                    name: "索引合并",
                    type: "merge",
                });

                tasks.push({
                    taskId,
                    fn: () =>
                        processIndexMerge(
                            mergedIndexData.content,
                            userMessage,
                            context,
                            taskController.signal,
                            indexMergeConfig,
                            mergedIndexData.detailKeys,
                        ),
                });
            }
        } else {
            // 原有并发模式
            for (const { book, categories } of memoryBooks) {
                for (const [category, data] of Object.entries(categories)) {
                    try {
                        const aiConfig = getMemoryConfig(category);
                        if (!aiConfig.enabled) {
                            log.debug(`分类 "${category}" 已禁用，跳过`);
                            continue;
                        }

                        const taskId = `memory_${category}`;
                        const taskController = new AbortController();
                        taskAbortControllers.set(taskId, taskController);

                        taskInfoList.push({
                            id: taskId,
                            name: category,
                            type: "memory",
                        });

                        tasks.push({
                            taskId,
                            fn: () =>
                                processCategory(
                                    category,
                                    data,
                                    userMessage,
                                    context,
                                    taskController.signal,
                                ),
                        });
                    } catch (e) {
                        log.warn(`分类 "${category}" 未配置，跳过`);
                    }
                }
            }
        }

        // 处理总结世界书
        for (const book of summaryBooks) {
            try {
                const aiConfig = getSummaryConfig(book.name);
                if (!aiConfig.enabled) {
                    log.debug(`总结世界书 "${book.name}" 已禁用，跳过`);
                    continue;
                }

                const taskId = `summary_${book.name}`;
                const taskController = new AbortController();
                taskAbortControllers.set(taskId, taskController);

                taskInfoList.push({
                    id: taskId,
                    name: book.name,
                    type: "summary",
                });

                tasks.push({
                    taskId,
                    fn: () =>
                        processSummaryBook(
                            book,
                            userMessage,
                            context,
                            taskController.signal,
                        ),
                });
            } catch (e) {
                log.warn(`总结世界书 "${book.name}" 未配置，跳过`);
            }
        }

        if (tasks.length === 0 && !searchPromise && !plotPromise) {
            log.log("没有可处理的任务，跳过处理");
            return null;
        }

        // 过滤掉由记忆搜索助手面板处理的任务
        const executableTasks = memorySearchSettings.enabled
            ? tasks.filter((t) => !t.taskId.startsWith("summary_"))
            : tasks;
        const totalTasks = executableTasks.length;

        // 初始化进度追踪器
        if (progressTracker && taskInfoList.length > 0) {
            // 只追踪实际执行的任务
            const executableTaskInfoList = memorySearchSettings.enabled
                ? taskInfoList.filter((t) => !t.id.startsWith("summary_"))
                : taskInfoList;

            if (executableTaskInfoList.length > 0) {
                progressTracker.init(executableTaskInfoList);

                for (const [taskId, controller] of taskAbortControllers) {
                    if (!memorySearchSettings.enabled || !taskId.startsWith("summary_")) {
                        progressTracker.setTaskAbortController(taskId, controller);
                    }
                }
            }
        }

        // 初始化进度显示（只有有任务时才显示）
        if (totalTasks > 0) {
            if (searchPanel && typeof searchPanel.updateOtherTasksStatus === 'function') {
                searchPanel.updateOtherTasksStatus(0, totalTasks, null);
            }
            if (plotOptimizeEnabled && updatePlotPanelOtherTasksStatusFn) {
                updatePlotPanelOtherTasksStatusFn(0, totalTasks, null);
            }
        }

        log.log(`开始并发处理 ${executableTasks.length} 个任务...`);

        // 并发执行任务，实时更新进度
        let completedCount = 0;
        const taskResults = [];

        const otherTasksPromise = Promise.all(
            executableTasks.map((task) =>
                task
                    .fn()
                    .catch((err) => {
                        if (err.name === "AbortError") {
                            log.warn(`任务 "${task.taskId}" 被终止`);
                        } else {
                            log.error(
                                `处理任务 "${task.taskId}" 失败:`,
                                err.message,
                            );
                        }
                        return null;
                    })
                    .then((result) => {
                        completedCount++;
                        taskResults.push(result);
                        // 实时更新进度
                        if (searchPanel && typeof searchPanel.updateOtherTasksStatus === 'function') {
                            searchPanel.updateOtherTasksStatus(
                                completedCount,
                                totalTasks,
                                completedCount >= totalTasks ? taskResults : null,
                            );
                        }
                        if (plotOptimizeEnabled && updatePlotPanelOtherTasksStatusFn) {
                            updatePlotPanelOtherTasksStatusFn(
                                completedCount,
                                totalTasks,
                                completedCount >= totalTasks ? taskResults : null,
                            );
                        }
                        return result;
                    }),
            ),
        );

        // 构建等待的 Promise 列表
        const waitPromises = [otherTasksPromise];
        if (searchPromise) {
            waitPromises.push(
                searchPromise.catch((err) => {
                    log.warn("记忆搜索助手失败:", err.message);
                    return null;
                }),
            );
        }
        if (plotPromise) {
            waitPromises.push(
                plotPromise.catch((err) => {
                    log.warn("剧情优化失败:", err.message);
                    return null;
                }),
            );
        }

        // 等待所有任务完成
        const allResults = await Promise.all(waitPromises);

        // 解析结果
        const otherTasksResults = allResults[0];
        let resultIndex = 1;
        let searchResults = null;
        let plotResult = null;

        if (searchPromise) {
            searchResults = allResults[resultIndex++];
        }
        if (plotPromise) {
            plotResult = allResults[resultIndex++];
        }

        // 合并结果
        const validResults = (otherTasksResults || []).filter((r) => r !== null);

        log.log(`完成 ${validResults.length}/${executableTasks.length} 个任务`);

        // 完成进度追踪
        if (progressTracker) {
            progressTracker.finish();
        }

        // 如果用户取消了搜索，返回取消状态
        if (searchResults && searchResults.action === "cancel") {
            log.log("[记忆搜索助手] 用户取消了搜索");
            // 隐藏进度面板
            const msgPanel = getMessageProgressPanel();
            if (msgPanel) {
                msgPanel.hide();
            }
            return { cancelled: true };
        }

        // 如果用户在剧情优化面板中选择跳过
        if (plotResult && plotResult.action === "skip") {
            log.log("用户跳过了剧情优化");
            plotResult = null;
        }

        // 如果用户选择了记忆，将所有记忆合并为一个结果
        if (searchResults && searchResults.action === "confirm") {
            const selectedMemories = searchResults.memories || [];
            if (selectedMemories.length > 0) {
                const historicalLines = [];

                for (const m of selectedMemories) {
                    const floor = m.uid || "0";
                    const content = m.content || "";
                    historicalLines.push(`【${floor}楼】${content}`);
                }

                const rawMemory = `<Historical_Occurrences>\n${historicalLines.join(
                    "\n",
                )}\n</Historical_Occurrences>`;

                const interactiveMemory = {
                    source: "记忆搜索助手",
                    category: "用户选择",
                    type: "interactive",
                    rawMemory: rawMemory,
                    detailKeys: [],
                };
                validResults.push(interactiveMemory);
                log.log(
                    `[记忆搜索助手] 用户选择了 ${selectedMemories.length} 条历史事件`,
                );
            }
        }

        // 获取剧情优化内容（如果有）
        let editorContent = "";
        if (
            plotResult &&
            plotResult.action === "confirm" &&
            plotResult.content
        ) {
            editorContent = plotResult.content;
            log.log("[剧情优化] 用户接受了剧情优化内容");
        }

        // 如果没有记忆结果也没有剧情优化内容，跳过
        if (validResults.length === 0 && !editorContent) {
            log.warn("没有可用的结果，跳过注入");
            return null;
        }

        const memory =
            validResults.length > 0
                ? mergeResults(validResults, latestContext)
                : null;

        const duration = Date.now() - startTime;
        log.log(
            `处理完成，总耗时: ${duration}ms, 成功: ${validResults.length}/${executableTasks.length}`,
        );

        // 检查是否启用了汇总检查功能（有记忆或有剧情优化内容时弹出）
        if (globalSettings.showSummaryCheck && (memory || editorContent)) {
            const checkResult = await showSummaryCheckModal(memory, editorContent);

            if (checkResult.action === "cancel") {
                log.log("用户取消了发送");
                // 隐藏进度面板
                const msgPanel = getMessageProgressPanel();
                if (msgPanel) {
                    msgPanel.hide();
                }
                return { cancelled: true };
            } else if (checkResult.action === "regenerate") {
                log.log("用户选择重新生成，重新处理...");
                return await processMemoryForMessage(userMessage);
            } else if (checkResult.action === "multi-regenerate") {
                log.log("用户选择多AI生成...");
                // 获取启用的providers
                const providers = getEnabledProviders();
                if (providers.length < 2) {
                    log.warn("启用的provider数量不足，无法使用多AI生成");
                    return await processMemoryForMessage(userMessage);
                }

                // 使用编辑后的内容（如果有）
                const finalMemory = checkResult.editedSummary ?? memory;
                const finalEditorContent = checkResult.editedEditor ?? editorContent;

                // 构建消息列表（包含记忆和用户消息）- 作为默认消息
                const messagesForMultiAI = [];
                if (finalMemory) {
                    messagesForMultiAI.push({
                        role: "system",
                        content: finalMemory,
                    });
                }
                if (finalEditorContent) {
                    messagesForMultiAI.push({
                        role: "system",
                        content: finalEditorContent,
                    });
                }
                messagesForMultiAI.push({
                    role: "user",
                    content: userMessage,
                });

                // 预设上下文（供provider使用预设时构建消息）
                const presetContext = {
                    memory: finalMemory || '',
                    editorContent: finalEditorContent || '',
                    userMessage: userMessage,
                };

                // 显示多AI选择弹窗
                const multiAIResult = await showMultiAISelectionModal(providers, messagesForMultiAI, presetContext);

                if (multiAIResult.action === "cancel") {
                    log.log("用户取消了多AI生成");
                    const msgPanel = getMessageProgressPanel();
                    if (msgPanel) {
                        msgPanel.hide();
                    }
                    return { cancelled: true };
                }

                if (multiAIResult.action === "select" && multiAIResult.result) {
                    log.log("用户选择了多AI生成的结果");
                    // 返回用户选择的结果，包含生成的内容
                    return {
                        memory: finalMemory,
                        editorContent: finalEditorContent,
                        multiAIResponse: multiAIResult.result.content,
                    };
                }
            } else if (checkResult.action === "confirm") {
                // 用户确认发送，使用编辑后的内容
                const finalMemory = checkResult.editedSummary ?? memory;
                const finalEditorContent = checkResult.editedEditor ?? editorContent;

                // 如果有剧情优化内容，返回包含 editorContent 的对象
                if (finalEditorContent) {
                    return {
                        memory: finalMemory,
                        editorContent: finalEditorContent,
                    };
                }

                return finalMemory;
            }
        }

        // 如果有剧情优化内容，返回包含 editorContent 的对象
        if (editorContent) {
            return {
                memory: memory,
                editorContent: editorContent,
            };
        }

        return memory;
    } catch (error) {
        if (error.name === "AbortError") {
            log.warn("处理被用户终止");
        } else {
            log.error("处理消息时发生错误:", error);
        }
        if (progressTracker) {
            progressTracker.finish();
        }
        return null;
    } finally {
        setMenuButtonProcessing(false);
        setFloatBallProcessing(false);
        abortController = null;
        log.groupEnd();
    }
}

/**
 * 停止当前处理
 */
export function stopProcessing() {
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
}

/**
 * 获取当前 AbortController
 * @returns {AbortController|null}
 */
export function getAbortController() {
    return abortController;
}
