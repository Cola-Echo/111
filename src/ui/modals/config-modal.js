/**
 * AI 配置弹窗模块
 * @module ui/modals/config-modal
 */

import APIAdapter from "@api/adapter";
import {
    deleteMemoryConfig,
    deleteSummaryConfig,
    getGlobalSettings,
    loadConfig,
    setMemoryConfig,
    setSummaryConfig,
    updateGlobalSettings,
} from "@config/config-manager";
import Logger from "@core/logger";
import { refreshWorldBookList } from "@worldbook/refresh";
import { getWorldBookList, getWorldBookEntries } from "@worldbook/api";

// 更新显示回调函数（将在初始化时注入）
let updateIndexMergeModelDisplayFn = null;
let updatePlotOptimizeModelDisplayFn = null;
let refreshAIConfigListFn = null;

/**
 * 设置更新显示函数
 */
export function setUpdateDisplayFunctions(indexMergeFn, plotOptimizeFn, refreshConfigListFn) {
    updateIndexMergeModelDisplayFn = indexMergeFn;
    updatePlotOptimizeModelDisplayFn = plotOptimizeFn;
    refreshAIConfigListFn = refreshConfigListFn;
}

// 当前编辑状态
let currentEditingCategory = null;
let currentEditingType = null;

// 剧情优化配置中选中的世界书和条目（临时状态）
let plotConfigSelectedBooks = new Set();
let plotConfigSelectedEntries = {};
// 配置弹窗世界书缓存
let configWorldBooksCache = [];
let configEntriesCache = {};

/**
 * 切换配置标签页
 * @param {string} tabName 标签页名称 ('api' | 'context')
 */
export function switchConfigTab(tabName) {
    const tabs = document.querySelectorAll(".mm-config-tab");
    const contents = document.querySelectorAll(".mm-config-tab-content");

    tabs.forEach((tab) => {
        const htmlTab = /** @type {HTMLElement} */ (tab);
        htmlTab.classList.toggle("active", htmlTab.dataset.tab === tabName);
    });

    contents.forEach((content) => {
        const htmlContent = /** @type {HTMLElement} */ (content);
        const isActive = htmlContent.id === `mm-config-tab-${tabName}-content`;
        htmlContent.classList.toggle("active", isActive);
        htmlContent.style.display = isActive ? "block" : "none";
    });
}

/**
 * 切换自定义格式选项显示
 * @param {boolean} show 是否显示
 */
export function toggleCustomFormatOptions(show) {
    const customOptions = document.getElementById("mm-custom-format-options");
    if (customOptions) {
        customOptions.style.display = show ? "block" : "none";
    }
}

/**
 * 显示配置弹窗
 * @param {string} category 分类名称
 * @param {string} type 类型 ('memory' | 'summary' | 'merge' | 'plot')
 */
