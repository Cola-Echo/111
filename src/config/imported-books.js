/**
 * 已导入世界书管理模块
 * @module config/imported-books
 */

import Logger from '@core/logger';
import { loadConfig, saveConfig } from './config-manager';

/**
 * 获取已导入的世界书名称列表
 * @returns {Array<string>} 世界书名称数组
 */
export function getImportedBookNames() {
    try {
        // 从配置中获取
        const config = loadConfig();
        if (config && config.importedBooks) {
            return config.importedBooks;
        }
        // 回退到 localStorage（兼容旧数据）
        const saved = localStorage.getItem("memory_manager_imported_books");
        if (saved) {
            const books = JSON.parse(saved);
            // 迁移到配置中
            if (config) {
                config.importedBooks = books;
                saveConfig(config);
                Logger.log("已导入世界书列表已迁移到配置");
            }
            return books;
        }
        return [];
    } catch (e) {
        Logger.error("加载已导入世界书列表失败:", e);
        return [];
    }
}

/**
 * 保存已导入的世界书名称列表
 * @param {Array<string>} names 世界书名称数组
 */
export function saveImportedBookNames(names) {
    try {
        const config = loadConfig();
        config.importedBooks = names;
        saveConfig(config);
    } catch (e) {
        Logger.error("保存已导入世界书列表失败:", e);
        // 回退到 localStorage
        localStorage.setItem(
            "memory_manager_imported_books",
            JSON.stringify(names)
        );
    }
}

/**
 * 添加已导入的世界书
 * @param {string} name 世界书名称
 */
export function addImportedBook(name) {
    const names = getImportedBookNames();
    if (!names.includes(name)) {
        names.push(name);
        saveImportedBookNames(names);
    }
}

/**
 * 移除已导入的世界书
 * @param {string} name 世界书名称
 */
export function removeImportedBook(name) {
    const names = getImportedBookNames();
    const index = names.indexOf(name);
    if (index > -1) {
        names.splice(index, 1);
        saveImportedBookNames(names);
    }
}

/**
 * 检查世界书是否已导入
 * @param {string} name 世界书名称
 * @returns {boolean}
 */
export function isBookImported(name) {
    return getImportedBookNames().includes(name);
}
