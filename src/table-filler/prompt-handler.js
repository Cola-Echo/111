/**
 * 提示词处理器
 * 支持独立提示词和共享提示词两种模式
 * @module table-filler/prompt-handler
 */

import Logger from "@core/logger";

/**
 * 提示词处理模式
 */
export const PromptMode = {
    INDEPENDENT: "independent", // 独立提示词：精准替换 ruleTemplate 和 flowTemplate
    SHARED: "shared", // 共享提示词：保留原提示词，只替换表格数据 + 添加聚焦指令
};

/**
 * 表格与思考阶段对应关系
 */
export const TABLE_PHASE_MAP = {
    角色表: { phase: 2, name: "角色表检查" },
    关系表: { phase: 3, name: "关系表检查" },
    物品表: { phase: 4, name: "物品表检查" },
    组织表: { phase: 5, name: "组织表检查" },
    地点表: { phase: 6, name: "地点表检查" },
    能力表: { phase: 7, name: "能力表检查" },
    任务表: { phase: 8, name: "任务表检查" },
};

/**
 * 为单个表格构建提示词
 * @param {Object} table 表格对象
 * @param {Array} originalMessages 原始消息数组
 * @param {Object} config 配置对象
 * @returns {Array}
 */
export function buildPromptForTable(table, originalMessages, config) {
    if (config.promptMode === PromptMode.INDEPENDENT) {
        // 独立模式：优先使用 V2（按名称存储的模板），回退到 V1（导入的预设）
        if (config.independentTemplates?.[table.name]) {
            return buildIndependentPromptV2(table, originalMessages, config);
        }
        // 回退到 V1（兼容旧版导入的预设）
        return buildIndependentPrompt(table, originalMessages, config);
    } else {
        return buildSharedPrompt(table, originalMessages, config);
    }
}

/**
 * 独立提示词模式
 * 精准替换 ruleTemplate 和 flowTemplate，保留其他所有内容
 * @param {Object} table 表格对象
 * @param {Array} originalMessages 原始消息数组
 * @param {Object} config 配置对象
 * @returns {Array}
 */
function buildIndependentPrompt(table, originalMessages, config) {
    const tableConfig = config.importedPreset?.tablePresets?.[table.name];

    if (
        !tableConfig?.batchFillerRuleTemplate ||
        !tableConfig?.batchFillerFlowTemplate
    ) {
        Logger.warn(
            `[PromptHandler] 表格 ${table.name} 未配置独立提示词，回退到共享模式`,
        );
        return buildSharedPrompt(table, originalMessages, config);
    }

    // 复制原始 messages，精准替换特定内容
    return originalMessages.map((msg) => {
        const content = msg.content;

        // 识别并替换 ruleTemplate（通过特征标记识别）
        if (isRuleTemplateMessage(content)) {
            return {
                ...msg,
                content: tableConfig.batchFillerRuleTemplate,
            };
        }

        // 识别并替换 flowTemplate（通过特征标记识别）
        if (isFlowTemplateMessage(content)) {
            // 使用表格专属的 flowTemplate，替换表格数据占位符
            const newFlowContent =
                tableConfig.batchFillerFlowTemplate.replace(
                    "{{{Amily2TableData}}}",
                    table.fullContent,
                );
            return {
                ...msg,
                content: newFlowContent,
            };
        }

        // 其他消息（preset prompts、worldbook、coreContent）保持不变
        return msg;
    });
}

/**
 * 共享提示词模式
 * 复用通用提示词，添加聚焦指令让 AI 只处理当前表格
 * @param {Object} table 表格对象
 * @param {Array} originalMessages 原始消息数组
 * @param {Object} config 配置对象
 * @returns {Array}
 */
