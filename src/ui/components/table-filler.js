/**
 * Amily表格并发 UI 组件
 * @module ui/components/table-filler
 */

import Logger from "@core/logger";
import { getExtensionSettings } from "@core/sillytavern-api";
import {
    getTableFillerConfig,
    isTableFillerEnabled,
    updateTableFillerConfig,
    setTableFillerEnabled,
    setTableApiConfig,
    deleteTableApiConfig,
    getGlobalSettings,
    getIndependentTagName,
    setIndependentTagName,
} from "@config/config-manager";
import {
    CallMode,
    getModeStatus,
    isSecondaryApiMode,
    getAmily2FillingModeName,
} from "@table-filler/mode-manager";
import { disableTableFiller, reinitTableFiller } from "@table-filler/index";
import { APIAdapter } from "@api/adapter";
import { bindIndependentTemplateEvents } from "@ui/modals/independent-template-modal";

const log = Logger.createModuleLogger('Amily表格并发');

// 当前编辑的表格名称（null表示默认配置）
let currentEditingTable = null;

// 缓存的表格名称列表
let cachedTableNames = [];

// 缓存的 Amily2 设置键名
let cachedAmily2ExtKey = null;

/**
 * 从 Amily2 获取当前表格名称列表
 * 使用多种方法尝试获取，确保兼容性
 * @returns {Promise<string[]>} 表格名称数组
 */
async function getAmily2TableNames() {
    try {
        // 方法1：直接从 extension_settings 获取预设中的表格定义（最可靠）
        const amilyExtName = "ST-Amily2-Chat-Optimisation";
        const settings = getExtensionSettings()?.[amilyExtName];

        if (settings) {
            log.debug("找到 Amily2 扩展设置，检查表格定义...");
            log.debug("设置中的键:", Object.keys(settings));

            // 优先使用 global_table_preset.tables（全局预设）
            if (settings.global_table_preset?.tables) {
                const tables = settings.global_table_preset.tables;
                if (Array.isArray(tables) && tables.length > 0) {
                    const names = tables.map(t => t.name).filter(Boolean);
                    if (names.length > 0) {
                        log.debug("从 global_table_preset 获取表格名称:", names);
                        return names;
                    }
                }
            }

            // 尝试直接的 tables 字段
            if (settings.tables && Array.isArray(settings.tables)) {
                const names = settings.tables.map(t => t.name).filter(Boolean);
                if (names.length > 0) {
                    log.debug("从 settings.tables 获取表格名称:", names);
                    return names;
                }
            }
        }

        // 方法2：尝试从 Amily2Bus 查询 TableManager
        if (window.Amily2Bus) {
            log.debug("尝试通过 Amily2Bus 获取表格...");
            try {
                // 尝试查询 Amily2 模块
                const amily2Module = window.Amily2Bus.query("Amily2");
                if (amily2Module) {
                    log.debug("Amily2 模块暴露的接口:", Object.keys(amily2Module));
                }

                // 尝试获取 TableManager
                const busTableManager = window.Amily2Bus.query("TableManager");
                if (busTableManager) {
                    log.debug("找到 TableManager，尝试获取表格...");
                    if (typeof busTableManager.getMemoryState === 'function') {
                        const tables = busTableManager.getMemoryState();
                        if (Array.isArray(tables) && tables.length > 0) {
                            const names = tables.map(t => t.name).filter(Boolean);
                            if (names.length > 0) {
                                log.debug("从 Amily2Bus.TableManager 获取表格名称:", names);
                                return names;
                            }
                        }
                    }
                }
            } catch (e) {
                log.warn("Amily2Bus 查询失败:", e.message);
            }
        }

        // 方法3：检查 DOM 中已渲染的表格标签（Amily2 使用标签式 UI）
        const tableTabsContainer = document.querySelector('.amily2-table-tabs');
        if (tableTabsContainer) {
            const tabButtons = tableTabsContainer.querySelectorAll('button.menu_button');
            const names = [];
            tabButtons.forEach(btn => {
                // 排除 "+" 按钮
                if (!btn.querySelector('.fa-plus')) {
                    const name = btn.textContent?.trim().replace(/•$/, '').trim();
                    if (name) names.push(name);
                }
            });
            if (names.length > 0) {
                log.debug("从 DOM 标签获取表格名称:", names);
                return names;
            }
        }

        // 方法4：从聊天消息的 extra 数据中获取表格
        const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        if (context?.chat) {
            // 从最新消息往前找，找到包含表格数据的消息
            for (let i = context.chat.length - 1; i >= 0 && i >= context.chat.length - 10; i--) {
                const msg = context.chat[i];
                const tablesData = msg?.extra?.amily2_tables_data;
                if (tablesData && Array.isArray(tablesData) && tablesData.length > 0) {
                    const names = tablesData.map(t => t.name).filter(Boolean);
                    if (names.length > 0) {
                        log.debug("从聊天消息 extra 获取表格名称:", names);
                        return names;
                    }
                }
            }
        }

        // 方法5：遍历所有 extension_settings 找 Amily2 相关
        log.debug("遍历所有扩展设置查找 Amily2...");
        for (const key in getExtensionSettings() || {}) {
            if (key.toLowerCase().includes('amily')) {
                const extSettings = getExtensionSettings()[key];
                log.debug(`检查扩展 ${key}:`, Object.keys(extSettings || {}));

                // 深度搜索 tables
                const tableNames = findTablesInObject(extSettings, key);
                if (tableNames.length > 0) {
                    return tableNames;
                }
            }
        }

        log.warn("未能获取 Amily2 表格名称，请确保：");
        log.warn("1. Amily2 插件已安装并启用");
        log.warn("2. 已导入表格预设");
        log.warn("3. 当前有打开的聊天会话");
        return [];
    } catch (e) {
        log.error("获取 Amily2 表格名称失败:", e);
        return [];
    }
}

