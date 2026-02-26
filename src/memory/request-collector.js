/**
 * 请求信息收集模块 - 用于发送前检查预览
 * @module memory/request-collector
 */

import {
    getGlobalConfig,
    getGlobalSettings,
    getMemoryConfig,
    getSummaryConfig,
    isSummaryAutoSplitEnabled,
    getSummaryAutoSplitConfig,
    getSummaryPartApiConfig,
} from "@config/config-manager";
import Logger from "@core/logger";
import { formatAsWorldBook, getSummaryContent } from "@worldbook/parser";
import { analyzeSummaryContent } from "@worldbook/summary-splitter";
import { getJailbreakPrefix } from "./jailbreak";
import {
    buildDataInjection,
    buildUserPrompt,
    injectDataToPrompt,
    replacePromptVariables,
} from "./prompt-builder";
import {
    getPromptTemplate,
    getHistoricalPromptTemplate,
} from "./processor";

// 来源标签映射（与 flow-config.js 保持一致）
const SOURCE_LABELS = {
    jailbreak: "[条件块] 破限词",
    main: "[条件块] 主提示词 (mainPrompt 到 <数据注入点>)",
    user: "[条件块] 核心用户消息 <核心用户消息>",
    worldbook: "[条件块] 世界书内容 <世界书内容>",
    context: "[条件块] 前文内容 <前文内容>",
    auxiliary: "[条件块] 辅助提示词 (systemPrompt 从 <数据注入点>)",
};

/**
 * 根据流程配置对 promptParts 重新排序
 * @param {Array} promptParts 原�� prompt 部分列表
 * @param {string} flowType 流程类型
 * @returns {Array} 排序后的 promptParts
 */
function sortPromptPartsByFlowConfig(promptParts, flowType) {
    const settings = getGlobalSettings();
    const savedOrder = settings.promptPartsOrder || {};
    const sourceOrder = savedOrder[flowType];

    // 如果没有保存的顺序配置，返回原始顺序
    if (!sourceOrder || !Array.isArray(sourceOrder) || sourceOrder.length === 0) {
        return promptParts;
    }

    const sortedParts = [];
    const remainingParts = [...promptParts];

    // 按照保存的顺序添加
    for (const source of sourceOrder) {
        const index = remainingParts.findIndex(p => p.source === source);
        if (index !== -1) {
            sortedParts.push(remainingParts.splice(index, 1)[0]);
        }
    }

    // 添加未在配置中的部分（保持原顺序）
    sortedParts.push(...remainingParts);

    return sortedParts;
}

/**
 * 收集单个记忆任务的请求信息
 * @param {string} category 分类名称
 * @param {object} data 分类数据
 * @param {string} userMessage 用户消息
 * @param {string} context 上下文
 * @returns {Promise<object|null>} 请求信息
 */
