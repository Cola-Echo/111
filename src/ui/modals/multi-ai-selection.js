/**
 * 多AI选择弹窗模块
 * @module ui/modals/multi-ai-selection
 */

import Logger from '@core/logger';
import { getGlobalSettings } from '@config/config-manager';
import { getMultiAIGenerator, GenerationStatus, formatTokens } from '@api/multi-ai-generator';

const log = Logger.createModuleLogger('多AI选择');

/**
 * 显示多AI选择弹窗
 * @param {Array} providers 启用的provider列表
 * @param {Array} messages 默认消息列表
 * @param {object} presetContext 预设构建上下文（可选）
 * @param {string} presetContext.memory 记忆摘要
 * @param {string} presetContext.editorContent 剧情优化内容
 * @param {string} presetContext.userMessage 用户消息
 * @returns {Promise<{action: 'select'|'cancel', result?: object}>}
 */
export function showMultiAISelectionModal(providers, messages, presetContext = null) {
    return new Promise((resolve) => {
        const generator = getMultiAIGenerator();
        generator.reset();

        // 创建弹窗
        const modal = createModal(providers);
        document.body.appendChild(modal);

        // 获取设置
        const settings = getGlobalSettings();
        const theme = settings.theme || 'default';
        if (theme !== 'default') {
            modal.setAttribute('data-mm-theme', theme);
        }

        // 显示弹窗
        setTimeout(() => modal.classList.add('mm-modal-visible'), 10);

        // 计时器Map
        const timers = new Map();

        // 开始所有计时器
        providers.forEach(provider => {
            startTimer(provider.id);
        });

        // 开始生成（传递预设上下文）
        generator.generateAll(providers, messages, {
            onChunk: (providerId, chunk) => {
                appendContent(providerId, chunk);
            },
            onComplete: (providerId, result) => {
                stopTimer(providerId);
                setComplete(providerId, result);
            },
            onError: (providerId, error) => {
                stopTimer(providerId);
                setError(providerId, error);
            },
        }, presetContext);

        // 事件处理
        const handleClose = () => {
            cleanup();
            generator.abortAll();
            resolve({ action: 'cancel' });
        };

        const handleSelect = (providerId) => {
            const result = generator.getResult(providerId);
            if (result && result.status === GenerationStatus.SUCCESS) {
                cleanup();
                generator.abortAll();
                resolve({ action: 'select', result });
            }
        };

        const handleRegenerateSingle = (providerId) => {
            const provider = providers.find(p => p.id === providerId);
            if (!provider) return;

            resetCard(providerId);
            startTimer(providerId);

            generator.generateSingle(provider, messages, {
                onChunk: (id, chunk) => appendContent(id, chunk),
                onComplete: (id, result) => {
                    stopTimer(id);
                    setComplete(id, result);
                },
                onError: (id, error) => {
                    stopTimer(id);
                    setError(id, error);
                },
            }, presetContext);
        };

        const handleRegenerateAll = () => {
            generator.abortAll();
            providers.forEach(provider => {
                resetCard(provider.id);
                startTimer(provider.id);
            });

            generator.generateAll(providers, messages, {
                onChunk: (providerId, chunk) => appendContent(providerId, chunk),
                onComplete: (providerId, result) => {
                    stopTimer(providerId);
                    setComplete(providerId, result);
                },
                onError: (providerId, error) => {
                    stopTimer(providerId);
                    setError(providerId, error);
                },
            }, presetContext);
        };

        // 绑定事件
        modal.querySelector('.mm-modal-close')?.addEventListener('click', handleClose);
        modal.querySelector('#mm-multi-ai-cancel-all')?.addEventListener('click', handleClose);
        modal.querySelector('#mm-multi-ai-regenerate-all')?.addEventListener('click', handleRegenerateAll);

        // 绑定每个卡片的事件
        providers.forEach(provider => {
            const card = modal.querySelector(`#mm-multi-ai-card-${provider.id}`);
            if (card) {
                card.querySelector('.mm-multi-ai-select-btn')?.addEventListener('click', () => handleSelect(provider.id));
                card.querySelector('.mm-multi-ai-regenerate-btn')?.addEventListener('click', () => handleRegenerateSingle(provider.id));
            }
        });

        // 移动端标签页切换
        const tabs = modal.querySelectorAll('.mm-multi-ai-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetId = tab.dataset.providerId;
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                modal.querySelectorAll('.mm-multi-ai-card').forEach(card => {
                    card.style.display = card.id === `mm-multi-ai-card-${targetId}` ? 'flex' : 'none';
                });
            });
        });

        // 清理函数
        function cleanup() {
            timers.forEach((intervalId) => clearInterval(intervalId));
            timers.clear();
            modal.classList.remove('mm-modal-visible');
            setTimeout(() => {
                if (modal.parentNode) {
                    modal.parentNode.removeChild(modal);
                }
            }, 300);
        }

        // 计时器相关函数
        function startTimer(providerId) {
            const startTime = Date.now();
            const timerEl = modal.querySelector(`#mm-multi-ai-timer-${providerId}`);

            const intervalId = setInterval(() => {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                if (timerEl) {
                    timerEl.textContent = `${elapsed}s`;
                }
            }, 1000);

            timers.set(providerId, intervalId);
        }

        function stopTimer(providerId) {
            const intervalId = timers.get(providerId);
            if (intervalId) {
                clearInterval(intervalId);
                timers.delete(providerId);
            }
        }

        // 内容更新函数
        function appendContent(providerId, chunk) {
            const contentEl = modal.querySelector(`#mm-multi-ai-content-${providerId}`);
            if (contentEl) {
                // 移除加载状态
                const loader = contentEl.querySelector('.mm-multi-ai-loader');
                if (loader) {
                    loader.remove();
                }

                // 添加内容
                contentEl.classList.add('mm-streaming');
                const textEl = contentEl.querySelector('.mm-multi-ai-text') || (() => {
                    const el = document.createElement('div');
                    el.className = 'mm-multi-ai-text';
                    contentEl.appendChild(el);
                    return el;
                })();
                textEl.textContent += chunk;

                // 自动滚动到底部
                contentEl.scrollTop = contentEl.scrollHeight;
            }
        }

        function setComplete(providerId, result) {
            const card = modal.querySelector(`#mm-multi-ai-card-${providerId}`);
            if (!card) return;

            card.classList.remove('generating');
            card.classList.add('complete');

            const contentEl = card.querySelector('.mm-multi-ai-content');
            if (contentEl) {
                contentEl.classList.remove('mm-streaming');
            }

            // 显示 token 统计
            const tokensEl = card.querySelector('.mm-multi-ai-tokens');
            if (tokensEl && result.outputTokens) {
                tokensEl.textContent = `${formatTokens(result.outputTokens)}t`;
                tokensEl.style.display = '';
            }

            // 启用按钮
            const selectBtn = card.querySelector('.mm-multi-ai-select-btn');
            const regenerateBtn = card.querySelector('.mm-multi-ai-regenerate-btn');
            if (selectBtn) selectBtn.disabled = false;
            if (regenerateBtn) regenerateBtn.disabled = false;
        }

        function setError(providerId, error) {
            const card = modal.querySelector(`#mm-multi-ai-card-${providerId}`);
            if (!card) return;

            card.classList.remove('generating');
            card.classList.add('error');

            const contentEl = card.querySelector('.mm-multi-ai-content');
            if (contentEl) {
                contentEl.classList.remove('mm-streaming');
                contentEl.innerHTML = `
                    <div class="mm-multi-ai-error">
                        <i class="fa-solid fa-exclamation-circle"></i>
                        <span>生成失败</span>
                        <small>${error.message || error}</small>
                    </div>
                `;
            }

            // 只启用重新生成按钮
            const selectBtn = card.querySelector('.mm-multi-ai-select-btn');
            const regenerateBtn = card.querySelector('.mm-multi-ai-regenerate-btn');
            if (selectBtn) selectBtn.style.display = 'none';
            if (regenerateBtn) regenerateBtn.disabled = false;
        }

        function resetCard(providerId) {
            const card = modal.querySelector(`#mm-multi-ai-card-${providerId}`);
            if (!card) return;

            card.classList.remove('complete', 'error');
            card.classList.add('generating');

            const contentEl = card.querySelector('.mm-multi-ai-content');
            if (contentEl) {
                contentEl.innerHTML = `
                    <div class="mm-multi-ai-loader">
                        <div class="mm-loader-spinner"></div>
                        <span>生成中...</span>
                    </div>
                `;
            }

            const timerEl = card.querySelector('.mm-multi-ai-timer');
            if (timerEl) {
                timerEl.textContent = '0s';
            }

            // 隐藏 token 统计
            const tokensEl = card.querySelector('.mm-multi-ai-tokens');
            if (tokensEl) {
                tokensEl.style.display = 'none';
                tokensEl.textContent = '';
            }

            // 禁用按钮
            const selectBtn = card.querySelector('.mm-multi-ai-select-btn');
            const regenerateBtn = card.querySelector('.mm-multi-ai-regenerate-btn');
            if (selectBtn) {
                selectBtn.disabled = true;
                selectBtn.style.display = '';
            }
            if (regenerateBtn) regenerateBtn.disabled = true;
        }
    });
}

