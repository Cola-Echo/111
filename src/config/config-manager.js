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
        summaryPartConfigs: structuredClone(config?.summaryPartConfigs || {}),
        summaryAutoSplit: structuredClone(config?.global?.summaryAutoSplit || {}),
        indexMergeConfig: structuredClone(config?.global?.indexMergeConfig || {}),
        plotOptimizeConfig: structuredClone(config?.global?.plotOptimizeConfig || {}),
        providers: structuredClone(config?.global?.multiAIGeneration?.providers || []),
        tableFillerConfig: structuredClone(config?.global?.tableFillerConfig || {}),
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
    newConfig.summaryPartConfigs = preserved.summaryPartConfigs;
    newConfig.global.summaryAutoSplit = preserved.summaryAutoSplit;
    newConfig.global.indexMergeConfig = pickApiFields(preserved.indexMergeConfig, newConfig.global.indexMergeConfig);
    newConfig.global.plotOptimizeConfig = pickApiFields(preserved.plotOptimizeConfig, newConfig.global.plotOptimizeConfig);
    newConfig.global.multiAIGeneration.providers = sanitizedProviders;

    // 恢复表格填表并发配置（保留 API 配置）
    if (preserved.tableFillerConfig) {
        const tableFillerApiFields = ["apiFormat", "apiUrl", "apiKey", "model", "maxTokens", "temperature", "customTemplate", "responsePath"];
        const sanitizedTableFillerConfig = {
            enabled: preserved.tableFillerConfig.enabled ?? false,
            callMode: preserved.tableFillerConfig.callMode ?? "auto",
            promptMode: "shared", // 提示词模式重置为共享（清除预设关联）
            retryCount: preserved.tableFillerConfig.retryCount ?? 2,
            retryDelay: preserved.tableFillerConfig.retryDelay ?? 2000,
            importedPreset: null, // 清除导入的预设
            defaultApi: {},
            tableApiConfigs: {},
        };
        // 保留默认 API 配置
        if (preserved.tableFillerConfig.defaultApi) {
            for (const f of tableFillerApiFields) {
                if (Object.hasOwn(preserved.tableFillerConfig.defaultApi, f)) {
                    sanitizedTableFillerConfig.defaultApi[f] = preserved.tableFillerConfig.defaultApi[f];
                }
            }
        }
        // 保留各表格独立 API 配置
        if (preserved.tableFillerConfig.tableApiConfigs) {
            for (const [tableName, tableConfig] of Object.entries(preserved.tableFillerConfig.tableApiConfigs)) {
                sanitizedTableFillerConfig.tableApiConfigs[tableName] = {};
                for (const f of tableFillerApiFields) {
                    if (Object.hasOwn(tableConfig, f)) {
                        sanitizedTableFillerConfig.tableApiConfigs[tableName][f] = tableConfig[f];
                    }
                }
                // 保留 useDefault 标记
                if (Object.hasOwn(tableConfig, "useDefault")) {
                    sanitizedTableFillerConfig.tableApiConfigs[tableName].useDefault = tableConfig.useDefault;
                }
            }
        }
        newConfig.global.tableFillerConfig = sanitizedTableFillerConfig;
    }

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

// ============================================================================
// 表格填表并发配置管理
// ============================================================================

/**
 * 获取表格填表配置
 * @returns {object} 表格填表配置对象
 */
export function getTableFillerConfig() {
    const config = loadConfig();
    const tableFillerConfig = config?.global?.tableFillerConfig;
    if (!tableFillerConfig) {
        return {
            enabled: false,
            callMode: "auto",
            promptMode: "shared",
            retryCount: 2,
            retryDelay: 2000,
            importedPreset: null,
            defaultApi: {},
            tableApiConfigs: {},
            independentTemplates: {},
            independentTagName: "Instructions for filling out the form",
        };
    }
    // 确保 retryCount 有默认值
    if (tableFillerConfig.retryCount === undefined) {
        tableFillerConfig.retryCount = 2;
    }
    // 确保 retryDelay 有默认值
    if (tableFillerConfig.retryDelay === undefined) {
        tableFillerConfig.retryDelay = 2000;
    }
    // 确保 independentTemplates 有默认值
    if (!tableFillerConfig.independentTemplates) {
        tableFillerConfig.independentTemplates = {};
    }
    // 确保 independentTagName 有默认值
    if (!tableFillerConfig.independentTagName) {
        tableFillerConfig.independentTagName = "Instructions for filling out the form";
    }
    return tableFillerConfig;
}

