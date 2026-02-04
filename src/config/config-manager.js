﻿/**
 * 配置管理模块
 * @module config/config-manager
 */

import Logger from '@core/logger';
import { EXTENSION_NAME } from '@core/constants';
import { getExtensionSettings, saveSettingsDebounced as stSaveSettings } from '@core/sillytavern-api';
import { defaultConfig } from './default-config';

const OLD_DATA_MAX_AGE_MS = 60_000;

function getSavedAt(config) {
    return (
        config?.__meta?.lastSavedAt ??
        config?.__meta?.savedAt ??
        config?.savedAt ??
        config?.updatedAt ??
        0
    );
}

function isOldData(config, maxAgeMs = OLD_DATA_MAX_AGE_MS) {
    const ts = getSavedAt(config);
    if (!ts || typeof ts !== 'number') return true;
    return (Date.now() - ts) > maxAgeMs;
}

function touchConfigMeta(config) {
    if (!config || typeof config !== 'object') return;
    if (!config.__meta || typeof config.__meta !== 'object') config.__meta = {};
    config.__meta.lastSavedAt = Date.now();
}

/**
 * 递归合并默认配置值
 * 用于处理版本升级时新增的配置字段
 * @param {object} target 目标配置
 * @param {object} defaults 默认配置
 */
function mergeDefaults(target, defaults) {
    for (const key of Object.keys(defaults)) {
        if (!Object.hasOwn(target, key)) {
            target[key] = structuredClone(defaults[key]);
            Logger.log(`[配置] 添加缺失键: ${key}`);
        } else if (
            typeof defaults[key] === 'object' &&
            defaults[key] !== null &&
            !Array.isArray(defaults[key])
        ) {
            mergeDefaults(target[key], defaults[key]);
        }
    }
}

/**
 * 迁移旧版本配置到新版本
 * @param {object} config 配置对象
 * @returns {boolean} 是否进行了迁移
 */
function migrateConfig(config) {
    let migrated = false;

    // 确保 global 对象存在
    if (!config.global) {
        config.global = {};
        migrated = true;
        Logger.log("[配置迁移] 创建 global 对象");
    }

    // 迁移 enablePlotOptimize: 从根级别移到 global 内
    if (Object.hasOwn(config, 'enablePlotOptimize') && !Object.hasOwn(config.global, 'enablePlotOptimize')) {
        config.global.enablePlotOptimize = config.enablePlotOptimize;
        delete config.enablePlotOptimize;
        migrated = true;
        Logger.log("[配置迁移] enablePlotOptimize 已从根级别迁移到 global");
    }

    // 迁移其他可能在错误位置的设置到 global 内
    const globalKeys = [
        'enabled', 'showLogs', 'showFloatBall', 'relevanceThreshold', 'contextRounds',
        'showRequestPreview', 'sendIndexOnly', 'showSummaryCheck', 'enableRecentPlot',
        'indexMergeEnabled', 'enableInteractiveSearch'
    ];

    for (const key of globalKeys) {
        if (Object.hasOwn(config, key) && !Object.hasOwn(config.global, key)) {
            config.global[key] = config[key];
            delete config[key];
            migrated = true;
            Logger.log(`[配置迁移] ${key} 已从根级别迁移到 global`);
        }
    }

    return migrated;
}

/**
 * 获取配置（使用 SillyTavern 官方 API）
 * @returns {object} 配置对象
 */
export function loadConfig() {
    try {
        const extensionSettings = getExtensionSettings();
        if (extensionSettings && Object.keys(extensionSettings).length > 0) {
            // 初始化配置（如果不存在）
            if (!extensionSettings[EXTENSION_NAME]) {
                extensionSettings[EXTENSION_NAME] = structuredClone(defaultConfig);
                // 尝试从 localStorage 迁移旧数据
                const saved = localStorage.getItem("memory_manager_concurrent_config");
                if (saved) {
                    try {
                        const oldConfig = JSON.parse(saved);
                        // 防止“旧数据覆盖新版本默认配置”：一分钟前就视为旧数据
                        if (!isOldData(oldConfig, OLD_DATA_MAX_AGE_MS)) {
                            extensionSettings[EXTENSION_NAME] = oldConfig;
                            Logger.log("已从 localStorage 迁移配置到 extensionSettings");
                            saveConfig(oldConfig);
                        } else {
                            Logger.log("跳过 localStorage 旧配置迁移（数据过旧）");
                        }
                    } catch (e) {
                        Logger.warn("迁移旧配置失败:", e);
                    }
                }
            }

            // 执行配置迁移（处理旧版本配置结构）
            const config = extensionSettings[EXTENSION_NAME];
            const migrated = migrateConfig(config);

            // 递归合并默认值（处理版本升级时缺失的嵌套字段）
            mergeDefaults(config, defaultConfig);

            // 如果进行了迁移，保存配置
            if (migrated) {
                saveConfig(config);
                Logger.log("[配置] 版本迁移完成，已保存");
            }

            return config;
        }

        // 回退到 localStorage（SillyTavern 未就绪时）
        const saved = localStorage.getItem("memory_manager_concurrent_config");
        if (saved) {
            return JSON.parse(saved);
        }

        return structuredClone(defaultConfig);
    } catch (e) {
        Logger.error("加载配置失败:", e);
        return structuredClone(defaultConfig);
    }
}

