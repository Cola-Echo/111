/**
 * 并发执行器
 * 并发调用多个 API 处理表格填充
 * @module table-filler/parallel-executor
 */

import Logger from "@core/logger";
import { APIAdapter } from "@api/adapter";
import { isDebugModeEnabled, loadDefaultIndependentTemplates } from "@config/config-manager";
import { buildSingleTableMessages } from "./table-splitter";
import { buildPromptForTable } from "./prompt-handler";
import { showPreSendDebugModal, showPostMergeDebugModal, showRetryBanner, removeRetryBanner } from "./debug-modal";

/**
 * 并发执行器类
 */
export class ParallelExecutor {
    /**
     * @param {Object} config 配置对象
     */
    constructor(config) {
        this.config = config;
        this.abortControllers = new Map();
        this.onProgress = null;
        // 从配置读取重试次数，默认为 2
        this.retryCount = config.retryCount ?? 2;
        // 从配置读取重试延迟基数（毫秒），默认为 2000
        this.retryDelay = config.retryDelay ?? 2000;
        // 从配置读取调试模式
        this.debugMode = config.debugMode ?? false;
    }

    /**
     * 设置进度回调
     * @param {Function} callback 进度回调函数
     */
    setProgressCallback(callback) {
        this.onProgress = callback;
    }

    /**
     * 报告进度
     * @param {string} tableName 表格名称
     * @param {string} status 状态
     * @param {string} message 消息
     */
    reportProgress(tableName, status, message) {
        if (this.onProgress) {
            this.onProgress({
                tableName,
                status,
                message,
                timestamp: Date.now(),
            });
        }
    }

    /**
     * 获取表格的 API 配置
     * @param {string} tableName 表格名称
     * @returns {Object}
     */
    getApiConfigForTable(tableName) {
        const tableApis = this.config.tableApiConfigs || {};
        const tableConfig = tableApis[tableName];

        // 如果表格有独立配置且不是使用默认
        if (tableConfig && !tableConfig.useDefault) {
            return tableConfig;
        }

        // 使用默认 API 配置
        return this.config.defaultApi || {};
    }

