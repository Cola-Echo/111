/**
 * 调试弹窗模块
 * 用于检查并发填表的提示词和结果
 * @module table-filler/debug-modal
 */

import { getGlobalSettings } from "@config/config-manager";

/**
 * 获取当前主题
 * @returns {string|null}
 */
function getCurrentTheme() {
    try {
        const settings = getGlobalSettings();
        return settings?.theme || null;
    } catch {
        return null;
    }
}

/**
 * 获取主题对应的颜色方案
 * @param {string} theme
 * @returns {Object}
 */
function getThemeColors(theme) {
    const themes = {
        'default': {
            bg: '#1a1a2e',
            headerBg: '#2a2a4e',
            bodyBg: '#0a0a1e',
            border: '#333',
            text: '#fff',
            textMuted: '#a0a0a0',
            primary: '#4a90d9',
            success: '#4CAF50',
        },
        'warm-brown': {
            bg: '#2a2520',
            headerBg: '#3a3530',
            bodyBg: '#1a1510',
            border: '#4a4540',
            text: '#e4dcd0',
            textMuted: '#a09080',
            primary: '#a08070',
            success: '#6a9a6a',
        },
        'lavender': {
            bg: '#1e1a24',
            headerBg: '#2e2a34',
            bodyBg: '#0e0a14',
            border: '#3a3644',
            text: '#e4e0ea',
            textMuted: '#9b8aa8',
            primary: '#9b8aa8',
            success: '#7aa87a',
        },
        'forest': {
            bg: '#1a2420',
            headerBg: '#2a3430',
            bodyBg: '#0a1410',
            border: '#3a4a40',
            text: '#e0e8e4',
            textMuted: '#6a9a7a',
            primary: '#6a9a7a',
            success: '#5a8a6a',
        },
        'rose': {
            bg: '#241a1c',
            headerBg: '#342a2c',
            bodyBg: '#140a0c',
            border: '#443a3c',
            text: '#e8e0e2',
            textMuted: '#b08a90',
            primary: '#b08a90',
            success: '#8aaa8a',
        },
        'slate': {
            bg: '#1a1e22',
            headerBg: '#2a2e32',
            bodyBg: '#0a0e12',
            border: '#3a3e42',
            text: '#e4e8ec',
            textMuted: '#7a8a98',
            primary: '#7a8a98',
            success: '#6a9a7a',
        },
        'starry-purple': {
            bg: 'rgba(26, 21, 37, 0.95)',
            headerBg: 'rgba(42, 26, 64, 0.95)',
            bodyBg: 'rgba(13, 10, 20, 0.95)',
            border: 'rgba(138, 100, 200, 0.3)',
            text: '#e4dcea',
            textMuted: '#9d7cd8',
            primary: '#9d7cd8',
            success: '#7ac87a',
        },
        'starry-blue': {
            bg: 'rgba(16, 24, 40, 0.95)',
            headerBg: 'rgba(16, 32, 64, 0.95)',
            bodyBg: 'rgba(8, 12, 20, 0.95)',
            border: 'rgba(100, 150, 220, 0.3)',
            text: '#e4ecf4',
            textMuted: '#5d8fca',
            primary: '#5d8fca',
            success: '#6aaa7a',
        },
        'starry-black': {
            bg: 'rgba(12, 12, 16, 0.95)',
            headerBg: 'rgba(26, 26, 30, 0.95)',
            bodyBg: 'rgba(10, 10, 12, 0.95)',
            border: 'rgba(255, 255, 255, 0.15)',
            text: '#e8e8ec',
            textMuted: '#707078',
            primary: '#606068',
            success: '#5a8a6a',
        },
    };
    return themes[theme] || themes['default'];
}

/**
 * 显示发送前的调试弹窗
 * @param {Array} tablePrompts 每个表格的提示词 [{tableName, messages}]
 * @returns {Promise<boolean>} 用户是否确认继续
 */
