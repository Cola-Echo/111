﻿/**
 * UI 事件绑定模块
 * @module ui/events
 *
 * 注意：此模块包含所有 UI 事件绑定
 * 从原版 index.js 完整迁移
 */

import Logger from '@core/logger';
import { detectExtensionPath } from '@core/constants';
import { getGlobalSettings, updateGlobalSettings, exportConfig, importConfig, resetConfig, loadConfig, getMultiAIConfig, setMultiAIEnabled, updateProvider, deleteProvider, clearOldData } from '@config/config-manager';
import { removeImportedBook } from '@config/imported-books';
import { refreshWorldBookList } from '@worldbook/refresh';
import { updateMenuButtonStatus } from './menu-button';
import { updateFloatBallVisibility, updateFloatBallStatus } from './float-ball';
import { stopProcessing } from '@hooks';
import { showMultiAIConfigModal } from './modals/multi-ai-config';
import { showPromptPresetModal, renderPromptPresetList } from './modals/prompt-preset';
import { showClearDataConfirmModal } from './modals/clear-data-confirm';
import { clearPromptTemplateCache } from '@utils/prompt-template';

// 导入标签过滤模块
import {
    initTagFilterUI,
    updateTagFilterBadge,
    getTagFilterConfigFromUI,
    addExtractTag,
    addExcludeTag,
    removeExtractTag,
    removeExcludeTag,
    bindTagFilterEvents,
} from './components/tag-filter';

// 导入世界书控制模块
import {
    loadWorldbookControlList,
    handleWorldbookSelect,
    toggleRecursionSetting,
    bindWorldbookControlEvents,
} from './components/worldbook-control';

// 导入配置弹窗模块中的函数（用于直接调用而非函数注入）
import {
    saveConfig as saveConfigModal,
    switchConfigTab,
    toggleCustomFormatOptions,
    loadConfigWorldBooks,
    loadConfigCharDescription,
} from './modals/config-modal';

// 重导出这些函数供外部使用
export {
    initTagFilterUI,
    updateTagFilterBadge,
    getTagFilterConfigFromUI,
    addExtractTag,
    addExcludeTag,
    removeExtractTag,
    removeExcludeTag,
};

export {
    loadWorldbookControlList,
    handleWorldbookSelect,
    toggleRecursionSetting,
};

// 函数注入存储（用于在 index.js 中设置）
let togglePanelFn = null;
let showWorldBookSelectorFn = null;
let showConfigModalFn = null;
let deleteConfigFn = null;
let hideConfigModalFn = null;
let saveCurrentConfigFn = null;
let testConnectionFn = null;
let fetchModelsFn = null;
let toggleCustomFormatOptionsFn = null;
let switchConfigTabFn = null;
let loadConfigWorldBooksFn = null;
let loadConfigCharDescriptionFn = null;
let hasImportedSummaryBooksFn = null;
let openIndexMergeConfigModalFn = null;
let openPlotOptimizeConfigModalFn = null;
let clearUpdatesListFn = null;
let initFlowConfigResizeFn = null;
let updateMemorySearchBadgeFn = null;
let updatePlotOptimizeBadgeFn = null;
let refreshAIConfigListFn = null;

// 流程配置相关函数
let showFlowConfigModalFn = null;
let hideFlowConfigModalFn = null;
let resetFlowConfigFn = null;
let importFlowConfigFn = null;
let exportFlowConfigFn = null;
let saveFlowConfigFn = null;

// 提示词编辑器相关函数
let showPromptEditorFn = null;
let hidePromptEditorFn = null;
let savePromptFileFn = null;
let saveAsPromptFileFn = null;
let deletePromptFileFn = null;
let restoreDefaultPromptFn = null;
let importPromptFileFn = null;
let exportPromptFileFn = null;
let switchPromptTypeFn = null;

// 设置函数导出
export function setTogglePanelFunction(fn) { togglePanelFn = fn; }
export function setWorldBookSelectorFunction(fn) { showWorldBookSelectorFn = fn; }
export function setConfigModalFunctions(showFn, deleteFn) {
    showConfigModalFn = showFn;
    deleteConfigFn = deleteFn;
}
export function setHideConfigModalFunction(fn) { hideConfigModalFn = fn; }
export function setSaveCurrentConfigFunction(fn) { saveCurrentConfigFn = fn; }
export function setTestConnectionFunction(fn) { testConnectionFn = fn; }
export function setFetchModelsFunction(fn) { fetchModelsFn = fn; }
export function setToggleCustomFormatOptionsFunction(fn) { toggleCustomFormatOptionsFn = fn; }
export function setSwitchConfigTabFunction(fn) { switchConfigTabFn = fn; }
export function setLoadConfigWorldBooksFunction(fn) { loadConfigWorldBooksFn = fn; }
export function setLoadConfigCharDescriptionFunction(fn) { loadConfigCharDescriptionFn = fn; }
export function setHasImportedSummaryBooksFunction(fn) { hasImportedSummaryBooksFn = fn; }
export function setOpenIndexMergeConfigModalFunction(fn) { openIndexMergeConfigModalFn = fn; }
export function setOpenPlotOptimizeConfigModalFunction(fn) { openPlotOptimizeConfigModalFn = fn; }
export function setClearUpdatesListFunction(fn) { clearUpdatesListFn = fn; }
export function setInitFlowConfigResizeFunction(fn) { initFlowConfigResizeFn = fn; }
export function setLoadWorldbookControlListFunction(fn) { /* 已有本地实现 */ }
export function setUpdateMemorySearchBadgeFunction(fn) { updateMemorySearchBadgeFn = fn; }
export function setUpdatePlotOptimizeBadgeFunction(fn) { updatePlotOptimizeBadgeFn = fn; }
export function setUpdateTagFilterBadgeFunction(fn) { /* 已有本地实现 */ }
export function setRefreshAIConfigListFunction(fn) { refreshAIConfigListFn = fn; }

// 流程配置设置函数
export function setFlowConfigFunctions(show, hide, reset, importFn, exportFn, save) {
    showFlowConfigModalFn = show;
    hideFlowConfigModalFn = hide;
    resetFlowConfigFn = reset;
    importFlowConfigFn = importFn;
    exportFlowConfigFn = exportFn;
    saveFlowConfigFn = save;
}

// 提示词编辑器设置函数
export function setPromptEditorFunctions(show, hide, save, saveAs, del, restore, importFn, exportFn, switchType) {
    showPromptEditorFn = show;
    hidePromptEditorFn = hide;
    savePromptFileFn = save;
    saveAsPromptFileFn = saveAs;
    deletePromptFileFn = del;
    restoreDefaultPromptFn = restore;
    importPromptFileFn = importFn;
    exportPromptFileFn = exportFn;
    switchPromptTypeFn = switchType;
}

// 兼容旧版导出名称
export function setSettingsFunctions(showFn, hideFn) {
    // 设置面板直接通过 CSS 类切换，不需要回调
}

/**
 * 显示设置面板
 */
function showSettings() {
    const settingsPanel = document.getElementById("memory-manager-settings");
    if (settingsPanel) {
        settingsPanel.classList.add("mm-settings-visible");
        // 刷新 AI 配置列表
        if (typeof refreshAIConfigListFn === 'function') {
            refreshAIConfigListFn();
        }
    }
}

