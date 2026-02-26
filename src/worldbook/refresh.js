/**
 * 世界书刷新模块
 * @module worldbook/refresh
 */

import Logger from '@core/logger';
import { loadConfig, isSummaryAutoSplitEnabled, getSummaryAutoSplitConfig, getSummaryPartConfigs, getSummaryConfig, isSummaryMergeDeduplicateEnabled, setSummaryPartApiConfig } from '@config/config-manager';
import { getImportedWorldBooks, classifyWorldBooks } from './api';
import { analyzeSummaryContent, formatCharCount, needsSplit, matchPartConfigs } from './summary-splitter';
import { getSummaryContent } from './parser';
import { isPartDebugEnabled, setPartDebugEnabled } from '@memory/part-debug-modal';

// 世界书缓存
let worldBooksCache = [];
let worldBooksSnapshot = null;
// Part分析缓存（避免重复计算）
let summaryPartsCache = {};

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
            // 总结世界书标题行 - 包含自动拆分开关、去重开关和调试开关
            const splitEnabled = isSummaryAutoSplitEnabled();
            const deduplicateEnabled = isSummaryMergeDeduplicateEnabled();
            const debugEnabled = isPartDebugEnabled();
            html += `
                <div class="mm-book-group-header">
                    <div class="mm-book-group-title">总结世界书</div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <label class="mm-switch mm-switch-sm" title="启用自动拆分（超过5万字符时拆分为多个Part并发处理）">
                            <input type="checkbox" id="mm-summary-auto-split-toggle" ${splitEnabled ? 'checked' : ''} />
                            <span class="mm-switch-slider"></span>
                        </label>
                        ${splitEnabled ? `
                        <label class="mm-icon-toggle" title="合并时去重：同一楼层保留内容最长的。关闭时相同楼层的内容会放在一起。">
                            <input type="checkbox" id="mm-summary-merge-deduplicate-toggle" ${deduplicateEnabled ? 'checked' : ''} />
                            <i class="fa-solid fa-filter"></i>
                        </label>
                        <label class="mm-icon-toggle" title="启用调试模式，处理完成后显示各Part返回内容">
                            <input type="checkbox" id="mm-summary-part-debug-toggle" ${debugEnabled ? 'checked' : ''} />
                            <i class="fa-solid fa-bug"></i>
                        </label>
                        ` : ''}
                    </div>
                </div>`;

            for (const book of summaryBooks) {
                const bookConfig = config?.summaryConfigs?.[book.name];
                const hasConfig = !!bookConfig;
                const eventsCount = bookConfig?.maxHistoryEvents || 15;
                const relevanceThreshold = bookConfig?.relevanceThreshold || 0.6;
                const apiModel = escapeHtml(bookConfig?.model || "未配置");
                const entryCount = book.entries ? Object.keys(book.entries).length : 0;
                const statusClass = hasConfig ? "mm-chip-ok" : "mm-chip-warning";

                const safeBookName = escapeHtml(book.name);

                // 检查是否需要拆分（启用拆分且内容足够多）
                const content = getSummaryContent(book);
                const splitConfig = getSummaryAutoSplitConfig();
                const shouldSplit = splitEnabled && needsSplit(content, splitConfig.targetChars);

                html += `
                    <div class="mm-book-card" data-book="${safeBookName}">
                        <div class="mm-book-title">
                            <span class="mm-book-name">${safeBookName}</span>
                            <span class="mm-chip-count" style="margin-left: 8px; margin-right: auto;">${entryCount}</span>
                            <button class="mm-btn mm-btn-xs mm-btn-danger" data-action="remove-book" data-book="${safeBookName}" title="移除">
                                <i class="fa-solid fa-times"></i>
                            </button>
                        </div>`;

                // 如果启用了拆分功能且内容足够，显示Part列表
                if (shouldSplit) {
                    html += renderSummaryPartsUI(book, config);
                } else {
                    // 不启用拆分或内容不足：显示单个可点击的配置芯片
                    html += `
                        <div class="mm-chips-container">
                            <div class="mm-chip ${statusClass}"
                                 data-action="edit-config"
                                 data-category="${safeBookName}"
                                 data-type="summary"
                                 title="条目: ${entryCount} | 事件: ${eventsCount} | 阈值: ${relevanceThreshold} | 模型: ${apiModel}">
                                <span class="mm-chip-name">${formatCharCount(content.length)} 字符</span>
                            </div>
                        </div>`;
                }

                html += `</div>`;
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
    summaryPartsCache = {};
}

