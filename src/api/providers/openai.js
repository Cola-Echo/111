/**
 * OpenAI API 提供商
 * @module api/providers/openai
 */

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
        this.maxProgress = config.maxProgress || 92; // 模拟进度最大值
        this.duration = config.duration || 30000; // 预估总时长（毫秒）
        this.updateInterval = config.updateInterval || 100; // 更新间隔（毫秒）

        // 使用缓动函数使进度更自然（开始快，后面慢）
        this.easingFn = (t) => {
            // ease-out-cubic: 1 - (1 - t)^3
            return 1 - Math.pow(1 - t, 3);
        };
    }

    /**
     * 启动模拟进度
     */
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

            // 确保进度只增不减
            if (easedProgress > this.currentProgress) {
                this.currentProgress = easedProgress;
                this.updateProgress(this.currentProgress);
            }
        }, this.updateInterval);
    }

    /**
     * 接收到流数据时调用，加速进度
     * @param {number} charsReceived 已接收字符数
     */
    onStreamData(charsReceived) {
        // 当收到流数据时，适度加速进度
        // 每收到 100 字符，进度至少推进一点
        const minProgress = Math.min(this.maxProgress, 10 + charsReceived / 50);
        if (minProgress > this.currentProgress) {
            this.currentProgress = minProgress;
            this.updateProgress(this.currentProgress);
        }
    }

    /**
     * 更新进度显示
     * @param {number} progress 进度值
     */
    updateProgress(progress) {
        if (this.progressTracker && this.taskId) {
            this.progressTracker.updateStreamProgress(this.taskId, progress);
        }
    }

    /**
     * 完成进度
     */
    complete() {
        this.isCompleted = true;
        this.stop();
        this.updateProgress(100);
    }

    /**
     * 停止模拟
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}

/**
 * 调用 OpenAI 兼容 API
 * @param {object} config API 配置
 * @param {string} systemPrompt 系统提示词
 * @param {string} userMessage 用户消息
 * @param {AbortSignal} signal 取消信号
 * @param {object} progressTracker 进度追踪器
 * @returns {Promise<string>} API 响应内容
 */
export async function callOpenAI(
    config,
    systemPrompt,
    userMessage,
    signal = null,
    progressTracker = null,
) {
    const { apiKey, model, maxTokens, temperature } = config;
    let { apiUrl } = config;

    // 自动补全 /chat/completions
    if (apiUrl.endsWith("/v1") || apiUrl.endsWith("/v1/")) {
        apiUrl = apiUrl.replace(/\/v1\/?$/, "/v1/chat/completions");
    } else if (
        !apiUrl.includes("/chat/completions") &&
        !apiUrl.includes("/completions")
    ) {
        apiUrl = apiUrl.replace(/\/?$/, "/chat/completions");
    }

    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ],
            max_tokens: maxTokens,
            temperature,
            stream: true,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API 错误: ${response.status} - ${errorText}`);
    }

    // 创建模拟进度管理器
    let progressManager = null;
    if (progressTracker && config.taskId) {
        progressManager = new SimulatedProgressManager(config.taskId, progressTracker, {
            maxProgress: 92,
            duration: 25000, // 预估 25 秒完成
            updateInterval: 100,
        });
        progressManager.start();
    }

    // 流式处理
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let receivedChars = 0;
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine || !trimmedLine.startsWith("data: ")) continue;

                const jsonData = trimmedLine.slice(6);
                if (jsonData === "[DONE]") continue;

                try {
                    const parsed = JSON.parse(jsonData);
                    const deltaContent =
                        parsed.choices?.[0]?.delta?.content ||
                        parsed.choices?.[0]?.text ||
                        "";
                    if (deltaContent) {
                        fullContent += deltaContent;
                        receivedChars += deltaContent.length;

                        // 通知进度管理器收到了流数据
                        if (progressManager) {
                            progressManager.onStreamData(receivedChars);
                        }
                    }
                } catch (e) {
                    // 忽略解析错误
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

/**
 * 使用消息列表调用 OpenAI API（支持多轮对话）
 * @param {object} config API 配置
 * @param {string} systemPrompt 系统提示词
 * @param {Array} messages 消息列表
 * @param {object} progressTracker 进度追踪器
 * @param {AbortSignal} signal 取消信号
 * @returns {Promise<string>} API 响应内容
 */
export async function callOpenAIWithMessages(
    config,
    systemPrompt,
    messages,
    progressTracker = null,
    signal = null,
) {
    const { apiKey, model, maxTokens, temperature } = config;
    let { apiUrl } = config;

    // 自动补全 /chat/completions
    if (apiUrl.endsWith("/v1") || apiUrl.endsWith("/v1/")) {
        apiUrl = apiUrl.replace(/\/v1\/?$/, "/v1/chat/completions");
    } else if (
        !apiUrl.includes("/chat/completions") &&
        !apiUrl.includes("/completions")
    ) {
        apiUrl = apiUrl.replace(/\/?$/, "/chat/completions");
    }

    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const fullMessages = [
        { role: "system", content: systemPrompt },
        ...messages,
    ];

    const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
            model,
            messages: fullMessages,
            max_tokens: maxTokens,
            temperature,
            stream: true,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 错误: ${response.status} - ${errorText}`);
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
    let buffer = "";
    let receivedChars = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const data = line.slice(6);
                    if (data === "[DONE]") continue;
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content || "";
                        if (content) {
                            fullContent += content;
                            receivedChars += content.length;

                            // 通知进度管理器收到了流数据
                            if (progressManager) {
                                progressManager.onStreamData(receivedChars);
                            }
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }
        }
    } finally {
        // 完成进度
        if (progressManager) {
            progressManager.complete();
        }
    }

    return fullContent;
}