    /**
     * 并发填充所有表格
     * @param {Array} tables 表格数组
     * @param {Array|Object} originalMessagesOrBody 原始消息数组或请求体对象
     * @param {Object} originalOptions 原始选项
     * @returns {Promise<Array>}
     */
    async fillAllTables(tables, originalMessagesOrBody, originalOptions = {}) {
        Logger.log(
            `[ParallelExecutor] 开始并发填表，共 ${tables.length} 个表格，重试次数: ${this.retryCount}，重试延迟基数: ${this.retryDelay}ms`,
        );

        // 兼容处理：如果传入的是请求体对象，提取 messages
        const originalMessages = Array.isArray(originalMessagesOrBody)
            ? originalMessagesOrBody
            : originalMessagesOrBody?.messages || [];

        // 预加载默认独立模板并合并到 config 中
        if (this.config.promptMode === "independent") {
            const defaultTemplates = await loadDefaultIndependentTemplates();
            if (defaultTemplates?.templates) {
                // 合并默认模板（持久化优先）
                const mergedTemplates = { ...this.config.independentTemplates };
                for (const [tableName, templateObj] of Object.entries(defaultTemplates.templates)) {
                    if (!mergedTemplates[tableName]) {
                        // 处理嵌套结构：templateObj 可能是 { template: "..." } 或直接是字符串
                        const templateContent = typeof templateObj === 'string' ? templateObj : templateObj?.template;
                        if (templateContent) {
                            mergedTemplates[tableName] = { template: templateContent };
                        }
                    }
                }
                this.config.independentTemplates = mergedTemplates;
                Logger.log(`[ParallelExecutor] 已合并默认独立模板，共 ${Object.keys(mergedTemplates).length} 个`);
            }
        }

        // 【调试】先构建所有表格的提示词，显示调试弹窗
        const tablePrompts = [];
        for (const table of tables) {
            try {
                const messages = buildPromptForTable(table, originalMessages, this.config);
                tablePrompts.push({
                    tableName: table.name,
                    messages: messages
                });
            } catch (buildError) {
                Logger.error(`[ParallelExecutor] 构建表格「${table.name}」提示词失败:`, buildError);
                if (window.toastr) {
                    window.toastr.error(
                        `构建「${table.name}」提示词失败: ${buildError.message}`,
                        "并发填表错误",
                        { timeOut: 5000 }
                    );
                }
                throw buildError;
            }
        }

        // 调试模式：显示发送前调试弹窗
        if (isDebugModeEnabled()) {
            const shouldContinue = await showPreSendDebugModal(tablePrompts);
            if (!shouldContinue) {
                Logger.log("[ParallelExecutor] 用户取消了发送");
                // 返回空结果，让上层回退到原始请求
                return tables.map(t => ({
                    tableName: t.name,
                    success: false,
                    response: null,
                    error: new Error("用户取消"),
                    retryAttempts: 0
                }));
            }
        }

        // 为每个表格创建任务
        const tasks = tables.map((table, index) => ({
            table,
            apiConfig: this.getApiConfigForTable(table.name),
            abortController: new AbortController(),
            // 使用已构建的提示词
            prebuiltMessages: tablePrompts[index].messages
        }));

        // 并发执行
        const promises = tasks.map((task) =>
            this.fillSingleTableWithRetry(task, originalMessages, originalOptions),
        );

        const settledResults = await Promise.allSettled(promises);

        // 处理结果
        const results = settledResults.map((result, index) => ({
            tableName: tables[index].name,
            success:
                result.status === "fulfilled" && result.value?.success,
            response:
                result.status === "fulfilled" ? result.value?.response : null,
            error:
                result.status === "rejected"
                    ? result.reason
                    : result.value?.error || null,
            retryAttempts: result.status === "fulfilled" ? result.value?.retryAttempts : 0,
        }));

        // 统计结果
        const successCount = results.filter((r) => r.success).length;
        const failedCount = results.length - successCount;

        Logger.log(
            `[ParallelExecutor] 填表完成: ${successCount}/${results.length} 成功`,
        );

        // 详细记录失败的表格（仅日志，不弹通知）
        if (failedCount > 0) {
            const failedDetails = results
                .filter((r) => !r.success)
                .map((r) => {
                    const errorMsg = r.error?.message || '未知错误';
                    return `${r.tableName}: ${errorMsg}`;
                });
            Logger.warn(`[ParallelExecutor] 失败的表格详情:\n${failedDetails.join('\n')}`);
        }

        return results;
    }

    /**
     * 带重试的单表格填充
     * @param {Object} task 任务对象
     * @param {Array} originalMessages 原始消息数组
     * @param {Object} originalOptions 原始选项
     * @returns {Promise<{success: boolean, response: string|null, error: Error|null, retryAttempts: number}>}
     */
    async fillSingleTableWithRetry(task, originalMessages, originalOptions) {
        const { table } = task;
        let lastError = null;
        let retryAttempts = 0;

        Logger.log(`[ParallelExecutor] 开始处理表格 ${table.name}，最大重试次数: ${this.retryCount}`);

        for (let attempt = 0; attempt <= this.retryCount; attempt++) {
            try {
                if (attempt > 0) {
                    retryAttempts = attempt;
                    // 使用固定延迟时间
                    const delayMs = this.retryDelay;
                    this.reportProgress(table.name, "retrying", `重试第 ${attempt} 次（等待 ${delayMs / 1000} 秒）...`);
                    Logger.log(`[ParallelExecutor] 表格 ${table.name} 重试第 ${attempt} 次，延迟 ${delayMs}ms`);

                    // 重试前等待
                    await this.delay(delayMs);

                    // 创建新的 AbortController
                    task.abortController = new AbortController();
                }

                Logger.log(`[ParallelExecutor] 表格 ${table.name} 第 ${attempt} 次尝试调用 API`);
                const result = await this.fillSingleTable(task, originalMessages, originalOptions);

                if (result.success) {
                    if (retryAttempts > 0) {
                        Logger.log(`[ParallelExecutor] 表格 ${table.name} 在第 ${retryAttempts} 次重试后成功`);
                    }
                    return { ...result, retryAttempts };
                }

                // 调用返回了失败结果，记录错误
                lastError = result.error;
                const errorMsg = lastError?.message || '未知错误';
                Logger.warn(`[ParallelExecutor] 表格 ${table.name} 第 ${attempt} 次尝试失败:`, errorMsg);
            } catch (error) {
                // 捕获异常，记录错误
                lastError = error;
                const errorMsg = error.message || '未知异常';
                Logger.warn(`[ParallelExecutor] 表格 ${table.name} 第 ${attempt} 次尝试异常:`, errorMsg);
            }
        }

        // 所有重试都失败
        Logger.error(`[ParallelExecutor] 表格 ${table.name} 在 ${this.retryCount} 次重试后最终失败`);
        this.reportProgress(table.name, "failed", `失败 (重试 ${retryAttempts} 次后): ${lastError?.message || '未知错误'}`);
        return { success: false, response: null, error: lastError, retryAttempts };
    }