export function showConfigModal(category, type = "memory") {
    currentEditingCategory = category;
    currentEditingType = type;

    const modal = document.getElementById("mm-ai-config-modal");
    if (!modal) return;

    // 隐藏 Tab 切换（仅剧情优化显示）
    const tabsEl = document.getElementById("mm-config-tabs");
    if (tabsEl) tabsEl.style.display = type === "plot" ? "flex" : "none";
    switchConfigTab("api");

    const config = loadConfig();
    const globalSettings = getGlobalSettings();

    // 根据类型获取配置
    let itemConfig = {};
    if (type === "memory") {
        itemConfig = config?.memoryConfigs?.[category] || {};
    } else if (type === "summary") {
        itemConfig = config?.summaryConfigs?.[category] || {};
    } else if (type === "merge" || type === "indexMerge") {
        itemConfig = globalSettings.indexMergeConfig || {};
    } else if (type === "plot") {
        itemConfig = globalSettings.plotOptimizeConfig || {};
    }

    const categoryNameEl = document.getElementById("mm-config-category-name");
    if (categoryNameEl) categoryNameEl.textContent = category;

    const enabledEl = document.getElementById("mm-config-enabled");
    if (enabledEl) enabledEl.checked = itemConfig.enabled !== false;

    const urlEl = document.getElementById("mm-config-url");
    if (urlEl) urlEl.value = itemConfig.apiUrl || "";

    const keyEl = document.getElementById("mm-config-key");
    if (keyEl) keyEl.value = itemConfig.apiKey || "";

    const modelEl = document.getElementById("mm-config-model");
    if (modelEl) {
        modelEl.innerHTML =
            '<option value="" disabled>--- 请获取模型 ---</option>';
        if (itemConfig.model) {
            const option = document.createElement("option");
            option.value = itemConfig.model;
            option.textContent = itemConfig.model;
            option.selected = true;
            modelEl.appendChild(option);
        } else {
            modelEl.selectedIndex = 0;
        }
    }

    const maxTokensEl = document.getElementById("mm-config-max-tokens");
    if (maxTokensEl) maxTokensEl.value = itemConfig.maxTokens || 2000;

    const temperatureEl = document.getElementById("mm-config-temperature");
    if (temperatureEl) temperatureEl.value = itemConfig.temperature || 0.7;

    const temperatureValueEl = document.getElementById(
        "mm-config-temperature-value",
    );
    if (temperatureValueEl)
        temperatureValueEl.textContent = itemConfig.temperature || 0.7;

    const relevanceEl = document.getElementById("mm-config-relevance");
    if (relevanceEl) relevanceEl.value = itemConfig.relevanceThreshold || 0.6;

    const relevanceValueEl = document.getElementById(
        "mm-config-relevance-value",
    );
    if (relevanceValueEl)
        relevanceValueEl.textContent = itemConfig.relevanceThreshold || 0.6;

    const customTemplateEl = document.getElementById(
        "mm-config-custom-template",
    );
    if (customTemplateEl)
        customTemplateEl.value = itemConfig.customRequestTemplate || "";

    const responsePathEl = document.getElementById("mm-config-response-path");
    if (responsePathEl)
        responsePathEl.value = itemConfig.customResponsePath || "";

    const keywordsGroup = document.getElementById("mm-config-keywords-group");
    const eventsGroup = document.getElementById("mm-config-events-group");

    if (type === "memory") {
        if (keywordsGroup) keywordsGroup.classList.remove("mm-hidden");
        if (eventsGroup) eventsGroup.classList.add("mm-hidden");
        const keywordsInput = document.getElementById("mm-config-max-keywords");
        if (keywordsInput) keywordsInput.value = itemConfig.maxKeywords || 10;
    } else if (type === "merge" || type === "indexMerge") {
        // 索引合并模式：显示关键词设置，隐藏事件设置
        if (keywordsGroup) keywordsGroup.classList.remove("mm-hidden");
        if (eventsGroup) eventsGroup.classList.add("mm-hidden");
        const keywordsInput = document.getElementById("mm-config-max-keywords");
        if (keywordsInput) keywordsInput.value = itemConfig.maxKeywords || 10;
    } else if (type === "plot") {
        // 剧情优化模式：隐藏关键词和事件设置
        if (keywordsGroup) keywordsGroup.classList.add("mm-hidden");
        if (eventsGroup) eventsGroup.classList.add("mm-hidden");
        // 初始化剧情优化上下文选项卡
        initPlotOptimizeContextTab(itemConfig);
    } else {
        // 总结模式
        if (keywordsGroup) keywordsGroup.classList.add("mm-hidden");
        if (eventsGroup) eventsGroup.classList.remove("mm-hidden");
        const eventsInput = document.getElementById("mm-config-max-events");
        if (eventsInput) eventsInput.value = itemConfig.maxHistoryEvents || 15;
    }

    const format = itemConfig.apiFormat || "openai";
    const formatRadio = document.querySelector(
        `input[name="mm-api-format"][value="${format}"]`,
    );
    if (formatRadio) formatRadio.checked = true;
    toggleCustomFormatOptions(format === "custom");

    const testResultEl = document.getElementById("mm-test-result");
    if (testResultEl) testResultEl.textContent = "";

    modal.classList.add("mm-modal-visible");
}

/**
 * 隐藏配置弹窗
 */
export function hideConfigModal() {
    const modal = document.getElementById("mm-ai-config-modal");
    if (modal) modal.classList.remove("mm-modal-visible");

    currentEditingCategory = null;
    currentEditingType = null;
}

/**
 * 初始化剧情优化上下文选项卡
 * @param {object} config 剧情优化配置
 */
export async function initPlotOptimizeContextTab(config) {
    // 初始化上下文参考轮次
    const roundsEl = document.getElementById("mm-plot-context-rounds");
    const roundsValueEl = document.getElementById("mm-plot-context-rounds-value");
    if (roundsEl) {
        roundsEl.value = config.contextRounds ?? 5;
        if (roundsValueEl) roundsValueEl.textContent = roundsEl.value;
    }

    // 初始化角色描述包含开关
    const includeCharEl = document.getElementById("mm-config-char-include-checkbox");
    if (includeCharEl) {
        includeCharEl.checked = config.includeCharDescription !== false;
    }

    // 加载世界书列表
    await loadConfigWorldBooks(config.selectedBooks || [], config.selectedEntries || {});

    // 加载角色描述
    await loadConfigCharDescription();
}