/**
 * 保存配置（使用 SillyTavern 官方 API）
 * @param {object} config 配置对象
 */
export function saveConfig(config) {
    try {
        touchConfigMeta(config);
        const extensionSettings = getExtensionSettings();
        if (extensionSettings && Object.keys(extensionSettings).length > 0) {
            extensionSettings[EXTENSION_NAME] = config;
            stSaveSettings();
            Logger.debug("配置已通过 SillyTavern API 保存");
        }

        // 同步一份到 localStorage，便于兼容/排障（带时间戳，避免“旧数据覆盖”）
        try {
            localStorage.setItem("memory_manager_concurrent_config", JSON.stringify(config));
        } catch {
            // ignore
        }
    } catch (e) {
        Logger.error("保存配置失败:", e);
    }
}

/**
 * 清除旧数据（1分钟前就算旧数据），但保留各板块已配置的 API 信息
 * - 保留：memoryConfigs / summaryConfigs / global.indexMergeConfig(API相关字段) / global.plotOptimizeConfig(API相关字段) / global.multiAIGeneration.providers(API相关字段)
 * - 清除：提示词预设、已导入世界书记录、提示词文件缓存、UI位置缓存等
 * - 提示词文件设置会被清空，插件会自动加载内置提示词
 */
export function clearOldData(maxAgeMs = OLD_DATA_MAX_AGE_MS) {
    const config = loadConfig();
    const preserved = {
        memoryConfigs: structuredClone(config?.memoryConfigs || {}),
        summaryConfigs: structuredClone(config?.summaryConfigs || {}),
        indexMergeConfig: structuredClone(config?.global?.indexMergeConfig || {}),
        plotOptimizeConfig: structuredClone(config?.global?.plotOptimizeConfig || {}),
        providers: structuredClone(config?.global?.multiAIGeneration?.providers || []),
    };

    // 保留完整的 API 配置字段（包括 enabled 等）
    const pickApiFields = (obj, defaults = {}) => {
        const fields = [
            "enabled",
            "apiFormat",
            "apiUrl",
            "apiKey",
            "model",
            "maxTokens",
            "temperature",
            "relevanceThreshold",
            "maxKeywords",
            "maxHistoryEvents",
            "customTemplate",
            "responsePath",
            // plotOptimizeConfig 特有的上下文配置也保留
            "contextRounds",
            "selectedBooks",
            "selectedEntries",
            "includeCharDescription",
        ];
        const out = { ...defaults };
        for (const f of fields) {
            if (Object.hasOwn(obj || {}, f)) out[f] = obj[f];
        }
        return out;
    };

    const sanitizedProviders = (preserved.providers || []).map((p) => ({
        id: p?.id || "",
        name: p?.name || "",
        enabled: p?.enabled !== false,
        apiFormat: p?.apiFormat || "openai",
        apiUrl: p?.apiUrl || "",
        apiKey: p?.apiKey || "",
        model: p?.model || "",
        maxTokens: typeof p?.maxTokens === "number" ? p.maxTokens : 4000,
        temperature: typeof p?.temperature === "number" ? p.temperature : 0.7,
        streaming: p?.streaming !== false,
        customTemplate: p?.customTemplate || "",
        responsePath: p?.responsePath || "choices.0.message.content",
        // 清除与“非API”相关的旧数据引用
        usePromptPreset: false,
        promptPresetId: "",
    }));

    const newConfig = structuredClone(defaultConfig);
    newConfig.memoryConfigs = preserved.memoryConfigs;
    newConfig.summaryConfigs = preserved.summaryConfigs;
    newConfig.global.indexMergeConfig = pickApiFields(preserved.indexMergeConfig, newConfig.global.indexMergeConfig);
    newConfig.global.plotOptimizeConfig = pickApiFields(preserved.plotOptimizeConfig, newConfig.global.plotOptimizeConfig);
    newConfig.global.multiAIGeneration.providers = sanitizedProviders;
    saveConfig(newConfig);

    // localStorage 旧数据清理（无时间戳的也视为旧）
    const keysToClear = [
        "memory_manager_concurrent_config",
        "memory_manager_imported_books",
        "mm_progress_panel_position",
        "mm-worldbook-recursion-settings",
    ];
    for (const key of keysToClear) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            let shouldClear = true;
            try {
                const parsed = JSON.parse(raw);
                shouldClear = isOldData(parsed, maxAgeMs);
            } catch {
                // Non-JSON values don't have timestamps; treat as old.
                shouldClear = true;
            }
            if (shouldClear) localStorage.removeItem(key);
        } catch {
            // ignore
        }
    }
}

