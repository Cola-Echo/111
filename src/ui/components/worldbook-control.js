/**
 * 世界书控制模块
 * @module ui/components/worldbook-control
 *
 * 从原版 index.js 迁移
 * 功能: 世界书列表管理、条目统计、递归设置控制（支持多选）
 */

import Logger from '@core/logger';
import { getAllAvailableWorldBooks, loadWorldBookByName } from '@worldbook/api';
import { getContext } from '@core/sillytavern-api';

/**
 * 获取请求头（包含 CSRF 令牌）
 * @returns {Object} 请求头对象
 */
function getRequestHeaders() {
    try {
        const context = getContext();
        if (context && typeof context.getRequestHeaders === 'function') {
            return context.getRequestHeaders();
        }
    } catch (e) {
        // 忽略
    }
    return { 'Content-Type': 'application/json' };
}

// 当前选中的世界书名称（多选）
let selectedWorldbookNames = new Set();

// 存储已启用递归设置的世界书配置
// 格式: { bookName: { excludeRecursion: boolean, preventRecursion: boolean } }
let worldbookRecursionSettings = {};

/**
 * 加载选中的世界书名称
 */
export function loadSelectedWorldbook() {
    try {
        const saved = localStorage.getItem("mm-worldbook-selected");
        if (saved) {
            const parsed = JSON.parse(saved);
            // 兼容旧格式（单个字符串）
            if (typeof parsed === 'string') {
                selectedWorldbookNames = new Set([parsed]);
            } else if (Array.isArray(parsed)) {
                selectedWorldbookNames = new Set(parsed);
            } else {
                selectedWorldbookNames = new Set();
            }
            Logger.debug("加载选中的世界书:", Array.from(selectedWorldbookNames));
        }
    } catch (error) {
        Logger.error("加载选中的世界书失败:", error);
        selectedWorldbookNames = new Set();
    }

    // 初始化时立即更新徽章
    updateWorldbookControlBadge();
}

/**
 * 保存选中的世界书名称
 */
export function saveSelectedWorldbook() {
    try {
        if (selectedWorldbookNames.size > 0) {
            localStorage.setItem("mm-worldbook-selected", JSON.stringify(Array.from(selectedWorldbookNames)));
        } else {
            localStorage.removeItem("mm-worldbook-selected");
        }
    } catch (error) {
        Logger.error("保存选中的世界书失败:", error);
    }
}

/**
 * 加载递归设置配置
 */
export function loadRecursionSettings() {
    try {
        const saved = localStorage.getItem("mm-worldbook-recursion-settings");
        if (saved) {
            worldbookRecursionSettings = JSON.parse(saved);
        }
    } catch (error) {
        Logger.error("加载递归设置配置失败:", error);
        worldbookRecursionSettings = {};
    }

    // 同时加载选中的世界书
    loadSelectedWorldbook();
}

/**
 * 保存递归设置配置
 */
export function saveRecursionSettings() {
    try {
        localStorage.setItem(
            "mm-worldbook-recursion-settings",
            JSON.stringify(worldbookRecursionSettings)
        );
    } catch (error) {
        Logger.error("保存递归设置配置失败:", error);
    }
}

/**
 * 获取当前选中的世界书名称（兼容旧API，返回第一个选中的）
 * @returns {string|null} 选中的世界书名称
 */
export function getSelectedWorldbookName() {
    return selectedWorldbookNames.size > 0 ? Array.from(selectedWorldbookNames)[0] : null;
}

/**
 * 获取所有选中的世界书名称
 * @returns {Array<string>} 选中的世界书名称数组
 */
export function getSelectedWorldbookNames() {
    return Array.from(selectedWorldbookNames);
}

/**
 * 加载世界书控制列表
 */