export function showPreSendDebugModal(tablePrompts) {
    return new Promise((resolve) => {
        const theme = getCurrentTheme() || 'default';
        const colors = getThemeColors(theme);

        // 创建弹窗容器
        const overlay = document.createElement('div');
        overlay.id = 'mm-debug-modal-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            z-index: 99999;
            display: flex;
            justify-content: center;
            align-items: center;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: ${colors.bg};
            border: 1px solid ${colors.border};
            border-radius: 8px;
            width: 90%;
            max-width: 1200px;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            color: ${colors.text};
        `;

        // 应用主题属性
        if (theme !== 'default') {
            modal.setAttribute('data-mm-theme', theme);
        }

        // 标题栏
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 16px 20px;
            border-bottom: 1px solid ${colors.border};
            font-size: 18px;
            font-weight: bold;
        `;
        header.textContent = `📋 发送前检查 - ${tablePrompts.length} 个表格的提示词`;

        // 内容区域
        const content = document.createElement('div');
        content.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        `;

        // 为每个表格创建折叠面板
        tablePrompts.forEach((item, index) => {
            const panel = createCollapsiblePanel(
                `${index + 1}. ${item.tableName}`,
                formatMessages(item.messages),
                false, // 默认折叠
                colors
            );
            content.appendChild(panel);
        });

        // 按钮区域
        const footer = document.createElement('div');
        footer.style.cssText = `
            padding: 16px 20px;
            border-top: 1px solid ${colors.border};
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        `;

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消发送';
        cancelBtn.style.cssText = `
            padding: 10px 24px;
            border: 1px solid ${colors.textMuted};
            background: transparent;
            color: ${colors.text};
            border-radius: 4px;
            cursor: pointer;
        `;
        cancelBtn.onclick = () => {
            overlay.remove();
            resolve(false);
        };

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = '确认发送';
        confirmBtn.style.cssText = `
            padding: 10px 24px;
            border: none;
            background: ${colors.success};
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
        `;
        confirmBtn.onclick = () => {
            overlay.remove();
            resolve(true);
        };

        footer.appendChild(cancelBtn);
        footer.appendChild(confirmBtn);

        modal.appendChild(header);
        modal.appendChild(content);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    });
}

/**
 * 显示合并结果的调试弹窗
 * @param {Array} results 每个表格的结果 [{tableName, response, success}]
 * @param {string} mergedContent 合并后的内容
 * @returns {Promise<boolean>} 用户是否确认继续
 */
export function showPostMergeDebugModal(results, mergedContent) {
    return new Promise((resolve) => {
        const theme = getCurrentTheme() || 'default';
        const colors = getThemeColors(theme);

        const overlay = document.createElement('div');
        overlay.id = 'mm-debug-modal-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            z-index: 99999;
            display: flex;
            justify-content: center;
            align-items: center;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: ${colors.bg};
            border: 1px solid ${colors.border};
            border-radius: 8px;
            width: 90%;
            max-width: 1200px;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            color: ${colors.text};
        `;

        // 应用主题属性
        if (theme !== 'default') {
            modal.setAttribute('data-mm-theme', theme);
        }

        // 标题栏
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 16px 20px;
            border-bottom: 1px solid ${colors.border};
            font-size: 18px;
            font-weight: bold;
        `;
        const successCount = results.filter(r => r.success).length;
        header.textContent = `📥 合并结果检查 - ${successCount}/${results.length} 成功`;

        // 内容区域
        const content = document.createElement('div');
        content.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        `;

        // 每个表格的原始响应
        results.forEach((item, index) => {
            const statusIcon = item.success ? '✅' : '❌';
            const panel = createCollapsiblePanel(
                `${statusIcon} ${index + 1}. ${item.tableName}`,
                item.response || '(无响应)',
                false,
                colors
            );
            content.appendChild(panel);
        });

        // 合并后的最终内容
        const mergedPanel = createCollapsiblePanel(
            '📦 合并后的最终内容（将返回给 Amily）',
            mergedContent,
            true, // 默认展开
            colors
        );
        mergedPanel.style.marginTop = '20px';
        mergedPanel.style.borderColor = colors.success;
        content.appendChild(mergedPanel);

        // 按钮区域
        const footer = document.createElement('div');
        footer.style.cssText = `
            padding: 16px 20px;
            border-top: 1px solid ${colors.border};
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        `;

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消（回退原始请求）';
        cancelBtn.style.cssText = `
            padding: 10px 24px;
            border: 1px solid ${colors.textMuted};
            background: transparent;
            color: ${colors.text};
            border-radius: 4px;
            cursor: pointer;
        `;
        cancelBtn.onclick = () => {
            overlay.remove();
            resolve(false);
        };

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = '确认返回给 Amily';
        confirmBtn.style.cssText = `
            padding: 10px 24px;
            border: none;
            background: ${colors.success};
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
        `;
        confirmBtn.onclick = () => {
            overlay.remove();
            resolve(true);
        };

        footer.appendChild(cancelBtn);
        footer.appendChild(confirmBtn);

        modal.appendChild(header);
        modal.appendChild(content);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    });
}