/**
 * 渲染总结世界书的Part列表UI
 * @param {Object} book 世界书对象
 * @param {Object} config 配置对象
 * @returns {string} HTML字符串
 */
function renderSummaryPartsUI(book, config) {
    const splitConfig = getSummaryAutoSplitConfig();
    const content = getSummaryContent(book);
    const totalChars = content.length;

    // 检查是否需要拆分
    if (!needsSplit(content, splitConfig.targetChars)) {
        return `
            <div class="mm-summary-parts-info">
                <span class="mm-parts-hint">
                    <i class="fa-solid fa-check-circle" style="color: var(--mm-success-color);"></i>
                    内容约 ${formatCharCount(totalChars)} 字符，无需拆分
                </span>
            </div>`;
    }

    // 每次都重新分析Part（确保实时性，避免世界书内容变化后显示旧数据）
    const parts = analyzeSummaryContent(content, splitConfig);
    // 更新缓存（供其他地方使用）
    summaryPartsCache[book.name] = parts;

    if (parts.length <= 1) {
        return `
            <div class="mm-summary-parts-info">
                <span class="mm-parts-hint">
                    <i class="fa-solid fa-check-circle" style="color: var(--mm-success-color);"></i>
                    内容约 ${formatCharCount(totalChars)} 字符，无需拆分
                </span>
            </div>`;
    }

    // 获取已保存的Part配置
    const savedPartConfigs = getSummaryPartConfigs(book.name);
    // 获取原总结世界书配置（Part 1 复用）
    const originalSummaryConfig = getSummaryConfig(book.name);

    // 构建已保存配置的映射（用于模糊匹配）
    const savedConfigsMap = {};
    if (savedPartConfigs?.parts) {
        for (const p of savedPartConfigs.parts) {
            if (p.id && p.apiConfig) {
                savedConfigsMap[p.id] = p.apiConfig;
            }
        }
    }

    // 使用模糊匹配来保留配置
    const { matched, unmatched } = matchPartConfigs(parts.slice(1), savedConfigsMap); // 跳过 Part 1

    // 如果有模糊匹配成功的，自动迁移配置到新的 partId
    for (const matchedPart of matched) {
        if (matchedPart.matchType === 'fuzzy' && matchedPart.apiConfig) {
            // 将配置迁移到新的 partId
            setSummaryPartApiConfig(book.name, matchedPart.id, matchedPart.apiConfig);
            Logger.log(`[Refresh] 模糊匹配迁移配置: ${matchedPart.originalPartId} -> ${matchedPart.id}`);
        }
    }

    // 检查是否有新的未配置的 Part（用于提醒）
    const unconfiguredParts = [];

    let html = '<div class="mm-chips-container">';

    for (const part of parts) {
        // Part 1（index=0）复用原总结世界书配置，其他Part使用各自的配置
        let hasConfig, modelName, dataAttrs;
        if (part.index === 0) {
            hasConfig = !!(originalSummaryConfig?.apiUrl && originalSummaryConfig?.model && originalSummaryConfig?.enabled);
            modelName = hasConfig ? escapeHtml(originalSummaryConfig.model) : '未配置';
            dataAttrs = `data-category="${escapeHtml(book.name)}" data-type="summary" data-part-index="0" data-part-id="${part.id}" data-start-floor="${part.startFloor}" data-end-floor="${part.endFloor}" data-char-count="${part.charCount}" data-book-name="${escapeHtml(book.name)}"`;
            if (!hasConfig) {
                unconfiguredParts.push({ ...part, floorRange: `${part.startFloor}-${part.endFloor}楼` });
            }
        } else {
            // 先尝试精确匹配
            let savedPart = savedPartConfigs?.parts?.find(p => p.id === part.id);
            // 如果精确匹配失败，尝试从模糊匹配结果中获取
            if (!savedPart) {
                const matchedPart = matched.find(m => m.id === part.id);
                if (matchedPart?.apiConfig) {
                    savedPart = { apiConfig: matchedPart.apiConfig };
                }
            }
            hasConfig = !!(savedPart?.apiConfig?.apiUrl && savedPart?.apiConfig?.model);
            modelName = hasConfig ? escapeHtml(savedPart.apiConfig.model) : '未配置';
            dataAttrs = `data-category="${escapeHtml(book.name)}" data-type="summary" data-part-index="${part.index}" data-part-id="${part.id}" data-start-floor="${part.startFloor}" data-end-floor="${part.endFloor}" data-char-count="${part.charCount}" data-book-name="${escapeHtml(book.name)}"`;
            if (!hasConfig) {
                unconfiguredParts.push({ ...part, floorRange: `${part.startFloor}-${part.endFloor}楼` });
            }
        }

        const statusClass = hasConfig ? 'mm-chip-ok' : 'mm-chip-warning';

        const floorRange = part.startFloor && part.endFloor
            ? `${part.startFloor}-${part.endFloor}楼`
            : `Part ${part.index + 1}`;

        html += `
            <div class="mm-chip ${statusClass}"
                 data-action="edit-config"
                 ${dataAttrs}
                 title="点击配置API | 模型: ${modelName}">
                <span class="mm-chip-name">${floorRange}</span>
                <span class="mm-chip-count">${formatCharCount(part.charCount)}</span>
            </div>`;
    }

    html += '</div>';

    // 如果有未配置的 Part，显示提醒通知
    if (unconfiguredParts.length > 0) {
        showUnconfiguredPartsNotification(book.name, unconfiguredParts);
    }

    return html;
}

