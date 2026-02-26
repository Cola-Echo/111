/**
 * 总结世界书拆分模块
 * 自动检测并拆分大型总结世界书内容
 * @module worldbook/summary-splitter
 */

import Logger from "@core/logger";

/**
 * 默认拆分选项
 */
const DEFAULT_SPLIT_OPTIONS = {
    targetChars: 50000,  // 目标拆分字符数
    minChars: 40000,     // 最小字符数
    maxChars: 60000,     // 最大字符数
};

/**
 * 段落信息结构
 * @typedef {Object} Segment
 * @property {number} startFloor - 起始楼层
 * @property {number} endFloor - 结束楼层
 * @property {string} content - 段落内容
 * @property {number} charCount - 字符数
 */

/**
 * Part信息结构
 * @typedef {Object} Part
 * @property {string} id - Part ID（基于楼层范围）
 * @property {number} index - Part索引（从0开始）
 * @property {number} startFloor - 起始楼层
 * @property {number} endFloor - 结束楼层
 * @property {number} charCount - 字符数
 * @property {Array<Segment>} segments - 包含的段落
 * @property {string} content - Part完整内容
 */

/**
 * 解析总结世界书内容中的段落
 * 识别格式：【X楼至Y楼详细总结记录】开头，以<task completed>或本条勿动结尾
 * @param {string} content 总结世界书完整内容
 * @returns {Array<Segment>} 段落数组
 */
export function parseSegments(content) {
    if (!content || typeof content !== 'string') {
        Logger.debug("[SummarySplitter] 内容为空");
        return [];
    }

    const segments = [];

    // 匹配段落的正则表达式
    // 格式：【X楼至Y楼详细总结记录】...内容...<task completed>X-Y</task completed>
    // 或者：【X楼至Y楼详细总结记录】...内容...本条勿动【前X楼总结已完成】
    const segmentRegex = /【(\d+)楼至(\d+)楼[^\n]*详细总结记录】([\s\S]*?)(?:<task completed>[\d-]+<\/task completed>|本条勿动【[^\]]+】)/g;

    let match;
    while ((match = segmentRegex.exec(content)) !== null) {
        const startFloor = parseInt(match[1], 10);
        const endFloor = parseInt(match[2], 10);
        const segmentContent = match[0];

        segments.push({
            startFloor,
            endFloor,
            content: segmentContent,
            charCount: segmentContent.length,
        });
    }

    // 如果正则没有匹配到，尝试备用方案：按 --- 分隔符拆分
    if (segments.length === 0) {
        Logger.debug("[SummarySplitter] 主正则未匹配，尝试备用方案");
        return parseSegmentsByDivider(content);
    }

    Logger.log(`[SummarySplitter] 解析到 ${segments.length} 个段落`);
    return segments;
}

/**
 * 备用方案：按 --- 分隔符拆分段落
 * @param {string} content 内容
 * @returns {Array<Segment>} 段落数组
 */
function parseSegmentsByDivider(content) {
    const segments = [];

    // 按 --- 分隔
    const parts = content.split(/\n---+\n/);

    // 从每个部分中提取楼层信息
    const floorRegex = /【(\d+)楼至(\d+)楼/;

    for (const part of parts) {
        const trimmedPart = part.trim();
        if (!trimmedPart) continue;

        const floorMatch = trimmedPart.match(floorRegex);
        if (floorMatch) {
            segments.push({
                startFloor: parseInt(floorMatch[1], 10),
                endFloor: parseInt(floorMatch[2], 10),
                content: trimmedPart,
                charCount: trimmedPart.length,
            });
        } else {
            // 无法识别楼层的部分，作为单独段落处理
            // 尝试从内容中推断
            segments.push({
                startFloor: 0,
                endFloor: 0,
                content: trimmedPart,
                charCount: trimmedPart.length,
            });
        }
    }

    Logger.log(`[SummarySplitter] 备用方案解析到 ${segments.length} 个段落`);
    return segments;
}

/**
 * 生成Part ID（基于楼层范围）
 * @param {number} startFloor 起始楼层
 * @param {number} endFloor 结束楼层
 * @returns {string} Part ID
 */
export function generatePartId(startFloor, endFloor) {
    return `floor_${startFloor}_${endFloor}`;
}

