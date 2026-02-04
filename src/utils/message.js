/**
 * 消息处理工具模块
 * @module utils/message
 */

import Logger from '@core/logger';
import { getGlobalConfig } from '@config/config-manager';
import { filterContentByRole } from './tag-filter';

/**
 * 获取最后一条用户消息
 * @param {Array} chat 聊天记录数组
 * @returns {string} 用户消息内容
 */
export function getLastUserMessage(chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i].role === "user" || chat[i].is_user) {
            return chat[i].content || chat[i].mes || "";
        }
    }
    return "";
}

/**
 * 获取最近的对话上下文
 * [标签过滤调用点1] 前文内容来源 - 此函数会应用标签过滤配置
 * @param {Array} chat 聊天记录数组
 * @param {number} contextRounds 上下文轮次
 * @returns {string} 格式化的上下文
 */
export function getRecentContext(chat, contextRounds = 5) {
    // 每轮包含用户消息+助手回复，所以消息数 = 轮次 * 2
    const maxMessages = contextRounds * 2;
    if (maxMessages <= 0) return "";

    // 获取标签过滤配置（支持新格式 { user: {...}, ai: {...} }）
    const globalConfig = getGlobalConfig();
    const tagFilterConfig = globalConfig.contextTagFilter;

    Logger.debug("[标签过滤] 配置:", JSON.stringify(tagFilterConfig));

    const recent = chat.slice(-maxMessages);
    return recent
        .map((msg) => {
            const isUser = msg.is_user || msg.role === "user";
            const role = isUser ? "user" : "assistant";
            let content = msg.content || msg.mes || "";

            // 使用 filterContentByRole 处理标签过滤（支持新旧配置格式）
            content = filterContentByRole(content, tagFilterConfig, isUser);

            return `${role}: ${content}`;
        })
        .join("\n\n");
}

/**
 * 获取消息的角色
 * @param {object} msg 消息对象
 * @returns {string} "user" 或 "assistant"
 */
export function getMessageRole(msg) {
    if (msg.is_user || msg.role === "user") {
        return "user";
    }
    return "assistant";
}

/**
 * 获取消息内容
 * @param {object} msg 消息对象
 * @returns {string} 消息内容
 */
export function getMessageContent(msg) {
    return msg.content || msg.mes || "";
}
