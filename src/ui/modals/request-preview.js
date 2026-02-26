/**
 * 请求预览弹窗模块
 * @module ui/modals/request-preview
 */

import Logger from '@core/logger';
import { getGlobalSettings, updateGlobalSettings } from '@config/config-manager';
import { enableModalDrag } from './index';

/**
 * 显示请求预览弹窗
 * @param {Array} requests - 请求数组
 * @returns {Promise<{confirmed: boolean, requests?: Array}>} 用户操作结果
 */
export function showRequestPreview(requests) {
    return new Promise((resolve, reject) => {
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

        // 创建弹窗内容 - 响应式设计
        const content = document.createElement("div");
        content.className = "mm-modal-content mm-modal-large";
        content.style.width = "100%";
        content.style.maxWidth = "1000px";
        content.style.maxHeight = "90vh";
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

        const headerLeft = document.createElement("div");
        headerLeft.style.display = "flex";
        headerLeft.style.flexDirection = "column";
        headerLeft.style.gap = "10px";

        const title = document.createElement("h4");
        title.textContent = "发送前检查 - 即将发送给API的内容";
        title.style.margin = "0";
        title.style.fontSize = "16px";

        // 添加搜索框
        const searchContainer = document.createElement("div");
        searchContainer.style.display = "flex";
        searchContainer.style.flexDirection = "column";
        searchContainer.style.gap = "6px";
        searchContainer.style.width = "100%";

        const searchRow = document.createElement("div");
        searchRow.style.display = "flex";
        searchRow.style.alignItems = "center";
        searchRow.style.gap = "6px";
        searchRow.style.flexWrap = "wrap";

        const searchInputWrapper = document.createElement("div");
        searchInputWrapper.style.position = "relative";
        searchInputWrapper.style.flex = "1";
        searchInputWrapper.style.minWidth = "100px";

        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.id = "mm-preview-search";
        searchInput.placeholder = "搜索...";
        searchInput.style.width = "100%";
        searchInput.style.padding = "4px 22px 4px 6px";
        searchInput.style.border = "1px solid var(--mm-border)";
        searchInput.style.borderRadius = "var(--mm-radius)";
        searchInput.style.fontSize = "11px";
        searchInput.style.background = "var(--mm-bg)";
        searchInput.style.color = "var(--mm-text)";

        const searchIcon = document.createElement("i");
        searchIcon.className = "fa-solid fa-search";
        searchIcon.style.position = "absolute";
        searchIcon.style.right = "5px";
        searchIcon.style.top = "50%";
        searchIcon.style.transform = "translateY(-50%)";
        searchIcon.style.color = "var(--mm-text-secondary)";
        searchIcon.style.fontSize = "10px";
        searchIcon.style.cursor = "pointer";
        searchIcon.addEventListener("click", handleSearch);

        searchInputWrapper.appendChild(searchInput);
        searchInputWrapper.appendChild(searchIcon);
        searchRow.appendChild(searchInputWrapper);

        const replaceInput = document.createElement("input");
        replaceInput.type = "text";
        replaceInput.id = "mm-preview-replace";
        replaceInput.placeholder = "替换为...";
        replaceInput.style.width = "100px";
        replaceInput.style.padding = "4px 6px";
        replaceInput.style.border = "1px solid var(--mm-border)";
        replaceInput.style.borderRadius = "var(--mm-radius)";
        replaceInput.style.fontSize = "11px";
        replaceInput.style.background = "var(--mm-bg)";
        replaceInput.style.color = "var(--mm-text)";
        searchRow.appendChild(replaceInput);

        const replaceBtn = document.createElement("button");
        replaceBtn.textContent = "替换";
        replaceBtn.id = "mm-preview-replace-btn";
        replaceBtn.style.padding = "4px 8px";
        replaceBtn.style.border = "1px solid var(--mm-border)";
        replaceBtn.style.borderRadius = "var(--mm-radius)";
        replaceBtn.style.fontSize = "11px";
        replaceBtn.style.background = "var(--mm-bg)";
        replaceBtn.style.color = "var(--mm-text)";
        replaceBtn.style.cursor = "pointer";
        replaceBtn.style.whiteSpace = "nowrap";
        searchRow.appendChild(replaceBtn);

        const replaceAllBtn = document.createElement("button");
        replaceAllBtn.textContent = "全部替换";
        replaceAllBtn.id = "mm-preview-replace-all-btn";
        replaceAllBtn.style.padding = "4px 8px";
        replaceAllBtn.style.border = "1px solid var(--mm-border)";
        replaceAllBtn.style.borderRadius = "var(--mm-radius)";
        replaceAllBtn.style.fontSize = "11px";
        replaceAllBtn.style.background = "var(--mm-bg)";
        replaceAllBtn.style.color = "var(--mm-text)";
        replaceAllBtn.style.cursor = "pointer";
        replaceAllBtn.style.whiteSpace = "nowrap";
        searchRow.appendChild(replaceAllBtn);

        const prevBtn = document.createElement("button");
        prevBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
        prevBtn.id = "mm-preview-search-prev";
        prevBtn.style.padding = "4px 7px";
        prevBtn.style.border = "1px solid var(--mm-border)";
        prevBtn.style.borderRadius = "var(--mm-radius)";
        prevBtn.style.fontSize = "10px";
        prevBtn.style.background = "var(--mm-bg)";
        prevBtn.style.color = "var(--mm-text)";
        prevBtn.style.cursor = "pointer";
        searchRow.appendChild(prevBtn);

        const nextBtn = document.createElement("button");
        nextBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
        nextBtn.id = "mm-preview-search-next";
        nextBtn.style.padding = "4px 7px";
        nextBtn.style.border = "1px solid var(--mm-border)";
        nextBtn.style.borderRadius = "var(--mm-radius)";
        nextBtn.style.fontSize = "10px";
        nextBtn.style.background = "var(--mm-bg)";
        nextBtn.style.color = "var(--mm-text)";
        nextBtn.style.cursor = "pointer";
        searchRow.appendChild(nextBtn);

        searchContainer.appendChild(searchRow);

        const searchStats = document.createElement("div");
        searchStats.id = "mm-preview-search-stats";
        searchStats.textContent = "找到 0 个匹配项";
        searchStats.style.fontSize = "11px";
        searchStats.style.color = "var(--mm-text-secondary)";
        searchContainer.appendChild(searchStats);

        headerLeft.appendChild(title);
        headerLeft.appendChild(searchContainer);

        const closeBtn = document.createElement("button");
        closeBtn.className = "mm-modal-close mm-btn mm-btn-icon";
        closeBtn.innerHTML = `<i class="fa-solid fa-times"></i>`;
        closeBtn.id = "mm-preview-close";

        header.appendChild(headerLeft);
        header.appendChild(closeBtn);
        content.appendChild(header);

        // 启用弹窗拖拽移动
        enableModalDrag(modal, content, header);

        // 创建弹窗主体 - 可滚动区域
        const body = document.createElement("div");
        body.className = "mm-modal-body";
        body.style.flex = "1";
        body.style.overflowY = "auto";
        body.style.padding = "20px";

        // 为每个请求创建容器
        requests.forEach(async (req, index) => {
            // 计算总字符数
            const totalChars = (req.prompt || "").length;
            const charCountDisplay =
                totalChars >= 1000
                    ? `${(totalChars / 1000).toFixed(1)}k`
                    : totalChars;

            // 创建请求块容器
            const requestBlock = document.createElement("div");
            requestBlock.className = "mm-request-block";
            requestBlock.style.marginBottom = "20px";
            requestBlock.style.padding = "15px";
            requestBlock.style.background = "var(--mm-bg-card)";
            requestBlock.style.borderRadius = "var(--mm-radius)";
            requestBlock.style.border = "1px solid var(--mm-border)";

            // 创建请求块标题
            const requestHeader = document.createElement("div");
            requestHeader.style.display = "flex";
            requestHeader.style.justifyContent = "space-between";
            requestHeader.style.alignItems = "center";
            requestHeader.style.marginBottom = "10px";
            requestHeader.style.cursor = "pointer";
            requestHeader.style.userSelect = "none";

            const requestTitle = document.createElement("div");
            requestTitle.style.display = "flex";
            requestTitle.style.alignItems = "center";
            requestTitle.style.gap = "8px";

            const titleText = document.createElement("h5");
            titleText.style.margin = "0";
            titleText.style.color = "var(--mm-primary)";
            titleText.style.fontWeight = "bold";
            titleText.style.fontSize = "15px";

            titleText.innerHTML = `
                请求 ${index + 1}: ${req.category || "未分类"}
                <span style="margin-left: 8px; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: normal; background: var(--mm-bg-secondary); color: var(--mm-text-muted);">
                    ${charCountDisplay} 字符
                </span>
            `;
            requestTitle.appendChild(titleText);

            requestHeader.appendChild(requestTitle);

            // 折叠按钮
            const requestToggleBtn = document.createElement("button");
            requestToggleBtn.className = "mm-request-toggle-btn";
            requestToggleBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
            requestToggleBtn.style.background = "none";
            requestToggleBtn.style.border = "none";
            requestToggleBtn.style.color = "var(--mm-primary)";
            requestToggleBtn.style.cursor = "pointer";
            requestToggleBtn.style.fontSize = "13px";
            requestToggleBtn.style.padding = "5px";
            requestHeader.appendChild(requestToggleBtn);

            requestBlock.appendChild(requestHeader);

            // 创建请求内容容器
            const requestContent = document.createElement("div");
            requestContent.className = "mm-request-content";
            requestContent.style.display = "none"; // 默认折叠

            // 添加模型信息
            const modelInfo = document.createElement("div");
            modelInfo.style.marginBottom = "12px";
            modelInfo.style.fontSize = "12px";
            modelInfo.style.color = "var(--mm-text-secondary)";
            modelInfo.innerHTML = `<strong>模型:</strong> ${req.model || "未指定"}`;
            requestContent.appendChild(modelInfo);

            // 拖拽相关变量（移到外部，所有部分块共享）
            let draggedPartElement = null;

            // 为每个prompt部分创建可折叠、可拖拽的块
            if (req.promptParts && req.promptParts.length > 0) {
                const orderedParts = req.promptParts;

                orderedParts.forEach((part, partIndex) => {
                    const partBlock = document.createElement("div");
                    partBlock.className = "mm-prompt-part-block";
                    partBlock.draggable = false; // 默认不可拖拽，只通过手柄启动拖拽
                    partBlock.dataset.partIndex = partIndex;
                    // 添加 source 属性用于 CSS 隐藏破限词
                    if (part.source) {
                        partBlock.dataset.source = part.source;
                    }

                    // 创建部分标题
                    const partHeader = document.createElement("div");
                    partHeader.style.display = "flex";
                    partHeader.style.justifyContent = "space-between";
                    partHeader.style.alignItems = "center";
                    partHeader.style.marginBottom = "8px";
                    partHeader.style.cursor = "pointer";
                    partHeader.style.userSelect = "none";

                    const partTitleArea = document.createElement("div");
                    partTitleArea.style.display = "flex";
                    partTitleArea.style.alignItems = "center";
                    partTitleArea.style.gap = "8px";
                    partTitleArea.style.flex = "1";

                    // 拖拽手柄
                    const dragHandle = document.createElement("i");
                    dragHandle.className = "fa-solid fa-grip-vertical";
                    dragHandle.style.color = "var(--mm-text-secondary)";
                    dragHandle.style.cursor = "grab";
                    dragHandle.style.fontSize = "12px";
                    dragHandle.style.padding = "4px";
                    partTitleArea.appendChild(dragHandle);

                    // 部分标签和字符数
                    const partLabel = document.createElement("div");
                    partLabel.style.fontSize = "13px";
                    partLabel.style.fontWeight = "bold";
                    partLabel.style.color = "var(--mm-text)";

                    const partChars = (part.content || "").length;
                    const partCharDisplay =
                        partChars >= 1000
                            ? `${(partChars / 1000).toFixed(1)}k`
                            : partChars;

                    partLabel.innerHTML = `
                        ${part.label}
                        <span style="margin-left: 6px; padding: 1px 5px; border-radius: 8px; font-size: 10px; font-weight: normal; background: var(--mm-bg-secondary); color: var(--mm-text-muted);">
                            ${partCharDisplay} 字符
                        </span>
                    `;
                    partTitleArea.appendChild(partLabel);

                    partHeader.appendChild(partTitleArea);

                    // 删除按钮
                    const deleteBtn = document.createElement("button");
                    deleteBtn.className = "mm-part-delete-btn";
                    deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
                    deleteBtn.style.background = "none";
                    deleteBtn.style.border = "none";
                    deleteBtn.style.color = "var(--mm-text-muted)";
                    deleteBtn.style.cursor = "pointer";
                    deleteBtn.style.fontSize = "11px";
                    deleteBtn.style.padding = "3px 6px";
                    deleteBtn.style.marginRight = "4px";
                    deleteBtn.title = "删除此来源";
                    deleteBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        if (confirm(`确定要删除"${part.label}"吗？`)) {
                            partBlock.remove();
                        }
                    });
                    partHeader.appendChild(deleteBtn);

                    // 部分折叠按钮
                    const partToggleBtn = document.createElement("button");
                    partToggleBtn.className = "mm-part-toggle-btn";
                    partToggleBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
                    partToggleBtn.style.background = "none";
                    partToggleBtn.style.border = "none";
                    partToggleBtn.style.color = "var(--mm-text-secondary)";
                    partToggleBtn.style.cursor = "pointer";
                    partToggleBtn.style.fontSize = "11px";
                    partToggleBtn.style.padding = "3px";
                    partHeader.appendChild(partToggleBtn);

                    partBlock.appendChild(partHeader);

                    // 创建可编辑内容区域
                    const partContentArea = document.createElement("div");
                    partContentArea.className = "mm-part-content-area";
                    partContentArea.style.display = "none"; // 默认折叠

                    // 创建可调整大小的编辑器容器
                    const editorContainer = document.createElement("div");
                    editorContainer.className = "mm-resizable-editor-container";
                    editorContainer.style.display = "flex";
                    editorContainer.style.flexDirection = "column";

                    const promptContent = document.createElement("div");
                    promptContent.className = "mm-prompt-content";
                    promptContent.style.background = "var(--mm-bg-secondary)";
                    promptContent.style.padding = "8px";
                    promptContent.style.overflow = "auto";
                    promptContent.style.fontSize = "11px";
                    promptContent.style.whiteSpace = "pre-wrap";
                    promptContent.style.wordWrap = "break-word";
                    promptContent.style.border = "1px solid var(--mm-border)";
                    promptContent.style.borderRadius = "4px 4px 0 0";
                    promptContent.style.cursor = "text";
                    promptContent.style.outline = "none";
                    promptContent.style.boxSizing = "border-box";
                    promptContent.contentEditable = "true";
                    promptContent.textContent = part.content || "";
                    editorContainer.appendChild(promptContent);

                    // 展开后根据实际内容设置合适高度
                    const setContentHeight = () => {
                        const scrollH = promptContent.scrollHeight;
                        const h = Math.max(60, Math.min(scrollH + 16, 300));
                        promptContent.style.height = `${h}px`;
                    };

                    const resizeHandle = document.createElement("div");
                    resizeHandle.className = "mm-resize-handle";
                    editorContainer.appendChild(resizeHandle);

                    // 初始化拖动调整高度功能
                    let isResizing = false;
                    let startY, startHeight;

                    resizeHandle.addEventListener("mousedown", (e) => {
                        isResizing = true;
                        startY = e.clientY;
                        startHeight = parseInt(
                            window.getComputedStyle(promptContent).height,
                            10,
                        );
                        document.body.style.cursor = "ns-resize";
                        document.body.style.userSelect = "none";
                        e.preventDefault();
                        e.stopPropagation();
                    });

                    document.addEventListener("mousemove", (e) => {
                        if (!isResizing) return;
                        const deltaY = e.clientY - startY;
                        const newHeight = Math.max(80, startHeight + deltaY);
                        promptContent.style.height = `${newHeight}px`;
                        e.preventDefault();
                    });

                    document.addEventListener("mouseup", () => {
                        if (isResizing) {
                            isResizing = false;
                            document.body.style.cursor = "";
                            document.body.style.userSelect = "";
                        }
                    });

                    partContentArea.appendChild(editorContainer);
                    partBlock.appendChild(partContentArea);

                    // 部分块折叠逻辑
                    partToggleBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        const isCollapsed = partContentArea.style.display === "none";
                        partContentArea.style.display = isCollapsed ? "block" : "none";
                        partToggleBtn.innerHTML = isCollapsed
                            ? '<i class="fa-solid fa-chevron-up"></i>'
                            : '<i class="fa-solid fa-chevron-down"></i>';
                        if (isCollapsed) setTimeout(setContentHeight, 0);
                    });

                    partHeader.addEventListener("click", () => {
                        const isCollapsed = partContentArea.style.display === "none";
                        partContentArea.style.display = isCollapsed ? "block" : "none";
                        partToggleBtn.innerHTML = isCollapsed
                            ? '<i class="fa-solid fa-chevron-up"></i>'
                            : '<i class="fa-solid fa-chevron-down"></i>';
                        if (isCollapsed) setTimeout(setContentHeight, 0);
                    });

                    // 拖拽功能 - 只通过手柄启动拖拽

                    // 手柄按下时启用拖拽
                    dragHandle.addEventListener("mousedown", () => {
                        partBlock.draggable = true;
                    });

                    // 拖拽结束后禁用拖拽
                    partBlock.addEventListener("dragend", () => {
                        partBlock.draggable = false;
                        partBlock.style.opacity = "1";
                        partBlock.style.border = "2px solid transparent";
                        dragHandle.style.cursor = "grab";
                        draggedPartElement = null;
                    });

                    partBlock.addEventListener("dragstart", (e) => {
                        draggedPartElement = partBlock;
                        partBlock.style.opacity = "0.5";
                        dragHandle.style.cursor = "grabbing";
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", partIndex);
                    });

                    partBlock.addEventListener("dragover", (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";

                        if (
                            draggedPartElement &&
                            draggedPartElement !== partBlock &&
                            draggedPartElement.parentElement === partBlock.parentElement
                        ) {
                            const bounding = partBlock.getBoundingClientRect();
                            const offset = e.clientY - bounding.top;

                            if (offset > bounding.height / 2) {
                                partBlock.style.borderBottom = "2px solid var(--mm-primary)";
                                partBlock.style.borderTop = "2px solid transparent";
                            } else {
                                partBlock.style.borderTop = "2px solid var(--mm-primary)";
                                partBlock.style.borderBottom = "2px solid transparent";
                            }
                        }
                    });

                    partBlock.addEventListener("dragleave", () => {
                        partBlock.style.border = "2px solid transparent";
                    });

                    partBlock.addEventListener("drop", (e) => {
                        e.preventDefault();
                        partBlock.style.border = "2px solid transparent";

                        if (
                            draggedPartElement &&
                            draggedPartElement !== partBlock &&
                            draggedPartElement.parentElement === partBlock.parentElement
                        ) {
                            const bounding = partBlock.getBoundingClientRect();
                            const offset = e.clientY - bounding.top;

                            if (offset > bounding.height / 2) {
                                partBlock.parentElement.insertBefore(
                                    draggedPartElement,
                                    partBlock.nextSibling,
                                );
                            } else {
                                partBlock.parentElement.insertBefore(
                                    draggedPartElement,
                                    partBlock,
                                );
                            }

                            // 更新 partIndex
                            const allParts = requestContent.querySelectorAll(
                                ".mm-prompt-part-block",
                            );
                            allParts.forEach((p, i) => {
                                p.dataset.partIndex = i;
                            });
                        }
                    });

                    requestContent.appendChild(partBlock);
                });
            } else {
                // 如果没有 promptParts，显示完整的 prompt
                const fallbackContent = document.createElement("div");
                fallbackContent.style.padding = "10px";
                fallbackContent.style.background = "var(--mm-bg)";
                fallbackContent.style.borderRadius = "var(--mm-radius)";
                fallbackContent.style.fontSize = "12px";
                fallbackContent.style.whiteSpace = "pre-wrap";
                fallbackContent.textContent = req.prompt || "(无内容)";
                requestContent.appendChild(fallbackContent);
            }

            requestBlock.appendChild(requestContent);

            // 请求块折叠逻辑
            const toggleRequestBlock = () => {
                const isCollapsed = requestContent.style.display === "none";
                requestContent.style.display = isCollapsed ? "block" : "none";
                requestToggleBtn.innerHTML = isCollapsed
                    ? '<i class="fa-solid fa-chevron-up"></i>'
                    : '<i class="fa-solid fa-chevron-down"></i>';
            };

            requestHeader.addEventListener("click", toggleRequestBlock);
            requestToggleBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleRequestBlock();
            });

            body.appendChild(requestBlock);
        });

        content.appendChild(body);

        // 创建弹窗底部按钮
        const footer = document.createElement("div");
        footer.className = "mm-modal-footer";
        footer.style.justifyContent = "space-between";
        footer.innerHTML = `
            <button class="mm-btn mm-btn-secondary" id="mm-preview-save-order" title="保存当前所有请求的部分块顺序为默认顺序">
                <i class="fa-solid fa-save"></i> 保存当前顺序为默认
            </button>
            <div style="display: flex; gap: 10px;">
                <button class="mm-btn mm-btn-secondary" id="mm-preview-cancel">取消</button>
                <button class="mm-btn mm-btn-primary" id="mm-preview-confirm">确认发送</button>
            </div>
        `;
        content.appendChild(footer);

        modal.appendChild(content);
        document.body.appendChild(modal);

        // 搜索匹配项导航变量
        let currentMatchIndex = 0;
        let allHighlights = [];

        // 搜索处理函数
        function handleSearch() {
            const searchTerm = searchInput.value.trim();
            const requestBlocks = modal.querySelectorAll(".mm-request-block");
            let firstMatch = null;
            let totalMatches = 0;

            requestBlocks.forEach((requestBlock) => {
                const requestContent = requestBlock.querySelector(".mm-request-content");
                const requestToggleBtn = requestBlock.querySelector(".mm-request-toggle-btn");
                const partBlocks = requestBlock.querySelectorAll(".mm-prompt-part-block");
                let requestHasMatch = false;

                partBlocks.forEach((partBlock) => {
                    const partContentArea = partBlock.querySelector(".mm-part-content-area");
                    const partToggleBtn = partBlock.querySelector(".mm-part-toggle-btn");
                    const promptContent = partBlock.querySelector(".mm-prompt-content");

                    if (!promptContent) return;

                    // 获取原始内容
                    const originalContent = promptContent.textContent;
                    let hasMatch = false;
                    let matchCount = 0;

                    // 清除之前的高亮
                    promptContent.textContent = originalContent;

                    // 只有当搜索词不为空时才执行搜索
                    if (searchTerm) {
                        const searchLower = searchTerm.toLowerCase();
                        const contentLower = originalContent.toLowerCase();

                        // 检查是否有匹配项
                        hasMatch = contentLower.includes(searchLower);

                        if (hasMatch) {
                            // 先转义 HTML，防止 XSS 攻击
                            const div = document.createElement("div");
                            div.textContent = originalContent;
                            const escapedContent = div.innerHTML;

                            const regex = new RegExp(
                                `(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
                                "gi",
                            );
                            promptContent.innerHTML = escapedContent.replace(
                                regex,
                                '<mark class="mm-search-highlight" style="background-color: rgba(255, 255, 0, 0.3); color: var(--mm-text, black); padding: 0 2px; border-radius: 2px; font-weight: bold;">$1</mark>',
                            );

                            // 计算匹配数量
                            matchCount = (originalContent.match(new RegExp(searchTerm, "gi")) || []).length;
                            totalMatches += matchCount;
                            requestHasMatch = true;
                        }
                    }

                    // 只有当搜索词不为空且有匹配项时,才展开部分块
                    if (searchTerm && hasMatch) {
                        if (partContentArea) partContentArea.style.display = "block";
                        if (partToggleBtn) partToggleBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';

                        // 记录第一个匹配项，以便后续定位
                        if (!firstMatch) {
                            firstMatch = partBlock;
                        }
                    } else if (searchTerm) {
                        // 有搜索词但无匹配,折叠
                        if (partContentArea) partContentArea.style.display = "none";
                        if (partToggleBtn) partToggleBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
                    }
                });

                // 如果请求块中有匹配项,展开请求块
                if (searchTerm && requestHasMatch) {
                    if (requestContent) requestContent.style.display = "block";
                    if (requestToggleBtn) requestToggleBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
                } else if (searchTerm) {
                    if (requestContent) requestContent.style.display = "none";
                    if (requestToggleBtn) requestToggleBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
                }
            });

            // 定位到第一个匹配项
            if (firstMatch) {
                firstMatch.scrollIntoView({ behavior: "smooth", block: "center" });

                setTimeout(() => {
                    const firstHighlight = firstMatch.querySelector(".mm-search-highlight");
                    if (firstHighlight) {
                        firstHighlight.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                }, 100);
            }

            // 更新搜索统计信息
            const searchStatsEl = modal.querySelector("#mm-preview-search-stats");
            if (searchStatsEl) {
                searchStatsEl.textContent = `找到 ${totalMatches} 个匹配项`;
            }
        }

        // 更新所有高亮元素列表
        function updateAllHighlights() {
            allHighlights = Array.from(modal.querySelectorAll(".mm-search-highlight"));
            currentMatchIndex = Math.min(currentMatchIndex, allHighlights.length - 1);
        }

        // 导航到特定匹配项
        function navigateToMatch(index) {
            if (allHighlights.length === 0) return;

            index = Math.max(0, Math.min(index, allHighlights.length - 1));
            currentMatchIndex = index;

            const highlight = allHighlights[index];
            highlight.scrollIntoView({ behavior: "smooth", block: "center" });

            // 突出显示当前匹配项
            allHighlights.forEach((h, i) => {
                if (i === currentMatchIndex) {
                    h.style.backgroundColor = "rgba(34, 197, 94, 0.6)";
                    h.style.transform = "scale(1.05)";
                    h.style.transition = "all 0.2s ease";
                } else {
                    h.style.backgroundColor = "rgba(255, 255, 0, 0.3)";
                    h.style.transform = "scale(1)";
                    h.style.transition = "all 0.2s ease";
                }
            });

            // 更新统计信息
            const searchStatsEl = modal.querySelector("#mm-preview-search-stats");
            if (searchStatsEl) {
                searchStatsEl.textContent = `找到 ${allHighlights.length} 个匹配项，当前第 ${currentMatchIndex + 1} 个`;
            }
        }

        // 上一个匹配项
        function goToPrevMatch() {
            if (allHighlights.length === 0) return;
            const newIndex = currentMatchIndex > 0 ? currentMatchIndex - 1 : allHighlights.length - 1;
            navigateToMatch(newIndex);
        }

        // 下一个匹配项
        function goToNextMatch() {
            if (allHighlights.length === 0) return;
            const newIndex = currentMatchIndex < allHighlights.length - 1 ? currentMatchIndex + 1 : 0;
            navigateToMatch(newIndex);
        }

        // 替换功能
        function replaceMatch() {
            const searchTerm = searchInput.value.trim();
            const replaceTerm = replaceInput.value;

            if (!searchTerm || allHighlights.length === 0) return;

            const currentHighlight = allHighlights[currentMatchIndex];
            const parentContent = currentHighlight.closest(".mm-prompt-content");

            const originalText = parentContent.textContent;

            let matchIndex = 0;
            const newText = originalText.replace(new RegExp(searchTerm, "gi"), (match) => {
                if (matchIndex === currentMatchIndex) {
                    matchIndex++;
                    return replaceTerm;
                }
                matchIndex++;
                return match;
            });

            parentContent.textContent = newText;

            handleSearch();
            setTimeout(() => {
                updateAllHighlights();
                if (currentMatchIndex < allHighlights.length) {
                    navigateToMatch(currentMatchIndex);
                }
            }, 100);
        }

        // 全部替换功能
        function replaceAllMatches() {
            const searchTerm = searchInput.value.trim();
            const replaceTerm = replaceInput.value;

            if (!searchTerm) return;

            const contentContainers = modal.querySelectorAll(".mm-prompt-content");

            contentContainers.forEach((container) => {
                const originalText = container.textContent;
                const newText = originalText.replace(new RegExp(searchTerm, "gi"), replaceTerm);
                container.textContent = newText;
            });

            handleSearch();
            setTimeout(updateAllHighlights, 100);
        }

        // 绑定搜索事件
        if (searchInput) {
            searchInput.addEventListener("input", () => {
                currentMatchIndex = 0;
                handleSearch();
                setTimeout(updateAllHighlights, 100);
            });

            searchInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    currentMatchIndex = 0;
                    handleSearch();
                    setTimeout(updateAllHighlights, 100);
                }
            });
        }

        // 绑定事件
        const confirmBtnEl = modal.querySelector("#mm-preview-confirm");
        const cancelBtnEl = modal.querySelector("#mm-preview-cancel");
        const replaceBtnEl = modal.querySelector("#mm-preview-replace-btn");
        const replaceAllBtnEl = modal.querySelector("#mm-preview-replace-all-btn");
        const prevBtnEl = modal.querySelector("#mm-preview-search-prev");
        const nextBtnEl = modal.querySelector("#mm-preview-search-next");

        if (replaceBtnEl) replaceBtnEl.addEventListener("click", replaceMatch);
        if (replaceAllBtnEl) replaceAllBtnEl.addEventListener("click", replaceAllMatches);
        if (prevBtnEl) prevBtnEl.addEventListener("click", goToPrevMatch);
        if (nextBtnEl) nextBtnEl.addEventListener("click", goToNextMatch);

        const cleanup = () => {
            document.body.removeChild(modal);
        };

        confirmBtnEl.addEventListener("click", () => {
            // 收集所有编辑后的请求数据
            const requestBlocks = modal.querySelectorAll(".mm-request-block");
            const updatedRequests = [];

            requestBlocks.forEach((requestBlock, reqIndex) => {
                const req = requests[reqIndex];
                if (!req) return;

                const partBlocks = requestBlock.querySelectorAll(".mm-prompt-part-block");
                const updatedParts = [];
                const updatedPromptTexts = [];

                partBlocks.forEach((partBlock) => {
                    const promptContent = partBlock.querySelector(".mm-prompt-content");
                    if (promptContent) {
                        const originalPartIndex = parseInt(partBlock.dataset.partIndex || "0");

                        let partInfo = { label: "未知部分", source: "unknown" };
                        if (req.promptParts && req.promptParts[originalPartIndex]) {
                            partInfo = req.promptParts[originalPartIndex];
                        }

                        const updatedContent = promptContent.textContent;
                        updatedParts.push({ ...partInfo, content: updatedContent });
                        updatedPromptTexts.push(updatedContent);
                    }
                });

                const updatedReq = {
                    ...req,
                    promptParts: updatedParts.length > 0 ? updatedParts : req.promptParts,
                    prompt: updatedPromptTexts.length > 0 ? updatedPromptTexts.join("\n\n") : req.prompt,
                };

                updatedRequests.push(updatedReq);
            });

            cleanup();
            resolve({ confirmed: true, requests: updatedRequests });
        });

        cancelBtnEl.addEventListener("click", () => {
            cleanup();
            resolve({ confirmed: false });
        });

        closeBtn.addEventListener("click", () => {
            cleanup();
            resolve({ confirmed: false });
        });

        // 保存顺序按钮事件
        const saveOrderBtn = modal.querySelector("#mm-preview-save-order");
        if (saveOrderBtn) {
            saveOrderBtn.addEventListener("click", () => {
                const promptPartsOrder = {};

                const requestBlocks = modal.querySelectorAll(".mm-request-block");
                requestBlocks.forEach((requestBlock, reqIndex) => {
                    const req = requests[reqIndex];
                    if (!req) return;

                    const category = req.category || req.source;
                    const partBlocks = requestBlock.querySelectorAll(".mm-prompt-part-block");
                    const order = [];

                    partBlocks.forEach((partBlock) => {
                        const promptContent = partBlock.querySelector(".mm-prompt-content");
                        if (promptContent) {
                            const originalPartIndex = parseInt(partBlock.dataset.partIndex || "0");

                            if (req.promptParts && req.promptParts[originalPartIndex]) {
                                const part = req.promptParts[originalPartIndex];
                                order.push(part.source);
                            }
                        }
                    });

                    if (order.length > 0) {
                        promptPartsOrder[category] = order;
                    }
                });

                // 保存到全局设置
                const settings = getGlobalSettings();
                settings.promptPartsOrder = promptPartsOrder;
                updateGlobalSettings(settings);

                Logger.log("[发送前检查] 已保存默认顺序配置", promptPartsOrder);

                // 视觉反馈
                const originalText = saveOrderBtn.innerHTML;
                saveOrderBtn.innerHTML = '<i class="fa-solid fa-check"></i> 已保存!';
                saveOrderBtn.disabled = true;
                setTimeout(() => {
                    saveOrderBtn.innerHTML = originalText;
                    saveOrderBtn.disabled = false;
                }, 2000);
            });
        }
    });
}
