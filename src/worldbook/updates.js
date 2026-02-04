/**
 * 世界书更新列表模块
 * @module worldbook/updates
 */

import Logger from '@core/logger';
import { getImportedWorldBooks } from './api';

// 更新记录列表
let updatesList = [];

// 世界书轮询定时器
let worldBookPollingTimer = null;
const POLLING_INTERVAL = 5000; // 5秒轮询一次

// 世界书快照（用于变化检测）
let worldBooksSnapshot = null;

/**
 * 创建世界书快照
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
 * 添加更新记录
 * @param {Array} changes 变化列表
 */
export function addUpdates(changes) {
    if (changes.length === 0) return;

    // 将新变化添加到列表开头
    updatesList = [...changes, ...updatesList].slice(0, 50); // 最多保留50条
    renderUpdatesList();
}

/**
 * 渲染更新列表
 */
export function renderUpdatesList() {
    const container = document.getElementById("mm-updates-list");
    const clearBtn = document.getElementById("mm-clear-updates-btn");
    if (!container) return;

    if (updatesList.length === 0) {
        container.innerHTML = '<div class="mm-empty-hint">暂无更新记录</div>';
        if (clearBtn) clearBtn.style.display = "none";
        return;
    }

    if (clearBtn) clearBtn.style.display = "inline-flex";

    const html = updatesList
        .map((change) => {
            const typeClass = {
                added: "mm-update-added",
                removed: "mm-update-removed",
                modified: "mm-update-modified",
            }[change.type] || "";

            const typeText = {
                added: "新增",
                removed: "移除",
                modified: "修改",
            }[change.type] || "变化";

            return `
                <div class="mm-update-item ${typeClass}">
                    <span class="mm-update-type">${typeText}</span>
                    <span class="mm-update-book">${change.bookName}</span>
                    ${change.detail ? `<span class="mm-update-detail">${change.detail}</span>` : ""}
                </div>
            `;
        })
        .join("");

    container.innerHTML = html;
}

/**
 * 清空更新列表
 */
export function clearUpdatesList() {
    updatesList = [];
    renderUpdatesList();
}

/**
 * 启动世界书轮询
 */
export function startWorldBookPolling() {
    if (worldBookPollingTimer) return; // 已经在运行

    worldBookPollingTimer = setInterval(async () => {
        // 只在面板可见时轮询
        const panel = document.getElementById("memory-manager-panel");
        if (!panel || !panel.classList.contains("mm-panel-visible")) return;

        try {
            const currentBooks = await getImportedWorldBooks();
            if (currentBooks.length === 0) return;

            const newSnapshot = createWorldBooksSnapshot(currentBooks);

            if (worldBooksSnapshot) {
                const changes = detectWorldBookChanges(worldBooksSnapshot, newSnapshot);
                if (changes.length > 0) {
                    Logger.log("轮询检测到世界书变化:", changes);
                    addUpdates(changes);
                }
            }

            worldBooksSnapshot = newSnapshot;
        } catch (error) {
            Logger.error("轮询检测世界书变化失败:", error);
        }
    }, POLLING_INTERVAL);

    Logger.log("世界书轮询已启动");
}

/**
 * 停止世界书轮询
 */
export function stopWorldBookPolling() {
    if (worldBookPollingTimer) {
        clearInterval(worldBookPollingTimer);
        worldBookPollingTimer = null;
        Logger.log("世界书轮询已停止");
    }
}

/**
 * 获取更新列表
 * @returns {Array} 更新列表
 */
export function getUpdatesList() {
    return updatesList;
}

/**
 * 重置世界书快照
 */
export function resetWorldBooksSnapshot() {
    worldBooksSnapshot = null;
}
