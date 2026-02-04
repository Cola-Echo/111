﻿/**
 * 提示词预设管理模块
 * @module ui/modals/prompt-preset
 */

import Logger from "@core/logger";
import { getContext, getWorldNames, loadWorldInfo } from "@core/sillytavern-api";
import { loadConfig, saveConfig, getGlobalSettings } from "@config/config-manager";
import { defaultPromptPreset, defaultPromptItem } from "@config/default-config";
import { filterContentByRole } from "@utils/tag-filter";
import { getImportedBookNames } from "@config/imported-books";

const log = Logger.createModuleLogger("提示词预设");

/**
 * 生成唯一ID
 */
function generateId() {
    return `preset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 世界书条目位置常量（完整参考酒馆的 world_info_position）
 * 0 = before character definition (worldInfoBefore)
 * 1 = after character definition (worldInfoAfter)
 * 2 = Author's Note Top
 * 3 = Author's Note Bottom
 * 4 = at Depth (需要配合 depth 参数)
 * 5 = EM Top (Extension Message Top)
 * 6 = EM Bottom (Extension Message Bottom)
 * 7 = outlet (排除出上下文)
 */
const WI_POSITION = {
    BEFORE: 0,
    AFTER: 1,
    AN_TOP: 2,
    AN_BOTTOM: 3,
    AT_DEPTH: 4,
    EM_TOP: 5,
    EM_BOTTOM: 6,
    OUTLET: 7,
};

/**
 * 匹配世界书关键词
 * @param {string} scanText - 要扫描的文本
 * @param {object} entry - 世界书条目
 * @returns {boolean} 是否匹配
 */
function matchWorldInfoKeywords(scanText, entry) {
    if (!entry.key || !Array.isArray(entry.key) || entry.key.length === 0) {
        return false;
    }

    // 获取全局设置（大小写敏感、整词匹配）
    const caseSensitive = entry.caseSensitive ?? false;
    const matchWholeWords = entry.matchWholeWords ?? true;

    const textToScan = caseSensitive ? scanText : scanText.toLowerCase();

    for (const keyword of entry.key) {
        if (!keyword || keyword.trim() === "") continue;

        // 检查是否是正则表达式（以 / 开头和结尾）
        if (keyword.startsWith("/") && keyword.lastIndexOf("/") > 0) {
            try {
                const lastSlash = keyword.lastIndexOf("/");
                const pattern = keyword.substring(1, lastSlash);
                const flags = keyword.substring(lastSlash + 1) || (caseSensitive ? "" : "i");
                const regex = new RegExp(pattern, flags);
                if (regex.test(scanText)) {
                    return true;
                }
            } catch (e) {
                // 正则无效，当作普通关键词处理
                log.warn("无效的正则表达式关键词:", keyword);
            }
        }

        // 普通关键词匹配
        const keywordToMatch = caseSensitive ? keyword : keyword.toLowerCase();

        if (matchWholeWords) {
            // 整词匹配：使用单词边界
            const wordBoundaryRegex = new RegExp(`\\b${escapeRegExp(keywordToMatch)}\\b`, caseSensitive ? "" : "i");
            if (wordBoundaryRegex.test(scanText)) {
                return true;
            }
        } else {
            // 部分匹配
            if (textToScan.includes(keywordToMatch)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 扫描并获取匹配的世界书条目内容
 * @param {string} scanText - 要扫描的文本（用户消息 + memory + 剧情优化 + 聊天历史等）
 * @returns {Promise<{ before: string, after: string, anTop: string, anBottom: string, atDepth: Array<{depth: number, content: string}>, emTop: string, emBottom: string }>} 匹配到的内容，按位置分类
 */
export async function scanWorldInfoEntries(scanText) {
    const result = {
        before: "",
        after: "",
        anTop: "",
        anBottom: "",
        atDepth: [],  // 深度插入的条目: {depth: number, content: string, order: number}
        emTop: "",
        emBottom: "",
    };

    if (!scanText) {
        return result;
    }

    // 存储匹配到的条目，按位置分类
    const matchedEntries = {
        before: [],
        after: [],
        anTop: [],
        anBottom: [],
        atDepth: [],
        emTop: [],
        emBottom: [],
    };

    try {
        // 获取所有启用的世界书名称
        const worldNames = getWorldNames();

        // 同时获取导入的世界书名称（插件配置的）
        let importedNames = [];
        try {
            importedNames = getImportedBookNames() || [];
        } catch (e) {
            // 忽略
        }

        // 获取角色卡绑定的世界书
        const context = getContext();
        let characterWorldName = null;
        if (context?.characterId >= 0 && context?.characters) {
            const char = context.characters[context.characterId];
            characterWorldName = char?.data?.extensions?.world;
            if (characterWorldName) {
                log.log(`检测到角色卡绑定的世界书: ${characterWorldName}`);
            }
        }

        // 获取聊天绑定的世界书
        let chatWorldName = null;
        try {
            // chat_metadata 通常在 context 或 window 上
            const chatMeta = context?.chat_metadata || (typeof window !== 'undefined' ? window.chat_metadata : null);
            chatWorldName = chatMeta?.world_info;
            if (chatWorldName) {
                log.log(`检测到聊天绑定的世界书: ${chatWorldName}`);
            }
        } catch (e) {
            // 忽略
        }

        // 合并并去重
        const allBookNames = [...new Set([
            ...worldNames,
            ...importedNames,
            ...(characterWorldName ? [characterWorldName] : []),
            ...(chatWorldName ? [chatWorldName] : []),
        ])];

        if (allBookNames.length === 0) {
            log.log("未找到任何启用的世界书");
            return result;
        }

        log.log(`正在扫描 ${allBookNames.length} 个世界书: ${allBookNames.join(', ')}`);

        // 加载每个世界书并扫描条目
        for (const bookName of allBookNames) {
            try {
                const bookData = await loadWorldInfo(bookName);
                if (!bookData || !bookData.entries) {
                    continue;
                }

                // 遍历世界书的所有条目
                for (const [uid, entry] of Object.entries(bookData.entries)) {
                    // 跳过禁用的条目
                    const isDisabled = entry.disable === true || entry.enabled === false;
                    if (isDisabled) continue;

                    // 跳过 outlet 位置的条目（不进入上下文）
                    const position = entry.position ?? WI_POSITION.AFTER;
                    if (position === WI_POSITION.OUTLET) continue;

                    const isConstant = entry.constant === true;
                    const order = entry.order ?? 100;
                    const content = entry.content || "";
                    const entryName = entry.comment || entry.key?.[0] || "未命名";
                    const depth = entry.depth ?? 4;

                    if (!content.trim()) continue;

                    // 常驻条目（蓝灯）直接加入
                    if (isConstant) {
                        addEntryToPosition(matchedEntries, position, { order, content, name: entryName, depth });
                        continue;
                    }

                    // 绿灯条目：检查关键词是否匹配
                    if (matchWorldInfoKeywords(scanText, entry)) {
                        // 检查触发概率
                        const probability = entry.probability ?? 100;
                        if (probability < 100 && Math.random() * 100 > probability) {
                            continue; // 未通过概率检查
                        }

                        addEntryToPosition(matchedEntries, position, { order, content, name: entryName, depth });
                        log.log(`世界书条目匹配: ${entryName} (from ${bookName})`);
                    }
                }
            } catch (bookErr) {
                log.warn(`加载世界书 "${bookName}" 失败:`, bookErr);
            }
        }

        // 按 order 排序并合并内容
        for (const key of ["before", "after", "anTop", "anBottom", "emTop", "emBottom"]) {
            matchedEntries[key].sort((a, b) => a.order - b.order);
            result[key] = matchedEntries[key].map(e => e.content).join("\n\n");
        }

        // 深度插入的条目需要特殊处理，保留 depth 信息
        matchedEntries.atDepth.sort((a, b) => a.order - b.order);
        result.atDepth = matchedEntries.atDepth.map(e => ({
            depth: e.depth,
            content: e.content,
            name: e.name,
        }));

        // 统计日志
        const totalMatched = Object.values(matchedEntries).reduce((sum, arr) => sum + arr.length, 0);
        if (totalMatched > 0) {
            log.log(`世界书扫描完成: 共匹配 ${totalMatched} 条 (before=${matchedEntries.before.length}, after=${matchedEntries.after.length}, anTop=${matchedEntries.anTop.length}, anBottom=${matchedEntries.anBottom.length}, atDepth=${matchedEntries.atDepth.length}, emTop=${matchedEntries.emTop.length}, emBottom=${matchedEntries.emBottom.length})`);
        }

    } catch (e) {
        log.error("扫描世界书条目失败:", e);
    }

    return result;
}

/**
 * 根据位置将条目添加到对应的数组
 */
function addEntryToPosition(matchedEntries, position, entryData) {
    switch (position) {
        case WI_POSITION.BEFORE:
            matchedEntries.before.push(entryData);
            break;
        case WI_POSITION.AFTER:
            matchedEntries.after.push(entryData);
            break;
        case WI_POSITION.AN_TOP:
            matchedEntries.anTop.push(entryData);
            break;
        case WI_POSITION.AN_BOTTOM:
            matchedEntries.anBottom.push(entryData);
            break;
        case WI_POSITION.AT_DEPTH:
            matchedEntries.atDepth.push(entryData);
            break;
        case WI_POSITION.EM_TOP:
            matchedEntries.emTop.push(entryData);
            break;
        case WI_POSITION.EM_BOTTOM:
            matchedEntries.emBottom.push(entryData);
            break;
        default:
            // 未知位置默认放到 after
            matchedEntries.after.push(entryData);
    }
}

/**
 * ST占位符标识符到我们类型的映射
 */
const ST_MARKER_TO_TYPE = {
    "charDescription": "charDescription",
    "charPersonality": "charPersonality",
    "scenario": "scenario",
    "personaDescription": "personaDescription",
    "worldInfoBefore": "wiBefore",   // 映射到新的独立位置类型
    "worldInfoAfter": "wiAfter",     // 映射到新的独立位置类型
    "dialogueExamples": "dialogueExamples",
    "chatHistory": "history",  // ST的chatHistory用我们的history替代
};

/**
 * 需要跳过的ST占位符（这些会被其他占位符包含或不需要单独处理）
 */
const ST_MARKERS_TO_SKIP = [];

function getPersonaDescriptionFromContext(context) {
    try {
        return (
            context?.powerUserSettings?.persona_description ||
            context?.power_user?.persona_description ||
            context?.powerUser?.persona_description ||
            (typeof window !== 'undefined' ? window.power_user?.persona_description : "") ||
            ""
        );
    } catch (e) {
        return "";
    }
}

function getPromptContent(prompt) {
    if (!prompt) return "";
    return (
        prompt.content ??
        prompt.value ??
        prompt.prompt ??
        prompt.text ??
        ""
    );
}

function normalizePromptList(presetJson) {
    const raw = presetJson?.prompts;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.collection)) return raw.collection;
    if (typeof raw === "object") return Object.values(raw);
    return [];
}

function normalizePromptOrder(presetJson) {
    const po = presetJson?.prompt_order;
    if (!po) return [];

    // Old ST format: [{ order: [...] }]
    if (Array.isArray(po)) {
        const firstWithOrder = po.find((x) => Array.isArray(x?.order));
        // If it's already an order array (strings / {identifier,...}), just use it.
        return firstWithOrder?.order || po;
    }

    // Common format: { order: [...] }
    if (typeof po === "object" && Array.isArray(po.order)) {
        return po.order;
    }

    // Possible keyed format: { chat: { order: [...] }, group: { order: [...] }, ... }
    if (typeof po === "object") {
        for (const v of Object.values(po)) {
            if (Array.isArray(v?.order)) return v.order;
            if (Array.isArray(v)) return v;
        }
    }

    return [];
}

function getOrderIdentifier(orderItem) {
    if (!orderItem) return null;
    if (typeof orderItem === "string") return orderItem;
    return orderItem.identifier || orderItem.id || orderItem.prompt_identifier || null;
}

function getOrderEnabled(orderItem) {
    if (!orderItem || typeof orderItem === "string") return true;
    if (Object.hasOwn(orderItem, "enabled")) return orderItem.enabled !== false;
    if (Object.hasOwn(orderItem, "disabled")) return orderItem.disabled !== true;
    if (Object.hasOwn(orderItem, "is_enabled")) return orderItem.is_enabled !== false;
    return true;
}

/**
 * 从ST预设文件提取提示词
 * @param {object} presetJson - ST预设JSON对象
 * @returns {Array} 提示词列表
 */
export function extractPromptsFromPreset(presetJson) {
    const prompts = normalizePromptList(presetJson);
    const promptOrder = normalizePromptOrder(presetJson);
    const promptMap = new Map();
    for (const p of prompts) {
        const id = p?.identifier;
        if (!id) continue;
        if (!promptMap.has(id)) promptMap.set(id, p);
    }

    const result = [];
    let historyInserted = false;
    const processedIdentifiers = new Set();

    for (const orderItem of promptOrder) {
        const identifier = getOrderIdentifier(orderItem);
        if (!identifier) continue;
        processedIdentifiers.add(identifier);
        const prompt = promptMap.get(identifier);
        const enabled = getOrderEnabled(orderItem);

        // 跳过不需要处理的ST占位符
        if (ST_MARKERS_TO_SKIP.includes(identifier)) {
            continue;
        }

        // 检查是否是我们需要特殊处理的ST占位符
        const ourType = ST_MARKER_TO_TYPE[identifier];
        if (ourType) {
            // 如果是chatHistory，替换为我们的history，并紧接着插入用户消息和记忆摘要
            if (identifier === "chatHistory") {
                result.push({
                    id: `history-${Date.now()}`,
                    name: "聊天历史",
                    role: "system",
                    content: "",
                    enabled: enabled,
                    type: "history",
                    historyCount: 10,
                });
                // 紧接着插入用户消息
                result.push({
                    id: `user-${Date.now()}`,
                    name: "用户消息",
                    role: "user",
                    content: "",
                    enabled: true,
                    type: "user",
                });
                // 然后插入记忆摘要
                result.push({
                    id: `memory-${Date.now()}`,
                    name: "记忆摘要",
                    role: "system",
                    content: "",
                    enabled: true,
                    type: "memory",
                });
                historyInserted = true;
            } else if (identifier === "worldInfoAfter") {
                // worldInfoAfter 需要展开为多个独立的世界书位置板块
                // 按酒馆的position顺序: wiAfter(1), wiANTop(2), wiANBottom(3), wiAtDepth(4), wiEMTop(5), wiEMBottom(6)
                const wiPositions = [
                    { type: "wiAfter", name: "世界书-角色描述后" },
                    { type: "wiANTop", name: "世界书-作者注释顶部" },
                    { type: "wiANBottom", name: "世界书-作者注释底部" },
                    { type: "wiAtDepth", name: "世界书-按深度插入" },
                    { type: "wiEMTop", name: "世界书-扩展消息顶部" },
                    { type: "wiEMBottom", name: "世界书-扩展消息底部" },
                ];
                for (const pos of wiPositions) {
                    result.push({
                        id: `${pos.type}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                        name: pos.name,
                        role: "system",
                        content: "",
                        enabled: enabled,
                        type: pos.type,
                    });
                }
            } else {
                // 其他ST占位符直接转换
                result.push({
                    id: `${ourType}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                    name: SPECIAL_PROMPT_TYPES[ourType]?.name || identifier,
                    role: SPECIAL_PROMPT_TYPES[ourType]?.role || "system",
                    content: "",
                    enabled: enabled,
                    type: ourType,
                });
            }
            continue;
        }

        // 普通自定义提示词
        result.push({
            id: `imported-${identifier}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            name: prompt?.name || prompt?.title || identifier,
            role: prompt?.role || "system",
            content: getPromptContent(prompt),
            enabled: enabled,
            type: "custom",
        });
    }

    // Add prompts missing from prompt_order (ST UI still shows them).
    for (const prompt of prompts) {
        const identifier = prompt?.identifier;
        if (!identifier) continue;
        if (processedIdentifiers.has(identifier)) continue;
        if (ST_MARKERS_TO_SKIP.includes(identifier)) continue;
        if (Object.hasOwn(ST_MARKER_TO_TYPE, identifier)) continue;

        result.push({
            id: `imported-${identifier}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            name: prompt?.name || prompt?.title || identifier,
            role: prompt?.role || "system",
            content: getPromptContent(prompt),
            enabled: true,
            type: "custom",
        });
    }

    // 如果没有找到chatHistory，在末尾添加必要的占位符
    if (!historyInserted) {
        result.push({
            id: `history-${Date.now()}`,
            name: "聊天历史",
            role: "system",
            content: "",
            enabled: true,
            type: "history",
            historyCount: 10,
        });
        result.push({
            id: `user-${Date.now()}`,
            name: "用户消息",
            role: "user",
            content: "",
            enabled: true,
            type: "user",
        });
        result.push({
            id: `memory-${Date.now()}`,
            name: "记忆摘要",
            role: "system",
            content: "",
            enabled: true,
            type: "memory",
        });
    }

    return result;
}

/**
 * 从酒馆当前预设读取提示词
 * @returns {Array} 提示词列表
 */
export function extractPromptsFromCurrentPreset() {
    const context = getContext();
    const oaiSettings = context?.chatCompletionSettings;
    if (!oaiSettings || normalizePromptList(oaiSettings).length === 0) {
        log.warn("无法获取酒馆当前预设");
        return [];
    }

    return extractPromptsFromPreset(oaiSettings);
}

/**
 * 获取所有提示词预设
 * @returns {Array} 预设列表
 */
export function getPromptPresets() {
    const config = loadConfig();
    return config.global?.multiAIGeneration?.promptPresets || [];
}

/**
 * 获取指定预设
 * @param {string} presetId - 预设ID
 * @returns {object|null} 预设对象
 */
export function getPromptPresetById(presetId) {
    const presets = getPromptPresets();
    return presets.find((p) => p.id === presetId) || null;
}

/**
 * 保存提示词预设
 * @param {object} preset - 预设对象
 */
export function savePromptPreset(preset) {
    const config = loadConfig();
    if (!config.global.multiAIGeneration.promptPresets) {
        config.global.multiAIGeneration.promptPresets = [];
    }

    const presets = config.global.multiAIGeneration.promptPresets;
    const existingIndex = presets.findIndex((p) => p.id === preset.id);

    preset.updatedAt = Date.now();

    if (existingIndex >= 0) {
        presets[existingIndex] = preset;
    } else {
        preset.createdAt = Date.now();
        presets.push(preset);
    }

    saveConfig(config);
    log.log(`已保存提示词预设: ${preset.name}`);
}

/**
 * 删除提示词预设
 * @param {string} presetId - 预设ID
 */
export function deletePromptPreset(presetId) {
    const config = loadConfig();
    if (!config.global.multiAIGeneration.promptPresets) return;

    const presets = config.global.multiAIGeneration.promptPresets;
    const index = presets.findIndex((p) => p.id === presetId);

    if (index >= 0) {
        const preset = presets[index];
        presets.splice(index, 1);
        saveConfig(config);
        log.log(`已删除提示词预设: ${preset.name}`);
    }
}

/**
 * 特殊占位符类型定义
 * - stFollow: 跟随ST原有设置（不单独发送，由ST处理）
 * - plugin: 插件注入的内容
 * - dynamic: 动态获取的内容（可配置）
 */
export const SPECIAL_PROMPT_TYPES = {
    // 跟随ST的占位符
    charDescription: { name: "角色描述", category: "stFollow", role: "system" },
    charPersonality: { name: "角色性格", category: "stFollow", role: "system" },
    scenario: { name: "场景", category: "stFollow", role: "system" },
    personaDescription: { name: "用户人设", category: "stFollow", role: "system" },
    // 世界书 - 按位置拆分
    wiBefore: { name: "世界书-角色描述前", category: "worldInfo", role: "system", position: 0 },
    wiAfter: { name: "世界书-角色描述后", category: "worldInfo", role: "system", position: 1 },
    wiANTop: { name: "世界书-作者注释顶部", category: "worldInfo", role: "system", position: 2 },
    wiANBottom: { name: "世界书-作者注释底部", category: "worldInfo", role: "system", position: 3 },
    wiAtDepth: { name: "世界书-按深度插入", category: "worldInfo", role: "system", position: 4 },
    wiEMTop: { name: "世界书-扩展消息顶部", category: "worldInfo", role: "system", position: 5 },
    wiEMBottom: { name: "世界书-扩展消息底部", category: "worldInfo", role: "system", position: 6 },
    dialogueExamples: { name: "对话示例", category: "stFollow", role: "system" },
    // 插件注入
    memory: { name: "记忆摘要", category: "plugin", role: "system" },
    // 动态内容
    history: { name: "聊天历史", category: "dynamic", role: "system", configurable: true },
    // 固定位置
    user: { name: "用户消息", category: "fixed", role: "user" },
};

/**
 * 所有特殊类型（非custom的类型）
 */
const ALL_SPECIAL_TYPES = [
    "charDescription", "charPersonality", "scenario", "personaDescription",
    "wiBefore", "wiAfter", "wiANTop", "wiANBottom", "wiAtDepth", "wiEMTop", "wiEMBottom",
    "dialogueExamples", "memory", "history", "user", "character"
];

/**
 * 创建特殊占位符提示词
 * @param {string} type - 类型
 * @returns {object} 提示词对象
 */
function createSpecialPrompt(type) {
    const typeInfo = SPECIAL_PROMPT_TYPES[type];
    const basePrompt = {
        id: `${type}-${Date.now()}`,
        name: typeInfo?.name || type,
        role: typeInfo?.role || "system",
        content: "",
        enabled: true,
        type: type,
    };

    // 聊天历史需要额外的配置
    if (type === "history") {
        basePrompt.historyCount = 10;
    }

    return basePrompt;
}

/**
 * 智能合并导入的提示词和特殊占位符
 * 按照推荐的顺序自动插入特殊占位符
 * @param {Array} importedPrompts - 导入的自定义提示词
 * @returns {Array} 合并后的提示词列表
 */
export function mergePromptsWithSpecialTypes(importedPrompts) {
    // 推荐的提示词顺序（参考ST的默认顺序）
    // 1. 角色描述 (charDescription)
    // 2. 用户人设 (personaDescription)
    // 3. 世界书-角色描述前 (wiBefore)
    // 4. 对话示例 (dialogueExamples)
    // 5. 导入的自定义提示词
    // 6. 记忆摘要 (memory) - 插件注入
    // 7. 世界书-角色描述后 (wiAfter)
    // 8. 聊天历史 (history)
    // 9. 用户消息 (user) - 固定在最后

    const result = [];

    // 1. 角色描述
    result.push(createSpecialPrompt("charDescription"));

    // 2. 用户人设
    result.push(createSpecialPrompt("personaDescription"));

    // 3. 世界书-角色描述前
    result.push(createSpecialPrompt("wiBefore"));

    // 4. 对话示例
    result.push(createSpecialPrompt("dialogueExamples"));

    // 5. 导入的自定义提示词（过滤掉可能的特殊类型标识符）
    for (const prompt of importedPrompts) {
        // 确保是自定义类型
        if (!ALL_SPECIAL_TYPES.includes(prompt.type)) {
            result.push(prompt);
        } else {
            // 如果导入的提示词包含特殊类型标识，转换为自定义类型
            result.push({
                ...prompt,
                type: "custom",
            });
        }
    }

    // 6. 记忆摘要
    result.push(createSpecialPrompt("memory"));

    // 7. 世界书-角色描述后
    result.push(createSpecialPrompt("wiAfter"));

    // 8. 聊天历史
    result.push(createSpecialPrompt("history"));

    // 9. 用户消息（固定在最后）
    result.push(createSpecialPrompt("user"));

    return result;
}

/**
 * 创建默认提示词列表（包含特殊插入点）
 * @returns {Array} 默认提示词列表
 */
export function createDefaultPromptList() {
    return [
        // ST跟随占位符（默认启用，跟随ST设置）
        {
            id: "char-description",
            name: "角色描述",
            role: "system",
            content: "",
            enabled: true,
            type: "charDescription",
        },
        {
            id: "persona-description",
            name: "用户人设",
            role: "system",
            content: "",
            enabled: true,
            type: "personaDescription",
        },
        // 世界书 - 角色描述前 (position=0)
        {
            id: "wi-before",
            name: "世界书-角色描述前",
            role: "system",
            content: "",
            enabled: true,
            type: "wiBefore",
        },
        {
            id: "dialogue-examples",
            name: "对话示例",
            role: "system",
            content: "",
            enabled: true,
            type: "dialogueExamples",
        },
        // 世界书 - 角色描述后 (position=1)
        {
            id: "wi-after",
            name: "世界书-角色描述后",
            role: "system",
            content: "",
            enabled: true,
            type: "wiAfter",
        },
        // 世界书 - 作者注释顶部 (position=2)
        {
            id: "wi-an-top",
            name: "世界书-作者注释顶部",
            role: "system",
            content: "",
            enabled: true,
            type: "wiANTop",
        },
        // 世界书 - 作者注释底部 (position=3)
        {
            id: "wi-an-bottom",
            name: "世界书-作者注释底部",
            role: "system",
            content: "",
            enabled: true,
            type: "wiANBottom",
        },
        // 插件注入：记忆摘要
        {
            id: "memory-inject",
            name: "记忆摘要",
            role: "system",
            content: "",
            enabled: true,
            type: "memory",
        },
        // 世界书 - 按深度插入 (position=4)
        {
            id: "wi-at-depth",
            name: "世界书-按深度插入",
            role: "system",
            content: "",
            enabled: true,
            type: "wiAtDepth",
        },
        // 世界书 - 扩展消息顶部 (position=5)
        {
            id: "wi-em-top",
            name: "世界书-扩展消息顶部",
            role: "system",
            content: "",
            enabled: true,
            type: "wiEMTop",
        },
        // 世界书 - 扩展消息底部 (position=6)
        {
            id: "wi-em-bottom",
            name: "世界书-扩展消息底部",
            role: "system",
            content: "",
            enabled: true,
            type: "wiEMBottom",
        },
        // 动态内容：聊天历史
        {
            id: "chat-history",
            name: "聊天历史",
            role: "system",
            content: "",
            enabled: true,
            type: "history",
            historyCount: 10,
        },
        // 用户消息（固定在最后）
        {
            id: "user-message",
            name: "用户消息",
            role: "user",
            content: "",
            enabled: true,
            type: "user",
        },
    ];
}

/**
 * 构建消息数组
 * @param {object} preset - 预设对象
 * @param {object} params - 参数
 * @param {string} params.memory - 记忆摘要内容
 * @param {string} params.editorContent - 剧情优化内容
 * @param {string} params.userMessage - 用户消息
 * @returns {Promise<Array>} 消息数组
 */
export async function buildMessagesFromPreset(preset, { memory, editorContent, userMessage }) {
    const context = getContext();
    const messages = [];

    if (!preset || !preset.prompts) {
        log.warn("预设无效或没有提示词");
        return messages;
    }

    // 获取 substituteParams 函数用于解析宏变量
    const substituteParams = context?.substituteParams;

    // 构建世界书扫描文本（用户消息 + memory + 剧情优化 + 最近聊天历史）
    let worldInfoScanText = "";
    if (userMessage) worldInfoScanText += userMessage + "\n";
    if (memory) worldInfoScanText += memory + "\n";
    if (editorContent) worldInfoScanText += editorContent + "\n";
    // 添加最近的聊天历史（用于关键词匹配）
    const recentHistory = context?.chat?.slice(-10) || [];
    for (const msg of recentHistory) {
        if (msg.mes) worldInfoScanText += msg.mes + "\n";
    }

    // 扫描世界书条目，获取匹配的内容（异步）
    const worldInfoContent = await scanWorldInfoEntries(worldInfoScanText);
    log.log(`世界书扫描完成: before=${worldInfoContent.before.length}字, after=${worldInfoContent.after.length}字, anTop=${worldInfoContent.anTop.length}字, anBottom=${worldInfoContent.anBottom.length}字, atDepth=${worldInfoContent.atDepth.length}条`);

    // 获取ST相关数据
    const getSTData = () => {
        const char = context?.characterId >= 0 && context?.characters
            ? context.characters[context.characterId]
            : null;

        // 处理 atDepth 条目，将它们合并成字符串
        let atDepthContent = "";
        for (const depthEntry of worldInfoContent.atDepth) {
            atDepthContent = atDepthContent ? `${atDepthContent}\n\n${depthEntry.content}` : depthEntry.content;
        }

        // 获取用户人设描述 - 优先从 context.powerUserSettings 获取（新版ST不一定暴露 window.power_user）
        let personaDesc = "";
        personaDesc = getPersonaDescriptionFromContext(context);

        return {
            // 角色描述
            charDescription: char?.description || "",
            // 角色性格/场景（如果提示词预设里有对应占位符）
            charPersonality: char?.personality || char?.data?.personality || "",
            scenario: char?.scenario || char?.data?.scenario || "",
            // 用户人设（persona）- 从 power_user.persona_description 获取
            personaDescription: personaDesc,
            // 对话示例
            dialogueExamples: char?.mes_example || "",
            // 世界书内容 - 按位置独立提供
            wiBefore: worldInfoContent.before,      // position=0
            wiAfter: worldInfoContent.after,        // position=1
            wiANTop: worldInfoContent.anTop,        // position=2
            wiANBottom: worldInfoContent.anBottom,  // position=3
            wiAtDepth: atDepthContent,              // position=4
            wiEMTop: worldInfoContent.emTop,        // position=5
            wiEMBottom: worldInfoContent.emBottom,  // position=6
        };
    };

    const stData = getSTData();

    for (const prompt of preset.prompts) {
        if (!prompt.enabled) continue;

        let content = "";
        let role = prompt.role;

        switch (prompt.type) {
            case "custom":
                content = prompt.content;
                // 解析宏变量（如 {{user}}, {{char}}, {{setvar::}}, {{getvar::}} 等）
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("宏变量解析失败:", e);
                    }
                }
                break;

            case "memory":
                // 记忆摘要
                if (memory) {
                    content = memory;
                }
                if (editorContent) {
                    content = content ? `${content}\n\n${editorContent}` : editorContent;
                }
                break;

            case "history":
                // 从context.chat获取最近N轮对话，使用酒馆的转换逻辑
                const historyCount = prompt.historyCount || 10;
                const chat = context?.chat || [];
                const recentChat = chat.slice(-(historyCount * 2));
                if (recentChat.length > 0) {
                    // 获取标签过滤配置
                    const config = loadConfig();
                    const tagFilterConfig = config.global?.contextTagFilter;

                    // 获取酒馆的名字行为设置
                    // character_names_behavior: NONE=-1, DEFAULT=0, COMPLETION=1, CONTENT=2
                    const namesBehavior = context?.chatCompletionSettings?.names_behavior ?? 0;
                    const userName = context?.name1 || "User";
                    const isGroupChat = !!context?.groupId;

                    // 使用酒馆的消息转换逻辑
                    for (const m of recentChat) {
                        // 如果标记了忽略，跳过（酒馆的 IGNORE_SYMBOL）
                        if (m.extra?.ignore) {
                            continue;
                        }

                        // 根据 is_user 判断角色
                        let role = m.is_user ? "user" : "assistant";
                        let messageContent = m.mes || "";

                        // 旁白消息变成 system（酒馆的 system_message_types.NARRATOR）
                        if (m.extra?.type === "narrator") {
                            role = "system";
                        }

                        // 根据 names_behavior 设置决定是否加角色名前缀
                        switch (namesBehavior) {
                            case -1: // NONE - 不加名字
                                break;
                            case 0: // DEFAULT - 群聊或 sendas 时加名字
                                if ((isGroupChat && m.name !== userName) ||
                                    (m.force_avatar && m.name !== userName && m.extra?.type !== "narrator")) {
                                    messageContent = `${m.name}: ${messageContent}`;
                                }
                                break;
                            case 2: // CONTENT - 除旁白外都加名字
                                if (m.extra?.type !== "narrator") {
                                    messageContent = `${m.name}: ${messageContent}`;
                                }
                                break;
                            case 1: // COMPLETION - 通过 API 的 name 字段处理，不在 content 中加
                            default:
                                break;
                        }

                        // 移除回车符（酒馆的处理）
                        messageContent = messageContent.replace(/\r/gm, "");

                        // 应用标签过滤（插件特有功能）- 使用分类过滤
                        if (tagFilterConfig) {
                            messageContent = filterContentByRole(messageContent, tagFilterConfig, m.is_user);
                        }

                        if (messageContent) {
                            const msg = {
                                role: role,
                                content: messageContent,
                            };
                            // 如果是 COMPLETION 模式且有名字，添加 name 字段
                            if (namesBehavior === 1 && m.name && m.extra?.type !== "narrator") {
                                msg.name = m.name;
                            }
                            messages.push(msg);
                        }
                    }
                }
                // 不设置content，跳过下面的push
                content = "";
                break;

            case "charDescription":
                // 角色描述 - 从ST获取
                content = stData.charDescription;
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("角色描述宏变量解析失败:", e);
                    }
                }
                break;

            case "charPersonality":
                // 角色性格 - 从ST获取
                content = stData.charPersonality;
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("角色性格宏变量解析失败:", e);
                    }
                }
                break;

            case "scenario":
                // 场景 - 从ST获取
                content = stData.scenario;
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("场景宏变量解析失败:", e);
                    }
                }
                break;

            case "personaDescription":
                // 用户人设 - 从ST获取
                content = stData.personaDescription;
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("用户人设宏变量解析失败:", e);
                    }
                }
                break;

            case "dialogueExamples":
                // 对话示例 - 从ST获取
                content = stData.dialogueExamples;
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("对话示例宏变量解析失败:", e);
                    }
                }
                break;

            // 世界书独立位置
            case "wiBefore":
                // 世界书-角色描述前 (position=0)
                content = stData.wiBefore;
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("世界书-角色描述前 宏变量解析失败:", e);
                    }
                }
                break;

            case "wiAfter":
                // 世界书-角色描述后 (position=1)
                content = stData.wiAfter;
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("世界书-角色描述后 宏变量解析失败:", e);
                    }
                }
                break;

            case "wiANTop":
                // 世界书-作者注释顶部 (position=2)
                content = stData.wiANTop;
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("世界书-作者注释顶部 宏变量解析失败:", e);
                    }
                }
                break;

            case "wiANBottom":
                // 世界书-作者注释底部 (position=3)
                content = stData.wiANBottom;
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("世界书-作者注释底部 宏变量解析失败:", e);
                    }
                }
                break;

            case "wiAtDepth":
                // 世界书-按深度插入 (position=4)
                content = stData.wiAtDepth;
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("世界书-按深度插入 宏变量解析失败:", e);
                    }
                }
                break;

            case "wiEMTop":
                // 世界书-扩展消息顶部 (position=5)
                content = stData.wiEMTop;
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("世界书-扩展消息顶部 宏变量解析失败:", e);
                    }
                }
                break;

            case "wiEMBottom":
                // 世界书-扩展消息底部 (position=6)
                content = stData.wiEMBottom;
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("世界书-扩展消息底部 宏变量解析失败:", e);
                    }
                }
                break;

            case "character":
                // 兼容旧版本的character类型
                if (context?.characterId >= 0 && context?.characters) {
                    const char = context.characters[context.characterId];
                    content = char?.description || "";
                    if (content && substituteParams) {
                        try {
                            content = substituteParams(content);
                        } catch (e) {
                            log.warn("角色描述宏变量解析失败:", e);
                        }
                    }
                }
                break;

            case "user":
                content = userMessage;
                role = "user";
                break;

            default:
                content = prompt.content;
                // 默认类型也解析宏变量
                if (content && substituteParams) {
                    try {
                        content = substituteParams(content);
                    } catch (e) {
                        log.warn("宏变量解析失败:", e);
                    }
                }
        }

        if (content) {
            messages.push({ role, content });
        }
    }

    return messages;
}

// ============= 弹窗相关 =============

let currentEditingPreset = null;
let promptListContainer = null;

/**
 * 显示提示词预设配置弹窗
 * @param {string|null} presetId - 预设ID（编辑时传入，新增时为null）
 */
export function showPromptPresetModal(presetId = null) {
    // 移除已存在的弹窗
    const existingModal = document.getElementById("mm-prompt-preset-modal");
    if (existingModal) {
        existingModal.remove();
    }

    // 加载或创建预设
    if (presetId) {
        currentEditingPreset = JSON.parse(JSON.stringify(getPromptPresetById(presetId)));
        if (!currentEditingPreset) {
            toastr.error("找不到指定的预设");
            return;
        }
    } else {
        currentEditingPreset = {
            ...JSON.parse(JSON.stringify(defaultPromptPreset)),
            id: generateId(),
            name: "新预设",
            prompts: createDefaultPromptList(),
        };
    }

    // 创建弹窗
    const modal = createPromptPresetModal();
    document.body.appendChild(modal);

    // 绑定事件
    bindPromptPresetModalEvents(modal);

    // 显示弹窗
    setTimeout(() => modal.classList.add("mm-modal-visible"), 10);

    // 渲染提示词列表
    renderPromptList();
}

/**
 * 创建提示词预设弹窗DOM
 */
function createPromptPresetModal() {
    const modal = document.createElement("div");
    modal.id = "mm-prompt-preset-modal";
    modal.className = "mm-modal";
    // 使用CSS类控制样式，而不是内联样式
    modal.style.cssText = "z-index: 9999;";

    // 应用当前主题
    const settings = getGlobalSettings();
    const theme = settings.theme || "default";
    if (theme !== "default") {
        modal.setAttribute("data-mm-theme", theme);
    }

    const isEdit = currentEditingPreset?.createdAt > 0;

    modal.innerHTML = `
        <div class="mm-modal-content mm-modal-large mm-prompt-preset-modal-content">
            <div class="mm-modal-header">
                <h4><i class="fa-solid fa-file-lines"></i> ${isEdit ? "编辑" : "添加"}提示词预设</h4>
                <button class="mm-modal-close mm-btn mm-btn-icon">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>

            <div class="mm-modal-body">
                <!-- 预设名称 -->
                <div class="mm-form-group">
                    <label>预设名称 <span class="mm-required">*</span></label>
                    <input type="text" id="mm-preset-name" class="mm-input"
                           value="${currentEditingPreset?.name || ""}"
                           placeholder="输入预设名称">
                </div>

                <!-- 导入来源 -->
                <div class="mm-form-group">
                    <label>导入提示词</label>
                    <div class="mm-preset-import-actions">
                        <button type="button" id="mm-preset-import-current" class="mm-btn mm-btn-secondary">
                            <i class="fa-solid fa-download"></i> 从酒馆当前预设读取
                        </button>
                        <button type="button" id="mm-preset-import-file" class="mm-btn mm-btn-secondary">
                            <i class="fa-solid fa-file-import"></i> 导入预设文件
                        </button>
                        <button type="button" id="mm-preset-export" class="mm-btn mm-btn-secondary">
                            <i class="fa-solid fa-file-export"></i> 导出
                        </button>
                        <input type="file" id="mm-preset-file-input" accept=".json" style="display:none;">
                    </div>
                </div>

                <!-- 提示词列表 -->
                <div class="mm-form-group">
                    <label>提示词列表 <small>(可拖拽排序)</small></label>
                    <div class="mm-prompt-list-container" id="mm-prompt-list-container">
                        <!-- 动态生成 -->
                    </div>
                    <div class="mm-prompt-list-actions">
                        <button type="button" id="mm-preset-add-prompt" class="mm-btn mm-btn-secondary">
                            <i class="fa-solid fa-plus"></i> 添加自定义提示词
                        </button>
                    </div>
                </div>
            </div>

            <div class="mm-modal-footer">
                <button type="button" id="mm-preset-cancel" class="mm-btn mm-btn-secondary">
                    <i class="fa-solid fa-xmark"></i> 取消
                </button>
                <button type="button" id="mm-preset-save" class="mm-btn mm-btn-primary">
                    <i class="fa-solid fa-check"></i> 保存预设
                </button>
            </div>
        </div>
    `;

    return modal;
}

/**
 * 绑定弹窗事件
 */
function bindPromptPresetModalEvents(modal) {
    promptListContainer = modal.querySelector("#mm-prompt-list-container");

    // 关闭按钮
    modal.querySelector(".mm-modal-close")?.addEventListener("click", () => hidePromptPresetModal());
    modal.querySelector("#mm-preset-cancel")?.addEventListener("click", () => hidePromptPresetModal());

    // 保存按钮
    modal.querySelector("#mm-preset-save")?.addEventListener("click", () => {
        const nameInput = modal.querySelector("#mm-preset-name");
        const name = nameInput?.value?.trim();

        if (!name) {
            toastr.warning("请输入预设名称");
            nameInput?.focus();
            return;
        }

        currentEditingPreset.name = name;
        savePromptPreset(currentEditingPreset);
        toastr.success(`已保存提示词预设: ${name}`);
        hidePromptPresetModal();

        // 刷新预设列表
        renderPromptPresetList();
    });

    // 从酒馆当前预设读取
    modal.querySelector("#mm-preset-import-current")?.addEventListener("click", () => {
        // 如果已有提示词，提示用户确认覆盖
        if (currentEditingPreset.prompts && currentEditingPreset.prompts.length > 0) {
            if (!confirm("这将完全覆盖当前所有提示词，确定继续吗？")) {
                return;
            }
        }

        const prompts = extractPromptsFromCurrentPreset();
        if (prompts.length === 0) {
            toastr.warning("未能从酒馆当前预设读取到提示词");
            return;
        }

        // 完全清空旧数据，然后赋值新数据
        currentEditingPreset.prompts = [];
        currentEditingPreset.prompts = prompts;

        // 更新时间戳确保数据是最新的
        currentEditingPreset.updatedAt = Date.now();

        renderPromptList();
        toastr.success(`已导入 ${prompts.length} 条提示词（已覆盖旧数据）`);
    });

    // 导入预设文件
    const fileInput = modal.querySelector("#mm-preset-file-input");
    modal.querySelector("#mm-preset-import-file")?.addEventListener("click", () => {
        fileInput?.click();
    });

    fileInput?.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const presetJson = JSON.parse(text);
            const prompts = extractPromptsFromPreset(presetJson);

            if (prompts.length === 0) {
                toastr.warning("未能从文件中读取到提示词");
                return;
            }

            // extractPromptsFromPreset 已经处理好了所有占位符位置
            currentEditingPreset.prompts = prompts;

            renderPromptList();
            toastr.success(`已导入 ${prompts.length} 条提示词`);
        } catch (err) {
            log.error("导入预设文件失败:", err);
            toastr.error("导入失败: 文件格式错误");
        }

        // 清空文件输入
        fileInput.value = "";
    });

    // 导出
    modal.querySelector("#mm-preset-export")?.addEventListener("click", () => {
        const nameInput = modal.querySelector("#mm-preset-name");
        const name = nameInput?.value?.trim() || "预设";

        const exportData = {
            name: name,
            prompts: currentEditingPreset.prompts,
            exportedAt: Date.now(),
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${name}.json`;
        a.click();
        URL.revokeObjectURL(url);

        toastr.success("已导出预设");
    });

    // 添加自定义提示词
    modal.querySelector("#mm-preset-add-prompt")?.addEventListener("click", () => {
        const newPrompt = {
            id: `custom-${Date.now()}`,
            name: "新提示词",
            role: "system",
            content: "",
            enabled: true,
            type: "custom",
        };

        // 插入到用户消息之前
        const userIndex = currentEditingPreset.prompts.findIndex((p) => p.type === "user");
        if (userIndex >= 0) {
            currentEditingPreset.prompts.splice(userIndex, 0, newPrompt);
        } else {
            currentEditingPreset.prompts.push(newPrompt);
        }

        renderPromptList();
    });

    // 启用拖拽排序
    enableDragSort();
}

