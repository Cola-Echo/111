// @ts-nocheck
/**
 * OpenAI API 提供商
 * @module api/providers/openai
 */

/**
 * 模拟流式进度管理器
 * 使用检查点驱动的进度增长，模拟真实的流式传输体验
 */
class SimulatedProgressManager {
    constructor(taskId, progressTracker, config = {}) {
        this.taskId = taskId;
        this.progressTracker = progressTracker;
        this.startTime = Date.now();
        this.currentProgress = 0;
        this.intervalId = null;
        this.isCompleted = false;
        this.completionIntervalId = null;

        // 检查点配置：模拟真实的处理阶段
        // [进度值, 到达该点的预估时间(ms), 停留时间(ms)]
        this.checkpoints = config.checkpoints || [
            { progress: 5, time: 500, pause: 100 },      // 初始化
            { progress: 15, time: 2000, pause: 200 },    // 开始处理
            { progress: 25, time: 4000, pause: 150 },    // 解析请求
            { progress: 35, time: 7000, pause: 300 },    // 生成中...
            { progress: 45, time: 10000, pause: 200 },   // 持续生成
            { progress: 60, time: 15000, pause: 400 },   // 主要内容
            { progress: 75, time: 20000, pause: 300 },   // 接近完成
            { progress: 85, time: 25000, pause: 200 },   // 收尾阶段
            { progress: 92, time: 30000, pause: 0 },     // 等待完成
        ];

        this.currentCheckpointIndex = 0;
        this.lastCheckpointTime = Date.now();
        this.isPaused = false;
        this.pauseEndTime = 0;

        // 配置参数
        this.updateInterval = config.updateInterval || 50; // 更新间隔（毫秒）
        this.completionDuration = config.completionDuration || 300; // 完成动画时长

        // 流数据相关
        this.totalCharsReceived = 0;
        this.lastCharsReceived = 0;
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

            this.tick();
        }, this.updateInterval);
    }

    /**
     * 每帧更新
     */
    tick() {
        const now = Date.now();

        // 如果在停顿中，等待停顿结束
        if (this.isPaused) {
            if (now >= this.pauseEndTime) {
                this.isPaused = false;
                this.lastCheckpointTime = now;
                this.currentCheckpointIndex++;
            }
            return;
        }

        // 获取当前和下一个检查点
        if (this.currentCheckpointIndex >= this.checkpoints.length) {
            return; // 已到达最后一个检查点
        }

        const currentCp = this.currentCheckpointIndex > 0
            ? this.checkpoints[this.currentCheckpointIndex - 1]
            : { progress: 0, time: 0, pause: 0 };
        const nextCp = this.checkpoints[this.currentCheckpointIndex];

        // 计算当前检查点段的进度
        const segmentStartTime = this.currentCheckpointIndex === 0
            ? this.startTime
            : this.lastCheckpointTime;
        const segmentDuration = nextCp.time - (currentCp.time || 0);
        const elapsed = now - segmentStartTime;
        const t = Math.min(elapsed / segmentDuration, 1);

        // 使用 ease-out 缓动在检查点之间过渡
        const eased = 1 - Math.pow(1 - t, 2);
        const progressInSegment = currentCp.progress + (nextCp.progress - currentCp.progress) * eased;

        // 更新进度（只增不减）
        if (progressInSegment > this.currentProgress) {
            this.currentProgress = progressInSegment;
            this.updateProgress(this.currentProgress);
        }

        // 到达检查点时触发停顿
        if (t >= 1) {
            this.currentProgress = nextCp.progress;
            this.updateProgress(this.currentProgress);

            if (nextCp.pause > 0) {
                this.isPaused = true;
                this.pauseEndTime = now + nextCp.pause;
            } else {
                this.lastCheckpointTime = now;
                this.currentCheckpointIndex++;
            }
        }
    }

    /**
     * 接收到流数据时调用，加速进度
     * @param {number} charsReceived 已接收字符数
     */
    onStreamData(charsReceived) {
        this.totalCharsReceived = charsReceived;
        const newChars = charsReceived - this.lastCharsReceived;
        this.lastCharsReceived = charsReceived;

        // 根据收到的字符数加速进度
        // 每收到数据，至少推进到当前检查点的 50%
        if (newChars > 0 && this.currentCheckpointIndex < this.checkpoints.length) {
            const currentCp = this.currentCheckpointIndex > 0
                ? this.checkpoints[this.currentCheckpointIndex - 1]
                : { progress: 0 };
            const nextCp = this.checkpoints[this.currentCheckpointIndex];

            // 根据字符数推进进度
            const charBasedProgress = Math.min(
                nextCp.progress,
                currentCp.progress + (charsReceived / 30) // 每30字符推进1%
            );

            if (charBasedProgress > this.currentProgress) {
                this.currentProgress = charBasedProgress;
                this.updateProgress(this.currentProgress);

                // 如果超过当前检查点，跳到下一个
                if (this.currentProgress >= nextCp.progress) {
                    this.currentCheckpointIndex++;
                    this.lastCheckpointTime = Date.now();
                    this.isPaused = false;
                }
            }
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
     * 完成进度（带平滑动画从当前进度过渡到100%）
     */
    complete() {
        this.isCompleted = true;
        this.stop();

        // 平滑过渡到 100%
        const startProgress = this.currentProgress;
        const progressDiff = 100 - startProgress;
        const startTime = Date.now();
        const duration = this.completionDuration;

        // 如果差距很小，直接完成
        if (progressDiff <= 1) {
            this.updateProgress(100);
            return;
        }

        // 使用 setInterval 进行平滑动画
        this.completionIntervalId = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const t = Math.min(elapsed / duration, 1);

            // 使用 ease-out 缓动
            const eased = 1 - Math.pow(1 - t, 2);
            const newProgress = startProgress + progressDiff * eased;

            this.currentProgress = newProgress;
            this.updateProgress(newProgress);

            if (t >= 1) {
                clearInterval(this.completionIntervalId);
                this.completionIntervalId = null;
                this.updateProgress(100);
            }
        }, 16); // ~60fps
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

    // 构建消息列表，如果 systemPrompt 为空则不添加
    const fullMessages = systemPrompt
        ? [{ role: "system", content: systemPrompt }, ...messages]
        : [...messages];

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
