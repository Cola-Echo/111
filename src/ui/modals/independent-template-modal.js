/**
 * 独立模式模板编辑弹窗
 * @module ui/modals/independent-template-modal
 */

import Logger from "@core/logger";
import {
    setIndependentTemplate,
    deleteIndependentTemplate,
    getAllIndependentTemplates,
    getGlobalSettings,
    getIndependentTagName,
    setIndependentTagName,
    loadDefaultIndependentTemplates,
    getAllIndependentTemplatesWithDefault,
} from "@config/config-manager";

const log = Logger.createModuleLogger("独立模式模板");

// 缓存的表格名称
let cachedTableNames = [];
// 当前编辑中的模板数据（临时存储，保存时才写入配置）
let pendingTemplates = {};
// 是否有未保存的更改
let hasUnsavedChanges = false;

/**
 * 从 Amily2 获取表格名称列表
 * @returns {Promise<string[]>}
 */
async function getAmily2TableNames() {
    try {
        // 复用 table-filler.js 中的获取逻辑
        const amilyExtName = "ST-Amily2-Chat-Optimisation";
        const settings = window.extension_settings?.[amilyExtName];

        if (settings?.global_table_preset?.tables) {
            const tables = settings.global_table_preset.tables;
            if (Array.isArray(tables) && tables.length > 0) {
                const names = tables.map((t) => t.name).filter(Boolean);
                if (names.length > 0) return names;
            }
        }

        if (settings?.tables && Array.isArray(settings.tables)) {
            const names = settings.tables.map((t) => t.name).filter(Boolean);
            if (names.length > 0) return names;
        }

        // 尝试从 DOM 获取
        const tableTabsContainer = document.querySelector(".amily2-table-tabs");
        if (tableTabsContainer) {
            const tabButtons =
                tableTabsContainer.querySelectorAll("button.menu_button");
            const names = [];
            tabButtons.forEach((btn) => {
                if (!btn.querySelector(".fa-plus")) {
                    const name = btn.textContent?.trim().replace(/•$/, "").trim();
                    if (name) names.push(name);
                }
            });
            if (names.length > 0) return names;
        }

        log.warn("未能获取 Amily2 表格名称");
        return [];
    } catch (e) {
        log.error("获取 Amily2 表格名称失败:", e);
        return [];
    }
}

/**
 * 显示独立模式模板编辑弹窗
 */
export async function showIndependentTemplateModal() {
    const modal = document.getElementById("mm-independent-template-modal");
    if (!modal) {
        log.error("找不到独立模式模板弹窗元素");
        return;
    }

    // 应用主题
    const settings = getGlobalSettings();
    const theme = settings.theme || "default";
    if (theme !== "default") {
        modal.setAttribute("data-mm-theme", theme);
    } else {
        modal.removeAttribute("data-mm-theme");
    }

    // 重置状态
    hasUnsavedChanges = false;

    // 加载表格名称
    cachedTableNames = await getAmily2TableNames();

    // 加载已保存的模板和默认模板到临时存储
    const allTemplates = await getAllIndependentTemplatesWithDefault();
    pendingTemplates = {};

    // 分离持久化模板和默认模板
    for (const [tableName, data] of Object.entries(allTemplates)) {
        // 确保模板内容是字符串（处理可能的嵌套结构）
        let templateContent = data.template;
        if (typeof templateContent === 'object' && templateContent !== null) {
            templateContent = templateContent.template;
        }
        if (typeof templateContent !== 'string') {
            templateContent = '';
        }

        if (data.isDefault) {
            // 默认模板：标记为默认，但不算已配置
            pendingTemplates[tableName] = { template: templateContent, isDefault: true };
        } else {
            // 持久化模板
            pendingTemplates[tableName] = { template: templateContent };
        }
    }

    // 渲染模板列表
    renderTemplateList();

    // 显示弹窗
    modal.classList.add("mm-modal-visible");
}

/**
 * 隐藏独立模式模板编辑弹窗
 */