/**
 * 计算拆分方案
 * 使用贪心算法，尽量接近targetChars，不超过maxChars
 * @param {Array<Segment>} segments 段落数组
 * @param {Object} options 拆分选项
 * @returns {Array<Part>} Part数组
 */
export function calculateSplitPlan(segments, options = {}) {
    const { targetChars, minChars, maxChars } = { ...DEFAULT_SPLIT_OPTIONS, ...options };

    if (segments.length === 0) {
        return [];
    }

    const parts = [];
    let currentPart = {
        segments: [],
        charCount: 0,
        startFloor: 0,
        endFloor: 0,
    };

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const newCharCount = currentPart.charCount + segment.charCount;

        // 如果当前Part为空，直接添加
        if (currentPart.segments.length === 0) {
            currentPart.segments.push(segment);
            currentPart.charCount = segment.charCount;
            currentPart.startFloor = segment.startFloor;
            currentPart.endFloor = segment.endFloor;
            continue;
        }

        // 判断是否应该开始新的Part
        const shouldStartNewPart =
            // 添加后超过最大限制
            newCharCount > maxChars ||
            // 当前已达到目标且下一个段落会让它远离目标
            (currentPart.charCount >= targetChars && newCharCount > maxChars);

        if (shouldStartNewPart && currentPart.charCount >= minChars) {
            // 保存当前Part并开始新的
            parts.push(finalizePart(currentPart, parts.length));
            currentPart = {
                segments: [segment],
                charCount: segment.charCount,
                startFloor: segment.startFloor,
                endFloor: segment.endFloor,
            };
        } else {
            // 继续添加到当前Part
            currentPart.segments.push(segment);
            currentPart.charCount = newCharCount;
            currentPart.endFloor = segment.endFloor;
        }
    }

    // 处理最后一个Part
    if (currentPart.segments.length > 0) {
        parts.push(finalizePart(currentPart, parts.length));
    }

    Logger.log(`[SummarySplitter] 计算出 ${parts.length} 个Part`);
    return parts;
}

/**
 * 完成Part对象的构建
 * @param {Object} partData Part临时数据
 * @param {number} index Part索引
 * @returns {Part} 完整的Part对象
 */
function finalizePart(partData, index) {
    const content = partData.segments.map(s => s.content).join('\n\n---\n\n');

    return {
        id: generatePartId(partData.startFloor, partData.endFloor),
        index,
        startFloor: partData.startFloor,
        endFloor: partData.endFloor,
        charCount: partData.charCount,
        segments: partData.segments,
        content,
    };
}

/**
 * 分析总结世界书内容，返回拆分方案
 * @param {string} content 总结世界书完整内容
 * @param {Object} options 拆分选项
 * @returns {Array<Part>} Part数组
 */
export function analyzeSummaryContent(content, options = {}) {
    const mergedOptions = { ...DEFAULT_SPLIT_OPTIONS, ...options };

    Logger.log(`[SummarySplitter] 开始分析内容，总长度: ${content?.length || 0}`);

    // 1. 解析所有段落
    const segments = parseSegments(content);

    if (segments.length === 0) {
        Logger.warn("[SummarySplitter] 未找到可识别的段落");
        return [];
    }

    // 2. 计算总字符数
    const totalChars = segments.reduce((sum, s) => sum + s.charCount, 0);
    Logger.log(`[SummarySplitter] 总字符数: ${totalChars}, 段落数: ${segments.length}`);

    // 3. 如果总内容小于目标字符数，不需要拆分
    if (totalChars < mergedOptions.targetChars) {
        Logger.log("[SummarySplitter] 内容少于目标字符数，不需要拆分");
        // 返回单个Part
        return [{
            id: generatePartId(
                segments[0]?.startFloor || 0,
                segments[segments.length - 1]?.endFloor || 0
            ),
            index: 0,
            startFloor: segments[0]?.startFloor || 0,
            endFloor: segments[segments.length - 1]?.endFloor || 0,
            charCount: totalChars,
            segments,
            content: content,
            needsSplit: false,
        }];
    }

    // 4. 计算拆分方案
    const parts = calculateSplitPlan(segments, mergedOptions);

    // 标记需要拆分
    parts.forEach(part => {
        part.needsSplit = parts.length > 1;
    });

    return parts;
}

