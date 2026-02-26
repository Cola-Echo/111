/**
 * Fetch 拦截器
 * 通过替换 window.fetch 和 XMLHttpRequest 拦截 Amily2 的 API 请求
 *
 * 工作原理：
 * 1. 替换 window.fetch（覆盖 openai、openai_test、google 模式）
 * 2. 替换 XMLHttpRequest（覆盖 sillytavern_backend 的 $.ajax 调用）
 * 3. 拦截发往 AI 请求端点的请求
 * 4. 检查请求体中是否包含表格填充特征
 * 5. 如果是表格请求：拆分 → 并发调用 → 合并 → 返回伪造响应
 * 6. 如果不是：透传给原始函数
 *
 * @module table-filler/fetch-interceptor
 */

import Logger from "@core/logger";
import { getTableFillerConfig, isTableFillerEnabled, isDebugModeEnabled } from "@config/config-manager";
import { splitTablesFromMessages, mergeResults } from "./table-splitter";
import { ParallelExecutor } from "./parallel-executor";
import { showPostMergeDebugModal, showRetryBanner, removeRetryBanner } from "./debug-modal";

// 原始函数引用
let originalFetch = null;
let originalXHROpen = null;
let originalXHRSend = null;

// 安装状态
let isFetchInstalled = false;
let isXHRInstalled = false;

// 进度回调
let progressCallback = null;

// 并发填表正在进行中的标记（防止循环拦截）
let isParallelFillInProgress = false;

// 需要拦截的 API 端点
const INTERCEPT_ENDPOINTS = [
    '/api/backends/chat-completions/generate',
    '/v1/chat/completions',
    '/chat/completions'
];

/**
 * 设置进度回调
 * @param {Function} callback
 */
export function setFetchInterceptorProgressCallback(callback) {
    progressCallback = callback;
}

/**
 * 安装 Fetch 拦截器
 * @returns {boolean} 是否成功安装
 */
export function installFetchInterceptor() {
    if (isFetchInstalled) {
        Logger.log("[FetchInterceptor] Fetch 拦截器已安装，跳过");
        return true;
    }

    if (!window.fetch) {
        Logger.error("[FetchInterceptor] window.fetch 不存在");
        return false;
    }

    // 保存原始 fetch
    originalFetch = window.fetch;

    // 替换为拦截版本
    window.fetch = interceptedFetch;

    isFetchInstalled = true;
    Logger.log("[FetchInterceptor] ✓ Fetch 拦截器已安装");

    return true;
}

/**
 * 安装 XMLHttpRequest 拦截器（覆盖 $.ajax）
 * @returns {boolean} 是否成功安装
 */
export function installXHRInterceptor() {
    if (isXHRInstalled) {
        Logger.log("[FetchInterceptor] XHR 拦截器已安装，跳过");
        return true;
    }

    if (!window.XMLHttpRequest) {
        Logger.error("[FetchInterceptor] XMLHttpRequest 不存在");
        return false;
    }

    // 保存原始函数
    originalXHROpen = XMLHttpRequest.prototype.open;
    originalXHRSend = XMLHttpRequest.prototype.send;

    // 拦截 open 记录 URL 和 method
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._tableFillerUrl = url;
        this._tableFillerMethod = method;
        return originalXHROpen.apply(this, [method, url, ...args]);
    };

    // 拦截 send 检查请求体
    XMLHttpRequest.prototype.send = function(body) {
        const xhr = this;
        const url = this._tableFillerUrl;
        const method = this._tableFillerMethod;

        // 只检测 POST 请求到 AI 端点（仅记录日志，不拦截）
        if (method === 'POST' && shouldInterceptUrl(url)) {
            try {
                const bodyObj = typeof body === 'string' ? JSON.parse(body) : body;

                if (bodyObj && isTableFillerEnabled() && isTableFillerRequest(bodyObj.messages)) {
                    Logger.log("[FetchInterceptor] ✓ XHR 检测到表格填充请求，但暂时不启用并发（调试中）");
                }
            } catch (e) {
                // 静默忽略解析错误
            }
        }

        return originalXHRSend.apply(this, [body]);
    };

    isXHRInstalled = true;
    Logger.log("[FetchInterceptor] ✓ XHR 拦截器已安装");

    return true;
}