/**
 * 递归查找对象中的 tables 数组
 * @param {object} obj - 要搜索的对象
 * @param {string} path - 当前路径（用于日志）
 * @param {number} depth - 当前深度
 * @returns {string[]} 表格名称数组
 */
function findTablesInObject(obj, path = '', depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 5) return [];

    // 检查是否有 tables 数组
    if (Array.isArray(obj.tables) && obj.tables.length > 0) {
        const firstItem = obj.tables[0];
        // 确保是表格定义对象（有 name 字段）
        if (firstItem && typeof firstItem === 'object' && 'name' in firstItem) {
            const names = obj.tables.map(t => t?.name).filter(Boolean);
            if (names.length > 0) {
                log.debug(`在 ${path}.tables 找到表格名称:`, names);
                return names;
            }
        }
    }

    // 递归搜索子对象（跳过某些不相关的大型对象）
    const skipKeys = ['chat', 'messages', 'characters', 'world_info', 'lorebook'];
    for (const key of Object.keys(obj)) {
        if (key === 'tables' || skipKeys.includes(key)) continue;
        const value = obj[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const result = findTablesInObject(value, `${path}.${key}`, depth + 1);
            if (result.length > 0) return result;
        }
    }

    return [];
}

/**
 * 刷新表格名称缓存（异步）
 * @returns {Promise<string[]>} 表格名称数组
 */
async function refreshTableNames() {
    cachedTableNames = await getAmily2TableNames();
    return cachedTableNames;
}

/**
 * 获取缓存的表格名称
 * @returns {string[]} 表格名称数组
 */
function getTableNames() {
    return cachedTableNames;
}

/**
 * 初始化表格填表 UI
 */
export function initTableFillerUI() {
    const config = getTableFillerConfig();

    // 设置启用状态
    const enableCheckbox = document.getElementById("mm-table-filler-enabled");
    if (enableCheckbox) {
        enableCheckbox.checked = config.enabled || false;
    }

    // 设置调用模式
    const callModeSelect = document.getElementById("mm-table-filler-call-mode");
    if (callModeSelect) {
        callModeSelect.value = config.callMode || CallMode.AUTO;
    }

    // 设置重试次数
    const retryCountInput = document.getElementById("mm-table-filler-retry-count");
    const retryCountValue = document.getElementById("mm-table-filler-retry-count-value");
    if (retryCountInput) {
        const retryCount = config.retryCount ?? 2;
        retryCountInput.value = retryCount;
        if (retryCountValue) {
            retryCountValue.textContent = retryCount;
        }
    }

    // 设置重试延迟
    const retryDelayInput = document.getElementById("mm-table-filler-retry-delay");
    const retryDelayValue = document.getElementById("mm-table-filler-retry-delay-value");
    if (retryDelayInput) {
        const retryDelay = config.retryDelay ?? 2000;
        retryDelayInput.value = retryDelay;
        if (retryDelayValue) {
            retryDelayValue.textContent = retryDelay;
        }
    }

    // 设置提示词模式按钮状态
    updatePromptModeButtons(config.promptMode || "shared");

    // 设置调试模式开关
    const debugModeCheckbox = document.getElementById("mm-table-filler-debug-mode");
    if (debugModeCheckbox) {
        debugModeCheckbox.checked = config.debugMode || false;
    }

    // 更新模式状态显示
    updateModeStatusDisplay();

    // 更新徽章状态
    updateTableFillerBadge(config.enabled || false);

    // 渲染表格 API 列表
    renderTableApiList();

    // 更新配置计数
    updateConfigCount();

    // 更新预设信息显示
    updatePresetInfoDisplay();

    // 检查 Amily2 填表模式兼容性
    checkFillingModeCompatibility();

    // 初始化标签名输入框（只显示非默认值）
    const tagNameInput = /** @type {HTMLInputElement|null} */ (document.getElementById("mm-table-filler-tag-name"));
    if (tagNameInput) {
        const currentTagName = getIndependentTagName();
        const defaultTagName = "Instructions for filling out the form";
        tagNameInput.value = currentTagName !== defaultTagName ? currentTagName : "";
    }
}

