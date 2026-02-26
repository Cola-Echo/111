/**
 * 记忆搜索助手面板组件
 * @module ui/components/search-panel
 */

import Logger from '@core/logger';
import { getGlobalSettings, getGlobalConfig, getSummaryConfig, isSummaryAutoSplitEnabled, getSummaryAutoSplitConfig, getSummaryPartConfigs, getSummaryPartApiConfig, isSummaryMergeDeduplicateEnabled } from '@config/config-manager';
import { getImportedBookNames } from '@config/imported-books';
import { getImportedWorldBooks, classifyWorldBooks, isSummaryBook } from '@worldbook/api';
import { getSummaryContent } from '@worldbook/parser';
import { analyzeSummaryContent, needsSplit } from '@worldbook/summary-splitter';
import APIAdapter from '@api/adapter';
import { getHistoricalPromptTemplate } from '@utils/prompt-template';
import { buildDataInjection, injectDataToPrompt, replacePromptVariables, buildUserPrompt } from '@memory/prompt-builder';
import { getJailbreakPrefix } from '@memory/jailbreak';
import { isPartDebugEnabled, showPartDebugModal } from '@memory/part-debug-modal';

// 进度追踪器引用（将在初始化时设置）
let progressTracker = null;

/**
 * 设置进度追踪器引用
 * @param {Object} tracker - 进度追踪器实例
 */
export function setSearchPanelProgressTracker(tracker) {
    progressTracker = tracker;
}

// 浮动面板 z-index 管理
let panelZIndex = 1000002;
function bringPanelToFront(panel) {
    if (panel) panel.style.zIndex = ++panelZIndex;
}

/**
 * 记忆搜索助手面板类
 * 管理面板的显示、隐藏、拖拽、消息展示等
 */
export class MemorySearchPanel {
    constructor() {
        this.panel = null;
        this.isMinimized = false;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.selectedMemories = [];
        this.targetCount = 5;
        this.currentResolve = null;
        this.currentReject = null;
        this.searchHistory = [];
        this.otherTasksCompleted = false;
        this.otherTasksResults = null;
        this.onContinueSearch = null;
        this.onCustomSearch = null;
        this.originalUserMessage = "";
        this.originalContext = "";
        // 多总结世界书支持
        this.bookSections = {}; // { bookName: { element, collapsed, status } }
        this.summaryBooks = []; // 当前会话的总结世界书列表
        this._bookSectionEventsbound = false;
    }

    /**
     * 初始化面板
     */
    init() {
        this.panel = document.getElementById("mm-search-dialog");
        if (!this.panel) {
            Logger.warn("记忆搜索助手面板未找到");
            return;
        }

        this.bindPanelEvents();
        this.initDrag();
        this.initResize();
        Logger.debug("记忆搜索助手面板初始化完成");
    }

