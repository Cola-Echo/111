/**
 * 提示词构建模块
 * @module memory/prompt-builder
 */

import Logger from '@core/logger';
import { getGlobalConfig } from '@config/config-manager';

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
 * 将数据注入到提示词模板
 * @param {object} template 提示词模板
 * @param {object} dataInjection 数据注入对象
 * @returns {object} 注入后的提示词
 */
export function injectDataToPrompt(template, dataInjection) {
    let mainPrompt = template.mainPrompt || template.main_prompt || "";
    let systemPrompt = template.systemPrompt || template.system_prompt || "";

    // 构建数据注入内容
    let injectionContent = "";
    let injectionParts = [];

    // 注入世界书内容
    if (dataInjection.worldBookContent) {
        injectionContent += `<世界书内容>\n${dataInjection.worldBookContent}\n</世界书内容>\n\n`;
        injectionParts.push({
            label: "世界书内容",
            content: dataInjection.worldBookContent,
            source: "worldbook",
        });
    } else {
        const emptyWorldbook = `[当前无世界书数据，禁止编造任何历史事件回忆或关键词]`;
        injectionContent += `<世界书内容>\n${emptyWorldbook}\n</世界书内容>\n\n`;
        injectionParts.push({
            label: "世界书内容",
            content: emptyWorldbook,
            source: "worldbook",
        });
    }

    // 注入前文内容（最近对话上下文）
    if (dataInjection.context) {
        injectionContent += `<前文内容>\n${dataInjection.context}\n</前文内容>\n\n`;
        injectionParts.push({
            label: "前文内容",
            content: dataInjection.context,
            source: "context",
        });
    }

    // 注入用户消息
    if (dataInjection.userMessage) {
        injectionContent += `<核心用户消息>\n${dataInjection.userMessage}\n</核心用户消息>\n`;
    }

    // 将数据注入到 <数据注入区> 占位符
    if (mainPrompt.includes("<数据注入区>")) {
        mainPrompt = mainPrompt.replace(
            "<数据注入区>",
            `<数据注入区>\n${injectionContent}`
        );
    }

    // 合并 mainPrompt 和 systemPrompt
    const finalSystemPrompt = mainPrompt + "\n" + systemPrompt;

    return {
        systemPrompt: finalSystemPrompt,
        injectionParts: injectionParts,
        mainPrompt: mainPrompt,
        auxiliaryPrompt: systemPrompt,
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
