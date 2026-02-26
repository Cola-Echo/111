/**
 * 提示词构建模块
 * @module memory/prompt-builder
 */

import Logger from '@core/logger';
import { getGlobalConfig, getGlobalSettings } from '@config/config-manager';

// 默认流程顺序（与 flow-configs/default.json 保持一致）
const DEFAULT_FLOW_ORDER = ["jailbreak", "main", "worldbook", "context", "auxiliary", "user"];

/**
 * 获取流程配置顺序
 * @param {string} flowType 流程类型（记忆世界书、总结世界书、索引合并、剧情优化）
 * @returns {Array<string>} 流程顺序数组
 */
function getFlowOrder(flowType) {
    const settings = getGlobalSettings();
    const savedOrder = settings.promptPartsOrder || {};
    const sourceOrder = savedOrder[flowType];

    // 如果有用户保存的顺序，使用它；否则使用默认顺序
    if (sourceOrder && Array.isArray(sourceOrder) && sourceOrder.length > 0) {
        return sourceOrder;
    }

    return DEFAULT_FLOW_ORDER;
}

/**
 * 构建数据注入对象
 * @param {object} data 原始数据
 * @returns {object} 数据注入对象
 */
export function buildDataInjection(data) {
    return {
        worldBookContent: data.worldBookContent || "",
        context: data.context || "",
        userMessage: data.userMessage || "",
    };
}

/**
 * 将数据注入到提示词模板（支持流程配置顺序）
 * @param {object} template 提示词模板
 * @param {object} dataInjection 数据注入对象
 * @param {object} options 选项
 * @param {string} options.flowType 流程类型，默认 "记忆世界书"
 * @param {string} options.jailbreakPrefix 破限词前缀
 * @returns {object} 注入后的提示词
 */
export function injectDataToPrompt(template, dataInjection, options = {}) {
    const {
        flowType = "记忆世界书",
        jailbreakPrefix = "",
    } = options;

    const mainPromptRaw = template.mainPrompt || template.main_prompt || "";
    const systemPromptRaw = template.systemPrompt || template.system_prompt || "";

    // 分离 mainPrompt 中 <数据注入区> 前后的内容
    let mainPromptBefore = mainPromptRaw;
    let mainPromptAfter = "";
    if (mainPromptRaw.includes("<数据注入区>")) {
        const parts = mainPromptRaw.split("<数据注入区>");
        mainPromptBefore = parts[0] || "";
        mainPromptAfter = parts.slice(1).join("<数据注入区>") || "";
    }

    // 构建各个来源的内容块
    const sourceContents = {};
    const injectionParts = [];

    // jailbreak - 破限词
    if (jailbreakPrefix && jailbreakPrefix.trim()) {
        sourceContents.jailbreak = jailbreakPrefix.trim();
    }

    // main - 主提示词（<数据注入区>前的部分）
    if (mainPromptBefore && mainPromptBefore.trim()) {
        sourceContents.main = mainPromptBefore.trim();
    }

    // worldbook - 世界书内容
    if (dataInjection.worldBookContent) {
        sourceContents.worldbook = `<世界书内容>\n${dataInjection.worldBookContent}\n</世界书内容>`;
        injectionParts.push({
            label: "世界书内容",
            content: dataInjection.worldBookContent,
            source: "worldbook",
        });
    } else {
        const emptyWorldbook = `[当前无世界书数据，禁止编造任何历史事件回忆或关键词]`;
        sourceContents.worldbook = `<世界书内容>\n${emptyWorldbook}\n</世界书内容>`;
        injectionParts.push({
            label: "世界书内容",
            content: emptyWorldbook,
            source: "worldbook",
        });
    }

    // context - 前文内容
    if (dataInjection.context) {
        sourceContents.context = `<前文内容>\n${dataInjection.context}\n</前文内容>`;
        injectionParts.push({
            label: "前文内容",
            content: dataInjection.context,
            source: "context",
        });
    }

    // auxiliary - 辅助提示词（systemPrompt + mainPrompt 中 <数据注入区> 后的部分）
    let auxiliaryContent = "";
    if (mainPromptAfter && mainPromptAfter.trim()) {
        auxiliaryContent += mainPromptAfter.trim();
    }
    if (systemPromptRaw && systemPromptRaw.trim()) {
        if (auxiliaryContent) {
            auxiliaryContent += "\n";
        }
        auxiliaryContent += systemPromptRaw.trim();
    }
    if (auxiliaryContent) {
        sourceContents.auxiliary = auxiliaryContent;
    }

    // user - 用户消息（作为最后的用户提示词，不在系统提示词中）
    // 注意：user 部分不放入 systemPrompt，而是单独返回给调用方处理

    // 获取流程顺序
    const flowOrder = getFlowOrder(flowType);

    // 按流程顺序构建系统提示词
    const orderedParts = [];
    for (const source of flowOrder) {
        // user 来源不放入系统提示词
        if (source === "user") continue;

        if (sourceContents[source]) {
            orderedParts.push(sourceContents[source]);
        }
    }

    // 添加未在流程配置中的部分（保持原顺序）
    for (const [source, content] of Object.entries(sourceContents)) {
        if (source === "user") continue;
        if (!flowOrder.includes(source) && content) {
            orderedParts.push(content);
        }
    }

    // 合并为最终的系统提示词
    const finalSystemPrompt = orderedParts.join("\n\n");

    return {
        systemPrompt: finalSystemPrompt,
        injectionParts: injectionParts,
        mainPrompt: mainPromptBefore,
        auxiliaryPrompt: auxiliaryContent,
        flowOrder: flowOrder,
    };
}