/**
 * 绑定表格填表事件
 */
export function bindTableFillerEvents() {
    // 折叠卡片切换
    document
        .getElementById("mm-table-filler-toggle")
        ?.addEventListener("click", () => {
            const card = document.getElementById("mm-table-filler-card");
            if (card) {
                card.classList.toggle("expanded");
                if (card.classList.contains("expanded")) {
                    // 展开时刷新状态
                    updateModeStatusDisplay();
                    renderTableApiList();
                    checkFillingModeCompatibility();
                }
            }
        });

    // 高级设置折叠
    document
        .getElementById("mm-table-filler-advanced-toggle")
        ?.addEventListener("click", () => {
            const body = document.getElementById("mm-table-filler-advanced-body");
            const toggle = document.getElementById("mm-table-filler-advanced-toggle");
            if (body && toggle) {
                const isVisible = body.style.display !== "none";
                body.style.display = isVisible ? "none" : "block";
                toggle.classList.toggle("expanded", !isVisible);
            }
        });

    // 启用开关
    document
        .getElementById("mm-table-filler-enabled")
        ?.addEventListener("change", async (e) => {
            const checked = e.target.checked;

            // 检查填表模式（仅作为警告，不阻止启用）
            if (checked && !isSecondaryApiMode()) {
                const modeName = getAmily2FillingModeName();
                if (typeof toastr !== "undefined") {
                    toastr.warning(
                        `建议使用「分步填表」模式，当前为「${modeName}」`,
                        "Amily表格并发",
                        { timeOut: 5000 },
                    );
                }
            }

            setTableFillerEnabled(checked);
            updateTableFillerBadge(checked);

            // 初始化或禁用模块
            if (checked) {
                await reinitTableFiller();
                if (typeof toastr !== "undefined") {
                    toastr.success("Amily表格并发已启用", "Amily表格并发");
                }
            } else {
                disableTableFiller();
                if (typeof toastr !== "undefined") {
                    toastr.info("Amily表格并发已禁用", "Amily表格并发");
                }
            }
        });

    // 调用模式选择
    document
        .getElementById("mm-table-filler-call-mode")
        ?.addEventListener("change", async (e) => {
            const value = e.target.value;
            updateTableFillerConfig({ callMode: value });

            // 如果已启用，重新初始化
            if (isTableFillerEnabled()) {
                await reinitTableFiller();
            }

            updateModeStatusDisplay();

            if (typeof toastr !== "undefined") {
                const modeNames = {
                    auto: "自动选择",
                    intercept_only: "仅拦截模式",
                    bus_only: "仅Bus联动",
                };
                toastr.success(
                    `调用模式已切换为「${modeNames[value] || value}」`,
                    "Amily表格并发",
                );
            }
        });

    // 重试次数滑块
    document
        .getElementById("mm-table-filler-retry-count")
        ?.addEventListener("input", (e) => {
            const value = parseInt(e.target.value) || 0;
            const valueEl = document.getElementById("mm-table-filler-retry-count-value");
            if (valueEl) {
                valueEl.textContent = value;
            }
            updateTableFillerConfig({ retryCount: value });
        });

    // 重试延迟滑块
    document
        .getElementById("mm-table-filler-retry-delay")
        ?.addEventListener("input", (e) => {
            const value = parseInt(e.target.value) || 2000;
            const valueEl = document.getElementById("mm-table-filler-retry-delay-value");
            if (valueEl) {
                valueEl.textContent = value;
            }
            updateTableFillerConfig({ retryDelay: value });
        });

    // 提示词模式切换 - 使用 radio 按钮的 change 事件
    document
        .getElementById("mm-prompt-mode-shared")
        ?.addEventListener("change", (e) => {
            const radio = /** @type {HTMLInputElement} */ (e.target);
            if (radio.checked) {
                updateTableFillerConfig({ promptMode: "shared" });
                updatePromptModeButtons("shared");

                if (typeof toastr !== "undefined") {
                    toastr.success("已切换为共享模式", "Amily表格并发");
                }
            }
        });

    // 提示词模式切换 - 独立模式
    document
        .getElementById("mm-prompt-mode-independent")
        ?.addEventListener("change", (e) => {
            const radio = /** @type {HTMLInputElement} */ (e.target);
            if (radio.checked) {
                updateTableFillerConfig({ promptMode: "independent" });
                updatePromptModeButtons("independent");

                if (typeof toastr !== "undefined") {
                    toastr.success("已切换为独立模式", "Amily表格并发");
                }
            }
        });

    // 调试模式开关
    document
        .getElementById("mm-table-filler-debug-mode")
        ?.addEventListener("change", (e) => {
            const checkbox = /** @type {HTMLInputElement} */ (e.target);
            updateTableFillerConfig({ debugMode: checkbox.checked });

            if (typeof toastr !== "undefined") {
                if (checkbox.checked) {
                    toastr.info("已启用调试模式，发送前和合并后将显示检查弹窗", "调试模式");
                } else {
                    toastr.info("已关闭调试模式", "调试模式");
                }
            }
        });

    // 标签名输入框（独立模式）
    document
        .getElementById("mm-table-filler-tag-name")
        ?.addEventListener("change", (e) => {
            const input = /** @type {HTMLInputElement} */ (e.target);
            const value = input.value.trim();
            // 只有填入内容才更改，留空则恢复默认值
            if (value) {
                setIndependentTagName(value);
            } else {
                setIndependentTagName("Instructions for filling out the form");
            }
        });

    // 刷新表格列表按钮
    document
        .getElementById("mm-table-filler-add-table-api")
        ?.addEventListener("click", () => {
            renderAllTablesWithStatus();
        });

    // 绑定API配置弹窗事件
    bindApiModalEvents();

    // 绑定表格选择弹窗事件
    bindTableSelectModalEvents();

    // 绑定独立模式模板弹窗事件
    bindIndependentTemplateEvents();
}

