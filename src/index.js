/**
 * 记忆管理并发系统 - 主入口
 * @version 0.4.0
 * @author 可乐、繁华
 * @license AGPLv3
 * @see https://github.com/Cola-Echo/memory-manager-concurrent
 *
 * 这是模块化重构后的入口文件
 * 详细更新历史请查看 CHANGELOG.md
 */

// 核心模块
import { detectExtensionPath } from "@core/constants";
import Logger from "@core/logger";
import { getEventSource, getEventTypes, getContext } from "@core/sillytavern-api";

// 配置模块
import { isPluginEnabled, loadConfig } from "@config/config-manager";

// API 模块
import { setProgressTracker } from "@api/adapter";

// UI 模块
import {
    bindEvents,
    createExtensionMenuButton,
    deleteConfig,
    deletePromptFile,
    exportFlowConfig,
    exportPromptFile,
    fetchModels,
    // 记忆搜索面板
    getMemorySearchPanel,
    performMemorySearch,
    getMessageProgressPanel,
    hasImportedSummaryBooks,
    hideConfigModal,
    hideFlowConfigModal,
    hidePromptEditor,
    importFlowConfig,
    importPromptFile,
    initFlowConfigResize,
    initMessageProgressPanel,
    // 剧情优化面板
    initPlotOptimizePanel,
    startPlotOptimizeSession,
    updatePlotPanelOtherTasksStatus,
    initProgressTracker,
    initTheme,
    loadAllTemplates,
    loadGlobalSettingsUI,
    loadRecursionSettings,
    refreshAIConfigList,
    resetFlowConfig,
    restoreDefaultPrompt,
    saveAsPromptFile,
    saveFlowConfig,
    savePromptFile,
    setClearUpdatesListFunction,
    setConfigModalFunctions,
    setEventsTogglePanelFunction,
    setFetchModelsFunction,
    setFloatBallTogglePanelFunction,
    setFlowConfigFunctions,
    setHasImportedSummaryBooksFunction,
    setHideConfigModalFunction,
    setInitFlowConfigResizeFunction,
    setMenuTogglePanelFunction,
    setMessageProgressPanel,
    setOpenIndexMergeConfigModalFunction,
    setOpenPlotOptimizeConfigModalFunction,
    setPlotPanelProgressTracker,
    setPromptEditorFunctions,
    setRefreshAIConfigListFunction,
    setSearchPanelGetter,
    setSearchPanelProgressTracker,
    setTestConnectionFunction,
    setUpdateDisplayFunctions,
    setUpdateMemorySearchBadgeFunction,
    setUpdatePlotOptimizeBadgeFunction,
    setWorldBookSelectorFunction,
    showConfigModal,
    // 流程配置弹窗
    showFlowConfigModal,
    // 提示词编辑器弹窗
    showPromptEditor,
    // 弹窗函数
    showWorldBookSelector,
    switchPromptType,
    testConnection,
    updateFloatBallVisibility,
    // 徽章更新
    updateMemorySearchBadge,
    updateMenuButtonStatus,
    updatePlotOptimizeBadge,
    // 模型显示更新
    updateIndexMergeModelDisplay,
    updatePlotOptimizeModelDisplay,
} from "@ui";

// 世界书模块
import {
    clearUpdatesList,
    refreshWorldBookList,
    startWorldBookPolling,
} from "@worldbook";

// Hooks 模块
import {
    hookSendButton,
    registerInterceptor as registerHookInterceptor,
    setProcessMemoryCallback,
} from "@hooks";

// 记忆处理模块
import {
    processMemoryForMessage,
    setMemorySearchPanelGetter,
    setPerformMemorySearchFn,
    setStartPlotOptimizeSessionFn,
    setUpdatePlotPanelOtherTasksStatusFn,
    getPromptTemplate,
    getHistoricalPromptTemplate,
} from "@memory";

// 版本信息
const VERSION = "0.4.7";

// 面板状态
let isPanelVisible = false;

/**
 * 切换面板显示
 */
