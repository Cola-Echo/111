/**
 * API 拦截器
 * 拦截 Amily2 的 API 调用，实现并发填表
 * @module table-filler/interceptor
 *
 * 实现方式：
 * 1. Fetch 拦截：替换 window.fetch（覆盖 openai、openai_test、google 模式）
 * 2. XHR 拦截：替换 XMLHttpRequest（覆盖 sillytavern_backend 的 $.ajax）
 * 3. Service 拦截：Hook ConnectionManagerRequestService（覆盖 sillytavern_preset）
 * 4. 全局钩子：暴露 _tableFillerInterceptor 供 Amily2 可选调用
 * 5. Bus 联动：注册 TableFillerProxy 供未来 Amily2 版本直接调用
 */

import Logger from "@core/logger";
import { getTableFillerConfig, isTableFillerEnabled } from "@config/config-manager";
import { setInterceptorInstalled } from "./mode-manager";
import { splitTablesFromMessages, mergeResults } from "./table-splitter";
import { ParallelExecutor } from "./parallel-executor";
import {
    installFetchInterceptor,
    installXHRInterceptor,
    uninstallFetchInterceptor,
    isFetchInterceptorInstalled,
    setFetchInterceptorProgressCallback,
    isTableFillerRequest
} from "./fetch-interceptor";
import {
    installServiceInterceptor,
    uninstallServiceInterceptor,
    isServiceInterceptorInstalled,
    setServiceInterceptorProgressCallback
} from "./service-interceptor";

// 原始函数引用（用于 Bus 钩子）
let originalNccsCall = null;
let isHooked = false;

// 进度回调
let progressCallback = null;

/**
 * 设置进度回调
 * @param {Function} callback
 */
export function setInterceptorProgressCallback(callback) {
    progressCallback = callback;
    // 同时设置给所有拦截器
    setFetchInterceptorProgressCallback(callback);
    setServiceInterceptorProgressCallback(callback);
}

// 重新导出 isTableFillerRequest
export { isTableFillerRequest };

/**
 * 处理并发填表（核心逻辑）
 * @param {Array} messages 消息数组
 * @param {Object} options 选项
 * @param {Function} fallbackFn 回退函数（可选）
 * @returns {Promise<string>}
 */
export async function handleParallelFill(messages, options = {}, fallbackFn = null) {
    const config = getTableFillerConfig();
    const executor = new ParallelExecutor(config);

    // 设置进度回调
    if (progressCallback) {
        executor.setProgressCallback(progressCallback);
    }

    try {
        // 从 messages 中提取表格数据
        const tables = splitTablesFromMessages(messages);

        if (tables.length === 0) {
            Logger.warn("[Interceptor] 未能解析出表格数据");
            if (window.toastr) {
                window.toastr.info("未检测到多表格数据，使用原始模式", "并发填表");
            }
            if (fallbackFn) return fallbackFn(messages, options);
            throw new Error("未检测到表格数据");
        }

        Logger.log(
            `[Interceptor] 检测到 ${tables.length} 个表格，启用并发模式`,
        );

        // 显示通知
        if (window.toastr) {
            window.toastr.info(
                `🚀 正在并发处理 ${tables.length} 个表格...`,
                "并发填表已启动",
                { timeOut: 3000 },
            );
        }

        // 并发填充
        const results = await executor.fillAllTables(tables, messages, options);

        // 统计结果
        const successCount = results.filter((r) => r.success).length;
        const failedCount = results.length - successCount;

        // 显示结果通知
        if (window.toastr) {
            if (failedCount === 0) {
                window.toastr.success(
                    `✅ ${successCount} 个表格全部处理成功`,
                    "并发填表完成",
                );
            } else if (successCount > 0) {
                window.toastr.warning(
                    `⚠️ ${successCount}/${results.length} 个表格成功，${failedCount} 个失败`,
                    "并发填表部分完成",
                );
            } else {
                window.toastr.error(
                    "❌ 所有表格处理失败",
                    "并发填表失败",
                );
                if (fallbackFn) return fallbackFn(messages, options);
                throw new Error("所有表格处理失败");
            }
        }

        // 合并结果
        return mergeResults(results);
    } catch (error) {
        Logger.error("[Interceptor] 并发填表失败:", error);

        if (window.toastr) {
            window.toastr.error(
                `❌ 并发填表出错: ${error.message}`,
                "并发填表错误",
            );
        }

        // 失败时回退到原始调用
        if (fallbackFn) return fallbackFn(messages, options);
        throw error;
    }
}

/**
 * 创建拦截版本的调用函数
 * @param {Function} originalFn 原始函数
 * @returns {Function}
 */
function createInterceptedCall(originalFn) {
    return async function interceptedCall(messages, options = {}) {
        if (isTableFillerEnabled() && isTableFillerRequest(messages)) {
            Logger.log("[Interceptor] ✓ 检测到表格填充请求，启用并发模式");
            return await handleParallelFill(messages, options, originalFn);
        }
        return originalFn(messages, options);
    };
}

/**
 * 安装全局钩子
 * 在 window 上暴露拦截器接口，供 Amily2 可选调用
 */
