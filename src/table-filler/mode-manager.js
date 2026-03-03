/**
 * 表格填表模式管理器
 * 支持双模式：拦截模式和 Bus 联动模式
 * @module table-filler/mode-manager
 */

import Logger from "@core/logger";
import { getExtensionSettings } from "@core/sillytavern-api";

/**
 * 调用模式枚举
 */
export const CallMode = {
    AUTO: "auto", // 自动选择（优先 Bus，fallback 拦截）
    BUS_ONLY: "bus_only", // 仅 Bus 模式（需 Amily2 支持）
    INTERCEPT_ONLY: "intercept_only", // 仅拦截模式
};

/**
 * 模式状态
 */
const modeState = {
    busRegistered: false,
    interceptorInstalled: false,
    fetchInterceptorInstalled: false,
    currentMode: null,
};

/**
 * 设置 Bus 注册状态
 * @param {boolean} registered
 */
export function setBusRegistered(registered) {
    modeState.busRegistered = registered;
}

/**
 * 设置拦截器安装状态
 * @param {boolean} installed
 */
export function setInterceptorInstalled(installed) {
    modeState.interceptorInstalled = installed;
}

/**
 * 设置 Fetch 拦截器安装状态
 * @param {boolean} installed
 */
export function setFetchInterceptorInstalled(installed) {
    modeState.fetchInterceptorInstalled = installed;
}

/**
 * 获取 Bus 注册状态
 * @returns {boolean}
 */
export function isBusRegistered() {
    return modeState.busRegistered;
}

/**
 * 获取拦截器安装状态
 * @returns {boolean}
 */
export function isInterceptorInstalled() {
    return modeState.interceptorInstalled;
}

/**
 * 获取 Fetch 拦截器安装状态
 * @returns {boolean}
 */
export function isFetchInterceptorInstalled() {
    return modeState.fetchInterceptorInstalled;
}

/**
 * 检测当前可用的调用模式
 * @returns {{bus: boolean, intercept: boolean, recommended: string}}
 */
export function detectAvailableMode() {
    const busAvailable = checkBusMode();
    const interceptAvailable = checkInterceptMode();

    return {
        bus: busAvailable,
        intercept: interceptAvailable,
        recommended: busAvailable
            ? "bus"
            : interceptAvailable
              ? "intercept"
              : "none",
    };
}

/**
 * 检查 Bus 模式是否可用
 * @returns {boolean}
 */
function checkBusMode() {
    // 1. Amily2Bus 存在
    if (!window.Amily2Bus) return false;

    // 2. 已成功注册
    const proxy = window.Amily2Bus.query("TableFillerProxy");
    if (!proxy) return false;

    // 3. Amily2 支持 Bus 调用（检查 Amily2 版本或标记）
    // 这个标记需要等 Amily2 更新后才会存在
    const amilyApi = window.Amily2Bus.query("Amily2");
    const amilySupport = amilyApi?.supportsBusTableFiller;

    return !!amilySupport;
}

/**
 * 检查拦截模式是否可用
 * @returns {boolean}
 */
function checkInterceptMode() {
    // 检查 Fetch 拦截器是否已安装（主要方式）
    if (modeState.fetchInterceptorInstalled) {
        return true;
    }

    // 检查拦截器是否已安装
    if (modeState.interceptorInstalled) {
        return true;
    }

    // 检查全局钩子是否存在
    if (window._tableFillerInterceptor) {
        return true;
    }

    // 检查 Amily2 模块是否加载（支持多种键名）
    try {
        const possibleKeys = [
            "ST-Amily2-Chat-Optimisation",
            "Amily2",
            "amily2",
            "Amily2-Chat-Optimisation"
        ];

        for (const key of possibleKeys) {
            if (getExtensionSettings()?.[key]) {
                return true;
            }
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * 检查 Amily2 当前填表模式是否为分步模式
 * @returns {boolean}
 */
export function isSecondaryApiMode() {
    try {
        // 尝试多种可能的设置键名
        const possibleKeys = [
            "Amily2",
            "ST-Amily2-Chat-Optimisation",
            "amily2",
            "Amily2-Chat-Optimisation"
        ];

        let amilySettings = null;
        for (const key of possibleKeys) {
            if (getExtensionSettings()?.[key]) {
                amilySettings = getExtensionSettings()[key];
                break;
            }
        }

        if (!amilySettings) {
            // 如果找不到设置，默认返回true（允许使用）
            return true;
        }

        // 检查多种可能的填表模式字段名
        const fillingMode = amilySettings.filling_mode
            || amilySettings.fillingMode
            || amilySettings.tableFillingMode
            || amilySettings.batchFillerMode
            || "secondary-api";  // 默认假设是分步模式

        return fillingMode === "secondary-api" || fillingMode === "secondary";
    } catch {
        return true;  // 出错时默认允许
    }
}

/**
 * 获取 Amily2 当前填表模式名称
 * @returns {string}
 */
export function getAmily2FillingModeName() {
    try {
        // 尝试多种可能的设置键名
        const possibleKeys = [
            "Amily2",
            "ST-Amily2-Chat-Optimisation",
            "amily2",
            "Amily2-Chat-Optimisation"
        ];

        let amilySettings = null;
        for (const key of possibleKeys) {
            if (getExtensionSettings()?.[key]) {
                amilySettings = getExtensionSettings()[key];
                break;
            }
        }

        if (!amilySettings) {
            return "未检测到Amily2";
        }

        const fillingMode = amilySettings.filling_mode
            || amilySettings.fillingMode
            || amilySettings.tableFillingMode
            || amilySettings.batchFillerMode
            || "unknown";

        const modeNames = {
            "main-api": "原始填表",
            "secondary-api": "分步填表",
            "secondary": "分步填表",
            optimized: "优化中填表",
            unknown: "未知模式",
        };
        return modeNames[fillingMode] || fillingMode;
    } catch {
        return "检测失败";
    }
}

/**
 * 获取当前模式状态详情
 * @returns {Object}
 */
export function getModeStatus() {
    const available = detectAvailableMode();
    return {
        busRegistered: modeState.busRegistered,
        interceptorInstalled: modeState.interceptorInstalled,
        fetchInterceptorInstalled: modeState.fetchInterceptorInstalled,
        busAvailable: available.bus,
        interceptAvailable: available.intercept,
        recommended: available.recommended,
        amily2Mode: getAmily2FillingModeName(),
        isSecondaryApi: isSecondaryApiMode(),
    };
}

/**
 * 记录模式状态日志
 */
export function logModeStatus() {
    const status = getModeStatus();
    Logger.log("[TableFiller] 模式状态:", status);
}