/**
 * 保存配置
 */
export async function saveConfig() {
    if (!currentEditingCategory || !currentEditingType) return;

    const enabledEl = document.getElementById("mm-config-enabled");
    const urlEl = document.getElementById("mm-config-url");
    const keyEl = document.getElementById("mm-config-key");
    const modelEl = document.getElementById("mm-config-model");
    const maxTokensEl = document.getElementById("mm-config-max-tokens");
    const temperatureEl = document.getElementById("mm-config-temperature");
    const relevanceEl = document.getElementById("mm-config-relevance");
    const customTemplateEl = document.getElementById(
        "mm-config-custom-template",
    );
    const responsePathEl = document.getElementById("mm-config-response-path");

    // 验证必填字段
    const apiUrl = urlEl?.value?.trim() || "";
    const model = modelEl?.value?.trim() || "";

    if (!apiUrl) {
        alert("请填写 API URL");
        return;
    }
    if (!model) {
        alert("请先获取并选择模型");
        return;
    }

    const formatRadio = document.querySelector(
        'input[name="mm-api-format"]:checked',
    );
    const format = formatRadio ? formatRadio.value : "openai";

    const aiConfig = {
        enabled: enabledEl?.checked !== false,
        apiUrl: urlEl?.value || "",
        apiKey: keyEl?.value || "",
        model: modelEl?.value || "",
        maxTokens: parseInt(maxTokensEl?.value || "2000", 10),
        temperature: parseFloat(temperatureEl?.value || "0.7"),
        relevanceThreshold: parseFloat(relevanceEl?.value || "0.6"),
        apiFormat: format,
        customRequestTemplate: customTemplateEl?.value || "",
        customResponsePath: responsePathEl?.value || "",
    };

    if (currentEditingType === "memory") {
        const keywordsInput = document.getElementById("mm-config-max-keywords");
        aiConfig.maxKeywords = parseInt(keywordsInput?.value || "10", 10);
        setMemoryConfig(currentEditingCategory, aiConfig);
    } else if (currentEditingType === "summary") {
        const eventsInput = document.getElementById("mm-config-max-events");
        aiConfig.maxHistoryEvents = parseInt(eventsInput?.value || "15", 10);
        setSummaryConfig(currentEditingCategory, aiConfig);
    } else if (
        currentEditingType === "indexMerge" ||
        currentEditingType === "merge"
    ) {
        const keywordsInput = document.getElementById("mm-config-max-keywords");
        aiConfig.maxKeywords = parseInt(keywordsInput?.value || "10", 10);
        updateGlobalSettings({ indexMergeConfig: aiConfig });
        // 更新显示
        if (updateIndexMergeModelDisplayFn) updateIndexMergeModelDisplayFn();
    } else if (currentEditingType === "plot") {
        // 获取上下文选择配置元素
        const contextRoundsEl = document.getElementById("mm-plot-context-rounds");
        const includeCharEl = document.getElementById("mm-config-char-include-checkbox");

        // 获取现有配置以保留 promptFile 等其他字段
        const existingPlotConfig = getGlobalSettings().plotOptimizeConfig || {};

        const plotOptimizeConfig = {
            ...existingPlotConfig, // 保留现有配置（如 promptFile）
            apiFormat: format,
            apiUrl: urlEl?.value || "",
            apiKey: keyEl?.value || "",
            model: modelEl?.value || "",
            maxTokens: parseInt(maxTokensEl?.value || "2000", 10),
            temperature: parseFloat(temperatureEl?.value || "0.7"),
            customTemplate: customTemplateEl?.value || "",
            responsePath: responsePathEl?.value || "choices.0.message.content",
            // 上下文选择配置
            contextRounds: contextRoundsEl
                ? parseInt(contextRoundsEl.value) || 5
                : existingPlotConfig.contextRounds || 5,
            selectedBooks: Array.from(plotConfigSelectedBooks),
            selectedEntries: { ...plotConfigSelectedEntries },
            includeCharDescription: includeCharEl
                ? includeCharEl.checked
                : existingPlotConfig.includeCharDescription !== false,
        };
        updateGlobalSettings({ plotOptimizeConfig });
        // 更新显示
        if (updatePlotOptimizeModelDisplayFn) updatePlotOptimizeModelDisplayFn();
        Logger.log(`剧情优化配置已保存`);
    }

    Logger.log(`配置已保存: ${currentEditingCategory}`);
    hideConfigModal();
    // 刷新配置列表
    if (refreshAIConfigListFn) refreshAIConfigListFn();
    await refreshWorldBookList();
}