/**
 * 渲染提示词列表
 */
function renderPromptList() {
    if (!promptListContainer || !currentEditingPreset) return;

    const prompts = currentEditingPreset.prompts || [];

    promptListContainer.innerHTML = prompts
        .map(
            (prompt, index) => {
                // 计算字符数
                const charCount = getPromptCharCount(prompt);
                const charCountDisplay = charCount > 0 ? `<span class="mm-prompt-char-count">${charCount}字</span>` : "";

                return `
        <div class="mm-prompt-item ${prompt.enabled ? "" : "mm-prompt-disabled"}"
             data-index="${index}"
             data-prompt-id="${prompt.id}"
             data-type="${prompt.type}">
            <div class="mm-prompt-item-header">
                <span class="mm-prompt-drag-handle">
                    <i class="fa-solid fa-grip-vertical"></i>
                </span>
                <label class="mm-prompt-enable-label">
                    <input type="checkbox" class="mm-prompt-enable"
                           data-index="${index}"
                           ${prompt.enabled ? "checked" : ""}>
                </label>
                <span class="mm-prompt-name">${prompt.name}</span>
                ${charCountDisplay}
                <span class="mm-prompt-type-badge mm-prompt-type-${prompt.type}">${getTypeLabel(prompt.type)}</span>
                ${prompt.type === "history" ? `
                    <span class="mm-prompt-history-count">
                        轮数: <input type="number" class="mm-prompt-history-input"
                                     data-index="${index}"
                                     value="${prompt.historyCount || 10}"
                                     min="1" max="100">
                    </span>
                ` : ""}
                <div class="mm-prompt-item-actions">
                    ${prompt.type === "custom" ? `
                        <button class="mm-btn mm-btn-icon mm-prompt-edit" data-index="${index}" title="编辑">
                            <i class="fa-solid fa-edit"></i>
                        </button>
                        <button class="mm-btn mm-btn-icon mm-prompt-delete" data-index="${index}" title="删除">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    ` : ""}
                    <button class="mm-btn mm-btn-icon mm-prompt-toggle" data-index="${index}" title="展开/收起">
                        <i class="fa-solid fa-chevron-down"></i>
                    </button>
                </div>
            </div>
            <div class="mm-prompt-item-content" style="display:none;">
                <div class="mm-prompt-resizable-container">
                    ${prompt.type === "custom" ? `
                        <textarea class="mm-prompt-content-editor"
                                  data-index="${index}"
                                  rows="5">${prompt.content || ""}</textarea>
                    ` : `
                        <div class="mm-prompt-content-preview" data-history-count="${prompt.historyCount || 10}">
                            ${getPreviewHTML(prompt.type, { historyCount: prompt.historyCount || 10 })}
                        </div>
                    `}
                    <div class="mm-resize-handle" data-index="${index}"></div>
                </div>
            </div>
        </div>
    `;
            }
        )
        .join("");

    // 绑定事件
    bindPromptListEvents();
}

