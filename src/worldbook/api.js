/**
 * 世界书 API 模块
 * @module worldbook/api
 */

import Logger from '@core/logger';
import { getContext, getWorldNames, loadWorldInfo } from '@core/sillytavern-api';
import { getImportedBookNames } from '@config/imported-books';
import { parseWorldBook } from './parser';

/**
 * 获取酒馆中所有可用的世界书列表（包括未启用的）
 * @returns {Promise<Array<string>>} 世界书名称数组
 */
export async function getAllAvailableWorldBooks() {
    try {
        // 方法1: 使用 SillyTavern Context API（官方推荐）
        const worldNames = getWorldNames();
        if (worldNames && worldNames.length > 0) {
            return [...worldNames];
        }

        // 方法2: 从 DOM 中提取世界书列表（从世界书选择下拉框）
        const worldInfoSelect = document.getElementById("world_info");
        if (worldInfoSelect) {
            const options = worldInfoSelect.querySelectorAll("option");
            const names = [];
            options.forEach((opt) => {
                const name = opt.textContent?.trim() || opt.text?.trim();
                if (name && name !== "" && name !== "None" && name !== "— None —") {
                    names.push(name);
                }
            });
            if (names.length > 0) {
                return names;
            }
        }

        // 方法3: 从角色世界书选择框提取
        const charWorldSelect = document.getElementById("character_world");
        if (charWorldSelect) {
            const options = charWorldSelect.querySelectorAll("option");
            const names = [];
            options.forEach((opt) => {
                const name = opt.textContent?.trim() || opt.text?.trim();
                if (name && name !== "" && name !== "None" && name !== "— None —") {
                    names.push(name);
                }
            });
            if (names.length > 0) {
                return names;
            }
        }

        // 方法4: 尝试通过 jQuery 选择器
        if (typeof jQuery !== "undefined" || typeof $ !== "undefined") {
            const jq = typeof jQuery !== "undefined" ? jQuery : $;
            const $select = jq("#world_info, #character_world");
            if ($select.length > 0) {
                const names = [];
                $select.first().find("option").each(function() {
                    const name = jq(this).text().trim();
                    if (name && name !== "" && name !== "None" && name !== "— None —") {
                        names.push(name);
                    }
                });
                if (names.length > 0) {
                    return names;
                }
            }
        }

        // 方法5: 尝试通过 SillyTavern REST API 获取
        try {
            let headers = { "Content-Type": "application/json" };
            const context = getContext();
            if (context && typeof context.getRequestHeaders === "function") {
                headers = context.getRequestHeaders();
            }

            const response = await fetch("/api/worldinfo/get", {
                method: "POST",
                headers: headers,
                body: JSON.stringify({}),
            });
            if (response.ok) {
                const data = await response.json();
                if (data && Array.isArray(data)) {
                    const names = data.map((item) => item.name || item).filter((n) => n);
                    if (names.length > 0) {
                        return names;
                    }
                }
            }
        } catch (apiErr) {
            // 忽略API错误，继续尝试其他方法
        }

        // 方法6: 尝试获取全局世界书列表
        if (typeof window !== 'undefined' && typeof window.selected_world_info !== "undefined") {
            if (Array.isArray(window.selected_world_info)) {
                return [...window.selected_world_info];
            }
        }

        Logger.warn("无法获取世界书列表，请确保 SillyTavern 已完全加载");
        return [];
    } catch (e) {
        Logger.error("获取世界书列表失败:", e);
        return [];
    }
}

/**
 * 获取世界书列表（快速版，不加载条目数量）
 * @returns {Promise<Array<{name: string, entryCount: number}>>}
 */
export async function getWorldBookList() {
    try {
        const worldBookNames = await getAllAvailableWorldBooks();
        // 快速返回，不加载每个世界书的条目数量
        return worldBookNames.map((name) => ({ name, entryCount: -1 }));
    } catch (e) {
        Logger.error("获取世界书列表失败:", e);
        return [];
    }
}

/**
 * 通过名称加载世界书内容
 * @param {string} name 世界书名称
 * @returns {Promise<object|null>} 世界书数据
 */
export async function loadWorldBookByName(name) {
    try {
        // 优先使用官方 API
        const book = await loadWorldInfo(name);
        if (book) {
            return { name, ...book };
        }

        // 备用方案：通过 API 获取
        let headers = { "Content-Type": "application/json" };
        const context = getContext();
        if (context && typeof context.getRequestHeaders === "function") {
            headers = context.getRequestHeaders();
        }

        const response = await fetch("/api/worldinfo/get", {
            method: "POST",
            headers: headers,
            body: JSON.stringify({ name }),
        });

        if (response.ok) {
            const data = await response.json();
            if (data && data.entries) {
                return { name, ...data };
            }
        }

        return null;
    } catch (e) {
        Logger.error(`加载世界书 "${name}" 失败:`, e);
        return null;
    }
}