/**
 * 绑定API配置弹窗事件
 */
function bindApiModalEvents() {
    const modal = document.getElementById("mm-table-filler-api-modal");
    if (!modal) return;

    // 关闭按钮
    modal.querySelector(".mm-modal-close")?.addEventListener("click", hideApiModal);
    document.getElementById("mm-table-filler-api-cancel")?.addEventListener("click", hideApiModal);

    // 保存按钮
    document.getElementById("mm-table-filler-api-save")?.addEventListener("click", handleApiSave);

    // 获取模型按钮
    document.getElementById("mm-table-filler-fetch-models")?.addEventListener("click", handleFetchModels);

    // 测试连接按钮
    document.getElementById("mm-table-filler-test-connection")?.addEventListener("click", handleTestConnection);

    // Temperature 滑块
    document.getElementById("mm-table-filler-api-temperature")?.addEventListener("input", (e) => {
        const valueEl = document.getElementById("mm-table-filler-api-temperature-value");
        if (valueEl) valueEl.textContent = e.target.value;
    });

    // API格式切换
    document.querySelectorAll('input[name="mm-table-filler-api-format"]').forEach(radio => {
        radio.addEventListener("change", (e) => {
            const customOptions = document.getElementById("mm-table-filler-custom-options");
            if (customOptions) {
                customOptions.classList.toggle("mm-hidden", e.target.value !== "custom");
            }
        });
    });
}

/**
 * 绑定表格选择弹窗事件
 */
function bindTableSelectModalEvents() {
    const modal = document.getElementById("mm-table-filler-select-modal");
    if (!modal) return;

    modal.querySelector(".mm-modal-close")?.addEventListener("click", hideTableSelectModal);
    document.getElementById("mm-table-filler-select-cancel")?.addEventListener("click", hideTableSelectModal);
}

/**
 * 显示API配置弹窗
 * @param {string|null} tableName - 表格名称，null表示默认配置
 */