/**
 * 获取类型标签
 */
function getTypeLabel(type) {
    const labels = {
        custom: "自定义",
        memory: "插件",
        history: "动态",
        user: "用户",
        // ST跟随类型
        charDescription: "ST",
        charPersonality: "ST",
        scenario: "ST",
        personaDescription: "ST",
        dialogueExamples: "ST",
        // 世界书独立位置
        wiBefore: "世界书",
        wiAfter: "世界书",
        wiANTop: "世界书",
        wiANBottom: "世界书",
        wiAtDepth: "世界书",
        wiEMTop: "世界书",
        wiEMBottom: "世界书",
        // 兼容旧版
        character: "动态",
    };
    return labels[type] || type;
}

/**
 * 获取类型描述（静态说明）
 */
function getTypeDescription(type) {
    const descriptions = {
        memory: "此位置将插入记忆摘要和剧情优化内容（来自插件处理流程）",
        history: "此位置将插入聊天历史（从酒馆获取最近N轮对话）",
        user: "此位置将插入用户当前发送的消息",
        // ST跟随类型
        charDescription: "从当前角色卡获取角色描述",
        charPersonality: "从当前角色卡获取角色性格",
        scenario: "从当前角色卡获取场景",
        personaDescription: "从酒馆获取当前用户人设",
        dialogueExamples: "从当前角色卡获取对话示例",
        // 世界书独立位置
        wiBefore: "世界书条目 - 角色描述前 (Before Char Defs, position=0)",
        wiAfter: "世界书条目 - 角色描述后 (After Char Defs, position=1)",
        wiANTop: "世界书条目 - 作者注释顶部 (Author's Note Top, position=2)",
        wiANBottom: "世界书条目 - 作者注释底部 (Author's Note Bottom, position=3)",
        wiAtDepth: "世界书条目 - 按深度插入 (At Depth, position=4)",
        wiEMTop: "世界书条目 - 扩展消息顶部 (Extension Message Top, position=5)",
        wiEMBottom: "世界书条目 - 扩展消息底部 (Extension Message Bottom, position=6)",
        // 兼容旧版
        character: "此位置将插入角色描述（从酒馆获取当前角色卡描述）",
    };
    return descriptions[type] || "";
}