export async function loadWorldbookControlList() {
    const listContainer = document.getElementById("mm-wb-list");
    const loadingEl = document.getElementById("mm-wb-loading");
    const emptyEl = document.getElementById("mm-wb-empty");

    if (!listContainer) return;

    // 显示加载状态
    if (loadingEl) loadingEl.style.display = "flex";
    if (emptyEl) emptyEl.style.display = "none";
    listContainer.innerHTML = "";

    try {
        // 获取所有世界书
        const worldBooks = await getAllAvailableWorldBooks();

        // 隐藏加载状态
        if (loadingEl) loadingEl.style.display = "none";

        if (!worldBooks || worldBooks.length === 0) {
            if (emptyEl) emptyEl.style.display = "flex";
            updateWorldbookControlBadge();
            return;
        }

        // 渲染世界书列表
        for (const bookName of worldBooks) {
            const itemEl = document.createElement("div");
            itemEl.className = "mm-wb-item";
            itemEl.dataset.bookName = bookName;

            // 检查是否是当前选中的
            const isSelected = selectedWorldbookNames.has(bookName);
            if (isSelected) {
                itemEl.classList.add("mm-wb-selected");
            }

            // 获取 DOMPurify 用于清理 HTML
            const { DOMPurify } = (typeof SillyTavern !== 'undefined' && SillyTavern.libs) || {};
            const safeBookName = DOMPurify
                ? DOMPurify.sanitize(bookName)
                : bookName;

            itemEl.innerHTML = `
                <input type="checkbox" ${isSelected ? "checked" : ""} />
                <span class="mm-wb-item-name" title="${safeBookName}">${safeBookName}</span>
            `;

            listContainer.appendChild(itemEl);
        }

        updateWorldbookControlBadge();

        // 如果有之前选中的世界书，显示递归控制（多选模式下始终显示）
        if (selectedWorldbookNames.size > 0) {
            const recursionControls = document.getElementById("mm-wb-recursion-controls");
            if (recursionControls) {
                recursionControls.style.display = "block";
                // 显示第一个选中世界书的递归状态
                const firstSelected = Array.from(selectedWorldbookNames)[0];
                updateRecursionButtonState(firstSelected);
            }

            // 显示条目统计（加载所有选中的）
            const entriesSection = document.getElementById("mm-wb-entries-section");
            if (entriesSection) {
                entriesSection.style.display = "block";
                await loadAllSelectedWorldbookEntries();
            }
        }

        Logger.debug("世界书控制列表加载完成，共", worldBooks.length, "本");
    } catch (error) {
        Logger.error("加载世界书控制列表失败:", error);
        if (loadingEl) loadingEl.style.display = "none";
        if (emptyEl) {
            emptyEl.innerHTML =
                '<i class="fa-solid fa-exclamation-circle"></i><span>加载失败</span>';
            emptyEl.style.display = "flex";
        }
    }
}

/**
 * 处理世界书选中事件（多选模式）
 * @param {string} bookName - 世界书名称
 * @param {boolean} isChecked - 是否选中
 */
export async function handleWorldbookSelect(bookName, isChecked) {
    const listEl = document.getElementById("mm-wb-list");
    const entriesSection = document.getElementById("mm-wb-entries-section");
    const recursionControls = document.getElementById("mm-wb-recursion-controls");

    // 更新选中集合（多选模式）
    if (isChecked) {
        selectedWorldbookNames.add(bookName);
    } else {
        selectedWorldbookNames.delete(bookName);
    }

    // 更新当前项的选中状态
    const currentItem = listEl?.querySelector(`[data-book-name="${bookName}"]`);
    if (currentItem) {
        if (isChecked) {
            currentItem.classList.add("mm-wb-selected");
        } else {
            currentItem.classList.remove("mm-wb-selected");
        }
    }

    // 保存选中的世界书
    saveSelectedWorldbook();

    // 更新徽章
    updateWorldbookControlBadge();

    // 显示/隐藏递归控制区域
    if (recursionControls) {
        if (selectedWorldbookNames.size > 0) {
            recursionControls.style.display = "block";
            // 显示当前操作的世界书的递归状态
            updateRecursionButtonState(bookName);
        } else {
            recursionControls.style.display = "none";
        }
    }

    // 显示/隐藏条目区域
    if (entriesSection) {
        if (selectedWorldbookNames.size > 0) {
            entriesSection.style.display = "block";
            // 加载所有选中的世界书统计
            await loadAllSelectedWorldbookEntries();
        } else {
            entriesSection.style.display = "none";
        }
    }
}