/**
 * 检查表格填表功能是否启用
 * @returns {boolean}
 */
export function isTableFillerEnabled() {
    const tableFillerConfig = getTableFillerConfig();
    return tableFillerConfig?.enabled === true;
}

/**
 * 检查调试模式是否启用
 * @returns {boolean}
 */
export function isDebugModeEnabled() {
    const tableFillerConfig = getTableFillerConfig();
    return tableFillerConfig?.debugMode === true;
}

/**
 * 保存表格填表配置
 * @param {object} tableFillerConfig 表格填表配置
 */
export function saveTableFillerConfig(tableFillerConfig) {
    const config = loadConfig();
    if (!config.global) config.global = {};
    config.global.tableFillerConfig = tableFillerConfig;
    saveConfig(config);
}

/**
 * 更新表格填表配置的部分字段
 * @param {object} updates 要更新的字段
 */
export function updateTableFillerConfig(updates) {
    const tableFillerConfig = getTableFillerConfig();
    const newConfig = { ...tableFillerConfig, ...updates };
    saveTableFillerConfig(newConfig);
}

/**
 * 设置表格填表功能启用状态
 * @param {boolean} enabled 是否启用
 */
export function setTableFillerEnabled(enabled) {
    updateTableFillerConfig({ enabled });
}

/**
 * 获取表格的 API 配置
 * @param {string} tableName 表格名称
 * @returns {object} API 配置
 */
export function getTableApiConfig(tableName) {
    const tableFillerConfig = getTableFillerConfig();
    const tableConfig = tableFillerConfig.tableApiConfigs?.[tableName];

    // 如果表格有独立配置且不是使用默认
    if (tableConfig && !tableConfig.useDefault) {
        return tableConfig;
    }

    // 使用默认 API 配置
    return tableFillerConfig.defaultApi || {};
}

/**
 * 设置表格的 API 配置
 * @param {string} tableName 表格名称
 * @param {object} apiConfig API 配置
 */
export function setTableApiConfig(tableName, apiConfig) {
    const tableFillerConfig = getTableFillerConfig();
    if (!tableFillerConfig.tableApiConfigs) {
        tableFillerConfig.tableApiConfigs = {};
    }
    tableFillerConfig.tableApiConfigs[tableName] = apiConfig;
    saveTableFillerConfig(tableFillerConfig);
}

/**
 * 删除表格的独立 API 配置（恢复使用默认）
 * @param {string} tableName 表格名称
 */
export function deleteTableApiConfig(tableName) {
    const tableFillerConfig = getTableFillerConfig();
    if (tableFillerConfig.tableApiConfigs?.[tableName]) {
        delete tableFillerConfig.tableApiConfigs[tableName];
        saveTableFillerConfig(tableFillerConfig);
    }
}

/**
 * 检查表格填表配置是否有效
 * @returns {boolean}
 */
export function hasValidTableFillerConfig() {
    const config = getTableFillerConfig();
    // 必须有默认 API 配置
    if (!config.defaultApi?.apiUrl || !config.defaultApi?.model) {
        return false;
    }
    return true;
}

/**
 * 获取表格的独立模板
 * @param {string} tableName 表格名称
 * @returns {object|null} 模板配置
 */
export function getIndependentTemplate(tableName) {
    const tableFillerConfig = getTableFillerConfig();
    return tableFillerConfig.independentTemplates?.[tableName] || null;
}

/**
 * 默认独立模板缓存
 */
let defaultIndependentTemplatesCache = null;

