/**
 * 提示词模板加载模块
 * @module utils/prompt-template
 */

import Logger from '@core/logger';
import { detectExtensionPath } from '@core/constants';
import { getGlobalSettings, updateGlobalSettings } from '@config/config-manager';
import { getImportedPromptFiles, savePromptFileData } from '@config/prompt-files';

// 缓存
let PROMPT_TEMPLATE = null; // 关键词提示词模板（分类/并发/索引合并）
let PROMPT_TEMPLATE_HISTORICAL = null; // 历史事件回忆提示词模板（总结世界书）

// 内置提示词缓存键前缀（用于区分用户导入和内置缓存）
const BUILTIN_CACHE_PREFIX = '__builtin__';

/**
 * 获取内置提示词的缓存键
 * @param {string} filename - 文件名
 * @returns {string} 缓存键
 */
function getBuiltinCacheKey(filename) {
    return `${BUILTIN_CACHE_PREFIX}${filename}`;
}

/**
 * 加载提示词模板
 * @param {string} filename - 文件名（相对于 prompts 目录）
 * @param {boolean} forceRefresh - 是否强制刷新（从服务器重新加载）
 * @returns {Promise<Object>} 提示词模板对象
 */
export async function loadPromptTemplate(filename, forceRefresh = false) {
    const importedFiles = getImportedPromptFiles();
    const builtinCacheKey = getBuiltinCacheKey(filename);

    // 1. 优先检查用户导入的文件（最高优先级）
    if (importedFiles[filename]) {
        Logger.debug(`[提示词] 使用用户导入的文件: ${filename}`);
        const jsonData = JSON.parse(importedFiles[filename]);
        return Array.isArray(jsonData) ? jsonData[0] : jsonData;
    }

    // 2. 检查是否有内置提示词的持久化缓存（非强制刷新时）
    if (!forceRefresh && importedFiles[builtinCacheKey]) {
        Logger.debug(`[提示词] 使用持久化缓存: ${filename}`);
        const jsonData = JSON.parse(importedFiles[builtinCacheKey]);
        return Array.isArray(jsonData) ? jsonData[0] : jsonData;
    }

    // 3. 持久化缓存不存在，从服务器获取
    try {
        const basePath = await detectExtensionPath();
        const parts = filename.split("/");
        const encodedParts = parts.map((p) => encodeURIComponent(p));
        const encodedFilename = encodedParts.join("/");

        const cacheBuster = `?_t=${Date.now()}_r=${Math.random().toString(36).substring(7)}`;
        const response = await fetch(
            `${basePath}/prompts/${encodedFilename}${cacheBuster}`,
            {
                cache: "no-store",
                headers: {
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    Pragma: "no-cache",
                    Expires: "0",
                },
            }
        );
        if (!response.ok) {
            throw new Error(`加载提示词失败: ${response.status}`);
        }
        const templates = await response.json();
        const result = Array.isArray(templates) ? templates[0] : templates;

        // 4. 服务器获取成功，保存到持久化缓存
        try {
            savePromptFileData(builtinCacheKey, JSON.stringify(templates));
            Logger.debug(`[提示词] 已保存到持久化缓存: ${filename}`);
        } catch (cacheError) {
            Logger.warn(`[提示词] 保存持久化缓存失败:`, cacheError);
        }

        return result;
    } catch (error) {
        // 5. 服务器获取失败，尝试使用持久化缓存（即使是强制刷新模式）
        if (importedFiles[builtinCacheKey]) {
            Logger.warn(`[提示词] 服务器获取失败，使用持久化缓存: ${filename}`);
            const jsonData = JSON.parse(importedFiles[builtinCacheKey]);
            return Array.isArray(jsonData) ? jsonData[0] : jsonData;
        }

        Logger.error("加载提示词失败:", error);
        throw error;
    }
}

/**
 * 获取关键词提示词模板（用于分类/并发/索引合并API）
 * @returns {Promise<Object>} 提示词模板对象
 */
export async function getPromptTemplate() {
    if (!PROMPT_TEMPLATE) {
        const settings = getGlobalSettings();
        let selectedFile = settings.keywordsPromptFile || settings.selectedPromptFile;

        // 如果没有配置，尝试从 manifest.json 自动查找 keywords 文件夹中的提示词
        if (!selectedFile) {
            const basePath = await detectExtensionPath();

            // 优先从 manifest.json 读取文件列表
            let fileList = [];
            try {
                const manifestPath = `${basePath}/prompts/manifest.json?_t=${Date.now()}`;
                const manifestResponse = await fetch(manifestPath, {
                    cache: "no-store",
                });
                if (manifestResponse.ok) {
                    const manifest = await manifestResponse.json();
                    if (manifest.files && Array.isArray(manifest.files.keywords)) {
                        fileList = manifest.files.keywords;
                    }
                }
            } catch (e) {
                Logger.debug("[提示词] manifest.json 读取失败，使用fallback");
            }

            // 如果 manifest 没有文件，使用 fallback
            if (fileList.length === 0) {
                fileList = [
                    "记忆管理系统-关键词 v1.15 （记忆管理并发系统专用）.json",
                    "记忆管理系统1.15（记忆管理并发系统专用）.json",
                ];
            }

            for (const pattern of fileList) {
                try {
                    const testPath = `${basePath}/prompts/keywords/${encodeURIComponent(pattern)}`;
                    const testResponse = await fetch(testPath, {
                        method: "HEAD",
                    });
                    if (testResponse.ok) {
                        selectedFile = `keywords/${pattern}`;
                        // 保存找到的文件
                        updateGlobalSettings({
                            keywordsPromptFile: selectedFile,
                        });
                        break;
                    }
                } catch (e) {
                    // 忽略
                }
            }
        }

        if (selectedFile) {
            PROMPT_TEMPLATE = await loadPromptTemplate(selectedFile);
        }
    }
    return PROMPT_TEMPLATE;
}

