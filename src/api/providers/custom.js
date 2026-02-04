/**
 * 自定义 API 提供商
 * @module api/providers/custom
 */

import Logger from '@core/logger';

/**
 * 获取嵌套值
 * @param {object} obj 对象
 * @param {string} path 路径（如 "choices.0.message.content"）
 * @returns {any} 值
 */
function getNestedValue(obj, path) {
    return path.split(".").reduce((current, key) => {
        if (current === undefined || current === null) return undefined;
        return current[key];
    }, obj);
}

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
 * 调用自定义 API
 * @param {object} config API 配置
 * @param {string} systemPrompt 系统提示词
 * @param {string} userMessage 用户消息
 * @param {AbortSignal} signal 取消信号
 * @param {object} progressTracker 进度追踪器
 * @returns {Promise<string>} API 响应内容
 */
export async function callCustom(config, systemPrompt, userMessage, signal = null, progressTracker = null) {
    const {
        apiUrl,
        apiKey,
        model,
        maxTokens,
        temperature,
        customRequestTemplate,
        customResponsePath,
    } = config;

    if (!customRequestTemplate || !customResponsePath) {
        throw new Error("自定义格式需要配置模板和响应路径");
    }

    let requestBody = customRequestTemplate
        .replace(/\{\{system\}\}/g, systemPrompt)
        .replace(/\{\{user\}\}/g, userMessage)
        .replace(/\{\{model\}\}/g, model)
        .replace(/\{\{max_tokens\}\}/g, maxTokens)
        .replace(/\{\{temperature\}\}/g, temperature);

    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    // Custom API 不支持流式，使用模拟进度
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
        const response = await fetch(apiUrl, {
            method: "POST",
            headers,
            signal,
            body: requestBody,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Custom API 错误: ${response.status} - ${errorText}`);
        }

        const data = await response.json();

        return getNestedValue(data, customResponsePath);
    } finally {
        // 完成进度
        if (progressManager) {
            progressManager.complete();
        }
    }
}

export { getNestedValue };
