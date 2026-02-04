/**
 * 世界书选择器弹窗模块
 * @module ui/modals/worldbook-selector
 */

import Logger from '@core/logger';
import { getGlobalSettings } from '@config/config-manager';
import { getImportedBookNames, saveImportedBookNames } from '@config/imported-books';
import { getAllAvailableWorldBooks, isSummaryBook } from '@worldbook/api';
import { refreshWorldBookList } from '@worldbook/refresh';

// 可用世界书缓存
let availableWorldBooks = [];

/**
 * 转义 HTML，防止 XSS 攻击
 * @param {string} text 原始文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 创建世界书选择器弹窗
 */
function createWorldBookSelectorModal() {
    if (document.getElementById("mm-worldbook-selector-modal")) return;

    const modal = document.createElement("div");
    modal.id = "mm-worldbook-selector-modal";
    modal.className = "mm-modal";
    modal.innerHTML = `
        <div class="mm-modal-content mm-worldbook-selector">
            <div class="mm-modal-header">
                <h3>选择世界书</h3>
                <button class="mm-modal-close" id="mm-selector-close">&times;</button>
            </div>
            <div class="mm-modal-body">
                <div class="mm-selector-hint">
                    <i class="fa-solid fa-info-circle"></i>
                    勾选要导入的世界书，插件将自动检测并处理这些世界书
                </div>
                <div class="mm-selector-list" id="mm-selector-list">
                    <div class="mm-loading">加载中...</div>
                </div>
            </div>
            <div class="mm-modal-footer">
                <button class="mm-btn" id="mm-selector-cancel">取消</button>
                <button class="mm-btn mm-btn-primary" id="mm-selector-confirm">确认导入</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // 绑定事件
    document
        .getElementById("mm-selector-close")
        .addEventListener("click", hideWorldBookSelector);
    document
        .getElementById("mm-selector-cancel")
        .addEventListener("click", hideWorldBookSelector);
    document
        .getElementById("mm-selector-confirm")
        .addEventListener("click", confirmImportWorldBooks);
}

/**
 * 显示世界书选择器弹窗
 */
export async function showWorldBookSelector() {
    createWorldBookSelectorModal();

    const modal = document.getElementById("mm-worldbook-selector-modal");
    const listContainer = document.getElementById("mm-selector-list");

    // 应用当前主题
    const settings = getGlobalSettings();
    const theme = settings.theme || "default";
    if (theme !== "default") {
        modal.setAttribute("data-mm-theme", theme);
    }

    modal.classList.add("mm-modal-visible");
    listContainer.innerHTML =
        '<div class="mm-loading"><i class="fa-solid fa-spinner fa-spin"></i> 正在获取世界书列表...</div>';

    try {
        availableWorldBooks = await getAllAvailableWorldBooks();
        const importedNames = getImportedBookNames();

        if (availableWorldBooks.length === 0) {
            listContainer.innerHTML = `
                <div class="mm-empty-state">
                    <i class="fa-solid fa-book"></i>
                    <p>未找到任何世界书</p>
                </div>`;
            return;
        }

        let html = "";
        for (const bookName of availableWorldBooks) {
            const isImported = importedNames.includes(bookName);
            const bookType = isSummaryBook(bookName) ? "总结" : "记忆";
            const typeClass = isSummaryBook(bookName)
                ? "mm-type-summary"
                : "mm-type-memory";

            const safeBookName = escapeHtml(bookName);
            html += `
                <label class="mm-selector-item">
                    <input type="checkbox" value="${safeBookName}" ${
                        isImported ? "checked" : ""
                    }>
                    <span class="mm-selector-checkbox"></span>
                    <span class="mm-selector-name">${safeBookName}</span>
                    <span class="mm-selector-type ${typeClass}">${bookType}</span>
                </label>`;
        }

        listContainer.innerHTML = html;
    } catch (error) {
        Logger.error("获取世界书列表失败:", error);
        const safeErrorMsg = escapeHtml(error.message);
        listContainer.innerHTML = `
            <div class="mm-error-state">
                <i class="fa-solid fa-exclamation-triangle"></i>
                <p>加载失败: ${safeErrorMsg}</p>
            </div>`;
    }
}

/**
 * 隐藏世界书选择器弹窗
 */
export function hideWorldBookSelector() {
    const modal = document.getElementById("mm-worldbook-selector-modal");
    if (modal) {
        modal.classList.remove("mm-modal-visible");
    }
}

/**
 * 确认导入世界书
 */
async function confirmImportWorldBooks() {
    const listContainer = document.getElementById("mm-selector-list");
    const checkboxes = listContainer.querySelectorAll('input[type="checkbox"]');

    const selectedBooks = [];
    checkboxes.forEach((cb) => {
        if (cb.checked) {
            selectedBooks.push(cb.value);
        }
    });

    saveImportedBookNames(selectedBooks);
    hideWorldBookSelector();

    Logger.log(`已导入 ${selectedBooks.length} 个世界书`);
    await refreshWorldBookList();
}
