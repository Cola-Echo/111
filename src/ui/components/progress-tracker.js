// @ts-nocheck
/**
 * 进度追踪器模块
 * @module ui/components/progress-tracker
 */

import Logger from "@core/logger";

// 消息进度面板引用（将在初始化时注入）
/** @type {any} */
let messageProgressPanel = null;

/**
 * 设置消息进度面板引用
 * @param {any} panel 消息进度面板实例
 */
export function setMessageProgressPanel(panel) {
    messageProgressPanel = panel;
}

/**
 * 进度追踪器类
 */
export class ProgressTracker {
    constructor() {
        this.tasks = new Map();
        this.startTime = null;
        this.completedCount = 0;
        this.totalCount = 0;
        this.progressIntervals = new Map();
        this.taskAbortControllers = new Map();
    }

    init(taskList) {
        this.tasks.clear();
        this.clearAllIntervals();
        this.startTime = Date.now();
        this.completedCount = 0;
        this.totalCount = taskList.length;

        taskList.forEach((task, index) => {
            this.tasks.set(task.id, {
                id: task.id,
                name: task.name,
                type: task.type,
                status: "pending",
                retryCount: 0,
                startTime: null,
                endTime: null,
                error: null,
                progress: 0,
            });
        });

        this.renderProgressUI();
        this.showProgressUI(true);

        if (messageProgressPanel) {
            messageProgressPanel.init();
            const activeTasks = new Map();
            for (const [id, task] of this.tasks) {
                if (task.status !== "success" && task.status !== "error") {
                    activeTasks.set(id, task);
                }
            }
            messageProgressPanel.updateTasks(activeTasks);
            messageProgressPanel.show();
        }
    }

    clearAllIntervals() {
        for (const [key, timer] of this.progressIntervals.entries()) {
            if (key.endsWith("_delay")) {
                clearTimeout(timer);
            } else {
                clearInterval(timer);
            }
        }
        this.progressIntervals.clear();
    }

    updateProgressBar(taskId, progress) {
        const progressBar = document.querySelector(
            `.mm-progress-item[data-task-id="${taskId}"] .mm-progress-bar`,
        );
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }

