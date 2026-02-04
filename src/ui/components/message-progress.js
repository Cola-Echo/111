/**
 * 消息进度面板模块
 * @module ui/components/message-progress
 */

import Logger from '@core/logger';
import { getGlobalSettings, loadConfig, saveConfig } from '@config/config-manager';

/**
 * 消息右侧进度面板类
 */
export class MessageProgressPanel {
    constructor() {
        this.container = null;
        this.tasks = new Map();
        this.isCollapsed = true;
        this.isVisible = false;
        this.hideTimeout = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.position = null;
        this.taskColors = new Map();
        this.fadingTasks = new Set();
        // 动画插值相关
        this.displayProgress = new Map(); // 当前显示的进度值
        this.animationFrames = new Map(); // 动画帧ID
    }

    // 霓虹色彩库
    static NEON_COLORS = [
        { main: "#ff6b9d", glow: "rgba(255, 107, 157, 0.6)" },
        { main: "#00d4ff", glow: "rgba(0, 212, 255, 0.6)" },
        { main: "#ffd93d", glow: "rgba(255, 217, 61, 0.6)" },
        { main: "#6bcb77", glow: "rgba(107, 203, 119, 0.6)" },
        { main: "#a855f7", glow: "rgba(168, 85, 247, 0.6)" },
        { main: "#ff8c42", glow: "rgba(255, 140, 66, 0.6)" },
        { main: "#4ecdc4", glow: "rgba(78, 205, 196, 0.6)" },
        { main: "#f638dc", glow: "rgba(246, 56, 220, 0.6)" },
    ];

    init() {
        this.tasks.clear();
        this.taskColors = new Map();
        this.fadingTasks = new Set();
        // 清除所有动画
        for (const frameId of this.animationFrames.values()) {
            cancelAnimationFrame(frameId);
        }
        this.displayProgress.clear();
        this.animationFrames.clear();

        if (this.container) {
            const contentEl = this.container.querySelector(".mm-msg-panel-content");
            if (contentEl) contentEl.innerHTML = "";
            const previewEl = this.container.querySelector(".mm-msg-panel-preview");
            if (previewEl) previewEl.innerHTML = "";
            return;
        }
        this.createDOM();
        this.bindEvents();
        this.loadPosition();
    }

    getRandomColor() {
        const colors = MessageProgressPanel.NEON_COLORS;
        return colors[Math.floor(Math.random() * colors.length)];
    }

    createDOM() {
        this.container = document.createElement("div");
        this.container.id = "mm-progress-panel";
        this.container.className = "mm-message-progress-panel mm-collapsed";
        this.container.innerHTML = `
            <div class="mm-msg-panel-header">
                <span class="mm-msg-panel-title">
                    <i class="fa-solid fa-grip-vertical mm-drag-handle"></i>
                    处理中
                </span>
                <div class="mm-msg-panel-controls">
                    <button class="mm-btn mm-btn-icon mm-msg-minimize-btn" title="最小化/展开">
                        <i class="fa-solid fa-minus"></i>
                    </button>
                </div>
            </div>
            <div class="mm-msg-panel-content"></div>
            <div class="mm-msg-panel-preview"></div>
        `;
        document.body.appendChild(this.container);

        const settings = getGlobalSettings();
        const theme = settings.theme || "default";
        if (theme !== "default") {
            this.container.setAttribute("data-mm-theme", theme);
        }

        this.taskColors = new Map();
    }

