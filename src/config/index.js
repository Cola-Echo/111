/**
 * 配置模块导出
 * @module config
 */

export { defaultConfig, defaultAIConfig } from './default-config';
export {
    loadConfig,
    saveConfig,
    getGlobalSettings,
    updateGlobalSettings,
    getGlobalConfig,
    isPluginEnabled,
    getMemoryConfig,
    getSummaryConfig,
    setMemoryConfig,
    setSummaryConfig,
    deleteMemoryConfig,
    deleteSummaryConfig,
    getAllMemoryConfigs,
    getAllSummaryConfigs,
    exportConfig,
    importConfig,
    resetConfig,
} from './config-manager';
export {
    getImportedBookNames,
    saveImportedBookNames,
    addImportedBook,
    removeImportedBook,
    isBookImported,
} from './imported-books';
export {
    getImportedPromptFiles,
    saveImportedPromptFiles,
    savePromptFileData,
    getPromptFileData,
    deletePromptFileData,
    getPromptFileNames,
    hasPromptFile,
} from './prompt-files';