function showTableFillerApiModal(tableName) {
    currentEditingTable = tableName;

    const modal = document.getElementById("mm-table-filler-api-modal");
    if (!modal) {
        Logger.error("找不到API配置弹窗元素");
        if (typeof toastr !== "undefined") {
            toastr.error("弹窗加载失败，请刷新页面重试", "Amily表格并发");
        }
        return;
    }

    const config = getTableFillerConfig();
    let apiConfig;

    if (tableName) {
        apiConfig = config.tableApiConfigs?.[tableName] || {};
    } else {
        apiConfig = config.defaultApi || {};
    }

    // 设置标题
    const titleEl = document.getElementById("mm-table-filler-api-title");
    if (titleEl) {
        titleEl.textContent = tableName ? `配置「${tableName}」API` : "配置默认API";
    }

    // 填充表单
    fillApiForm(apiConfig);

    // 应用主题
    const settings = getGlobalSettings();
    const theme = settings.theme || "default";
    if (theme !== "default") {
        modal.setAttribute("data-mm-theme", theme);
    } else {
        modal.removeAttribute("data-mm-theme");
    }

    // 显示弹窗
    modal.classList.add("mm-modal-visible");
    console.log("[Amily表格并发] 弹窗已添加 mm-modal-visible 类");
}

/**
 * 隐藏API配置弹窗
 */
function hideApiModal() {
    const modal = document.getElementById("mm-table-filler-api-modal");
    if (modal) {
        modal.classList.remove("mm-modal-visible");
    }
    currentEditingTable = null;
}

/**
 * 填充API表单
 * @param {object} apiConfig - API配置
 */
function fillApiForm(apiConfig) {
    // API格式
    const formatRadio = document.querySelector(`input[name="mm-table-filler-api-format"][value="${apiConfig.apiFormat || 'openai'}"]`);
    if (formatRadio) formatRadio.checked = true;

    // 显示/隐藏自定义选项
    const customOptions = document.getElementById("mm-table-filler-custom-options");
    if (customOptions) {
        customOptions.classList.toggle("mm-hidden", apiConfig.apiFormat !== "custom");
    }

    // URL
    const urlInput = document.getElementById("mm-table-filler-api-url");
    if (urlInput) urlInput.value = apiConfig.apiUrl || "";

    // Key
    const keyInput = document.getElementById("mm-table-filler-api-key");
    if (keyInput) keyInput.value = apiConfig.apiKey || "";

    // Model
    const modelSelect = document.getElementById("mm-table-filler-api-model");
    if (modelSelect) {
        if (apiConfig.model) {
            modelSelect.innerHTML = `<option value="${escapeHtml(apiConfig.model)}" selected>${escapeHtml(apiConfig.model)}</option>`;
        } else {
            modelSelect.innerHTML = '<option value="" disabled selected>--- 请获取模型 ---</option>';
        }
    }

    // Max Tokens
    const maxTokensInput = document.getElementById("mm-table-filler-api-max-tokens");
    if (maxTokensInput) maxTokensInput.value = apiConfig.maxTokens || 4096;

    // Temperature
    const temperatureInput = document.getElementById("mm-table-filler-api-temperature");
    const temperatureValue = document.getElementById("mm-table-filler-api-temperature-value");
    if (temperatureInput) temperatureInput.value = apiConfig.temperature || 0.7;
    if (temperatureValue) temperatureValue.textContent = apiConfig.temperature || 0.7;

    // 自定义模板
    const customTemplate = document.getElementById("mm-table-filler-custom-template");
    if (customTemplate) customTemplate.value = apiConfig.customTemplate || "";

    // 响应路径
    const responsePath = document.getElementById("mm-table-filler-response-path");
    if (responsePath) responsePath.value = apiConfig.responsePath || "choices.0.message.content";

    // 清空测试结果
    const testResult = document.getElementById("mm-table-filler-test-result");
    if (testResult) {
        testResult.textContent = "";
        testResult.className = "mm-test-result";
    }
}

/**
 * 处理保存API配置
 */
function handleApiSave() {
    const apiConfig = collectApiFormData();
    if (!apiConfig) return;

    if (!currentEditingTable) {
        if (typeof toastr !== "undefined") {
            toastr.warning("请选择要配置的表格", "Amily表格并发");
        }
        return;
    }

    setTableApiConfig(currentEditingTable, apiConfig);
    renderTableApiList();
    updateConfigCount();
    if (typeof toastr !== "undefined") {
        toastr.success(`「${currentEditingTable}」API配置已保存`, "Amily表格并发");
    }

    hideApiModal();
}

/**
 * 收集API表单数据
 * @returns {object|null}
 */
