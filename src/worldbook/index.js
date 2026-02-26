/**
 * 世界书模块导出
 * @module worldbook
 */

export {
    parseWorldBook,
    parseOldBracketFormat,
    formatAsWorldBook,
    getSummaryContent,
    getCategories,
    getCategoryEntries,
} from './parser';

export {
    getAllAvailableWorldBooks,
    getWorldBookList,
    loadWorldBookByName,
    getWorldBookEntryCount,
    getWorldBookEntries,
    getImportedWorldBooks,
    isSummaryBook,
    isMemoryBook,
    classifyWorldBooks,
} from './api';

export {
    refreshWorldBookList,
    getWorldBooksCache,
    clearWorldBooksCache,
    getSummaryParts,
    clearSummaryPartsCache,
} from './refresh';

// 总结世界书拆分模块
export {
    parseSegments,
    analyzeSummaryContent,
    calculateSplitPlan,
    needsSplit,
    getContentStats,
    formatCharCount,
    matchPartConfigs,
    generatePartId,
    getSummaryBookContent,
} from './summary-splitter';

// 更新列表模块
export {
    addUpdates,
    renderUpdatesList,
    clearUpdatesList,
    startWorldBookPolling,
    stopWorldBookPolling,
    getUpdatesList,
    resetWorldBooksSnapshot,
} from './updates';