function installGlobalHook() {
    // 暴露全局拦截器接口
    window._tableFillerInterceptor = {
        // 版本
        version: "1.0.0",

        // 检查是否应该拦截此请求
        shouldIntercept: (messages) => {
            return isTableFillerEnabled() && isTableFillerRequest(messages);
        },

        // 并发填表接口（供 Amily2 调用）
        fillParallel: handleParallelFill,

        // 检查是否启用
        isEnabled: isTableFillerEnabled,

        // 获取配置
        getConfig: getTableFillerConfig,
    };

    Logger.log("[Interceptor] 全局钩子已安装 (window._tableFillerInterceptor)");
}

/**
 * 安装 API 拦截器
 * 安装所有拦截器以覆盖各种 API 提供商
 * @returns {Promise<boolean>}
 */
export async function installInterceptor() {
    if (isHooked) {
        Logger.log("[Interceptor] 拦截器已安装，跳过");
        return true;
    }

    try {
        // 1. 安装 Fetch 拦截器（覆盖 openai、openai_test、google）
        const fetchInstalled = installFetchInterceptor();
        if (fetchInstalled) {
            Logger.log("[Interceptor] ✓ Fetch 拦截器安装成功");
        }

        // 2. 安装 XHR 拦截器（覆盖 sillytavern_backend 的 $.ajax）
        const xhrInstalled = installXHRInterceptor();
        if (xhrInstalled) {
            Logger.log("[Interceptor] ✓ XHR 拦截器安装成功");
        }

        // 3. 安装 Service 拦截器（覆盖 sillytavern_preset）
        const serviceInstalled = installServiceInterceptor();
        if (serviceInstalled) {
            Logger.log("[Interceptor] ✓ Service 拦截器安装成功");
        }

        // 4. 安装全局钩子（预留方式）
        installGlobalHook();

        // 5. 尝试通过 Amily2Bus 进行更深度的集成（预留方式）
        let busHookSuccess = false;
        if (window.Amily2Bus) {
            try {
                const nccsApi = window.Amily2Bus.query("NccsApi");
                if (nccsApi && typeof nccsApi.call === 'function') {
                    originalNccsCall = nccsApi.call;
                    nccsApi.call = createInterceptedCall(originalNccsCall);
                    busHookSuccess = true;
                    Logger.log("[Interceptor] ✓ Bus.NccsApi.call 已替换");
                }
            } catch (e) {
                Logger.debug("[Interceptor] Bus 钩子失败:", e.message);
            }
        }

        isHooked = true;
        setInterceptorInstalled(true);

        // 统计安装结果
        const installedCount = [fetchInstalled, xhrInstalled, serviceInstalled].filter(Boolean).length;

        // 显示状态通知
        if (window.toastr) {
            if (installedCount > 0) {
                window.toastr.success(
                    `已安装 ${installedCount} 个拦截器`,
                    "Amily表格并发"
                );
            } else {
                window.toastr.warning(
                    "拦截器安装失败",
                    "Amily表格并发"
                );
            }
        }

        Logger.log("============================================");
        Logger.log("[Interceptor] 拦截器安装完成");
        Logger.log("[Interceptor] Fetch 拦截: " + (fetchInstalled ? "✓" : "✗"));
        Logger.log("[Interceptor] XHR 拦截: " + (xhrInstalled ? "✓" : "✗"));
        Logger.log("[Interceptor] Service 拦截: " + (serviceInstalled ? "✓" : "✗"));
        Logger.log("[Interceptor] Bus 钩子: " + (busHookSuccess ? "✓" : "✗"));
        Logger.log("[Interceptor] 全局钩子: ✓");
        Logger.log("============================================");

        return true;

    } catch (e) {
        Logger.error("[Interceptor] 安装拦截器失败:", e);
        setInterceptorInstalled(false);
        return false;
    }
}

/**
 * 卸载 API 拦截器
 */
export function uninstallInterceptor() {
    if (!isHooked) {
        return;
    }

    // 1. 卸载 Fetch 和 XHR 拦截器
    uninstallFetchInterceptor();

    // 2. 卸载 Service 拦截器
    uninstallServiceInterceptor();

    // 3. 恢复 Bus 上的原始函数
    if (window.Amily2Bus && originalNccsCall) {
        try {
            const nccsApi = window.Amily2Bus.query("NccsApi");
            if (nccsApi) {
                nccsApi.call = originalNccsCall;
                Logger.log("[Interceptor] 已恢复 Bus.NccsApi.call");
            }
        } catch (e) {
            Logger.debug("[Interceptor] 恢复 Bus 钩子失败:", e.message);
        }
    }

    // 4. 清理全局钩子
    delete window._tableFillerInterceptor;

    originalNccsCall = null;
    isHooked = false;
    setInterceptorInstalled(false);

    Logger.log("[Interceptor] API 拦截器已卸载");

    if (window.toastr) {
        window.toastr.info("并发填表拦截器已卸载", "Amily表格并发");
    }
}

/**
 * 获取拦截器状态
 * @returns {Object}
 */
export function getInterceptorStatus() {
    return {
        hooked: isHooked,
        fetchInterceptor: isFetchInterceptorInstalled(),
        serviceInterceptor: isServiceInterceptorInstalled(),
        globalHook: !!window._tableFillerInterceptor,
        busHook: !!originalNccsCall
    };
}