/**
 * 创建弹窗DOM
 * @param {Array} providers provider列表
 * @returns {HTMLElement}
 */
function createModal(providers) {
    const modal = document.createElement('div');
    modal.className = 'mm-modal mm-multi-ai-modal';
    modal.style.cssText = 'z-index: 999999; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;';

    const isMobile = window.innerWidth <= 768;

    modal.innerHTML = `
        <div class="mm-modal-content mm-modal-large mm-multi-ai-modal-content">
            <div class="mm-modal-header">
                <h4><i class="fa-solid fa-robot"></i> 选择AI回复</h4>
                <button class="mm-modal-close mm-btn mm-btn-icon">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>

            <div class="mm-modal-body">
                ${isMobile ? createMobileTabs(providers) : ''}

                <div class="mm-multi-ai-cards ${isMobile ? 'mm-mobile' : ''}">
                    ${providers.map((provider, index) => createCard(provider, isMobile && index > 0)).join('')}
                </div>

                ${!isMobile ? '<div class="mm-multi-ai-scroll-hint"><i class="fa-solid fa-arrows-left-right"></i> 左右滑动查看更多</div>' : ''}
            </div>

            <div class="mm-modal-footer">
                <button id="mm-multi-ai-cancel-all" class="mm-btn mm-btn-secondary">
                    <i class="fa-solid fa-xmark"></i> 全部取消
                </button>
                <button id="mm-multi-ai-regenerate-all" class="mm-btn mm-btn-secondary">
                    <i class="fa-solid fa-rotate"></i> 重新生成全部
                </button>
            </div>
        </div>
    `;

    return modal;
}

