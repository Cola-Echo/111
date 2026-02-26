/**
 * 表格拆分器
 * 从 messages 中提取并拆分表格数据
 * @module table-filler/table-splitter
 */

import Logger from "@core/logger";

/**
 * 表格名称列表（用于匹配）
 */
const TABLE_NAMES = [
    "角色表", "关系表", "物品表", "组织表", "地点表", "能力表", "任务表",
    "时空栏", "人物表", "道具表", "势力表", "场所表", "技能表", "事件表"
];

/**
 * 从 messages 中提取并拆分表格数据
 * @param {Array} messages 原始消息数组
 * @returns {Array<{index: number, name: string, fullContent: string}>}
 */
export function splitTablesFromMessages(messages) {
    if (!messages || !Array.isArray(messages)) {
        Logger.debug("[TableSplitter] messages 不是有效数组");
        return [];
    }

    // 合并所有消息内容进行搜索
    const allContent = messages.map(m => m.content || '').join('\n');

    // 方法1: 尝试匹配完整格式 "* 0:角色表\n【说明】..."
    let tables = extractTablesFullFormat(allContent);
    if (tables.length > 0) {
        Logger.log(`[TableSplitter] 使用完整格式解析，找到 ${tables.length} 个表格:`, tables.map(t => t.name));
        return tables;
    }

    // 方法2: 尝试匹配 <表格名内容>...</表格名内容> 格式
    tables = extractTablesContentTagFormat(allContent);
    if (tables.length > 0) {
        Logger.log(`[TableSplitter] 使用内容标签格式解析，找到 ${tables.length} 个表格:`, tables.map(t => t.name));
        return tables;
    }

    // 方法3: 尝试匹配 <表格名>...</表格名> 简化格式
    tables = extractTablesSimpleTagFormat(allContent);
    if (tables.length > 0) {
        Logger.log(`[TableSplitter] 使用简化标签格式解析，找到 ${tables.length} 个表格:`, tables.map(t => t.name));
        return tables;
    }

    Logger.debug("[TableSplitter] 未找到可解析的表格数据");
    return [];
}

/**
 * 提取完整格式表格
 * 格式: * 0:角色表\n【说明】: ...\n<角色表内容>...\n【增加】: ...
 * @param {string} content 内容
 * @returns {Array}
 */
function extractTablesFullFormat(content) {
    const tables = [];

    // 匹配 "* 数字:表格名" 开头的块
    // 使用更精确的边界：下一个表格块、结束标签
    const tableRegex = /\* (\d+):([^\n]+)\n([\s\S]*?)(?=\* \d+:|<\/需要更新的旧表格>|$)/g;
    let match;

    while ((match = tableRegex.exec(content)) !== null) {
        const tableName = match[2].trim();
        // 验证是否是有效的表格名
        if (TABLE_NAMES.some(name => tableName.includes(name) || name.includes(tableName))) {
            tables.push({
                index: parseInt(match[1]),
                name: tableName,
                fullContent: match[0].trim(),
            });
        }
    }

    return tables;
}

/**
 * 提取内容标签格式表格
 * 格式: <角色表内容>...</角色表内容>
 * @param {string} content 内容
 * @returns {Array}
 */
function extractTablesContentTagFormat(content) {
    const tables = [];

    // 匹配 <表格名内容>...</表格名内容>
    for (let i = 0; i < TABLE_NAMES.length; i++) {
        const tableName = TABLE_NAMES[i];
        const regex = new RegExp(`<${tableName}内容>([\\s\\S]*?)<\\/${tableName}内容>`, 'g');
        let match;

        while ((match = regex.exec(content)) !== null) {
            tables.push({
                index: i,
                name: tableName,
                fullContent: match[0],
                tableData: match[1].trim(),
            });
        }
    }

    return tables;
}

/**
 * 提取简化标签格式表格
 * 格式: <角色表>...</角色表>
 * @param {string} content 内容
 * @returns {Array}
 */
function extractTablesSimpleTagFormat(content) {
    const tables = [];

    // 匹配 <表格名>...</表格名>（排除 <表格名内容> 格式）
    for (let i = 0; i < TABLE_NAMES.length; i++) {
        const tableName = TABLE_NAMES[i];
        // 使用负向先行断言排除 "内容>" 结尾
        const regex = new RegExp(`<${tableName}>([\\s\\S]*?)<\\/${tableName}>`, 'g');
        let match;

        while ((match = regex.exec(content)) !== null) {
            // 确保不是 <表格名内容> 格式
            if (!match[0].includes(`<${tableName}内容>`)) {
                tables.push({
                    index: i,
                    name: tableName,
                    fullContent: match[0],
                    tableData: match[1].trim(),
                });
            }
        }
    }

    return tables;
}

