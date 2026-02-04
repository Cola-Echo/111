/**
 * UI 模块导出
 * @module ui
 */

// 组件
export {
    ProgressTracker,
    progressTracker,
    initProgressTracker,
    getProgressTracker,
    setMessageProgressPanel,
} from './components/progress-tracker';

export {
    MessageProgressPanel,
    messageProgressPanel,
    initMessageProgressPanel,
    getMessageProgressPanel,
} from './components/message-progress';

// 记忆搜索助手面板
export {
    MemorySearchPanel,
    getMemorySearchPanel,
    initMemorySearchPanel,
    isMemorySearchEnabled,
    hasImportedSummaryBooks,
    getMemorySearchAssistantSettings,
    performMemorySearch,
    setSearchPanelProgressTracker,
} from './components/search-panel';

// 菜单按钮
export {
    createExtensionMenuButton,
    updateMenuButtonStatus,
    setMenuButtonProcessing,
    setTogglePanelFunction as setMenuTogglePanelFunction,
} from './menu-button';

// 悬浮球
export {
    createFloatBall,
    removeFloatBall,
    updateFloatBallVisibility,
    updateFloatBallStatus,
    setFloatBallProcessing,
    setTogglePanelFunction as setFloatBallTogglePanelFunction,
} from './float-ball';

// 模板加载
export {
    loadPanelTemplate,
    loadSettingsTemplate,
    loadPlotOptimizePanelTemplate,
    loadSearchDialogTemplate,
    loadAllTemplates,
} from './template-loader';

// 事件绑定
export {
    bindEvents,
    initTheme,
    loadGlobalSettingsUI,
    refreshAIConfigList,
    setTogglePanelFunction as setEventsTogglePanelFunction,
    setSettingsFunctions,
    setWorldBookSelectorFunction,
    setConfigModalFunctions,
    setHideConfigModalFunction,
    setSaveCurrentConfigFunction,
    setTestConnectionFunction,
    setFetchModelsFunction,
    setToggleCustomFormatOptionsFunction,
    setSwitchConfigTabFunction,
    setLoadConfigWorldBooksFunction,
    setLoadConfigCharDescriptionFunction,
    setHasImportedSummaryBooksFunction,
    setOpenIndexMergeConfigModalFunction,
    setOpenPlotOptimizeConfigModalFunction,
    setClearUpdatesListFunction,
    setInitFlowConfigResizeFunction,
    setLoadWorldbookControlListFunction,
    setUpdateMemorySearchBadgeFunction,
    setUpdatePlotOptimizeBadgeFunction,
    setUpdateTagFilterBadgeFunction,
    setRefreshAIConfigListFunction,
    setFlowConfigFunctions,
    setPromptEditorFunctions,
    // 标签过滤
    initTagFilterUI,
    updateTagFilterBadge,
    getTagFilterConfigFromUI,
    addExtractTag,
    addExcludeTag,
    removeExtractTag,
    removeExcludeTag,
    // 世界书控制
    loadWorldbookControlList,
    handleWorldbookSelect,
    toggleRecursionSetting,
    // 徽章更新
    updateMemorySearchBadge,
    updatePlotOptimizeBadge,
    // 模型显示更新
    updateIndexMergeModelDisplay,
    updatePlotOptimizeModelDisplay,
} from './events';

// 标签过滤组件
export {
    bindTagFilterEvents,
} from './components/tag-filter';

// 世界书控制组件
export {
    loadRecursionSettings,
    saveRecursionSettings,
    getSelectedWorldbookName,
    loadWorldbookEntries,
    updateWorldbookControlBadge,
    updateRecursionButtonState,
    applyRecursionSettingToAllEntries,
    updateWorldBookEntries,
    saveWorldBookByName,
    applyRecursionSettingsToNewEntries,
    bindWorldbookControlEvents,
} from './components/worldbook-control';

// 弹窗模块（统一从 modals 目录导出）
export {
    // 世界书选择器
    showWorldBookSelector,
    hideWorldBookSelector,
    // AI 配置弹窗
    showConfigModal,
    hideConfigModal,
    saveConfig as saveConfigModal,
    deleteConfig,
    bindConfigModalEvents,
    testConnection,
    fetchModels,
    setUpdateDisplayFunctions,
    // 请求预览弹窗
    showRequestPreview,
    // 汇总检查弹窗
    showSummaryCheckModal,
    // 流程配置弹窗
    SOURCE_LABELS,
    loadFlowConfigFromFile,
    getDefaultFlowConfig,
    buildPromptPartsByFlowConfig,
    showFlowConfigModal,
    hideFlowConfigModal,
    renderFlowConfigList,
    autoSaveFlowConfig,
    saveFlowConfig,
    resetFlowConfig,
    importFlowConfig,
    exportFlowConfig,
    initFlowConfigResize,
    bindFlowConfigEvents,
    // 提示词编辑器弹窗
    getCurrentPromptType,
    getCurrentPromptFile,
    getCurrentPromptData,
    showPromptEditor,
    hidePromptEditor,
    hasUnsavedChanges,
    switchPromptField,
    loadPromptFiles,
    loadPromptFileContent,
    savePromptFile,
    importPromptFile,
    exportPromptFile,
    saveAsPromptFile,
    deletePromptFile,
    restoreDefaultPrompt,
    switchPromptType,
    bindPromptEditorEvents,
} from './modals';

// 剧情优化助手面板
export {
    startPlotOptimizeSession,
    updatePlotPanelOtherTasksStatus,
    showPlotOptimizePanel,
    hidePlotOptimizePanel,
    isPlotOptimizeEnabled,
    buildPlotOptimizePreview,
    bindPlotOptimizePanelEvents,
    initPlotOptimizePanel,
    showPlotOptimizeModal,
    hidePlotOptimizeModal,
    setPlotPanelProgressTracker,
    setSearchPanelGetter,
    extractKeywordsFromSelectedBooks,
    getMemoryContentFromSelectedBooks,
    getCharacterDescription,
    getDefaultModel,
    escapeHtml,
} from './components/plot-optimize';
