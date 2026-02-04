/**
 * 记忆处理模块导出
 * @module memory
 */

export { JAILBREAK_PROMPTS, getJailbreakPrefix } from './jailbreak';
export {
    buildDataInjection,
    injectDataToPrompt,
    buildUserPrompt,
    replacePromptVariables,
    injectMemory,
} from './prompt-builder';
export { mergeResults } from './result-merger';
export {
    collectMemoryRequestInfo,
    collectSummaryRequestInfo,
    collectIndexMergeRequestInfo,
    collectAllRequestInfos,
} from './request-collector';
export {
    processMemoryForMessage,
    processCategory,
    processSummaryBook,
    processIndexMerge,
    collectAllCategoryIndex,
    getCurrentChatContext,
    getPromptTemplate,
    getHistoricalPromptTemplate,
    stopProcessing,
    getAbortController,
    setMemorySearchPanelGetter,
    setPerformMemorySearchFn,
    setStartPlotOptimizeSessionFn,
    setUpdatePlotPanelOtherTasksStatusFn,
} from './processor';