export function hideIndependentTemplateModal() {
    const modal = document.getElementById("mm-independent-template-modal");
    if (modal) {
        modal.classList.remove("mm-modal-visible");
    }
}

/**
 * 渲染模板列表
 */
function renderTemplateList() {
    const listEl = document.getElementById("mm-independent-template-list");
    if (!listEl) return;

    if (cachedTableNames.length === 0) {
        listEl.innerHTML = `
            <div class="mm-template-loading">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>未检测到 Amily2 表格<br><small>请确保已加载表格预设并开启聊天</small></span>
            </div>
        `;
        return;
    }

    listEl.innerHTML = "";

    cachedTableNames.forEach((tableName) => {
        const templateData = pendingTemplates[tableName];
        const isConfigured = !!templateData?.template && !templateData?.isDefault;
        const isDefault = !!templateData?.isDefault;
        const hasTemplate = !!templateData?.template;

        const item = document.createElement("div");
        item.className = `mm-template-item${isConfigured ? " configured" : ""}${isDefault ? " default" : ""}`;
        item.dataset.tableName = tableName;

        // 状态文字
        let statusText = "未配置";
        let statusClass = "";
        if (isConfigured) {
            statusText = "已配置";
            statusClass = " configured";
        } else if (isDefault) {
            statusText = "内置默认";
            statusClass = " default";
        }

        item.innerHTML = `
            <div class="mm-template-item-header">
                <div class="mm-template-item-left">
                    <i class="fa-solid fa-chevron-down mm-template-item-arrow"></i>
                    <span class="mm-template-item-name">${escapeHtml(tableName)}</span>
                    <span class="mm-template-item-status${statusClass}">${statusText}</span>
                </div>
                <div class="mm-template-item-right">
                    ${isConfigured ? `<button type="button" class="mm-btn mm-btn-icon mm-btn-xs mm-btn-secondary mm-template-item-restore" title="恢复内置默认模板">
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>` : ""}
                    ${hasTemplate ? `<button type="button" class="mm-btn mm-btn-icon mm-btn-xs mm-btn-danger mm-template-item-clear" title="${isDefault ? "清空此模板" : "清空此模板"}">
                        <i class="fa-solid fa-trash"></i>
                    </button>` : ""}
                </div>
            </div>
            <div class="mm-template-item-body">
                <textarea class="mm-template-textarea" placeholder="输入提示词模板，可使用占位符：{{tableData}}、{{tableName}}、{{tableIndex}}">${escapeHtml(templateData?.template || "")}</textarea>
                <div class="mm-template-preview-hint">
                    <i class="fa-solid fa-lightbulb"></i>
                    ${isDefault ? "提示：这是内置默认模板，编辑后将保存为自定义模板" : "提示：未配置的表格将自动使用共享模式处理"}
                </div>
            </div>
        `;

        // 绑定折叠切换
        const header = item.querySelector(".mm-template-item-header");
        header.addEventListener("click", (e) => {
            // 如果点击的是按钮，不切换折叠
            if (e.target.closest(".mm-btn")) return;
            item.classList.toggle("expanded");
        });

        // 绑定清空按钮
        const clearBtn = item.querySelector(".mm-template-item-clear");
        if (clearBtn) {
            clearBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (confirm(`确定清空「${tableName}」的模板吗？`)) {
                    delete pendingTemplates[tableName];
                    hasUnsavedChanges = true;
                    renderTemplateList();
                }
            });
        }

        // 绑定恢复默认按钮
        const restoreBtn = item.querySelector(".mm-template-item-restore");
        if (restoreBtn) {
            restoreBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const defaultTemplates = await loadDefaultIndependentTemplates();
                const defaultTemplate = defaultTemplates?.templates?.[tableName];
                if (defaultTemplate) {
                    const templateContent = typeof defaultTemplate === 'string' ? defaultTemplate : defaultTemplate?.template;
                    if (templateContent) {
                        pendingTemplates[tableName] = { template: templateContent, isDefault: true };
                        hasUnsavedChanges = true;
                        renderTemplateList();
                        if (typeof toastr !== "undefined") {
                            toastr.success(`已恢复「${tableName}」的内置默认模板`, "独立模式");
                        }
                    }
                } else {
                    if (typeof toastr !== "undefined") {
                        toastr.warning(`「${tableName}」没有内置默认模板`, "独立模式");
                    }
                }
            });
        }

        // 绑定文本框变更
        const textarea = item.querySelector(".mm-template-textarea");
        textarea.addEventListener("input", () => {
            const value = textarea.value.trim();
            if (value) {
                // 编辑后移除 isDefault 标记，变为自定义模板
                pendingTemplates[tableName] = { template: value };
            } else {
                delete pendingTemplates[tableName];
            }
            hasUnsavedChanges = true;
            updateItemStatus(item, !!value, false);
        });

        listEl.appendChild(item);
    });
}

