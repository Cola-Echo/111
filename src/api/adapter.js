/**
 * API 适配器模块
 * @module api/adapter
 */

import Logger from "@core/logger";
import { callAnthropic } from "./providers/anthropic";
import { callCustom } from "./providers/custom";
import { callGoogle } from "./providers/google";
import { callOpenAI, callOpenAIWithMessages } from "./providers/openai";

// 进度追踪器引用（将在运行时注入）
let progressTracker = null;

/**
 * 设置进度追踪器
 * @param {object} tracker 进度追踪器实例
 */
export function setProgressTracker(tracker) {
    progressTracker = tracker;
}

/**
 * API 适配器对象
 */
export const APIAdapter = {
    /**
     * 调用 API
     * @param {object} config API 配置
     * @param {string} systemPrompt 系统提示词
     * @param {string} userMessage 用户消息
     * @param {AbortSignal} signal 取消信号
     * @returns {Promise<string>} API 响应内容
     */
    async call(config, systemPrompt, userMessage, signal = null) {
        const { apiFormat } = config;
        const startTime = Date.now();

        try {
            let response;
            switch (apiFormat) {
                case "openai":
                    response = await callOpenAI(
                        config,
                        systemPrompt,
                        userMessage,
                        signal,
                        progressTracker,
                    );
                    break;
                case "anthropic":
                    response = await callAnthropic(
                        config,
                        systemPrompt,
                        userMessage,
                        signal,
                        progressTracker,
                    );
                    break;
                case "google":
                    response = await callGoogle(
                        config,
                        systemPrompt,
                        userMessage,
                        signal,
                        progressTracker,
                    );
                    break;
                case "custom":
                    response = await callCustom(
                        config,
                        systemPrompt,
                        userMessage,
                        signal,
                        progressTracker,
                    );
                    break;
                default:
                    throw new Error(`不支持的 API 格式: ${apiFormat}`);
            }

            const duration = Date.now() - startTime;
            Logger.debug(`API 调用完成 [${apiFormat}] 耗时: ${duration}ms`);
            return response;
        } catch (error) {
            if (error.name === "AbortError") {
                Logger.warn("API 调用被终止");
                throw error;
            }
            Logger.error(`API 调用失败 [${apiFormat}]:`, error.message);
            throw error;
        }
    },

    /**
     * 带重试的 API 调用
     * @param {object} config API 配置
     * @param {string} systemPrompt 系统提示词
     * @param {string} userMessage 用户消息
     * @param {string} taskId 任务 ID
     * @param {number} maxRetries 最大重试次数
     * @param {AbortSignal} signal 取消信号
     * @returns {Promise<string>} API 响应内容
     */
    async callWithRetry(
        config,
        systemPrompt,
        userMessage,
        taskId,
        maxRetries = 3,
        signal = null,
    ) {
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // 检查是否已被终止
                if (signal?.aborted) {
                    throw new DOMException("Aborted", "AbortError");
                }

                if (attempt > 1 && progressTracker) {
                    progressTracker.retryTask(taskId, attempt - 1);
                    Logger.warn(`任务 "${taskId}" 第 ${attempt} 次尝试...`);
                }

                // 克隆配置并添加 taskId 和 source 信息
                const configWithSource = {
                    ...config,
                    source: config.source || taskId.split("_")[0] || "未知",
                    taskId: taskId,
                };

                const result = await this.call(
                    configWithSource,
                    systemPrompt,
                    userMessage,
                    signal,
                );
                return result;
            } catch (error) {
                lastError = error;

                // 如果是终止错误，直接抛出
                if (error.name === "AbortError") {
                    throw error;
                }

                // 如果不是最后一次尝试，等待后重试
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * attempt, 3000);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    },

    /**
     * 使用消息列表调用 API（支持多轮对话）
     * @param {object} config API 配置
     * @param {string} systemPrompt 系统提示词
     * @param {Array} messages 消息列表
     * @param {string} taskId 任务 ID
     * @param {number} maxRetries 最大重试次数
     * @param {AbortSignal} signal 取消信号
     * @returns {Promise<string>} API 响应内容
     */
    async callWithMessages(
        config,
        systemPrompt,
        messages,
        taskId = null,
        maxRetries = 2,
        signal = null,
    ) {
        const { apiFormat } = config;

        // 确保 taskId 存在
        const finalTaskId = taskId || `task_${Date.now()}`;

        // 克隆配置并添加 taskId
        const configWithTask = { ...config, taskId: finalTaskId };

        // 目前只支持 OpenAI 格式
        if (apiFormat !== "openai") {
            // 对于其他格式，回退到单消息模式
            const lastUserMsg = messages.filter((m) => m.role === "user").pop();
            return this.callWithRetry(
                configWithTask,
                systemPrompt,
                lastUserMsg?.content || "",
                finalTaskId,
                maxRetries,
                signal,
            );
        }

        return callOpenAIWithMessages(
            configWithTask,
            systemPrompt,
            messages,
            progressTracker,
            signal,
        );
    },

    /**
     * 测试 API 连接
     * @param {object} config API 配置
     * @returns {Promise<{success: boolean, message: string, latency: number}>}
     */
    async testConnection(config) {
        const startTime = Date.now();
        try {
            const response = await this.call(
                config,
                "You are a test assistant. Reply briefly.",
                "Reply with exactly: CONNECTION_OK",
            );
            const latency = Date.now() - startTime;
            return {
                success: response.includes("CONNECTION_OK"),
                message: response.includes("CONNECTION_OK")
                    ? "连接成功"
                    : "响应异常",
                latency,
            };
        } catch (error) {
            return {
                success: false,
                message: error.message,
                latency: Date.now() - startTime,
            };
        }
    },
};

export default APIAdapter;
