/**
 * 记忆搜索助手面板组件
 * @module ui/components/search-panel
 */

import Logger from '@core/logger';
import { getGlobalSettings, getGlobalConfig, getSummaryConfig } from '@config/config-manager';
import { getImportedBookNames } from '@config/imported-books';
import { getImportedWorldBooks, classifyWorldBooks, isSummaryBook } from '@worldbook/api';
import { getSummaryContent } from '@worldbook/parser';
import APIAdapter from '@api/adapter';
import { getHistoricalPromptTemplate } from '@utils/prompt-template';
import { buildDataInjection, injectDataToPrompt, replacePromptVariables, buildUserPrompt } from '@memory/prompt-builder';
import { getJailbreakPrefix } from '@memory/jailbreak';

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
                    <span class="mm-search-result-floor">【${this.escapeHtml(floor)}楼】</span>
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
                    <span class="mm-search-result-floor">【${floor}楼】</span>
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
                    historicalLines.push(`【${floor}楼】${content}`);
                }
            }
        }

        if (historicalLines.length === 0) {
            return "";
        }

        return historicalLines.join("\n");
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
 * 调用单个总结世界书的 AI
 */
async function callSingleSummaryBookAI(panel, book, userMessage, context) {
    const bookName = book.name;
    const taskId = `search_${bookName}`;
    const abortController = new AbortController();

    try {
        panel.setBookStatus(bookName, "loading", "调用AI中...");
        panel.addBookAIMessage(bookName, "正在调用历史事件回忆AI...");

        const aiConfig = getSummaryConfig(bookName);
        const globalConfig = getGlobalConfig();

        const summaryContent = getSummaryContent(book);
        const dataInjection = buildDataInjection({
            worldBookContent: summaryContent,
            context: context || "",
            userMessage: userMessage,
        });

        const template = await getHistoricalPromptTemplate();
        const prompt = injectDataToPrompt(template, dataInjection);
        const baseSystemPrompt = replacePromptVariables(prompt.systemPrompt, aiConfig, globalConfig);

        const finalSystemPrompt = getJailbreakPrefix() + "\n\n" + baseSystemPrompt;
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
        } catch (error) {
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
    } catch (error) {
        Logger.error(`[记忆搜索助手] 总结世界书 "${bookName}" 初始化失败:`, error.message);
        panel.setBookStatus(bookName, "error", "失败");
        panel.addBookSystemMessage(bookName, `初始化失败: ${error.message}`);
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
        const floorMatch = trimmed.match(/^【(\d+)楼】(.*)$/);
        if (floorMatch) {
            events.push({
                floor: floorMatch[1],
                content: floorMatch[2].trim(),
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