/**
 * 判断是否是世界书类型
 * @param {string} type - 类型
 * @returns {boolean}
 */
function isWorldInfoType(type) {
    return ["wiBefore", "wiAfter", "wiANTop", "wiANBottom", "wiAtDepth", "wiEMTop", "wiEMBottom"].includes(type);
}

/**
 * 世界书位置到 scanWorldInfoEntries 返回字段的映射
 */
const WI_TYPE_TO_FIELD = {
    wiBefore: "before",
    wiAfter: "after",
    wiANTop: "anTop",
    wiANBottom: "anBottom",
    wiAtDepth: "atDepth",
    wiEMTop: "emTop",
    wiEMBottom: "emBottom",
};

/**
 * 异步获取世界书预览内容（实际扫描世界书条目）
 * @param {string} type - 世界书类型
 * @returns {Promise<string>} 预览内容
 */
async function getWorldInfoPreviewContent(type) {
    const context = getContext();
    if (!context) return "(无法获取上下文)";

    // 构建扫描文本（使用最近的聊天历史）
    let scanText = "";
    const chat = context?.chat || [];
    const recentChat = chat.slice(-20);
    for (const m of recentChat) {
        if (m.mes) scanText += m.mes + "\n";
    }

    if (!scanText) {
        return "(暂无聊天记录，无法扫描世界书关键词)";
    }

    // 调用世界书扫描函数
    const worldInfoContent = await scanWorldInfoEntries(scanText);

    // 根据类型获取对应位置的内容
    const field = WI_TYPE_TO_FIELD[type];
    if (!field) {
        return "(未知的世界书位置类型)";
    }

    // 处理 atDepth 特殊情况（数组）
    if (field === "atDepth") {
        const atDepthEntries = worldInfoContent.atDepth || [];
        if (atDepthEntries.length === 0) {
            return "(当前无匹配的按深度插入条目)";
        }
        let content = `📚 按深度插入条目 (共 ${atDepthEntries.length} 条):\n\n`;
        for (const entry of atDepthEntries) {
            content += `【深度 ${entry.depth}】${entry.name || "未命名"}\n`;
            content += entry.content + "\n\n---\n\n";
        }
        return content;
    }

    // 其他位置的内容
    const content = worldInfoContent[field];
    if (!content) {
        const positionNames = {
            before: "角色描述前",
            after: "角色描述后",
            anTop: "作者注释顶部",
            anBottom: "作者注释底部",
            emTop: "扩展消息顶部",
            emBottom: "扩展消息底部",
        };
        return `(当前无匹配的${positionNames[field] || field}条目)`;
    }

    return content;
}