export async function collectMemoryRequestInfo(category, data, userMessage, context) {
    const aiConfig = getMemoryConfig(category);
    const globalConfig = getGlobalConfig();

    try {
        const dataInjection = buildDataInjection({
            worldBookContent: formatAsWorldBook(data.index, data.details),
            context: context,
            userMessage: userMessage,
        });

        const template = await getPromptTemplate();

        // 获取破限词前缀
        const jailbreakPrefix = getJailbreakPrefix();

        // 使用与 processor.js 相同的方式构建提示词（包含流程配置顺序）
        const prompt = injectDataToPrompt(template, dataInjection, {
            flowType: "记忆世界书",
            jailbreakPrefix: jailbreakPrefix,
        });

        // 替换变量得到最终系统提示词
        const finalSystemPrompt = replacePromptVariables(
            prompt.systemPrompt,
            aiConfig,
            globalConfig,
        );

        // 构建用户提示词
        const finalUserMessage = buildUserPrompt(userMessage);

        // 构建详细的 prompt 部分列表（用于预览显示）
        const promptParts = [];

        // 添加破限词
        if (jailbreakPrefix && jailbreakPrefix.trim()) {
            promptParts.push({
                label: "破限词",
                content: jailbreakPrefix,
                source: "jailbreak",
            });
        }

        // 添加主提示词（去掉注入内容，并替换变量）
        const mainPromptWithoutInjection =
            template.mainPrompt || template.main_prompt || "";
        const cleanMainPrompt = replacePromptVariables(
            mainPromptWithoutInjection.split("<数据注入点>")[0].trim(),
            aiConfig,
            globalConfig,
        );
        if (cleanMainPrompt) {
            promptParts.push({
                label: "主提示词",
                content: cleanMainPrompt,
                source: "main",
            });
        }

        // 添加注入的各个部分（世界书、上下文等）
        if (prompt.injectionParts && prompt.injectionParts.length > 0) {
            promptParts.push(...prompt.injectionParts);
        }

        // 添加辅助提示词（替换变量）
        if (prompt.auxiliaryPrompt && prompt.auxiliaryPrompt.trim()) {
            const processedAuxiliary = replacePromptVariables(
                prompt.auxiliaryPrompt,
                aiConfig,
                globalConfig,
            );
            promptParts.push({
                label: "辅助提示词",
                content: processedAuxiliary,
                source: "auxiliary",
            });
        }

        // 添加用户消息
        promptParts.push({
            label: SOURCE_LABELS.user || "用户消息",
            content: finalUserMessage,
            source: "user",
        });

        // 根据流程配置对 promptParts 重新排序（使用与实际发送相同的顺序）
        const sortedPromptParts = sortPromptPartsByFlowConfig(promptParts, "记忆世界书");

        return {
            category: category,
            source: category,
            model: aiConfig.model || "未指定模型",
            promptParts: sortedPromptParts,
            prompt: `${finalSystemPrompt}\n\n${finalUserMessage}`,
            aiConfig: {
                apiFormat: aiConfig.apiFormat,
                apiUrl: aiConfig.apiUrl,
                apiKey: aiConfig.apiKey,
                model: aiConfig.model,
                maxTokens: aiConfig.maxTokens,
                temperature: aiConfig.temperature,
                responsePath: aiConfig.responsePath,
            },
            taskType: "memory",
            detailKeys: data.details
                ? data.details
                      .map((d) => d.key || d.keywords?.[0])
                      .filter(Boolean)
                : [],
        };
    } catch (err) {
        Logger.error(`收集记忆任务 "${category}" 请求信息失败:`, err.message);
        return null;
    }
}

/**
 * 收集单个总结世界书任务的请求信息
 * @param {object} book 世界书对象
 * @param {string} userMessage 用户消息
 * @param {string} context 上下文
 * @returns {Promise<object|null>} 请求信息
 */
export async function collectSummaryRequestInfo(book, userMessage, context) {
    const aiConfig = getSummaryConfig(book.name);
    const globalConfig = getGlobalConfig();

    try {
        const summaryContent = getSummaryContent(book);

        const dataInjection = buildDataInjection({
            worldBookContent: summaryContent,
            context: context,
            userMessage: userMessage,
        });

        // 使用历史事件回忆提示词模板
        const template = await getHistoricalPromptTemplate();

        // 获取破限词前缀
        const jailbreakPrefix = getJailbreakPrefix();

        // 使用与 processor.js 相同的方式构建提示词（包含流程配置顺序）
        const prompt = injectDataToPrompt(template, dataInjection, {
            flowType: "总结世界书",
            jailbreakPrefix: jailbreakPrefix,
        });

        // 替换变量得到最终系统提示词
        const finalSystemPrompt = replacePromptVariables(
            prompt.systemPrompt,
            aiConfig,
            globalConfig,
        );

        // 构建用户提示词
        const finalUserMessage = buildUserPrompt(userMessage);

        // 构建详细的 prompt 部分列表（用于预览显示）
        const promptParts = [];

        // 添加破限词
        if (jailbreakPrefix && jailbreakPrefix.trim()) {
            promptParts.push({
                label: "破限词",
                content: jailbreakPrefix,
                source: "jailbreak",
            });
        }

        // 添加主提示词（去掉注入内容，并替换变量）
        const mainPromptWithoutInjection =
            template.mainPrompt || template.main_prompt || "";
        const cleanMainPrompt = replacePromptVariables(
            mainPromptWithoutInjection.split("<数据注入点>")[0].trim(),
            aiConfig,
            globalConfig,
        );
        if (cleanMainPrompt) {
            promptParts.push({
                label: "主提示词",
                content: cleanMainPrompt,
                source: "main",
            });
        }

        // 添加注入的各个部分
        if (prompt.injectionParts && prompt.injectionParts.length > 0) {
            promptParts.push(...prompt.injectionParts);
        }

        // 添加辅助提示词（替换变量）
        if (prompt.auxiliaryPrompt && prompt.auxiliaryPrompt.trim()) {
            const processedAuxiliary = replacePromptVariables(
                prompt.auxiliaryPrompt,
                aiConfig,
                globalConfig,
            );
            promptParts.push({
                label: "辅助提示词",
                content: processedAuxiliary,
                source: "auxiliary",
            });
        }

        // 添加用户消息
        promptParts.push({
            label: SOURCE_LABELS.user || "用户消息",
            content: finalUserMessage,
            source: "user",
        });

        // 根据流程配置对 promptParts 重新排序（使用与实际发送相同的顺序）
        const sortedPromptParts = sortPromptPartsByFlowConfig(promptParts, "总结世界书");

        return {
            category: book.name,
            source: book.name,
            model: aiConfig.model || "未指定模型",
            promptParts: sortedPromptParts,
            prompt: `${finalSystemPrompt}\n\n${finalUserMessage}`,
            aiConfig: {
                apiFormat: aiConfig.apiFormat,
                apiUrl: aiConfig.apiUrl,
                apiKey: aiConfig.apiKey,
                model: aiConfig.model,
                maxTokens: aiConfig.maxTokens,
                temperature: aiConfig.temperature,
                responsePath: aiConfig.responsePath,
            },
            taskType: "summary",
            bookName: book.name,
        };
    } catch (err) {
        Logger.error(
            `收集总结任务 "${book.name}" 请求信息失败:`,
            err.message,
        );
        return null;
    }
}

