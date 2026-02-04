/**
 * 标签过滤工具模块
 * @module utils/tag-filter
 *
 * 调用位置汇总（filterContentByRole）：
 * - src/utils/message.js: getRecentContext() - [标签过滤调用点1] 前文内容来源
 * - src/memory/processor.js: processMemoryForMessage() - [标签过滤调用点2] 最近剧情截取
 * - src/ui/components/plot-optimize.js: buildPlotOptimizePreview() - [标签过滤调用点3] 剧情优化助手预览
 * - src/ui/components/plot-optimize.js: buildMemoryContext() - [标签过滤调用点4] 剧情优化助手面板
 * - src/ui/modals/prompt-preset.js: buildMessagesFromPreset() - 预设提示词消息构建
 */

/**
 * 根据标签过滤配置过滤内容
 * @param {string} content 要过滤的内容
 * @param {object} filterConfig 过滤配置
 * @returns {string} 过滤后的内容
 */
export function filterContentByTags(content, filterConfig) {
    if (!filterConfig) {
        return content;
    }

    // 兼容旧配置格式 (mode) 和新配置格式 (enableExtract/enableExclude)
    let enableExtract = filterConfig.enableExtract;
    let enableExclude = filterConfig.enableExclude;

    // 兼容旧的 mode 字段
    if (filterConfig.mode !== undefined) {
        if (filterConfig.mode === "extract") {
            enableExtract = true;
            enableExclude = false;
        } else if (filterConfig.mode === "exclude") {
            enableExtract = false;
            enableExclude = true;
        } else if (filterConfig.mode === "off") {
            enableExtract = false;
            enableExclude = false;
        }
    }

    // 如果两个模式都未启用，直接返回原内容
    if (!enableExtract && !enableExclude) {
        return content;
    }

    const { excludeTags, extractTags, caseSensitive } = filterConfig;
    const flags = caseSensitive ? "gs" : "gis";

    // 先执行提取模式（如果启用）
    if (enableExtract && extractTags && extractTags.length > 0) {
        const extracted = [];
        for (const tag of extractTags) {
            const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(
                `<${escapedTag}>([\\s\\S]*?)<\\/${escapedTag}>`,
                flags
            );
            const matches = content.matchAll(regex);
            for (const match of matches) {
                const innerContent = match[1].trim();
                if (innerContent) {
                    extracted.push(innerContent);
                }
            }
        }
        content = extracted.join("\n\n");
    }

    // 再执行排除模式（如果启用）
    if (enableExclude && excludeTags && excludeTags.length > 0) {
        for (const tag of excludeTags) {
            let regex;
            // 特殊处理 HTML 注释 <!-- -->
            if (tag === "!--") {
                regex = new RegExp(`<!--[\\s\\S]*?-->`, flags);
            } else {
                const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                regex = new RegExp(
                    `<${escapedTag}>[\\s\\S]*?<\\/${escapedTag}>`,
                    flags
                );
            }
            content = content.replace(regex, "");
        }
    }

    return content.trim();
}

/**
 * 根据消息类型过滤内容（新版分类过滤）
 * @param {string} content 要过滤的内容
 * @param {object} tagFilterConfig 完整的标签过滤配置（包含 user 和 ai 子配置）
 * @param {boolean} isUserMessage 是否是用户消息
 * @returns {string} 过滤后的内容
 */
export function filterContentByRole(content, tagFilterConfig, isUserMessage) {
    if (!tagFilterConfig || !content) {
        return content;
    }

    // 检测是否为新版分类配置（包含 user 和 ai 子对象）
    const isNewFormat = tagFilterConfig.user && tagFilterConfig.ai;

    if (isNewFormat) {
        // 新版分类配置
        const roleConfig = isUserMessage ? tagFilterConfig.user : tagFilterConfig.ai;
        if (!roleConfig) {
            return content;
        }

        // 构建过滤配置
        const filterConfig = {
            enableExtract: roleConfig.enableExtract,
            enableExclude: roleConfig.enableExclude,
            extractTags: roleConfig.extractTags || [],
            excludeTags: roleConfig.excludeTags || [],
            caseSensitive: tagFilterConfig.caseSensitive || false,
        };

        return filterContentByTags(content, filterConfig);
    } else {
        // 旧版配置 - 兼容处理
        // 用户消息：只应用排除过滤，不应用提取过滤，默认移除 Plot_progression
        // AI消息：应用完整的标签过滤（提取+排除）
        if (isUserMessage) {
            // 用户消息只应用排除过滤
            if (tagFilterConfig.enableExclude && tagFilterConfig.excludeTags?.length > 0) {
                const excludeOnlyConfig = {
                    ...tagFilterConfig,
                    enableExtract: false,
                };
                return filterContentByTags(content, excludeOnlyConfig);
            }
            // 默认移除 Plot_progression（用户消息）
            return content
                .replace(/<Plot_progression>[\s\S]*?<\/Plot_progression>/gi, "")
                .trim();
        } else {
            // AI消息应用完整的标签过滤
            if (tagFilterConfig.enableExtract || tagFilterConfig.enableExclude) {
                return filterContentByTags(content, tagFilterConfig);
            }
            // AI消息默认不做任何处理
            return content;
        }
    }
}

/**
 * 检查是否有任何过滤规则启用
 * @param {object} tagFilterConfig 标签过滤配置
 * @returns {boolean} 是否有启用的过滤规则
 */
export function hasActiveFilters(tagFilterConfig) {
    if (!tagFilterConfig) return false;

    // 新版分类配置
    if (tagFilterConfig.user && tagFilterConfig.ai) {
        const userActive = tagFilterConfig.user.enableExtract || tagFilterConfig.user.enableExclude;
        const aiActive = tagFilterConfig.ai.enableExtract || tagFilterConfig.ai.enableExclude;
        return userActive || aiActive;
    }

    // 旧版配置
    return tagFilterConfig.enableExtract || tagFilterConfig.enableExclude;
}

/**
 * 移除指定标签
 * @param {string} content 内容
 * @param {string} tagName 标签名
 * @param {boolean} caseSensitive 是否区分大小写
 * @returns {string} 移除标签后的内容
 */
export function removeTag(content, tagName, caseSensitive = false) {
    const flags = caseSensitive ? "gs" : "gis";
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`<${escapedTag}>[\\s\\S]*?<\\/${escapedTag}>`, flags);
    return content.replace(regex, "").trim();
}

/**
 * 提取指定标签内容
 * @param {string} content 内容
 * @param {string} tagName 标签名
 * @param {boolean} caseSensitive 是否区分大小写
 * @returns {Array<string>} 提取的内容数组
 */
export function extractTagContents(content, tagName, caseSensitive = false) {
    const flags = caseSensitive ? "gs" : "gis";
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`<${escapedTag}>([\\s\\S]*?)<\\/${escapedTag}>`, flags);
    const matches = content.matchAll(regex);
    const results = [];
    for (const match of matches) {
        const innerContent = match[1].trim();
        if (innerContent) {
            results.push(innerContent);
        }
    }
    return results;
}