/**
 * 隐藏设置面板
 */
function hideSettings() {
    const settingsPanel = document.getElementById("memory-manager-settings");
    if (settingsPanel) {
        settingsPanel.classList.remove("mm-settings-visible");
    }
}

/**
 * 切换面板
 */
function togglePanel() {
    if (togglePanelFn) {
        togglePanelFn();
    }
}

/**
 * 创建星星层（用于星空主题）
 * @param {HTMLElement} container 容器元素
 */
function createStarsLayer(container) {
    // 移除旧的星星层
    const oldLayer = container.querySelector(".mm-stars-layer");
    if (oldLayer) oldLayer.remove();

    const layer = document.createElement("div");
    layer.className = "mm-stars-layer";

    // 大星星 - 8颗
    for (let i = 0; i < 8; i++) {
        const star = document.createElement("div");
        star.className = "mm-star mm-star-large";
        star.style.left = `${5 + Math.random() * 90}%`;
        star.style.top = `${5 + Math.random() * 90}%`;
        star.style.setProperty(
            "--twinkle-duration",
            `${2 + Math.random() * 2}s`,
        );
        star.style.setProperty("--twinkle-delay", `${Math.random() * 3}s`);
        star.style.setProperty("--star-opacity-min", "0.4");
        star.style.setProperty("--star-opacity-max", "1");
        layer.appendChild(star);
    }

    // 中星星 - 15颗
    for (let i = 0; i < 15; i++) {
        const star = document.createElement("div");
        star.className = "mm-star mm-star-medium";
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        star.style.setProperty(
            "--twinkle-duration",
            `${2.5 + Math.random() * 2.5}s`,
        );
        star.style.setProperty("--twinkle-delay", `${Math.random() * 4}s`);
        star.style.setProperty("--star-opacity-min", "0.3");
        star.style.setProperty("--star-opacity-max", "0.9");
        layer.appendChild(star);
    }

    // 小星星 - 25颗
    for (let i = 0; i < 25; i++) {
        const star = document.createElement("div");
        star.className = "mm-star mm-star-small";
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        star.style.setProperty(
            "--twinkle-duration",
            `${3 + Math.random() * 3}s`,
        );
        star.style.setProperty("--twinkle-delay", `${Math.random() * 5}s`);
        star.style.setProperty("--star-opacity-min", "0.2");
        star.style.setProperty("--star-opacity-max", "0.8");
        layer.appendChild(star);
    }

    // 流星 - 3颗，从右上往左下斜飞，分布在不同高度
    for (let i = 0; i < 3; i++) {
        const shootingStar = document.createElement("div");
        shootingStar.className = "mm-shooting-star";
        // 在整个面板高度范围内随机分布（-10% 到 70%）
        shootingStar.style.top = `${-10 + i * 25 + Math.random() * 20}%`;
        shootingStar.style.right = `${-15 + Math.random() * 30}%`;
        shootingStar.style.animationName = "mm-shooting-star";
        shootingStar.style.animationTimingFunction = "ease-out";
        shootingStar.style.animationIterationCount = "infinite";
        shootingStar.style.animationDelay = `${i * 5 + Math.random() * 3}s`;
        shootingStar.style.animationDuration = `${10 + Math.random() * 5}s`;
        layer.appendChild(shootingStar);
    }

    container.insertBefore(layer, container.firstChild);
}

/**
 * 移除星星层
 * @param {HTMLElement} container 容器元素
 */
function removeStarsLayer(container) {
    const layer = container.querySelector(".mm-stars-layer");
    if (layer) layer.remove();
}

/**
 * 设置主题
 * @param {string} theme 主题名称
 */
function setTheme(theme) {
    const panel = document.getElementById("memory-manager-panel");
    const settingsPanel = document.getElementById("memory-manager-settings");
    const gamePanel = document.getElementById("mm-game-panel");
    const searchDialog = document.getElementById("mm-search-dialog");
    const plotPanel = document.getElementById("mm-plot-optimize-panel");
    const progressPanel = document.getElementById("mm-progress-panel");
    const promptEditor = document.getElementById("mm-prompt-editor-modal");
    const aiConfig = document.getElementById("mm-ai-config-modal");
    const flowConfigModal = document.getElementById("mm-flow-config-modal");
    const worldBookSelector = document.getElementById("mm-worldbook-selector-modal");

    const elements = [
        panel,
        settingsPanel,
        gamePanel,
        searchDialog,
        plotPanel,
        progressPanel,
        promptEditor,
        aiConfig,
        flowConfigModal,
        worldBookSelector,
    ];

    const isStarryTheme = theme && theme.startsWith("starry-");

    // 设置主题
    elements.forEach((el) => {
        if (!el) return;
        if (theme === "default") {
            el.removeAttribute("data-mm-theme");
            removeStarsLayer(el);
        } else {
            el.setAttribute("data-mm-theme", theme);
            // 星空主题时添加闪烁星星
            if (isStarryTheme) {
                createStarsLayer(el);
            } else {
                removeStarsLayer(el);
            }
        }
    });

    // 更新按钮状态
    document.querySelectorAll(".mm-theme-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.theme === theme);
    });

    // 保存设置
    updateGlobalSettings({ theme });
}

/**
 * 初始化主题
 */
export function initTheme() {
    const settings = getGlobalSettings();
    const theme = settings.theme || "default";
    setTheme(theme);
}

/**
 * 绑定基础面板事件
 */
function bindPanelEvents() {
    // 刷新按钮
    document
        .getElementById("mm-refresh-btn")
        ?.addEventListener("click", refreshWorldBookList);

    // 导入世界书按钮
    document
        .getElementById("mm-import-book-btn")
        ?.addEventListener("click", () => {
            if (showWorldBookSelectorFn) {
                showWorldBookSelectorFn();
            }
        });

    // 设置按钮
    document
        .getElementById("mm-settings-btn")
        ?.addEventListener("click", showSettings);

    // 设置关闭按钮
    document
        .getElementById("mm-settings-close")
        ?.addEventListener("click", hideSettings);

    // 清除旧数据按钮（保留各板块API配置，其它清空）
    document
        .getElementById("mm-clear-old-data")
        ?.addEventListener("click", async () => {
            // 显示自定义确认弹窗
            const confirmed = await showClearDataConfirmModal();
            if (!confirmed) {
                return;
            }
            try {
                clearOldData(60_000);
                // 清除提示词模板缓存，让插件重新加载内置提示词
                clearPromptTemplateCache();
                if (refreshAIConfigListFn) refreshAIConfigListFn();
                // 提示词预设列表也会被清空，需要刷新显示
                renderPromptPresetList();
                loadGlobalSettingsUI();
                toastr.success("已清除旧数据（已保留API配置）");
            } catch (e) {
                Logger.error("清除旧数据失败:", e);
                toastr.error("清除旧数据失败，请查看控制台日志");
            }
        });

    // 面板关闭按钮
    document
        .getElementById("mm-panel-close-btn")
        ?.addEventListener("click", togglePanel);

    // 主题切换按钮
    document.querySelectorAll(".mm-theme-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const theme = btn.dataset.theme;
            setTheme(theme);
        });
    });

    // 猫爪按钮 - 花朵彩蛋
    bindPawButtonEvents();
}