/**
 * 卸载 Fetch 拦截器
 */
export function uninstallFetchInterceptor() {
    if (isFetchInstalled && originalFetch) {
        window.fetch = originalFetch;
        originalFetch = null;
        isFetchInstalled = false;
        Logger.log("[FetchInterceptor] Fetch 拦截器已卸载");
    }

    if (isXHRInstalled && originalXHROpen && originalXHRSend) {
        XMLHttpRequest.prototype.open = originalXHROpen;
        XMLHttpRequest.prototype.send = originalXHRSend;
        originalXHROpen = null;
        originalXHRSend = null;
        isXHRInstalled = false;
        Logger.log("[FetchInterceptor] XHR 拦截器已卸载");
    }
}

/**
 * 获取安装状态
 * @returns {boolean}
 */
export function isFetchInterceptorInstalled() {
    return isFetchInstalled || isXHRInstalled;
}

/**
 * 拦截后的 fetch 函数
 * @param {string|Request} input URL 或 Request 对象
 * @param {RequestInit} init 请求配置
 * @returns {Promise<Response>}
 */
async function interceptedFetch(input, init) {
    // 获取 URL
    const url = typeof input === 'string' ? input : input.url;

    // 只拦截 SillyTavern 的 AI 请求端点
    if (shouldInterceptUrl(url)) {
        // 如果并发填表正在进行中，跳过拦截（防止循环）
        if (isParallelFillInProgress) {
            return originalFetch.apply(window, [input, init]);
        }

        try {
            // 先检查请求体大小，避免解析过大的请求
            const bodySize = init?.body?.length || 0;

            // 如果请求体超过 5MB，跳过拦截（可能导致内存问题）
            if (bodySize > 5 * 1024 * 1024) {
                console.warn("[MM] 请求体过大，跳过拦截:", bodySize);
                return originalFetch.apply(window, [input, init]);
            }

            const body = parseRequestBody(init);

            if (body && isTableFillerEnabled() && isTableFillerRequest(body.messages)) {
                // 检查是否有配置的表格 API
                const config = getTableFillerConfig();
                const hasTableConfigs = config.tableApiConfigs && Object.keys(config.tableApiConfigs).length > 0;

                if (hasTableConfigs) {
                    // 尝试解析表格
                    const tables = splitTablesFromMessages(body.messages);

                    if (tables.length > 1) {
                        // 有多个表格，启用并发处理
                        Logger.log(`[FetchInterceptor] 检测到 ${tables.length} 个表格，启用并发模式`);

                        try {
                            // 执行并发填表
                            const response = await handleParallelFill(url, body, init);
                            return response;
                        } catch (parallelError) {
                            Logger.error("[FetchInterceptor] 并发填表失败，回退到原始请求:", parallelError);
                            // 回退到原始请求
                            return originalFetch.apply(window, [input, init]);
                        }
                    } else {
                        Logger.log("[FetchInterceptor] 只有单个表格，使用原始请求");
                    }
                }
            }
        } catch (e) {
            Logger.error("[FetchInterceptor] 拦截处理错误:", e);
        }
    }

    // 透传给原始 fetch
    return originalFetch.apply(window, [input, init]);
}

/**
 * 检查是否应该拦截此 URL
 * @param {string} url
 * @returns {boolean}
 */
function shouldInterceptUrl(url) {
    if (!url || typeof url !== 'string') return false;

    // 检查是否匹配任一端点
    return INTERCEPT_ENDPOINTS.some(endpoint => url.includes(endpoint));
}

/**
 * 解析请求体
 * @param {RequestInit} init
 * @returns {Object|null}
 */
function parseRequestBody(init) {
    if (!init || !init.body) return null;

    try {
        if (typeof init.body === 'string') {
            return JSON.parse(init.body);
        }
        // 如果是其他类型（如 FormData），无法解析
        return null;
    } catch {
        return null;
    }
}