function collectApiFormData() {
    const apiUrl = document.getElementById("mm-table-filler-api-url")?.value.trim();
    const model = document.getElementById("mm-table-filler-api-model")?.value;

    if (!apiUrl) {
        if (typeof toastr !== "undefined") {
            toastr.warning("请填写API URL", "Amily表格并发");
        }
        return null;
    }

    if (!model) {
        if (typeof toastr !== "undefined") {
            toastr.warning("请选择模型", "Amily表格并发");
        }
        return null;
    }

    const format = document.querySelector('input[name="mm-table-filler-api-format"]:checked')?.value || "openai";

    return {
        apiFormat: format,
        apiUrl,
        apiKey: document.getElementById("mm-table-filler-api-key")?.value.trim() || "",
        model,
        maxTokens: parseInt(document.getElementById("mm-table-filler-api-max-tokens")?.value) || 4096,
        temperature: parseFloat(document.getElementById("mm-table-filler-api-temperature")?.value) || 0.7,
        customTemplate: document.getElementById("mm-table-filler-custom-template")?.value.trim() || "",
        responsePath: document.getElementById("mm-table-filler-response-path")?.value.trim() || "choices.0.message.content",
        useDefault: false,
    };
}

/**
 * 处理获取模型
 */
async function handleFetchModels() {
    const apiUrl = document.getElementById("mm-table-filler-api-url")?.value.trim();
    const apiKey = document.getElementById("mm-table-filler-api-key")?.value.trim();
    const format = document.querySelector('input[name="mm-table-filler-api-format"]:checked')?.value || "openai";

    if (!apiUrl) {
        if (typeof toastr !== "undefined") {
            toastr.warning("请先填写API URL", "Amily表格并发");
        }
        return;
    }

    const fetchBtn = document.getElementById("mm-table-filler-fetch-models");
    const modelSelect = document.getElementById("mm-table-filler-api-model");

    if (fetchBtn) {
        fetchBtn.disabled = true;
        fetchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
        const models = await fetchModelsFromApi(apiUrl, apiKey, format);

        if (modelSelect) {
            modelSelect.innerHTML = "";
            if (models.length === 0) {
                modelSelect.innerHTML = '<option value="" disabled selected>--- 未获取到模型 ---</option>';
            } else {
                models.forEach(model => {
                    const option = document.createElement("option");
                    option.value = model;
                    option.textContent = model;
                    modelSelect.appendChild(option);
                });
            }
        }

        if (typeof toastr !== "undefined") {
            toastr.success(`获取到 ${models.length} 个模型`, "Amily表格并发");
        }
    } catch (error) {
        log.error("获取模型失败:", error);
        if (modelSelect) {
            modelSelect.innerHTML = '<option value="" disabled selected>--- 获取失败 ---</option>';
        }
        if (typeof toastr !== "undefined") {
            toastr.error(`获取模型失败: ${error.message}`, "Amily表格并发");
        }
    } finally {
        if (fetchBtn) {
            fetchBtn.disabled = false;
            fetchBtn.innerHTML = '<i class="fa-solid fa-download"></i> 获取';
        }
    }
}

/**
 * 从API获取模型列表
 */
async function fetchModelsFromApi(apiUrl, apiKey, format) {
    let modelsUrl = apiUrl;

    if (format === "openai") {
        if (apiUrl.endsWith("/v1") || apiUrl.endsWith("/v1/")) {
            modelsUrl = apiUrl.replace(/\/v1\/?$/, "/v1/models");
        } else if (!apiUrl.includes("/models")) {
            modelsUrl = apiUrl.replace(/\/?$/, "/models");
        }
    } else {
        throw new Error("此API格式不支持获取模型列表");
    }

    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(modelsUrl, { headers });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const models = data.data || data.models || [];
    return models.map(m => m.id || m.name || m).filter(Boolean).sort();
}

/**
 * 处理测试连接
 */
async function handleTestConnection() {
    const testResult = document.getElementById("mm-table-filler-test-result");
    if (testResult) {
        testResult.textContent = "测试中...";
        testResult.className = "mm-test-result";
    }

    const config = collectApiFormData();
    if (!config) {
        if (testResult) {
            testResult.textContent = "请填写必要字段";
            testResult.className = "mm-test-result mm-test-error";
        }
        return;
    }

    try {
        const result = await APIAdapter.testConnection(config);
        if (result.success) {
            if (testResult) {
                testResult.textContent = `连接成功 (${result.latency}ms)`;
                testResult.className = "mm-test-result mm-test-success";
            }
        } else {
            if (testResult) {
                testResult.textContent = `失败: ${result.message}`;
                testResult.className = "mm-test-result mm-test-error";
            }
        }
    } catch (error) {
        if (testResult) {
            testResult.textContent = `失败: ${error.message}`;
            testResult.className = "mm-test-result mm-test-error";
        }
    }
}

/**
 * 显示表格选择弹窗（已弃用，改为直接渲染表格列表）
 * @deprecated 使用 renderAllTablesWithStatus 代替
 */