/**
 * 更新单个项目的状态显示
 * @param {HTMLElement} item
 * @param {boolean} isConfigured
 * @param {boolean} isDefault
 */
function updateItemStatus(item, isConfigured, isDefault = false) {
    const statusEl = item.querySelector(".mm-template-item-status");
    if (statusEl) {
        if (isConfigured) {
            statusEl.textContent = "已配置";
            statusEl.className = "mm-template-item-status configured";
        } else if (isDefault) {
            statusEl.textContent = "内置默认";
            statusEl.className = "mm-template-item-status default";
        } else {
            statusEl.textContent = "未配置";
            statusEl.className = "mm-template-item-status";
        }
    }
    item.classList.toggle("configured", isConfigured);
    item.classList.toggle("default", isDefault && !isConfigured);
}

/**
 * 保存所有模板
 */
export function saveAllTemplates() {
    // 清除所有现有模板
    const existingTemplates = getAllIndependentTemplates();
    for (const tableName of Object.keys(existingTemplates)) {
        deleteIndependentTemplate(tableName);
    }

    // 保存新模板（只保存非默认的，即用户自定义的）
    for (const [tableName, data] of Object.entries(pendingTemplates)) {
        if (data?.template && !data?.isDefault) {
            setIndependentTemplate(tableName, data.template);
        }
    }

    hasUnsavedChanges = false;

    // 更新设置面板中的状态显示
    updateTemplateStatusDisplay();

    if (typeof toastr !== "undefined") {
        toastr.success("模板配置已保存", "独立模式");
    }
}

/**
 * 导入模板配置
 * @param {File} file
 */
export async function importTemplates(file) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.templates || typeof data.templates !== "object") {
            throw new Error("无效的配置格式");
        }

        // 合并导入的模板
        for (const [tableName, templateData] of Object.entries(data.templates)) {
            if (templateData?.template) {
                pendingTemplates[tableName] = { template: templateData.template };
            }
        }

        // 如果有标签名配置，也导入
        if (data.tagName) {
            setIndependentTagName(data.tagName);
            const tagInput = document.getElementById("mm-table-filler-tag-name");
            if (tagInput) {
                tagInput.value = data.tagName;
            }
        }

        hasUnsavedChanges = true;
        renderTemplateList();

        if (typeof toastr !== "undefined") {
            toastr.success("配置已导入，请点击保存", "独立模式");
        }
    } catch (e) {
        log.error("导入配置失败:", e);
        if (typeof toastr !== "undefined") {
            toastr.error(`导入失败: ${e.message}`, "独立模式");
        }
    }
}

/**
 * 导出模板配置
 */