/**
 * 检测是否为 Amily2 表格填充请求
 * 不检查填表模式，只检测请求特征
 * @param {Array} messages 消息数组
 * @returns {boolean}
 */
function isTableFillerRequest(messages) {
    if (!messages || !Array.isArray(messages)) return false;

    // 检测 Amily2 表格模块的特征标记
    // 遍历消息而不是序列化整个数组（避免性能问题）
    try {
        for (const msg of messages) {
            const content = msg.content;
            if (!content || typeof content !== 'string') continue;

            // 主要特征：flowTemplate 中的标记
            if (content.includes('# dataTable 说明') || content.includes('dataTable 说明')) {
                Logger.log("[FetchInterceptor] ✓ 检测到 dataTable 说明特征");
                return true;
            }

            // 检查辅助特征（需要至少2个）
            let auxCount = 0;

            // 辅助特征：ruleTemplate 中的身份标识
            if (content.includes('职业是小说填表AI') || content.includes('酒馆国家的臣民')) {
                auxCount++;
            }

            // 辅助特征：输出格式标签
            if (content.includes('<Amily2Edit>') || content.includes('Amily2Edit')) {
                auxCount++;
            }

            // 辅助特征：表格操作函数
            if (content.includes('insertRow(') || content.includes('updateRow(') || content.includes('deleteRow(')) {
                auxCount++;
            }

            // 辅助特征：Amily2TableData 占位符或表格结构
            if (content.includes('Amily2TableData') || content.includes('rowIndex')) {
                auxCount++;
            }

            if (auxCount >= 2) {
                Logger.log(`[FetchInterceptor] ✓ 检测到 ${auxCount} 个辅助特征`);
                return true;
            }
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * 处理并发填表
 * @param {string} url 原始请求 URL
 * @param {Object} requestBody 请求体
 * @param {RequestInit} originalInit 原始请求配置
 * @returns {Promise<Response>}
 */
async function handleParallelFill(url, requestBody, originalInit) {
    // 设置标记，防止循环拦截
    isParallelFillInProgress = true;

    const config = getTableFillerConfig();
    const executor = new ParallelExecutor(config);

    // 设置进度回调
    if (progressCallback) {
        executor.setProgressCallback(progressCallback);
    }

    try {
        // 从 messages 中提取表格数据
        const tables = splitTablesFromMessages(requestBody.messages);

        if (tables.length === 0) {
            Logger.warn("[FetchInterceptor] 未检测到多表格，使用原始请求");
            // 回退到原始请求
            return originalFetch.apply(window, [url, originalInit]);
        }

        Logger.log(`[FetchInterceptor] 检测到 ${tables.length} 个表格，启用并发模式`);

        // 显示开始通知
        if (window.toastr) {
            window.toastr.info(
                `正在并发处理 ${tables.length} 个表格...`,
                "并发填表",
                { timeOut: 3000 }
            );
        }

        // 并发填充（发送前调试弹窗在 executor 内部处理）
        let results = await executor.fillAllTables(tables, requestBody, {
            originalUrl: url,
            originalInit: originalInit,
            originalFetch: originalFetch
        });

        // 检查是否用户取消
        const allCancelled = results.every(r => r.error?.message === "用户取消");
        if (allCancelled) {
            Logger.log("[FetchInterceptor] 用户取消，回退到原始请求");
            return originalFetch.apply(window, [url, originalInit]);
        }

        // 处理失败表格的重试交互
        let failedResults = results.filter(r => !r.success);
        let successResults = results.filter(r => r.success);

        // 如果有失败的表格，显示重试横幅让用户选择（必须等待用户操作）
        while (failedResults.length > 0) {
            const userChoice = await showRetryInteraction(failedResults);

            if (userChoice === 'giveup') {
                // 用户选择放弃，继续处理已成功的结果
                Logger.log("[FetchInterceptor] 用户放弃重试失败的表格");
                break;
            }

            // 用户选择重试
            Logger.log(`[FetchInterceptor] 用户选择重试 ${failedResults.length} 个失败的表格`);

            // 找到对应的表格对象
            const failedTableNames = failedResults.map(r => r.tableName);
            const failedTables = tables.filter(t => failedTableNames.includes(t.name));

            // 重新创建 executor 并重试
            const retryExecutor = new ParallelExecutor(config);
            if (progressCallback) {
                retryExecutor.setProgressCallback(progressCallback);
            }

            const retryResults = await retryExecutor.fillAllTables(failedTables, requestBody, {
                originalUrl: url,
                originalInit: originalInit,
                originalFetch: originalFetch
            });

            // 更新结果
            for (const retryResult of retryResults) {
                if (retryResult.success) {
                    // 成功了，从失败列表移到成功列表
                    successResults.push(retryResult);
                    failedResults = failedResults.filter(r => r.tableName !== retryResult.tableName);
                } else {
                    // 仍然失败，更新错误信息
                    const idx = failedResults.findIndex(r => r.tableName === retryResult.tableName);
                    if (idx >= 0) {
                        failedResults[idx] = retryResult;
                    }
                }
            }

            // 如果全部成功了，跳出循环
            if (failedResults.length === 0) {
                Logger.log("[FetchInterceptor] 重试后全部成功");
                break;
            }

            Logger.log(`[FetchInterceptor] 重试后仍有 ${failedResults.length} 个表格失败，等待用户选择`);
        }

        // 移除重试横幅
        removeRetryBanner();

        // 合并最终结果
        results = [...successResults, ...failedResults];

        // 统计结果
        const successCount = results.filter(r => r.success).length;

        if (successCount === 0) {
            // 全部失败时回退到原始请求
            Logger.warn("[FetchInterceptor] 所有表格均失败，回退到原始请求");
            if (window.toastr) {
                window.toastr.error("所有表格填充均失败，回退到原始请求", "并发填表失败");
            }
            return originalFetch.apply(window, [url, originalInit]);
        }

        // 合并结果
        const mergedContent = mergeResults(results);

        // 调试模式：显示合并后的弹窗
        if (isDebugModeEnabled()) {
            const shouldReturn = await showPostMergeDebugModal(results, mergedContent);
            if (!shouldReturn) {
                Logger.log("[FetchInterceptor] 用户取消返回，回退到原始请求");
                return originalFetch.apply(window, [url, originalInit]);
            }
        }

        // 构造伪造的 Response 对象
        return createFakeResponse(mergedContent);

    } catch (error) {
        Logger.error("[FetchInterceptor] 并发填表失败:", error);
        // 显示错误通知，帮助用户了解问题
        if (window.toastr) {
            window.toastr.error(
                `并发填表失败: ${error.message || '未知错误'}，已回退到原始请求`,
                "并发填表错误",
                { timeOut: 8000 }
            );
        }
        // 失败时回退到原始请求
        return originalFetch.apply(window, [url, originalInit]);
    } finally {
        // 清除标记，允许下一次拦截
        isParallelFillInProgress = false;
        // 确保横幅被移除
        removeRetryBanner();
    }
}

/**
 * 显示重试交互横幅并等待用户选择
 * @param {Array} failedResults 失败的结果
 * @returns {Promise<'retry'|'giveup'>}
 */
function showRetryInteraction(failedResults) {
    return new Promise((resolve) => {
        showRetryBanner(
            failedResults,
            () => resolve('retry'),   // onRetry
            () => resolve('giveup')   // onGiveUp
        );
    });
}


/**
 * 创建伪造的 Response 对象
 * 模拟 OpenAI 兼容格式的响应
 * @param {string} content 响应内容
 * @returns {Response}
 */
function createFakeResponse(content) {
    const responseData = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "concurrent-table-filler",
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: content
            },
            finish_reason: "stop"
        }],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }
    };

    const responseBody = JSON.stringify(responseData);

    return new Response(responseBody, {
        status: 200,
        statusText: "OK",
        headers: {
            'Content-Type': 'application/json',
            'X-Concurrent-Table-Filler': 'true'
        }
    });
}