/**
 * 加载内置默认独立模板
 * @returns {Promise<object|null>} 默认模板对象
 */
export async function loadDefaultIndependentTemplates() {
    // 如果已缓存，直接返回
    if (defaultIndependentTemplatesCache) {
        return defaultIndependentTemplatesCache;
    }

    try {
        const response = await fetch('/scripts/extensions/third-party/memory-manager-concurrent/prompts/table-filler/default-independent-template.json');
        if (!response.ok) {
            Logger.warn('[独立模板] 加载内置默认模板失败:', response.status);
            return null;
        }
        const data = await response.json();
        defaultIndependentTemplatesCache = data;
        Logger.log('[独立模板] 已加载内置默认模板');
        return data;
    } catch (e) {
        Logger.error('[独立模板] 加载内置默认模板出错:', e);
        return null;
    }
}

/**
 * 获取表格的独立模板（带默认值回退）
 * 优先从持久化配置加载，若没有则从内置默认模板加载
 * @param {string} tableName 表格名称
 * @returns {Promise<object|null>} 模板配置
 */
export async function getIndependentTemplateWithDefault(tableName) {
    // 1. 先从持久化配置加载
    const savedTemplate = getIndependentTemplate(tableName);
    if (savedTemplate) {
        return savedTemplate;
    }

    // 2. 从内置默认模板加载
    const defaultTemplates = await loadDefaultIndependentTemplates();
    if (defaultTemplates?.templates?.[tableName]) {
        return { template: defaultTemplates.templates[tableName] };
    }

    return null;
}

/**
 * 获取所有独立模板（合并持久化和默认模板）
 * @returns {Promise<object>} 合并后的所有模板
 */
export async function getAllIndependentTemplatesWithDefault() {
    const savedTemplates = getAllIndependentTemplates();
    const defaultTemplates = await loadDefaultIndependentTemplates();

    // 合并：持久化优先
    const merged = { ...savedTemplates };

    if (defaultTemplates?.templates) {
        for (const [tableName, templateObj] of Object.entries(defaultTemplates.templates)) {
            if (!merged[tableName]) {
                // 处理嵌套结构：templateObj 可能是 { template: "..." } 或直接是字符串
                const templateContent = typeof templateObj === 'string' ? templateObj : templateObj?.template;
                if (templateContent) {
                    merged[tableName] = { template: templateContent, isDefault: true };
                }
            }
        }
    }

    return merged;
}

/**
 * 检查是否有可用的独立模板（持久化或默认）
 * @returns {Promise<boolean>}
 */
export async function hasAnyIndependentTemplates() {
    const savedTemplates = getAllIndependentTemplates();
    if (Object.keys(savedTemplates).length > 0) {
        return true;
    }

    const defaultTemplates = await loadDefaultIndependentTemplates();
    return defaultTemplates?.templates && Object.keys(defaultTemplates.templates).length > 0;
}

/**
 * 设置表格的独立模板
 * @param {string} tableName 表格名称
 * @param {string} template 模板内容
 */
export function setIndependentTemplate(tableName, template) {
    const tableFillerConfig = getTableFillerConfig();
    if (!tableFillerConfig.independentTemplates) {
        tableFillerConfig.independentTemplates = {};
    }
    tableFillerConfig.independentTemplates[tableName] = { template };
    saveTableFillerConfig(tableFillerConfig);
}

/**
 * 删除表格的独立模板
 * @param {string} tableName 表格名称
 */
export function deleteIndependentTemplate(tableName) {
    const tableFillerConfig = getTableFillerConfig();
    if (tableFillerConfig.independentTemplates?.[tableName]) {
        delete tableFillerConfig.independentTemplates[tableName];
        saveTableFillerConfig(tableFillerConfig);
    }
}

/**
 * 获取所有独立模板
 * @returns {object} 所有模板
 */
export function getAllIndependentTemplates() {
    const tableFillerConfig = getTableFillerConfig();
    return tableFillerConfig.independentTemplates || {};
}

/**
 * 设置独立模式的标签名称
 * @param {string} tagName 标签名称
 */