/**
 * 创建移动端标签页
 * @param {Array} providers
 * @returns {string}
 */
function createMobileTabs(providers) {
    return `
        <div class="mm-multi-ai-tabs">
            ${providers.map((provider, index) => `
                <button class="mm-multi-ai-tab ${index === 0 ? 'active' : ''}" data-provider-id="${provider.id}">
                    ${provider.name}
                </button>
            `).join('')}
        </div>
    `;
}

/**
 * 创建单个provider卡片
 * @param {object} provider
 * @param {boolean} hidden 是否隐藏（移动端非第一个）
 * @returns {string}
 */
function createCard(provider, hidden = false) {
    return `
        <div class="mm-multi-ai-card generating" id="mm-multi-ai-card-${provider.id}" style="${hidden ? 'display: none;' : ''}">
            <div class="mm-multi-ai-card-header">
                <div class="mm-multi-ai-info">
                    <span class="mm-multi-ai-name">${provider.name}</span>
                    <span class="mm-multi-ai-model">${provider.model}</span>
                </div>
                <div class="mm-multi-ai-stats">
                    <span class="mm-multi-ai-tokens" id="mm-multi-ai-tokens-${provider.id}" style="display: none;"></span>
                    <span class="mm-multi-ai-timer" id="mm-multi-ai-timer-${provider.id}">0s</span>
                </div>
            </div>

            <div class="mm-multi-ai-content" id="mm-multi-ai-content-${provider.id}">
                <div class="mm-multi-ai-loader">
                    <div class="mm-loader-spinner"></div>
                    <span>生成中...</span>
                </div>
            </div>

            <div class="mm-multi-ai-card-footer">
                <button class="mm-btn mm-btn-secondary mm-multi-ai-regenerate-btn" disabled>
                    <i class="fa-solid fa-rotate"></i> 重新生成
                </button>
                <button class="mm-btn mm-btn-primary mm-multi-ai-select-btn" disabled>
                    <i class="fa-solid fa-check"></i> 选择此回复
                </button>
            </div>
        </div>
    `;
}

export default { showMultiAISelectionModal };
