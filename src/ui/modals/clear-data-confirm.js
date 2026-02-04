/**
 * 清除旧数据确认弹窗模块
 * @module ui/modals/clear-data-confirm
 */

import { getGlobalSettings } from '@config/config-manager';

/**
 * 显示清除旧数据确认弹窗
 * @returns {Promise<boolean>} 用户是否确认清除
 */
export function showClearDataConfirmModal() {
    return new Promise((resolve) => {
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
        content.style.maxWidth = "520px";

        // 创建弹窗头部
        const header = document.createElement("div");
        header.className = "mm-modal-header";
        header.innerHTML = `
            <h4 style="margin: 0; display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-triangle-exclamation" style="color: #f39c12;"></i>
                清除旧数据确认
            </h4>
            <button class="mm-modal-close mm-btn mm-btn-icon">
                <i class="fa-solid fa-times"></i>
            </button>
        `;

        // 创建弹窗主体
        const body = document.createElement("div");
        body.className = "mm-modal-body";
        body.style.padding = "20px";

        body.innerHTML = `
            <div style="margin-bottom: 16px; color: var(--mm-text);">
                <p style="margin: 0 0 12px 0; font-weight: 500;">此操作将清除以下数据：</p>
                <ul style="margin: 0 0 16px 20px; padding: 0; line-height: 1.8; color: var(--mm-text-muted);">
                    <li><i class="fa-solid fa-file-lines" style="width: 16px; margin-right: 6px; color: #e74c3c;"></i>自定义提示词预设（关键词/历史事件/剧情优化，会恢复为内置提示词）</li>
                    <li><i class="fa-solid fa-list-ol" style="width: 16px; margin-right: 6px; color: #e74c3c;"></i>流程配置（来源排序会恢复默认）</li>
                    <li><i class="fa-solid fa-book" style="width: 16px; margin-right: 6px; color: #e74c3c;"></i>已导入的世界书记录</li>
                    <li><i class="fa-solid fa-message" style="width: 16px; margin-right: 6px; color: #e74c3c;"></i>多AI生成的提示词预设（你创建的所有预设都会被删除）</li>
                    <li><i class="fa-solid fa-arrows-alt" style="width: 16px; margin-right: 6px; color: #e74c3c;"></i>UI位置缓存、世界书递归设置</li>
                </ul>
            </div>

            <div style="margin-bottom: 16px; color: var(--mm-text);">
                <p style="margin: 0 0 12px 0; font-weight: 500;">以下数据将被保留：</p>
                <ul style="margin: 0 0 16px 20px; padding: 0; line-height: 1.8; color: var(--mm-text-muted);">
                    <li><i class="fa-solid fa-robot" style="width: 16px; margin-right: 6px; color: #27ae60;"></i>记忆分类 API 配置</li>
                    <li><i class="fa-solid fa-scroll" style="width: 16px; margin-right: 6px; color: #27ae60;"></i>总结世界书 API 配置</li>
                    <li><i class="fa-solid fa-layer-group" style="width: 16px; margin-right: 6px; color: #27ae60;"></i>索引合并 API 配置</li>
                    <li><i class="fa-solid fa-wand-magic-sparkles" style="width: 16px; margin-right: 6px; color: #27ae60;"></i>剧情优化 API 配置</li>
                    <li><i class="fa-solid fa-users" style="width: 16px; margin-right: 6px; color: #27ae60;"></i>多AI生成的 API 配置（但会解除其提示词预设关联）</li>
                </ul>
            </div>

            <div style="background: rgba(243, 156, 18, 0.1); border: 1px solid rgba(243, 156, 18, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 8px;">
                <p style="margin: 0; font-size: 13px; color: var(--mm-text-muted);">
                    <i class="fa-solid fa-lightbulb" style="margin-right: 6px; color: #f39c12;"></i>
                    <strong>建议：</strong>如果你有自定义的提示词或流程配置，请先点击「选择提示词」→「导出」和「流程配置」→「导出」保存备份。多AI生成的提示词预设目前暂不支持导出。
                </p>
            </div>
        `;

        // 创建弹窗底部
        const footer = document.createElement("div");
        footer.className = "mm-modal-footer";
        footer.style.display = "flex";
        footer.style.justifyContent = "flex-end";
        footer.style.gap = "10px";
        footer.style.padding = "15px 20px";
        footer.style.borderTop = "1px solid var(--mm-border)";

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "mm-btn mm-btn-secondary";
        cancelBtn.innerHTML = `<i class="fa-solid fa-xmark" style="margin-right: 6px;"></i>取消`;

        const confirmBtn = document.createElement("button");
        confirmBtn.className = "mm-btn mm-btn-danger";
        confirmBtn.innerHTML = `<i class="fa-solid fa-trash" style="margin-right: 6px;"></i>确认清除`;

        footer.appendChild(cancelBtn);
        footer.appendChild(confirmBtn);

        content.appendChild(header);
        content.appendChild(body);
        content.appendChild(footer);
        modal.appendChild(content);
        document.body.appendChild(modal);

        const cleanup = () => {
            document.body.removeChild(modal);
        };

        // 确认清除
        confirmBtn.addEventListener("click", () => {
            cleanup();
            resolve(true);
        });

        // 取消
        cancelBtn.addEventListener("click", () => {
            cleanup();
            resolve(false);
        });

        // 关闭按钮
        header.querySelector(".mm-modal-close").addEventListener("click", () => {
            cleanup();
            resolve(false);
        });

        // 点击遮罩关闭
        modal.addEventListener("click", (e) => {
            if (e.target === modal) {
                cleanup();
                resolve(false);
            }
        });
    });
}