/**
 * 收集单个总结世界书Part的请求信息
 * @param {object} book 世界书对象
 * @param {object} part Part信息 { id, index, startFloor, endFloor, content, charCount }
 * @param {string} userMessage 用户消息
 * @param {string} context 上下文
 * @returns {Promise<object|null>} 请求信息
 */
export async function collectSummaryPartRequestInfo(book, part, userMessage, context) {
    // Part 1（index=0）复用原总结世界书的 API 配置，其他 Part 使用各自的配置
    let aiConfig;
    if (part.index === 0) {
        aiConfig = getSummaryConfig(book.name);
    } else {
        aiConfig = getSummaryPartApiConfig(book.name, part.id);
    }

    if (!aiConfig || !aiConfig.enabled) {
        return null;
    }

    const globalConfig = getGlobalConfig();

    try {
        // Part 的内容带有标记
        const partNumber = part.index + 1;
        const partContent = `=== Part ${partNumber} (${part.startFloor}-${part.endFloor}楼) ===\n${part.content}`;

        const dataInjection = buildDataInjection({
            worldBookContent: partContent,
            context: context,
            userMessage: userMessage,
        });

        // 使用历史事件回忆提示词模板
        const template = await getHistoricalPromptTemplate();

        // 获取破限词前缀
        const jailbreakPrefix = getJailbreakPrefix();

        // 使用与 processor.js 相同的方式构建提示词
        const prompt = injectDataToPrompt(template, dataInjection, {
            flowType: "总结世界书",
            jailbreakPrefix: jailbreakPrefix,
        });

        // 替换变量得到最终系统提示词
        const finalSystemPrompt = replacePromptVariables(
            prompt.systemPrompt,
            aiConfig,
            globalConfig,
        );

        // 构建用户提示词
        const finalUserMessage = buildUserPrompt(userMessage);

        // 构建详细的 prompt 部分列表
        const promptParts = [];

        if (jailbreakPrefix && jailbreakPrefix.trim()) {
            promptParts.push({
                label: "破限词",
                content: jailbreakPrefix,
                source: "jailbreak",
            });
        }

        const mainPromptWithoutInjection = template.mainPrompt || template.main_prompt || "";
        const cleanMainPrompt = replacePromptVariables(
            mainPromptWithoutInjection.split("<数据注入点>")[0].trim(),
            aiConfig,
            globalConfig,
        );
        if (cleanMainPrompt) {
            promptParts.push({
                label: "主提示词",
                content: cleanMainPrompt,
                source: "main",
            });
        }

        if (prompt.injectionParts && prompt.injectionParts.length > 0) {
            promptParts.push(...prompt.injectionParts);
        }

        if (prompt.auxiliaryPrompt && prompt.auxiliaryPrompt.trim()) {
            const processedAuxiliary = replacePromptVariables(
                prompt.auxiliaryPrompt,
                aiConfig,
                globalConfig,
            );
            promptParts.push({
                label: "辅助提示词",
                content: processedAuxiliary,
                source: "auxiliary",
            });
        }

        promptParts.push({
            label: SOURCE_LABELS.user || "用户消息",
            content: finalUserMessage,
            source: "user",
        });

        const sortedPromptParts = sortPromptPartsByFlowConfig(promptParts, "总结世界书");

        return {
            category: `${book.name} - Part ${partNumber} (${part.startFloor}-${part.endFloor}楼)`,
            source: `${book.name}_part_${part.id}`,
            model: aiConfig.model || "未指定模型",
            promptParts: sortedPromptParts,
            prompt: `${finalSystemPrompt}\n\n${finalUserMessage}`,
            aiConfig: {
                apiFormat: aiConfig.apiFormat,
                apiUrl: aiConfig.apiUrl,
                apiKey: aiConfig.apiKey,
                model: aiConfig.model,
                maxTokens: aiConfig.maxTokens,
                temperature: aiConfig.temperature,
                responsePath: aiConfig.responsePath,
            },
            taskType: "summary_part",
            bookName: book.name,
            partId: part.id,
            startFloor: part.startFloor,
            endFloor: part.endFloor,
        };
    } catch (err) {
        Logger.error(
            `收集总结任务 "${book.name}" Part ${part.index + 1} 请求信息失败:`,
            err.message,
        );
        return null;
    }
}

