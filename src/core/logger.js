/**
 * 日志工具模块
 * @module core/logger
 */

// 日志配置缓存
let logConfigCache = null;
let configModule = null;

// 使用 ES 模块的动态导入
async function loadConfigModule() {
    if (!configModule) {
        try {
            configModule = await import("@config/config-manager");
        } catch (e) {
            console.error("[记忆管理并发系统] 无法加载配置模块:", e);
        }
    }
    return configModule;
}

function getGlobalSettings() {
    // 先尝试从缓存获取
    if (logConfigCache) {
        return logConfigCache;
    }

    // 尝试直接获取配置（适用于模块已加载的情况）
    try {
        // 避免循环依赖，直接从全局对象获取
        if (
            typeof window !== "undefined" &&
            window.MemoryManagerConcurrent &&
            window.MemoryManagerConcurrent.getSettings
        ) {
            const settings = window.MemoryManagerConcurrent.getSettings();
            logConfigCache = settings;
            return settings;
        }
    } catch (e) {
        // 忽略错误
    }

    // 返回默认值
    return { showLogs: true }; // 默认显示日志，方便调试
}

// 系统前缀
const SYSTEM_PREFIX = "[记忆管理并发系统]";

// 当前活跃的日志组
let activeGroups = [];

/**
 * 日志工具对象
 */
const Logger = {
    prefix: SYSTEM_PREFIX,

    /**
     * 检查是否应该显示日志
     * @returns {boolean}
     */
    shouldShowLogs: () => {
        // 总是返回 true，确保所有日志都能显示
        return true;
    },

    /**
     * 构建完整的日志前缀
     * @param {string} [module] 模块名称
     * @returns {string} 完整前缀
     */
    buildPrefix: (module) => {
        if (module) {
            return `${SYSTEM_PREFIX}-[${module}]`;
        }
        return SYSTEM_PREFIX;
    },

    /**
     * 普通日志（受 showLogs 控制）
     * @param {...any} args 日志参数
     */
    log: (...args) => {
        if (Logger.shouldShowLogs()) {
            console.log(Logger.prefix, ...args);
        }
    },

    /**
     * 调试日志（受 showLogs 控制）
     * 注意：使用 console.log 而非 console.debug，确保在所有浏览器设置下可见
     * @param {...any} args 日志参数
     */
    debug: (...args) => {
        if (Logger.shouldShowLogs()) {
            console.log(Logger.prefix, "[DEBUG]", ...args);
        }
    },

    /**
     * 警告日志（受 showLogs 控制）
     * @param {...any} args 日志参数
     */
    warn: (...args) => {
        if (Logger.shouldShowLogs()) {
            console.warn(Logger.prefix, ...args);
        }
    },

    /**
     * 错误日志（总是输出）
     * @param {...any} args 日志参数
     */
    error: (...args) => {
        console.error(Logger.prefix, ...args);
    },

    /**
     * 信息日志（总是输出，用于重要信息）
     * @param {...any} args 日志参数
     */
    info: (...args) => {
        console.info(Logger.prefix, ...args);
    },

    // ==================== 日志分组功能 ====================

    /**
     * 开始一个日志组（展开状态）
     * @param {string} module 模块名称
     * @param {string} [label] 组标签
     */
    group: (module, label) => {
        if (!Logger.shouldShowLogs()) return;
        const prefix = Logger.buildPrefix(module);
        const groupLabel = label ? `${prefix} ${label}` : prefix;
        console.group(groupLabel);
        activeGroups.push(groupLabel);
    },

    /**
     * 开始一个折叠的日志组
     * @param {string} module 模块名称
     * @param {string} [label] 组标签
     */
    groupCollapsed: (module, label) => {
        if (!Logger.shouldShowLogs()) return;
        const prefix = Logger.buildPrefix(module);
        const groupLabel = label ? `${prefix} ${label}` : prefix;
        console.groupCollapsed(groupLabel);
        activeGroups.push(groupLabel);
    },

    /**
     * 结束当前日志组
     */
    groupEnd: () => {
        if (!Logger.shouldShowLogs()) return;
        if (activeGroups.length > 0) {
            console.groupEnd();
            activeGroups.pop();
        }
    },

    /**
     * 结束所有日志组
     */
    groupEndAll: () => {
        if (!Logger.shouldShowLogs()) return;
        while (activeGroups.length > 0) {
            console.groupEnd();
            activeGroups.pop();
        }
    },

    // ==================== 模块化日志工具 ====================

    /**
     * 创建一个带模块名的日志记录器
     * @param {string} module 模块名称
     * @returns {object} 日志记录器对象
     */
    createModuleLogger: (module) => {
        const modulePrefix = Logger.buildPrefix(module);

        return {
            prefix: modulePrefix,

            log: (...args) => {
                if (Logger.shouldShowLogs()) {
                    console.log(modulePrefix, ...args);
                }
            },

            debug: (...args) => {
                if (Logger.shouldShowLogs()) {
                    console.log(modulePrefix, "[DEBUG]", ...args);
                }
            },

            warn: (...args) => {
                if (Logger.shouldShowLogs()) {
                    console.warn(modulePrefix, ...args);
                }
            },

            error: (...args) => {
                console.error(modulePrefix, ...args);
            },

            info: (...args) => {
                console.info(modulePrefix, ...args);
            },

            /**
             * 开始一个日志组
             * @param {string} [label] 组标签
             */
            group: (label) => {
                Logger.group(module, label);
            },

            /**
             * 开始一个折叠的日志组
             * @param {string} [label] 组标签
             */
            groupCollapsed: (label) => {
                Logger.groupCollapsed(module, label);
            },

            /**
             * 结束当前日志组
             */
            groupEnd: () => {
                Logger.groupEnd();
            },

            /**
             * 执行带分组的操作
             * @param {string} label 组标签
             * @param {Function} fn 要执行的函数
             * @param {boolean} [collapsed=true] 是否折叠
             */
            withGroup: async (label, fn, collapsed = true) => {
                if (!Logger.shouldShowLogs()) {
                    return await fn();
                }
                if (collapsed) {
                    Logger.groupCollapsed(module, label);
                } else {
                    Logger.group(module, label);
                }
                try {
                    return await fn();
                } finally {
                    Logger.groupEnd();
                }
            },
        };
    },
};

export default Logger;
