/**
 * RMA 关系记忆系统 - 模块入口
 * @module rma
 */

import { loadConfig, saveConfig } from '@config/config-manager';

// 配置加载
export {
    loadRmaConfigFromCharacter,
    hasRmaConfig,
    getCurrentRmaConfig,
    clearRmaConfigCache,
    getPhaseDefinitions,
    getInitialPhase,
    getSensitivities,
    getEmotionalProcessing,
    getSecrets,
    getWorldbookEntryConfig,
} from './config-loader';

// 记忆存储
export {
    initRmaState,
    getRmaState,
    saveRmaState,
    addMemory,
    updateMemory,
    deleteMemory,
    invalidateMemoriesByMessage,
    getPhase,
    setPhase,
    setPhaseTendency,
    getSecretState,
    updateSecretStage,
    getUnresolvedThreads,
    addThread,
    resolveThread,
    getStoryState,
    updateStoryState,
    setCurrentTexture,
    getCurrentTexture,
    getRelevantMemories,
} from './memory-store';

// 分析引擎
export { analyzeResponse } from './analyzer';

// 事件监听
export {
    registerRmaEventListeners,
    setOnAnalysisCompleteCallback,
    getPendingAnalysis,
    clearPendingAnalysis,
} from './response-hook';

// 阶段管理
export {
    assessPhaseChange,
    executePhaseChange,
    updateTendency,
    getPhaseIndex,
} from './phase-manager';

// 世界书同步
export {
    findRmaEntries,
    findRmaWorldBook,
    switchPhaseEntry,
    rewriteTextureEntry,
    checkAndUnlockEntries,
} from './worldbook-sync';

// 确认 UI
export {
    renderPendingConfirmation,
    bindConfirmationEvents,
    setOnConfirmCompleteCallback,
    needsConfirmation,
} from './confirmation-ui';

// 悬浮面板
export {
    initRmaPanel,
    showRmaPanel,
    hideRmaPanel,
    updatePanelContent,
} from './float-panel';

// 时间线
export {
    renderTimeline,
    bindTimelineEvents,
} from './timeline-view';

// ==================== 插件配置存取 ====================

/**
 * 获取 RMA 插件配置
 * @returns {object}
 */
export function getRmaConfig() {
    const config = loadConfig();
    return config?.global?.rmaConfig || {};
}

/**
 * 更新 RMA 插件配置
 * @param {object} updates
 */
export function updateRmaConfig(updates) {
    const config = loadConfig();
    if (!config.global.rmaConfig) {
        config.global.rmaConfig = {};
    }
    Object.assign(config.global.rmaConfig, updates);
    saveConfig(config);
}

/**
 * RMA 是否启用
 * @returns {boolean}
 */
export function isRmaEnabled() {
    return getRmaConfig()?.enabled === true;
}

/**
 * 设置 RMA 启用状态
 * @param {boolean} enabled
 */
export function setRmaEnabled(enabled) {
    updateRmaConfig({ enabled });
}

/**
 * 获取 RMA 分析 API 配置
 * @returns {object}
 */
export function getRmaAnalysisApiConfig() {
    return getRmaConfig()?.analysisApi || {};
}

/**
 * 更新 RMA 分析 API 配置
 * @param {object} updates
 */
export function updateRmaAnalysisApiConfig(updates) {
    const config = loadConfig();
    if (!config.global.rmaConfig) config.global.rmaConfig = {};
    if (!config.global.rmaConfig.analysisApi) config.global.rmaConfig.analysisApi = {};
    Object.assign(config.global.rmaConfig.analysisApi, updates);
    saveConfig(config);
}