/**
 * 加载所有选中世界书的条目统计
 */
export async function loadAllSelectedWorldbookEntries() {
    const statsListEl = document.getElementById("mm-wb-stats-list");
    const statsLoadingEl = document.getElementById("mm-wb-stats-loading");
    const statsEmptyEl = document.getElementById("mm-wb-stats-empty");
    const statsCountEl = document.getElementById("mm-wb-stats-count");

    if (!statsListEl) return;

    // 清空列表
    statsListEl.innerHTML = "";

    const selectedBooks = Array.from(selectedWorldbookNames);

    // 更新统计数量显示
    if (statsCountEl) {
        statsCountEl.textContent = selectedBooks.length > 0 ? `(${selectedBooks.length} 本)` : "";
    }

    if (selectedBooks.length === 0) {
        if (statsEmptyEl) statsEmptyEl.style.display = "flex";
        if (statsLoadingEl) statsLoadingEl.style.display = "none";
        return;
    }

    if (statsEmptyEl) statsEmptyEl.style.display = "none";
    if (statsLoadingEl) statsLoadingEl.style.display = "flex";

    try {
        // 并发加载所有世界书的统计
        const statsPromises = selectedBooks.map(async (bookName) => {
            try {
                const bookData = await loadWorldBookByName(bookName);
                return { bookName, bookData };
            } catch (error) {
                Logger.error(`加载世界书 "${bookName}" 失败:`, error);
                return { bookName, bookData: null, error };
            }
        });

        const results = await Promise.all(statsPromises);

        if (statsLoadingEl) statsLoadingEl.style.display = "none";

        // 渲染每个世界书的统计卡片
        for (const { bookName, bookData, error } of results) {
            const cardEl = createWorldbookStatsCard(bookName, bookData, error);
            statsListEl.appendChild(cardEl);
        }

        Logger.debug(`已加载 ${selectedBooks.length} 本世界书的统计`);
    } catch (error) {
        Logger.error("加载世界书统计失败:", error);
        if (statsLoadingEl) statsLoadingEl.style.display = "none";
        if (statsEmptyEl) {
            statsEmptyEl.innerHTML =
                '<i class="fa-solid fa-exclamation-circle"></i><span>加载失败</span>';
            statsEmptyEl.style.display = "flex";
        }
    }
}

/**
 * 创建单个世界书统计卡片
 * @param {string} bookName - 世界书名称
 * @param {object|null} bookData - 世界书数据
 * @param {Error|null} error - 加载错误
 * @returns {HTMLElement} 卡片元素
 */
