/**
 * 弹窗模块导出
 * @module ui/modals
 */

// 请求预览弹窗
export { showRequestPreview } from './request-preview';

// 汇总检查弹窗
export { showSummaryCheckModal } from './summary-check';

// 世界书选择器弹窗
export { showWorldBookSelector, hideWorldBookSelector } from './worldbook-selector';

// AI 配置弹窗
export {
    showConfigModal,
    hideConfigModal,
    saveConfig,
    deleteConfig,
    bindConfigModalEvents,
    getCurrentEditing,
    testConnection,
    fetchModels,
    switchConfigTab,
    toggleCustomFormatOptions,
    loadConfigWorldBooks,
    loadConfigCharDescription,
    getConfigSelectedWorldBooks,
    setUpdateDisplayFunctions,
    initPlotOptimizeContextTab,
} from './config-modal';

// 流程配置弹窗
export {
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
} from './flow-config';

// 提示词编辑器弹窗
export {
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
} from './prompt-editor';

// 提示词预设弹窗
export {
    extractPromptsFromPreset,
    extractPromptsFromCurrentPreset,
    getPromptPresets,
    getPromptPresetById,
    savePromptPreset,
    deletePromptPreset,
    buildMessagesFromPreset,
    showPromptPresetModal,
    hidePromptPresetModal,
    renderPromptPresetList,
} from './prompt-preset';