/**
 * 收集索引合并任务的请求信息
 * @param {string} mergedContent 合并后的索引内容
 * @param {string} userMessage 用户消息
 * @param {string} context 上下文
 * @param {Array} detailKeys 详情键列表
 * @returns {Promise<object|null>} 请求信息
 */
export async function collectIndexMergeRequestInfo(
    mergedContent,
    userMessage,
    context,
    detailKeys,
) {
    const globalSettings = getGlobalSettings();
    const indexMergeConfig = globalSettings.indexMergeConfig || {};
    const globalConfig = getGlobalConfig();

    try {
        const dataInjection = buildDataInjection({
            worldBookContent: mergedContent,
            context: context,
            userMessage: userMessage,
        });

        const template = await getPromptTemplate();

        // 获取破限词前缀
        const jailbreakPrefix = getJailbreakPrefix();

        // 使用与 processor.js 相同的方式构建提示词（包含流程配置顺序）
        const prompt = injectDataToPrompt(template, dataInjection, {
            flowType: "索引合并",
            jailbreakPrefix: jailbreakPrefix,
        });

        // 替换变量得到最终系统提示词
        const finalSystemPrompt = replacePromptVariables(
            prompt.systemPrompt,
            indexMergeConfig,
            globalConfig,
        );

        // 构建用户提示词
        const finalUserMessage = buildUserPrompt(userMessage);

        // 构建详细的 prompt 部分列表（用于预览显示）
        const promptParts = [];

        // 添加破限词
        if (jailbreakPrefix && jailbreakPrefix.trim()) {
            promptParts.push({
                label: "破限词",
                content: jailbreakPrefix,
                source: "jailbreak",
            });
        }

        // 添加主提示词（去掉注入内容，并替换变量）
        const mainPromptWithoutInjection =
            template.mainPrompt || template.main_prompt || "";
        const cleanMainPrompt = replacePromptVariables(
            mainPromptWithoutInjection.split("<数据注入点>")[0].trim(),
            indexMergeConfig,
            globalConfig,
        );
        if (cleanMainPrompt) {
            promptParts.push({
                label: "主提示词",
                content: cleanMainPrompt,
                source: "main",
            });
        }

        // 添加注入的各个部分
        if (prompt.injectionParts && prompt.injectionParts.length > 0) {
            promptParts.push(...prompt.injectionParts);
        }

        // 添加辅助提示词（替换变量）
        if (prompt.auxiliaryPrompt && prompt.auxiliaryPrompt.trim()) {
            const processedAuxiliary = replacePromptVariables(
                prompt.auxiliaryPrompt,
                indexMergeConfig,
                globalConfig,
            );
            promptParts.push({
                label: "辅助提示词",
                content: processedAuxiliary,
                source: "auxiliary",
            });
        }

        // 添加用户消息
        promptParts.push({
            label: SOURCE_LABELS.user || "用户消息",
            content: finalUserMessage,
            source: "user",
        });

        // 根据流程配置对 promptParts 重新排序
        const sortedPromptParts = sortPromptPartsByFlowConfig(promptParts, "索引合并");

        return {
            category: "索引合并",
            source: "索引合并",
            model: indexMergeConfig.model || "未指定模型",
            promptParts: sortedPromptParts,
            prompt: `${finalSystemPrompt}\n\n${finalUserMessage}`,
            aiConfig: {
                apiFormat: indexMergeConfig.apiFormat,
                apiUrl: indexMergeConfig.apiUrl,
                apiKey: indexMergeConfig.apiKey,
                model: indexMergeConfig.model,
                maxTokens: indexMergeConfig.maxTokens,
                temperature: indexMergeConfig.temperature,
                responsePath: indexMergeConfig.responsePath,
            },
            taskType: "merge",
            detailKeys: detailKeys || [],
        };
    } catch (err) {
        Logger.error("收集索引合并请求信息失败:", err.message);
        return null;
    }
}