/**
 * 删除配置
 * @param {string} category 分类名称
 * @param {string} type 类型
 */
export async function deleteConfig(category, type = "memory") {
    if (!confirm(`确定要删除 "${category}" 的配置吗？`)) return;

    if (type === "memory") {
        deleteMemoryConfig(category);
    } else {
        deleteSummaryConfig(category);
    }

    Logger.log(`配置已删除: ${category}`);
    await refreshWorldBookList();
}

/**
 * 获取当前编辑状态
 * @returns {object} { category, type }
 */
export function getCurrentEditing() {
    return {
        category: currentEditingCategory,
        type: currentEditingType,
    };
}

/**
 * 测试 API 连接
 */
export async function testConnection() {
    const resultSpan = document.getElementById("mm-test-result");
    if (!resultSpan) return;

    resultSpan.textContent = "测试中...";
    resultSpan.className = "mm-test-result";

    const config = {
        apiFormat:
            document.querySelector('input[name="mm-api-format"]:checked')
                ?.value || "openai",
        apiUrl: document.getElementById("mm-config-url")?.value.trim() || "",
        apiKey: document.getElementById("mm-config-key")?.value.trim() || "",
        model: document.getElementById("mm-config-model")?.value.trim() || "",
        maxTokens:
            parseInt(document.getElementById("mm-config-max-tokens")?.value) ||
            2000,
        temperature:
            parseFloat(
                document.getElementById("mm-config-temperature")?.value,
            ) || 0.7,
        customRequestTemplate:
            document
                .getElementById("mm-config-custom-template")
                ?.value.trim() || null,
        customResponsePath:
            document.getElementById("mm-config-response-path")?.value.trim() ||
            null,
    };

    try {
        const result = await APIAdapter.testConnection(config);
        if (result.success) {
            resultSpan.textContent = `连接成功 (${result.latency}ms)`;
            resultSpan.className = "mm-test-result mm-test-success";
        } else {
            resultSpan.textContent = `连接失败: ${result.message}`;
            resultSpan.className = "mm-test-result mm-test-error";
        }
    } catch (error) {
        resultSpan.textContent = `测试出错: ${error.message}`;
        resultSpan.className = "mm-test-result mm-test-error";
    }
}

/**
 * 获取可用模型列表
 */
