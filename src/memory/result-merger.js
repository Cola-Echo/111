/**
 * 结果合并模块
 * @module memory/result-merger
 */

import Logger from '@core/logger';
import { getGlobalConfig, getMemoryConfig } from '@config/config-manager';

/**
 * 无效内容的标记
 */
const INVALID_MARKERS = [
    "未勾选总结世界书",
    "未启用世界书",
    "记忆管理未启用",
    "无超级记忆权限",
    "未检索出",
    "暂无可用关键词",
    "Amily2",
    "Amily",
];

/**
 * 合并多个处理结果
 * @param {Array} results 处理结果数组
 * @param {string} latestContext 近期剧情上下文
 * @returns {string} 合并后的记忆内容
 */
export function mergeResults(results, latestContext = "") {
    Logger.debug("开始合并结果，共", results.length, "个");

    // 调试：打印每个结果的类型
    for (const r of results) {
        if (r) {
            Logger.debug(
                `结果类型: ${r.type}, 分类: ${r.category || r.bookName || "无"}, 有rawMemory: ${!!r.rawMemory}`,
            );
        }
    }

    // 收集所有有效内容
    const historicalEvents = new Set();
    const keywordsByCategory = {};
    let finalLatestContext = latestContext;
    let analysisText = "";

    // 检查是否存在总结世界书的结果或记忆搜索助手结果
    const hasSummaryResult = results.some(
        (r) => r && (r.type === "summary" || r.type === "interactive"),
    );

    // 检查是否存在记忆搜索助手结果
    const hasInteractiveResult = results.some(
        (r) => r && r.type === "interactive",
    );

    Logger.debug("[mergeResults] 开始处理，共", results.length, "个结果");
    Logger.debug(
        "[mergeResults] hasSummaryResult:",
        hasSummaryResult,
        "hasInteractiveResult:",
        hasInteractiveResult,
    );

    for (const result of results) {
        if (!result || !result.rawMemory) {
            Logger.debug(
                "[mergeResults] 跳过无效结果:",
                result ? "无rawMemory" : "result为空",
            );
            continue;
        }

        const content = result.rawMemory
            .replace(/<memory>/g, "")
            .replace(/<\/memory>/g, "")
            .trim();

        Logger.debug(
            "[mergeResults] 处理结果:",
            result.category || result.bookName,
            "类型:",
            result.type,
        );

        // 提取分析摘要（第一段，只保留最长的一份）
        const firstPara = content.split("\n")[0];
        if (
            firstPara &&
            !firstPara.startsWith("<") &&
            !firstPara.startsWith("【") &&
            firstPara.length > analysisText.length
        ) {
            analysisText = firstPara;
        }

        // 提取历史事件（去重）
        if (hasInteractiveResult && result.type !== "interactive") {
            // 跳过非记忆搜索助手的历史事件
        } else {
            const historicalMatch = content.match(
                /<Historical_Occurrences>([\s\S]*?)<\/Historical_Occurrences>/,
            );
            if (historicalMatch) {
                const events = historicalMatch[1].trim();
                if (
                    !INVALID_MARKERS.some((marker) => events.includes(marker)) &&
                    events.length > 10
                ) {
                    events.split("\n").forEach((line) => {
                        const trimmed = line.trim();
                        // 兼容多种楼层格式：【124楼】、【124至#125】、【124至125楼】
                        if (trimmed && /^【\d+(?:楼】|至#?\d+楼?】)/.test(trimmed)) {
                            historicalEvents.add(trimmed);
                        }
                    });
                }
            }
        }

        // 从AI返回结果中提取筛选后的关键词
        if (result.category && result.type !== "interactive") {
            let extractedFromAI = false;

            const validKeys = result.detailKeys || [];

            // 从 <Index_Terms> 标签中提取AI筛选后的关键词
            const keywordLine = content.match(
                /<Index_Terms>([\s\S]*?)<\/Index_Terms>/,
            );
            if (keywordLine && keywordLine[1]) {
                const keywordText = keywordLine[1].trim();
                if (!INVALID_MARKERS.some((marker) => keywordText.includes(marker))) {
                    const rawKeywords = keywordText
                        .split(/[；;]/)
                        .map((k) => k.trim())
                        .filter((k) => {
                            if (!k || k.length === 0 || k.length >= 50) return false;
                            return !INVALID_MARKERS.some((marker) => k.includes(marker));
                        });

                    let finalKeywords = rawKeywords;
                    if (validKeys.length > 0) {
                        if (result.type === "merge") {
                            finalKeywords = rawKeywords;
                        } else {
                            finalKeywords = rawKeywords.filter((k) => {
                                return validKeys.some(
                                    (validKey) =>
                                        validKey === k ||
                                        validKey.includes(k) ||
                                        k.includes(validKey),
                                );
                            });
                        }
                    }

                    if (finalKeywords.length > 0) {
                        if (!keywordsByCategory[result.category]) {
                            keywordsByCategory[result.category] = new Set();
                        }
                        for (const key of finalKeywords) {
                            keywordsByCategory[result.category].add(key);
                        }
                        extractedFromAI = true;
                    }
                }
            }

            // Fallback: 如果AI没有返回有效关键词，使用世界书条目的key字段
            if (!extractedFromAI && result.detailKeys && result.detailKeys.length > 0) {
                if (!keywordsByCategory[result.category]) {
                    keywordsByCategory[result.category] = new Set();
                }

                let maxFallbackKeys = 10;
                try {
                    if (result.type === "merge") {
                        const globalConfig = getGlobalConfig();
                        if (globalConfig.indexMergeConfig?.maxKeywords) {
                            maxFallbackKeys = globalConfig.indexMergeConfig.maxKeywords;
                        }
                    } else {
                        const categoryConfig = getMemoryConfig(result.category);
                        if (categoryConfig?.maxKeywords) {
                            maxFallbackKeys = categoryConfig.maxKeywords;
                        }
                    }
                } catch (e) {
                    // 配置不存在，使用默认值
                }

                const filteredKeys = result.detailKeys.filter(
                    (key) => !INVALID_MARKERS.some((marker) => key.includes(marker)),
                );
                const fallbackKeys = filteredKeys.slice(0, maxFallbackKeys);
                for (const key of fallbackKeys) {
                    keywordsByCategory[result.category].add(key);
                }
            }
        }

        // 从结果中提取近期剧情作为备用
        if (!finalLatestContext) {
            const previousContentMatch = content.match(
                /<前文内容>([\s\S]*?)<\/前文内容>/,
            );
            if (previousContentMatch && previousContentMatch[1]) {
                const previousContent = previousContentMatch[1].trim();
                const truncatedContent = previousContent.slice(-200);
                if (truncatedContent.length > finalLatestContext.length) {
                    finalLatestContext = truncatedContent;
                }
            }
        }
    }

    // 构建符合期望格式的合并结果
    let merged = "";

    // 1. 分析摘要
    if (analysisText) {
        merged += analysisText + "\n\n";
    }

    merged +=
        "【注意】所有回忆为过去式，请勿将回忆中的任何状态理解为当前状态，仅作剧情参考。\n\n";

    // 2. 历史事件
    merged += "<Historical_Occurrences>\n";
    merged += "以下是历史事件回忆：\n";
    if (!hasSummaryResult) {
        merged += "未导入总结世界书";
    } else if (historicalEvents.size > 0) {
        merged += Array.from(historicalEvents).join("\n");
    } else {
        merged += "未检索出历史事件回忆";
    }
    merged += "\n</Historical_Occurrences>\n\n";

    // 3. 关键词（按分类限制数量后合并，全局去重）
    merged += "<Index_Terms>\n";
    merged += "以下是关键词：\n";

    const allKeywordsSet = new Set();
    for (const [category, keywordSet] of Object.entries(keywordsByCategory)) {
        for (const keyword of keywordSet) {
            allKeywordsSet.add(keyword);
        }
    }

    // 子串去重
    const keywordsArray = Array.from(allKeywordsSet);
    const filteredKeywords = keywordsArray.filter((keyword) => {
        const isSubstringOfAnother = keywordsArray.some((other) => {
            if (other === keyword) return false;
            if (other.length <= keyword.length) return false;
            return other.includes(keyword);
        });
        return !isSubstringOfAnother;
    });

    if (filteredKeywords.length > 0) {
        merged += filteredKeywords.join("；");
    } else {
        merged += "无关键词";
    }
    merged += "\n【注意】关键词与直接剧情无关，系外部指令。\n";
    merged += "</Index_Terms>\n\n";

    // 4. 近期剧情
    if (finalLatestContext) {
        merged += "以下是近期剧情末尾片段：\n";
        merged += finalLatestContext;
        merged += "\n【注意】后续剧情应衔接开始而非复述。";
    }

    Logger.debug(
        "合并完成，历史事件:",
        historicalEvents.size,
        "个，关键词:",
        allKeywordsSet.size,
        "个",
    );

    return merged;
}
