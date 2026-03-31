/**
 * 多AI并发生成器
 * @module api/multi-ai-generator
 */

import Logger from '@core/logger';
import { StreamingHandler } from './streaming-handler';
import { getEnabledProviders } from '@config/config-manager';
import { buildMessagesFromPreset, getPromptPresetById } from '@ui/modals/prompt-preset';
import { buildOpenAIChatUrl, buildAnthropicUrl } from '@utils/url-builder';

const log = Logger.createModuleLogger('多AI生成');

/**
 * 估算文本的 token 数量
 * 中文约 1.5 字符 = 1 token，英文约 4 字符 = 1 token
 * @param {string} text 文本内容
 * @returns {number} 估算的 token 数
 */
function estimateTokens(text) {
    if (!text) return 0;

    let tokens = 0;
    const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || [];
    const nonChineseText = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ');

    // 中文：约 1.5 字符 = 1 token
    tokens += Math.ceil(chineseChars.length / 1.5);
    // 英文：约 4 字符 = 1 token
    const nonChineseLength = nonChineseText.replace(/\s+/g, ' ').trim().length;
    tokens += Math.ceil(nonChineseLength / 4);

    return tokens;
}

/**
 * 格式化 token 数量显示
 * @param {number} tokens token 数量
 * @returns {string} 格式化后的字符串
 */