export async function fetchModels() {
    const fetchBtn = document.getElementById("mm-fetch-models");
    const modelSelect = document.getElementById("mm-config-model");
    const apiUrlInput = document.getElementById("mm-config-url");
    const apiKeyInput = document.getElementById("mm-config-key");

    if (!fetchBtn || !modelSelect || !apiUrlInput) return;

    let apiUrl = apiUrlInput.value.trim();
    if (!apiUrl) {
        alert("请先填写 API URL");
        return;
    }

    // 自动补全 /v1/models
    let modelsUrl = apiUrl;
    if (apiUrl.endsWith("/v1") || apiUrl.endsWith("/v1/")) {
        modelsUrl = apiUrl.replace(/\/v1\/?$/, "/v1/models");
    } else if (apiUrl.includes("/v1/chat/completions")) {
        modelsUrl = apiUrl.replace("/v1/chat/completions", "/v1/models");
    } else if (apiUrl.includes("/chat/completions")) {
        modelsUrl = apiUrl.replace("/chat/completions", "/models");
    } else if (!apiUrl.includes("/models")) {
        // 尝试添加 /v1/models
        modelsUrl = apiUrl.replace(/\/?$/, "") + "/v1/models";
    }

    // 显示加载状态
    fetchBtn.classList.add("mm-loading-models");
    const originalHTML = fetchBtn.innerHTML;
    fetchBtn.innerHTML = '<i class="fa-solid fa-spinner"></i> 获取中...';

    try {
        const headers = { "Content-Type": "application/json" };
        const apiKey = apiKeyInput?.value.trim();
        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const response = await fetch(modelsUrl, {
            method: "GET",
            headers,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        let models = [];
        if (data.data && Array.isArray(data.data)) {
            // OpenAI 格式: { data: [{ id: "model-name" }, ...] }
            models = data.data.map((m) => m.id || m.name).filter(Boolean);
        } else if (Array.isArray(data.models)) {
            // 某些 API 格式: { models: ["model1", "model2"] }
            models = data.models;
        } else if (Array.isArray(data)) {
            // 直接数组格式: ["model1", "model2"]
            models = data
                .map((m) => (typeof m === "string" ? m : m.id || m.name))
                .filter(Boolean);
        }

        if (models.length === 0) {
            alert("未找到可用模型");
            return;
        }

        // 排序模型列表
        models.sort();

        // 保存当前选中的模型（如果有）
        const currentModel = modelSelect.value;

        // 清空并填充 select
        modelSelect.innerHTML =
            '<option value="" disabled>--- 请选择模型 ---</option>';
        for (const model of models) {
            const option = document.createElement("option");
            option.value = model;
            option.textContent = model;
            // 如果是之前选中的模型，保持选中
            if (model === currentModel) {
                option.selected = true;
            }
            modelSelect.appendChild(option);
        }

        // 如果没有之前选中的，默认选第一个模型
        if (!currentModel && models.length > 0) {
            modelSelect.selectedIndex = 1; // 跳过 "请选择模型" 选项
        }

        Logger.log(`已获取 ${models.length} 个模型`);
    } catch (error) {
        Logger.error("获取模型列表失败:", error);
        alert(`获取模型失败: ${error.message}`);
    } finally {
        fetchBtn.classList.remove("mm-loading-models");
        fetchBtn.innerHTML = originalHTML;
    }
}

/**
 * 绑定配置弹窗事件
 */
export function bindConfigModalEvents() {
    // 关闭按钮
    document
        .querySelector("#mm-ai-config-modal .mm-modal-close")
        ?.addEventListener("click", hideConfigModal);

    // 取消按钮
    document
        .getElementById("mm-config-cancel")
        ?.addEventListener("click", hideConfigModal);

    // 保存按钮
    document
        .getElementById("mm-config-save")
        ?.addEventListener("click", saveConfig);

    // 温度滑块
    const temperatureEl = document.getElementById("mm-config-temperature");
    const temperatureValueEl = document.getElementById(
        "mm-config-temperature-value",
    );
    if (temperatureEl && temperatureValueEl) {
        temperatureEl.addEventListener("input", (e) => {
            temperatureValueEl.textContent = e.target.value;
        });
    }

    // 关联性阈值滑块
    const relevanceEl = document.getElementById("mm-config-relevance");
    const relevanceValueEl = document.getElementById(
        "mm-config-relevance-value",
    );
    if (relevanceEl && relevanceValueEl) {
        relevanceEl.addEventListener("input", (e) => {
            relevanceValueEl.textContent = e.target.value;
        });
    }

    // API 格式选择
    document
        .querySelectorAll('input[name="mm-api-format"]')
        .forEach((radio) => {
            radio.addEventListener("change", (e) => {
                toggleCustomFormatOptions(e.target.value === "custom");
            });
        });
}

// ============================================================================
// 剧情优化配置 - 世界书选择器
// ============================================================================

/**
 * 高亮搜索文本
 * 修复：先转义 HTML，再添加高亮标签，防止 XSS 攻击
 */
function highlightConfigSearchText(text, searchTerm) {
    if (!searchTerm) return text;

    // 先转义 HTML 特殊字符
    const div = document.createElement("div");
    div.textContent = text;
    const escapedText = div.innerHTML;

    // 再进行高亮替换
    const regex = new RegExp(
        `(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
        "gi",
    );
    return escapedText.replace(
        regex,
        '<span class="mm-search-highlight">$1</span>',
    );
}

/**
 * 更新配置弹窗世界书徽章
 */
function updateConfigWorldbookBadge() {
    const badge = document.getElementById("mm-config-worldbook-badge");
    if (badge) {
        badge.textContent = `已选 ${plotConfigSelectedBooks.size}`;
    }
}

/**
 * 绑定配置弹窗世界书搜索事件
 */
function bindConfigWorldBookSearchEvents() {
    const searchInput = document.getElementById("mm-config-worldbook-search-input");
    const clearBtn = document.getElementById("mm-config-worldbook-search-clear");

    if (!searchInput) return;

    // 移除旧事件（防止重复绑定）
    const newSearchInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newSearchInput, searchInput);

    // 防抖搜索
    let searchTimeout = null;
    newSearchInput.addEventListener("input", (e) => {
        const searchTerm = e.target.value;
        if (clearBtn) {
            clearBtn.style.display = searchTerm ? "flex" : "none";
        }
        // 防抖处理
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            renderConfigWorldBooks(configWorldBooksCache, searchTerm);
        }, 200);
    });

    if (clearBtn) {
        // 清除按钮也需要重新绑定
        const newClearBtn = clearBtn.cloneNode(true);
        clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);

        newClearBtn.addEventListener("click", () => {
            const currentSearchInput = document.getElementById("mm-config-worldbook-search-input");
            if (currentSearchInput) currentSearchInput.value = "";
            newClearBtn.style.display = "none";
            renderConfigWorldBooks(configWorldBooksCache, "");
        });
    }
}

/**
 * 初始化配置弹窗世界书拖拽调整高度
 */
function initConfigWorldbookResize() {
    const card = document.getElementById("mm-config-worldbook-card");
    const handle = document.getElementById("mm-config-worldbook-resize-handle");
    // 修复：应该设置父容器 mm-config-worldbook-content 的高度，而不是列表本身
    // 因为父容器有 overflow-y: auto 和 max-height 限制
    const content = document.getElementById("mm-config-worldbook-content");

    if (!card || !handle || !content) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    const onStart = (e) => {
        isResizing = true;
        startY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
        startHeight = content.offsetHeight;
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
    };

    const onMove = (e) => {
        if (!isResizing) return;
        const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
        const deltaY = clientY - startY;
        const newHeight = Math.max(100, Math.min(startHeight + deltaY, 500));
        content.style.maxHeight = `${newHeight}px`;
    };

    const onEnd = () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        }
    };

    // 鼠标事件
    handle.addEventListener("mousedown", onStart);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);

    // 触摸事件（移动端支持）
    handle.addEventListener("touchstart", onStart, { passive: false });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
}

/**
 * 加载配置弹窗中的世界书列表
 */
export async function loadConfigWorldBooks(selectedBooks = [], selectedEntries = {}) {
    const container = document.getElementById("mm-config-worldbook-list");
    const loadingEl = document.getElementById("mm-config-worldbook-loading");
    const emptyEl = document.getElementById("mm-config-worldbook-empty");
    const noResultsEl = document.getElementById("mm-config-worldbook-no-results");
    const searchInput = document.getElementById("mm-config-worldbook-search-input");

    if (!container) return;

    // 初始化临时状态
    plotConfigSelectedBooks = new Set(selectedBooks);
    plotConfigSelectedEntries = { ...selectedEntries };
    configWorldBooksCache = [];
    configEntriesCache = {};

    // 清空搜索框
    if (searchInput) searchInput.value = "";
    const clearBtn = document.getElementById("mm-config-worldbook-search-clear");
    if (clearBtn) clearBtn.style.display = "none";

    if (loadingEl) loadingEl.style.display = "flex";
    if (emptyEl) emptyEl.style.display = "none";
    if (noResultsEl) noResultsEl.style.display = "none";
    container.innerHTML = "";

    try {
        const worldBooks = await getWorldBookList();
        configWorldBooksCache = worldBooks;

        if (loadingEl) loadingEl.style.display = "none";

        if (worldBooks.length === 0) {
            if (emptyEl) emptyEl.style.display = "flex";
            updateConfigWorldbookBadge();
            return;
        }

        // 预加载已选中世界书的条目到缓存
        for (const bookName of selectedBooks) {
            try {
                const entries = await getWorldBookEntries(bookName);
                configEntriesCache[bookName] = entries;
            } catch (e) {
                // 忽略错误
            }
        }

        // 渲染世界书列表
        renderConfigWorldBooks(worldBooks, "");

        // 绑定搜索事件
        bindConfigWorldBookSearchEvents();

        // 初始化拖拽调整高度功能
        initConfigWorldbookResize();

        updateConfigWorldbookBadge();
    } catch (error) {
        Logger.error("加载世界书列表失败:", error);
        if (loadingEl) loadingEl.style.display = "none";
        container.innerHTML = '<div class="mm-empty-state"><i class="fa-solid fa-exclamation-circle"></i><span>加载失败</span></div>';
    }
}

/**
 * 渲染配置弹窗中的世界书列表
 */
function renderConfigWorldBooks(worldBooks, searchTerm = "") {
    const container = document.getElementById("mm-config-worldbook-list");
    const noResultsEl = document.getElementById("mm-config-worldbook-no-results");
    const emptyEl = document.getElementById("mm-config-worldbook-empty");

    if (!container) return;
    container.innerHTML = "";

    const searchLower = searchTerm.toLowerCase().trim();
    let hasVisibleBooks = false;

    for (const book of worldBooks) {
        const bookNameLower = book.name.toLowerCase();
        const bookMatches = !searchLower || bookNameLower.includes(searchLower);

        const cachedEntries = configEntriesCache[book.name] || [];
        let matchingEntries = [];
        if (searchLower && cachedEntries.length > 0) {
            matchingEntries = cachedEntries.filter((entry) => {
                const displayName = entry.comment || entry.key?.[0] || "";
                return displayName.toLowerCase().includes(searchLower);
            });
        }

        if (searchLower && !bookMatches && matchingEntries.length === 0) {
            continue;
        }

        hasVisibleBooks = true;

        const bookItem = document.createElement("div");
        bookItem.className = "mm-config-worldbook-item";
        bookItem.dataset.bookName = book.name;

        const isSelected = plotConfigSelectedBooks.has(book.name);
        if (isSelected) bookItem.classList.add("selected");

        const displayBookName = searchLower && bookMatches
            ? highlightConfigSearchText(book.name, searchTerm)
            : book.name;

        const entryCountText = book.entryCount >= 0 ? `${book.entryCount} 条目` : "- 条目";

        bookItem.innerHTML = `
            <div class="mm-config-worldbook-header">
                <input type="checkbox" class="mm-config-worldbook-checkbox" ${isSelected ? "checked" : ""}>
                <span class="mm-config-worldbook-name">${displayBookName}</span>
                <span class="mm-config-worldbook-count">${entryCountText}</span>
                <div class="mm-config-worldbook-actions" style="display: ${isSelected ? "flex" : "none"};">
                    <button type="button" class="mm-config-worldbook-select-all mm-btn-icon-small" title="全选">
                        <i class="fa-solid fa-check-double"></i>
                    </button>
                    <button type="button" class="mm-config-worldbook-deselect-all mm-btn-icon-small" title="全不选">
                        <i class="fa-regular fa-square"></i>
                    </button>
                </div>
            </div>
            <div class="mm-config-worldbook-entries ${isSelected ? "show" : ""}"></div>
        `;

        const checkbox = bookItem.querySelector(".mm-config-worldbook-checkbox");
        const entriesContainer = bookItem.querySelector(".mm-config-worldbook-entries");
        const actionsContainer = bookItem.querySelector(".mm-config-worldbook-actions");
        const selectAllBtn = bookItem.querySelector(".mm-config-worldbook-select-all");
        const deselectAllBtn = bookItem.querySelector(".mm-config-worldbook-deselect-all");

        // 全选按钮
        selectAllBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            const allCheckboxes = entriesContainer.querySelectorAll(".mm-config-worldbook-entry-checkbox");
            const allUids = [];
            allCheckboxes.forEach((cb) => {
                cb.checked = true;
                allUids.push(cb.dataset.uid);
            });
            plotConfigSelectedEntries[book.name] = allUids;
        });

        // 全不选按钮
        deselectAllBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            const allCheckboxes = entriesContainer.querySelectorAll(".mm-config-worldbook-entry-checkbox");
            allCheckboxes.forEach((cb) => {
                cb.checked = false;
            });
            plotConfigSelectedEntries[book.name] = [];
        });

        // 世界书选中状态变化
        checkbox?.addEventListener("change", async (e) => {
            e.stopPropagation();
            const bookName = book.name;

            if (e.target.checked) {
                plotConfigSelectedBooks.add(bookName);
                bookItem.classList.add("selected");
                if (actionsContainer) actionsContainer.style.display = "flex";
                entriesContainer.classList.add("show");

                // 加载条目
                await loadConfigWorldBookEntries(bookName, entriesContainer, searchTerm);
            } else {
                plotConfigSelectedBooks.delete(bookName);
                delete plotConfigSelectedEntries[bookName];
                bookItem.classList.remove("selected");
                if (actionsContainer) actionsContainer.style.display = "none";
                entriesContainer.classList.remove("show");
                entriesContainer.innerHTML = "";
            }

            updateConfigWorldbookBadge();
        });

        // 如果已选中，加载条目
        if (isSelected) {
            loadConfigWorldBookEntries(book.name, entriesContainer, searchTerm);
        }

        container.appendChild(bookItem);
    }

    if (noResultsEl) noResultsEl.style.display = !hasVisibleBooks && searchLower ? "flex" : "none";
    if (emptyEl) emptyEl.style.display = !hasVisibleBooks && !searchLower ? "flex" : "none";
}

/**
 * 加载世界书条目
 */
async function loadConfigWorldBookEntries(bookName, container, searchTerm = "") {
    if (!container) return;

    container.innerHTML = '<div class="mm-loading-small"><i class="fa-solid fa-spinner fa-spin"></i></div>';

    try {
        let entries = configEntriesCache[bookName];
        if (!entries) {
            entries = await getWorldBookEntries(bookName);
            configEntriesCache[bookName] = entries;
        }

        container.innerHTML = "";

        if (entries.length === 0) {
            container.innerHTML = '<div style="padding: 8px; color: var(--mm-text-muted); font-size: 0.85em;">无条目</div>';
            return;
        }

        const searchLower = searchTerm.toLowerCase().trim();
        const selectedUids = plotConfigSelectedEntries[bookName] || [];
        let hasVisibleEntries = false;

        for (const entry of entries) {
            const displayName = entry.comment || entry.key?.[0] || `条目 ${entry.uid}`;
            const displayNameLower = displayName.toLowerCase();

            if (searchLower && !displayNameLower.includes(searchLower)) {
                continue;
            }

            hasVisibleEntries = true;

            const entryItem = document.createElement("div");
            entryItem.className = "mm-config-worldbook-entry";

            // 确保 uid 转为字符串，保持类型一致
            const uid = String(entry.uid);
            const isSelected = selectedUids.includes(uid);
            const highlightedName = searchLower
                ? highlightConfigSearchText(displayName, searchTerm)
                : displayName;

            entryItem.innerHTML = `
                <input type="checkbox" class="mm-config-worldbook-entry-checkbox" data-uid="${uid}" ${isSelected ? "checked" : ""}>
                <span class="mm-config-worldbook-entry-name">${highlightedName}</span>
            `;

            const entryCheckbox = entryItem.querySelector(".mm-config-worldbook-entry-checkbox");
            entryCheckbox?.addEventListener("change", (e) => {
                e.stopPropagation();
                const uid = e.target.dataset.uid;

                if (!plotConfigSelectedEntries[bookName]) {
                    plotConfigSelectedEntries[bookName] = [];
                }

                if (e.target.checked) {
                    if (!plotConfigSelectedEntries[bookName].includes(uid)) {
                        plotConfigSelectedEntries[bookName].push(uid);
                    }
                } else {
                    plotConfigSelectedEntries[bookName] = plotConfigSelectedEntries[bookName].filter((id) => id !== uid);
                }
            });

            container.appendChild(entryItem);
        }

        if (!hasVisibleEntries) {
            container.innerHTML = '<div style="padding: 8px; color: var(--mm-text-muted); font-size: 0.85em;">无匹配条目</div>';
        }
    } catch (error) {
        Logger.error(`加载世界书 ${bookName} 条目失败:`, error);
        container.innerHTML = '<div style="padding: 8px; color: var(--mm-danger); font-size: 0.85em;">加载失败</div>';
    }
}

/**
 * 获取配置弹窗中选择的世界书和条目
 */
export function getConfigSelectedWorldBooks() {
    return {
        selectedBooks: Array.from(plotConfigSelectedBooks),
        selectedEntries: { ...plotConfigSelectedEntries },
    };
}

// ============================================================================
// 剧情优化配置 - 角色描述
// ============================================================================

/**
 * 加载角色描述预览
 */
export async function loadConfigCharDescription() {
    const nameEl = document.getElementById("mm-config-char-name");
    const tokensEl = document.getElementById("mm-config-char-tokens");
    const previewEl = document.getElementById("mm-config-char-preview");
    const badgeEl = document.getElementById("mm-config-char-badge");

    try {
        const context = SillyTavern.getContext();
        const characterId = context.characterId;

        if (characterId === undefined || characterId === null) {
            if (nameEl) nameEl.textContent = "未选择角色";
            if (tokensEl) tokensEl.textContent = "Tokens: -";
            if (previewEl) previewEl.innerHTML = '<div class="mm-config-char-empty">请先在酒馆中选择一个角色</div>';
            if (badgeEl) badgeEl.textContent = "-";
            return;
        }

        const character = context.characters[characterId];
        const charName = character?.name || "未知角色";
        const description = character?.data?.description || character?.description || "";

        if (nameEl) nameEl.textContent = charName;
        if (badgeEl) badgeEl.textContent = charName;

        // 计算 token 数量
        let tokenCount = "-";
        try {
            if (typeof context.getTokenCount === "function") {
                tokenCount = await context.getTokenCount(description);
            } else {
                tokenCount = Math.ceil(description.length / 2);
            }
        } catch (e) {
            tokenCount = Math.ceil(description.length / 2);
        }

        if (tokensEl) tokensEl.textContent = `Tokens: ${tokenCount}`;

        if (previewEl) {
            if (description) {
                const truncated = description.length > 500
                    ? description.substring(0, 500) + "..."
                    : description;
                previewEl.innerHTML = `<pre class="mm-config-char-text">${truncated}</pre>`;
            } else {
                previewEl.innerHTML = '<div class="mm-config-char-empty">该角色没有描述内容</div>';
            }
        }
    } catch (error) {
        Logger.error("加载角色描述失败:", error);
        if (nameEl) nameEl.textContent = "加载失败";
        if (tokensEl) tokensEl.textContent = "Tokens: -";
        if (previewEl) previewEl.innerHTML = '<div class="mm-config-char-empty">加载角色描述失败</div>';
        if (badgeEl) badgeEl.textContent = "-";
    }
}
