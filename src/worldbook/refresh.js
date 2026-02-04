/**
 * 世界书刷新模块
 * @module worldbook/refresh
 */

import Logger from '@core/logger';
import { loadConfig } from '@config/config-manager';
import { getImportedWorldBooks, classifyWorldBooks } from './api';

// 世界书缓存
let worldBooksCache = [];
let worldBooksSnapshot = null;

/**
 * 创建世界书快照（用于变化检测）
 * @param {Array} worldBooks 世界书数组
 * @returns {object} 快照对象
 */
function createWorldBooksSnapshot(worldBooks) {
    const snapshot = {};
    for (const book of worldBooks) {
        const entries = {};
        if (book.entries) {
            for (const [uid, entry] of Object.entries(book.entries)) {
                entries[uid] = {
                    content: entry.content,
                    comment: entry.comment,
                    disable: entry.disable,
                };
            }
        }
        snapshot[book.name] = {
            entryCount: Object.keys(entries).length,
            entries,
        };
    }
    return snapshot;
}

/**
 * 检测世界书变化
 * @param {object} oldSnapshot 旧快照
 * @param {object} newSnapshot 新快照
 * @returns {Array} 变化列表
 */
function detectWorldBookChanges(oldSnapshot, newSnapshot) {
    const changes = [];

    // 检查新增的世界书
    for (const bookName of Object.keys(newSnapshot)) {
        if (!oldSnapshot[bookName]) {
            changes.push({ type: 'added', bookName });
        }
    }

    // 检查删除的世界书
    for (const bookName of Object.keys(oldSnapshot)) {
        if (!newSnapshot[bookName]) {
            changes.push({ type: 'removed', bookName });
        }
    }

    // 检查修改的世界书
    for (const bookName of Object.keys(newSnapshot)) {
        if (oldSnapshot[bookName]) {
            const oldBook = oldSnapshot[bookName];
            const newBook = newSnapshot[bookName];

            if (oldBook.entryCount !== newBook.entryCount) {
                changes.push({
                    type: 'modified',
                    bookName,
                    detail: `条目数量变化: ${oldBook.entryCount} -> ${newBook.entryCount}`,
                });
            }
        }
    }

    return changes;
}

/**
 * 获取世界书统计信息
 * @param {Array} worldBooks 世界书数组
 * @returns {object} 统计信息
 */
function getWorldBookStats(worldBooks) {
    return {
        totalBooks: worldBooks.length,
    };
}

/**
 * 转义 HTML，防止 XSS 攻击
 * @param {string} text 原始文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 刷新世界书列表
 */