/**
 * 猫爪按钮彩蛋
 */
function bindPawButtonEvents() {
    let pawClickCount = 0;
    let pawCooldown = false;

    document
        .getElementById("mm-paw-btn")
        ?.addEventListener("click", (e) => {
            const container = document.getElementById("mm-flower-container");
            if (!container) return;

            if (pawCooldown) return;

            pawClickCount++;

            // 50次 - 进入2分钟冷却
            if (pawClickCount >= 50) {
                const warningText = document.createElement("span");
                warningText.className = "mm-love-text mm-warning-text";
                warningText.textContent = "看你干的好事~哼哼";
                container.appendChild(warningText);
                setTimeout(() => warningText.remove(), 3000);

                pawCooldown = true;
                pawClickCount = 0;
                const btn = document.getElementById("mm-paw-btn");
                if (btn) btn.style.opacity = "0.3";

                setTimeout(() => {
                    pawCooldown = false;
                    pawClickCount = 0;
                    if (btn) btn.style.opacity = "1";
                }, 120000);
                return;
            }

            // 25次 - 警告
            if (pawClickCount === 25) {
                const warningText = document.createElement("span");
                warningText.className = "mm-love-text mm-warning-text";
                warningText.textContent = "再点就坏啦~♥";
                container.appendChild(warningText);
                setTimeout(() => warningText.remove(), 2500);
            }

            // 15次 - 提示
            if (pawClickCount === 15) {
                const hintText = document.createElement("span");
                hintText.className = "mm-love-text";
                hintText.textContent = "不要再点了啦~♥";
                container.appendChild(hintText);
                setTimeout(() => hintText.remove(), 2500);
            }

            // 抛出花朵
            const flowerCount = Math.min(pawClickCount, 10);
            for (let i = 0; i < flowerCount; i++) {
                setTimeout(() => {
                    const flower = document.createElement("span");
                    flower.className = "mm-falling-flower";
                    flower.textContent = "🌸";
                    flower.style.left = `${35 + Math.random() * 30}%`;
                    flower.style.top = "0";
                    flower.style.animationDuration = `${2 + Math.random() * 1}s`;
                    flower.style.animationDelay = `${Math.random() * 0.2}s`;
                    container.appendChild(flower);
                    setTimeout(() => flower.remove(), 3500);
                }, i * 80);
            }

            // 第5次点击后显示"爱你哟"
            if (pawClickCount === 5) {
                setTimeout(() => {
                    const loveText = document.createElement("span");
                    loveText.className = "mm-love-text";
                    loveText.textContent = "❤️ 爱你哟 ❤️";
                    container.appendChild(loveText);
                    setTimeout(() => loveText.remove(), 2500);
                }, 500);
            }
        });
}

/**
 * 绑定设置事件
 */