function createWorldbookStatsCard(bookName, bookData, error = null) {
    const cardEl = document.createElement("div");
    cardEl.className = "mm-wb-stats-card";
    cardEl.dataset.bookName = bookName;

    // 获取 DOMPurify 用于清理 HTML
    const { DOMPurify } = (typeof SillyTavern !== 'undefined' && SillyTavern.libs) || {};
    const safeBookName = DOMPurify ? DOMPurify.sanitize(bookName) : bookName;

    if (error || !bookData) {
        cardEl.innerHTML = `
            <div class="mm-wb-stats-card-header">
                <i class="fa-solid fa-chevron-right mm-wb-stats-expand"></i>
                <span class="mm-wb-stats-card-name" title="${safeBookName}">${safeBookName}</span>
                <span class="mm-wb-stats-card-summary mm-stat-error">加载失败</span>
            </div>
        `;
        return cardEl;
    }

    // 统计条目
    const entries = bookData.entries || {};
    let totalCount = 0;
    let enabledCount = 0;
    let disabledCount = 0;
    let constantCount = 0;

    for (const [uid, entry] of Object.entries(entries)) {
        totalCount++;
        const isDisabled = entry.disable === true || entry.enabled === false;
        const isConstant = entry.constant === true;

        if (isConstant) {
            constantCount++;
        }
        if (isDisabled) {
            disabledCount++;
        } else {
            enabledCount++;
        }
    }

    cardEl.innerHTML = `
        <div class="mm-wb-stats-card-header">
            <i class="fa-solid fa-chevron-right mm-wb-stats-expand"></i>
            <span class="mm-wb-stats-card-name" title="${safeBookName}">${safeBookName}</span>
            <span class="mm-wb-stats-card-summary">${totalCount} 条目</span>
        </div>
        <div class="mm-wb-stats-card-body">
            <div class="mm-wb-stat-item">
                <span class="mm-wb-stat-label">总条目数</span>
                <span class="mm-wb-stat-value">${totalCount}</span>
            </div>
            <div class="mm-wb-stat-item">
                <span class="mm-wb-stat-label">启用条目</span>
                <span class="mm-wb-stat-value mm-stat-enabled">${enabledCount}</span>
            </div>
            <div class="mm-wb-stat-item">
                <span class="mm-wb-stat-label">禁用条目</span>
                <span class="mm-wb-stat-value mm-stat-disabled">${disabledCount}</span>
            </div>
            <div class="mm-wb-stat-item">
                <span class="mm-wb-stat-label">常驻条目</span>
                <span class="mm-wb-stat-value mm-stat-constant">${constantCount}</span>
            </div>
        </div>
    `;

    // 绑定折叠/展开事件
    const headerEl = cardEl.querySelector(".mm-wb-stats-card-header");
    headerEl.addEventListener("click", () => {
        cardEl.classList.toggle("expanded");
    });

    return cardEl;
}

/**
 * 加载世界书条目统计（兼容旧API，现在调用新的多选版本）
 * @param {string} bookName - 世界书名称（可选，不再使用）
 */
export async function loadWorldbookEntries(bookName) {
    // 现在改为加载所有选中的世界书
    await loadAllSelectedWorldbookEntries();
}

/**
 * 更新世界书控制徽章（显示选中数量）
 */
export function updateWorldbookControlBadge() {
    const badgeEl = document.getElementById("mm-wb-control-badge");
    if (!badgeEl) return;

    const count = selectedWorldbookNames.size;
    if (count > 0) {
        badgeEl.textContent = `已选 ${count} 本`;
        badgeEl.classList.add("active");
    } else {
        badgeEl.textContent = "未选择";
        badgeEl.classList.remove("active");
    }
}

/**
 * 更新递归按钮状态
 * @param {string} bookName - 世界书名称
 */
export function updateRecursionButtonState(bookName) {
    const excludeBtn = document.getElementById("mm-wb-exclude-recursion");
    const preventBtn = document.getElementById("mm-wb-prevent-recursion");

    if (!excludeBtn || !preventBtn) return;

    const settings = worldbookRecursionSettings[bookName] || {};

    // 更新不可递归按钮状态
    if (settings.excludeRecursion) {
        excludeBtn.classList.add("active");
    } else {
        excludeBtn.classList.remove("active");
    }

    // 更新防止递归按钮状态
    if (settings.preventRecursion) {
        preventBtn.classList.add("active");
    } else {
        preventBtn.classList.remove("active");
    }
}

/**
 * 切换递归设置（应用到所有选中的世界书）
 * @param {string} settingType - 设置类型: 'excludeRecursion' 或 'preventRecursion'
 */