export function formatTokens(tokens) {
    if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}k`;
    }
    return `${tokens}`;
}

/**
 * 生成结果状态
 */
export const GenerationStatus = {
    PENDING: 'pending',
    GENERATING: 'generating',
    SUCCESS: 'success',
    ERROR: 'error',
    CANCELLED: 'cancelled',
};

/**
 * 多AI生成器类
 */
export class MultiAIGenerator {
    constructor() {
        /** @type {Map<string, AbortController>} */
        this.abortControllers = new Map();
        /** @type {Map<string, object>} */
        this.results = new Map();
    }

    /**
     * 并发生成所有provider的回复
     * @param {Array} providers provider配置列表
     * @param {Array} messages 默认消息列表 [{role, content}]
     * @param {object} callbacks 回调函数
     * @param {Function} callbacks.onChunk (providerId, chunk) => void
     * @param {Function} callbacks.onComplete (providerId, result) => void
     * @param {Function} callbacks.onError (providerId, error) => void
     * @param {object} presetContext 预设构建上下文（可选）
     * @param {string} presetContext.memory 记忆摘要
     * @param {string} presetContext.editorContent 剧情优化内容
     * @param {string} presetContext.userMessage 用户消息
     * @returns {Promise<void>}
     */
    async generateAll(providers, messages, callbacks = {}, presetContext = null) {
        log.log(`开始并发生成，共 ${providers.length} 个provider`);

        // 初始化所有provider的状态
        providers.forEach(provider => {
            this.results.set(provider.id, {
                providerId: provider.id,
                providerName: provider.name,
                model: provider.model,
                streaming: provider.streaming,
                status: GenerationStatus.PENDING,
                content: '',
                error: null,
                startTime: null,
                endTime: null,
                duration: 0,
                outputTokens: 0,
            });
        });

        // 并发调用所有provider
        const promises = providers.map(provider =>
            this.generateSingle(provider, messages, callbacks, presetContext)
        );

        // 等待所有完成（不抛出错误）
        await Promise.allSettled(promises);

        log.log('所有provider生成完成');
    }

    /**
     * 单个provider生成
     * @param {object} provider provider配置
     * @param {Array} defaultMessages 默认消息列表
     * @param {object} callbacks 回调函数
     * @param {object} presetContext 预设构建上下文（可选）
     * @returns {Promise<object>} 生成结果
     */
    async generateSingle(provider, defaultMessages, callbacks = {}, presetContext = null) {
        const { onChunk, onComplete, onError } = callbacks;
        const result = this.results.get(provider.id) || {
            providerId: provider.id,
            providerName: provider.name,
            model: provider.model,
            streaming: provider.streaming,
            status: GenerationStatus.PENDING,
            content: '',
            error: null,
            startTime: null,
            endTime: null,
            duration: 0,
            outputTokens: 0,
        };

        // 创建新的AbortController
        const controller = new AbortController();
        this.abortControllers.set(provider.id, controller);

        result.status = GenerationStatus.GENERATING;
        result.startTime = Date.now();
        result.content = '';
        result.error = null;
        this.results.set(provider.id, result);

        try {
            log.log(`开始生成: ${provider.name} (${provider.model})`);

            // 构建消息：如果provider配置了预设，则使用预设构建消息
            let messages = defaultMessages;
            if (provider.usePromptPreset && provider.promptPresetId && presetContext) {
                const preset = getPromptPresetById(provider.promptPresetId);
                if (preset) {
                    log.log(`使用预设 "${preset.name}" 构建消息: ${provider.name}`);
                    messages = await buildMessagesFromPreset(preset, {
                        memory: presetContext.memory,
                        editorContent: presetContext.editorContent,
                        userMessage: presetContext.userMessage,
                    });
                    log.log(`预设消息构建完成，共 ${messages.length} 条消息`);
                } else {
                    log.warn(`找不到预设 ${provider.promptPresetId}，使用默认消息`);
                }
            }

            const content = await this.callProvider(
                provider,
                messages,
                controller.signal,
                (chunk) => {
                    result.content += chunk;
                    if (onChunk) {
                        onChunk(provider.id, chunk);
                    }
                }
            );

            result.content = content;
            result.status = GenerationStatus.SUCCESS;
            result.endTime = Date.now();
            result.duration = Math.floor((result.endTime - result.startTime) / 1000);
            result.outputTokens = estimateTokens(content);

            log.log(`生成完成: ${provider.name} 耗时 ${result.duration}s, ~${result.outputTokens}t`);

            if (onComplete) {
                onComplete(provider.id, result);
            }

            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                result.status = GenerationStatus.CANCELLED;
                result.error = '已取消';
                log.log(`生成已取消: ${provider.name}`);
            } else {
                result.status = GenerationStatus.ERROR;
                result.error = error.message;
                log.error(`生成失败: ${provider.name}`, error.message);
            }

            result.endTime = Date.now();
            result.duration = Math.floor((result.endTime - result.startTime) / 1000);

            if (onError && result.status === GenerationStatus.ERROR) {
                onError(provider.id, error);
            }

            return result;
        } finally {
            this.abortControllers.delete(provider.id);
        }
    }

    /**
     * 调用单个provider的API
     * @param {object} provider provider配置
     * @param {Array} messages 消息列表
     * @param {AbortSignal} signal 取消信号
     * @param {Function} onChunk 数据块回调
     * @returns {Promise<string>} 响应内容
     */
    async callProvider(provider, messages, signal, onChunk) {
        const { apiFormat, apiUrl, apiKey, model, maxTokens, temperature, streaming } = provider;

        // 构建请求URL（统一的反代兼容 URL 构造）
        let requestUrl = apiUrl;
        if (apiFormat === 'openai') {
            requestUrl = buildOpenAIChatUrl(apiUrl);
        } else if (apiFormat === 'anthropic') {
            requestUrl = buildAnthropicUrl(apiUrl);
        } else if (apiFormat === 'google') {
            // Google Gemini API
            if (!apiUrl.includes(':generateContent')) {
                requestUrl = `${apiUrl}:generateContent`;
            }
        }

        // 构建请求头
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            if (apiFormat === 'anthropic') {
                headers['x-api-key'] = apiKey;
                headers['anthropic-version'] = '2023-06-01';
            } else if (apiFormat === 'google') {
                // Google使用URL参数
            } else {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
        }

        // 构建请求体
        let body;
        if (apiFormat === 'anthropic') {
            body = {
                model,
                max_tokens: maxTokens,
                messages: messages.filter(m => m.role !== 'system'),
                system: messages.find(m => m.role === 'system')?.content || '',
                stream: streaming,
            };
        } else if (apiFormat === 'google') {
            body = {
                contents: messages.map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }],
                })),
                generationConfig: {
                    maxOutputTokens: maxTokens,
                    temperature,
                },
            };
            // Google使用URL参数传递key
            if (apiKey) {
                requestUrl += `?key=${apiKey}`;
            }
        } else {
            // OpenAI格式
            body = {
                model,
                messages,
                max_tokens: maxTokens,
                temperature,
                stream: streaming,
            };
        }

        const response = await fetch(requestUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API错误 ${response.status}: ${errorText.slice(0, 200)}`);
        }

        if (streaming && apiFormat !== 'google') {
            // 流式响应
            return await StreamingHandler.handleStream(response, apiFormat, onChunk, signal);
        } else {
            // 非流式响应
            const content = await StreamingHandler.handleNonStream(response, apiFormat, provider.responsePath);
            if (onChunk) {
                onChunk(content);
            }
            return content;
        }
    }

    /**
     * 取消单个provider的生成
     * @param {string} providerId provider ID
     */
    abortSingle(providerId) {
        const controller = this.abortControllers.get(providerId);
        if (controller) {
            controller.abort();
            this.abortControllers.delete(providerId);
            log.log(`已取消生成: ${providerId}`);
        }
    }

    /**
     * 取消所有正在进行的生成
     */
    abortAll() {
        this.abortControllers.forEach((controller, providerId) => {
            controller.abort();
            log.log(`已取消生成: ${providerId}`);
        });
        this.abortControllers.clear();
    }

    /**
     * 获取生成结果
     * @param {string} providerId provider ID
     * @returns {object|null} 生成结果
     */
    getResult(providerId) {
        return this.results.get(providerId) || null;
    }

    /**
     * 获取所有结果
     * @returns {Array} 所有生成结果
     */
    getAllResults() {
        return Array.from(this.results.values());
    }

    /**
     * 重置状态
     */
    reset() {
        this.abortAll();
        this.results.clear();
    }
}

// 单例实例
let generatorInstance = null;

/**
 * 获取多AI生成器实例
 * @returns {MultiAIGenerator}
 */
export function getMultiAIGenerator() {
    if (!generatorInstance) {
        generatorInstance = new MultiAIGenerator();
    }
    return generatorInstance;
}

export default MultiAIGenerator;
