/**
 * 标签过滤模块
 * @module ui/components/tag-filter
 *
 * 从原版 index.js 迁移，支持分类过滤（用户消息/AI消息）
 */

import Logger from '@core/logger';
import { getGlobalSettings, updateGlobalSettings } from '@config/config-manager';

/**
 * 当前选中的角色类型 ('ai' 或 'user')
 */
let currentRole = 'ai';

/**
 * 初始化标签过滤 UI
 * @param {Object} tagFilterConfig - 标签过滤配置
 */
export function initTagFilterUI(tagFilterConfig) {
    // 兼容旧配置格式，转换为新格式
    const config = migrateConfig(tagFilterConfig);

    // 设置区分大小写
    const caseSensitiveEl = document.getElementById("mm-tag-case-sensitive");
    if (caseSensitiveEl) {
        caseSensitiveEl.checked = config.caseSensitive === true;
    }

    // 初始化 AI 消息配置
    initRoleConfig('ai', config.ai);

    // 初始化 用户消息配置
    initRoleConfig('user', config.user);

    // 更新徽章
    updateTagFilterBadge(config);

    // 绑定标签页切换事件
    bindTabSwitchEvents();

    // 默认显示 AI 标签页
    switchToTab('ai');
}

/**
 * 迁移旧配置格式到新格式
 * @param {Object} oldConfig - 旧配置
 * @returns {Object} 新配置
 */
function migrateConfig(oldConfig) {
    if (!oldConfig) {
        return {
            user: {
                enableExtract: false,
                enableExclude: false,
                excludeTags: ["Plot_progression"],
                extractTags: [],
            },
            ai: {
                enableExtract: false,
                enableExclude: false,
                excludeTags: [],
                extractTags: [],
            },
            caseSensitive: false,
        };
    }

    // 检测是否为新格式（包含 user 和 ai 子对象）
    if (oldConfig.user && oldConfig.ai) {
        return oldConfig;
    }

    // 旧格式迁移：将旧配置应用到 AI 消息，用户消息使用默认配置
    return {
        user: {
            enableExtract: false,
            enableExclude: false,
            excludeTags: ["Plot_progression"],
            extractTags: [],
        },
        ai: {
            enableExtract: oldConfig.enableExtract || false,
            enableExclude: oldConfig.enableExclude || false,
            excludeTags: oldConfig.excludeTags || [],
            extractTags: oldConfig.extractTags || [],
        },
        caseSensitive: oldConfig.caseSensitive || false,
    };
}

/**
 * 初始化指定角色的配置
 * @param {string} role - 'ai' 或 'user'
 * @param {Object} roleConfig - 角色配置
 */
function initRoleConfig(role, roleConfig) {
    const config = roleConfig || {
        enableExtract: false,
        enableExclude: false,
        excludeTags: [],
        extractTags: [],
    };

    // 设置提取模式复选框
    const enableExtractEl = document.getElementById(`mm-${role}-enable-extract`);
    if (enableExtractEl) {
        enableExtractEl.checked = config.enableExtract === true;
    }

    // 设置排除模式复选框
    const enableExcludeEl = document.getElementById(`mm-${role}-enable-exclude`);
    if (enableExcludeEl) {
        enableExcludeEl.checked = config.enableExclude === true;
    }

    // 渲染标签列表
    renderExtractTagList(role, config.extractTags || []);
    renderExcludeTagList(role, config.excludeTags || []);
}

/**
 * 绑定标签页切换事件
 */
function bindTabSwitchEvents() {
    const tabs = document.querySelectorAll('.mm-tag-filter-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetRole = tab.dataset.tab;
            switchToTab(targetRole);
        });
    });
}

/**
 * 切换到指定标签页
 * @param {string} role - 'ai' 或 'user'
 */
function switchToTab(role) {
    currentRole = role;

    // 更新标签页激活状态
    const tabs = document.querySelectorAll('.mm-tag-filter-tab');
    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === role);
    });

    // 更新面板显示
    const panels = document.querySelectorAll('.mm-tag-filter-panel');
    panels.forEach(panel => {
        const panelRole = panel.id.replace('mm-tag-filter-', '');
        panel.classList.toggle('active', panelRole === role);
    });
}

/**
 * 更新标签过滤徽章
 * @param {Object} config - 完整配置
 */
export function updateTagFilterBadge(config) {
    const badge = document.getElementById("mm-tag-filter-badge");
    if (!badge) return;

    // 检测是否为新格式
    if (config && config.user && config.ai) {
        const userActive = config.user.enableExtract || config.user.enableExclude;
        const aiActive = config.ai.enableExtract || config.ai.enableExclude;

        if (userActive && aiActive) {
            badge.textContent = "双启用";
            badge.classList.add("active");
        } else if (aiActive) {
            badge.textContent = "AI启用";
            badge.classList.add("active");
        } else if (userActive) {
            badge.textContent = "用户启用";
            badge.classList.add("active");
        } else {
            badge.textContent = "关闭";
            badge.classList.remove("active");
        }
    } else {
        // 兼容旧格式
        const enableExtract = config?.enableExtract;
        const enableExclude = config?.enableExclude;

        if (enableExtract && enableExclude) {
            badge.textContent = "提取+排除";
            badge.classList.add("active");
        } else if (enableExtract) {
            badge.textContent = "提取模式";
            badge.classList.add("active");
        } else if (enableExclude) {
            badge.textContent = "排除模式";
            badge.classList.add("active");
        } else {
            badge.textContent = "关闭";
            badge.classList.remove("active");
        }
    }
}