// 用于防止重复通知的缓存
let lastNotificationKey = '';
let lastNotificationTime = 0;

/**
 * 获取当前主题
 * @returns {string} 主题名称
 */
function getCurrentTheme() {
    const settings = loadConfig();
    return settings?.global?.theme || 'default';
}

/**
 * 显示未配置Part的通知（自定义右下角卡片，跟随插件主题）
 * @param {string} bookName 世界书名称
 * @param {Array} unconfiguredParts 未配置的Part列表
 */
function showUnconfiguredPartsNotification(bookName, unconfiguredParts) {
    // 防止短时间内重复通知（5秒内同一世界书不重复提醒）
    const notificationKey = `${bookName}_${unconfiguredParts.length}`;
    const now = Date.now();
    if (notificationKey === lastNotificationKey && now - lastNotificationTime < 5000) {
        return;
    }
    lastNotificationKey = notificationKey;
    lastNotificationTime = now;

    // 移除已存在的通知
    const existingNotification = document.getElementById('mm-part-config-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // 添加样式（如果不存在）
    if (!document.getElementById('mm-part-notification-styles')) {
        const style = document.createElement('style');
        style.id = 'mm-part-notification-styles';
        style.textContent = `
            @keyframes mm-notification-slide-in {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes mm-notification-slide-out {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
            #mm-part-config-notification {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 320px;
                max-width: calc(100vw - 40px);
                background: rgba(15, 52, 96, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-left: 3px solid #f0ad4e;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                z-index: 99998;
                animation: mm-notification-slide-in 0.3s ease-out;
                overflow: hidden;
                cursor: pointer;
            }
            /* 暖灰棕主题 */
            #mm-part-config-notification[data-mm-theme="warm-brown"] {
                background: rgba(61, 53, 46, 0.85);
                border-color: rgba(255, 255, 255, 0.1);
            }
            /* 淡紫薰衣草主题 */
            #mm-part-config-notification[data-mm-theme="lavender"] {
                background: rgba(45, 40, 56, 0.85);
                border-color: rgba(255, 255, 255, 0.1);
            }
            /* 森林绿主题 */
            #mm-part-config-notification[data-mm-theme="forest"] {
                background: rgba(37, 53, 48, 0.85);
                border-color: rgba(255, 255, 255, 0.1);
            }
            /* 玫瑰灰主题 */
            #mm-part-config-notification[data-mm-theme="rose"] {
                background: rgba(56, 40, 48, 0.85);
                border-color: rgba(255, 255, 255, 0.1);
            }
            /* 静谧蓝灰主题 */
            #mm-part-config-notification[data-mm-theme="slate"] {
                background: rgba(40, 46, 53, 0.85);
                border-color: rgba(255, 255, 255, 0.1);
            }
            /* 星空紫主题 */
            #mm-part-config-notification[data-mm-theme="starry-purple"] {
                background:
                    radial-gradient(1px 1px at 20px 30px, rgba(255,255,255,0.8), transparent),
                    radial-gradient(1px 1px at 40px 70px, rgba(255,255,255,0.6), transparent),
                    radial-gradient(1px 1px at 50px 160px, rgba(255,255,255,0.7), transparent),
                    radial-gradient(1.5px 1.5px at 100px 40px, rgba(255,255,255,0.9), transparent),
                    radial-gradient(1px 1px at 130px 80px, rgba(255,255,255,0.5), transparent),
                    radial-gradient(1.5px 1.5px at 160px 120px, rgba(255,255,255,0.8), transparent),
                    radial-gradient(1px 1px at 200px 50px, rgba(255,255,255,0.6), transparent),
                    radial-gradient(1px 1px at 250px 90px, rgba(255,255,255,0.7), transparent),
                    radial-gradient(1.5px 1.5px at 280px 140px, rgba(255,255,255,0.5), transparent),
                    rgba(26, 21, 37, 0.85);
                border-color: rgba(138, 100, 200, 0.3);
            }
            /* 星空蓝主题 */
            #mm-part-config-notification[data-mm-theme="starry-blue"] {
                background:
                    radial-gradient(1px 1px at 15px 25px, rgba(255,255,255,0.8), transparent),
                    radial-gradient(1.5px 1.5px at 45px 65px, rgba(200,220,255,0.9), transparent),
                    radial-gradient(1px 1px at 75px 150px, rgba(255,255,255,0.6), transparent),
                    radial-gradient(1px 1px at 110px 35px, rgba(200,220,255,0.7), transparent),
                    radial-gradient(1.5px 1.5px at 140px 95px, rgba(255,255,255,0.8), transparent),
                    radial-gradient(1px 1px at 180px 55px, rgba(200,220,255,0.5), transparent),
                    radial-gradient(1px 1px at 220px 110px, rgba(255,255,255,0.7), transparent),
                    radial-gradient(1.5px 1.5px at 260px 70px, rgba(200,220,255,0.6), transparent),
                    radial-gradient(1px 1px at 290px 130px, rgba(255,255,255,0.5), transparent),
                    rgba(16, 24, 40, 0.85);
                border-color: rgba(100, 150, 220, 0.3);
            }
            /* 星空黑主题 */
            #mm-part-config-notification[data-mm-theme="starry-black"] {
                background:
                    radial-gradient(1px 1px at 10px 20px, rgba(255,255,255,0.9), transparent),
                    radial-gradient(1.5px 1.5px at 35px 75px, rgba(255,255,255,0.7), transparent),
                    radial-gradient(1px 1px at 60px 140px, rgba(255,255,255,0.8), transparent),
                    radial-gradient(1px 1px at 95px 30px, rgba(255,255,255,0.6), transparent),
                    radial-gradient(1.5px 1.5px at 125px 100px, rgba(255,255,255,0.9), transparent),
                    radial-gradient(1px 1px at 165px 60px, rgba(255,255,255,0.5), transparent),
                    radial-gradient(1px 1px at 195px 120px, rgba(255,255,255,0.7), transparent),
                    radial-gradient(1.5px 1.5px at 235px 45px, rgba(255,255,255,0.6), transparent),
                    radial-gradient(1px 1px at 275px 85px, rgba(255,255,255,0.8), transparent),
                    rgba(12, 12, 16, 0.85);
                border-color: rgba(255, 255, 255, 0.15);
            }
            #mm-part-config-notification .mm-notification-content {
                padding: 12px 14px;
            }
            #mm-part-config-notification .mm-notification-header {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 8px;
            }
            #mm-part-config-notification .mm-notification-icon {
                color: #f0ad4e;
                font-size: 16px;
                flex-shrink: 0;
            }
            #mm-part-config-notification .mm-notification-title {
                color: #e4e4e4;
                font-weight: 600;
                font-size: 13px;
                flex: 1;
            }
            #mm-part-config-notification .mm-notification-close {
                color: #a0a0a0;
                cursor: pointer;
                padding: 2px 6px;
                border-radius: 4px;
                transition: all 0.2s;
            }
            #mm-part-config-notification .mm-notification-close:hover {
                color: #e4e4e4;
                background: rgba(255, 255, 255, 0.1);
            }
            #mm-part-config-notification .mm-notification-body {
                color: #c0c0c0;
                font-size: 12px;
                line-height: 1.5;
            }
            #mm-part-config-notification .mm-notification-parts {
                color: #f0ad4e;
                font-weight: 500;
                margin: 4px 0;
            }
            #mm-part-config-notification .mm-notification-hint {
                color: #888;
                font-size: 11px;
                margin-top: 8px;
            }
            #mm-part-config-notification:hover {
                border-left-color: #ffc107;
            }
            #mm-part-config-notification.mm-notification-closing {
                animation: mm-notification-slide-out 0.3s ease-in forwards;
            }
            /* 移动端适配 */
            @media (max-width: 400px) {
                #mm-part-config-notification {
                    bottom: 10px;
                    right: 10px;
                    width: calc(100vw - 20px);
                }
            }
        `;
        document.head.appendChild(style);
    }

    // 创建通知元素
    const notification = document.createElement('div');
    notification.id = 'mm-part-config-notification';

    // 应用当前主题
    const theme = getCurrentTheme();
    if (theme && theme !== 'default') {
        notification.setAttribute('data-mm-theme', theme);
    }

    const partsList = unconfiguredParts.map(p => p.floorRange).join('、');

    notification.innerHTML = `
        <div class="mm-notification-content">
            <div class="mm-notification-header">
                <span class="mm-notification-icon"><i class="fa-solid fa-exclamation-triangle"></i></span>
                <span class="mm-notification-title">拆分配置提醒</span>
                <span class="mm-notification-close"><i class="fa-solid fa-times"></i></span>
            </div>
            <div class="mm-notification-body">
                <div>总结世界书「${escapeHtml(bookName)}」有 <strong>${unconfiguredParts.length}</strong> 个拆分未配置API：</div>
                <div class="mm-notification-parts">${escapeHtml(partsList)}</div>
                <div class="mm-notification-hint">点击此通知打开设置进行配置</div>
            </div>
        </div>
    `;

    // 关闭按钮事件
    notification.querySelector('.mm-notification-close').addEventListener('click', (e) => {
        e.stopPropagation();
        notification.classList.add('mm-notification-closing');
        setTimeout(() => notification.remove(), 300);
    });

    // 点击通知打开设置
    notification.addEventListener('click', () => {
        const settingsBtn = document.querySelector('#mm-settings-toggle');
        if (settingsBtn) {
            settingsBtn.click();
        }
        notification.classList.add('mm-notification-closing');
        setTimeout(() => notification.remove(), 300);
    });

    document.body.appendChild(notification);

    // 10秒后自动关闭
    setTimeout(() => {
        if (notification.parentNode) {
            notification.classList.add('mm-notification-closing');
            setTimeout(() => notification.remove(), 300);
        }
    }, 10000);
}

/**
 * 获取指定世界书的Part分析结果
 * @param {string} bookName 世界书名称
 * @returns {Array|null} Part数组或null
 */
export function getSummaryParts(bookName) {
    return summaryPartsCache[bookName] || null;
}

/**
 * 清除指定世界书的Part缓存
 * @param {string} bookName 世界书名称
 */
export function clearSummaryPartsCache(bookName) {
    if (bookName) {
        delete summaryPartsCache[bookName];
    } else {
        summaryPartsCache = {};
    }
}