function bindSettingsEvents() {
    // 插件开关
    document
        .getElementById("mm-plugin-toggle")
        ?.addEventListener("click", () => {
            const toggle = document.getElementById("mm-plugin-toggle");
            if (!toggle) return;

            const isActive = toggle.classList.toggle("mm-active");
            updateGlobalSettings({ enabled: isActive });
            toggle.title = isActive ? "关闭插件" : "启用插件";
            updateMenuButtonStatus();
            updateFloatBallStatus();

            // 显示开关通知
            if (typeof toastr !== 'undefined') {
                if (isActive) {
                    toastr.success("记忆管理并发系统已启用 By：可乐、繁华", "记忆管理并发系统");
                } else {
                    toastr.info("记忆管理并发系统已关闭", "记忆管理并发系统");
                }
            }
        });

    // 显示悬浮球
    document
        .getElementById("mm-show-float-ball")
        ?.addEventListener("change", (e) => {
            const checked = e.target.checked;
            updateGlobalSettings({ showFloatBall: checked });
            updateFloatBallVisibility();
            updateFloatBallStatus();
            if (typeof toastr !== 'undefined') {
                toastr.success(`悬浮球已${checked ? "显示" : "隐藏"}`, "记忆管理并发系统");
            }
        });

    // 显示处理日志
    document
        .getElementById("mm-show-logs")
        ?.addEventListener("change", (e) => {
            const checked = e.target.checked;
            updateGlobalSettings({ showLogs: checked });
            if (typeof toastr !== 'undefined') {
                toastr.success(`处理日志已${checked ? "启用" : "禁用"}`, "记忆管理并发系统");
            }
        });

    // 发送前检查
    document
        .getElementById("mm-show-request-preview")
        ?.addEventListener("change", (e) => {
            const checked = e.target.checked;
            updateGlobalSettings({ showRequestPreview: checked });

            // 验证保存并提示
            setTimeout(() => {
                const settings = getGlobalSettings();
                if (settings.showRequestPreview === checked) {
                    Logger.log(`✅ [配置] 发送前检查已${checked ? "启用" : "禁用"}`);
                    if (typeof toastr !== 'undefined') {
                        toastr.success(`发送前检查功能已${checked ? "启用" : "禁用"}`, "记忆管理并发系统");
                    }
                }
            }, 100);

            // 流程配置按钮始终显示（不再与发送前检查绑定）
        });

    // 仅发送索引
    document
        .getElementById("mm-send-index-only")
        ?.addEventListener("change", (e) => {
            const checked = e.target.checked;
            updateGlobalSettings({ sendIndexOnly: checked });
            const indexModeCard = document.getElementById("mm-index-mode-card");
            if (indexModeCard) {
                indexModeCard.style.display = checked ? "block" : "none";
            }
            if (typeof toastr !== 'undefined') {
                toastr.success(`仅发送索引已${checked ? "启用" : "禁用"}`, "记忆管理并发系统");
            }
        });

    // 索引模式折叠卡片
    document
        .getElementById("mm-index-mode-toggle")
        ?.addEventListener("click", () => {
            const card = document.getElementById("mm-index-mode-card");
            if (card) card.classList.toggle("expanded");
        });

    // 索引合并开关
    document
        .getElementById("mm-index-merge-enabled")
        ?.addEventListener("change", (e) => {
            const checked = e.target.checked;
            updateGlobalSettings({ indexMergeEnabled: checked });
            const configCard = document.getElementById("mm-index-merge-config-card");
            if (configCard) {
                configCard.style.display = checked ? "flex" : "none";
            }
            if (typeof toastr !== 'undefined') {
                toastr.success(`索引合并已${checked ? "启用" : "禁用"}`, "记忆管理并发系统");
            }
        });

    // 索引合并 API 配置编辑按钮
    document
        .getElementById("mm-index-merge-edit")
        ?.addEventListener("click", () => {
            if (openIndexMergeConfigModalFn) openIndexMergeConfigModalFn();
        });

    // 剧情优化 API 配置编辑按钮
    document
        .getElementById("mm-plot-optimize-edit")
        ?.addEventListener("click", () => {
            if (openPlotOptimizeConfigModalFn) openPlotOptimizeConfigModalFn();
        });

    // 汇总检查
    document
        .getElementById("mm-show-summary-check")
        ?.addEventListener("change", (e) => {
            const checked = e.target.checked;
            updateGlobalSettings({ showSummaryCheck: checked });
            if (typeof toastr !== 'undefined') {
                toastr.success(`汇总检查已${checked ? "启用" : "禁用"}`, "记忆管理并发系统");
            }
        });

    // 启用剧情末尾
    document
        .getElementById("mm-enable-recent-plot")
        ?.addEventListener("change", (e) => {
            const checked = e.target.checked;
            updateGlobalSettings({ enableRecentPlot: checked });
            // 显示/隐藏字数滑条
            const lengthContainer = document.getElementById("mm-recent-plot-length-container");
            if (lengthContainer) {
                lengthContainer.style.display = checked ? "block" : "none";
            }
            if (typeof toastr !== 'undefined') {
                toastr.success(`剧情末尾已${checked ? "启用" : "禁用"}`, "记忆管理并发系统");
            }
        });

    // 剧情末尾字数滑块
    document
        .getElementById("mm-recent-plot-length")
        ?.addEventListener("input", (e) => {
            const value = parseInt(e.target.value) ?? 200;
            const valueEl = document.getElementById("mm-recent-plot-length-value");
            if (valueEl) valueEl.textContent = value;
            updateGlobalSettings({ recentPlotLength: value });
        });

    // 上下文轮数滑块
    document
        .getElementById("mm-context-rounds")
        ?.addEventListener("input", (e) => {
            const value = parseInt(e.target.value) ?? 5;
            const valueEl = document.getElementById("mm-context-rounds-value");
            if (valueEl) valueEl.textContent = value;
            updateGlobalSettings({ contextRounds: value });
        });

    // 终止按钮
    document
        .getElementById("mm-stop-btn")
        ?.addEventListener("click", () => {
            stopProcessing();
        });

    // 清空更新按钮
    document
        .getElementById("mm-clear-updates-btn")
        ?.addEventListener("click", () => {
            if (clearUpdatesListFn) clearUpdatesListFn();
        });

    // 功能开关折叠卡片
    document
        .getElementById("mm-feature-switch-toggle")
        ?.addEventListener("click", () => {
            const card = document.getElementById("mm-feature-switch-card");
            if (card) card.classList.toggle("expanded");
        });

    // 记忆搜索助手折叠卡片
    document
        .getElementById("mm-interactive-search-toggle")
        ?.addEventListener("click", () => {
            const card = document.getElementById("mm-interactive-search-card");
            if (card) card.classList.toggle("expanded");
        });

    // 启用记忆搜索助手开关
    document
        .getElementById("mm-enable-interactive-search")
        ?.addEventListener("change", (e) => {
            const checkbox = e.target;
            const isChecked = checkbox.checked;

            if (isChecked && hasImportedSummaryBooksFn && !hasImportedSummaryBooksFn()) {
                checkbox.checked = false;
                if (typeof toastr !== 'undefined') {
                    toastr.warning(
                        '请先导入至少一个总结世界书（书名包含"敕史局"、"Summary"或"Lore-char"）才能使用记忆搜索助手功能。',
                        "记忆管理并发系统",
                        { timeOut: 5000 }
                    );
                }
                return;
            }

            updateGlobalSettings({ enableInteractiveSearch: isChecked });
            if (updateMemorySearchBadgeFn) updateMemorySearchBadgeFn(isChecked);
            if (typeof toastr !== 'undefined') {
                toastr.success(`记忆搜索助手已${isChecked ? "启用" : "禁用"}`, "记忆管理并发系统");
            }
        });

    // 剧情优化助手折叠卡片
    document
        .getElementById("mm-plot-optimize-toggle")
        ?.addEventListener("click", () => {
            const card = document.getElementById("mm-plot-optimize-card");
            if (card) card.classList.toggle("expanded");
        });

    // 启用剧情优化助手开关
    document
        .getElementById("mm-enable-plot-optimize")
        ?.addEventListener("change", (e) => {
            const checked = e.target.checked;
            updateGlobalSettings({ enablePlotOptimize: checked });
            if (updatePlotOptimizeBadgeFn) updatePlotOptimizeBadgeFn(checked);
            if (typeof toastr !== 'undefined') {
                toastr.success(`剧情优化助手已${checked ? "启用" : "禁用"}`, "记忆管理并发系统");
            }
        });

    // 标签过滤折叠卡片
    document
        .getElementById("mm-tag-filter-toggle")
        ?.addEventListener("click", () => {
            const card = document.getElementById("mm-tag-filter-card");
            if (card) card.classList.toggle("expanded");
        });

    // 世界书控制折叠卡片
    document
        .getElementById("mm-worldbook-control-toggle")
        ?.addEventListener("click", () => {
            const card = document.getElementById("mm-worldbook-control-card");
            if (card) {
                card.classList.toggle("expanded");
                if (card.classList.contains("expanded")) {
                    loadWorldbookControlList();
                }
            }
        });

    // AI 配置区块折叠/展开
    document
        .getElementById("mm-ai-config-toggle")
        ?.addEventListener("click", () => {
            const card = document.getElementById("mm-ai-config-card");
            if (card) card.classList.toggle("expanded");
        });

    // 配置管理区块折叠/展开
    document
        .getElementById("mm-config-manage-toggle")
        ?.addEventListener("click", () => {
            const card = document.getElementById("mm-config-manage-card");
            if (card) card.classList.toggle("expanded");
        });

    // 添加配置按钮
    document
        .getElementById("mm-add-config")
        ?.addEventListener("click", () => {
            const category = prompt("请输入分类名称");
            if (category && showConfigModalFn) {
                showConfigModalFn(category);
            }
        });
}

/**
 * 绑定配置弹窗事件
 */
function bindConfigModalEvents() {
    document
        .querySelector("#mm-ai-config-modal .mm-modal-close")
        ?.addEventListener("click", () => {
            if (hideConfigModalFn) hideConfigModalFn();
        });

    document
        .getElementById("mm-config-cancel")
        ?.addEventListener("click", () => {
            if (hideConfigModalFn) hideConfigModalFn();
        });

    document
        .getElementById("mm-config-save")
        ?.addEventListener("click", () => {
            // 直接调用导入的保存函数
            saveConfigModal();
        });

    document
        .getElementById("mm-test-connection")
        ?.addEventListener("click", () => {
            if (testConnectionFn) testConnectionFn();
        });

    document
        .getElementById("mm-fetch-models")
        ?.addEventListener("click", () => {
            if (fetchModelsFn) fetchModelsFn();
        });

    // API 格式切换
    document
        .querySelectorAll('input[name="mm-api-format"]')
        .forEach((radio) => {
            radio.addEventListener("change", (e) => {
                // 直接调用导入的函数
                toggleCustomFormatOptions(e.target.value === "custom");
            });
        });

    // 温度滑块
    document
        .getElementById("mm-config-temperature")
        ?.addEventListener("input", (e) => {
            const valueEl = document.getElementById("mm-config-temperature-value");
            if (valueEl) valueEl.textContent = e.target.value;
        });

    // 相关度滑块
    document
        .getElementById("mm-config-relevance")
        ?.addEventListener("input", (e) => {
            const valueEl = document.getElementById("mm-config-relevance-value");
            if (valueEl) valueEl.textContent = e.target.value;
        });

    // Tab 切换
    document
        .getElementById("mm-config-tab-api")
        ?.addEventListener("click", () => {
            // 直接调用导入的函数
            switchConfigTab("api");
        });

    document
        .getElementById("mm-config-tab-context")
        ?.addEventListener("click", () => {
            // 直接调用导入的函数
            switchConfigTab("context");
        });

    // 剧情优化上下文参考轮次滑块
    document
        .getElementById("mm-plot-context-rounds")
        ?.addEventListener("input", (e) => {
            const valueEl = document.getElementById("mm-plot-context-rounds-value");
            if (valueEl) valueEl.textContent = e.target.value;
        });

    // 世界书选择折叠卡片
    document
        .getElementById("mm-config-worldbook-toggle")
        ?.addEventListener("click", () => {
            const card = document.getElementById("mm-config-worldbook-card");
            if (card) card.classList.toggle("expanded");
        });

    // 世界书刷新按钮
    document
        .getElementById("mm-config-worldbook-refresh")
        ?.addEventListener("click", (e) => {
            e.stopPropagation();
            // 直接调用导入的函数
            const globalSettings = getGlobalSettings();
            const config = globalSettings.plotOptimizeConfig || {};
            loadConfigWorldBooks(config.selectedBooks || [], config.selectedEntries || {});
        });

    // 角色描述折叠卡片
    document
        .getElementById("mm-config-char-toggle")
        ?.addEventListener("click", () => {
            const card = document.getElementById("mm-config-char-card");
            if (card) card.classList.toggle("expanded");
        });

    // 角色描述刷新按钮
    document
        .getElementById("mm-config-char-refresh")
        ?.addEventListener("click", (e) => {
            e.stopPropagation();
            // 直接调用导入的函数
            loadConfigCharDescription();
        });
}