export function setIndependentTagName(tagName) {
    updateTableFillerConfig({ independentTagName: tagName });
}

/**
 * 获取独立模式的标签名称
 * @returns {string} 标签名称
 */
export function getIndependentTagName() {
    const tableFillerConfig = getTableFillerConfig();
    return tableFillerConfig.independentTagName || "Instructions for filling out the form";
}

// ============================================================================
// 总结世界书拆分配置管理
// ============================================================================

/**
 * 获取总结世界书拆分配置
 * @returns {object} 拆分配置
 */
export function getSummaryAutoSplitConfig() {
    const config = loadConfig();
    const splitConfig = config?.global?.summaryAutoSplit;
    if (!splitConfig) {
        return {
            enabled: false,
            targetChars: 50000,
            minChars: 40000,
            maxChars: 60000,
        };
    }
    return splitConfig;
}

/**
 * 检查总结世界书拆分功能是否启用
 * @returns {boolean}
 */
export function isSummaryAutoSplitEnabled() {
    const splitConfig = getSummaryAutoSplitConfig();
    return splitConfig?.enabled === true;
}

/**
 * 检查总结世界书合并去重是否启用
 * @returns {boolean}
 */
export function isSummaryMergeDeduplicateEnabled() {
    const splitConfig = getSummaryAutoSplitConfig();
    return splitConfig?.deduplicateOnMerge === true;
}

/**
 * 设置总结世界书合并去重启用状态
 * @param {boolean} enabled 是否启用
 */
export function setSummaryMergeDeduplicateEnabled(enabled) {
    const config = loadConfig();
    if (!config.global) config.global = {};
    if (!config.global.summaryAutoSplit) {
        config.global.summaryAutoSplit = {
            enabled: false,
            targetChars: 50000,
            minChars: 40000,
            maxChars: 60000,
            deduplicateOnMerge: false,
        };
    }
    config.global.summaryAutoSplit.deduplicateOnMerge = enabled;
    saveConfig(config);
}

/**
 * 设置总结世界书拆分功能启用状态
 * @param {boolean} enabled 是否启用
 */
export function setSummaryAutoSplitEnabled(enabled) {
    const config = loadConfig();
    if (!config.global) config.global = {};
    if (!config.global.summaryAutoSplit) {
        config.global.summaryAutoSplit = {
            enabled: false,
            targetChars: 50000,
            minChars: 40000,
            maxChars: 60000,
        };
    }
    config.global.summaryAutoSplit.enabled = enabled;
    saveConfig(config);
}

/**
 * 更新总结世界书拆分配置
 * @param {object} updates 要更新的字段
 */
export function updateSummaryAutoSplitConfig(updates) {
    const config = loadConfig();
    if (!config.global) config.global = {};
    if (!config.global.summaryAutoSplit) {
        config.global.summaryAutoSplit = {
            enabled: false,
            targetChars: 50000,
            minChars: 40000,
            maxChars: 60000,
        };
    }
    config.global.summaryAutoSplit = { ...config.global.summaryAutoSplit, ...updates };
    saveConfig(config);
}

/**
 * 获取指定世界书的Part配置
 * @param {string} bookName 世界书名称
 * @returns {object|null} Part配置
 */
export function getSummaryPartConfigs(bookName) {
    const config = loadConfig();
    return config?.summaryPartConfigs?.[bookName] || null;
}

/**
 * 设置指定世界书的Part配置
 * @param {string} bookName 世界书名称
 * @param {object} partConfigs Part配置
 */
export function setSummaryPartConfigs(bookName, partConfigs) {
    const config = loadConfig();
    if (!config.summaryPartConfigs) {
        config.summaryPartConfigs = {};
    }
    config.summaryPartConfigs[bookName] = partConfigs;
    saveConfig(config);
}

/**
 * 删除指定世界书的Part配置
 * @param {string} bookName 世界书名称
 */
export function deleteSummaryPartConfigs(bookName) {
    const config = loadConfig();
    if (config.summaryPartConfigs?.[bookName]) {
        delete config.summaryPartConfigs[bookName];
        saveConfig(config);
    }
}

