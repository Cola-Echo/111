/**
 * 工具模块导出
 * @module utils
 */

export {
    getLastUserMessage,
    getRecentContext,
    getMessageRole,
    getMessageContent,
} from './message';

export {
    filterContentByTags,
    filterContentByRole,
    hasActiveFilters,
    removeTag,
    extractTagContents,
} from './tag-filter';

export {
    loadPromptTemplate,
    getPromptTemplate,
    getHistoricalPromptTemplate,
    getPlotOptimizePromptTemplate,
    clearPromptTemplateCache,
    reloadKeywordsPromptTemplate,
    reloadHistoricalPromptTemplate,
} from './prompt-template';
