/**
 * Google API 提供商
 * @module api/providers/google
 */

import Logger from '@core/logger';
import { buildGoogleUrl } from '@utils/url-builder';

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
 * 调用 Google Generative AI API
 * @param {object} config API 配置
 * @param {string} systemPrompt 系统提示词
 * @param {string} userMessage 用户消息
 * @param {AbortSignal} signal 取消信号
 * @param {object} progressTracker 进度追踪器
 * @returns {Promise<string>} API 响应内容
 */
export async function callGoogle(config, systemPrompt, userMessage, signal = null, progressTracker = null) {
    const { apiKey, model, maxTokens, temperature } = config;
    let { apiUrl } = config;

    // 统一的反代兼容 URL 构造
    const url = buildGoogleUrl(apiUrl, model, apiKey);

    // Google API 不支持流式，使用模拟进度
    let progressManager = null;
    if (progressTracker && config.taskId) {
        progressManager = new SimulatedProgressManager(config.taskId, progressTracker, {
            maxProgress: 92,
            duration: 25000,
            updateInterval: 100,
        });
        progressManager.start();
    }

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ parts: [{ text: userMessage }] }],
                generationConfig: {
                    maxOutputTokens: maxTokens,
                    temperature,
                },
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Google API 错误: ${response.status} - ${errorText}`);
        }

        const data = await response.json();

        return data.candidates[0].content.parts[0].text;
    } finally {
        // 完成进度
        if (progressManager) {
            progressManager.complete();
        }
    }
}
