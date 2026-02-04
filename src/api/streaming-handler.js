/**
 * 流式输出处理器
 * @module api/streaming-handler
 */

import Logger from '@core/logger';

const log = Logger.createModuleLogger('流式处理');

/**
 * 流式处理器类
 */
export class StreamingHandler {
    /**
     * 处理SSE流式响应
     * @param {Response} response fetch响应对象
     * @param {string} apiFormat API格式 (openai|anthropic|google|custom)
     * @param {Function} onChunk 收到数据块时的回调 (content: string) => void
     * @param {AbortSignal} signal 取消信号
     * @returns {Promise<string>} 完整响应内容
     */
    static async handleStream(response, apiFormat, onChunk, signal = null) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';

        try {
            while (true) {
                // 检查是否被取消
                if (signal?.aborted) {
                    throw new DOMException('Aborted', 'AbortError');
                }

                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const content = this.parseChunk(line, apiFormat);
                    if (content) {
                        fullContent += content;
                        if (onChunk) {
                            onChunk(content);
                        }
                    }
                }
            }

            // 处理剩余buffer
            if (buffer.trim()) {
                const content = this.parseChunk(buffer, apiFormat);
                if (content) {
                    fullContent += content;
                    if (onChunk) {
                        onChunk(content);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        return fullContent;
    }

    /**
     * 解析单行流式数据
     * @param {string} line 数据行
     * @param {string} apiFormat API格式
     * @returns {string|null} 解析出的内容或null
     */
    static parseChunk(line, apiFormat) {
        const trimmedLine = line.trim();
        if (!trimmedLine) return null;

        switch (apiFormat) {
            case 'openai':
                return this.parseOpenAIChunk(trimmedLine);
            case 'anthropic':
                return this.parseAnthropicChunk(trimmedLine);
            case 'google':
                return this.parseGoogleChunk(trimmedLine);
            case 'custom':
                return this.parseOpenAIChunk(trimmedLine); // 默认按OpenAI格式解析
            default:
                return this.parseOpenAIChunk(trimmedLine);
        }
    }

    /**
     * 解析OpenAI格式的流式数据
     * @param {string} line 数据行
     * @returns {string|null}
     */
    static parseOpenAIChunk(line) {
        if (!line.startsWith('data: ')) return null;

        const jsonData = line.slice(6);
        if (jsonData === '[DONE]') return null;

        try {
            const parsed = JSON.parse(jsonData);
            return parsed.choices?.[0]?.delta?.content ||
                   parsed.choices?.[0]?.text ||
                   null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 解析Anthropic格式的流式数据
     * @param {string} line 数据行
     * @returns {string|null}
     */
    static parseAnthropicChunk(line) {
        if (!line.startsWith('data: ')) return null;

        const jsonData = line.slice(6);

        try {
            const parsed = JSON.parse(jsonData);

            // Anthropic Claude API 格式
            if (parsed.type === 'content_block_delta') {
                return parsed.delta?.text || null;
            }

            // 旧版格式
            if (parsed.completion) {
                return parsed.completion;
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 解析Google格式的流式数据
     * @param {string} line 数据行
     * @returns {string|null}
     */
    static parseGoogleChunk(line) {
        if (!line.startsWith('data: ')) return null;

        const jsonData = line.slice(6);

        try {
            const parsed = JSON.parse(jsonData);

            // Google Gemini API 格式
            if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
                return parsed.candidates[0].content.parts[0].text;
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 处理非流式响应
     * @param {Response} response fetch响应对象
     * @param {string} apiFormat API格式
     * @param {string} responsePath 响应解析路径
     * @returns {Promise<string>} 响应内容
     */
    static async handleNonStream(response, apiFormat, responsePath = '') {
        const data = await response.json();

        // 如果有自定义响应路径，使用它
        if (responsePath) {
            return this.getNestedValue(data, responsePath) || '';
        }

        // 根据API格式解析
        switch (apiFormat) {
            case 'openai':
                return data.choices?.[0]?.message?.content || '';
            case 'anthropic':
                return data.content?.[0]?.text || data.completion || '';
            case 'google':
                return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            default:
                return data.choices?.[0]?.message?.content || '';
        }
    }

    /**
     * 获取嵌套对象的值
     * @param {object} obj 对象
     * @param {string} path 路径，如 "choices.0.message.content"
     * @returns {*} 值
     */
    static getNestedValue(obj, path) {
        const keys = path.split('.');
        let current = obj;

        for (const key of keys) {
            if (current === null || current === undefined) {
                return undefined;
            }
            current = current[key];
        }

        return current;
    }
}

export default StreamingHandler;