/**
 * 获取ST数据的实时预览内容（完整内容，不截断）
 * @param {string} type - 占位符类型
 * @param {object} options - 可选参数
 * @param {number} options.historyCount - 聊天历史轮数
 * @returns {string} 预览内容
 */
function getSTPreviewContent(type, options = {}) {
    const context = getContext();
    if (!context) return "";

    const char = context?.characterId >= 0 && context?.characters
        ? context.characters[context.characterId]
        : null;

    let content = "";
    switch (type) {
        case "charDescription":
        case "character":
            content = char?.description || "";
            break;
        case "charPersonality":
            content = char?.personality || char?.data?.personality || "";
            break;
        case "scenario":
            content = char?.scenario || char?.data?.scenario || "";
            break;
        case "personaDescription":
            // 优先从 context.powerUserSettings 获取用户人设
            content = getPersonaDescriptionFromContext(context);
            break;
        case "dialogueExamples":
            content = char?.mes_example || "";
            break;
        case "memory":
            // 记忆摘要是插件动态注入的内容，无法预览实际内容
            content = "📝 此位置将在发送时插入：\n• 插件处理的记忆摘要\n• 剧情优化内容（如有）\n\n内容来源于插件的记忆分类和总结功能。";
            break;
        case "user":
            // 用户消息是发送时的输入，无法预览
            content = "💬 此位置将在发送时插入用户当前输入的消息内容。";
            break;
        case "wiBefore":
        case "wiAfter":
        case "wiANTop":
        case "wiANBottom":
        case "wiAtDepth":
        case "wiEMTop":
        case "wiEMBottom":
            // 世界书内容将在展开时异步加载
            content = "⏳ 点击展开后将自动加载世界书条目内容...";
            break;
        case "history":
            // 按实际使用逻辑显示聊天历史（只取最近 N 轮）
            const historyCount = options.historyCount || 10;
            const chat = context?.chat || [];
            if (chat.length > 0) {
                // 取最近 historyCount * 2 条消息（N轮对话 = N条用户消息 + N条角色回复）
                const recentChat = chat.slice(-(historyCount * 2));
                const charName = context?.name2 || "Assistant";
                const userName = context?.name1 || "User";

                // 获取标签过滤配置
                const config = loadConfig();
                const tagFilterConfig = config.global?.contextTagFilter;

                // 获取酒馆的名字行为设置
                const namesBehavior = context?.chatCompletionSettings?.names_behavior ?? 0;
                const isGroupChat = !!context?.groupId;

                content = `📜 聊天历史记录 (显示最近 ${historyCount} 轮，共 ${recentChat.length} 条消息):\n\n`;
                content += recentChat
                    .map((m) => {
                        // 跳过被标记为忽略的消息
                        if (m.extra?.ignore) {
                            return null;
                        }

                        let messageContent = m.mes || "";

                        // 应用标签过滤 - 使用分类过滤
                        if (tagFilterConfig) {
                            messageContent = filterContentByRole(messageContent, tagFilterConfig, m.is_user);
                        }

                        // 确定角色
                        let role = m.is_user ? "user" : "assistant";
                        if (m.extra?.type === "narrator") {
                            role = "system";
                        }

                        // 根据 names_behavior 设置决定是否加角色名前缀
                        let displayName = m.is_user ? userName : charName;
                        let showName = false;

                        switch (namesBehavior) {
                            case -1: // NONE - 不加名字
                                showName = false;
                                break;
                            case 0: // DEFAULT - 群聊或 sendas 时加名字
                                if ((isGroupChat && m.name !== userName) ||
                                    (m.force_avatar && m.name !== userName && m.extra?.type !== "narrator")) {
                                    showName = true;
                                    displayName = m.name || displayName;
                                }
                                break;
                            case 2: // CONTENT - 除旁白外都加名字
                                if (m.extra?.type !== "narrator") {
                                    showName = true;
                                    displayName = m.name || displayName;
                                }
                                break;
                            case 1: // COMPLETION - 通过 API 的 name 字段处理
                            default:
                                showName = false;
                                break;
                        }

                        // 格式化显示
                        const roleLabel = role === "user" ? "👤" : (role === "system" ? "📝" : "🤖");
                        if (showName) {
                            return `${roleLabel}【${displayName}】\n${messageContent}`;
                        } else {
                            return `${roleLabel}【${m.is_user ? userName : charName}】\n${messageContent}`;
                        }
                    })
                    .filter(Boolean)
                    .join("\n\n---\n\n");
            } else {
                content = "📜 此位置将在发送时插入聊天历史记录。\n\n当前暂无聊天记录，开始对话后将显示内容。";
            }
            break;
    }

    // 不再截断内容，显示完整内容
    return content;
}

