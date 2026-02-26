/**
 * Amily2Bus 联动集成模块
 * 通过 Amily2Bus 暴露并发填表能力
 * @module table-filler/bus-integration
 */

import Logger from "@core/logger";
import { getTableFillerConfig, isTableFillerEnabled } from "@config/config-manager";
import { setBusRegistered } from "./mode-manager";
import { splitTablesFromMessages, mergeResults } from "./table-splitter";
import { ParallelExecutor } from "./parallel-executor";

let busContext = null;

/**
 * 检查是否有有效配置
 * @returns {boolean}
 */
function hasValidConfig() {
    const config = getTableFillerConfig();
    if (!config) return false;

    // 检查默认 API 配置
    const defaultApi = config.defaultApi;
    if (defaultApi?.apiUrl && defaultApi?.model) {
        return true;
    }

    // 检查是否有表格独立 API 配置
    const tableApis = config.tableApiConfigs;
    if (tableApis && Object.keys(tableApis).length > 0) {
        return true;
    }

    return false;
}

/**
 * 处理来自 Amily2 的 Bus 调用
 * @param {Object} params 填表参数
 * @returns {Promise<string>}
 */
async function handleBusCall(params) {
    const { messages, options = {}, tableData } = params;

    const config = getTableFillerConfig();
    const executor = new ParallelExecutor(config);

    try {
        // 如果已提供拆分好的表格数据，直接使用
        // 否则从 messages 中提取
        const tables = tableData || splitTablesFromMessages(messages);

        if (tables.length === 0) {
            throw new Error("未能解析出表格数据");
        }

        Logger.log(`[TableFiller-Bus] 开始并发填表，共 ${tables.length} 个表格`);

        const results = await executor.fillAllTables(tables, messages, options);
        return mergeResults(results);
    } catch (error) {
        Logger.error("[TableFiller-Bus] 并发填表失败:", error);
        throw error; // 抛出错误让 Amily2 处理回退
    }
}

/**
 * 通过 Amily2Bus 暴露并发填表能力
 * Amily2 可通过 window.Amily2Bus.query('TableFillerProxy') 获取
 * @returns {Object|null} Bus 上下文对象
 */
export function registerToBus() {
    if (!window.Amily2Bus) {
        Logger.warn("[TableFiller] Amily2Bus 未找到，跳过 Bus 注册");
        setBusRegistered(false);
        return null;
    }

    try {
        // 检查是否已注册
        const existing = window.Amily2Bus.query("TableFillerProxy");
        if (existing) {
            Logger.log("[TableFiller] TableFillerProxy 已存在，跳过重复注册");
            setBusRegistered(true);
            return existing;
        }

        // 注册插件身份
        busContext = window.Amily2Bus.register("TableFillerProxy");

        // 暴露并发填表能力
        busContext.expose({
            // 版本信息
            version: "1.0.0",
            description: "Amily2 表格模块并发填表代理",

            /**
             * 核心方法：并发填表
             * @param {Object} params 填表参数
             * @param {Array} params.messages 原始 messages 数组
             * @param {Object} params.options 调用选项
             * @param {Object} params.tableData 可选，已拆分的表格数据
             * @returns {Promise<string>} 合并后的 <Amily2Edit> 指令
             */
            fillParallel: async (params) => {
                return await handleBusCall(params);
            },

            /**
             * 检查并发模式是否可用
             * @returns {boolean}
             */
            isAvailable: () => {
                return isTableFillerEnabled() && hasValidConfig();
            },

            /**
             * 获取当前配置状态
             * @returns {Object}
             */
            getStatus: () => {
                const config = getTableFillerConfig();
                return {
                    enabled: config?.enabled || false,
                    promptMode: config?.promptMode || "shared",
                    tableCount: Object.keys(
                        config?.importedPreset?.tablePresets || {},
                    ).length,
                    hasDefaultApi: !!(config?.defaultApi?.apiUrl),
                };
            },
        });

        busContext.log(
            "Init",
            "info",
            "TableFillerProxy 已通过 Amily2Bus 暴露联动接口",
        );
        setBusRegistered(true);
        Logger.log("[TableFiller] Bus 注册成功");

        return busContext;
    } catch (e) {
        Logger.error("[TableFiller] Bus 注册失败:", e);
        setBusRegistered(false);
        return null;
    }
}

/**
 * 获取 Bus 上下文
 * @returns {Object|null}
 */
export function getBusContext() {
    return busContext;
}
