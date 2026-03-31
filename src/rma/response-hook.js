/**
 * RMA 事件监听 — 后处理拦截
 * 监听 MESSAGE_RECEIVED 和 MESSAGE_DELETED 事件
 * @module rma/response-hook
 */

import Logger from '@core/logger';
import { getContext, getEventSource, getEventTypes, getCurrentChat } from '@core/sillytavern-api';
import { isRmaEnabled } from './index';
import { hasRmaConfig } from './config-loader';
import { getRmaState, invalidateMemoriesByMessage, saveRmaState } from './memory-store';
import { analyzeResponse } from './analyzer';

const log = Logger.createModuleLogger('RMA-ResponseHook');

let _pendingAnalysis = null;
let _onAnalysisComplete = null;

/**
 * 设置分析完成回调（由 float-panel 注入）
 * @param {Function} fn
 */
export function setOnAnalysisCompleteCallback(fn) {
    _onAnalysisComplete = fn;
}

/**
 * 获取待确认的分析结果
 * @returns {object|null}
 */
export function getPendingAnalysis() {
    return _pendingAnalysis;
}

/**
 * 清除待确认的分析结果
 */
export function clearPendingAnalysis() {
    _pendingAnalysis = null;
}

/**
 * 注册 RMA 事件监听器
 */
export function registerRmaEventListeners() {
    const eventSource = getEventSource();
    const eventTypes = getEventTypes();

    if (!eventSource) {
        log.warn('事件系统不可用');
        return;
    }

    // 监听 AI 回复完成事件
    const messageEvent = eventTypes.CHARACTER_MESSAGE_RENDERED || eventTypes.MESSAGE_RECEIVED;
    if (messageEvent) {
        eventSource.on(messageEvent, handleMessageReceived);
        log.log(`已注册 ${messageEvent === eventTypes.CHARACTER_MESSAGE_RENDERED ? 'CHARACTER_MESSAGE_RENDERED' : 'MESSAGE_RECEIVED'} 监听`);
    }

    // 监听消息删除事件（回滚同步）
    if (eventTypes.MESSAGE_DELETED) {
        eventSource.on(eventTypes.MESSAGE_DELETED, handleMessageDeleted);
        log.log('已注册 MESSAGE_DELETED 监听');
    }
}

/**
 * AI 回复完成后的处理
 */
async function handleMessageReceived(messageId) {
    // 检查条件
    if (!isRmaEnabled()) return;
    if (!hasRmaConfig()) return;

    const state = getRmaState();
    if (!state) return;

    try {
        const chat = getCurrentChat();
        if (!chat || chat.length === 0) return;

        // 获取最新 AI 回复
        const latestMsg = chat[chat.length - 1];
        if (!latestMsg || latestMsg.is_user) return;

        const latestResponse = latestMsg.mes || '';
        if (!latestResponse.trim()) return;

        // 获取最近消息（最多 10 条）
        const recentMessages = chat.slice(-10);

        log.log('触发后处理分析...');
        const result = await analyzeResponse(recentMessages, latestResponse);

        if (result) {
            // 附加消息 ID
            if (result.json?.new_memories) {
                const msgIndex = chat.length - 1;
                result.json.new_memories.forEach(m => {
                    m.message_id = msgIndex;
                });
            }

            _pendingAnalysis = result;
            log.log('分析完成，等待用户确认');

            // 通知 UI
            if (_onAnalysisComplete) {
                _onAnalysisComplete(result);
            }
        }
    } catch (e) {
        log.warn('后处理分析出错:', e);
    }
}

/**
 * 消息删除时的回滚同步
 */
async function handleMessageDeleted(messageId) {
    if (!isRmaEnabled()) return;
    if (!hasRmaConfig()) return;

    const state = getRmaState();
    if (!state) return;

    const numId = typeof messageId === 'number' ? messageId : parseInt(messageId);
    if (isNaN(numId)) return;

    invalidateMemoriesByMessage(numId);
    await saveRmaState();

    // 通知 UI 刷新
    if (_onAnalysisComplete) {
        _onAnalysisComplete(null); // null 表示仅刷新面板
    }
}