/**
 * 获取完整的预览HTML（包含说明和实时内容）
 * @param {string} type - 占位符类型
 * @param {object} options - 可选参数
 * @param {number} options.historyCount - 聊天历史轮数
 * @returns {string} HTML内容
 */
function getPreviewHTML(type, options = {}) {
    const description = getTypeDescription(type);
    const preview = getSTPreviewContent(type, options);

    // 将描述中的换行符转换为 <br> 标签
    const descriptionHtml = description.replace(/\n/g, '<br>');
    let html = `<div class="mm-prompt-type-desc">${descriptionHtml}</div>`;

    if (preview) {
        html += `<div class="mm-prompt-preview-content"><pre>${escapeHtml(preview)}</pre></div>`;
    } else {
        // 根据类型显示不同的空状态提示
        const emptyMessages = {
            charDescription: "（当前无内容，请确保已选择角色）",
            charPersonality: "（当前无内容，请确保已选择角色）",
            scenario: "（当前无内容，请确保已选择角色）",
            character: "（当前无内容，请确保已选择角色）",
            personaDescription: "（未设置用户人设）",
            dialogueExamples: "（当前角色卡无对话示例）",
        };
        if (emptyMessages[type]) {
            html += `<div class="mm-prompt-preview-empty">${emptyMessages[type]}</div>`;
        }
    }

    return html;
}

