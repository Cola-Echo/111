/**
 * 错误处理模块
 * @module core/error
 */

// 延迟导入以避免循环依赖
let Logger = null;

function getLogger() {
    if (!Logger) {
        Logger = require('./logger').default;
    }
    return Logger;
}

/**
 * 自定义错误类
 */
export class MemoryManagerError extends Error {
    /**
     * @param {string} message 错误消息
     * @param {string} code 错误代码
     * @param {object} details 详细信息
     */
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'MemoryManagerError';
        this.code = code;
        this.details = details;
    }
}

/**
 * 错误代码枚举
 */
export const ErrorCodes = {
    RATE_LIMIT: 'RATE_LIMIT',
    API_ERROR: 'API_ERROR',
    CONFIG_ERROR: 'CONFIG_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    PARSE_ERROR: 'PARSE_ERROR',
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',
    ABORT_ERROR: 'ABORT_ERROR',
};

/**
 * 统一错误处理函数
 * @param {Error} error 错误对象
 * @param {string} context 错误上下文
 * @param {boolean} showToast 是否显示提示
 * @returns {string} 用户友好的错误消息
 */
export function handleError(error, context, showToast = true) {
    const logger = getLogger();
    logger.error(`[${context}]`, error);

    let userMessage = '操作失败，请检查配置';

    if (error instanceof MemoryManagerError) {
        switch (error.code) {
            case ErrorCodes.RATE_LIMIT:
                userMessage = '请求过于频繁，请稍后再试';
                break;
            case ErrorCodes.API_ERROR:
                userMessage = `API 调用失败: ${error.message}`;
                break;
            case ErrorCodes.CONFIG_ERROR:
                userMessage = `配置错误: ${error.message}`;
                break;
            case ErrorCodes.NETWORK_ERROR:
                userMessage = '网络连接失败，请检查网络';
                break;
            case ErrorCodes.TIMEOUT_ERROR:
                userMessage = '请求超时，请稍后再试';
                break;
            case ErrorCodes.ABORT_ERROR:
                userMessage = '操作已取消';
                break;
            default:
                userMessage = error.message || userMessage;
        }
    } else if (error.name === 'AbortError') {
        userMessage = '操作已取消';
    } else {
        userMessage = error.message || userMessage;
    }

    if (showToast && typeof toastr !== 'undefined') {
        toastr.error(userMessage, '记忆管理器');
    }

    return userMessage;
}

/**
 * 创建 API 错误
 * @param {string} message 错误消息
 * @param {object} details 详细信息
 * @returns {MemoryManagerError}
 */
export function createAPIError(message, details = {}) {
    return new MemoryManagerError(message, ErrorCodes.API_ERROR, details);
}

/**
 * 创建配置错误
 * @param {string} message 错误消息
 * @param {object} details 详细信息
 * @returns {MemoryManagerError}
 */
export function createConfigError(message, details = {}) {
    return new MemoryManagerError(message, ErrorCodes.CONFIG_ERROR, details);
}

/**
 * 创建网络错误
 * @param {string} message 错误消息
 * @param {object} details 详细信息
 * @returns {MemoryManagerError}
 */
export function createNetworkError(message, details = {}) {
    return new MemoryManagerError(message, ErrorCodes.NETWORK_ERROR, details);
}