/**
 * 转义 HTML，防止 XSS 攻击
 * @param {string} text - 要转义的文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 渲染提取标签列表
 * @param {string} role - 'ai' 或 'user'
 * @param {Array<string>} tags - 标签数组
 */
export function renderExtractTagList(role, tags) {
    const tagListEl = document.getElementById(`mm-${role}-extract-tag-list`);
    if (!tagListEl) return;

    tagListEl.innerHTML = (tags || [])
        .map((tag) => {
            const safeTag = escapeHtml(tag);
            return `
                <div class="mm-tag-chip" data-tag="${safeTag}" data-type="extract" data-role="${role}">
                    <span class="mm-tag-name">&lt;${safeTag}&gt;</span>
                    <span class="mm-tag-remove" data-action="remove-extract-tag" data-tag="${safeTag}" data-role="${role}">
                        <i class="fa-solid fa-times"></i>
                    </span>
                </div>
            `;
        })
        .join("");
}

/**
 * 渲染排除标签列表
 * @param {string} role - 'ai' 或 'user'
 * @param {Array<string>} tags - 标签数组
 */
export function renderExcludeTagList(role, tags) {
    const tagListEl = document.getElementById(`mm-${role}-exclude-tag-list`);
    if (!tagListEl) return;

    tagListEl.innerHTML = (tags || [])
        .map((tag) => {
            const safeTag = escapeHtml(tag);
            return `
                <div class="mm-tag-chip" data-tag="${safeTag}" data-type="exclude" data-role="${role}">
                    <span class="mm-tag-name">&lt;${safeTag}&gt;</span>
                    <span class="mm-tag-remove" data-action="remove-exclude-tag" data-tag="${safeTag}" data-role="${role}">
                        <i class="fa-solid fa-times"></i>
                    </span>
                </div>
            `;
        })
        .join("");
}

/**
 * 获取当前标签过滤配置
 * @returns {Object} 标签过滤配置
 */
export function getTagFilterConfigFromUI() {
    const caseSensitive =
        document.getElementById("mm-tag-case-sensitive")?.checked || false;

    // 获取 AI 配置
    const aiConfig = getRoleConfigFromUI('ai');

    // 获取 用户配置
    const userConfig = getRoleConfigFromUI('user');

    return {
        user: userConfig,
        ai: aiConfig,
        caseSensitive,
    };
}

/**
 * 获取指定角色的配置
 * @param {string} role - 'ai' 或 'user'
 * @returns {Object} 角色配置
 */
function getRoleConfigFromUI(role) {
    const enableExtract =
        document.getElementById(`mm-${role}-enable-extract`)?.checked || false;
    const enableExclude =
        document.getElementById(`mm-${role}-enable-exclude`)?.checked || false;

    // 从 DOM 获取提取标签列表
    const extractChips = document.querySelectorAll(
        `#mm-${role}-extract-tag-list .mm-tag-chip`
    );
    const extractTags = Array.from(extractChips).map(
        (chip) => chip.dataset.tag
    );

    // 从 DOM 获取排除标签列表
    const excludeChips = document.querySelectorAll(
        `#mm-${role}-exclude-tag-list .mm-tag-chip`
    );
    const excludeTags = Array.from(excludeChips).map(
        (chip) => chip.dataset.tag
    );

    return {
        enableExtract,
        enableExclude,
        excludeTags,
        extractTags,
    };
}

/**
 * 添加提取标签（支持逗号分隔多个标签）
 * @param {string} role - 'ai' 或 'user'
 * @param {string} tagName - 标签名称，可用逗号分隔多个
 */
export function addExtractTag(role, tagName) {
    if (!tagName || !tagName.trim()) return;

    const config = getTagFilterConfigFromUI();
    const roleConfig = config[role];
    let added = false;

    // 支持逗号分隔多个标签
    const tags = tagName.split(/[,，]/).map(t => t.trim().replace(/^<|>$/g, "")).filter(t => t);

    for (const cleanTag of tags) {
        if (!roleConfig.extractTags.includes(cleanTag)) {
            roleConfig.extractTags.push(cleanTag);
            added = true;
        }
    }

    if (added) {
        renderExtractTagList(role, roleConfig.extractTags);
        updateGlobalSettings({ contextTagFilter: config });
        updateTagFilterBadge(config);
    }
}

/**
 * 添加排除标签（支持逗号分隔多个标签）
 * @param {string} role - 'ai' 或 'user'
 * @param {string} tagName - 标签名称，可用逗号分隔多个
 */
