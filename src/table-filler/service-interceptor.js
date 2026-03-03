/**
 * Service 拦截器
 * Hook SillyTavern 的 ConnectionManagerRequestService
 * 用于拦截 sillytavern_preset 模式的 API 调用
 *
 * @module table-filler/service-interceptor
 */

import Logger from "@core/logger";
import { getExtensionSettings } from "@core/sillytavern-api";
import { getTableFillerConfig, isTableFillerEnabled } from "@config/config-manager";
import { splitTablesFromMessages, mergeResults } from "./table-splitter";
import { ParallelExecutor } from "./parallel-executor";
import { isTableFillerRequest } from "./fetch-interceptor";

// 原始函数引用
let originalSendRequest = null;

// 安装状态
let isInstalled = false;

// 进度回调
let progressCallback = null;

/**
 * 设置进度回调
 * @param {Function} callback
 */
export function setServiceInterceptorProgressCallback(callback) {
    progressCallback = callback;
}

/**
 * 获取 SillyTavern 上下文
 * @returns {Object|null}
 */
function getSTContext() {
    // 尝试多种获取方式
    if (window.SillyTavern?.getContext) {
        return window.SillyTavern.getContext();
    }

    // 尝试从 extension 模块获取
    try {
        const extensions = getExtensionSettings();
        if (extensions) {
            // 尝试从任一扩展获取 context
            for (const key in extensions) {
                const ext = extensions[key];
                if (ext?.context?.ConnectionManagerRequestService) {
                    return ext.context;
                }
            }
        }
    } catch (e) {
        Logger.debug("[ServiceInterceptor] 从 extensions 获取 context 失败:", e.message);
    }

    return null;
}

/**
 * 安装 Service 拦截器
 * @returns {boolean} 是否成功安装
 */
export function installServiceInterceptor() {
    if (isInstalled) {
        Logger.log("[ServiceInterceptor] 拦截器已安装，跳过");
        return true;
    }

    const context = getSTContext();
    if (!context?.ConnectionManagerRequestService) {
        Logger.debug("[ServiceInterceptor] ConnectionManagerRequestService 不可用");
        return false;
    }

    const service = context.ConnectionManagerRequestService;
    if (typeof service.sendRequest !== 'function') {
        Logger.debug("[ServiceInterceptor] sendRequest 方法不存在");
        return false;
    }

    // 保存原始函数
    originalSendRequest = service.sendRequest.bind(service);

    // 替换为拦截版本
    service.sendRequest = async function(profileId, messages, maxTokens) {
        // 仅检测并记录日志，不做并发处理
        if (isTableFillerEnabled() && isTableFillerRequest(messages)) {
            Logger.log("[ServiceInterceptor] ✓ 检测到表格填充请求，但暂时不启用并发（调试中）");
        }

        // 透传给原始函数
        return originalSendRequest(profileId, messages, maxTokens);
    };

    isInstalled = true;
    Logger.log("[ServiceInterceptor] ✓ Service 拦截器已安装");

    return true;
}

/**
 * 卸载 Service 拦截器
 */
export function uninstallServiceInterceptor() {
    if (!isInstalled || !originalSendRequest) {
        return;
    }

    const context = getSTContext();
    if (context?.ConnectionManagerRequestService) {
        context.ConnectionManagerRequestService.sendRequest = originalSendRequest;
    }

    originalSendRequest = null;
    isInstalled = false;

    Logger.log("[ServiceInterceptor] Service 拦截器已卸载");
}

/**
 * 获取安装状态
 * @returns {boolean}
 */
export function isServiceInterceptorInstalled() {
    return isInstalled;
}

/**
 * 处理 Service 并发填表
 * @param {string} profileId 配置文件 ID
 * @param {Array} messages 消息数组
 * @param {number} maxTokens 最大 token 数
 * @returns {Promise<Object>}
 */
async function handleServiceParallelFill(profileId, messages, maxTokens) {
    const config = getTableFillerConfig();
    const executor = new ParallelExecutor(config);

    if (progressCallback) {
        executor.setProgressCallback(progressCallback);
    }

    try {
        const tables = splitTablesFromMessages(messages);

        if (tables.length === 0) {
            Logger.warn("[ServiceInterceptor] 未检测到多表格，使用原始请求");
            return originalSendRequest(profileId, messages, maxTokens);
        }

        Logger.log(`[ServiceInterceptor] 检测到 ${tables.length} 个表格，启用并发模式`);

        if (window.toastr) {
            window.toastr.info(
                `🚀 正在并发处理 ${tables.length} 个表格...`,
                "并发填表已启动",
                { timeOut: 3000 }
            );
        }

        const results = await executor.fillAllTables(tables, { messages }, {
            profileId,
            maxTokens,
            originalSendRequest
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
                return originalSendRequest(profileId, messages, maxTokens);
            }
        }

        const mergedContent = mergeResults(results);

        // 返回模拟的响应对象
        return {
            choices: [{
                message: {
                    role: "assistant",
                    content: mergedContent
                },
                finish_reason: "stop"
            }]
        };

    } catch (error) {
        Logger.error("[ServiceInterceptor] 并发填表失败:", error);

        if (window.toastr) {
            window.toastr.error(`❌ 并发填表出错: ${error.message}`, "并发填表错误");
        }

        // 回退到原始请求
        return originalSendRequest(profileId, messages, maxTokens);
    }
}