    /**
     * 绑定面板事件
     */
    bindPanelEvents() {
        // 最小化按钮
        document
            .getElementById("mm-search-minimize")
            ?.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleMinimize();
            });

        // 一键全选按钮
        const injectAllBtn = document.getElementById("mm-search-inject-all");
        if (injectAllBtn) {
            injectAllBtn.addEventListener("click", () => {
                Logger.debug("[一键全选] 按钮被点击");
                this.selectAllUnrejected();
            });
            Logger.debug("[记忆搜索助手] 一键全选按钮事件已绑定");
        } else {
            Logger.warn("[记忆搜索助手] 一键全选按钮未找到，事件未绑定");
        }

        // 确认注入按钮
        document
            .getElementById("mm-search-confirm")
            ?.addEventListener("click", () => {
                this.confirmSelection();
            });

        // 取消按钮
        document
            .getElementById("mm-search-cancel")
            ?.addEventListener("click", () => {
                this.cancelSearch();
            });

        // 继续搜索按钮
        document
            .getElementById("mm-search-continue")
            ?.addEventListener("click", () => {
                this.continueSearch();
            });

        // 自定义搜索按钮
        document
            .getElementById("mm-search-custom")
            ?.addEventListener("click", () => {
                this.toggleCustomInput();
            });

        // 自定义关键词搜索
        document
            .getElementById("mm-search-keyword-btn")
            ?.addEventListener("click", () => {
                this.searchWithCustomKeyword();
            });

        // 回车键搜索
        document
            .getElementById("mm-search-keyword-input")
            ?.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    this.searchWithCustomKeyword();
                }
            });
    }

    /**
     * 初始化多世界书面板
     * @param {Array} summaryBooks - 总结世界书数组
     */
    initBookSections(summaryBooks) {
        this.summaryBooks = summaryBooks || [];
        this.bookSections = {};

        const container = document.getElementById("mm-search-books-container");
        if (!container) return;

        container.innerHTML = "";

        if (this.summaryBooks.length === 0) {
            container.innerHTML = `
                <div class="mm-search-book-section">
                    <div class="mm-search-book-content">
                        <div class="mm-search-message mm-search-message-system">
                            <div class="mm-search-message-content">
                                <i class="fa-solid fa-info-circle"></i>
                                <span>未找到总结世界书，请使用自定义搜索</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        // 为每个总结世界书创建可折叠面板
        for (let i = 0; i < this.summaryBooks.length; i++) {
            const book = this.summaryBooks[i];
            this.createBookSection(book.name, i === 0);
        }

        // 只在首次绑定事件
        if (!this._bookSectionEventsbound) {
            this.bindBookSectionEvents();
            this._bookSectionEventsbound = true;
        }
    }

    /**
     * 创建单个世界书可折叠面板
     * @param {string} bookName - 世界书名称
     * @param {boolean} expanded - 是否默认展开
     */
    createBookSection(bookName, expanded = false) {
        const container = document.getElementById("mm-search-books-container");
        if (!container) return;

        const section = document.createElement("div");
        section.className = `mm-search-book-section${expanded ? "" : " mm-collapsed"}`;
        section.dataset.bookName = bookName;

        section.innerHTML = `
            <div class="mm-search-book-header">
                <i class="fa-solid fa-chevron-down mm-book-toggle-icon"></i>
                <span class="mm-book-name" title="${this.escapeHtml(bookName)}">${this.escapeHtml(bookName)}</span>
                <span class="mm-book-status mm-loading">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    <span class="mm-book-status-text">准备中</span>
                </span>
            </div>
            <div class="mm-search-book-content" id="mm-book-content-${this.sanitizeId(bookName)}">
            </div>
        `;

        container.appendChild(section);

        this.bookSections[bookName] = {
            element: section,
            collapsed: !expanded,
            status: "loading",
        };
    }

    /**
     * 将世界书名称转换为安全的 ID
     */
    sanitizeId(name) {
        return name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
    }

    /**
     * 绑定世界书面板折叠事件
     */
    bindBookSectionEvents() {
        const container = document.getElementById("mm-search-books-container");
        if (!container) return;

        container.addEventListener("click", (e) => {
            const header = e.target.closest(".mm-search-book-header");
            if (!header) return;

            const section = header.closest(".mm-search-book-section");
            if (!section) return;

            const bookName = section.dataset.bookName;
            this.toggleBookSection(bookName);
        });

        // 事件委托：处理搜索结果的采纳/拒绝/移除按钮
        container.addEventListener("click", (e) => {
            const adoptBtn = e.target.closest(".mm-search-adopt-btn");
            const rejectBtn = e.target.closest(".mm-search-reject-btn");
            const removeBtn = e.target.closest(".mm-search-remove-btn");

            if (adoptBtn) {
                const resultItem = adoptBtn.closest(".mm-search-result-item");
                if (resultItem) {
                    this.adoptMemory(resultItem);
                }
            } else if (rejectBtn) {
                const resultItem = rejectBtn.closest(".mm-search-result-item");
                if (resultItem) {
                    this.rejectMemory(resultItem);
                }
            } else if (removeBtn) {
                const resultItem = removeBtn.closest(".mm-search-result-item");
                if (resultItem) {
                    this.removeSelectedMemory(resultItem);
                }
            }
        });
    }

    /**
     * 切换世界书面板折叠状态
     * @param {string} bookName - 世界书名称
     */
    toggleBookSection(bookName) {
        const bookSection = this.bookSections[bookName];
        if (!bookSection) return;

        bookSection.collapsed = !bookSection.collapsed;
        bookSection.element.classList.toggle("mm-collapsed", bookSection.collapsed);
    }

    /**
     * 设置世界书面板状态
     * @param {string} bookName - 世界书名称
     * @param {string} status - 状态: loading, success, error
     * @param {string} text - 状态文本
     */
    setBookStatus(bookName, status, text) {
        const bookSection = this.bookSections[bookName];
        if (!bookSection) return;

        const statusEl = bookSection.element.querySelector(".mm-book-status");
        if (!statusEl) return;

        statusEl.classList.remove("mm-loading", "mm-success", "mm-error");
        statusEl.classList.add(`mm-${status}`);

        const iconMap = {
            loading: "fa-spinner fa-spin",
            success: "fa-check-circle",
            error: "fa-exclamation-circle",
        };

        statusEl.innerHTML = `
            <i class="fa-solid ${iconMap[status] || iconMap.loading}"></i>
            <span class="mm-book-status-text">${text || ""}</span>
        `;

        bookSection.status = status;
    }

    /**
     * 获取世界书内容容器
     * @param {string} bookName - 世界书名称
     * @returns {HTMLElement|null}
     */
    getBookContentContainer(bookName) {
        return document.getElementById(`mm-book-content-${this.sanitizeId(bookName)}`);
    }

    /**
     * 向指定世界书面板添加系统消息
     * @param {string} bookName - 世界书名称
     * @param {string} text - 消息文本
     */
    addBookSystemMessage(bookName, text) {
        const container = this.getBookContentContainer(bookName);
        if (!container) return;

        const msg = document.createElement("div");
        msg.className = "mm-search-message mm-search-message-system";
        msg.innerHTML = `
            <div class="mm-search-message-content">
                <i class="fa-solid fa-info-circle"></i>
                <span>${text}</span>
            </div>
        `;
        container.appendChild(msg);
        this.scrollBookToBottom(bookName);
    }

    /**
     * 向指定世界书面板添加 AI 消息
     * @param {string} bookName - 世界书名称
     * @param {string} text - 消息文本
     */
    addBookAIMessage(bookName, text) {
        const container = this.getBookContentContainer(bookName);
        if (!container) return;

        const msg = document.createElement("div");
        msg.className = "mm-search-message mm-search-message-ai";
        msg.innerHTML = `
            <div class="mm-search-message-avatar">
                <i class="fa-solid fa-robot"></i>
            </div>
            <div class="mm-search-message-content">
                <span>${text}</span>
            </div>
        `;
        container.appendChild(msg);
        this.scrollBookToBottom(bookName);
    }

    /**
     * 向指定世界书面板添加搜索结果
     * @param {string} bookName - 世界书名称
     * @param {Object} memory - 记忆数据
     */
    addBookSearchResult(bookName, memory) {
        const container = this.getBookContentContainer(bookName);
        if (!container) return;

        const floor = memory.uid || "0";
        const content = memory.content || "";
        const resultId = `result-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const msg = document.createElement("div");
        msg.className = "mm-search-message mm-search-message-result";
        msg.innerHTML = `
            <div class="mm-search-result-item" data-result-id="${resultId}" data-book-name="${this.escapeHtml(bookName)}">
                <div class="mm-search-result-header">
                    <span class="mm-search-result-floor">${this.escapeHtml(floor.startsWith('【') ? floor : `【${floor}楼】`)}</span>
                    <div class="mm-search-result-actions">
                        <button class="mm-btn mm-btn-adopt mm-search-adopt-btn">
                            <i class="fa-solid fa-check"></i> 采纳
                        </button>
                        <button class="mm-btn mm-btn-reject mm-search-reject-btn">
                            <i class="fa-solid fa-times"></i> 拒绝
                        </button>
                    </div>
                </div>
                <div class="mm-search-result-preview">${this.escapeHtml(content)}</div>
            </div>
        `;

        const resultItem = msg.querySelector(".mm-search-result-item");
        if (resultItem) {
            resultItem._memoryData = { ...memory, bookName };
        }

        container.appendChild(msg);
        this.scrollBookToBottom(bookName);
    }

    /**
     * 滚动指定世界书面板到底部
     * @param {string} bookName - 世界书名称
     */
    scrollBookToBottom(bookName) {
        const container = this.getBookContentContainer(bookName);
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    /**
     * 初始化拖拽功能
     */
    initDrag() {
        const header = this.panel?.querySelector(".mm-search-panel-header");
        if (!header) return;

        // 点击置顶
        const bringToFrontFn = () => {
            bringPanelToFront(this.panel);
        };
        this.panel.addEventListener("mousedown", bringToFrontFn);
        this.panel.addEventListener("touchstart", bringToFrontFn, { passive: true });

        header.addEventListener("mousedown", (e) => {
            if (e.target.closest("button")) return;
            this.startDrag(e);
        });

        document.addEventListener("mousemove", (e) => {
            if (this.isDragging) {
                this.drag(e);
            }
        });

        document.addEventListener("mouseup", () => {
            this.stopDrag();
        });

        // 触摸事件支持
        header.addEventListener(
            "touchstart",
            (e) => {
                if (e.target.closest("button")) return;
                e.preventDefault();
                const touch = e.touches[0];
                this.startDrag({
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                });
            },
            { passive: false }
        );

        document.addEventListener(
            "touchmove",
            (e) => {
                if (this.isDragging) {
                    e.preventDefault();
                    const touch = e.touches[0];
                    this.drag({
                        clientX: touch.clientX,
                        clientY: touch.clientY,
                    });
                }
            },
            { passive: false }
        );

        document.addEventListener("touchend", () => {
            this.stopDrag();
        });
    }

    startDrag(e) {
        if (!this.panel) return;
        this.isDragging = true;
        this.panel.classList.add("mm-dragging");
        const rect = this.panel.getBoundingClientRect();
        this.dragOffset.x = e.clientX - rect.left;
        this.dragOffset.y = e.clientY - rect.top;
        this.panel.style.transform = "none";
        this.panel.style.left = `${rect.left}px`;
        this.panel.style.top = `${rect.top}px`;
        this.panel.style.transition = "none";
    }

    drag(e) {
        if (!this.isDragging || !this.panel) return;
        const x = e.clientX - this.dragOffset.x;
        const y = e.clientY - this.dragOffset.y;

        const maxX = window.innerWidth - this.panel.offsetWidth;
        const maxY = window.innerHeight - this.panel.offsetHeight;

        this.panel.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
        this.panel.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
        this.panel.style.right = "auto";
        this.panel.style.bottom = "auto";
    }

    stopDrag() {
        if (!this.panel) return;
        this.isDragging = false;
        this.panel.classList.remove("mm-dragging");
        this.panel.style.transition = "";
    }

    /**
     * 初始化高度缩放功能
     */
    initResize() {
        if (!this.panel) return;

        const booksContainer = document.getElementById("mm-search-books-container");
        const resizeHandle = document.getElementById("mm-search-resize-handle");
        if (!booksContainer || !resizeHandle) return;

        let isResizing = false;
        let startY = 0;
        let startHeight = 0;
        const minHeight = 150;
        const maxHeight = window.innerHeight * 0.7;

        const onMouseMove = (e) => {
            if (!isResizing) return;
            const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
            const deltaY = clientY - startY;
            let newHeight = startHeight + deltaY;
            newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
            booksContainer.style.height = `${newHeight}px`;
            booksContainer.style.minHeight = `${newHeight}px`;
            booksContainer.style.maxHeight = `${newHeight}px`;

            // 同步更新内部内容区域的最大高度
            const bookContents = booksContainer.querySelectorAll('.mm-search-book-content');
            const headerHeight = 45; // 每个世界书头部的大约高度
            const bookCount = bookContents.length || 1;
            // 计算每个内容区域可用的高度（减去头部高度后平分）
            const contentMaxHeight = Math.max(100, (newHeight - headerHeight * bookCount) / bookCount);
            bookContents.forEach(content => {
                content.style.maxHeight = `${contentMaxHeight}px`;
            });

            e.preventDefault();
        };

        const onMouseUp = () => {
            if (isResizing) {
                isResizing = false;
                resizeHandle.classList.remove("resizing");
                booksContainer.classList.remove("resizing");
                this.panel.classList.remove("resizing");
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
            }
        };

        const onMouseDown = (e) => {
            if (this.panel.classList.contains("mm-minimized")) return;
            isResizing = true;
            startY = e.clientY || e.touches?.[0]?.clientY || 0;
            startHeight = booksContainer.offsetHeight;
            resizeHandle.classList.add("resizing");
            booksContainer.classList.add("resizing");
            this.panel.classList.add("resizing");
            document.body.style.cursor = "ns-resize";
            document.body.style.userSelect = "none";
            e.preventDefault();
            e.stopPropagation();
        };

        resizeHandle.addEventListener("mousedown", onMouseDown);
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);

        resizeHandle.addEventListener("touchstart", onMouseDown, { passive: false });
        document.addEventListener("touchmove", onMouseMove, { passive: false });
        document.addEventListener("touchend", onMouseUp);
    }

    /**
     * 显示面板
     */
    show(options = {}) {
        if (!this.panel) {
            this.init();
        }
        if (!this.panel) return;

        this.targetCount = options.targetCount || 5;
        this.selectedMemories = [];
        this.searchHistory = [];
        this.otherTasksCompleted = false;
        this.otherTasksResults = null;

        // 重置 UI
        this.updateSelectedCount();
        this.updateTargetCount();
        this.updateConfirmButton();
        this.hideCustomInput();

        // 清空世界书面板状态
        this.bookSections = {};
        this.summaryBooks = [];

        // 重置面板位置
        this.panel.style.left = "";
        this.panel.style.top = "";
        this.panel.style.right = "";
        this.panel.style.bottom = "";
        this.panel.style.transform = "";

        // 显示面板
        this.panel.classList.add("mm-visible");
        this.isMinimized = false;

        Logger.debug("记忆搜索助手面板已显示");
    }

    /**
     * 隐藏面板
     */
    hide() {
        if (!this.panel) return;
        this.panel.classList.remove("mm-visible");
        const container = document.getElementById("mm-search-books-container");
        if (container) {
            container.innerHTML = "";
        }
        this.bookSections = {};
        this.summaryBooks = [];
        this.selectedMemories = [];
        Logger.debug("记忆搜索助手面板已隐藏");
    }

    /**
     * 切换最小化状态
     */
    toggleMinimize() {
        if (!this.panel) {
            this.panel = document.getElementById("mm-search-dialog");
        }
        if (!this.panel) return;

        this.isMinimized = !this.isMinimized;
        this.panel.classList.toggle("mm-minimized", this.isMinimized);

        const icon = document.querySelector("#mm-search-minimize i");
        if (icon) {
            icon.className = this.isMinimized ? "fa-solid fa-expand" : "fa-solid fa-minus";
        }
    }

    /**
     * 清空消息区域
     */
    clearMessages() {
        const messagesContainer = document.getElementById("mm-search-messages");
        if (messagesContainer) {
            messagesContainer.innerHTML = "";
        }
    }

    /**
     * 添加系统消息
     */
    addSystemMessage(text) {
        const messagesContainer = document.getElementById("mm-search-messages");
        if (!messagesContainer) return;

        const msg = document.createElement("div");
        msg.className = "mm-search-message mm-search-message-system";
        msg.innerHTML = `
            <div class="mm-search-message-content">
                <i class="fa-solid fa-info-circle"></i>
                <span>${text}</span>
            </div>
        `;
        messagesContainer.appendChild(msg);
        this.scrollToBottom();
    }

    /**
     * 添加 AI 消息
     */
    addAIMessage(text) {
        const messagesContainer = document.getElementById("mm-search-messages");
        if (!messagesContainer) return;

        const msg = document.createElement("div");
        msg.className = "mm-search-message mm-search-message-ai";
        msg.innerHTML = `
            <div class="mm-search-message-avatar">
                <i class="fa-solid fa-robot"></i>
            </div>
            <div class="mm-search-message-content">
                <span>${text}</span>
            </div>
        `;
        messagesContainer.appendChild(msg);
        this.scrollToBottom();
    }

    /**
     * 添加搜索结果（用于历史事件回忆）
     * @param {Object} memory - 记忆数据
     */
    addSearchResult(memory) {
        const messagesContainer = document.getElementById("mm-search-messages");
        if (!messagesContainer) return;

        const floor = memory.uid || "0";
        const content = memory.content || "";
        const resultId = `result-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const msg = document.createElement("div");
        msg.className = "mm-search-message mm-search-message-result";
        msg.innerHTML = `
            <div class="mm-search-result-item" data-result-id="${resultId}">
                <div class="mm-search-result-header">
                    <span class="mm-search-result-floor">${String(floor).startsWith('【') ? floor : `【${floor}楼】`}</span>
                    <div class="mm-search-result-actions">
                        <button class="mm-btn mm-btn-adopt mm-search-adopt-btn">
                            <i class="fa-solid fa-check"></i> 采纳
                        </button>
                        <button class="mm-btn mm-btn-reject mm-search-reject-btn">
                            <i class="fa-solid fa-times"></i> 拒绝
                        </button>
                    </div>
                </div>
                <div class="mm-search-result-preview">${this.escapeHtml(content)}</div>
            </div>
        `;

        const resultItem = msg.querySelector(".mm-search-result-item");
        if (resultItem) {
            resultItem._memoryData = memory;
        }

        messagesContainer.appendChild(msg);
        this.scrollToBottom();
    }

    /**
     * 转义HTML特殊字符
     */
    escapeHtml(text) {
        if (!text) return "";
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 截断文本
     */
    truncateText(text, maxLength) {
        if (!text) return "";
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    }

    /**
     * 滚动到底部
     */
    scrollToBottom() {
        const messagesContainer = document.getElementById("mm-search-messages");
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    /**
     * 采用记忆
     */
    adoptMemory(resultItem) {
        if (!resultItem) return;

        const memoryData = resultItem._memoryData;
        if (!memoryData) return;

        const resultId = resultItem.dataset.resultId;
        if (this.selectedMemories.some((m) => m.resultId === resultId)) {
            return;
        }

        this.selectedMemories.push({
            resultId,
            memory: memoryData,
        });

        resultItem.classList.add("mm-adopted");
        const actionsDiv = resultItem.querySelector(".mm-search-result-actions");
        if (actionsDiv) {
            actionsDiv.innerHTML = `
                <button class="mm-btn mm-btn-remove mm-search-remove-btn">
                    <i class="fa-solid fa-trash"></i> 移除
                </button>
                <span class="mm-search-adopted-label">
                    <i class="fa-solid fa-check-circle"></i> 已采用
                </span>
            `;
        }

        this.updateSelectedCount();
        this.updateConfirmButton();
    }

    /**
     * 拒绝记忆
     */
    rejectMemory(resultItem) {
        if (!resultItem) return;

        resultItem.classList.add("mm-rejected");
        const actionsDiv = resultItem.querySelector(".mm-search-result-actions");
        if (actionsDiv) {
            actionsDiv.innerHTML = `
                <span class="mm-search-rejected-label">
                    <i class="fa-solid fa-ban"></i> 已拒绝
                </span>
            `;
        }
    }

    /**
     * 移除已选记忆
     */
    removeSelectedMemory(resultItem) {
        if (!resultItem) return;

        const resultId = resultItem.dataset.resultId;
        const index = this.selectedMemories.findIndex((m) => m.resultId === resultId);

        if (index > -1) {
            const removed = this.selectedMemories.splice(index, 1)[0];

            resultItem.classList.remove("mm-adopted");
            const actionsDiv = resultItem.querySelector(".mm-search-result-actions");
            if (actionsDiv) {
                actionsDiv.innerHTML = `
                    <button class="mm-btn mm-btn-adopt mm-search-adopt-btn">
                        <i class="fa-solid fa-check"></i> 采用
                    </button>
                    <button class="mm-btn mm-btn-reject mm-search-reject-btn">
                        <i class="fa-solid fa-times"></i> 拒绝
                    </button>
                `;
            }

            this.updateSelectedCount();
            this.updateConfirmButton();
            this.addSystemMessage(`已移除记忆: ${removed.memory.key || "未命名条目"}`);
        }
    }

    /**
     * 更新已选数量
     */
    updateSelectedCount() {
        const countEl = document.getElementById("mm-search-selected-count");
        if (countEl) {
            countEl.textContent = this.selectedMemories.length;
        }
    }

    /**
     * 更新目标数量
     */
    updateTargetCount() {
        const countEl = document.getElementById("mm-search-target-count");
        if (countEl) {
            countEl.textContent = this.targetCount;
        }
    }

    /**
     * 更新确认按钮状态
     */
    updateConfirmButton() {
        const confirmBtn = document.getElementById("mm-search-confirm");
        if (confirmBtn) {
            const hasSelected = this.selectedMemories.length > 0;
            confirmBtn.disabled = !hasSelected;
            confirmBtn.classList.toggle("mm-btn-success", hasSelected);
            confirmBtn.classList.toggle("mm-btn-secondary", !hasSelected);
        }
    }

    /**
     * 获取已采纳的历史事件回忆（供剧情优化助手使用）
     * @returns {string} 格式化的历史事件回忆文本
     */
    getAdoptedHistoricalMemories() {
        if (!this.selectedMemories || this.selectedMemories.length === 0) {
            return "";
        }

        const historicalLines = [];
        for (const item of this.selectedMemories) {
            const m = item.memory;
            if (m) {
                const floor = m.uid || m.key || "未知";
                const content = m.content || "";
                if (content.trim()) {
                    // 如果 floor 已经是完整标签格式，直接使用
                    const floorTag = String(floor).startsWith('【') ? floor : `【${floor}楼】`;
                    historicalLines.push(`${floorTag}${content}`);
                }
            }
        }

        if (historicalLines.length === 0) {
            return "";
        }

        return historicalLines.join("\n");
    }

    /**
     * 一键全选所有未拒绝、未移除的记忆
     * 将所有未被拒绝的搜索结果标记为已采纳，用户再点确认注入完成操作
     */
    selectAllUnrejected() {
        // 获取所有搜索结果项
        const container = document.getElementById("mm-search-books-container");
        if (!container) {
            Logger.warn("[一键全选] 容器 mm-search-books-container 未找到");
            return;
        }

        const allResultItems = container.querySelectorAll(".mm-search-result-item");
        Logger.debug(`[一键全选] 找到 ${allResultItems.length} 个搜索结果项`);

        if (allResultItems.length === 0) {
            // 使用第一个世界书面板显示消息
            if (this.summaryBooks.length > 0) {
                this.addBookSystemMessage(this.summaryBooks[0].name, "没有可选择的搜索结果");
            }
            return;
        }

        let selectedCount = 0;
        const beforeCount = this.selectedMemories.length;

        for (const resultItem of allResultItems) {
            // 跳过已拒绝的
            if (resultItem.classList.contains("mm-rejected")) {
                continue;
            }

            // 跳过已经采纳的（已在 selectedMemories 中）
            if (resultItem.classList.contains("mm-adopted")) {
                continue;
            }

            // 检查是否有 _memoryData
            if (!resultItem._memoryData) {
                Logger.warn("[一键全选] 搜索结果项缺少 _memoryData:", resultItem.dataset.resultId);
                continue;
            }

            // 通过已有的 adoptMemory 方法采纳
            this.adoptMemory(resultItem);
            selectedCount++;
        }

        const actualAdopted = this.selectedMemories.length - beforeCount;
        Logger.debug(`[一键全选] 尝试选择 ${selectedCount} 条，实际采纳 ${actualAdopted} 条`);

        // 使用第一个世界书面板显示消息
        const firstBookName = this.summaryBooks.length > 0 ? this.summaryBooks[0].name : null;
        if (firstBookName) {
            if (actualAdopted === 0) {
                this.addBookSystemMessage(firstBookName, "没有新的条目可选择（可能都已采纳或拒绝）");
            } else {
                this.addBookSystemMessage(firstBookName, `已全选 ${actualAdopted} 条记忆，请点击「确认注入」完成操作`);
            }
        }
    }

    /**
     * 确认选择
     */
    confirmSelection() {
        if (this.selectedMemories.length === 0) return;

        const memories = this.selectedMemories.map((item) => item.memory);

        this.addSystemMessage(`已确认注入 ${memories.length} 条记忆`);

        if (this.currentResolve) {
            this.currentResolve({
                action: "confirm",
                memories: memories,
                otherTasksResults: this.otherTasksResults,
            });
            this.currentResolve = null;
        }

        setTimeout(() => {
            this.hide();
        }, 500);
    }

    /**
     * 取消搜索
     */
    cancelSearch() {
        this.addSystemMessage("已取消搜索");

        if (this.currentResolve) {
            this.currentResolve({
                action: "cancel",
                memories: [],
                otherTasksResults: this.otherTasksResults,
            });
            this.currentResolve = null;
        }

        setTimeout(() => {
            this.hide();
        }, 300);
    }

    /**
     * 继续搜索
     */
    continueSearch() {
        this.addAIMessage("正在扩展关键词继续搜索...");

        if (this.onContinueSearch) {
            this.onContinueSearch();
        }
    }

    /**
     * 切换自定义输入框
     */
    toggleCustomInput() {
        const customInput = document.getElementById("mm-search-custom-input");
        if (customInput) {
            customInput.classList.toggle("mm-hidden");
            if (!customInput.classList.contains("mm-hidden")) {
                document.getElementById("mm-search-keyword-input")?.focus();
            }
        }
    }

    /**
     * 隐藏自定义输入框
     */
    hideCustomInput() {
        const customInput = document.getElementById("mm-search-custom-input");
        if (customInput) {
            customInput.classList.add("mm-hidden");
        }
    }

    /**
     * 使用自定义关键词搜索
     */
    searchWithCustomKeyword() {
        const input = document.getElementById("mm-search-keyword-input");
        if (!input) return;

        const keyword = input.value.trim();
        if (!keyword) return;

        input.value = "";
        this.hideCustomInput();
        this.addSystemMessage(`正在搜索关键词: ${keyword}`);

        if (this.onCustomSearch) {
            this.onCustomSearch(keyword);
        }
    }

    /**
     * 更新其他任务状态
     */
    updateOtherTasksStatus(completed, total, results = null) {
        const statusEl = document.getElementById("mm-search-other-tasks-status");
        const progressEl = document.getElementById("mm-search-tasks-progress");

        if (progressEl) {
            progressEl.textContent = `${completed}/${total}`;
        }

        if (completed >= total) {
            this.otherTasksCompleted = true;
            this.otherTasksResults = results;

            if (statusEl) {
                statusEl.innerHTML = `
                    <i class="fa-solid fa-check-circle" style="color: var(--mm-success);"></i>
                    其他任务已完成
                `;
            }

            this.addSystemMessage("其他并发任务已完成，等待您确认搜索结果...");
        }
    }

    /**
     * 开始记忆搜索助手会话
     * @returns {Promise} 返回用户选择结果
     */
    startSession(options = {}) {
        return new Promise((resolve, reject) => {
            this.currentResolve = resolve;
            this.currentReject = reject;
            this.show(options);
        });
    }
}

// 全局实例
let memorySearchPanel = null;

/**
 * 获取记忆搜索助手面板实例
 */
export function getMemorySearchPanel() {
    if (!memorySearchPanel) {
        memorySearchPanel = new MemorySearchPanel();
    }
    return memorySearchPanel;
}

/**
 * 初始化记忆搜索面板
 */
export function initMemorySearchPanel() {
    const panel = getMemorySearchPanel();
    panel.init();
    return panel;
}

/**
 * 检查是否启用了记忆搜索助手
 */
export function isMemorySearchEnabled() {
    const settings = getGlobalSettings();
    return settings.enableInteractiveSearch === true;
}

/**
 * 检查是否已导入总结世界书
 * @returns {boolean} 是否有总结世界书
 */
export function hasImportedSummaryBooks() {
    const importedNames = getImportedBookNames();
    return importedNames.some((name) => isSummaryBook(name));
}

/**
 * 获取记忆搜索助手设置
 */
export function getMemorySearchAssistantSettings() {
    const settings = getGlobalSettings();
    return {
        enabled: settings.enableInteractiveSearch === true,
    };
}

// ============================================================================
// 历史事件回忆搜索
// ============================================================================

/**
 * 执行记忆搜索助手流程
 * @param {string} userMessage - 用户消息
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 搜索结果
 */
export async function performMemorySearch(userMessage, options = {}) {
    const panel = getMemorySearchPanel();
    const globalSettings = getGlobalSettings();

    const targetCount = options.targetCount || globalSettings.maxHistoryEvents || 5;

    panel.originalUserMessage = userMessage;
    panel.originalContext = options.context;

    panel.onContinueSearch = async () => {
        await continueMemorySearch(panel);
    };

    panel.onCustomSearch = async (keyword) => {
        await customKeywordSearch(panel, keyword);
    };

    const sessionPromise = panel.startSession({ targetCount });

    await callHistoricalMemoryAI(panel, userMessage, options.context);

    return sessionPromise;
}

/**
 * 调用历史事件回忆AI并显示结果（支持多总结世界书并行处理）
 */
async function callHistoricalMemoryAI(panel, userMessage, context) {
    try {
        const worldBooks = await getImportedWorldBooks();
        const { summaryBooks } = classifyWorldBooks(worldBooks);

        const enabledSummaryBooks = summaryBooks.filter((book) => {
            try {
                const aiConfig = getSummaryConfig(book.name);
                return aiConfig.enabled !== false;
            } catch (e) {
                Logger.warn(`总结世界书 "${book.name}" 未配置，跳过`);
                return false;
            }
        });

        panel.initBookSections(enabledSummaryBooks);

        if (enabledSummaryBooks.length === 0) {
            return;
        }

        const promises = enabledSummaryBooks.map((book) =>
            callSingleSummaryBookAI(panel, book, userMessage, context)
        );

        await Promise.allSettled(promises);
    } catch (error) {
        Logger.error("[记忆搜索助手] 调用历史事件回忆AI失败:", error.message);
    }
}

/**
 * 调用单个总结世界书的 AI（支持拆分模式）
 */
async function callSingleSummaryBookAI(panel, book, userMessage, context) {
    const bookName = book.name;

    try {
        // 检查是否启用拆分
        const splitEnabled = isSummaryAutoSplitEnabled();
        const summaryContent = getSummaryContent(book);

        if (splitEnabled) {
            const splitConfig = getSummaryAutoSplitConfig();
            const shouldSplit = needsSplit(summaryContent, splitConfig.targetChars);

            if (shouldSplit) {
                // 拆分模式：并发处理多个 Part
                await callSummaryBookWithSplit(panel, book, userMessage, context, summaryContent, splitConfig);
                return;
            }
        }

        // 非拆分模式：单个 API 调用
        await callSummaryBookSingle(panel, book, userMessage, context, summaryContent);
    } catch (error) {
        Logger.error(`[记忆搜索助手] 总结世界书 "${bookName}" 初始化失败:`, error.message);
        panel.setBookStatus(bookName, "error", "失败");
        panel.addBookSystemMessage(bookName, `初始化失败: ${error.message}`);
    }
}

/**
 * 单个 API 调用处理总结世界书（非拆分模式）
 */
async function callSummaryBookSingle(panel, book, userMessage, context, summaryContent) {
    const bookName = book.name;
    const taskId = `search_${bookName}`;
    const abortController = new AbortController();

    panel.setBookStatus(bookName, "loading", "调用AI中...");
    panel.addBookAIMessage(bookName, "正在调用历史事件回忆AI...");

    const aiConfig = getSummaryConfig(bookName);
    const globalConfig = getGlobalConfig();

    const dataInjection = buildDataInjection({
        worldBookContent: summaryContent,
        context: context || "",
        userMessage: userMessage,
    });

    const template = await getHistoricalPromptTemplate();
    const jailbreakPrefix = getJailbreakPrefix();

    const prompt = injectDataToPrompt(template, dataInjection, {
        flowType: "总结世界书",
        jailbreakPrefix: jailbreakPrefix,
    });

    const finalSystemPrompt = replacePromptVariables(prompt.systemPrompt, aiConfig, globalConfig);
    const finalUserMessage = buildUserPrompt(userMessage);

    if (progressTracker) {
        progressTracker.addTask(taskId, `搜索:${bookName}`, "search");
        progressTracker.setTaskAbortController(taskId, abortController);
    }

    try {
        const response = await APIAdapter.callWithRetry(
            {
                ...aiConfig,
                category: bookName,
                source: bookName,
                taskId: taskId,
            },
            finalSystemPrompt,
            finalUserMessage,
            taskId,
            3,
            abortController.signal
        );

        if (progressTracker) {
            progressTracker.completeTask(taskId, true);
        }

        const events = parseHistoricalEvents(response);
        displaySearchResults(panel, bookName, events);
    } catch (error) {
        handleSearchError(panel, bookName, taskId, error);
    }
}

/**
 * 拆分模式：并发处理多个 Part
 */
async function callSummaryBookWithSplit(panel, book, userMessage, context, summaryContent, splitConfig) {
    const bookName = book.name;

    // 分析拆分方案
    const parts = analyzeSummaryContent(summaryContent, splitConfig);

    if (parts.length <= 1) {
        // 内容不足以拆分，使用单个 API
        await callSummaryBookSingle(panel, book, userMessage, context, summaryContent);
        return;
    }

    panel.setBookStatus(bookName, "loading", `并发处理 ${parts.length} 个Part...`);
    panel.addBookAIMessage(bookName, `内容已拆分为 ${parts.length} 个Part，正在并发调用AI...`);

    // 获取配置
    const partConfigs = getSummaryPartConfigs(bookName);
    const originalConfig = getSummaryConfig(bookName);
    const globalConfig = getGlobalConfig();

    // 并发处理所有 Part
    const partPromises = parts.map(async (part) => {
        // Part 1（index=0）复用原配置，其他 Part 使用各自的配置
        let partConfig;
        if (part.index === 0) {
            partConfig = originalConfig;
        } else {
            partConfig = getSummaryPartApiConfig(bookName, part.id);
        }

        if (!partConfig || !partConfig.enabled) {
            Logger.warn(`[记忆搜索助手] Part "${part.id}" 未配置，跳过`);
            return { partId: part.id, success: false, error: "未配置", events: [] };
        }

        const taskId = `search_${bookName}_${part.id}`;
        const abortController = new AbortController();

        if (progressTracker) {
            progressTracker.addTask(taskId, `搜索:${bookName} Part${part.index + 1}`, "search");
            progressTracker.setTaskAbortController(taskId, abortController);
        }

        try {
            const partContent = `=== Part ${part.id} (${part.startFloor}-${part.endFloor}楼) ===\n${part.content}`;

            const dataInjection = buildDataInjection({
                worldBookContent: partContent,
                context: context || "",
                userMessage: userMessage,
            });

            const template = await getHistoricalPromptTemplate();
            const jailbreakPrefix = getJailbreakPrefix();

            const prompt = injectDataToPrompt(template, dataInjection, {
                flowType: "总结世界书",
                jailbreakPrefix: jailbreakPrefix,
            });

            const finalSystemPrompt = replacePromptVariables(prompt.systemPrompt, partConfig, globalConfig);
            const finalUserMessage = buildUserPrompt(userMessage);

            const response = await APIAdapter.callWithRetry(
                {
                    ...partConfig,
                    category: bookName,
                    source: `${bookName} Part${part.index + 1}`,
                    taskId: taskId,
                },
                finalSystemPrompt,
                finalUserMessage,
                taskId,
                3,
                abortController.signal
            );

            if (progressTracker) {
                progressTracker.completeTask(taskId, true);
            }

            const events = parseHistoricalEvents(response);
            return {
                partId: part.id,
                partIndex: part.index,
                success: true,
                rawMemory: response,
                events: events,
            };
        } catch (error) {
            const isAborted = error.name === "AbortError";
            if (progressTracker) {
                progressTracker.completeTask(taskId, false, isAborted ? "已终止" : error.message);
            }
            return {
                partId: part.id,
                partIndex: part.index,
                success: false,
                error: isAborted ? "已终止" : error.message,
                events: [],
            };
        }
    });

    const partResults = await Promise.all(partPromises);

    // 合并结果
    const mergedEvents = mergePartEventsForSearch(partResults);

    // 显示调试弹窗（如果启用）
    if (isPartDebugEnabled()) {
        const debugResults = partResults.map(r => ({
            partId: r.partId,
            rawMemory: r.rawMemory || `(${r.error || '无返回'})`,
        }));
        const mergedResult = {
            rawMemory: mergedEvents.map(e => {
                const floorTag = String(e.floor).startsWith('【') ? e.floor : `【${e.floor}楼】`;
                return `${floorTag}${e.content}`;
            }).join('\n'),
            eventCount: mergedEvents.length,
        };
        showPartDebugModal(debugResults, bookName, mergedResult);
    }

    // 统计结果
    const successCount = partResults.filter(r => r.success).length;
    const failCount = partResults.length - successCount;

    if (mergedEvents.length === 0) {
        panel.setBookStatus(bookName, failCount > 0 ? "error" : "success", "无结果");
        panel.addBookSystemMessage(bookName, `${successCount}/${parts.length} 个Part成功，AI未返回历史事件`);
    } else {
        panel.setBookStatus(bookName, "success", `${mergedEvents.length} 条`);
        panel.addBookAIMessage(bookName, `${successCount}/${parts.length} 个Part成功，共返回 ${mergedEvents.length} 条历史事件:`);
        for (const event of mergedEvents) {
            panel.addBookSearchResult(bookName, {
                uid: event.floor,
                content: event.content,
            });
        }
    }
}

/**
 * 合并多个 Part 的搜索结果
 */
function mergePartEventsForSearch(partResults) {
    const deduplicateEnabled = isSummaryMergeDeduplicateEnabled();
    const allEvents = [];

    // 收集所有事件（保持原始顺序）
    for (const result of partResults) {
        if (result.success && result.events) {
            for (const event of result.events) {
                allEvents.push({
                    floor: event.floor,
                    content: event.content,
                    sourcePartId: result.partId,
                });
            }
        }
    }

    if (deduplicateEnabled) {
        // 去重模式：同一楼层只保留内容最长的
        const floorBestEvent = new Map();
        for (const event of allEvents) {
            const existing = floorBestEvent.get(event.floor);
            if (!existing || event.content.length > existing.content.length) {
                floorBestEvent.set(event.floor, event);
            }
        }
        // 按原始出现顺序输出（使用第一次出现的顺序）
        const seenFloors = new Set();
        const uniqueEvents = [];
        for (const event of allEvents) {
            if (!seenFloors.has(event.floor)) {
                seenFloors.add(event.floor);
                uniqueEvents.push(floorBestEvent.get(event.floor));
            }
        }
        return uniqueEvents;
    } else {
        // 不去重模式：相同楼层的内容放在一起
        const floorGroups = new Map();
        const floorOrder = [];

        for (const event of allEvents) {
            if (!floorGroups.has(event.floor)) {
                floorGroups.set(event.floor, []);
                floorOrder.push(event.floor);
            }
            floorGroups.get(event.floor).push(event);
        }

        const finalEvents = [];
        for (const floor of floorOrder) {
            finalEvents.push(...floorGroups.get(floor));
        }
        return finalEvents;
    }
}

/**
 * 显示搜索结果
 */
function displaySearchResults(panel, bookName, events) {
    if (events.length === 0) {
        panel.setBookStatus(bookName, "success", "无结果");
        panel.addBookSystemMessage(bookName, "AI未返回历史事件，请尝试自定义搜索");
    } else {
        panel.setBookStatus(bookName, "success", `${events.length} 条`);
        panel.addBookAIMessage(bookName, `AI返回 ${events.length} 条历史事件:`);
        for (const event of events) {
            panel.addBookSearchResult(bookName, {
                uid: event.floor,
                content: event.content,
            });
        }
    }
}

/**
 * 处理搜索错误
 */
function handleSearchError(panel, bookName, taskId, error) {
    const isAborted = error.name === "AbortError";
    if (progressTracker) {
        progressTracker.completeTask(taskId, false, isAborted ? "已终止" : error.message);
    }
    if (isAborted) {
        Logger.warn(`[记忆搜索助手] 总结世界书 "${bookName}" 已被终止`);
        panel.setBookStatus(bookName, "error", "已终止");
        panel.addBookSystemMessage(bookName, "搜索已被用户终止");
    } else {
        Logger.error(`[记忆搜索助手] 总结世界书 "${bookName}" AI调用失败:`, error.message);
        panel.setBookStatus(bookName, "error", "失败");
        panel.addBookSystemMessage(bookName, `AI调用失败: ${error.message}`);
    }
}

/**
 * 解析AI返回的历史事件
 * @param {string} response - AI返回的原始响应
 * @returns {Array<{floor: string, content: string}>} 解析后的历史事件数组
 */
function parseHistoricalEvents(response) {
    const events = [];

    const match = response.match(/<Historical_Occurrences>([\s\S]*?)<\/Historical_Occurrences>/);
    if (!match) return events;

    const content = match[1].trim();
    const lines = content.split("\n");

    for (const line of lines) {
        const trimmed = line.trim();
        // 兼容多种楼层格式：【124楼】、【124至#125】、【124至125楼】
        // 捕获完整的楼层标签和内容
        const floorMatch = trimmed.match(/^(【\d+(?:楼|至#?\d+楼?)】)(.*)$/);
        if (floorMatch) {
            // 保留完整的楼层标签（如 【124至#125】）
            const floorTag = floorMatch[1];
            const content = floorMatch[2] || '';
            events.push({
                floor: floorTag,
                content: content.trim(),
            });
        }
    }

    return events;
}

/**
 * 继续搜索
 */
async function continueMemorySearch(panel) {
    const userMessage = panel.originalUserMessage || "";
    const context = panel.originalContext || "";

    if (!userMessage) {
        if (panel.summaryBooks.length === 0) {
            return;
        }
        panel.addBookSystemMessage(panel.summaryBooks[0].name, "请使用自定义搜索输入关键词");
        return;
    }

    await continueSearchAllBooks(panel, userMessage, context);
}

/**
 * 在所有已有的世界书面板上继续搜索
 */
async function continueSearchAllBooks(panel, userMessage, context) {
    if (panel.summaryBooks.length === 0) {
        return;
    }

    const promises = panel.summaryBooks.map((book) =>
        callSingleSummaryBookAI(panel, book, userMessage, context)
    );

    await Promise.allSettled(promises);
}

/**
 * 自定义关键词搜索
 */
async function customKeywordSearch(panel, keyword) {
    if (!keyword) return;

    panel.searchHistory.push(keyword);

    await continueSearchAllBooks(panel, keyword, panel.originalContext);
}