/**
 * 获取全局设置
 * @returns {object} 全局设置对象
 */
export function getGlobalSettings() {
    const config = loadConfig();
    const settings = config.global || {};

    // 确保 contextTagFilter 有默认的排除标签
    if (!settings.contextTagFilter) {
        settings.contextTagFilter = {
            enableExtract: false,
            enableExclude: false,
            excludeTags: ["Plot_progression"],
            extractTags: [],
            caseSensitive: false,
        };
    } else if (
        !settings.contextTagFilter.excludeTags ||
        settings.contextTagFilter.excludeTags.length === 0
    ) {
        // 如果 excludeTags 为空，填入默认值
        settings.contextTagFilter.excludeTags = ["Plot_progression"];
    }

    return settings;
}

/**
 * 更新全局设置
 * @param {object} settings 要更新的设置
 */
export function updateGlobalSettings(settings) {
    const config = loadConfig();
    config.global = { ...config.global, ...settings };
    saveConfig(config);
}

/**
 * 获取全局配置
 * @returns {object} 全局配置对象
 */
export function getGlobalConfig() {
    const config = loadConfig();
    return config?.global || {};
}

/**
 * 检查插件是否启用
 * @returns {boolean}
 */
export function isPluginEnabled() {
    const config = loadConfig();
    return config?.global?.enabled !== false;
}

/**
 * 获取记忆分类配置
 * @param {string} category 分类名称
 * @returns {object} AI 配置
 * @throws {Error} 如果找不到配置
 */
export function getMemoryConfig(category) {
    const config = loadConfig();
    const categoryConfig = config?.memoryConfigs?.[category];
    if (!categoryConfig) {
        throw new Error(`未找到分类 "${category}" 的配置`);
    }
    return categoryConfig;
}

/**
 * 获取总结世界书配置
 * @param {string} bookName 世界书名称
 * @returns {object} AI 配置
 * @throws {Error} 如果找不到配置
 */
export function getSummaryConfig(bookName) {
    const config = loadConfig();
    const bookConfig = config?.summaryConfigs?.[bookName];
    if (!bookConfig) {
        throw new Error(`未找到总结世界书 "${bookName}" 的配置`);
    }
    return bookConfig;
}

/**
 * 设置记忆分类配置
 * @param {string} category 分类名称
 * @param {object} aiConfig AI 配置
 */
export function setMemoryConfig(category, aiConfig) {
    const config = loadConfig();
    if (!config.memoryConfigs) config.memoryConfigs = {};
    config.memoryConfigs[category] = aiConfig;
    saveConfig(config);
}

/**
 * 设置总结世界书配置
 * @param {string} bookName 世界书名称
 * @param {object} aiConfig AI 配置
 */
export function setSummaryConfig(bookName, aiConfig) {
    const config = loadConfig();
    if (!config.summaryConfigs) config.summaryConfigs = {};
    config.summaryConfigs[bookName] = aiConfig;
    saveConfig(config);
}

/**
 * 删除记忆分类配置
 * @param {string} category 分类名称
 */
export function deleteMemoryConfig(category) {
    const config = loadConfig();
    if (config.memoryConfigs && config.memoryConfigs[category]) {
        delete config.memoryConfigs[category];
        saveConfig(config);
    }
}

/**
 * 删除总结世界书配置
 * @param {string} bookName 世界书名称
 */
export function deleteSummaryConfig(bookName) {
    const config = loadConfig();
    if (config.summaryConfigs && config.summaryConfigs[bookName]) {
        delete config.summaryConfigs[bookName];
        saveConfig(config);
    }
}

