/**
 * Anthropic API 提供商
 * @module api/providers/anthropic
 */

import Logger from '@core/logger';
import { buildAnthropicUrl } from '@utils/url-builder';

/**
 * 模拟流式进度管理器
 * 使用时间驱动的平滑进度增长，提供稳定的视觉体验
 */
class SimulatedProgressManager {
    constructor(taskId, progressTracker, config = {}) {
        this.taskId = taskId;
        this.progressTracker = progressTracker;
        this.startTime = Date.now();
        this.currentProgress = 0;
        this.intervalId = null;
        this.isCompleted = false;

        // 配置参数
        this.maxProgress = config.maxProgress || 92;
        this.duration = config.duration || 30000;
        this.updateInterval = config.updateInterval || 100;

        // 使用缓动函数使进度更自然（开始快，后面慢）
        this.easingFn = (t) => {
            return 1 - Math.pow(1 - t, 3);
        };
    }

    start() {
        if (this.intervalId) return;

        this.intervalId = setInterval(() => {
            if (this.isCompleted) {
                this.stop();
                return;
            }

            const elapsed = Date.now() - this.startTime;
            const t = Math.min(elapsed / this.duration, 1);
            const easedProgress = this.easingFn(t) * this.maxProgress;

            if (easedProgress > this.currentProgress) {
                this.currentProgress = easedProgress;
                this.updateProgress(this.currentProgress);
            }
        }, this.updateInterval);
    }

    onStreamData(charsReceived) {
        const minProgress = Math.min(this.maxProgress, 10 + charsReceived / 50);
        if (minProgress > this.currentProgress) {
            this.currentProgress = minProgress;
            this.updateProgress(this.currentProgress);
        }
    }

    updateProgress(progress) {
        if (this.progressTracker && this.taskId) {
            this.progressTracker.updateStreamProgress(this.taskId, progress);
        }
    }

    complete() {
        this.isCompleted = true;
        this.stop();
        this.updateProgress(100);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}

/**
 * 调用 Anthropic API
 * @param {object} config API 配置
 * @param {string} systemPrompt 系统提示词
 * @param {string} userMessage 用户消息
 * @param {AbortSignal} signal 取消信号
 * @param {object} progressTracker 进度追踪器
 * @returns {Promise<string>} API 响应内容
 */
export async function callAnthropic(config, systemPrompt, userMessage, signal = null, progressTracker = null) {
    const { apiKey, model, maxTokens, temperature } = config;
    let { apiUrl } = config;

    // 统一的反代兼容 URL 构造
    apiUrl = buildAnthropicUrl(apiUrl);

    const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        signal,
        body: JSON.stringify({
            model,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
            max_tokens: maxTokens,
            temperature,
            stream: true,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API 错误: ${response.status} - ${errorText}`);
    }

    // 创建模拟进度管理器
    let progressManager = null;
    if (progressTracker && config.taskId) {
        progressManager = new SimulatedProgressManager(config.taskId, progressTracker, {
            maxProgress: 92,
            duration: 25000,
            updateInterval: 100,
        });
        progressManager.start();
    }

    // 流式处理
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let receivedChars = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n").filter((line) => line.trim() !== "");

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const jsonData = line.slice(6);
                    if (jsonData === "[DONE]") continue;

                    try {
                        const parsed = JSON.parse(jsonData);
                        // Anthropic 流式格式
                        if (parsed.type === "content_block_delta") {
                            const deltaContent = parsed.delta?.text || "";
                            if (deltaContent) {
                                fullContent += deltaContent;
                                receivedChars += deltaContent.length;

                                // 通知进度管理器收到了流数据
                                if (progressManager) {
                                    progressManager.onStreamData(receivedChars);
                                }
                            }
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
        // 完成进度
        if (progressManager) {
            progressManager.complete();
        }
    }

    return fullContent;
}