/**
 * 绑定世界书列表事件（事件委托）
 */
function bindWorldBookListEvents() {
    // 使用全局文档事件委托处理动态元素
    document.addEventListener("click", (e) => {
        // 编辑配置
        const editBtn = e.target.closest('[data-action="edit-config"]');
        if (editBtn) {
            const category = editBtn.dataset.category;
            const type = editBtn.dataset.type || "memory";
            if (showConfigModalFn) showConfigModalFn(category, type);
            return;
        }

        // 删除配置
        const deleteBtn = e.target.closest('[data-action="delete-config"]');
        if (deleteBtn) {
            const category = deleteBtn.dataset.category;
            const type = deleteBtn.dataset.type || "memory";
            if (deleteConfigFn) deleteConfigFn(category, type);
            return;
        }

        // 移除世界书
        const removeBookBtn = e.target.closest('[data-action="remove-book"]');
        if (removeBookBtn) {
            const bookName = removeBookBtn.dataset.book;
            if (confirm(`确定要移除世界书 "${bookName}" 吗？`)) {
                removeImportedBook(bookName);
                refreshWorldBookList();
                Logger.log(`已移除世界书 "${bookName}"`);
            }
            return;
        }
    });
}

/**
 * 绑定配置导入导出事件
 */
function bindConfigImportExportEvents() {
    // 导出配置
    document
        .getElementById("mm-export-config")
        ?.addEventListener("click", () => {
            const json = exportConfig();
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "memory-manager-config.json";
            a.click();
            URL.revokeObjectURL(url);
        });

    // 导入配置
    document
        .getElementById("mm-import-config")
        ?.addEventListener("click", () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".json";
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    const text = await file.text();
                    if (importConfig(text)) {
                        alert("配置导入成功");
                        if (refreshAIConfigListFn) refreshAIConfigListFn();
                        loadGlobalSettingsUI();
                    } else {
                        alert("配置导入失败");
                    }
                }
            };
            input.click();
        });

    // 重置配置
    document
        .getElementById("mm-reset-config")
        ?.addEventListener("click", () => {
            if (confirm("确定要重置所有配置吗？此操作不可撤销。")) {
                resetConfig();
                if (refreshAIConfigListFn) refreshAIConfigListFn();
                loadGlobalSettingsUI();
                alert("配置已重置");
            }
        });
}

/**
 * 绑定流程配置事件
 */
function bindFlowConfigEvents() {
    // 流程配置按钮
    document
        .getElementById("mm-flow-config")
        ?.addEventListener("click", () => {
            if (showFlowConfigModalFn) showFlowConfigModalFn();
        });

    // 流程配置弹窗关闭
    document
        .querySelector("#mm-flow-config-modal .mm-modal-close")
        ?.addEventListener("click", () => {
            if (hideFlowConfigModalFn) hideFlowConfigModalFn();
        });

    // 流程配置重置
    document
        .getElementById("mm-flow-config-reset")
        ?.addEventListener("click", () => {
            if (resetFlowConfigFn) resetFlowConfigFn();
        });

    // 流程配置导入
    document
        .getElementById("mm-flow-config-import")
        ?.addEventListener("click", () => {
            if (importFlowConfigFn) importFlowConfigFn();
        });

    // 流程配置导出
    document
        .getElementById("mm-flow-config-export")
        ?.addEventListener("click", () => {
            if (exportFlowConfigFn) exportFlowConfigFn();
        });

    // 流程配置保存
    document
        .getElementById("mm-flow-config-save")
        ?.addEventListener("click", () => {
            if (saveFlowConfigFn) saveFlowConfigFn();
        });

    // 流程配置弹窗拖拽缩放
    if (initFlowConfigResizeFn) initFlowConfigResizeFn();
}

/**
 * 绑定提示词编辑器事件
 */
function bindPromptEditorEvents() {
    // 打开提示词编辑器
    document
        .getElementById("mm-edit-prompt")
        ?.addEventListener("click", () => {
            if (showPromptEditorFn) showPromptEditorFn();
        });

    // 关闭提示词编辑器
    document
        .querySelector("#mm-prompt-editor-modal .mm-modal-close")
        ?.addEventListener("click", () => {
            if (hidePromptEditorFn) hidePromptEditorFn();
        });

    // 取消按钮
    document
        .getElementById("mm-prompt-cancel")
        ?.addEventListener("click", () => {
            if (hidePromptEditorFn) hidePromptEditorFn();
        });

    // 保存按钮
    document
        .getElementById("mm-prompt-save")
        ?.addEventListener("click", () => {
            if (savePromptFileFn) savePromptFileFn();
        });

    // 另存为按钮
    document
        .getElementById("mm-prompt-save-as")
        ?.addEventListener("click", () => {
            if (saveAsPromptFileFn) saveAsPromptFileFn();
        });

    // 删除按钮
    document
        .getElementById("mm-prompt-delete")
        ?.addEventListener("click", () => {
            if (deletePromptFileFn) deletePromptFileFn();
        });

    // 恢复默认按钮
    document
        .getElementById("mm-prompt-restore-default")
        ?.addEventListener("click", () => {
            if (restoreDefaultPromptFn) restoreDefaultPromptFn();
        });

    // 导入按钮
    document
        .getElementById("mm-prompt-import")
        ?.addEventListener("click", () => {
            if (importPromptFileFn) importPromptFileFn();
        });

    // 导出按钮
    document
        .getElementById("mm-prompt-export")
        ?.addEventListener("click", () => {
            if (exportPromptFileFn) exportPromptFileFn();
        });

    // 提示词类型切换
    document
        .getElementById("mm-prompt-type-keywords")
        ?.addEventListener("click", () => {
            if (switchPromptTypeFn) switchPromptTypeFn("keywords");
        });

    document
        .getElementById("mm-prompt-type-historical")
        ?.addEventListener("click", () => {
            if (switchPromptTypeFn) switchPromptTypeFn("historical");
        });

    document
        .getElementById("mm-prompt-type-plot-optimize")
        ?.addEventListener("click", () => {
            if (switchPromptTypeFn) switchPromptTypeFn("plot-optimize");
        });
}