export async function refreshWorldBookList() {
    const listContainer = document.getElementById("mm-worldbook-list");
    const countBadge = document.getElementById("mm-book-count");

    if (!listContainer) return;

    listContainer.innerHTML =
        '<div class="mm-loading"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</div>';

    try {
        worldBooksCache = await getImportedWorldBooks();

        // 变化检测
        const newSnapshot = createWorldBooksSnapshot(worldBooksCache);
        if (worldBooksSnapshot) {
            const changes = detectWorldBookChanges(worldBooksSnapshot, newSnapshot);
            if (changes.length > 0) {
                Logger.debug("世界书变化:", changes);
            }
        }
        worldBooksSnapshot = newSnapshot;

        const { memoryBooks, summaryBooks, unknownBooks } = classifyWorldBooks(worldBooksCache);
        const stats = getWorldBookStats(worldBooksCache);

        if (countBadge) countBadge.textContent = stats.totalBooks;

        if (worldBooksCache.length === 0) {
            listContainer.innerHTML = `
                <div class="mm-empty-state">
                    <i class="fa-solid fa-book"></i>
                    <p>暂无已导入的世界书</p>
                    <p class="mm-hint">点击"导入世界书"按钮选择要处理的世界书</p>
                </div>`;
            return;
        }

        const config = loadConfig();
        let html = "";

        if (memoryBooks.length > 0) {
            html += '<div class="mm-book-group">';
            html += '<div class="mm-book-group-title">记忆世界书</div>';
            for (const { book, categories } of memoryBooks) {
                const safeBookName = escapeHtml(book.name);
                html += `<div class="mm-book-card" data-book="${safeBookName}">`;
                html += `<div class="mm-book-title">`;
                html += `<span class="mm-book-name">${safeBookName}</span>`;
                html += `<button class="mm-btn mm-btn-xs mm-btn-danger" data-action="remove-book" data-book="${safeBookName}" title="移除">
                    <i class="fa-solid fa-times"></i>
                </button>`;
                html += `</div>`;
                html += '<div class="mm-chips-container">';
                for (const [category, data] of Object.entries(categories)) {
                    const indexCount = data.index?.length || 0;
                    const detailCount = data.details?.length || 0;
                    const totalCount = indexCount + detailCount;
                    const categoryConfig = config?.memoryConfigs?.[category];
                    const hasConfig = !!categoryConfig;
                    const keywordsCount = categoryConfig?.maxKeywords || 10;
                    const relevanceThreshold = categoryConfig?.relevanceThreshold || 0.6;
                    const apiModel = escapeHtml(categoryConfig?.model || "未配置");
                    const statusClass = hasConfig ? "mm-chip-ok" : "mm-chip-warning";

                    const safeCategory = escapeHtml(category);
                    html += `
                        <div class="mm-chip ${statusClass}"
                             data-action="edit-config"
                             data-category="${safeCategory}"
                             data-type="memory"
                             title="条目: ${totalCount} | 关键词: ${keywordsCount} | 阈值: ${relevanceThreshold} | 模型: ${apiModel}">
                            <span class="mm-chip-name">${safeCategory}</span>
                            <span class="mm-chip-count">${totalCount}</span>
                        </div>`;
                }
                html += "</div></div>";
            }
            html += "</div>";
        }

        if (summaryBooks.length > 0) {
            html += '<div class="mm-book-group">';
            html += '<div class="mm-book-group-title">总结世界书</div>';
            for (const book of summaryBooks) {
                const bookConfig = config?.summaryConfigs?.[book.name];
                const hasConfig = !!bookConfig;
                const eventsCount = bookConfig?.maxHistoryEvents || 15;
                const relevanceThreshold = bookConfig?.relevanceThreshold || 0.6;
                const apiModel = escapeHtml(bookConfig?.model || "未配置");
                const entryCount = book.entries ? Object.keys(book.entries).length : 0;
                const statusClass = hasConfig ? "mm-chip-ok" : "mm-chip-warning";

                const safeBookName = escapeHtml(book.name);
                html += `
                    <div class="mm-book-card">
                        <div class="mm-book-title">
                            <div class="mm-chip ${statusClass}"
                                 data-action="edit-config"
                                 data-category="${safeBookName}"
                                 data-type="summary"
                                 title="条目: ${entryCount} | 事件: ${eventsCount} | 阈值: ${relevanceThreshold} | 模型: ${apiModel}">
                                <span class="mm-chip-name">${safeBookName}</span>
                                <span class="mm-chip-count">${entryCount}</span>
                            </div>
                            <button class="mm-btn mm-btn-xs mm-btn-danger" data-action="remove-book" data-book="${safeBookName}" title="移除">
                                <i class="fa-solid fa-times"></i>
                            </button>
                        </div>
                    </div>`;
            }
            html += "</div>";
        }

        // 未识别类型的世界书
        if (unknownBooks.length > 0) {
            html += '<div class="mm-book-group">';
            html += '<div class="mm-book-group-title">未识别的世界书</div>';
            for (const book of unknownBooks) {
                const entryCount = book.entries ? Object.keys(book.entries).length : 0;
                const enabledCount = book.entries
                    ? Object.values(book.entries).filter((e) => e.disable !== true).length
                    : 0;

                const safeBookName = escapeHtml(book.name);
                html += `
                    <div class="mm-book-card">
                        <div class="mm-book-title">
                            <span class="mm-book-name">${safeBookName}</span>
                            <button class="mm-btn mm-btn-xs mm-btn-danger" data-action="remove-book" data-book="${safeBookName}" title="移除">
                                <i class="fa-solid fa-times"></i>
                            </button>
                        </div>
                        <div class="mm-chips-container">
                            <div class="mm-chip mm-chip-warning">
                                <span class="mm-chip-name">条目</span>
                                <span class="mm-chip-count">${entryCount}</span>
                            </div>
                            <div class="mm-chip">
                                <span class="mm-chip-name">启用</span>
                                <span class="mm-chip-count">${enabledCount}</span>
                            </div>
                        </div>
                        <p class="mm-hint" style="margin: 10px 0 0; font-size: 12px;">
                            无法识别类型。请确保条目的 comment 字段包含【分类名】格式
                        </p>
                    </div>`;
            }
            html += "</div>";
        }

        listContainer.innerHTML = html;
    } catch (error) {
        Logger.error("刷新世界书列表失败:", error);
        listContainer.innerHTML = `
            <div class="mm-error-state">
                <i class="fa-solid fa-exclamation-triangle"></i>
                <p>加载失败: ${error.message}</p>
            </div>`;
    }
}

/**
 * 获取世界书缓存
 * @returns {Array} 世界书缓存数组
 */
export function getWorldBooksCache() {
    return worldBooksCache;
}

/**
 * 清除世界书缓存
 */
export function clearWorldBooksCache() {
    worldBooksCache = [];
    worldBooksSnapshot = null;
}