        const task = this.tasks.get(taskId);
        if (task && task.startTime) {
            const elapsed = (Date.now() - task.startTime) / 1000;
            const timeSpan = document.querySelector(
                `.mm-progress-item[data-task-id="${taskId}"] .time`,
            );
            if (timeSpan) {
                timeSpan.textContent = `${elapsed.toFixed(1)}s`;
            }
        }
    }

    updateStreamProgress(taskId, progress) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        task.hasStreamData = true;
        const currentProgress = task.progress || 0;

        if (progress <= currentProgress) return;
        if (progress - currentProgress < 0.5) return;

        task.progress = progress;
        this.updateProgressBar(taskId, progress);

        if (messageProgressPanel) {
            messageProgressPanel.updateTaskProgress(taskId, progress);
        }
    }

    updateTask(taskId, updates) {
        const task = this.tasks.get(taskId);
        if (task) {
            Object.assign(task, updates);
            if (updates.status === "success" || updates.status === "error") {
                task.endTime = Date.now();
                task.progress = 100;
                this.completedCount++;

                if (this.progressIntervals.has(taskId)) {
                    clearInterval(this.progressIntervals.get(taskId));
                    this.progressIntervals.delete(taskId);
                }
            }
            this.renderProgressUI();

            if (messageProgressPanel) {
                const activeTasks = new Map();
                for (const [id, t] of this.tasks) {
                    if (t.status !== "success" && t.status !== "error") {
                        activeTasks.set(id, t);
                    }
                }
                if (
                    updates.status === "success" ||
                    updates.status === "error"
                ) {
                    activeTasks.set(taskId, task);
                }
                messageProgressPanel.updateTasks(activeTasks);
            }
        }
    }

    startTask(taskId) {
        this.updateTask(taskId, {
            status: "running",
            startTime: Date.now(),
        });
    }

    retryTask(taskId, retryCount) {
        const task = this.tasks.get(taskId);
        if (task) {
            task.progress = 0;
        }
        this.updateTask(taskId, {
            status: "retrying",
            retryCount,
        });
    }

    completeTask(taskId, success, error = null) {
        this.updateTask(taskId, {
            status: success ? "success" : "error",
            error,
        });
    }

    addTask(taskId, name, type = "memory") {
        Logger.info(
            "[ProgressTracker] ===== addTask 被调用 =====",
            taskId,
            name,
            type,
        );
        Logger.log("[ProgressTracker] addTask 被调用:", taskId, name, type);

        // 先确保 messageProgressPanel 容器已创建（在添加任务数据之前）
        if (messageProgressPanel && !messageProgressPanel.container) {
            Logger.log("[ProgressTracker] 预先初始化 messageProgressPanel 容器");
            messageProgressPanel.createDOM();
            messageProgressPanel.bindEvents();
            messageProgressPanel.loadPosition();
        }

        if (this.tasks.has(taskId)) {
            const task = this.tasks.get(taskId);
            task.status = "running";
            task.progress = 0;
            task.startTime = Date.now();
            task.endTime = null;
            task.error = null;
        } else {
            this.tasks.set(taskId, {
                id: taskId,
                name: name,
                type: type,
                status: "running",
                retryCount: 0,
                startTime: Date.now(),
                endTime: null,
                error: null,
                progress: 0,
            });
            this.totalCount++;
        }

        Logger.log("[ProgressTracker] 调用 renderProgressUI 和 showProgressUI");
        this.renderProgressUI();
        this.showProgressUI(true);

        Logger.log(
            "[ProgressTracker] messageProgressPanel 状态:",
            !!messageProgressPanel,
        );
        if (messageProgressPanel) {
            const activeTasks = new Map();
            for (const [id, task] of this.tasks) {
                if (task.status !== "success" && task.status !== "error") {
                    activeTasks.set(id, task);
                }
            }
            Logger.log("[ProgressTracker] 活跃任务数:", activeTasks.size);
            messageProgressPanel.updateTasks(activeTasks);
            messageProgressPanel.show();
        } else {
            Logger.warn("[ProgressTracker] messageProgressPanel 未设置");
        }
    }

    stopTask(taskId) {
        const controller = this.taskAbortControllers.get(taskId);
        if (controller) {
            controller.abort();
            Logger.warn(`任务 "${taskId}" 已被终止`);
        }

        if (this.progressIntervals.has(taskId)) {
            clearInterval(this.progressIntervals.get(taskId));
            this.progressIntervals.delete(taskId);
        }

        this.updateTask(taskId, {
            status: "error",
            error: "已终止",
        });
    }

    setTaskAbortController(taskId, controller) {
        this.taskAbortControllers.set(taskId, controller);
    }

    renderProgressUI() {
        const progressList = document.getElementById("mm-progress-list");
        const progressCount = document.getElementById("mm-progress-count");
        const statusText = document.getElementById("mm-status-text");
        const statusIndicator = document.getElementById("mm-status-indicator");

        // 即使progressList不存在，也继续更新其他状态元素
        if (progressCount) {
            progressCount.textContent = `${this.completedCount}/${this.totalCount}`;
        }

        if (statusText) {
            const runningTasks = Array.from(this.tasks.values()).filter(
                (t) => t.status === "running" || t.status === "retrying",
            );
            if (runningTasks.length > 0) {
                statusText.textContent = `处理中 (${runningTasks.length} 个任务)`;
            } else if (this.completedCount === this.totalCount) {
                const successCount = Array.from(this.tasks.values()).filter(
                    (t) => t.status === "success",
                ).length;
                statusText.textContent = `完成 (${successCount}/${this.totalCount} 成功)`;
            }
        }

        if (statusIndicator) {
            statusIndicator.className = "mm-status-indicator";
            if (this.completedCount < this.totalCount) {
                statusIndicator.classList.add("mm-status-processing");
            } else {
                const hasError = Array.from(this.tasks.values()).some(
                    (t) => t.status === "error",
                );
                statusIndicator.classList.add(
                    hasError ? "mm-status-error" : "mm-status-ready",
                );
            }
        }

        // 只有当progressList存在时，才渲染进度条
        if (progressList) {
            let html = "";
            for (const task of this.tasks.values()) {
                const statusClass = `mm-progress-${task.status}`;
                const statusLabel = this.getStatusText(task.status);
                const progress = task.progress || 0;
                const elapsed = task.startTime
                    ? ((task.endTime || Date.now()) - task.startTime) / 1000
                    : 0;

                let typeIcon = "fa-brain";
                if (task.type === "summary") {
                    typeIcon = "fa-scroll";
                } else if (task.type === "plot") {
                    typeIcon = "fa-wand-magic-sparkles";
                }

                const isRunning =
                    task.status === "running" || task.status === "retrying";
                const barClass =
                    task.status === "success"
                        ? "success"
                        : task.status === "error"
                          ? "error"
                          : task.status === "retrying"
                            ? "retrying"
                            : "";

                html += `
                    <div class="mm-progress-item ${statusClass}" data-task-id="${task.id}">
                        <div class="mm-progress-header">
                            <span class="mm-progress-name">
                                <i class="fa-solid ${typeIcon}"></i> ${task.name}
                            </span>
                            <div class="mm-progress-actions">
                                ${
                                    isRunning
                                        ? `<button class="mm-btn-stop-task" data-task-id="${task.id}" title="终止此任务"><i class="fa-solid fa-xmark"></i></button>`
                                        : ""
                                }
                                <span class="mm-progress-status ${task.status}">${statusLabel}</span>
                            </div>
                        </div>
                        <div class="mm-progress-bar-container">
                            <div class="mm-progress-bar ${barClass}" style="width: ${progress}%"></div>
                        </div>
                        <div class="mm-progress-detail">
                            ${
                                task.retryCount > 0
                                    ? `<span class="retry-count"><i class="fa-solid fa-rotate"></i> 重试 ${task.retryCount}/3</span>`
                                    : ""
                            }
                            ${
                                task.error
                                    ? `<span class="error-msg">${task.error}</span>`
                                    : ""
                            }
                            <span class="time">${elapsed > 0 ? elapsed.toFixed(1) + "s" : ""}</span>
                        </div>
                    </div>`;
            }

            progressList.innerHTML = html;

            progressList
                .querySelectorAll(".mm-btn-stop-task")
                .forEach((btn) => {
                    btn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        const taskId = btn.dataset.taskId;
                        this.stopTask(taskId);
                    });
                });
        }
    }

    getStatusText(status) {
        const statusMap = {
            pending: "等待中",
            running: "处理中",
            retrying: "重试中",
            success: "完成",
            error: "失败",
        };
        return statusMap[status] || status;
    }

    showProgressUI(show) {
        const progressList = document.getElementById("mm-progress-list");
        const statusSummary = document.getElementById("mm-status-summary");
        const stopBtn = document.getElementById("mm-stop-btn");
        const statusPanel = document.getElementById("mm-status-panel");

        // 确保每个元素都存在才操作
        if (progressList) progressList.classList.toggle("mm-hidden", !show);
        if (statusSummary) statusSummary.classList.toggle("mm-hidden", !show);
        if (stopBtn) stopBtn.classList.toggle("mm-hidden", !show);
        if (statusPanel) statusPanel.classList.toggle("processing", show);
    }

    finish() {
        this.clearAllIntervals();

        const stopBtn = document.getElementById("mm-stop-btn");
        if (stopBtn) stopBtn.classList.add("mm-hidden");

        const totalTime = (Date.now() - this.startTime) / 1000;
        const processTimeEl = document.getElementById("mm-process-time");
        const lastProcessEl = document.getElementById("mm-last-process");

        if (processTimeEl)
            processTimeEl.textContent = `${totalTime.toFixed(1)}s`;
        if (lastProcessEl)
            lastProcessEl.textContent = new Date().toLocaleTimeString();

        setTimeout(() => {
            const progressList = document.getElementById("mm-progress-list");
            const statusSummary = document.getElementById("mm-status-summary");
            const statusPanel = document.getElementById("mm-status-panel");
            const statusText = document.getElementById("mm-status-text");
            const statusIndicator = document.getElementById(
                "mm-status-indicator",
            );

            if (progressList) progressList.classList.add("mm-hidden");
            if (statusSummary) statusSummary.classList.add("mm-hidden");
            if (statusPanel) statusPanel.classList.remove("processing");
            if (statusText) statusText.textContent = "就绪";
            if (statusIndicator) {
                statusIndicator.className =
                    "mm-status-indicator mm-status-ready";
            }
        }, 5000);
    }

    reset() {
        this.clearAllIntervals();
        this.tasks.clear();
        this.taskAbortControllers.clear();
        this.startTime = null;
        this.completedCount = 0;
        this.totalCount = 0;
        this.showProgressUI(false);
    }
}

// 全局进度追踪器实例
export let progressTracker = null;

/**
 * 初始化进度追踪器
 * @returns {ProgressTracker}
 */
export function initProgressTracker() {
    if (!progressTracker) {
        progressTracker = new ProgressTracker();
    }
    return progressTracker;
}

/**
 * 获取进度追踪器实例
 * @returns {ProgressTracker|null}
 */
export function getProgressTracker() {
    return progressTracker;
}