function buildSharedPrompt(table, originalMessages, config) {
    const phaseInfo = TABLE_PHASE_MAP[table.name];

    // 表格名列表（用于移除其他表格）
    const allTableNames = Object.keys(TABLE_PHASE_MAP);

    // 标记是否已添加聚焦指令（只添加一次）
    let focusInstructionAdded = false;

    // 深拷贝原始 messages，确保并发处理时不会相互影响
    const messages = originalMessages.map((msg) => {
        // 创建消息的深拷贝
        const newMsg = { ...msg };
        let content = newMsg.content;

        if (!content) return newMsg;

        // 移除其他表格的数据，只保留当前表格
        for (const tableName of allTableNames) {
            if (tableName === table.name) continue;

            // 移除 "* N:表格名" 开头的完整块（包含【说明】【增加】【删除】【修改】和<表格名内容>）
            // 匹配从 "* 数字:表格名" 开始，到下一个 "* 数字:" 或 "</需要更新的旧表格>" 之前的所有内容
            const fullBlockRegex = new RegExp(
                `\\* \\d+:${tableName}[\\s\\S]*?(?=\\n\\* \\d+:|</需要更新的旧表格>)`,
                'g'
            );
            content = content.replace(fullBlockRegex, '');

            // 备用：移除独立的 <表格名内容>...</表格名内容> 格式（如果不在 * N: 块内）
            const contentTagRegex = new RegExp(`<${tableName}内容>[\\s\\S]*?<\\/${tableName}内容>`, 'g');
            content = content.replace(contentTagRegex, '');

            // 备用：移除独立的 <表格名>...</表格名> 格式
            const simpleTagRegex = new RegExp(`<${tableName}>[\\s\\S]*?<\\/${tableName}>`, 'g');
            content = content.replace(simpleTagRegex, '');
        }

        // 清理多余的空行
        content = content.replace(/\n{3,}/g, '\n\n');

        // 在 flowTemplate 消息中添加聚焦指令（只添加一次）
        if (!focusInstructionAdded && isFlowTemplateMessage(content)) {
            content = addFocusInstruction(content, table.name, phaseInfo, table.index);
            focusInstructionAdded = true;
        }

        newMsg.content = content;
        return newMsg;
    });

    return messages;
}

/**
 * 识别 ruleTemplate 消息
 * 通过 Amily2 ruleTemplate 的特征标记识别
 * @param {string} content 消息内容
 * @returns {boolean}
 */
function isRuleTemplateMessage(content) {
    if (!content) return false;
    return (
        content.includes("酒馆国家协议") ||
        content.includes("酒馆国家的臣民") ||
        content.includes("Amily需要严格遵守以下规则")
    );
}

/**
 * 识别 flowTemplate 消息
 * 通过 Amily2 flowTemplate 的特征标记识别
 * @param {string} content 消息内容
 * @returns {boolean}
 */
function isFlowTemplateMessage(content) {
    if (!content) return false;
    return (
        content.includes("# dataTable 说明") ||
        content.includes("dataTable 说明") ||
        content.includes("Amily2TableData") ||
        content.includes("表格操作指南") ||
        content.includes("insertRow(") ||
        content.includes("updateRow(")
    );
}

/**
 * 添加聚焦指令
 * 使用通用化格式，不依赖特定预设结构（如阶段号）
 * @param {string} content 原始内容
 * @param {string} tableName 表格名称
 * @param {Object} phaseInfo 阶段信息（可选，不再强制使用）
 * @param {number} tableIndex 表格索引
 * @returns {string}
 */
function addFocusInstruction(content, tableName, phaseInfo, tableIndex) {
    // 构建其他表格列表
    const otherTables = Object.keys(TABLE_PHASE_MAP).filter(name => name !== tableName);
    const otherPhases = otherTables.map(name => `阶段${TABLE_PHASE_MAP[name].phase}(${name})`).join('、');

    const focusInstruction = `
##【并发模式-单表格聚焦指令】##
本次请求采用并发填表模式，你只需要处理「${tableName}」（索引: ${tableIndex}）。

【重要】思考流程限制：
- 仅执行与「${tableName}」相关的思考步骤
- 完全跳过其他表格的思考步骤：${otherPhases}
- 严格按照预设中的操作函数格式和输出示例进行输出

【操作范围】
- 仅输出对「${tableName}」的操作指令
- 其他表格由并行任务处理，请勿跨表操作
##【聚焦指令结束】##
`;
    // 在内容开头添加聚焦指令（确保 AI 优先看到）
    return focusInstruction + "\n" + content;
}