/**
 * HTML转义
 */
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 获取提示词的字符数
 * @param {object} prompt - 提示词对象
 * @returns {number} 字符数
 */
function getPromptCharCount(prompt) {
    // 自定义类型直接返回内容长度
    if (prompt.type === "custom") {
        return (prompt.content || "").length;
    }

    // ST类型获取实时内容长度
    const context = getContext();
    if (!context) return 0;

    const char = context?.characterId >= 0 && context?.characters
        ? context.characters[context.characterId]
        : null;

    switch (prompt.type) {
        case "charDescription":
        case "character":
            return (char?.description || "").length;
        case "charPersonality":
            return (char?.personality || char?.data?.personality || "").length;
        case "scenario":
            return (char?.scenario || char?.data?.scenario || "").length;
        case "personaDescription":
            // 优先从 context.powerUserSettings 获取用户人设（新版ST不一定暴露 window.power_user）
            try {
                const desc = getPersonaDescriptionFromContext(context);
                return desc.length;
            } catch (e) {
                // 忽略
            }
            return 0;
        case "dialogueExamples":
            return (char?.mes_example || "").length;
        case "wiBefore":
        case "wiAfter":
        case "wiANTop":
        case "wiANBottom":
        case "wiAtDepth":
        case "wiEMTop":
        case "wiEMBottom":
            // 世界书内容动态扫描，无法预估
            return 0;
        case "memory":
        case "history":
        case "user":
            // 这些是动态内容，无法预估
            return 0;
        default:
            return (prompt.content || "").length;
    }
}

/**
 * 绑定提示词列表事件
 */
function bindPromptListEvents() {
    if (!promptListContainer) return;

    // 启用/禁用
    promptListContainer.querySelectorAll(".mm-prompt-enable").forEach((checkbox) => {
        checkbox.addEventListener("change", (e) => {
            const index = parseInt(e.target.dataset.index);
            currentEditingPreset.prompts[index].enabled = e.target.checked;
            renderPromptList();
        });
    });

    // 历史轮数
    promptListContainer.querySelectorAll(".mm-prompt-history-input").forEach((input) => {
        input.addEventListener("change", (e) => {
            const index = parseInt(e.target.dataset.index);
            const newCount = parseInt(e.target.value) || 10;
            currentEditingPreset.prompts[index].historyCount = newCount;

            // 如果预览已展开，刷新预览内容
            const item = e.target.closest(".mm-prompt-item");
            const contentPanel = item?.querySelector(".mm-prompt-item-content");
            const previewContainer = item?.querySelector(".mm-prompt-content-preview");
            if (contentPanel && contentPanel.style.display !== "none" && previewContainer) {
                // 更新 data-history-count 属性
                previewContainer.dataset.historyCount = newCount;
                // 重新生成预览内容
                previewContainer.innerHTML = getPreviewHTML("history", { historyCount: newCount });
            }
        });
    });

    // 展开/收起
    promptListContainer.querySelectorAll(".mm-prompt-toggle").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const item = e.target.closest(".mm-prompt-item");
            const content = item?.querySelector(".mm-prompt-item-content");
            const previewContainer = item?.querySelector(".mm-prompt-content-preview");
            const icon = btn.querySelector("i");
            const promptType = item?.dataset.type;

            if (content) {
                const isHidden = content.style.display === "none";
                content.style.display = isHidden ? "block" : "none";
                icon?.classList.toggle("fa-chevron-down", !isHidden);
                icon?.classList.toggle("fa-chevron-up", isHidden);

                // 如果是展开且是世界书类型，异步加载实际内容
                if (isHidden && previewContainer && isWorldInfoType(promptType)) {
                    previewContainer.innerHTML = '<div class="mm-loading">正在加载世界书内容...</div>';
                    try {
                        const actualContent = await getWorldInfoPreviewContent(promptType);
                        previewContainer.innerHTML = `<div class="mm-prompt-type-desc">${getTypeDescription(promptType)}</div>` +
                            `<div class="mm-prompt-preview-content"><pre>${escapeHtml(actualContent)}</pre></div>`;
                    } catch (err) {
                        previewContainer.innerHTML = `<div class="mm-prompt-preview-empty">加载失败: ${err.message}</div>`;
                    }
                }
            }
        });
    });

    // 编辑内容
    promptListContainer.querySelectorAll(".mm-prompt-content-editor").forEach((textarea) => {
        textarea.addEventListener("input", (e) => {
            const index = parseInt(e.target.dataset.index);
            currentEditingPreset.prompts[index].content = e.target.value;
        });
    });

    // 编辑按钮（重命名）
    promptListContainer.querySelectorAll(".mm-prompt-edit").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const index = parseInt(e.target.closest("button").dataset.index);
            const prompt = currentEditingPreset.prompts[index];
            const newName = window.prompt("输入提示词名称:", prompt.name);
            if (newName && newName.trim()) {
                currentEditingPreset.prompts[index].name = newName.trim();
                renderPromptList();
            }
        });
    });

    // 删除
    promptListContainer.querySelectorAll(".mm-prompt-delete").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const index = parseInt(e.target.closest("button").dataset.index);
            if (confirm("确定要删除这条提示词吗?")) {
                currentEditingPreset.prompts.splice(index, 1);
                renderPromptList();
            }
        });
    });

    // 启用拖拽排序
    enableDragSort();

    // 启用内容高度调整
    enableContentResize();
}