    bindEvents() {
        const header = this.container.querySelector(".mm-msg-panel-header");

        const minimizeBtn = this.container.querySelector(".mm-msg-minimize-btn");
        if (minimizeBtn) {
            minimizeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleCollapse();
            });
        }

        let dragStartTime = 0;
        let dragMoved = false;

        const onDragStart = (e) => {
            const target = e.target;
            if (target.closest(".mm-msg-minimize-btn") || target.closest("button")) {
                return;
            }

            dragStartTime = Date.now();
            dragMoved = false;

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const rect = this.container.getBoundingClientRect();
            this.dragOffset = {
                x: clientX - rect.left,
                y: clientY - rect.top,
            };

            this.container.style.setProperty("left", `${rect.left}px`, "important");
            this.container.style.setProperty("top", `${rect.top}px`, "important");
            this.container.style.setProperty("right", "auto", "important");
            this.container.style.setProperty("transform", "none", "important");

            this.container.classList.add("mm-dragging");

            if (e.touches) {
                document.addEventListener("touchmove", onDragMove, { passive: false });
                document.addEventListener("touchend", onDragEnd);
            } else {
                document.addEventListener("mousemove", onDragMove);
                document.addEventListener("mouseup", onDragEnd);
            }
        };

        const onDragMove = (e) => {
            e.preventDefault();
            dragMoved = true;
            this.isDragging = true;

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            let newX = clientX - this.dragOffset.x;
            let newY = clientY - this.dragOffset.y;

            const rect = this.container.getBoundingClientRect();
            const maxX = window.innerWidth - rect.width;
            const maxY = window.innerHeight - rect.height;

            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));

            this.container.style.setProperty("left", `${newX}px`, "important");
            this.container.style.setProperty("top", `${newY}px`, "important");
            this.container.style.setProperty("transform", "none", "important");

            this.position = { x: newX, y: newY };
        };

        const onDragEnd = (e) => {
            this.container.classList.remove("mm-dragging");

            document.removeEventListener("mousemove", onDragMove);
            document.removeEventListener("mouseup", onDragEnd);
            document.removeEventListener("touchmove", onDragMove);
            document.removeEventListener("touchend", onDragEnd);

            if (this.position && dragMoved) {
                if (window.innerWidth >= 768) {
                    this.savePosition();
                }
                this.container.classList.add("mm-user-positioned");
            }

            const dragDuration = Date.now() - dragStartTime;
            if (dragDuration < 200 && !dragMoved) {
                this.toggleCollapse();
            }

            setTimeout(() => {
                this.isDragging = false;
            }, 50);
        };

        header.addEventListener("mousedown", onDragStart);
        header.addEventListener("touchstart", (e) => {
            const target = e.target;
            if (target.closest(".mm-msg-minimize-btn") || target.closest("button")) return;
            e.preventDefault();
            onDragStart(e);
        }, { passive: false });
    }

    savePosition() {
        if (window.innerWidth < 768) return;

        if (this.position) {
            const config = loadConfig();
            if (!config.ui) config.ui = {};
            config.ui.panelPosition = this.position;
            saveConfig(config);
        }
    }

    loadPosition() {
        try {
            const config = loadConfig();
            let pos = config.ui?.panelPosition;

            if (!pos) {
                const saved = localStorage.getItem("mm_progress_panel_position");
                if (saved) {
                    pos = JSON.parse(saved);
                    if (!config.ui) config.ui = {};
                    config.ui.panelPosition = pos;
                    saveConfig(config);
                    localStorage.removeItem("mm_progress_panel_position");
                    Logger.log("[迁移] 面板位置已迁移到 extensionSettings");
                }
            }

            if (pos) {
                const rect = this.container.getBoundingClientRect();
                const maxX = window.innerWidth - rect.width;
                const maxY = window.innerHeight - rect.height;

                if (pos.x >= 0 && pos.x <= maxX && pos.y >= 0 && pos.y <= maxY) {
                    this.position = pos;
                    this.container.style.left = `${pos.x}px`;
                    this.container.style.top = `${pos.y}px`;
                    this.container.style.transform = "none";
                    this.container.classList.add("mm-user-positioned");
                }
            }
        } catch (e) {
            // 忽略错误
        }
    }

    resetPosition() {
        this.position = null;
        if (!this.container) return;
        this.container.style.left = "50%";
        this.container.style.top = "80px";
        this.container.style.transform = "translateX(-50%)";
        this.container.classList.remove("mm-user-positioned");
        localStorage.removeItem("mm_progress_panel_position");
    }

    toggleCollapse() {
        if (this.isDragging) return;
        if (!this.container) return;
        this.isCollapsed = !this.isCollapsed;
        this.container.classList.toggle("mm-collapsed", this.isCollapsed);
        this.updatePreview();
    }

    show() {
        Logger.info("[MessageProgressPanel] ===== show() 被调用 =====");
        Logger.log("[MessageProgressPanel] show() 被调用");
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }

        // 确保容器已创建
        if (!this.container) {
            Logger.log("[MessageProgressPanel] 容器不存在，正在创建...");
            this.createDOM();
            this.bindEvents();
            this.loadPosition();
            Logger.log("[MessageProgressPanel] 容器已创建:", !!this.container);
        }

        if (this.container) {
            const isMobile = window.innerWidth < 768;

            if (isMobile) {
                this.container.style.left = "";
                this.container.style.top = "";
                this.container.style.right = "";
                this.container.style.bottom = "";
                this.container.style.transform = "";
                this.container.classList.remove("mm-user-positioned");
                this.position = null;
            } else {
                const config = loadConfig();
                let pos = config.ui?.panelPosition;

                if (!pos) {
                    const saved = localStorage.getItem("mm_progress_panel_position");
                    if (saved) {
                        try {
                            pos = JSON.parse(saved);
                            if (!config.ui) config.ui = {};
                            config.ui.panelPosition = pos;
                            saveConfig(config);
                            localStorage.removeItem("mm_progress_panel_position");
                        } catch (e) {}
                    }
                }

                if (pos) {
                    requestAnimationFrame(() => {
                        const rect = this.container.getBoundingClientRect();
                        const maxX = window.innerWidth - Math.min(rect.width, 320);
                        const maxY = window.innerHeight - Math.min(rect.height, 100);

                        if (pos.x >= 0 && pos.x <= maxX && pos.y >= 0 && pos.y <= maxY) {
                            this.position = pos;
                            this.container.style.left = `${pos.x}px`;
                            this.container.style.top = `${pos.y}px`;
                            this.container.style.transform = "none";
                            this.container.classList.add("mm-user-positioned");
                        } else {
                            this.resetPosition();
                        }
                    });
                } else {
                    this.container.style.left = "";
                    this.container.style.top = "";
                    this.container.style.right = "";
                    this.container.style.bottom = "";
                    this.container.style.transform = "";
                    this.container.classList.remove("mm-user-positioned");
                }
            }

            this.isVisible = true;
            this.container.classList.remove("mm-hiding");
            this.container.classList.add("mm-visible");
        }
    }

    hide() {
        if (!this.container) return;
        this.container.classList.add("mm-hiding");
        this.hideTimeout = setTimeout(() => {
            this.isVisible = false;
            this.container.classList.remove("mm-visible", "mm-hiding");
        }, 400);
    }

    updateTasks(tasksMap) {
        // 确保容器存在
        if (!this.container) {
            Logger.log("[MessageProgressPanel] updateTasks: 容器不存在，正在创建...");
            this.createDOM();
            this.bindEvents();
            this.loadPosition();
        }

        const oldTaskIds = new Set(this.tasks.keys());

        const contentEl = this.container?.querySelector(".mm-msg-panel-content");
        const fadingTaskIds = new Set(this.fadingTasks || []);
        if (contentEl) {
            contentEl.querySelectorAll(".mm-msg-progress-item.mm-fading").forEach((el) => {
                fadingTaskIds.add(el.dataset.taskId);
            });
        }

        for (const [taskId, task] of tasksMap) {
            if (fadingTaskIds.has(taskId)) continue;

            const existing = this.tasks.get(taskId);
            if (!existing && (task.status === "success" || task.status === "error")) {
                continue;
            }

            if (existing) {
                let newProgress;
                if (task.status === "success" || task.status === "error") {
                    newProgress = 100;
                } else if (task.status === "retrying") {
                    newProgress = task.progress || 0;
                } else if (task.startTime && existing.startTime && task.startTime > existing.startTime) {
                    newProgress = task.progress || 0;
                } else {
                    const localProgress = existing.progress || 0;
                    const incomingProgress = task.progress || 0;
                    newProgress = Math.max(localProgress, incomingProgress);
                }
                this.tasks.set(taskId, { ...task, progress: newProgress });
            } else {
                this.tasks.set(taskId, { ...task, progress: task.progress || 0 });
            }
        }

        const activeTasks = Array.from(this.tasks.values()).filter(
            (t) => t.status === "running"
        );

        if (activeTasks.length > 0) {
            this.show();
        }

        const newTaskIds = new Set(this.tasks.keys());
        const hasNewTask = [...newTaskIds].some((id) => !oldTaskIds.has(id));

        if (hasNewTask) {
            this.renderContent();
        } else {
            this.syncRender();
        }
    }

    syncRender() {
        // 确保容器存在
        if (!this.container) {
            Logger.log("[MessageProgressPanel] syncRender: 容器不存在，正在创建...");
            this.createDOM();
            this.bindEvents();
            this.loadPosition();
        }
        if (!this.container) return;

        const contentEl = this.container.querySelector(".mm-msg-panel-content");
        if (!contentEl) return;
        const tasksArray = Array.from(this.tasks.values());

        const fadingTaskIds = new Set();
        contentEl.querySelectorAll(".mm-msg-progress-item.mm-fading").forEach((el) => {
            fadingTaskIds.add(el.dataset.taskId);
        });

        const activeTasks = tasksArray.filter(
            (t) => t.status !== "success" && t.status !== "error" && !fadingTaskIds.has(t.id)
        );

        if (tasksArray.length === 0) {
            contentEl.innerHTML = '<div style="text-align:center;color:var(--mm-text-muted);padding:20px;">暂无任务</div>';
            return;
        }

        const existingIds = new Set();
        contentEl.querySelectorAll(".mm-msg-progress-item").forEach((el) => {
            existingIds.add(el.dataset.taskId);
        });

        const missingTasks = activeTasks.filter((t) => !existingIds.has(t.id));
        if (missingTasks.length > 0) {
            this.appendNewTasks(missingTasks);
        }

        tasksArray.forEach((task) => {
            const itemEl = contentEl.querySelector(`.mm-msg-progress-item[data-task-id="${task.id}"]`);
            if (itemEl) {
                if (itemEl.classList.contains("mm-fading")) return;

                itemEl.classList.remove("mm-success", "mm-error");
                if (task.status === "success") {
                    itemEl.classList.add("mm-success");
                    const percentEl = itemEl.querySelector(".mm-msg-progress-percent");
                    const fillEl = itemEl.querySelector(".mm-msg-progress-bar-fill");
                    if (percentEl) percentEl.textContent = "100%";
                    if (fillEl) fillEl.style.width = "100%";
                    itemEl.classList.add("mm-fading");
                    if (!this.fadingTasks) this.fadingTasks = new Set();
                    this.fadingTasks.add(task.id);
                    const taskId = task.id;
                    setTimeout(() => {
                        if (!this.fadingTasks || !this.fadingTasks.has(taskId)) return;
                        this.fadingTasks.delete(taskId);
                        itemEl.remove();
                        this.tasks.delete(taskId);
                        this.taskColors.delete(taskId);
                        if (this.tasks.size === 0) this.hide();
                    }, 3000);
                } else if (task.status === "error") {
                    itemEl.classList.add("mm-error");
                    const percentEl = itemEl.querySelector(".mm-msg-progress-percent");
                    const fillEl = itemEl.querySelector(".mm-msg-progress-bar-fill");
                    if (percentEl) percentEl.textContent = "100%";
                    if (fillEl) fillEl.style.width = "100%";
                    itemEl.classList.add("mm-fading");
                    if (!this.fadingTasks) this.fadingTasks = new Set();
                    this.fadingTasks.add(task.id);
                    const taskId = task.id;
                    setTimeout(() => {
                        if (!this.fadingTasks || !this.fadingTasks.has(taskId)) return;
                        this.fadingTasks.delete(taskId);
                        itemEl.remove();
                        this.tasks.delete(taskId);
                        this.taskColors.delete(taskId);
                        if (this.tasks.size === 0) this.hide();
                    }, 3000);
                } else if (task.status === "running" && task.progress === 0) {
                    const percentEl = itemEl.querySelector(".mm-msg-progress-percent");
                    const fillEl = itemEl.querySelector(".mm-msg-progress-bar-fill");
                    if (percentEl) percentEl.textContent = "0%";
                    if (fillEl) fillEl.style.width = "0%";
                }
            }
        });

        this.updatePreview();
    }

    appendNewTasks(newTasks) {
        if (!this.container) return;
        const contentEl = this.container.querySelector(".mm-msg-panel-content");
        if (!contentEl) return;

        if (contentEl.querySelector('[style*="text-align:center"]')) {
            contentEl.innerHTML = "";
        }

        newTasks.forEach((task) => {
            const progress = Math.round(task.progress || 0);

            if (!this.taskColors.has(task.id)) {
                this.taskColors.set(task.id, this.getRandomColor());
            }
            const color = this.taskColors.get(task.id);

            const itemHtml = `
                <div class="mm-msg-progress-item" data-task-id="${task.id}">
                    <div class="mm-msg-progress-header">
                        <span class="mm-msg-progress-name">${task.name || task.id}</span>
                        <span class="mm-msg-progress-percent" style="color: ${color.main}">${progress}%</span>
                    </div>
                    <div class="mm-msg-progress-bar-wrapper">
                        <div class="mm-msg-progress-bar-fill mm-neon-bar" style="width: ${progress}%; background: linear-gradient(90deg, ${color.main}88, ${color.main}); box-shadow: 0 0 10px ${color.glow}, 0 0 20px ${color.glow};"></div>
                    </div>
                </div>
            `;
            contentEl.insertAdjacentHTML("beforeend", itemHtml);
        });
    }

    renderContent() {
        // 确保容器存在
        if (!this.container) {
            Logger.log("[MessageProgressPanel] renderContent: 容器不存在，正在创建...");
            this.createDOM();
            this.bindEvents();
            this.loadPosition();
        }
        if (!this.container) return;

        const contentEl = this.container.querySelector(".mm-msg-panel-content");
        if (!contentEl) return;
        const tasksArray = Array.from(this.tasks.values());

        const fadingElements = Array.from(
            contentEl.querySelectorAll(".mm-msg-progress-item.mm-fading")
        );
        const fadingTaskIds = new Set(fadingElements.map((el) => el.dataset.taskId));

        const tasksToRender = tasksArray.filter((t) => !fadingTaskIds.has(t.id));

        if (tasksToRender.length === 0 && fadingElements.length === 0) {
            contentEl.innerHTML = '<div style="text-align:center;color:var(--mm-text-muted);padding:20px;">暂无任务</div>';
            return;
        }

        contentEl.querySelectorAll(".mm-msg-progress-item:not(.mm-fading)").forEach((el) => el.remove());
        const emptyHint = contentEl.querySelector('[style*="text-align:center"]');
        if (emptyHint) emptyHint.remove();

        const newHtml = tasksToRender.map((task) => {
            const statusClass = task.status === "success" ? "mm-success" : task.status === "error" ? "mm-error" : "";
            const progress = Math.round(task.progress || 0);

            if (!this.taskColors.has(task.id)) {
                this.taskColors.set(task.id, this.getRandomColor());
            }
            const color = this.taskColors.get(task.id);

            const div = document.createElement("div");
            div.textContent = task.name || task.id;
            const safeTaskName = div.innerHTML;

            return `
                <div class="mm-msg-progress-item ${statusClass}" data-task-id="${task.id}">
                    <div class="mm-msg-progress-header">
                        <span class="mm-msg-progress-name">${safeTaskName}</span>
                        <span class="mm-msg-progress-percent" style="color: ${color.main}">${progress}%</span>
                    </div>
                    <div class="mm-msg-progress-bar-wrapper">
                        <div class="mm-msg-progress-bar-fill mm-neon-bar" style="width: ${progress}%; background: linear-gradient(90deg, ${color.main}88, ${color.main}); box-shadow: 0 0 10px ${color.glow}, 0 0 20px ${color.glow};"></div>
                    </div>
                </div>
            `;
        }).join("");

        if (fadingElements.length > 0) {
            fadingElements[0].insertAdjacentHTML("beforebegin", newHtml);
        } else {
            contentEl.innerHTML = newHtml;
        }
    }

    updatePreview() {
        if (!this.container) return;
        const previewEl = this.container.querySelector(".mm-msg-panel-preview");
        if (!previewEl) return;
        const tasksArray = Array.from(this.tasks.values());

        const activeTask = tasksArray.find((t) => t.status === "running") || tasksArray[0];

        if (!activeTask) {
            previewEl.innerHTML = "";
            return;
        }

        const progress = Math.round(activeTask.progress || 0);

        if (!this.taskColors.has(activeTask.id)) {
            this.taskColors.set(activeTask.id, this.getRandomColor());
        }
        const color = this.taskColors.get(activeTask.id);

        const div = document.createElement("div");
        div.textContent = activeTask.name || activeTask.id;
        const safeTaskName = div.innerHTML;

        previewEl.innerHTML = `
            <div class="mm-msg-preview-item">
                <span class="mm-msg-preview-name">${safeTaskName}</span>
                <div class="mm-msg-preview-bar">
                    <div class="mm-msg-preview-bar-fill mm-neon-bar" style="width: ${progress}%; background: ${color.main}; box-shadow: 0 0 6px ${color.glow};"></div>
                </div>
                <span class="mm-msg-preview-percent" style="color: ${color.main}">${progress}%</span>
            </div>
        `;
    }

    updateTaskProgress(taskId, progress) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        if (task.status !== "retrying" && task.status !== "success" && task.status !== "error") {
            const currentProgress = task.progress || 0;
            if (progress <= currentProgress) return;
        }

        task.progress = progress;

        if (!this.taskColors.has(taskId)) {
            this.taskColors.set(taskId, this.getRandomColor());
        }
        const color = this.taskColors.get(taskId);

        if (!this.container) return;
        const itemEl = this.container.querySelector(`.mm-msg-progress-item[data-task-id="${taskId}"]`);
        if (itemEl) {
            const percentEl = itemEl.querySelector(".mm-msg-progress-percent");
            const fillEl = itemEl.querySelector(".mm-msg-progress-bar-fill");

            // 使用平滑动画插值更新进度条
            this.animateProgressTo(taskId, progress, percentEl, fillEl, color);
        }

        this.updatePreview();
    }

    /**
     * 平滑动画插值更新进度条
     * @param {string} taskId 任务ID
     * @param {number} targetProgress 目标进度值
     * @param {HTMLElement} percentEl 百分比显示元素
     * @param {HTMLElement} fillEl 进度条填充元素
     * @param {Object} color 颜色配置
     */
    animateProgressTo(taskId, targetProgress, percentEl, fillEl, color) {
        // 取消之前的动画
        if (this.animationFrames.has(taskId)) {
            cancelAnimationFrame(this.animationFrames.get(taskId));
        }

        // 获取当前显示的进度值
        const currentDisplay = this.displayProgress.get(taskId) || 0;

        // 如果差距很小，直接设置
        if (Math.abs(targetProgress - currentDisplay) < 0.5) {
            this.setProgressImmediate(taskId, targetProgress, percentEl, fillEl, color);
            return;
        }

        const startProgress = currentDisplay;
        const progressDiff = targetProgress - startProgress;
        const duration = Math.min(800, Math.max(300, Math.abs(progressDiff) * 15)); // 动态时长：300-800ms
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const t = Math.min(1, elapsed / duration);

            // 使用 easeOutExpo 缓动函数，让动画更加丝滑
            const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
            const currentProgress = startProgress + progressDiff * eased;

            // 更新显示
            this.displayProgress.set(taskId, currentProgress);

            if (percentEl) {
                percentEl.textContent = `${Math.round(currentProgress)}%`;
                percentEl.style.color = color.main;
            }
            if (fillEl) {
                fillEl.style.width = `${currentProgress}%`;
                fillEl.style.background = `linear-gradient(90deg, ${color.main}88, ${color.main})`;
                fillEl.style.boxShadow = `0 0 10px ${color.glow}, 0 0 20px ${color.glow}`;
            }

            if (t < 1) {
                const frameId = requestAnimationFrame(animate);
                this.animationFrames.set(taskId, frameId);
            } else {
                this.animationFrames.delete(taskId);
                this.displayProgress.set(taskId, targetProgress);
            }
        };

        const frameId = requestAnimationFrame(animate);
        this.animationFrames.set(taskId, frameId);
    }

    /**
     * 立即设置进度值（无动画）
     */
    setProgressImmediate(taskId, progress, percentEl, fillEl, color) {
        this.displayProgress.set(taskId, progress);
        if (percentEl) {
            percentEl.textContent = `${Math.round(progress)}%`;
            percentEl.style.color = color.main;
        }
        if (fillEl) {
            fillEl.style.width = `${progress}%`;
            fillEl.style.background = `linear-gradient(90deg, ${color.main}88, ${color.main})`;
            fillEl.style.boxShadow = `0 0 10px ${color.glow}, 0 0 20px ${color.glow}`;
        }
    }

    clear() {
        // 清除所有动画
        for (const frameId of this.animationFrames.values()) {
            cancelAnimationFrame(frameId);
        }
        this.animationFrames.clear();
        this.displayProgress.clear();
        this.tasks.clear();
        this.hide();
    }
}

// 全局消息进度面板实例
export let messageProgressPanel = null;

/**
 * 初始化消息进度面板
 * @returns {MessageProgressPanel}
 */
export function initMessageProgressPanel() {
    if (!messageProgressPanel) {
        messageProgressPanel = new MessageProgressPanel();
    }
    return messageProgressPanel;
}

/**
 * 获取消息进度面板实例
 * @returns {MessageProgressPanel|null}
 */
export function getMessageProgressPanel() {
    return messageProgressPanel;
}