/**
 * 导出原始 fetch 引用（供其他模块使用）
 * @returns {Function|null}
 */
export function getOriginalFetch() {
    return originalFetch;
}

/**
 * 处理 XHR 并发填表
 * @param {XMLHttpRequest} xhr 原始 XHR 对象
 * @param {string} url 请求 URL
 * @param {Object} requestBody 请求体对象
 * @param {string} originalBody 原始请求体字符串
 */
async function handleXHRParallelFill(xhr, url, requestBody, originalBody) {
    const config = getTableFillerConfig();
    const executor = new ParallelExecutor(config);

    if (progressCallback) {
        executor.setProgressCallback(progressCallback);
    }

    try {
        const tables = splitTablesFromMessages(requestBody.messages);

        if (tables.length === 0) {
            Logger.warn("[FetchInterceptor] XHR 未检测到多表格，使用原始请求");
            // 回退到原始请求
            return originalXHRSend.call(xhr, originalBody);
        }

        Logger.log(`[FetchInterceptor] XHR 检测到 ${tables.length} 个表格，启用并发模式`);

        if (window.toastr) {
            window.toastr.info(
                `🚀 正在并发处理 ${tables.length} 个表格...`,
                "并发填表已启动",
                { timeOut: 3000 }
            );
        }

        const results = await executor.fillAllTables(tables, requestBody, {
            originalUrl: url,
            originalFetch: originalFetch
        });

        const successCount = results.filter(r => r.success).length;
        const failedCount = results.length - successCount;

        if (window.toastr) {
            if (failedCount === 0) {
                window.toastr.success(`✅ ${successCount} 个表格全部处理成功`, "并发填表完成");
            } else if (successCount > 0) {
                window.toastr.warning(`⚠️ ${successCount}/${results.length} 个表格成功`, "并发填表部分完成");
            } else {
                window.toastr.error("❌ 所有表格处理失败", "并发填表失败");
                return originalXHRSend.call(xhr, originalBody);
            }
        }

        const mergedContent = mergeResults(results);

        // 模拟 XHR 响应
        simulateXHRResponse(xhr, mergedContent);

    } catch (error) {
        Logger.error("[FetchInterceptor] XHR 并发填表失败:", error);

        if (window.toastr) {
            window.toastr.error(`❌ 并发填表出错: ${error.message}`, "并发填表错误");
        }

        // 回退到原始请求
        return originalXHRSend.call(xhr, originalBody);
    }
}