/**
 * 创建可折叠面板
 * @param {string} title 标题
 * @param {string} content 内容
 * @param {boolean} expanded 是否默认展开
 * @param {Object} colors 颜色方案
 */
function createCollapsiblePanel(title, content, expanded = false, colors = null) {
    // 如果没有传入颜色，使用默认主题
    if (!colors) {
        const theme = getCurrentTheme() || 'default';
        colors = getThemeColors(theme);
    }

    const panel = document.createElement('div');
    panel.style.cssText = `
        border: 1px solid ${colors.border};
        border-radius: 4px;
        margin-bottom: 8px;
        overflow: hidden;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        padding: 12px 16px;
        background: ${colors.headerBg};
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        user-select: none;
    `;

    const titleSpan = document.createElement('span');
    titleSpan.textContent = title;

    const arrow = document.createElement('span');
    arrow.textContent = expanded ? '▼' : '▶';
    arrow.style.transition = 'transform 0.2s';

    header.appendChild(titleSpan);
    header.appendChild(arrow);

    const body = document.createElement('div');
    body.style.cssText = `
        padding: 12px 16px;
        background: ${colors.bodyBg};
        white-space: pre-wrap;
        word-break: break-all;
        font-family: monospace;
        font-size: 12px;
        max-height: 400px;
        overflow-y: auto;
        display: ${expanded ? 'block' : 'none'};
        color: ${colors.text};
    `;
    body.textContent = content;

    header.onclick = () => {
        const isExpanded = body.style.display !== 'none';
        body.style.display = isExpanded ? 'none' : 'block';
        arrow.textContent = isExpanded ? '▶' : '▼';
    };

    panel.appendChild(header);
    panel.appendChild(body);
    return panel;
}

/**
 * 格式化 messages 数组为可读文本
 */
function formatMessages(messages) {
    if (!messages || !Array.isArray(messages)) {
        return '(无消息)';
    }

    return messages.map((msg, i) => {
        const role = msg.role || 'unknown';
        const content = msg.content || '(空)';
        // 不再截断，显示完整内容
        return `=== [${i}] ${role.toUpperCase()} ===\n${content}`;
    }).join('\n\n');
}

/**
 * 显示失败重试横幅（右下角通知样式，类似Win10通知）
 * @param {Array} failedTables 失败的表格列表 [{tableName, error, retryAttempts}]
 * @param {Function} onRetry 重试回调
 * @param {Function} onGiveUp 放弃回调
 * @returns {HTMLElement} 横幅元素（用于外部控制移除）
 */