export function exportTemplates() {
    const data = {
        version: "1.0",
        templates: pendingTemplates,
        tagName: getIndependentTagName(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "independent-templates.json";
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * 更新设置面板中的模板状态显示
 */
async function updateTemplateStatusDisplay() {
    const statusEl = document.getElementById("mm-table-filler-template-status");
    if (!statusEl) return;

    const templates = getAllIndependentTemplates();
    const customCount = Object.keys(templates).length;

    // 加载默认模板统计
    const defaultTemplates = await loadDefaultIndependentTemplates();
    const defaultCount = defaultTemplates?.templates ? Object.keys(defaultTemplates.templates).length : 0;

    if (customCount > 0) {
        statusEl.textContent = `已配置 ${customCount} 个`;
        statusEl.classList.add("configured");
        statusEl.classList.remove("default");
    } else if (defaultCount > 0) {
        statusEl.textContent = `使用默认 ${defaultCount} 个`;
        statusEl.classList.remove("configured");
        statusEl.classList.add("default");
    } else {
        statusEl.textContent = "未配置";
        statusEl.classList.remove("configured");
        statusEl.classList.remove("default");
    }
}

/**
 * 绑定独立模式模板弹窗事件
 */
export function bindIndependentTemplateEvents() {
    // 编辑按钮（设置面板中）- 先绑定，不依赖 modal 存在
    document
        .getElementById("mm-table-filler-edit-templates")
        ?.addEventListener("click", () => {
            showIndependentTemplateModal();
        });

    const modal = document.getElementById("mm-independent-template-modal");
    if (!modal) {
        log.warn("独立模式模板弹窗元素未找到，部分事件未绑定");
        return;
    }

    // 关闭按钮
    modal.querySelector(".mm-modal-close")?.addEventListener("click", () => {
        if (hasUnsavedChanges && !confirm("有未保存的更改，确定关闭吗？")) {
            return;
        }
        hideIndependentTemplateModal();
    });

    // 取消按钮
    document
        .getElementById("mm-independent-template-cancel")
        ?.addEventListener("click", () => {
            if (hasUnsavedChanges && !confirm("有未保存的更改，确定取消吗？")) {
                return;
            }
            hideIndependentTemplateModal();
        });

    // 保存按钮
    document
        .getElementById("mm-independent-template-save")
        ?.addEventListener("click", () => {
            saveAllTemplates();
            hideIndependentTemplateModal();
        });

    // 导入按钮
    document
        .getElementById("mm-independent-template-import")
        ?.addEventListener("click", () => {
            const fileInput = document.getElementById("mm-independent-template-file");
            if (fileInput) {
                fileInput.click();
            }
        });

    // 文件选择
    document
        .getElementById("mm-independent-template-file")
        ?.addEventListener("change", async (e) => {
            const file = e.target.files?.[0];
            if (file) {
                await importTemplates(file);
            }
            e.target.value = "";
        });

    // 导出按钮
    document
        .getElementById("mm-independent-template-export")
        ?.addEventListener("click", () => {
            exportTemplates();
        });

    // 全部恢复默认按钮
    document
        .getElementById("mm-independent-template-restore-all")
        ?.addEventListener("click", async () => {
            if (!confirm("确定将所有模板恢复为内置默认吗？自定义的模板将被覆盖。")) {
                return;
            }
            const defaultTemplates = await loadDefaultIndependentTemplates();
            if (defaultTemplates?.templates) {
                pendingTemplates = {};
                for (const [tableName, templateObj] of Object.entries(defaultTemplates.templates)) {
                    const templateContent = typeof templateObj === 'string' ? templateObj : templateObj?.template;
                    if (templateContent) {
                        pendingTemplates[tableName] = { template: templateContent, isDefault: true };
                    }
                }
                hasUnsavedChanges = true;
                renderTemplateList();
                if (typeof toastr !== "undefined") {
                    toastr.success("已恢复所有模板为内置默认", "独立模式");
                }
            } else {
                if (typeof toastr !== "undefined") {
                    toastr.warning("未找到内置默认模板", "独立模式");
                }
            }
        });

    // 初始化状态显示
    updateTemplateStatusDisplay();
}

/**
 * 转义 HTML
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

export default {
    showIndependentTemplateModal,
    hideIndependentTemplateModal,
    bindIndependentTemplateEvents,
    saveAllTemplates,
    importTemplates,
    exportTemplates,
};
