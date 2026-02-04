/**
 * 汇总检查弹窗模块
 * @module ui/modals/summary-check
 */

import { getGlobalSettings, isMultiAIAvailable } from '@config/config-manager';

/**
 * 显示汇总检查弹窗
 * @param {string} summaryContent - 记忆摘要内容
 * @param {string} editorContent - 剧情优化内容（可选）
 * @returns {Promise<{action: 'confirm'|'regenerate'|'multi-regenerate'|'cancel', editedSummary?: string, editedEditor?: string}>} 用户操作结果
 */
export function showSummaryCheckModal(summaryContent, editorContent = "") {
    return new Promise((resolve) => {
        // 创建弹窗容器 - 无遮罩模式，允许与主界面交互
        const modal = document.createElement("div");
        modal.className = "mm-modal mm-modal-visible";
        modal.style.zIndex = "999999";
        modal.style.position = "fixed";
        modal.style.top = "0";
        modal.style.left = "0";
        modal.style.right = "0";
        modal.style.bottom = "0";
        modal.style.background = "transparent";
        modal.style.display = "flex";
        modal.style.alignItems = "center";
        modal.style.justifyContent = "center";
        modal.style.pointerEvents = "none"; // 允许点击穿透到下层

        // 应用当前主题
        const settings = getGlobalSettings();
        const theme = settings.theme || "default";
        if (theme !== "default") {
            modal.setAttribute("data-mm-theme", theme);
        }

        // 创建弹窗内容
        const content = document.createElement("div");
        content.className = "mm-modal-content mm-modal-large";
        content.style.width = "100%";
        content.style.maxWidth = "800px";
        content.style.height = "80vh";
        content.style.maxHeight = "80vh";
        content.style.overflow = "hidden";
        content.style.display = "flex";
        content.style.flexDirection = "column";
        content.style.background = "var(--mm-bg)";
        content.style.borderRadius = "var(--mm-radius)";
        content.style.boxShadow = "0 4px 20px rgba(0, 0, 0, 0.3)";
        content.style.pointerEvents = "auto"; // 弹窗内容可交互

        // 创建弹窗头部
        const header = document.createElement("div");
        header.className = "mm-modal-header";
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "center";
        header.style.padding = "15px 20px";
        header.style.borderBottom = "1px solid var(--mm-border)";
        header.style.flexShrink = "0";

        const title = document.createElement("h4");
        title.textContent = editorContent
            ? "汇总检查 - 记忆摘要 + 剧情优化"
            : "汇总检查 - AI 生成的记忆摘要";
        title.style.margin = "0";
        title.style.fontSize = "16px";
        title.style.color = "var(--mm-text)";

        const closeBtn = document.createElement("button");
        closeBtn.className = "mm-modal-close mm-btn mm-btn-icon";
        closeBtn.innerHTML = `<i class="fa-solid fa-times"></i>`;

        header.appendChild(title);
        header.appendChild(closeBtn);
        content.appendChild(header);

        // 创建弹窗主体
        const body = document.createElement("div");
        body.className = "mm-modal-body";
        body.style.flex = "1";
        body.style.overflowY = "auto";
        body.style.padding = "20px";

        // 提示信息
        const hint = document.createElement("div");
        hint.style.marginBottom = "15px";
        hint.style.padding = "10px 15px";
        hint.style.background = "var(--mm-bg-secondary)";
        hint.style.borderRadius = "var(--mm-radius)";
        hint.style.fontSize = "13px";
        hint.style.color = "var(--mm-text-muted)";
        hint.innerHTML = `<i class="fa-solid fa-info-circle" style="margin-right: 8px; color: var(--mm-primary);"></i>
            以下是将注入到对话中的内容。您可以直接编辑内容，然后选择确认发送或重新生成。`;
        body.appendChild(hint);

        // 记忆摘要内容区域
        const summaryContainer = document.createElement("div");
        summaryContainer.style.background = "var(--mm-bg-card)";
        summaryContainer.style.borderRadius = "var(--mm-radius)";
        summaryContainer.style.padding = "15px";
        summaryContainer.style.border = "1px solid var(--mm-border)";
        summaryContainer.style.marginBottom = editorContent ? "15px" : "0";

        const summaryLabel = document.createElement("div");
        summaryLabel.style.fontWeight = "bold";
        summaryLabel.style.marginBottom = "10px";
        summaryLabel.style.color = "var(--mm-primary)";
        summaryLabel.innerHTML = `<i class="fa-solid fa-brain" style="margin-right: 8px;"></i>记忆摘要内容`;
        summaryContainer.appendChild(summaryLabel);

        // 创建可调整高度的容器
        const resizableContainer = document.createElement("div");
        resizableContainer.style.position = "relative";
        resizableContainer.style.minHeight = "150px";

        // 使用 textarea 替代 div，支持编辑
        const summaryText = document.createElement("textarea");
        summaryText.style.width = "100%";
        summaryText.style.boxSizing = "border-box";
        summaryText.style.whiteSpace = "pre-wrap";
        summaryText.style.wordBreak = "break-word";
        summaryText.style.fontSize = "14px";
        summaryText.style.lineHeight = "1.6";
        summaryText.style.color = "var(--mm-text)";
        summaryText.style.height = editorContent ? "200px" : "300px";
        summaryText.style.minHeight = "100px";
        summaryText.style.maxHeight = "none";
        summaryText.style.overflowY = "auto";
        summaryText.style.padding = "10px";
        summaryText.style.background = "var(--mm-bg-secondary)";
        summaryText.style.borderRadius = "4px 4px 0 0";
        summaryText.style.resize = "none";
        summaryText.style.border = "1px solid var(--mm-border)";
        summaryText.style.fontFamily = "inherit";
        summaryText.value = summaryContent || "(无内容)";
        resizableContainer.appendChild(summaryText);

        // 创建拖动手柄（使用统一的 CSS 类）
        const resizeHandle = document.createElement("div");
        resizeHandle.className = "mm-resize-handle";
        resizableContainer.appendChild(resizeHandle);

        // 拖动调整高度逻辑
        let isResizing = false;
        let startY = 0;
        let startHeight = 0;

        resizeHandle.addEventListener("mousedown", (e) => {
            isResizing = true;
            startY = e.clientY;
            startHeight = summaryText.offsetHeight;
            document.body.style.cursor = "ns-resize";
            document.body.style.userSelect = "none";
            e.preventDefault();
        });

        document.addEventListener("mousemove", (e) => {
            if (!isResizing) return;
            const deltaY = e.clientY - startY;
            const newHeight = Math.max(100, startHeight + deltaY);
            summaryText.style.height = newHeight + "px";
        });

        document.addEventListener("mouseup", () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
            }
        });

        summaryContainer.appendChild(resizableContainer);

        body.appendChild(summaryContainer);

        // 剧情优化内容的 textarea 引用（在条件块外声明以便后续访问）
        let editorTextarea = null;

        // 如果有剧情优化内容，添加 Editor 区域
        if (editorContent) {
            const editorContainer = document.createElement("div");
            editorContainer.style.background = "var(--mm-bg-card)";
            editorContainer.style.borderRadius = "var(--mm-radius)";
            editorContainer.style.padding = "15px";
            editorContainer.style.border = "1px solid var(--mm-border)";
            editorContainer.style.borderLeftColor = "#9d7cd8"; // 紫色边框标识
            editorContainer.style.borderLeftWidth = "3px";

            const editorLabel = document.createElement("div");
            editorLabel.style.fontWeight = "bold";
            editorLabel.style.marginBottom = "10px";
            editorLabel.style.color = "#9d7cd8";
            editorLabel.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles" style="margin-right: 8px;"></i>剧情优化内容 (Editor)`;
            editorContainer.appendChild(editorLabel);

            // 创建可调整高度的容器
            const editorResizableContainer = document.createElement("div");
            editorResizableContainer.style.position = "relative";
            editorResizableContainer.style.minHeight = "100px";

            // 使用 textarea 替代 div，支持编辑
            editorTextarea = document.createElement("textarea");
            editorTextarea.style.width = "100%";
            editorTextarea.style.boxSizing = "border-box";
            editorTextarea.style.whiteSpace = "pre-wrap";
            editorTextarea.style.wordBreak = "break-word";
            editorTextarea.style.fontSize = "14px";
            editorTextarea.style.lineHeight = "1.6";
            editorTextarea.style.color = "var(--mm-text)";
            editorTextarea.style.height = "150px";
            editorTextarea.style.minHeight = "80px";
            editorTextarea.style.maxHeight = "none";
            editorTextarea.style.overflowY = "auto";
            editorTextarea.style.padding = "10px";
            editorTextarea.style.background = "var(--mm-bg-secondary)";
            editorTextarea.style.borderRadius = "4px 4px 0 0";
            editorTextarea.style.resize = "none";
            editorTextarea.style.border = "1px solid var(--mm-border)";
            editorTextarea.style.fontFamily = "inherit";
            editorTextarea.value = editorContent;
            editorResizableContainer.appendChild(editorTextarea);

            // 创建拖动手柄
            const editorResizeHandle = document.createElement("div");
            editorResizeHandle.className = "mm-resize-handle";
            editorResizableContainer.appendChild(editorResizeHandle);

            // 拖动调整高度逻辑
            let isEditorResizing = false;
            let editorStartY = 0;
            let editorStartHeight = 0;

            editorResizeHandle.addEventListener("mousedown", (e) => {
                isEditorResizing = true;
                editorStartY = e.clientY;
                editorStartHeight = editorTextarea.offsetHeight;
                document.body.style.cursor = "ns-resize";
                document.body.style.userSelect = "none";
                e.preventDefault();
            });

            document.addEventListener("mousemove", (e) => {
                if (!isEditorResizing) return;
                const deltaY = e.clientY - editorStartY;
                const newHeight = Math.max(80, editorStartHeight + deltaY);
                editorTextarea.style.height = newHeight + "px";
            });

            document.addEventListener("mouseup", () => {
                if (isEditorResizing) {
                    isEditorResizing = false;
                    document.body.style.cursor = "";
                    document.body.style.userSelect = "";
                }
            });

            editorContainer.appendChild(editorResizableContainer);
            body.appendChild(editorContainer);
        }

        content.appendChild(body);

        // 创建弹窗底部按钮
        const footer = document.createElement("div");
        footer.className = "mm-modal-footer";
        footer.style.display = "flex";
        footer.style.justifyContent = "flex-end";
        footer.style.gap = "10px";
        footer.style.padding = "15px 20px";
        footer.style.borderTop = "1px solid var(--mm-border)";
        footer.style.flexShrink = "0";

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "mm-btn mm-btn-secondary";
        cancelBtn.innerHTML = `<i class="fa-solid fa-xmark" style="margin-right: 6px;"></i>取消发送`;

        const regenerateBtn = document.createElement("button");
        regenerateBtn.className = "mm-btn mm-btn-secondary";
        regenerateBtn.innerHTML = `<i class="fa-solid fa-rotate" style="margin-right: 6px;"></i>重新生成`;

        // 多AI生成按钮 - 仅在功能可用时显示
        let multiAIBtn = null;
        if (isMultiAIAvailable()) {
            multiAIBtn = document.createElement("button");
            multiAIBtn.className = "mm-btn mm-btn-secondary";
            multiAIBtn.style.background = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
            multiAIBtn.style.color = "#fff";
            multiAIBtn.style.border = "none";
            multiAIBtn.innerHTML = `<i class="fa-solid fa-robot" style="margin-right: 6px;"></i>多AI生成`;
            multiAIBtn.title = "使用多个AI并发生成回复，然后选择其中一个";
        }

        const confirmBtn = document.createElement("button");
        confirmBtn.className = "mm-btn mm-btn-primary";
        confirmBtn.innerHTML = `<i class="fa-solid fa-check" style="margin-right: 6px;"></i>确认发送`;

        footer.appendChild(cancelBtn);
        footer.appendChild(regenerateBtn);
        if (multiAIBtn) {
            footer.appendChild(multiAIBtn);
        }
        footer.appendChild(confirmBtn);
        content.appendChild(footer);

        modal.appendChild(content);
        document.body.appendChild(modal);

        const cleanup = () => {
            document.body.removeChild(modal);
        };

        // 确认发送 - 返回编辑后的内容
        confirmBtn.addEventListener("click", () => {
            const editedSummary = summaryText.value;
            const editedEditor = editorTextarea ? editorTextarea.value : "";
            cleanup();
            resolve({
                action: "confirm",
                editedSummary,
                editedEditor
            });
        });

        // 重新生成
        regenerateBtn.addEventListener("click", () => {
            cleanup();
            resolve({ action: "regenerate" });
        });

        // 多AI生成
        if (multiAIBtn) {
            multiAIBtn.addEventListener("click", () => {
                cleanup();
                resolve({ action: "multi-regenerate" });
            });
        }

        // 取消发送
        cancelBtn.addEventListener("click", () => {
            cleanup();
            resolve({ action: "cancel" });
        });

        // 关闭按钮
        closeBtn.addEventListener("click", () => {
            cleanup();
            resolve({ action: "cancel" });
        });
    });
}