export function showRetryBanner(failedTables, onRetry, onGiveUp) {
    // 移除已存在的横幅
    const existingBanner = document.getElementById('mm-retry-banner');
    if (existingBanner) {
        existingBanner.remove();
    }

    // 添加动画和响应式样式
    if (!document.getElementById('mm-banner-styles')) {
        const style = document.createElement('style');
        style.id = 'mm-banner-styles';
        style.textContent = `
            @keyframes mm-banner-slide-in {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes mm-banner-slide-out {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
            @keyframes mm-twinkle {
                0%, 100% { opacity: 0.3; }
                50% { opacity: 1; }
            }
            #mm-retry-banner {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 300px;
                max-width: calc(100vw - 40px);
                background: rgba(15, 52, 96, 0.75);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-left: 3px solid #dc3545;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                z-index: 99998;
                animation: mm-banner-slide-in 0.3s ease-out;
                overflow: hidden;
            }
            /* 暖灰棕主题 */
            #mm-retry-banner[data-mm-theme="warm-brown"] {
                background: rgba(61, 53, 46, 0.75);
                border-color: rgba(255, 255, 255, 0.1);
            }
            /* 淡紫薰衣草主题 */
            #mm-retry-banner[data-mm-theme="lavender"] {
                background: rgba(45, 40, 56, 0.75);
                border-color: rgba(255, 255, 255, 0.1);
            }
            /* 森林绿主题 */
            #mm-retry-banner[data-mm-theme="forest"] {
                background: rgba(37, 53, 48, 0.75);
                border-color: rgba(255, 255, 255, 0.1);
            }
            /* 玫瑰灰主题 */
            #mm-retry-banner[data-mm-theme="rose"] {
                background: rgba(56, 40, 48, 0.75);
                border-color: rgba(255, 255, 255, 0.1);
            }
            /* 静谧蓝灰主题 */
            #mm-retry-banner[data-mm-theme="slate"] {
                background: rgba(40, 46, 53, 0.75);
                border-color: rgba(255, 255, 255, 0.1);
            }
            /* 星空紫主题 */
            #mm-retry-banner[data-mm-theme="starry-purple"] {
                background:
                    radial-gradient(1px 1px at 20px 30px, rgba(255,255,255,0.8), transparent),
                    radial-gradient(1px 1px at 40px 70px, rgba(255,255,255,0.6), transparent),
                    radial-gradient(1px 1px at 50px 160px, rgba(255,255,255,0.7), transparent),
                    radial-gradient(1.5px 1.5px at 100px 40px, rgba(255,255,255,0.9), transparent),
                    radial-gradient(1px 1px at 130px 80px, rgba(255,255,255,0.5), transparent),
                    radial-gradient(1.5px 1.5px at 160px 120px, rgba(255,255,255,0.8), transparent),
                    radial-gradient(1px 1px at 200px 50px, rgba(255,255,255,0.6), transparent),
                    radial-gradient(1px 1px at 250px 90px, rgba(255,255,255,0.7), transparent),
                    radial-gradient(1.5px 1.5px at 280px 140px, rgba(255,255,255,0.5), transparent),
                    rgba(26, 21, 37, 0.7);
                border-color: rgba(138, 100, 200, 0.3);
            }
            /* 星空蓝主题 */
            #mm-retry-banner[data-mm-theme="starry-blue"] {
                background:
                    radial-gradient(1px 1px at 15px 25px, rgba(255,255,255,0.8), transparent),
                    radial-gradient(1.5px 1.5px at 45px 65px, rgba(200,220,255,0.9), transparent),
                    radial-gradient(1px 1px at 75px 150px, rgba(255,255,255,0.6), transparent),
                    radial-gradient(1px 1px at 110px 35px, rgba(200,220,255,0.7), transparent),
                    radial-gradient(1.5px 1.5px at 140px 95px, rgba(255,255,255,0.8), transparent),
                    radial-gradient(1px 1px at 180px 55px, rgba(200,220,255,0.5), transparent),
                    radial-gradient(1px 1px at 220px 110px, rgba(255,255,255,0.7), transparent),
                    radial-gradient(1.5px 1.5px at 260px 70px, rgba(200,220,255,0.6), transparent),
                    radial-gradient(1px 1px at 290px 130px, rgba(255,255,255,0.5), transparent),
                    rgba(16, 24, 40, 0.7);
                border-color: rgba(100, 150, 220, 0.3);
            }
            /* 星空黑主题 */
            #mm-retry-banner[data-mm-theme="starry-black"] {
                background:
                    radial-gradient(1px 1px at 10px 20px, rgba(255,255,255,0.9), transparent),
                    radial-gradient(1.5px 1.5px at 35px 75px, rgba(255,255,255,0.7), transparent),
                    radial-gradient(1px 1px at 60px 140px, rgba(255,255,255,0.8), transparent),
                    radial-gradient(1px 1px at 95px 30px, rgba(255,255,255,0.6), transparent),
                    radial-gradient(1.5px 1.5px at 125px 100px, rgba(255,255,255,0.9), transparent),
                    radial-gradient(1px 1px at 165px 60px, rgba(255,255,255,0.5), transparent),
                    radial-gradient(1px 1px at 195px 120px, rgba(255,255,255,0.7), transparent),
                    radial-gradient(1.5px 1.5px at 235px 45px, rgba(255,255,255,0.6), transparent),
                    radial-gradient(1px 1px at 275px 85px, rgba(255,255,255,0.8), transparent),
                    rgba(12, 12, 16, 0.75);
                border-color: rgba(255, 255, 255, 0.15);
            }
            #mm-retry-banner .mm-banner-content {
                padding: 12px 14px;
            }
            #mm-retry-banner .mm-banner-header {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 10px;
            }
            #mm-retry-banner .mm-banner-icon {
                color: #dc3545;
                font-size: 16px;
                flex-shrink: 0;
            }
            #mm-retry-banner .mm-banner-title {
                color: #e4e4e4;
                font-weight: 600;
                font-size: 13px;
                flex: 1;
            }
            #mm-retry-banner .mm-banner-actions {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
            }
            #mm-retry-banner .mm-banner-btn {
                padding: 6px 14px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s ease;
            }
            #mm-retry-banner .mm-banner-btn-secondary {
                border: 1px solid rgba(255, 255, 255, 0.2);
                background: rgba(255, 255, 255, 0.08);
                color: #a0a0a0;
            }
            #mm-retry-banner .mm-banner-btn-secondary:hover {
                border-color: rgba(255, 255, 255, 0.3);
                color: #e4e4e4;
                background: rgba(255, 255, 255, 0.12);
            }
            #mm-retry-banner .mm-banner-btn-primary {
                border: none;
                background: #4a90d9;
                color: #fff;
                font-weight: 500;
            }
            #mm-retry-banner .mm-banner-btn-primary:hover {
                background: #3a7bc8;
            }
            #mm-retry-banner .mm-banner-btn:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
            /* 移动端适配 */
            @media (max-width: 400px) {
                #mm-retry-banner {
                    bottom: 10px;
                    right: 10px;
                    width: calc(100vw - 20px);
                }
                #mm-retry-banner .mm-banner-content {
                    padding: 10px 12px;
                }
                #mm-retry-banner .mm-banner-btn {
                    padding: 5px 12px;
                    font-size: 11px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    const banner = document.createElement('div');
    banner.id = 'mm-retry-banner';

    // 应用当前主题
    const theme = getCurrentTheme();
    if (theme && theme !== 'default') {
        banner.setAttribute('data-mm-theme', theme);
    }

    const content = document.createElement('div');
    content.className = 'mm-banner-content';

    // 标题行
    const header = document.createElement('div');
    header.className = 'mm-banner-header';

    const icon = document.createElement('span');
    icon.className = 'mm-banner-icon';
    icon.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i>';

    const title = document.createElement('span');
    title.className = 'mm-banner-title';
    title.textContent = `${failedTables.length} 个表格填充失败`;

    header.appendChild(icon);
    header.appendChild(title);

    // 按钮行
    const actions = document.createElement('div');
    actions.className = 'mm-banner-actions';

    const giveUpBtn = document.createElement('button');
    giveUpBtn.className = 'mm-banner-btn mm-banner-btn-secondary';
    giveUpBtn.textContent = '放弃';
    giveUpBtn.onclick = () => {
        banner.remove();
        onGiveUp();
    };

    const retryBtn = document.createElement('button');
    retryBtn.className = 'mm-banner-btn mm-banner-btn-primary';
    retryBtn.textContent = '重试';
    retryBtn.onclick = () => {
        retryBtn.disabled = true;
        retryBtn.textContent = '重试中...';
        giveUpBtn.disabled = true;
        onRetry();
    };

    actions.appendChild(giveUpBtn);
    actions.appendChild(retryBtn);

    content.appendChild(header);
    content.appendChild(actions);
    banner.appendChild(content);
    document.body.appendChild(banner);

    return banner;
}

/**
 * 更新重试横幅状态
 * @param {Array} failedTables 失败的表格列表
 */
export function updateRetryBanner(failedTables) {
    const banner = document.getElementById('mm-retry-banner');
    if (!banner) return;

    const title = banner.querySelector('.mm-banner-title');
    if (title) {
        title.textContent = `${failedTables.length} 个表格填充失败`;
    }
}

/**
 * 移除重试横幅
 */
export function removeRetryBanner() {
    const banner = document.getElementById('mm-retry-banner');
    if (banner) {
        banner.style.animation = 'mm-banner-slide-out 0.3s ease-out forwards';
        setTimeout(() => banner.remove(), 280);
    }
}

/**
 * 显示重试进度提示
 * @param {string} tableName 表格名称
 * @param {number} attempt 当前尝试次数
 * @param {number} maxRetry 最大重试次数
 */
export function showRetryProgress(tableName, attempt, maxRetry) {
    // 使用 toastr 显示（如果可用）
    if (window.toastr) {
        window.toastr.info(
            `正在重试 ${tableName}（${attempt}/${maxRetry}）...`,
            "并发填表",
            { timeOut: 2000 }
        );
    }
}