/**
 * 获取历史事件回忆提示词模板（用于总结世界书API）
 * @returns {Promise<Object>} 提示词模板对象
 */
export async function getHistoricalPromptTemplate() {
    if (!PROMPT_TEMPLATE_HISTORICAL) {
        const settings = getGlobalSettings();
        let selectedFile = settings.historicalPromptFile;

        // 如果没有配置，尝试从 manifest.json 自动查找 historical 文件夹中的提示词
        if (!selectedFile) {
            const basePath = await detectExtensionPath();

            // 优先从 manifest.json 读取文件列表
            let fileList = [];
            try {
                const manifestPath = `${basePath}/prompts/manifest.json?_t=${Date.now()}`;
                const manifestResponse = await fetch(manifestPath, {
                    cache: "no-store",
                });
                if (manifestResponse.ok) {
                    const manifest = await manifestResponse.json();
                    if (manifest.files && Array.isArray(manifest.files.historical)) {
                        fileList = manifest.files.historical;
                    }
                }
            } catch (e) {
                Logger.debug("[提示词] manifest.json 读取失败，使用fallback");
            }

            // 如果 manifest 没有文件，使用 fallback
            if (fileList.length === 0) {
                fileList = [
                    "忆管理系统-历史事件回忆 v1.15 （记忆管理并发系统专用）.json",
                    "历史事件回忆提示词1.0.json",
                ];
            }

            for (const pattern of fileList) {
                try {
                    const testPath = `${basePath}/prompts/historical/${encodeURIComponent(pattern)}`;
                    const testResponse = await fetch(testPath, {
                        method: "HEAD",
                    });
                    if (testResponse.ok) {
                        selectedFile = `historical/${pattern}`;
                        // 保存找到的文件
                        updateGlobalSettings({
                            historicalPromptFile: selectedFile,
                        });
                        break;
                    }
                } catch (e) {
                    // 忽略
                }
            }
        }

        if (selectedFile) {
            PROMPT_TEMPLATE_HISTORICAL = await loadPromptTemplate(selectedFile);
        } else {
            // 如果仍然没有找到，回退到关键词提示词
            Logger.warn("[提示词] 未找到历史事件提示词，回退到关键词提示词");
            return await getPromptTemplate();
        }
    }
    return PROMPT_TEMPLATE_HISTORICAL;
}

/**
 * 获取剧情优化提示词模板（用于剧情优化API）
 * @returns {Promise<Object|null>} 提示词模板对象
 */
export async function getPlotOptimizePromptTemplate() {
    const settings = getGlobalSettings();
    const plotConfig = settings.plotOptimizeConfig || {};
    let selectedFile = plotConfig.promptFile;

    // 如果没有配置，尝试从 manifest.json 自动查找 plot-optimize 文件夹中的提示词
    if (!selectedFile) {
        const basePath = await detectExtensionPath();

        // 优先从 manifest.json 读取文件列表
        let fileList = [];
        try {
            const manifestPath = `${basePath}/prompts/manifest.json?_t=${Date.now()}`;
            const manifestResponse = await fetch(manifestPath, {
                cache: "no-store",
            });
            if (manifestResponse.ok) {
                const manifest = await manifestResponse.json();
                if (manifest.files && Array.isArray(manifest.files["plot-optimize"])) {
                    fileList = manifest.files["plot-optimize"];
                }
            }
        } catch (e) {
            Logger.debug("[提示词] manifest.json 读取失败，使用fallback");
        }

        // 如果 manifest 没有文件，使用 fallback
        if (fileList.length === 0) {
            fileList = [
                "记忆管理系统-剧情优化 v1.0（记忆管理并发系统专用）.json",
                "剧情优化-对话模式.json",
                "剧情优化-对话模式提示词.json",
            ];
        }

        for (const pattern of fileList) {
            try {
                const testPath = `${basePath}/prompts/plot-optimize/${encodeURIComponent(pattern)}`;
                const testResponse = await fetch(testPath, {
                    method: "HEAD",
                });
                if (testResponse.ok) {
                    selectedFile = `plot-optimize/${pattern}`;
                    // 保存找到的文件
                    const updatedPlotConfig = {
                        ...plotConfig,
                        promptFile: selectedFile,
                    };
                    updateGlobalSettings({
                        plotOptimizeConfig: updatedPlotConfig,
                    });
                    break;
                }
            } catch (e) {
                // 忽略
            }
        }
    }

    if (selectedFile) {
        return await loadPromptTemplate(selectedFile);
    } else {
        Logger.warn("[提示词] 未找到剧情优化提示词");
        return null;
    }
}

/**
 * 清除提示词缓存
 */
export function clearPromptTemplateCache() {
    PROMPT_TEMPLATE = null;
    PROMPT_TEMPLATE_HISTORICAL = null;
}

/**
 * 重新加载关键词提示词
 */
export async function reloadKeywordsPromptTemplate() {
    PROMPT_TEMPLATE = null;
    return await getPromptTemplate();
}

/**
 * 重新加载历史事件提示词
 */
export async function reloadHistoricalPromptTemplate() {
    PROMPT_TEMPLATE_HISTORICAL = null;
    return await getHistoricalPromptTemplate();
}