/**
 * 模拟 XHR 响应
 * @param {XMLHttpRequest} xhr
 * @param {string} content 响应内容
 */
function simulateXHRResponse(xhr, content) {
    const responseData = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "concurrent-table-filler",
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: content
            },
            finish_reason: "stop"
        }],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }
    };

    const responseText = JSON.stringify(responseData);

    // 设置只读属性需要使用 Object.defineProperty
    Object.defineProperty(xhr, 'readyState', { value: 4, writable: false });
    Object.defineProperty(xhr, 'status', { value: 200, writable: false });
    Object.defineProperty(xhr, 'statusText', { value: 'OK', writable: false });
    Object.defineProperty(xhr, 'responseText', { value: responseText, writable: false });
    Object.defineProperty(xhr, 'response', { value: responseText, writable: false });

    // 触发事件
    if (typeof xhr.onreadystatechange === 'function') {
        xhr.onreadystatechange();
    }
    if (typeof xhr.onload === 'function') {
        xhr.onload();
    }

    // 触发 load 事件
    try {
        xhr.dispatchEvent(new Event('load'));
        xhr.dispatchEvent(new Event('loadend'));
    } catch (e) {
        Logger.debug("[FetchInterceptor] 触发 XHR 事件失败:", e.message);
    }
}

/**
 * 导出 isTableFillerRequest 供其他模块使用
 */
export { isTableFillerRequest };