/**
 * 收集所有任务的请求信息
 * @param {Array} memoryBooks 记忆世界书列表
 * @param {Array} summaryBooks 总结世界书列表
 * @param {string} userMessage 用户消息
 * @param {string} context 上下文
 * @param {boolean} useIndexMerge 是否使用索引合并模式
 * @param {object} mergedIndexData 合并的索引数据（仅索引合并模式使用）
 * @returns {Promise<Array>} 请求信息列表
 */
export async function collectAllRequestInfos(
    memoryBooks,
    summaryBooks,
    userMessage,
    context,
    useIndexMerge = false,
    mergedIndexData = null,
) {
    const requestInfos = [];

    if (useIndexMerge && mergedIndexData && mergedIndexData.content) {
        // 索引合并模式
        const indexMergeInfo = await collectIndexMergeRequestInfo(
            mergedIndexData.content,
            userMessage,
            context,
            mergedIndexData.detailKeys,
        );
        if (indexMergeInfo) {
            requestInfos.push(indexMergeInfo);
        }
    } else {
        // 原有并发模式 - 为每个记忆分类收集请求信息
        for (const { book, categories } of memoryBooks) {
            for (const [category, data] of Object.entries(categories)) {
                const aiConfig = getMemoryConfig(category);
                if (!aiConfig.enabled) {
                    Logger.debug(`分类 "${category}" 已禁用，跳过预览`);
                    continue;
                }

                const memoryInfo = await collectMemoryRequestInfo(
                    category,
                    data,
                    userMessage,
                    context,
                );
                if (memoryInfo) {
                    requestInfos.push(memoryInfo);
                }
            }
        }
    }

    // 为每个总结世界书收集请求信息
    for (const book of summaryBooks) {
        const aiConfig = getSummaryConfig(book.name);
        if (!aiConfig.enabled) {
            Logger.debug(`总结世界书 "${book.name}" 已禁用，跳过预览`);
            continue;
        }

        // 检查是否启用拆分
        if (isSummaryAutoSplitEnabled()) {
            const summaryContent = getSummaryContent(book);
            const splitConfig = getSummaryAutoSplitConfig();
            const parts = analyzeSummaryContent(summaryContent, splitConfig);

            if (parts.length > 1) {
                // 拆分模式：为每个Part收集请求信息
                for (const part of parts) {
                    const partInfo = await collectSummaryPartRequestInfo(
                        book,
                        part,
                        userMessage,
                        context,
                    );
                    if (partInfo) {
                        requestInfos.push(partInfo);
                    }
                }
                continue; // 跳过整本书的收集
            }
        }

        // 未启用拆分或内容不足以拆分：收集整本书的请求信息
        const summaryInfo = await collectSummaryRequestInfo(
            book,
            userMessage,
            context,
        );
        if (summaryInfo) {
            requestInfos.push(summaryInfo);
        }
    }

    return requestInfos;
}