    /**
     * 延迟函数
     * @param {number} ms 毫秒
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 填充单个表格
     * @param {Object} task 任务对象
     * @param {Array} originalMessages 原始消息数组
     * @param {Object} originalOptions 原始选项
     * @returns {Promise<{success: boolean, response: string|null, error: Error|null}>}
     */
    async fillSingleTable(task, originalMessages, originalOptions) {
        const { table, apiConfig, abortController, prebuiltMessages } = task;
        this.abortControllers.set(table.name, abortController);

        this.reportProgress(table.name, "started", "开始处理");

        try {
            // 检查 API 配置
            if (!apiConfig.apiUrl || !apiConfig.model) {
                throw new Error(`表格 ${table.name} 未配置有效的 API`);
            }

            // 使用预构建的 messages（如果有），否则重新构建
            const messages = prebuiltMessages || buildPromptForTable(
                table,
                originalMessages,
                this.config,
            );

            this.reportProgress(table.name, "calling", "正在调用 API");

            // 准备 API 配置
            const finalConfig = {
                ...apiConfig,
                apiFormat: apiConfig.apiFormat || "openai",
                source: "table_filler",
                taskId: `table_${table.name}`,
            };

            // 调用 API（内部不再重试，由外层 fillSingleTableWithRetry 控制）
            const response = await APIAdapter.callWithMessages(
                finalConfig,
                null, // systemPrompt 已在 messages 中
                messages,
                `table_${table.name}`,
                0, // 不在这里重试，由外层控制
                abortController.signal,
            );

            this.reportProgress(table.name, "completed", "处理完成");
            Logger.log(`[ParallelExecutor] 表格 ${table.name} 填充成功`);

            return { success: true, response, error: null };
        } catch (error) {
            this.reportProgress(
                table.name,
                "failed",
                `失败: ${error.message}`,
            );
            Logger.error(
                `[ParallelExecutor] 表格 ${table.name} 填充失败:`,
                error,
            );
            return { success: false, response: null, error };
        } finally {
            this.abortControllers.delete(table.name);
        }
    }

    /**
     * 取消所有任务
     */
    abortAll() {
        Logger.log("[ParallelExecutor] 取消所有任务");
        this.abortControllers.forEach((controller, tableName) => {
            controller.abort();
            this.reportProgress(tableName, "aborted", "已取消");
        });
        this.abortControllers.clear();
    }

    /**
     * 取消特定表格的任务
     * @param {string} tableName 表格名称
     */
    abortTable(tableName) {
        const controller = this.abortControllers.get(tableName);
        if (controller) {
            controller.abort();
            this.abortControllers.delete(tableName);
            this.reportProgress(tableName, "aborted", "已取消");
            Logger.log(`[ParallelExecutor] 取消表格 ${tableName} 的任务`);
        }
    }

    /**
     * 获取正在处理的表格列表
     * @returns {Array<string>}
     */
    getProcessingTables() {
        return Array.from(this.abortControllers.keys());
    }
}

export default ParallelExecutor;