/**
 * 绑定游戏相关事件
 */
function bindGameEvents() {
    // 游戏按钮点击事件
    document.querySelectorAll(".mm-game-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
            const gameId = chip.dataset.game;
            if (gameId) openGame(gameId);
        });
    });
}

// 游戏配置
const gameConfigs = {
    lifeRestart: { name: "人生重开模拟器", path: "games/lifeRestart/index.html" },
    clumsyBird: { name: "笨鸟先飞", path: "games/clumsyBird/index.html" },
    city3d: { name: "3D城市", path: "games/3dcity/index.html" },
    tetris: { name: "俄罗斯方块", path: "games/tetris/index.html" },
    mario: { name: "超级马里奥", path: "games/mario/super-mario-bros/index.html" },
    retrosnake: { name: "复古贪吃蛇", path: "games/retrosnake/index.html" },
    layaSnakes: { name: "贪吃蛇小作战", path: "games/laya-snakes/index.html" },
};

let gamePanel = null;

/**
 * 创建游戏面板
 */
function createGamePanel() {
    if (document.getElementById("mm-game-panel")) return;

    const panel = document.createElement("div");
    panel.id = "mm-game-panel";
    panel.className = "mm-game-panel";
    panel.innerHTML = `
        <div class="mm-game-panel-header">
            <span class="mm-game-title">
                <i class="fa-solid fa-gamepad"></i>
                <span class="mm-game-title-text">游戏</span>
            </span>
            <div class="mm-game-panel-controls">
                <button class="mm-game-fullscreen mm-btn mm-btn-icon" title="全屏/横屏">
                    <i class="fa-solid fa-expand"></i>
                </button>
                <button class="mm-game-minimize mm-btn mm-btn-icon" title="最小化">
                    <i class="fa-solid fa-minus"></i>
                </button>
                <button class="mm-game-close mm-btn mm-btn-icon" title="关闭">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
        <div class="mm-game-viewport">
            <div class="mm-game-landscape-overlay">
                <div class="mm-game-landscape-card">
                    <div class="mm-game-landscape-title">需要横屏显示</div>
                    <div class="mm-game-landscape-desc">已为移动端优化</div>
                    <div class="mm-game-landscape-actions">
                        <button class="mm-game-close-overlay mm-btn">关闭</button>
                    </div>
                </div>
            </div>
            <iframe class="mm-game-iframe" src="" allow="fullscreen" allowfullscreen></iframe>
        </div>
    `;
    document.body.appendChild(panel);
    gamePanel = panel;

    // 应用当前主题
    const settings = getGlobalSettings();
    const theme = settings.theme || "default";
    if (theme !== "default") {
        panel.setAttribute("data-mm-theme", theme);
    }

    // 绑定游戏面板事件
    panel.querySelector(".mm-game-close")?.addEventListener("click", closeGame);
    panel.querySelector(".mm-game-close-overlay")?.addEventListener("click", closeGame);
    panel.querySelector(".mm-game-minimize")?.addEventListener("click", () => {
        panel.classList.toggle("mm-minimized");
        const icon = panel.querySelector(".mm-game-minimize i");
        if (panel.classList.contains("mm-minimized")) {
            icon.className = "fa-solid fa-expand";
        } else {
            icon.className = "fa-solid fa-minus";
        }
    });

    panel.querySelector(".mm-game-fullscreen")?.addEventListener("click", async () => {
        try {
            if (document.fullscreenElement === panel) {
                await document.exitFullscreen();
            } else {
                await panel.requestFullscreen({ navigationUI: "hide" });
            }
        } catch (e) {
            Logger.warn("全屏切换失败:", e);
        }
    });

    // 拖动功能
    setupGamePanelDrag(panel);
}

/**
 * 设置游戏面板拖动
 */
function setupGamePanelDrag(panel) {
    const header = panel.querySelector(".mm-game-panel-header");
    let isDragging = false;
    let startX, startY, initialX, initialY;

    function startDrag(e) {
        if (e.target.closest("button")) return;
        isDragging = true;

        const rect = panel.getBoundingClientRect();
        if (e.type === "touchstart") {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        } else {
            startX = e.clientX;
            startY = e.clientY;
        }
        initialX = rect.left;
        initialY = rect.top;

        panel.style.left = initialX + "px";
        panel.style.top = initialY + "px";
        panel.style.transform = "none";

        document.addEventListener("mousemove", drag);
        document.addEventListener("touchmove", drag, { passive: false });
        document.addEventListener("mouseup", stopDrag);
        document.addEventListener("touchend", stopDrag);
    }

    function drag(e) {
        if (!isDragging) return;
        e.preventDefault();

        let currentX, currentY;
        if (e.type === "touchmove") {
            currentX = e.touches[0].clientX;
            currentY = e.touches[0].clientY;
        } else {
            currentX = e.clientX;
            currentY = e.clientY;
        }

        let newLeft = initialX + (currentX - startX);
        let newTop = initialY + (currentY - startY);

        const rect = panel.getBoundingClientRect();
        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - rect.width));
        newTop = Math.max(0, Math.min(newTop, window.innerHeight - rect.height));

        panel.style.left = newLeft + "px";
        panel.style.top = newTop + "px";
    }

    function stopDrag() {
        isDragging = false;
        document.removeEventListener("mousemove", drag);
        document.removeEventListener("touchmove", drag);
        document.removeEventListener("mouseup", stopDrag);
        document.removeEventListener("touchend", stopDrag);
    }

    header?.addEventListener("mousedown", startDrag);
    header?.addEventListener("touchstart", startDrag, { passive: false });
}

/**
 * 打开游戏
 */
async function openGame(gameId) {
    const config = gameConfigs[gameId];
    if (!config) return;

    createGamePanel();
    const panel = document.getElementById("mm-game-panel");
    const iframe = panel.querySelector(".mm-game-iframe");
    const titleText = panel.querySelector(".mm-game-title-text");

    titleText.textContent = config.name;
    panel.style.cssText = "";
    panel.classList.remove("mm-minimized");
    panel.dataset.gameId = gameId;
    panel.classList.add("mm-visible");

    const basePath = await detectExtensionPath();
    iframe.src = `${basePath}/${config.path}`;
}

/**
 * 关闭游戏
 */
async function closeGame() {
    const panel = document.getElementById("mm-game-panel");
    if (!panel) return;

    panel.classList.remove("mm-visible");
    panel.dataset.gameId = "";
    const iframe = panel.querySelector(".mm-game-iframe");
    if (iframe) iframe.src = "";

    try {
        if (document.fullscreenElement === panel) {
            await document.exitFullscreen();
        }
    } catch (e) {}
}

/**
 * 刷新 AI 配置列表
 */