/**
 * 判断内容是否需要拆分
 * @param {string} content 总结世界书内容
 * @param {number} threshold 阈值（默认5万字符）
 * @returns {boolean} 是否需要拆分
 */
export function needsSplit(content, threshold = 50000) {
    if (!content) return false;
    return content.length >= threshold;
}

/**
 * 获取内容的简要统计信息
 * @param {string} content 总结世界书内容
 * @returns {Object} 统计信息
 */
export function getContentStats(content) {
    if (!content) {
        return {
            totalChars: 0,
            segmentCount: 0,
            estimatedParts: 0,
            needsSplit: false,
        };
    }

    const totalChars = content.length;
    const segments = parseSegments(content);
    const estimatedParts = Math.ceil(totalChars / DEFAULT_SPLIT_OPTIONS.targetChars);

    return {
        totalChars,
        segmentCount: segments.length,
        estimatedParts: Math.max(1, estimatedParts),
        needsSplit: totalChars >= DEFAULT_SPLIT_OPTIONS.targetChars,
    };
}

/**
 * 格式化字符数显示
 * @param {number} charCount 字符数
 * @returns {string} 格式化后的字符串
 */
export function formatCharCount(charCount) {
    if (charCount >= 10000) {
        return `${(charCount / 10000).toFixed(1)}万`;
    }
    return `${charCount}`;
}

/**
 * 匹配已保存的Part配置
 * @param {Array<Part>} newParts 新的Part列表
 * @param {Object} savedConfigs 已保存的配置 { partId: apiConfig }
 * @returns {Object} 匹配结果 { matched: [], unmatched: [] }
 */
export function matchPartConfigs(newParts, savedConfigs = {}) {
    const matched = [];
    const unmatched = [];

    for (const part of newParts) {
        const savedConfig = savedConfigs[part.id];

        if (savedConfig) {
            // 完全匹配
            matched.push({
                ...part,
                apiConfig: savedConfig,
                matchType: 'exact',
            });
        } else {
            // 尝试模糊匹配（楼层范围有重叠）
            const fuzzyMatch = findFuzzyMatch(part, savedConfigs);
            if (fuzzyMatch) {
                matched.push({
                    ...part,
                    apiConfig: fuzzyMatch.config,
                    matchType: 'fuzzy',
                    originalPartId: fuzzyMatch.partId,
                });
            } else {
                unmatched.push(part);
            }
        }
    }

    return { matched, unmatched };
}

/**
 * 模糊匹配Part配置
 * @param {Part} part Part对象
 * @param {Object} savedConfigs 已保存的配置
 * @returns {Object|null} 匹配结果
 */
function findFuzzyMatch(part, savedConfigs) {
    for (const [partId, config] of Object.entries(savedConfigs)) {
        // 解析 partId 获取楼层范围
        const match = partId.match(/^floor_(\d+)_(\d+)$/);
        if (!match) continue;

        const savedStart = parseInt(match[1], 10);
        const savedEnd = parseInt(match[2], 10);

        // 计算重叠度
        const overlapStart = Math.max(part.startFloor, savedStart);
        const overlapEnd = Math.min(part.endFloor, savedEnd);

        if (overlapStart <= overlapEnd) {
            const overlapRange = overlapEnd - overlapStart + 1;
            const partRange = part.endFloor - part.startFloor + 1;
            const savedRange = savedEnd - savedStart + 1;

            // 重叠超过80%认为匹配
            const overlapRatio = overlapRange / Math.min(partRange, savedRange);
            if (overlapRatio >= 0.8) {
                return { partId, config };
            }
        }
    }

    return null;
}

/**
 * 获取总结世界书的完整内容
 * @param {Object} book 世界书对象
 * @returns {string} 完整内容
 */
export function getSummaryBookContent(book) {
    if (!book || !book.entries) return '';

    // 按条目顺序合并内容
    const entries = Object.values(book.entries)
        .filter(e => e.disable !== true)
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    return entries.map(e => e.content || '').join('\n\n---\n\n');
}

export default {
    parseSegments,
    analyzeSummaryContent,
    calculateSplitPlan,
    needsSplit,
    getContentStats,
    formatCharCount,
    matchPartConfigs,
    generatePartId,
    getSummaryBookContent,
};
