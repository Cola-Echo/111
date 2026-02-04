/**
 * 拦截器模块
 * @module hooks/interceptor
 */

import Logger from '@core/logger';
import { loadConfig } from '@config/config-manager';

/**
 * 获取最后一条用户消息
 * @param {Array} chat 聊天记录数组
 * @returns {Object|null} 用户消息对象
 */
function getLastUserMessage(chat) {
    if (!chat || !Array.isArray(chat) || chat.length === 0) {
        return null;
    }

    // 从后往前遍历，找到最后一条用户消息
    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        // 检查是否是用户消息
        if (msg.is_user || msg.role === 'user') {
            return msg;
        }
    }

    return null;
}

/**
 * 处理记忆注入的核心逻辑
 * @param {Array} chat 聊天记录数组
 * @param {number} contextSize 上下文大小
 * @param {AbortSignal} abort 中止信号
 * @param {string} type 生成类型
 */
async function processMemoryInjection(chat, contextSize, abort, type) {
    // 目前由自定义发送按钮钩子处理
    // 拦截器仅作为备用机制，不执行实际注入
    // 实际的记忆注入由 send-button-hook.js 中的 hookSendButton 处理
    Logger.debug('[拦截器] processMemoryInjection 调用 - 由发送按钮钩子处理');
}

/**
 * 注册全局拦截器
 * 这个拦截器会在 SillyTavern 生成消息前被调用
 */
export function registerInterceptor() {
    // 注册 generate_interceptor（在 manifest.json 中配置）
    globalThis.MemoryManagerConcurrent_intercept = async function(chat, contextSize, abort, type) {
        Logger.debug('拦截器触发:', { contextSize, type });

        // 加载配置
        const config = loadConfig();

        // 检查是否启用
        if (!config.global?.enabled) {
            return;
        }

        try {
            Logger.log('[拦截器] 开始处理记忆注入');

            // 执行记忆检索和注入
            await processMemoryInjection(chat, contextSize, abort, type);

            Logger.log('[拦截器] 记忆注入完成');
        } catch (error) {
            Logger.error('[拦截器] 处理失败', error);
            // 不阻止生成，让请求继续
        }
    };

    Logger.log('全局拦截器已注册');
    Logger.log('拦截器函数已挂载到 globalThis.MemoryManagerConcurrent_intercept');
}

/**
 * 取消注册拦截器
 */
export function unregisterInterceptor() {
    if (globalThis.MemoryManagerConcurrent_intercept) {
        delete globalThis.MemoryManagerConcurrent_intercept;
        Logger.log('全局拦截器已取消注册');
    }
}