export function refreshAIConfigList() {
    const container = document.getElementById("mm-ai-config-list");
    if (!container) return;

    const config = loadConfig();
    const memoryConfigs = config?.memoryConfigs || {};
    const summaryConfigs = config?.summaryConfigs || {};

    const totalConfigs =
        Object.keys(memoryConfigs).length +
        Object.keys(summaryConfigs).length;

    if (totalConfigs === 0) {
        container.innerHTML =
            '<div class="mm-empty-state"><p>暂无配置</p></div>';
        return;
    }

    let html = "";

    // 转义 HTML，防止 XSS 攻击
    const escapeHtml = (text) => {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    };

    if (Object.keys(memoryConfigs).length > 0) {
        html += '<div class="mm-config-group-title">记忆分类配置</div>';
        for (const [category, aiConfig] of Object.entries(memoryConfigs)) {
            const statusClass = aiConfig.enabled
                ? "mm-status-active"
                : "mm-status-inactive";
            const safeCategory = escapeHtml(category);
            const safeModel = escapeHtml(aiConfig.model || "-");
            html += `
                <div class="mm-ai-config-item">
                    <div class="mm-config-info">
                        <span class="mm-status-dot ${statusClass}"></span>
                        <span class="mm-config-name">${safeCategory}</span>
                        <span class="mm-config-model">${safeModel} | 关键词: ${aiConfig.maxKeywords || 10}</span>
                    </div>
                    <div class="mm-config-actions">
                        <button class="mm-btn mm-btn-xs" data-action="edit-config" data-category="${safeCategory}" data-type="memory">
                            <i class="fa-solid fa-edit"></i>
                        </button>
                        <button class="mm-btn mm-btn-xs mm-btn-danger" data-action="delete-config" data-category="${safeCategory}" data-type="memory">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>`;
        }
    }

    if (Object.keys(summaryConfigs).length > 0) {
        html +=
            '<div class="mm-config-group-title" style="margin-top: 12px;">总结世界书配置</div>';
        for (const [bookName, aiConfig] of Object.entries(summaryConfigs)) {
            const statusClass = aiConfig.enabled
                ? "mm-status-active"
                : "mm-status-inactive";
            const safeBookName = escapeHtml(bookName);
            const safeModel = escapeHtml(aiConfig.model || "-");
            html += `
                <div class="mm-ai-config-item">
                    <div class="mm-config-info">
                        <span class="mm-status-dot ${statusClass}"></span>
                        <span class="mm-config-name">${safeBookName}</span>
                        <span class="mm-config-model">${safeModel} | 事件: ${aiConfig.maxHistoryEvents || 15}</span>
                    </div>
                    <div class="mm-config-actions">
                        <button class="mm-btn mm-btn-xs" data-action="edit-config" data-category="${safeBookName}" data-type="summary">
                            <i class="fa-solid fa-edit"></i>
                        </button>
                        <button class="mm-btn mm-btn-xs mm-btn-danger" data-action="delete-config" data-category="${safeBookName}" data-type="summary">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>`;
        }
    }

    container.innerHTML = html;
}

/**
 * 加载全局设置到 UI
 */
export function loadGlobalSettingsUI() {
    const settings = getGlobalSettings();

    // 插件开关
    const pluginToggle = document.getElementById("mm-plugin-toggle");
    if (pluginToggle) {
        pluginToggle.classList.toggle("mm-active", settings.enabled !== false);
        pluginToggle.title = settings.enabled !== false ? "关闭插件" : "启用插件";
    }

    // 悬浮球
    const floatBallCheckbox = document.getElementById("mm-show-float-ball");
    if (floatBallCheckbox) {
        floatBallCheckbox.checked = settings.showFloatBall !== false;
    }

    // 日志
    const logsCheckbox = document.getElementById("mm-show-logs");
    if (logsCheckbox) {
        logsCheckbox.checked = settings.showLogs === true;
    }

    // 发送前检查
    const previewCheckbox = document.getElementById("mm-show-request-preview");
    if (previewCheckbox) {
        previewCheckbox.checked = settings.showRequestPreview === true;
    }

    // 流程配置按钮（始终显示，不再与发送前检查绑定）
    const flowConfigBtn = document.getElementById("mm-flow-config");
    if (flowConfigBtn) {
        flowConfigBtn.style.display = "inline-flex";
    }

    // 仅发送索引
    const indexOnlyCheckbox = document.getElementById("mm-send-index-only");
    if (indexOnlyCheckbox) {
        indexOnlyCheckbox.checked = settings.sendIndexOnly === true;
    }

    // 索引模式卡片
    const indexModeCard = document.getElementById("mm-index-mode-card");
    if (indexModeCard) {
        indexModeCard.style.display = settings.sendIndexOnly ? "block" : "none";
    }

    // 索引合并开关
    const indexMergeCheckbox = document.getElementById("mm-index-merge-enabled");
    if (indexMergeCheckbox) {
        indexMergeCheckbox.checked = settings.indexMergeEnabled === true;
    }

    // 索引合并配置卡片
    const indexMergeConfigCard = document.getElementById("mm-index-merge-config-card");
    if (indexMergeConfigCard) {
        indexMergeConfigCard.style.display = settings.indexMergeEnabled ? "flex" : "none";
    }

    // 汇总检查
    const summaryCheckbox = document.getElementById("mm-show-summary-check");
    if (summaryCheckbox) {
        summaryCheckbox.checked = settings.showSummaryCheck === true;
    }

    // 近期剧情
    const recentPlotCheckbox = document.getElementById("mm-enable-recent-plot");
    if (recentPlotCheckbox) {
        recentPlotCheckbox.checked = settings.enableRecentPlot !== false;
    }

    // 剧情末尾字数滑条
    const recentPlotLengthContainer = document.getElementById("mm-recent-plot-length-container");
    const recentPlotLengthInput = document.getElementById("mm-recent-plot-length");
    const recentPlotLengthValue = document.getElementById("mm-recent-plot-length-value");
    if (recentPlotLengthContainer) {
        // 根据启用状态显示/隐藏
        recentPlotLengthContainer.style.display = settings.enableRecentPlot !== false ? "block" : "none";
    }
    if (recentPlotLengthInput) {
        recentPlotLengthInput.value = settings.recentPlotLength ?? 200;
    }
    if (recentPlotLengthValue) {
        recentPlotLengthValue.textContent = settings.recentPlotLength ?? 200;
    }

    // 上下文轮次
    const contextRoundsInput = document.getElementById("mm-context-rounds");
    const contextRoundsValue = document.getElementById("mm-context-rounds-value");
    if (contextRoundsInput) {
        contextRoundsInput.value = settings.contextRounds ?? 5;
    }
    if (contextRoundsValue) {
        contextRoundsValue.textContent = settings.contextRounds ?? 5;
    }

    // 记忆搜索助手
    const interactiveSearchCheckbox = document.getElementById("mm-enable-interactive-search");
    if (interactiveSearchCheckbox) {
        interactiveSearchCheckbox.checked = settings.enableInteractiveSearch === true;
    }
    // 更新记忆搜索助手徽章
    updateMemorySearchBadge(settings.enableInteractiveSearch === true);

    // 剧情优化助手
    const plotOptimizeCheckbox = document.getElementById("mm-enable-plot-optimize");
    if (plotOptimizeCheckbox) {
        plotOptimizeCheckbox.checked = settings.enablePlotOptimize === true;
    }
    // 更新剧情优化助手徽章
    updatePlotOptimizeBadge(settings.enablePlotOptimize === true);

    // 更新索引合并模型显示
    updateIndexMergeModelDisplay();

    // 更新剧情优化模型显示
    updatePlotOptimizeModelDisplay();

    // 初始化标签过滤 UI
    initTagFilterUI(settings.contextTagFilter);
}