/**
 * 为单个表格构建独立的 messages
 * 保留该表格的数据，移除其他表格的数据
 * @param {Array} originalMessages 原始消息数组
 * @param {Object} singleTable 单个表格对象
 * @returns {Array}
 */
export function buildSingleTableMessages(originalMessages, singleTable) {
    return originalMessages.map((msg) => {
        let content = msg.content;
        if (!content) return msg;

        // 移除其他表格的数据，只保留当前表格
        for (const tableName of TABLE_NAMES) {
            if (tableName === singleTable.name) continue;

            // 移除 <表格名内容>...</表格名内容> 格式
            const contentTagRegex = new RegExp(`<${tableName}内容>[\\s\\S]*?<\\/${tableName}内容>`, 'g');
            content = content.replace(contentTagRegex, '');

            // 移除 <表格名>...</表格名> 格式
            const simpleTagRegex = new RegExp(`<${tableName}>[\\s\\S]*?<\\/${tableName}>`, 'g');
            content = content.replace(simpleTagRegex, '');

            // 移除 "* N:表格名" 开头的完整块（包含【说明】【增加】【删除】【修改】和<表格名内容>）
            // 匹配从 "* 数字:表格名" 开始，到下一个 "* 数字:" 或 "</需要更新的旧表格>" 之前的所有内容
            const fullBlockRegex = new RegExp(
                `\\* \\d+:${tableName}[\\s\\S]*?(?=\\n\\* \\d+:|</需要更新的旧表格>)`,
                'g'
            );
            content = content.replace(fullBlockRegex, '');
        }

        // 清理多余的空行
        content = content.replace(/\n{3,}/g, '\n\n');

        return { ...msg, content };
    });
}

/**
 * 从 AI 响应中提取 Amily2Edit 指令
 * @param {string} response AI 响应文本
 * @returns {string|null}
 */
export function extractCommands(response) {
    if (!response) return null;

    // 尝试匹配带注释的格式: <Amily2Edit><!--...--></Amily2Edit>
    let match = response.match(
        /<Amily2Edit>\s*<!--([\s\S]*?)-->\s*<\/Amily2Edit>/,
    );
    if (match) {
        return match[1].trim();
    }

    // 尝试匹配不带注释的格式: <Amily2Edit>...</Amily2Edit>
    match = response.match(
        /<Amily2Edit>([\s\S]*?)<\/Amily2Edit>/,
    );
    if (match) {
        // 如果内容被注释包裹，提取注释内的内容
        const content = match[1].trim();
        const commentMatch = content.match(/<!--([\s\S]*?)-->/);
        if (commentMatch) {
            return commentMatch[1].trim();
        }
        return content;
    }

    return null;
}

/**
 * 合并所有表格的 AI 响应
 * @param {Array} results 表格填充结果数组
 * @returns {string}
 */
export function mergeResults(results) {
    const successResults = results.filter((r) => r.success);

    if (successResults.length === 0) {
        throw new Error("所有表格填充均失败");
    }

    // 统计成功和失败
    const successCount = successResults.length;
    const failedTables = results
        .filter((r) => !r.success)
        .map((r) => r.tableName);

    if (failedTables.length > 0) {
        Logger.warn(
            `[TableSplitter] 部分表格填充失败: ${failedTables.join(", ")}`,
        );
    }

    Logger.log(
        `[TableSplitter] 合并结果: ${successCount}/${results.length} 个表格成功`,
    );

    // 提取所有 <Amily2Edit> 块中的指令
    const allCommands = [];

    for (const r of successResults) {
        const commands = extractCommands(r.response);
        if (commands) {
            allCommands.push(commands);
        }
    }

    // 合并所有指令
    const mergedCommands = allCommands.join("\n");

    // 重新包装为 Amily2 期望的格式
    return `<Amily2Edit>\n<!--\n${mergedCommands}\n-->\n</Amily2Edit>`;
}

/**
 * 获取原始 messages 中的对话记录
 * @param {Array} messages 消息数组
 * @returns {string}
 */
export function extractDialogContent(messages) {
    const userMsg = messages.find(
        (m) => m.role === "user" && m.content?.includes("<对话记录>"),
    );
    if (!userMsg) return "";

    const match = userMsg.content.match(/<对话记录>([\s\S]*?)<\/对话记录>/);
    return match ? match[1].trim() : userMsg.content;
}