function togglePanel() {
    const panel = document.getElementById("memory-manager-panel");
    if (!panel) {
        Logger.warn("面板未找到");
        alert("[记忆管理] 面板未加载，请刷新页面重试");
        return;
    }

    // 检查当前面板状态（使用原始代码的类名）
    const isVisible = panel.classList.contains("mm-panel-visible");

    if (isVisible) {
        // 面板可见，点击关闭面板
        panel.classList.remove("mm-panel-visible");
        isPanelVisible = false;
        // 同时关闭设置界面
        const settingsPanel = document.getElementById("memory-manager-settings");
        if (settingsPanel) {
            settingsPanel.classList.remove("mm-settings-visible");
        }
    } else {
        // 面板不可见，点击打开面板
        panel.classList.add("mm-panel-visible");
        isPanelVisible = true;
    }
}

/**
 * 初始化插件
 */
async function initPlugin() {
    console.log(`[记忆管理并发系统] v${VERSION} 初始化...`);

    try {
        // 检测扩展路径
        await detectExtensionPath();

        // 加载配置
        loadConfig();
        Logger.log("配置加载完成");

        // 初始化 UI 组件（内部使用）
        const progressTracker = initProgressTracker();
        const messageProgressPanel = initMessageProgressPanel();

        // 连接进度追踪器和消息进度面板
        setMessageProgressPanel(messageProgressPanel);
        setProgressTracker(progressTracker);

        // 设置搜索面板的进度追踪器
        setSearchPanelProgressTracker(progressTracker);

        // 设置剧情优化面板的依赖
        setPlotPanelProgressTracker(progressTracker);
        setSearchPanelGetter(getMemorySearchPanel);

        // 设置记忆处理器的依赖（用于启动搜索助手和剧情优化助手）
        setMemorySearchPanelGetter(getMemorySearchPanel);
        setPerformMemorySearchFn(performMemorySearch);
        setStartPlotOptimizeSessionFn(startPlotOptimizeSession);
        setUpdatePlotPanelOtherTasksStatusFn(updatePlotPanelOtherTasksStatus);

        // 设置面板切换函数
        setMenuTogglePanelFunction(togglePanel);
        setFloatBallTogglePanelFunction(togglePanel);
        setEventsTogglePanelFunction(togglePanel);

        // 设置世界书选择器函数
        setWorldBookSelectorFunction(showWorldBookSelector);

        // 设置配置弹窗函数
        setConfigModalFunctions(showConfigModal, deleteConfig);
        setHideConfigModalFunction(hideConfigModal);
        setTestConnectionFunction(testConnection);
        setFetchModelsFunction(fetchModels);

        // 设置流程配置函数
        setFlowConfigFunctions(
            showFlowConfigModal,
            hideFlowConfigModal,
            resetFlowConfig,
            importFlowConfig,
            exportFlowConfig,
            saveFlowConfig,
        );

        // 设置提示词编辑器函数
        setPromptEditorFunctions(
            showPromptEditor,
            hidePromptEditor,
            savePromptFile,
            saveAsPromptFile,
            deletePromptFile,
            restoreDefaultPrompt,
            importPromptFile,
            exportPromptFile,
            switchPromptType,
        );

        // 设置初始化函数
        setInitFlowConfigResizeFunction(initFlowConfigResize);

        // 设置徽章更新函数
        setUpdateMemorySearchBadgeFunction(updateMemorySearchBadge);
        setUpdatePlotOptimizeBadgeFunction(updatePlotOptimizeBadge);

        // 设置其他辅助函数
        setHasImportedSummaryBooksFunction(hasImportedSummaryBooks);
        setOpenIndexMergeConfigModalFunction(() =>
            showConfigModal("索引合并", "merge"),
        );
        setOpenPlotOptimizeConfigModalFunction(() =>
            showConfigModal("剧情优化", "plot"),
        );

        // 设置更新列表清空函数
        setClearUpdatesListFunction(clearUpdatesList);

        // 设置 AI 配置列表刷新函数
        setRefreshAIConfigListFunction(refreshAIConfigList);

        // 设置配置弹窗的更新显示回调
        setUpdateDisplayFunctions(
            updateIndexMergeModelDisplay,
            updatePlotOptimizeModelDisplay,
            refreshAIConfigList,
        );

        // 注入记忆处理回调
        setProcessMemoryCallback(processMemoryForMessage);

        // 直接初始化 UI（与原始代码一致）
        try {
            await initUI();
        } catch (error) {
            Logger.error("UI 初始化失败:", error);
        }

        // 注册事件监听
        registerEventListeners();

        // 注册全局拦截器
        registerHookInterceptor();

        Logger.log("初始化完成");
    } catch (error) {
        console.error("[记忆管理] 初始化失败:", error);
    }
}