/**
 * 更新索引合并配置卡片显示的模型名称
 */
export function updateIndexMergeModelDisplay() {
    const settings = getGlobalSettings();
    const config = settings.indexMergeConfig || {};
    const displayEl = document.getElementById("mm-index-merge-model-display");
    if (displayEl) {
        displayEl.textContent = config.model || "未配置";
    }
}

/**
 * 更新剧情优化配置卡片显示的模型名称
 */
export function updatePlotOptimizeModelDisplay() {
    const settings = getGlobalSettings();
    const config = settings.plotOptimizeConfig || {};
    const displayEl = document.getElementById("mm-plot-optimize-model-display");
    if (displayEl) {
        displayEl.textContent = config.model || "未配置";
    }
}

/**
 * 更新记忆搜索助手徽章状态
 * @param {boolean} enabled - 是否启用
 */
export function updateMemorySearchBadge(enabled) {
    const badge = document.getElementById("mm-interactive-search-badge");
    if (badge) {
        if (enabled) {
            badge.textContent = "开启";
            badge.classList.add("active");
        } else {
            badge.textContent = "关闭";
            badge.classList.remove("active");
        }
    }
}

/**
 * 更新剧情优化助手徽章状态
 * @param {boolean} enabled - 是否启用
 */
export function updatePlotOptimizeBadge(enabled) {
    const badge = document.getElementById("mm-plot-optimize-badge");
    if (badge) {
        if (enabled) {
            badge.textContent = "开启";
            badge.classList.add("active");
        } else {
            badge.textContent = "关闭";
            badge.classList.remove("active");
        }
    }
}

/**
 * 更新多AI生成徽章状态
 * @param {boolean} enabled - 是否启用
 */
export function updateMultiAIBadge(enabled) {
    const badge = document.getElementById("mm-multi-ai-badge");
    if (badge) {
        if (enabled) {
            badge.textContent = "开启";
            badge.classList.add("active");
        } else {
            badge.textContent = "关闭";
            badge.classList.remove("active");
        }
    }
}

/**
 * 刷新多AI provider列表
 */
export function refreshMultiAIProviderList() {
    const listEl = document.getElementById("mm-multi-ai-provider-list");
    const emptyEl = document.getElementById("mm-multi-ai-provider-empty");
    if (!listEl) return;

    const multiAI = getMultiAIConfig();
    const providers = multiAI.providers || [];

    listEl.innerHTML = "";

    if (providers.length === 0) {
        if (emptyEl) emptyEl.style.display = "flex";
        return;
    }

    if (emptyEl) emptyEl.style.display = "none";

    providers.forEach(provider => {
        const item = document.createElement("div");
        item.className = "mm-multi-ai-provider-item";
        item.dataset.providerId = provider.id;

        item.innerHTML = `
            <div class="mm-multi-ai-provider-info">
                <label class="mm-multi-ai-provider-checkbox">
                    <input type="checkbox" ${provider.enabled ? 'checked' : ''} />
                    <span class="mm-multi-ai-provider-name">${provider.name}</span>
                </label>
                <span class="mm-multi-ai-provider-details">
                    ${provider.model} | ${provider.streaming ? '流式' : '非流式'} | ${provider.apiUrl ? '已配置' : '未配置'}
                </span>
            </div>
            <div class="mm-multi-ai-provider-actions">
                <button type="button" class="mm-btn mm-btn-xs mm-btn-secondary mm-multi-ai-edit" title="编辑">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button type="button" class="mm-btn mm-btn-xs mm-btn-danger mm-multi-ai-delete" title="删除">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;

        // 绑定启用/禁用开关
        const checkbox = item.querySelector('input[type="checkbox"]');
        checkbox?.addEventListener("change", (e) => {
            updateProvider(provider.id, { enabled: e.target.checked });
            if (typeof toastr !== 'undefined') {
                toastr.success(`API配置 "${provider.name}" 已${e.target.checked ? '启用' : '禁用'}`, "记忆管理并发系统");
            }
        });

        // 绑定编辑按钮
        item.querySelector(".mm-multi-ai-edit")?.addEventListener("click", async () => {
            const result = await showMultiAIConfigModal(provider.id);
            if (result) {
                refreshMultiAIProviderList();
            }
        });

        // 绑定删除按钮
        item.querySelector(".mm-multi-ai-delete")?.addEventListener("click", () => {
            if (confirm(`确定删除API配置 "${provider.name}" 吗？`)) {
                deleteProvider(provider.id);
                refreshMultiAIProviderList();
                if (typeof toastr !== 'undefined') {
                    toastr.success(`API配置 "${provider.name}" 已删除`, "记忆管理并发系统");
                }
            }
        });

        listEl.appendChild(item);
    });
}

/**
 * 绑定多AI生成事件
 */
function bindMultiAIEvents() {
    // 多AI生成折叠卡片
    document
        .getElementById("mm-multi-ai-toggle")
        ?.addEventListener("click", () => {
            const card = document.getElementById("mm-multi-ai-card");
            if (card) {
                card.classList.toggle("expanded");
                if (card.classList.contains("expanded")) {
                    refreshMultiAIProviderList();
                }
            }
        });

    // 启用多AI生成开关
    document
        .getElementById("mm-enable-multi-ai")
        ?.addEventListener("change", (e) => {
            const checked = e.target.checked;
            setMultiAIEnabled(checked);
            updateMultiAIBadge(checked);
            if (typeof toastr !== 'undefined') {
                toastr.success(`多AI生成功能已${checked ? "启用" : "禁用"}`, "记忆管理并发系统");
            }
        });

    // 添加API配置按钮
    document
        .getElementById("mm-multi-ai-add")
        ?.addEventListener("click", async () => {
            const result = await showMultiAIConfigModal(null);
            if (result) {
                refreshMultiAIProviderList();
            }
        });

    // 添加提示词预设按钮
    const presetBtn = document.getElementById("mm-multi-ai-add-preset");
    presetBtn?.addEventListener("click", () => {
            showPromptPresetModal(null);
        });

    // 初始化提示词预设列表
    renderPromptPresetList();

    // 初始化多AI状态
    const multiAI = getMultiAIConfig();
    const enableCheckbox = document.getElementById("mm-enable-multi-ai");
    if (enableCheckbox) {
        enableCheckbox.checked = multiAI.enabled || false;
    }
    updateMultiAIBadge(multiAI.enabled || false);
}

/**
 * 绑定所有事件
 */
export function bindEvents() {
    bindPanelEvents();
    bindSettingsEvents();
    bindConfigModalEvents();
    bindWorldBookListEvents();
    bindConfigImportExportEvents();
    bindFlowConfigEvents();
    bindPromptEditorEvents();
    bindTagFilterEvents();
    bindWorldbookControlEvents();
    bindGameEvents();
    bindMultiAIEvents();

    Logger.log("UI 事件绑定完成");
}