/**
 * 获取所有记忆配置
 * @returns {object} 记忆配置映射
 */
export function getAllMemoryConfigs() {
    const config = loadConfig();
    return config?.memoryConfigs || {};
}

/**
 * 获取所有总结配置
 * @returns {object} 总结配置映射
 */
export function getAllSummaryConfigs() {
    const config = loadConfig();
    return config?.summaryConfigs || {};
}

/**
 * 导出配置为 JSON 字符串
 * @returns {string} JSON 字符串
 */
export function exportConfig() {
    return JSON.stringify(loadConfig(), null, 2);
}

/**
 * 导入配置
 * @param {string} jsonString JSON 字符串
 * @returns {boolean} 是否成功
 */
export function importConfig(jsonString) {
    try {
        const config = JSON.parse(jsonString);
        saveConfig(config);
        return true;
    } catch (e) {
        Logger.error("导入配置失败:", e);
        return false;
    }
}

/**
 * 重置配置
 */
export function resetConfig() {
    try {
        const extensionSettings = getExtensionSettings();
        if (extensionSettings && extensionSettings[EXTENSION_NAME]) {
            delete extensionSettings[EXTENSION_NAME];
            stSaveSettings();
        }
        // 清除 localStorage
        localStorage.removeItem("memory_manager_concurrent_config");
        localStorage.removeItem("memory_manager_imported_books");
        // 重新创建默认配置
        loadConfig();
    } catch (e) {
        Logger.error("重置配置失败:", e);
    }
}

// ============================================================================
// 多AI并发生成配置管理
// ============================================================================

/**
 * 获取多AI生成配置
 * @returns {object} 多AI生成配置对象
 */
export function getMultiAIConfig() {
    const config = loadConfig();
    const multiAI = config?.global?.multiAIGeneration;
    if (!multiAI) {
        return { enabled: false, providers: [] };
    }
    return multiAI;
}

/**
 * 检查多AI生成功能是否可用
 * 需要启用且至少有2个启用的provider
 * @returns {boolean}
 */
export function isMultiAIAvailable() {
    const multiAI = getMultiAIConfig();
    if (!multiAI.enabled) return false;
    const enabledProviders = (multiAI.providers || []).filter(p => p.enabled);
    return enabledProviders.length >= 2;
}

/**
 * 获取所有启用的provider
 * @returns {Array} 启用的provider列表
 */
export function getEnabledProviders() {
    const multiAI = getMultiAIConfig();
    return (multiAI.providers || []).filter(p => p.enabled);
}

/**
 * 根据ID获取provider
 * @param {string} id provider ID
 * @returns {object|null} provider对象或null
 */
export function getProviderById(id) {
    const multiAI = getMultiAIConfig();
    return (multiAI.providers || []).find(p => p.id === id) || null;
}

/**
 * 保存多AI生成配置
 * @param {object} multiAIConfig 多AI生成配置
 */
export function saveMultiAIConfig(multiAIConfig) {
    const config = loadConfig();
    if (!config.global) config.global = {};
    config.global.multiAIGeneration = multiAIConfig;
    saveConfig(config);
}

/**
 * 添加provider
 * @param {object} provider provider配置对象
 */
export function addProvider(provider) {
    const multiAI = getMultiAIConfig();
    if (!multiAI.providers) multiAI.providers = [];
    multiAI.providers.push(provider);
    saveMultiAIConfig(multiAI);
}

/**
 * 更新provider
 * @param {string} id provider ID
 * @param {object} updates 要更新的字段
 */
export function updateProvider(id, updates) {
    const multiAI = getMultiAIConfig();
    const index = (multiAI.providers || []).findIndex(p => p.id === id);
    if (index !== -1) {
        multiAI.providers[index] = { ...multiAI.providers[index], ...updates };
        saveMultiAIConfig(multiAI);
    }
}

/**
 * 删除provider
 * @param {string} id provider ID
 */
export function deleteProvider(id) {
    const multiAI = getMultiAIConfig();
    multiAI.providers = (multiAI.providers || []).filter(p => p.id !== id);
    saveMultiAIConfig(multiAI);
}

/**
 * 设置多AI生成功能启用状态
 * @param {boolean} enabled 是否启用
 */
export function setMultiAIEnabled(enabled) {
    const multiAI = getMultiAIConfig();
    multiAI.enabled = enabled;
    saveMultiAIConfig(multiAI);
}