/**
 * 获取所有世界书的Part配置
 * @returns {object} 所有Part配置
 */
export function getAllSummaryPartConfigs() {
    const config = loadConfig();
    return config?.summaryPartConfigs || {};
}

/**
 * 获取指定Part的API配置
 * @param {string} bookName 世界书名称
 * @param {string} partId Part ID
 * @returns {object|null} API配置
 */
export function getSummaryPartApiConfig(bookName, partId) {
    const partConfigs = getSummaryPartConfigs(bookName);
    if (!partConfigs?.parts) return null;

    const part = partConfigs.parts.find(p => p.id === partId);
    return part?.apiConfig || null;
}

/**
 * 设置指定Part的API配置
 * @param {string} bookName 世界书名称
 * @param {string} partId Part ID
 * @param {object} apiConfig API配置
 */
export function setSummaryPartApiConfig(bookName, partId, apiConfig) {
    const config = loadConfig();
    if (!config.summaryPartConfigs) {
        config.summaryPartConfigs = {};
    }
    if (!config.summaryPartConfigs[bookName]) {
        config.summaryPartConfigs[bookName] = { parts: [] };
    }

    const parts = config.summaryPartConfigs[bookName].parts;
    const existingIndex = parts.findIndex(p => p.id === partId);

    if (existingIndex >= 0) {
        parts[existingIndex].apiConfig = apiConfig;
    } else {
        parts.push({ id: partId, apiConfig });
    }

    saveConfig(config);
}

/**
 * 删除指定Part的API配置
 * @param {string} bookName 世界书名称
 * @param {string} partId Part ID
 */
export function deleteSummaryPartApiConfig(bookName, partId) {
    const config = loadConfig();
    if (!config.summaryPartConfigs?.[bookName]?.parts) return;

    const parts = config.summaryPartConfigs[bookName].parts;
    const index = parts.findIndex(p => p.id === partId);
    if (index >= 0) {
        parts[index].apiConfig = null;
        saveConfig(config);
    }
}

/**
 * 检查指定世界书的所有Part是否都已配置API
 * @param {string} bookName 世界书名称
 * @param {Array} parts Part列表
 * @returns {object} 检查结果 { allConfigured: boolean, unconfiguredParts: Array }
 */
export function checkSummaryPartsConfigured(bookName, parts) {
    const partConfigs = getSummaryPartConfigs(bookName);
    const unconfiguredParts = [];

    for (const part of parts) {
        const savedPart = partConfigs?.parts?.find(p => p.id === part.id);
        if (!savedPart?.apiConfig?.apiUrl || !savedPart?.apiConfig?.model) {
            unconfiguredParts.push(part);
        }
    }

    return {
        allConfigured: unconfiguredParts.length === 0,
        unconfiguredParts,
    };
}

/**
 * 迁移原有的单API配置到Part 1
 * @param {string} bookName 世界书名称
 * @param {object} firstPart 第一个Part对象
 * @returns {boolean} 是否进行了迁移
 */
export function migrateSummaryConfigToPart(bookName, firstPart) {
    const config = loadConfig();
    const existingConfig = config?.summaryConfigs?.[bookName];

    if (!existingConfig?.apiUrl || !existingConfig?.model) {
        return false;
    }

    // 检查是否已有Part配置
    if (config.summaryPartConfigs?.[bookName]?.parts?.length > 0) {
        return false;
    }

    // 迁移配置
    if (!config.summaryPartConfigs) {
        config.summaryPartConfigs = {};
    }
    config.summaryPartConfigs[bookName] = {
        parts: [{
            id: firstPart.id,
            startFloor: firstPart.startFloor,
            endFloor: firstPart.endFloor,
            charCount: firstPart.charCount,
            apiConfig: { ...existingConfig },
        }],
    };

    saveConfig(config);
    Logger.log(`[ConfigManager] 已将 ${bookName} 的原有API配置迁移至 Part 1`);
    return true;
}