/**
 * 获取表格的阶段信息
 * @param {string} tableName 表格名称
 * @returns {Object|null}
 */
export function getTablePhaseInfo(tableName) {
    return TABLE_PHASE_MAP[tableName] || null;
}

/**
 * 独立模式 V2：按名称查找模板 + 标签精准替换
 *
 * 处理逻辑：
 * 1. 拦截 Amily 发送的内容
 * 2. 从 <Instructions for filling out the form> 内的 <需要更新的旧表格> 提取表格数据并拆分（由 table-splitter.js 完成）
 * 3. 把拦截内容的 <Instructions for filling out the form> 内全部清空
 * 4. 用插件的独立提示词模板 + 占位符注入单个表格数据
 * 5. 把第4步的结果放回第3步清空的 <Instructions for filling out the form> 标签内
 *
 * @param {Object} table 表格对象（含 fullContent 单表格数据）
 * @param {Array} originalMessages 原始消息数组
 * @param {Object} config 配置对象
 * @returns {Array}
 */
export function buildIndependentPromptV2(table, originalMessages, config) {
    // 按名称查找配置（而非索引）
    const tableConfig = config.independentTemplates?.[table.name];

    // 获取模板内容（处理可能的嵌套结构）
    let templateContent = tableConfig?.template;
    if (typeof templateContent === 'object' && templateContent !== null) {
        // 处理嵌套结构：{ template: { template: "..." } }
        templateContent = templateContent.template;
    }

    if (!templateContent || typeof templateContent !== 'string') {
        // 无有效模板时回退到共享模式
        Logger.warn(`[PromptHandler] 表格「${table.name}」模板无效或为空，回退到共享模式`);
        return buildSharedPrompt(table, originalMessages, config);
    }

    // 标签名（支持用户自定义）
    const tagName = config.independentTagName || "Instructions for filling out the form";

    // 【步骤4】用插件的独立提示词模板 + 占位符注入单个表格数据
    let userTemplate = templateContent;
    userTemplate = userTemplate.split('{{tableData}}').join(table.fullContent || '');
    userTemplate = userTemplate.split('{{tableName}}').join(table.name || '');
    userTemplate = userTemplate.split('{{tableIndex}}').join(String(table.index));

    // 用于跟踪是否已经注入过用户模板（只注入一次）
    let templateInjected = false;

    const openTag = `<${tagName}>`;
    const closeTag = `</${tagName}>`;

    const processedMessages = originalMessages.map((msg) => {
        const content = msg.content;
        if (!content) return msg;

        // 使用 indexOf 查找标签位置（比正则更可靠）
        const openIndex = content.indexOf(openTag);
        const closeIndex = content.indexOf(closeTag);

        if (openIndex !== -1 && closeIndex !== -1 && closeIndex > openIndex) {
            // 找到标签，清空原内容并注入用户模板
            const before = content.substring(0, openIndex + openTag.length);
            const after = content.substring(closeIndex);

            if (!templateInjected) {
                templateInjected = true;
                // 注入用户模板到标签内
                const newContent = before + '\n' + userTemplate + '\n' + after;
                return { ...msg, content: newContent };
            } else {
                // 已注入过，清空此标签内容
                const newContent = before + '\n' + after;
                return { ...msg, content: newContent };
            }
        }

        // 没有找到标签，直接返回原消息
        return msg;
    });

    // 如果模板未能生效，显示警告通知
    if (!templateInjected) {
        if (window.toastr) {
            window.toastr.warning(
                `未找到标签 <${tagName}>，模板可能未生效`,
                `${table.name} 独立模式`,
                { timeOut: 5000 }
            );
        }
    }

    return processedMessages;
}

/**
 * 转义正则表达式特殊字符
 * @param {string} str 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