/**
 * 启用拖拽排序 - 仅通过拖拽手柄触发
 */
function enableDragSort() {
    if (!promptListContainer) return;

    let draggedItem = null;

    promptListContainer.querySelectorAll(".mm-prompt-item").forEach((item) => {
        const handle = item.querySelector(".mm-prompt-drag-handle");
        if (!handle) return;

        // 只在拖拽手柄上启用拖拽
        handle.addEventListener("mousedown", () => {
            item.setAttribute("draggable", "true");
        });

        // 鼠标离开手柄或拖拽结束后禁用
        handle.addEventListener("mouseleave", () => {
            if (!draggedItem) {
                item.removeAttribute("draggable");
            }
        });

        item.addEventListener("dragstart", (e) => {
            // 确保是从手柄开始的拖拽
            if (!item.hasAttribute("draggable")) {
                e.preventDefault();
                return;
            }
            draggedItem = item;
            item.classList.add("mm-dragging");
            e.dataTransfer.effectAllowed = "move";
        });

        item.addEventListener("dragend", () => {
            item.classList.remove("mm-dragging");
            item.removeAttribute("draggable");
            draggedItem = null;
            promptListContainer.querySelectorAll(".mm-prompt-item").forEach((i) => {
                i.classList.remove("mm-drag-over-top", "mm-drag-over-bottom");
                i.removeAttribute("draggable");
            });
            // 拖拽结束后更新数据
            updatePromptOrder();
        });

        item.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (!draggedItem || draggedItem === item) return;
            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            item.classList.remove("mm-drag-over-top", "mm-drag-over-bottom");
            item.classList.add(e.clientY < midY ? "mm-drag-over-top" : "mm-drag-over-bottom");
        });

        item.addEventListener("dragleave", () => {
            item.classList.remove("mm-drag-over-top", "mm-drag-over-bottom");
        });

        item.addEventListener("drop", (e) => {
            e.preventDefault();
            if (!draggedItem || draggedItem === item) return;
            const rect = item.getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
                promptListContainer.insertBefore(draggedItem, item);
            } else {
                promptListContainer.insertBefore(draggedItem, item.nextSibling);
            }
            item.classList.remove("mm-drag-over-top", "mm-drag-over-bottom");
        });
    });
}

/**
 * 启用内容高度调整 - 支持触摸和鼠标
 */
function enableContentResize() {
    if (!promptListContainer) return;

    promptListContainer.querySelectorAll(".mm-resize-handle").forEach((handle) => {
        let isResizing = false;
        let startY = 0;
        let startHeight = 0;
        let targetElement = null;

        function getResizeTarget(handleEl) {
            const container = handleEl.closest(".mm-prompt-resizable-container");
            // 优先找 textarea，否则找 preview
            return container?.querySelector(".mm-prompt-content-editor") ||
                   container?.querySelector(".mm-prompt-content-preview");
        }

        function handleStart(e) {
            targetElement = getResizeTarget(handle);
            if (!targetElement) return;

            isResizing = true;
            startY = e.touches ? e.touches[0].clientY : e.clientY;
            startHeight = targetElement.offsetHeight;

            // 设置全局样式
            document.body.style.cursor = "ns-resize";
            document.body.style.userSelect = "none";

            document.addEventListener("mousemove", handleMove);
            document.addEventListener("mouseup", handleEnd);
            document.addEventListener("touchmove", handleMove, { passive: false });
            document.addEventListener("touchend", handleEnd);

            e.preventDefault();
        }

        function handleMove(e) {
            if (!isResizing || !targetElement) return;

            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const deltaY = clientY - startY;
            const newHeight = Math.max(80, startHeight + deltaY);

            targetElement.style.height = `${newHeight}px`;
            targetElement.style.maxHeight = "none";

            e.preventDefault();
        }

        function handleEnd() {
            if (isResizing) {
                isResizing = false;
                targetElement = null;
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                document.removeEventListener("mousemove", handleMove);
                document.removeEventListener("mouseup", handleEnd);
                document.removeEventListener("touchmove", handleMove);
                document.removeEventListener("touchend", handleEnd);
            }
        }

        handle.addEventListener("mousedown", handleStart);
        handle.addEventListener("touchstart", handleStart, { passive: false });
    });
}

/**
 * 更新提示词顺序
 */
function updatePromptOrder() {
    if (!promptListContainer || !currentEditingPreset) return;

    const items = promptListContainer.querySelectorAll(".mm-prompt-item");
    const newPrompts = [];

    // 根据DOM顺序和prompt ID重建数组
    items.forEach((item) => {
        const promptId = item.dataset.promptId;
        if (promptId) {
            const prompt = currentEditingPreset.prompts.find(p => p.id === promptId);
            if (prompt) {
                newPrompts.push(prompt);
            }
        }
    });

    if (newPrompts.length === currentEditingPreset.prompts.length) {
        currentEditingPreset.prompts = newPrompts;
        // 延迟重新渲染以更新索引
        setTimeout(() => renderPromptList(), 10);
    }
}

/**
 * 获取拖拽后应该插入的位置（备用）
 */
function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll(".mm-prompt-item:not(.mm-dragging)")];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/**
 * 隐藏弹窗
 */
export function hidePromptPresetModal() {
    const modal = document.getElementById("mm-prompt-preset-modal");
    if (modal) {
        modal.classList.remove("mm-modal-visible");
        setTimeout(() => modal.remove(), 300);
    }
    currentEditingPreset = null;
    promptListContainer = null;
}

/**
 * 渲染预设列表（设置界面用）
 */
export function renderPromptPresetList() {
    const container = document.getElementById("mm-prompt-preset-list");
    const emptyEl = document.getElementById("mm-prompt-preset-empty");
    if (!container) return;

    const presets = getPromptPresets();

    if (presets.length === 0) {
        container.innerHTML = "";
        if (emptyEl) emptyEl.style.display = "flex";
        return;
    }

    if (emptyEl) emptyEl.style.display = "none";

    container.innerHTML = presets
        .map(
            (preset) => `
        <div class="mm-prompt-preset-item" data-id="${preset.id}">
            <div class="mm-preset-info">
                <span class="mm-preset-name">${preset.name}</span>
                <span class="mm-preset-count">(${preset.prompts?.length || 0}条提示词)</span>
            </div>
            <div class="mm-preset-actions">
                <button class="mm-btn mm-btn-icon mm-preset-edit-btn" data-id="${preset.id}" title="编辑">
                    <i class="fa-solid fa-edit"></i>
                </button>
                <button class="mm-btn mm-btn-icon mm-preset-delete-btn" data-id="${preset.id}" title="删除">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
    `
        )
        .join("");

    // 绑定事件
    container.querySelectorAll(".mm-preset-edit-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            showPromptPresetModal(btn.dataset.id);
        });
    });

    container.querySelectorAll(".mm-preset-delete-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (confirm("确定要删除这个预设吗?")) {
                deletePromptPreset(btn.dataset.id);
                renderPromptPresetList();
                toastr.success("已删除预设");
            }
        });
    });
}

export default {
    extractPromptsFromPreset,
    extractPromptsFromCurrentPreset,
    getPromptPresets,
    getPromptPresetById,
    savePromptPreset,
    deletePromptPreset,
    buildMessagesFromPreset,
    showPromptPresetModal,
    hidePromptPresetModal,
    renderPromptPresetList,
};