/**
 * 获取世界书条目数量（延迟加载）
 * @param {string} bookName 世界书名称
 * @returns {Promise<number>} 条目数量
 */
export async function getWorldBookEntryCount(bookName) {
    try {
        const bookData = await loadWorldBookByName(bookName);
        return bookData?.entries ? Object.keys(bookData.entries).length : 0;
    } catch (e) {
        return 0;
    }
}

/**
 * 获取世界书条目列表
 * @param {string} bookName 世界书名称
 * @returns {Promise<Array>} 条目数组
 */
export async function getWorldBookEntries(bookName) {
    try {
        const bookData = await loadWorldBookByName(bookName);
        if (!bookData || !bookData.entries) {
            return [];
        }
        return Object.values(bookData.entries);
    } catch (e) {
        Logger.error(`获取世界书 "${bookName}" 条目失败:`, e);
        return [];
    }
}

/**
 * 获取已导入的世界书数据
 * @returns {Promise<Array<object>>} 世界书数据数组
 */
export async function getImportedWorldBooks() {
    const bookNames = getImportedBookNames();
    const books = [];

    for (const name of bookNames) {
        const book = await loadWorldBookByName(name);
        if (book) {
            books.push(book);
        }
    }

    return books;
}

/**
 * 判断世界书是否是总结类型
 * @param {string} bookName 世界书名称
 * @returns {boolean}
 */
export function isSummaryBook(bookName) {
    // 根据命名规则判断
    return (
        bookName.includes("敕史局") ||
        bookName.includes("Summary") ||
        bookName.includes("summary") ||
        bookName.includes("Lore-char") ||
        bookName.includes("lore-char") ||
        bookName.includes("总结") ||
        bookName.includes("汇总") ||
        bookName.includes("归纳")
    );
}

/**
 * 判断世界书是否是记忆类型
 * @param {object|string} bookOrName 世界书对象或名称
 * @returns {boolean}
 */
export function isMemoryBook(bookOrName) {
    // 如果传入的是对象（世界书），解析它
    if (typeof bookOrName === 'object' && bookOrName !== null) {
        const parsed = parseWorldBook(bookOrName);
        return Object.keys(parsed.categories).length > 0;
    }
    // 如果传入的是字符串（书名），使用简单判断
    return !isSummaryBook(bookOrName);
}

/**
 * 分类世界书
 * @param {Array<object>} worldBooks 世界书数据数组
 * @returns {object} { memoryBooks: [], summaryBooks: [], unknownBooks: [] }
 */
export function classifyWorldBooks(worldBooks) {
    const memoryBooks = [];
    const summaryBooks = [];
    const unknownBooks = [];

    for (const book of worldBooks) {
        const name = book.name || "";

        // 先检查书名
        let isSummary = isSummaryBook(name);

        // 如果书名没有匹配，再检查条目的 comment 是否包含 '敕史局'
        if (!isSummary && book.entries) {
            for (const [uid, entry] of Object.entries(book.entries)) {
                const comment = entry.comment || "";
                if (comment.includes("敕史局")) {
                    isSummary = true;
                    Logger.debug(
                        `世界书 "${name}" 通过条目comment识别为总结类型`,
                    );
                    break;
                }
            }
        }

        if (isSummary) {
            summaryBooks.push(book);
            Logger.debug(`世界书 "${name}" 识别为总结类型`);
        } else {
            const parsed = parseWorldBook(book);
            const categoryCount = Object.keys(parsed.categories).length;
            // 检查是否有非"未分类"的分类
            const hasValidCategories = Object.keys(parsed.categories).some(
                (c) => c !== "未分类",
            );

            if (categoryCount > 0 && hasValidCategories) {
                memoryBooks.push({
                    book,
                    categories: parsed.categories,
                });
                Logger.debug(
                    `世界书 "${name}" 识别为记忆类型，分类: ${Object.keys(
                        parsed.categories,
                    ).join(", ")}`,
                );
            } else if (categoryCount > 0) {
                // 有条目但都是未分类，也作为记忆世界书处理
                memoryBooks.push({
                    book,
                    categories: parsed.categories,
                });
                Logger.debug(`世界书 "${name}" 作为未分类记忆世界书处理`);
            } else {
                unknownBooks.push(book);
                Logger.warn(
                    `世界书 "${name}" 无法识别类型（无启用的条目）`,
                );
            }
        }
    }

    return { memoryBooks, summaryBooks, unknownBooks };
}