/**
 * 初始化 UI
 */
async function initUI() {
    try {
        // 加载所有模板
        await loadAllTemplates();

        // 创建扩展菜单按钮
        createExtensionMenuButton();

        // 绑定事件
        bindEvents();

        // 并行预加载流程配置和提示词模板（后台加载，不阻塞 UI）
        Promise.all([
            getPromptTemplate().catch(e => Logger.debug("预加载关键词提示词失败:", e)),
            getHistoricalPromptTemplate().catch(e => Logger.debug("预加载历史事件提示词失败:", e)),
        ]).then(() => {
            Logger.debug("提示词模板预加载完成");
        });

        // 刷新世界书列表
        await refreshWorldBookList();

        // 加载全局设置到 UI
        loadGlobalSettingsUI();

        // 初始化主题
        initTheme();

        // 更新悬浮球可见性
        updateFloatBallVisibility();

        // 更新菜单按钮状态
        updateMenuButtonStatus();

        // 初始化消息进度面板
        const msgPanel = getMessageProgressPanel();
        if (msgPanel) {
            msgPanel.init();
        }

        // 初始化记忆搜索助手面板
        const searchPanel = getMemorySearchPanel();
        if (searchPanel) {
            searchPanel.init();
        }

        // 初始化剧情优化面板事件
        initPlotOptimizePanel();

        // 刷新AI配置列表
        refreshAIConfigList();

        // 加载递归设置
        loadRecursionSettings();

        // 启动世界书轮询检测
        startWorldBookPolling();

        Logger.log("UI 初始化完成");
    } catch (error) {
        Logger.error("UI 初始化失败:", error);
    }
}

/**
 * 注册事件监听器
 */
function registerEventListeners() {
    const eventSource = getEventSource();
    const eventTypes = getEventTypes();

    if (eventSource && eventTypes.APP_READY) {
        // 定义事件处理器
        const appReadyHandler = () => {
            Logger.log("APP_READY 事件触发，安装发送按钮 Hook...");

            // 检查是否启用
            if (!isPluginEnabled()) {
                Logger.log("插件已禁用");
                return;
            }

            // 安装发送按钮钩子（与原始代码一致）
            hookSendButton();
        };

        const worldInfoUpdatedHandler = async (bookName) => {
            Logger.log("检测到世界书更新，自动刷新列表...");
            await refreshWorldBookList();
            // 自动为新条目应用递归设置
            if (bookName) {
                // 这里需要确保applyRecursionSettingsToNewEntries函数可用
                try {
                    // 尝试导入并调用该函数
                    const { applyRecursionSettingsToNewEntries } =
                        await import("@ui/components/worldbook-control");
                    await applyRecursionSettingsToNewEntries(bookName);
                } catch (error) {
                    Logger.debug("应用递归设置失败:", error);
                }
            }
        };

        const worldInfoSettingsUpdatedHandler = () => {
            Logger.log("检测到世界书设置更新，自动刷新列表...");
            refreshWorldBookList();
        };

        // 监听 APP_READY 事件
        eventSource.on(eventTypes.APP_READY, appReadyHandler);

        // 监听世界书更新事件 - 自动刷新条目列表 & 应用递归设置
        if (eventTypes.WORLDINFO_UPDATED) {
            eventSource.on(
                eventTypes.WORLDINFO_UPDATED,
                worldInfoUpdatedHandler,
            );
            Logger.log("已注册 WORLDINFO_UPDATED 事件监听");
        }

        // 监听世界书设置更新事件
        if (eventTypes.WORLDINFO_SETTINGS_UPDATED) {
            eventSource.on(
                eventTypes.WORLDINFO_SETTINGS_UPDATED,
                worldInfoSettingsUpdatedHandler,
            );
            Logger.log("已注册 WORLDINFO_SETTINGS_UPDATED 事件监听");
        }

        Logger.log("已注册事件监听");
    } else {
        Logger.warn("事件系统不可用，使用延迟初始化");
        // 延迟安装钩子
        setTimeout(() => {
            if (isPluginEnabled()) {
                hookSendButton();
            }
        }, 3000);
    }
}

// 启动插件
if (typeof jQuery !== "undefined") {
    jQuery(async () => {
        await initPlugin();
    });
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", async () => {
        await initPlugin();
    });
} else {
    initPlugin();
}

// 导出模块供外部使用
export { initPlugin, VERSION };
