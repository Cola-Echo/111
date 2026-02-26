/**
 * Part 结果调试弹窗模块
 * @module memory/part-debug-modal
 */

import { getGlobalSettings } from "@config/config-manager";
import { enableModalDrag } from "@ui/modals/index";

// 是否启用调试模式
let debugEnabled = false;

/**
 * 设置调试模式
 * @param {boolean} enabled 是否启用
 */
export function setPartDebugEnabled(enabled) {
    debugEnabled = enabled;
}

/**
 * 获取调试模式状态
 * @returns {boolean}
 */
export function isPartDebugEnabled() {
    return debugEnabled;
}

/**
 * 显示 Part 结果调试弹窗
 * @param {Array} partResults 各 Part 的结果数组
 * @param {string} bookName 世界书名称
 * @param {object} mergedResult 合并后的结果
 */
export function showPartDebugModal(partResults, bookName, mergedResult) {
    if (!debugEnabled) return;

    // 创建弹窗容器
    const modal = document.createElement("div");
    modal.className = "mm-modal mm-modal-visible";
    modal.style.zIndex = "999999";

    // 应用当前主题
    const settings = getGlobalSettings();
    const theme = settings.theme || "default";
    if (theme !== "default") {
        modal.setAttribute("data-mm-theme", theme);
    }

    // 创建弹窗内容
    const content = document.createElement("div");
    content.className = "mm-modal-content";
    content.style.maxWidth = "900px";
    content.style.maxHeight = "85vh";
    content.style.display = "flex";
    content.style.flexDirection = "column";

    // 创建弹窗头部
    const header = document.createElement("div");
    header.className = "mm-modal-header";
    header.innerHTML = `
        <h4 style="margin: 0; display: flex; align-items: center; gap: 8px;">
            <i class="fa-solid fa-bug" style="color: #9b59b6;"></i>
            总结世界书拆分调试 - ${bookName}
        </h4>
        <button class="mm-modal-close mm-btn mm-btn-icon">
            <i class="fa-solid fa-times"></i>
        </button>
    `;

    // 创建弹窗主体
    const body = document.createElement("div");
    body.className = "mm-modal-body";
    body.style.padding = "16px";
    body.style.overflow = "auto";
    body.style.flex = "1";

    // 统计信息
    const validResults = partResults.filter(r => r !== null && r.rawMemory);
    const statsHtml = `
        <div style="background: var(--mm-bg-secondary); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
            <div style="display: flex; gap: 24px; flex-wrap: wrap;">
                <div><strong>总 Part 数：</strong>${partResults.length}</div>
                <div><strong>有效返回：</strong><span style="color: #27ae60;">${validResults.length}</span></div>
                <div><strong>无返回/失败：</strong><span style="color: ${partResults.length - validResults.length > 0 ? '#e74c3c' : '#27ae60'};">${partResults.length - validResults.length}</span></div>
                <div><strong>合并后事件数：</strong>${mergedResult?.eventCount || 0}</div>
            </div>
        </div>
    `;

    // 各 Part 结果
    let partsHtml = '<div style="display: flex; flex-direction: column; gap: 12px;">';

    partResults.forEach((result, index) => {
        const partNum = index + 1;
        const hasResult = result !== null && result.rawMemory;
        const statusColor = hasResult ? "#27ae60" : "#e74c3c";
        const statusIcon = hasResult ? "fa-check-circle" : "fa-times-circle";
        const statusText = hasResult ? "成功" : "无返回";

        // 提取楼层范围
        let floorRange = "";
        if (result?.partId) {
            const match = result.partId.match(/floor_(\d+)_(\d+)/);
            if (match) {
                floorRange = `${match[1]}-${match[2]}楼`;
            }
        }

        partsHtml += `
            <div style="border: 1px solid var(--mm-border); border-radius: 8px; overflow: hidden;">
                <div style="background: var(--mm-bg-secondary); padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fa-solid ${statusIcon}" style="color: ${statusColor};"></i>
                        <strong>Part ${partNum}</strong>
                        ${floorRange ? `<span style="color: var(--mm-text-muted); font-size: 12px;">(${floorRange})</span>` : ""}
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="color: ${statusColor}; font-size: 13px;">${statusText}</span>
                        ${hasResult ? `<span style="color: var(--mm-text-muted); font-size: 12px;">${result.rawMemory.length} 字符</span>` : ""}
                        <i class="fa-solid fa-chevron-down" style="color: var(--mm-text-muted);"></i>
                    </div>
                </div>
                <div style="display: none; padding: 12px; background: var(--mm-bg); max-height: 300px; overflow: auto;">
                    ${hasResult
                        ? `<pre style="margin: 0; white-space: pre-wrap; word-break: break-all; font-size: 12px; line-height: 1.5; color: var(--mm-text);">${escapeHtml(result.rawMemory)}</pre>`
                        : `<div style="color: var(--mm-text-muted); font-style: italic;">该 Part 未返回内容（可能未配置 API 或请求失败）</div>`
                    }
                </div>
            </div>
        `;
    });

    partsHtml += '</div>';

    // 合并结果
    let mergedHtml = '';
    if (mergedResult && mergedResult.rawMemory) {
        mergedHtml = `
            <div style="margin-top: 16px; border: 2px solid #3498db; border-radius: 8px; overflow: hidden;">
                <div style="background: rgba(52, 152, 219, 0.1); padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fa-solid fa-layer-group" style="color: #3498db;"></i>
                        <strong>合并后结果</strong>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="color: var(--mm-text-muted); font-size: 12px;">${mergedResult.rawMemory.length} 字符</span>
                        <i class="fa-solid fa-chevron-down" style="color: var(--mm-text-muted);"></i>
                    </div>
                </div>
                <div style="display: block; padding: 12px; background: var(--mm-bg); max-height: 300px; overflow: auto;">
                    <pre style="margin: 0; white-space: pre-wrap; word-break: break-all; font-size: 12px; line-height: 1.5; color: var(--mm-text);">${escapeHtml(mergedResult.rawMemory)}</pre>
                </div>
            </div>
        `;
    }

    body.innerHTML = statsHtml + partsHtml + mergedHtml;

    // 创建弹窗底部
    const footer = document.createElement("div");
    footer.className = "mm-modal-footer";
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "10px";
    footer.style.padding = "12px 16px";
    footer.style.borderTop = "1px solid var(--mm-border)";

    const closeBtn = document.createElement("button");
    closeBtn.className = "mm-btn mm-btn-primary";
    closeBtn.innerHTML = `<i class="fa-solid fa-check" style="margin-right: 6px;"></i>确定`;

    footer.appendChild(closeBtn);

    content.appendChild(header);
    content.appendChild(body);
    content.appendChild(footer);
    modal.appendChild(content);
    document.body.appendChild(modal);

    // 启用弹窗拖拽移动
    enableModalDrag(modal, content, header);

    const cleanup = () => {
        document.body.removeChild(modal);
    };

    closeBtn.addEventListener("click", cleanup);
    header.querySelector(".mm-modal-close").addEventListener("click", cleanup);
    modal.addEventListener("click", (e) => {
        if (e.target === modal) cleanup();
    });
}

/**
 * HTML 转义
 * @param {string} str 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}
