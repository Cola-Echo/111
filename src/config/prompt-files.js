/**
 * 提示词文件存储模块
 * @module config/prompt-files
 */

import Logger from '@core/logger';
import { loadConfig, saveConfig } from './config-manager';

/**
 * 获取所有已保存的提示词文件
 * @returns {object} 提示词文件映射 { filename: jsonString }
 */
export function getImportedPromptFiles() {
    const config = loadConfig();
    return config.importedPromptFiles || {};
}

/**
 * 保存所有提示词文件
 * @param {object} files 提示词文件映射
 */
export function saveImportedPromptFiles(files) {
    const config = loadConfig();
    config.importedPromptFiles = files;
    saveConfig(config);
    Logger.debug("提示词文件已保存到服务器");
}

/**
 * 保存单个提示词文件
 * @param {string} filename 文件名
 * @param {string} jsonString JSON 字符串
 */
export function savePromptFileData(filename, jsonString) {
    const files = getImportedPromptFiles();
    files[filename] = jsonString;
    saveImportedPromptFiles(files);
}

/**
 * 获取单个提示词文件
 * @param {string} filename 文件名
 * @returns {string|null} JSON 字符串或 null
 */
export function getPromptFileData(filename) {
    const files = getImportedPromptFiles();
    return files[filename] || null;
}

/**
 * 删除单个提示词文件
 * @param {string} filename 文件名
 * @returns {boolean} 是否成功删除
 */
export function deletePromptFileData(filename) {
    const files = getImportedPromptFiles();
    if (files[filename]) {
        delete files[filename];
        saveImportedPromptFiles(files);
        return true;
    }
    return false;
}

/**
 * 获取所有提示词文件名列表
 * @returns {Array<string>} 文件名数组
 */
export function getPromptFileNames() {
    const files = getImportedPromptFiles();
    return Object.keys(files);
}

/**
 * 检查提示词文件是否存在
 * @param {string} filename 文件名
 * @returns {boolean}
 */
export function hasPromptFile(filename) {
    const files = getImportedPromptFiles();
    return filename in files;
}
