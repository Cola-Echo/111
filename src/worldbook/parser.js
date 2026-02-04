/**
 * 世界书解析模块
 * @module worldbook/parser
 */

import Logger from '@core/logger';
import { getGlobalSettings } from '@config/config-manager';

/**
 * 解析旧的方括号格式
 * @param {string} comment 注释内容
 * @returns {object|null} { category, isIndex } 或 null
 */
export function parseOldBracketFormat(comment) {
    if (!comment) return null;

    // 格式: 【XXX】xxx (必须以【开头)
    const oldMatch = comment.match(/^【([^】]+)】/);
    if (oldMatch) {
        return {
            category: oldMatch[1].trim(),
            isIndex: comment.toLowerCase().includes("[index]")
        };
    }
    return null;
}

/**
 * 解析世界书结构
 * @param {object} book 世界书对象
 * @returns {object} { categories: { [categoryName]: { index: [], details: [] } } }
 */
export function parseWorldBook(book) {
    if (!book || !book.entries) return { categories: {} };

    const categories = {};

    for (const [uid, entry] of Object.entries(book.entries)) {
        // SillyTavern 使用 disable 字段（true 表示禁用），而不是 enabled
        // 如果 disable 为 true，跳过该条目
        if (entry.disable === true) continue;

        const comment = entry.comment || "";

        // 识别分类名称，支持多种格式：
        // 1. "[Amily2] Index for 角色表" -> 分类: 角色表, 类型: index
        // 2. "[Amily2] Detail: 角色表 - 江晦" -> 分类: 角色表, 类型: detail
        // 3. "【角色表】xxx" -> 分类: 角色表（旧格式兼容）

        let category = "未分类";
        let isIndex = false;

        // 格式1: Index for XXX
        const indexMatch = comment.match(/Index\s+for\s+(.+?)(?:\s*$|\s*[.\[])/i);
        if (indexMatch) {
            category = indexMatch[1].trim();
            isIndex = true;
        } else {
            // 格式2: Detail: XXX - YYY
            const detailMatch = comment.match(/Detail:\s*(.+?)\s*-\s*/i);
            if (detailMatch) {
                category = detailMatch[1].trim();
                isIndex = false;
            } else {
                // 格式3: 【XXX】（旧格式兼容）
                const oldFormat = parseOldBracketFormat(comment);
                if (oldFormat) {
                    category = oldFormat.category;
                    isIndex = oldFormat.isIndex;
                }
            }
        }

        if (!categories[category]) {
            categories[category] = { index: [], details: [] };
        }

        if (isIndex) {
            categories[category].index.push({
                uid,
                comment,
                content: entry.content,
                keys: entry.key || [],
            });
        } else {
            categories[category].details.push({
                uid,
                comment,
                content: entry.content,
                keys: entry.key || [],
            });
        }
    }

    return { categories };
}

/**
 * 格式化为世界书内容字符串
 * @param {Array} indexEntries 索引条目数组
 * @param {Array} detailEntries 详情条目数组
 * @returns {string} 格式化后的内容
 */
export function formatAsWorldBook(indexEntries, detailEntries) {
    let result = "";
    const settings = getGlobalSettings();
    const sendIndexOnly = settings.sendIndexOnly === true;

    if (indexEntries && indexEntries.length > 0) {
        result += "=== Index ===\n";
        for (const entry of indexEntries) {
            result += `[${entry.comment}]\n${entry.content}\n\n`;
        }
    }

    if (!sendIndexOnly && detailEntries && detailEntries.length > 0) {
        result += "=== Details ===\n";
        for (const entry of detailEntries) {
            let categoryName = "档案";
            const categoryMatch = entry.comment?.match(/Detail:\s*([^-]+)\s*-/i);
            if (categoryMatch) {
                categoryName = categoryMatch[1].trim();
            }

            const keyword = entry.keys && entry.keys.length > 0 ? entry.keys[0] : "";

            if (keyword) {
                result += `【${categoryName}档案: ${keyword}】\n`;
            }

            result += `[${entry.comment}]\n${entry.content}\n\n`;
        }
    }

    return result;
}

/**
 * 获取总结世界书的内容
 * @param {object} book 世界书对象
 * @returns {string} 世界书内容
 */
export function getSummaryContent(book) {
    if (!book || !book.entries) return "";

    let content = "";
    for (const [uid, entry] of Object.entries(book.entries)) {
        // SillyTavern 世界书使用 disable 字段（true=禁用，false=启用）
        // 兼容两种字段名：disable 和 enabled
        const isDisabled = entry.disable === true || entry.enabled === false;
        if (isDisabled) continue;
        content += entry.content + "\n\n";
    }
    return content;
}

/**
 * 获取世界书中的所有分类名称
 * @param {object} book 世界书对象
 * @returns {Array<string>} 分类名称数组
 */
export function getCategories(book) {
    const parsed = parseWorldBook(book);
    return Object.keys(parsed.categories);
}

/**
 * 获取指定分类的条目
 * @param {object} book 世界书对象
 * @param {string} category 分类名称
 * @returns {object} { index: [], details: [] }
 */
export function getCategoryEntries(book, category) {
    const parsed = parseWorldBook(book);
    return parsed.categories[category] || { index: [], details: [] };
}