export function addExcludeTag(role, tagName) {
    if (!tagName || !tagName.trim()) return;

    const config = getTagFilterConfigFromUI();
    const roleConfig = config[role];
    let added = false;

    // 支持逗号分隔多个标签
    const tags = tagName.split(/[,，]/).map(t => t.trim().replace(/^<|>$/g, "")).filter(t => t);

    for (const cleanTag of tags) {
        if (!roleConfig.excludeTags.includes(cleanTag)) {
            roleConfig.excludeTags.push(cleanTag);
            added = true;
        }
    }

    if (added) {
        renderExcludeTagList(role, roleConfig.excludeTags);
        updateGlobalSettings({ contextTagFilter: config });
        updateTagFilterBadge(config);
    }
}

/**
 * 移除提取标签
 * @param {string} role - 'ai' 或 'user'
 * @param {string} tagName - 标签名称
 */
export function removeExtractTag(role, tagName) {
    const config = getTagFilterConfigFromUI();
    const roleConfig = config[role];
    const index = roleConfig.extractTags.indexOf(tagName);
    if (index > -1) {
        roleConfig.extractTags.splice(index, 1);
    }
    renderExtractTagList(role, roleConfig.extractTags);
    updateGlobalSettings({ contextTagFilter: config });
    updateTagFilterBadge(config);
}

/**
 * 移除排除标签
 * @param {string} role - 'ai' 或 'user'
 * @param {string} tagName - 标签名称
 */
export function removeExcludeTag(role, tagName) {
    const config = getTagFilterConfigFromUI();
    const roleConfig = config[role];
    const index = roleConfig.excludeTags.indexOf(tagName);
    if (index > -1) {
        roleConfig.excludeTags.splice(index, 1);
    }
    renderExcludeTagList(role, roleConfig.excludeTags);
    updateGlobalSettings({ contextTagFilter: config });
    updateTagFilterBadge(config);
}

/**
 * 绑定标签过滤事件
 */
export function bindTagFilterEvents() {
    // 绑定两个角色的事件
    for (const role of ['ai', 'user']) {
        // 提取模式复选框 - 即时生效
        document
            .getElementById(`mm-${role}-enable-extract`)
            ?.addEventListener("change", () => {
                const config = getTagFilterConfigFromUI();
                updateTagFilterBadge(config);
                updateGlobalSettings({ contextTagFilter: config });
            });

        // 排除模式复选框 - 即时生效
        document
            .getElementById(`mm-${role}-enable-exclude`)
            ?.addEventListener("change", () => {
                const config = getTagFilterConfigFromUI();
                updateTagFilterBadge(config);
                updateGlobalSettings({ contextTagFilter: config });
            });

        // 提取标签输入框回车添加
        document
            .getElementById(`mm-${role}-extract-tag-input`)
            ?.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    const input = e.target;
                    addExtractTag(role, input.value);
                    input.value = "";
                }
            });

        // 提取标签保存按钮点击
        document
            .getElementById(`mm-${role}-extract-tag-save`)
            ?.addEventListener("click", () => {
                const input = document.getElementById(`mm-${role}-extract-tag-input`);
                if (input) {
                    addExtractTag(role, input.value);
                    input.value = "";
                }
            });

        // 排除标签输入框回车添加
        document
            .getElementById(`mm-${role}-exclude-tag-input`)
            ?.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    const input = e.target;
                    addExcludeTag(role, input.value);
                    input.value = "";
                }
            });

        // 排除标签保存按钮点击
        document
            .getElementById(`mm-${role}-exclude-tag-save`)
            ?.addEventListener("click", () => {
                const input = document.getElementById(`mm-${role}-exclude-tag-input`);
                if (input) {
                    addExcludeTag(role, input.value);
                    input.value = "";
                }
            });

        // 提取标签删除按钮（事件委托）
        document
            .getElementById(`mm-${role}-extract-tag-list`)
            ?.addEventListener("click", (e) => {
                const removeBtn = e.target.closest('[data-action="remove-extract-tag"]');
                if (removeBtn) {
                    const tagName = removeBtn.dataset.tag;
                    const tagRole = removeBtn.dataset.role;
                    removeExtractTag(tagRole, tagName);
                }
            });

        // 排除标签删除按钮（事件委托）
        document
            .getElementById(`mm-${role}-exclude-tag-list`)
            ?.addEventListener("click", (e) => {
                const removeBtn = e.target.closest('[data-action="remove-exclude-tag"]');
                if (removeBtn) {
                    const tagName = removeBtn.dataset.tag;
                    const tagRole = removeBtn.dataset.role;
                    removeExcludeTag(tagRole, tagName);
                }
            });
    }

    // 区分大小写复选框 - 即时生效
    document
        .getElementById("mm-tag-case-sensitive")
        ?.addEventListener("change", () => {
            const config = getTagFilterConfigFromUI();
            updateGlobalSettings({ contextTagFilter: config });
        });

    Logger.debug("标签过滤事件绑定完成");
}