export async function toggleRecursionSetting(settingType) {
    if (selectedWorldbookNames.size === 0) {
        Logger.warn("请先选择至少一个世界书");
        return;
    }

    const selectedBooks = Array.from(selectedWorldbookNames);

    // 检查当前状态（基于第一个选中的世界书）
    const firstBook = selectedBooks[0];
    const currentSettings = worldbookRecursionSettings[firstBook] || {};
    const newValue = !currentSettings[settingType];

    // 为所有选中的世界书应用设置
    for (const bookName of selectedBooks) {
        // 初始化设置对象
        if (!worldbookRecursionSettings[bookName]) {
            worldbookRecursionSettings[bookName] = {
                excludeRecursion: false,
                preventRecursion: false,
            };
        }

        // 设置新值
        worldbookRecursionSettings[bookName][settingType] = newValue;

        // 应用递归设置到所有条目
        await applyRecursionSettingToAllEntries(bookName, settingType, newValue);
    }

    // 保存设置
    saveRecursionSettings();

    // 更新按钮状态（基于第一个选中的世界书）
    updateRecursionButtonState(firstBook);

    const settingName = settingType === "excludeRecursion" ? "不可递归" : "防止递归";
    const action = newValue ? "已启用" : "已禁用";
    Logger.log(`${selectedBooks.length} 本世界书 ${settingName}设置${action}`);
}

/**
 * 应用递归设置到世界书的所有条目
 * @param {string} bookName - 世界书名称
 * @param {string} settingType - 设置类型
 * @param {boolean} value - 设置值
 */
export async function applyRecursionSettingToAllEntries(bookName, settingType, value) {
    try {
        const bookData = await loadWorldBookByName(bookName);
        if (!bookData || !bookData.entries) {
            Logger.warn(`无法加载世界书 "${bookName}" 或其条目为空`);
            return false;
        }

        // 构建更新数据
        const entriesToUpdate = [];
        for (const [uid] of Object.entries(bookData.entries)) {
            const updateData = { uid: parseInt(uid) };

            // 根据设置类型添加相应字段
            if (settingType === "excludeRecursion") {
                updateData.exclude_recursion = value;
            } else if (settingType === "preventRecursion") {
                updateData.prevent_recursion = value;
            }

            entriesToUpdate.push(updateData);
        }

        if (entriesToUpdate.length === 0) {
            Logger.debug(`世界书 "${bookName}" 没有条目需要更新`);
            return true;
        }

        // 使用 SillyTavern API 更新条目
        const success = await updateWorldBookEntries(bookName, entriesToUpdate);

        if (success) {
            Logger.log(
                `已为世界书 "${bookName}" 的 ${entriesToUpdate.length} 个条目应用${
                    settingType === "excludeRecursion" ? "不可递归" : "防止递归"
                }设置: ${value}`
            );
            // 刷新条目列表显示
            await loadWorldbookEntries(bookName);
        } else {
            Logger.error(`更新世界书 "${bookName}" 条目的递归设置失败`);
        }

        return success;
    } catch (error) {
        Logger.error(`应用递归设置失败:`, error);
        return false;
    }
}

/**
 * 更新世界书条目的递归设置 (通过 SillyTavern API)
 * @param {string} bookName - 世界书名称
 * @param {Array} entries - 要更新的条目数组
 */
export async function updateWorldBookEntries(bookName, entries) {
    try {
        // 尝试使用 AmilyHelper API
        if (
            typeof window !== 'undefined' &&
            window.AmilyHelper &&
            typeof window.AmilyHelper.setLorebookEntries === "function"
        ) {
            return await window.AmilyHelper.setLorebookEntries(bookName, entries);
        }

        // 备用方案：直接通过 SillyTavern 的 world-info API
        const bookData = await loadWorldBookByName(bookName);
        if (!bookData) return false;

        for (const entryUpdate of entries) {
            const existingEntry = bookData.entries[entryUpdate.uid];
            if (existingEntry) {
                if (entryUpdate.exclude_recursion !== undefined) {
                    existingEntry.excludeRecursion = entryUpdate.exclude_recursion;
                }
                if (entryUpdate.prevent_recursion !== undefined) {
                    existingEntry.preventRecursion = entryUpdate.prevent_recursion;
                }
            }
        }

        // 保存世界书
        await saveWorldBookByName(bookName, bookData);
        return true;
    } catch (error) {
        Logger.error("更新世界书条目失败:", error);
        return false;
    }
}

