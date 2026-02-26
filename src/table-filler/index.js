/**
 * 表格填表模块入口
 * 支持多种拦截模式：Fetch、XHR、Service、Bus
 * @module table-filler/index
 */

import Logger from "@core/logger";
import { getTableFillerConfig, isTableFillerEnabled } from "@config/config-manager";
import { registerToBus, getBusContext } from "./bus-integration";
import { installInterceptor, uninstallInterceptor, setInterceptorProgressCallback, getInterceptorStatus } from "./interceptor";
import { isFetchInterceptorInstalled } from "./fetch-interceptor";
import { isServiceInterceptorInstalled } from "./service-interceptor";
import {
    CallMode,
    detectAvailableMode,
    getModeStatus,
    isBusRegistered,
    isInterceptorInstalled,
    isSecondaryApiMode,
    getAmily2FillingModeName,
} from "./mode-manager";

// 导出子模块
export { CallMode, getModeStatus, isSecondaryApiMode, getAmily2FillingModeName } from "./mode-manager";
export { ParallelExecutor } from "./parallel-executor";
export { PromptMode, TABLE_PHASE_MAP } from "./prompt-handler";
export { splitTablesFromMessages, mergeResults } from "./table-splitter";
export { isFetchInterceptorInstalled, getOriginalFetch, isTableFillerRequest } from "./fetch-interceptor";
export { isServiceInterceptorInstalled } from "./service-interceptor";

// 初始化状态
let isInitialized = false;

/**
 * 初始化表格填表模块
 * @param {boolean} immediate - 是否立即安装拦截器（默认延迟）
 * @returns {Promise<void>}
 */
export async function initTableFiller(immediate = false) {
    if (isInitialized) {
        Logger.log("[TableFiller] 模块已初始化，跳过");
        return;
    }

    const config = getTableFillerConfig();

    if (!config?.enabled) {
        Logger.log("[TableFiller] 功能未启用");
        return;
    }

    Logger.log("[TableFiller] 开始初始化...");

    // 1. 始终注册 Bus 接口（供未来 Amily2 调用）
    const busCtx = registerToBus();

    // 2. 根据配置决定是否安装拦截器
    const mode = config.callMode || CallMode.AUTO;

    if (mode === CallMode.AUTO || mode === CallMode.INTERCEPT_ONLY) {
        // 检测当前模式
        const available = detectAvailableMode();

        if (mode === CallMode.AUTO && available.bus) {
            // Bus 模式可用，不安装拦截器
            Logger.log("[TableFiller] Bus 模式可用，跳过拦截器安装");
        } else {
            // 安装拦截器
            if (immediate) {
                // 立即安装（用于重新初始化）
                const installed = await installInterceptor();
                if (installed) {
                    Logger.log("[TableFiller] 拦截器安装成功");
                    // 触发状态更新事件
                    dispatchStatusUpdateEvent();
                }
            } else {
                // 延迟安装，确保 Amily2 模块已加载（首次初始化）
                setTimeout(async () => {
                    const installed = await installInterceptor();
                    if (installed) {
                        Logger.log("[TableFiller] 拦截器安装成功");
                        // 触发状态更新事件
                        dispatchStatusUpdateEvent();
                    }
                }, 2000);
            }
        }
    }

    isInitialized = true;

    Logger.log("[TableFiller] 初始化完成", {
        mode: config.callMode,
        busRegistered: isBusRegistered(),
    });
}

/**
 * 触发状态更新事件，通知 UI 刷新
 */
function dispatchStatusUpdateEvent() {
    try {
        window.dispatchEvent(new CustomEvent('tableFillerStatusUpdate', {
            detail: getTableFillerStatus()
        }));
    } catch (e) {
        Logger.debug("[TableFiller] 触发状态更新事件失败:", e.message);
    }
}

/**
 * 禁用表格填表模块
 */
export function disableTableFiller() {
    uninstallInterceptor();
    isInitialized = false;
    Logger.log("[TableFiller] 模块已禁用");
    // 通知已由 UI 层显示，此处不再重复
}

/**
 * 获取表格填表模块状态
 * @returns {Object}
 */
export function getTableFillerStatus() {
    const interceptorStatus = getInterceptorStatus();
    return {
        initialized: isInitialized,
        enabled: isTableFillerEnabled(),
        mode: getModeStatus(),
        busContext: getBusContext() ? true : false,
        interceptor: interceptorStatus,
        fetchInterceptor: isFetchInterceptorInstalled(),
    };
}

/**
 * 设置进度回调
 * @param {Function} callback
 */
export function setProgressCallback(callback) {
    setInterceptorProgressCallback(callback);
}

/**
 * 重新初始化（配置变更后调用）
 */
export async function reinitTableFiller() {
    if (isInitialized) {
        disableTableFiller();
    }
    // 使用立即模式安装拦截器，避免延迟导致状态不更新
    await initTableFiller(true);
}