/**
 * 构建用户提示词
 * @param {string} userMessage 用户消息
 * @returns {string} 包装后的用户消息
 */
export function buildUserPrompt(userMessage) {
    return `<核心用户消息>\n${userMessage}\n</核心用户消息>`;
}

/**
 * 替换提示词中的变量
 * @param {string} prompt 提示词
 * @param {object} aiConfig AI 配置
 * @param {object} globalConfig 全局配置
 * @returns {string} 替换后的提示词
 */
export function replacePromptVariables(prompt, aiConfig, globalConfig) {
    let result = prompt;

    // 关联性阈值
    const relevanceThreshold = aiConfig?.relevanceThreshold ?? globalConfig?.relevanceThreshold ?? 0.6;
    result = result.replace(/@RELEVANCE_THRESHOLD=sulv1/g, `@RELEVANCE_THRESHOLD=${relevanceThreshold}`);

    // 历史事件数量
    const maxHistoryEvents = aiConfig?.maxHistoryEvents || 15;
    result = result.replace(/@MAX_HISTORY_EVENT_RECORDS=sulv2/g, `@MAX_HISTORY_EVENT_RECORDS=${maxHistoryEvents}`);

    // 重要信息数量
    result = result.replace(/@MAX_IMPORTANT_INFO_RECORDS=sulv3/g, "@MAX_IMPORTANT_INFO_RECORDS=0");

    // 关键词数量
    const maxKeywords = aiConfig?.maxKeywords || 10;
    result = result.replace(/@MAX_KEYWORD_RESULT_RECORDS=sulv4/g, `@MAX_KEYWORD_RESULT_RECORDS=${maxKeywords}`);

    return result;
}

/**
 * 注入记忆到聊天消息
 * @param {Array} chat 聊天记录数组
 * @param {string} memory 记忆内容
 */
export function injectMemory(chat, memory) {
    if (!memory || !chat || chat.length === 0) return;

    const lastIndex = chat.length - 1;
    const lastMessage = chat[lastIndex];

    const wrappedMemory = `<Plot_progression>\n<details>\n${memory}\n</details>\n</Plot_progression>`;

    if (lastMessage.content) {
        lastMessage.content = wrappedMemory + "\n\n" + lastMessage.content;
    } else if (lastMessage.mes) {
        lastMessage.mes = wrappedMemory + "\n\n" + lastMessage.mes;
    }

    Logger.debug("已注入记忆到消息");
}