/**
 * 保存世界书数据
 * @param {string} bookName - 世界书名称
 * @param {object} bookData - 世界书数据
 */
export async function saveWorldBookByName(bookName, bookData) {
    try {
        // 尝试使用 SillyTavern 的 saveWorldInfo API
        if (typeof SillyTavern !== "undefined" && SillyTavern.getContext) {
            const context = SillyTavern.getContext();
            if (context && typeof context.saveWorldInfo === "function") {
                await context.saveWorldInfo(bookName, bookData, true);
                return true;
            }
        }

        // 尝试直接调用全局函数
        if (typeof saveWorldInfo === "function") {
            await saveWorldInfo(bookName, bookData, true);
            return true;
        }

        // 尝试通过 fetch API 调用
        let headers = { "Content-Type": "application/json" };
        try {
            headers = getRequestHeaders();
        } catch (e) {
            // 使用默认 headers
        }

        const response = await fetch("/api/worldinfo/edit", {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                name: bookName,
                data: bookData,
            }),
        });

        return response.ok;
    } catch (error) {
        Logger.error(`保存世界书 "${bookName}" 失败:`, error);
        return false;
    }
}

/**
 * 为新增的条目应用递归设置
 * @param {string} bookName - 世界书名称
 */
export async function applyRecursionSettingsToNewEntries(bookName) {
    const settings = worldbookRecursionSettings[bookName];
    if (!settings || (!settings.excludeRecursion && !settings.preventRecursion)) {
        return;
    }

    try {
        const bookData = await loadWorldBookByName(bookName);
        if (!bookData || !bookData.entries) return;

        const entriesToUpdate = [];

        for (const [uid, entry] of Object.entries(bookData.entries)) {
            let needsUpdate = false;
            const updateData = { uid: parseInt(uid) };

            // 检查不可递归设置
            if (settings.excludeRecursion && !entry.excludeRecursion) {
                updateData.exclude_recursion = true;
                needsUpdate = true;
            }

            // 检查防止递归设置
            if (settings.preventRecursion && !entry.preventRecursion) {
                updateData.prevent_recursion = true;
                needsUpdate = true;
            }

            if (needsUpdate) {
                entriesToUpdate.push(updateData);
            }
        }

        if (entriesToUpdate.length > 0) {
            await updateWorldBookEntries(bookName, entriesToUpdate);
            Logger.debug(
                `为世界书 "${bookName}" 的 ${entriesToUpdate.length} 个新条目应用了递归设置`
            );
        }
    } catch (error) {
        Logger.error(`检查/更新世界书 "${bookName}" 新条目的递归设置失败:`, error);
    }
}

/**
 * 绑定世界书控制事件
 */
export function bindWorldbookControlEvents() {
    // 世界书控制 - 刷新按钮
    document
        .getElementById("mm-wb-refresh")
        ?.addEventListener("click", () => {
            loadWorldbookControlList();
        });

    // 世界书控制 - 列表点击事件委托
    document
        .getElementById("mm-wb-list")
        ?.addEventListener("click", (e) => {
            const item = e.target.closest(".mm-wb-item");
            if (item) {
                const checkbox = item.querySelector('input[type="checkbox"]');
                const bookName = item.dataset.bookName;

                // 如果点击的不是 checkbox 本身，则切换 checkbox 状态
                if (e.target.type !== "checkbox") {
                    checkbox.checked = !checkbox.checked;
                }

                // 处理选中状态
                handleWorldbookSelect(bookName, checkbox.checked);
            }
        });

    // 世界书控制 - 不可递归按钮
    document
        .getElementById("mm-wb-exclude-recursion")
        ?.addEventListener("click", () => {
            toggleRecursionSetting("excludeRecursion");
        });

    // 世界书控制 - 防止递归按钮
    document
        .getElementById("mm-wb-prevent-recursion")
        ?.addEventListener("click", () => {
            toggleRecursionSetting("preventRecursion");
        });

    // 加载递归设置配置
    loadRecursionSettings();

    Logger.debug("世界书控制事件绑定完成");
}
