/**
 * 核心模块导出
 * @module core
 */

export { default as Logger } from './logger';
export { EXTENSION_NAME, EXTENSION_FOLDER, detectExtensionPath, getExtensionPath } from './constants';
export { MemoryManagerError, ErrorCodes, handleError, createAPIError, createConfigError, createNetworkError } from './error';
export {
    getContext,
    getEventSource,
    getEventTypes,
    getExtensionSettings,
    saveSettingsDebounced,
    generateNormal,
    getCurrentChat,
    getCurrentCharacterName,
    getCurrentCharacterDescription,
    getWorldNames,
    loadWorldInfo,
    getLibs,
    getDOMPurify,
} from './sillytavern-api';