async function showTableSelectModal() {
    // 此函数已弃用，改为直接在界面中显示所有表格
    await renderAllTablesWithStatus();
}

/**
 * 渲染所有检测到的表格及其配置状态
 * 直接显示在界面中，无需弹窗
 */
async function renderAllTablesWithStatus() {
    const listEl = document.getElementById("mm-table-filler-api-list");
    const emptyEl = document.getElementById("mm-table-filler-api-empty");
    const countEl = document.getElementById("mm-table-filler-config-count");

    if (!listEl) return;

    // 异步刷新表格名称
    const tableNames = await refreshTableNames();
    const config = getTableFillerConfig();
    const tableApis = config.tableApiConfigs || {};

    // 更新计数
    const configuredCount = tableNames.filter(name =>
        tableApis[name] && !tableApis[name].useDefault && tableApis[name].model
    ).length;

    if (countEl) {
        if (tableNames.length > 0) {
            countEl.textContent = `已配置 ${configuredCount}/${tableNames.length}`;
        } else {
            countEl.textContent = `未检测到表格`;
        }
        countEl.classList.toggle("configured", configuredCount > 0);
    }

    listEl.innerHTML = "";

    if (tableNames.length === 0) {
        if (emptyEl) {
            emptyEl.style.display = "flex";
            emptyEl.innerHTML = `
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>未检测到 Amily2 表格<br><small>请确保已加载表格预设并开启聊天</small></span>
            `;
        }
        return;
    }

    if (emptyEl) emptyEl.style.display = "none";

    // 渲染所有检测到的表格
    tableNames.forEach((tableName) => {
        const tableConfig = tableApis[tableName];
        const isConfigured = tableConfig && !tableConfig.useDefault && tableConfig.model;

        const item = document.createElement("div");
        item.className = "mm-multi-ai-provider-item";
        item.dataset.tableName = tableName;

        if (isConfigured) {
            // 已配置的表格
            item.innerHTML = `
                <div class="mm-multi-ai-provider-info">
                    <span class="mm-multi-ai-provider-name">
                        <i class="fa-solid fa-check-circle mm-configured-icon"></i>
                        ${escapeHtml(tableName)}
                    </span>
                    <span class="mm-multi-ai-provider-details">
                        ${escapeHtml(tableConfig.model || "未配置")}
                    </span>
                </div>
                <div class="mm-multi-ai-provider-actions">
                    <button type="button" class="mm-btn mm-btn-icon mm-table-api-edit" title="编辑">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button type="button" class="mm-btn mm-btn-icon mm-btn-danger mm-table-api-delete" title="删除配置">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;

            // 绑定编辑按钮
            item.querySelector(".mm-table-api-edit")?.addEventListener("click", () => {
                showTableFillerApiModal(tableName);
            });

            // 绑定删除按钮
            item.querySelector(".mm-table-api-delete")?.addEventListener("click", () => {
                if (confirm(`确定删除「${tableName}」的API配置吗？`)) {
                    deleteTableApiConfig(tableName);
                    renderAllTablesWithStatus();
                }
            });

            // 为已配置表格也绑定行点击事件（点击非按钮区域打开编辑弹窗）
            item.addEventListener("click", (e) => {
                const target = e.target;
                if (target instanceof Element && !target.closest(".mm-btn")) {
                    showTableFillerApiModal(tableName);
                }
            });
        } else {
            // 未配置的表格
            item.classList.add("mm-table-unconfigured");
            item.innerHTML = `
                <div class="mm-multi-ai-provider-info">
                    <span class="mm-multi-ai-provider-name">
                        <i class="fa-solid fa-circle mm-unconfigured-icon"></i>
                        ${escapeHtml(tableName)}
                    </span>
                    <span class="mm-multi-ai-provider-details mm-text-muted">
                        点击配置API
                    </span>
                </div>
                <div class="mm-multi-ai-provider-actions">
                    <button type="button" class="mm-btn mm-btn-icon mm-btn-primary mm-table-api-add" title="配置API">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </div>
            `;

            // 点击整行或加号按钮都可配置
            item.addEventListener("click", (e) => {
                const target = e.target;
                if (target instanceof Element && !target.closest(".mm-btn")) {
                    showTableFillerApiModal(tableName);
                }
            });
            item.querySelector(".mm-table-api-add")?.addEventListener("click", () => {
                showTableFillerApiModal(tableName);
            });
        }

        listEl.appendChild(item);
    });
}

/**
 * 隐藏表格选择弹窗
 */
function hideTableSelectModal() {
    const modal = document.getElementById("mm-table-filler-select-modal");
    if (modal) {
        modal.classList.remove("mm-modal-visible");
    }
}

/**
 * 更新提示词模式按钮状态
 * @param {string} mode - 'shared' 或 'independent'
 */
function updatePromptModeButtons(mode) {
    const sharedRadio = /** @type {HTMLInputElement} */ (document.getElementById("mm-prompt-mode-shared"));
    const independentRadio = /** @type {HTMLInputElement} */ (document.getElementById("mm-prompt-mode-independent"));

    if (sharedRadio) {
        sharedRadio.checked = mode === "shared";
    }
    if (independentRadio) {
        independentRadio.checked = mode === "independent";
    }

    // 显示/隐藏独立模式区域
    const independentSection = document.getElementById(
        "mm-table-filler-independent-section",
    );
    if (independentSection) {
        independentSection.style.display =
            mode === "independent" ? "block" : "none";
    }

    // 更新高级设置 header 中的提示词模式徽章
    const badge = document.getElementById("mm-prompt-mode-badge");
    if (badge) {
        badge.textContent = mode === "shared" ? "共享模式" : "独立模式";
    }
}

/**
 * 更新模式状态显示
 */
function updateModeStatusDisplay() {
    const status = getModeStatus();

    const busStatusEl = document.getElementById("mm-table-filler-bus-status");
    const interceptStatusEl = document.getElementById("mm-table-filler-intercept-status");

    if (busStatusEl) {
        if (status.busAvailable) {
            busStatusEl.textContent = "Bus: 已连接";
            busStatusEl.className = "mm-status-badge mm-status-success";
        } else if (status.busRegistered) {
            busStatusEl.textContent = "Bus: 已注册";
            busStatusEl.className = "mm-status-badge mm-status-warning";
        } else {
            busStatusEl.textContent = "Bus: 不可用";
            busStatusEl.className = "mm-status-badge mm-status-inactive";
        }
    }

    if (interceptStatusEl) {
        // 检查全局钩子是否存在
        const hookInstalled = !!window._tableFillerInterceptor;

        if (status.interceptorInstalled || hookInstalled) {
            interceptStatusEl.textContent = "拦截: 已就绪";
            interceptStatusEl.className = "mm-status-badge mm-status-success";
        } else if (status.interceptAvailable) {
            interceptStatusEl.textContent = "拦截: 可用";
            interceptStatusEl.className = "mm-status-badge mm-status-warning";
        } else {
            interceptStatusEl.textContent = "拦截: 未安装";
            interceptStatusEl.className = "mm-status-badge mm-status-inactive";
        }
    }
}

/**
 * 更新表格填表徽章状态
 * @param {boolean} enabled - 是否启用
 */
export function updateTableFillerBadge(enabled) {
    const badge = document.getElementById("mm-table-filler-badge");
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
 * 更新配置计数显示
 * @deprecated 由 renderAllTablesWithStatus 统一处理
 */
function updateConfigCount() {
    // 计数更新已由 renderAllTablesWithStatus 处理
    // 此函数保留以兼容旧调用
}

/**
 * 更新预设信息显示
 */
function updatePresetInfoDisplay() {
    const config = getTableFillerConfig();
    const preset = config.importedPreset;
    const versionEl = document.getElementById("mm-table-filler-preset-version");
    const clearBtn = document.getElementById("mm-table-filler-clear-preset");

    if (versionEl) {
        if (preset?.version) {
            versionEl.textContent = preset.version;
        } else {
            versionEl.textContent = "未加载";
        }
    }

    if (clearBtn) {
        clearBtn.style.display = preset ? "inline-flex" : "none";
    }
}

/**
 * 检查 Amily2 填表模式兼容性
 */
function checkFillingModeCompatibility() {
    const warningEl = document.getElementById("mm-table-filler-mode-warning");
    const currentModeEl = document.getElementById("mm-table-filler-current-mode");

    if (!warningEl) return;

    if (isSecondaryApiMode()) {
        warningEl.style.display = "none";
    } else {
        warningEl.style.display = "flex";
        if (currentModeEl) {
            currentModeEl.textContent = getAmily2FillingModeName();
        }
    }
}

/**
 * 渲染表格 API 配置列表
 * @deprecated 使用 renderAllTablesWithStatus 代替
 */
function renderTableApiList() {
    // 调用新的异步渲染函数
    renderAllTablesWithStatus();
}

/**
 * 转义 HTML
 * @param {string} text - 文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

export default {
    initTableFillerUI,
    bindTableFillerEvents,
    updateTableFillerBadge,
};
