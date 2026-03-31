/**
 * RMA 悬浮面板
 * 三态面板：展开 / 半折叠 / 最小化
 * @module rma/float-panel
 */

import Logger from '@core/logger';
import { getExtensionPath } from '@core/constants';
import { getCurrentRmaConfig, getPhaseDefinitions, getSecrets } from './config-loader';
import { getRmaState, getPhase, getRelevantMemories, getUnresolvedThreads, getStoryState, getCurrentTexture } from './memory-store';
import { getPhaseIndex } from './phase-manager';
import { setOnAnalysisCompleteCallback, getPendingAnalysis } from './response-hook';
import { renderPendingConfirmation, bindConfirmationEvents, setOnConfirmCompleteCallback, needsConfirmation } from './confirmation-ui';
import { renderTimeline, bindTimelineEvents } from './timeline-view';
import { getRmaConfig } from './index';

const log = Logger.createModuleLogger('RMA-FloatPanel');

let _panelEl = null;
let _state = 'minimized'; // expanded | half_collapsed | minimized
let _timelineVisible = false;
let _dragOffset = { x: 0, y: 0 };

/**
 * 初始化 RMA 悬浮面板
 */
export async function initRmaPanel() {
    if (_panelEl) return;

    // 加载 HTML 模板
    try {
        const basePath = getExtensionPath();
        const response = await fetch(`${basePath}/ui/rma-panel.html`);
        const html = await response.text();

        const container = document.createElement('div');
        container.innerHTML = html;
        const panel = container.firstElementChild;
        if (panel) {
            document.body.appendChild(panel);
            _panelEl = panel;
        }
    } catch (e) {
        log.warn('加载 RMA 面板模板失败:', e);
        createFallbackPanel();
    }

    if (!_panelEl) return;

    // 设置初始状态
    const config = getRmaConfig();
    _state = config?.floatPanel?.defaultState || 'minimized';
    applyState();

    // 绑定事件
    bindPanelEvents();

    // 注册回调
    setOnAnalysisCompleteCallback(onAnalysisComplete);
    setOnConfirmCompleteCallback(onConfirmComplete);

    log.log('RMA 悬浮面板初始化完成');
}

/**
 * 创建 fallback 面板（模板加载失败时）
 */
function createFallbackPanel() {
    const panel = document.createElement('div');
    panel.id = 'rma-float-panel';
    panel.className = 'rma-panel rma-panel-minimized';
    panel.innerHTML = `
        <div class="rma-panel-minimized-icon" id="rma-minimize-icon">🔮</div>
        <div class="rma-panel-header" id="rma-panel-header">
            <span class="rma-panel-title">RMA 关系系统</span>
            <div class="rma-panel-controls">
                <button class="rma-btn-sm" id="rma-collapse-btn" title="折叠">—</button>
                <button class="rma-btn-sm" id="rma-minimize-btn" title="最小化">_</button>
            </div>
        </div>
        <div class="rma-panel-body" id="rma-panel-body">
            <div id="rma-phase-section"></div>
            <div id="rma-feeling-section"></div>
            <div id="rma-secrets-section"></div>
            <div id="rma-threads-section"></div>
            <div id="rma-story-section"></div>
            <div id="rma-memories-section"></div>
            <div id="rma-pending-section"></div>
        </div>
        <div class="rma-panel-half" id="rma-panel-half"></div>
        <div class="rma-panel-footer">
            <button class="rma-btn-sm" id="rma-timeline-btn">📜 完整记忆</button>
        </div>
        <div id="rma-timeline-container" style="display:none"></div>
    `;
    document.body.appendChild(panel);
    _panelEl = panel;
}

/**
 * 绑定面板事件
 */
function bindPanelEvents() {
    // 头部点击切换展开/半折叠
    _panelEl.querySelector('#rma-panel-header')?.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        toggleExpandCollapse();
    });

    // 折叠按钮
    _panelEl.querySelector('#rma-collapse-btn')?.addEventListener('click', () => {
        _state = 'half_collapsed';
        applyState();
    });

    // 最小化按钮
    _panelEl.querySelector('#rma-minimize-btn')?.addEventListener('click', () => {
        _state = 'minimized';
        applyState();
    });

    // 最小化图标点击
    _panelEl.querySelector('#rma-minimize-icon')?.addEventListener('click', () => {
        _state = 'half_collapsed';
        applyState();
    });

    // 时间线按钮
    _panelEl.querySelector('#rma-timeline-btn')?.addEventListener('click', () => {
        _timelineVisible = !_timelineVisible;
        const container = _panelEl.querySelector('#rma-timeline-container');
        if (container) {
            if (_timelineVisible) {
                container.innerHTML = renderTimeline();
                container.style.display = 'block';
                bindTimelineEvents(container);
            } else {
                container.style.display = 'none';
            }
        }
    });

    // 拖拽
    enableDrag();
}

/**
 * 切换展开/半折叠
 */
function toggleExpandCollapse() {
    _state = _state === 'expanded' ? 'half_collapsed' : 'expanded';
    applyState();
}

/**
 * 应用面板状态
 */
function applyState() {
    if (!_panelEl) return;

    _panelEl.classList.remove('rma-panel-expanded', 'rma-panel-half', 'rma-panel-minimized');

    switch (_state) {
        case 'expanded':
            _panelEl.classList.add('rma-panel-expanded');
            updatePanelContent();
            break;
        case 'half_collapsed':
            _panelEl.classList.add('rma-panel-half');
            updateHalfContent();
            break;
        case 'minimized':
            _panelEl.classList.add('rma-panel-minimized');
            break;
    }
}

/**
 * 更新展开面板内容
 */
export function updatePanelContent() {
    if (!_panelEl || _state !== 'expanded') return;

    const config = getCurrentRmaConfig();
    const state = getRmaState();
    if (!config || !state) return;

    // 阶段指示器
    const phaseDefs = getPhaseDefinitions(config);
    const currentPhase = getPhase();
    const phaseIdx = getPhaseIndex(currentPhase, config);
    const phaseHtml = phaseDefs.map((p, i) => {
        const name = p.name || p.id;
        const active = name === currentPhase;
        const past = i < phaseIdx;
        return `<span class="rma-phase-dot ${active ? 'active' : ''} ${past ? 'past' : ''}">${name}</span>`;
    }).join(' → ');
    setInner('#rma-phase-section', `<div class="rma-phase-bar">${phaseHtml}</div>`);

    // 当前感受
    const texture = getCurrentTexture();
    setInner('#rma-feeling-section', texture
        ? `<div class="rma-feeling">${escapeHtml(texture.slice(0, 100))}${texture.length > 100 ? '...' : ''}</div>`
        : '');

    // 秘密
    const secrets = getSecrets(config);
    if (Object.keys(secrets).length > 0) {
        const secretHtml = Object.entries(secrets).map(([id, s]) => {
            const currentStage = state.secrets?.[id]?.current_stage || s.initial_stage;
            const stages = s.stages || [];
            const dots = stages.map(st => st.id === currentStage ? '●' : '○').join('');
            return `<div class="rma-secret-item">🔮 ${escapeHtml(s.description?.slice(0, 30) || id)} ${dots}</div>`;
        }).join('');
        setInner('#rma-secrets-section', `<div class="rma-pending-label">秘密</div>${secretHtml}`);
    }

    // 未解决事项
    const threads = getUnresolvedThreads();
    if (threads.length > 0) {
        setInner('#rma-threads-section', `<div class="rma-pending-label">悬念</div>${threads.map(t => `<div class="rma-thread">⚡ ${escapeHtml(t)}</div>`).join('')}`);
    }

    // 故事状态
    const storyState = getStoryState();
    if (Object.keys(storyState).length > 0) {
        const parts = [];
        if (storyState.location) parts.push(`📍 ${storyState.location}`);
        if (storyState.time_of_day) parts.push(`🕐 ${storyState.time_of_day}`);
        if (storyState.day_count) parts.push(`📅 第${storyState.day_count}天`);
        setInner('#rma-story-section', parts.join(' | '));
    }

    // 最近记忆
    const memories = getRelevantMemories().slice(-3);
    if (memories.length > 0) {
        const memHtml = memories.map(m => {
            const icon = { breakthrough: '⭐', warmth: '💛', crack: '⚡', revelation: '👁' }[m.type] || '📝';
            return `<div class="rma-mem-brief">${icon} ${escapeHtml(m.event?.slice(0, 50) || '')}</div>`;
        }).join('');
        setInner('#rma-memories-section', `<div class="rma-pending-label">最近记忆</div>${memHtml}`);
    }

    // 待确认
    const pending = getPendingAnalysis();
    const pendingSection = _panelEl.querySelector('#rma-pending-section');
    if (pending && pendingSection) {
        pendingSection.innerHTML = renderPendingConfirmation(pending);
        bindConfirmationEvents(pendingSection, pending);
    } else if (pendingSection) {
        pendingSection.innerHTML = '';
    }
}

/**
 * 更新半折叠摘要
 */
function updateHalfContent() {
    if (!_panelEl) return;

    const state = getRmaState();
    const halfEl = _panelEl.querySelector('#rma-panel-half');
    if (!halfEl || !state) return;

    const parts = [];
    parts.push(`💭 ${state.phase?.current || '?'}`);

    const storyState = getStoryState();
    if (storyState.location) parts.push(`📍 ${storyState.location}`);
    if (storyState.day_count) parts.push(`📅 第${storyState.day_count}天`);

    const pending = getPendingAnalysis();
    if (pending) parts.push('🔔 待确认');

    halfEl.textContent = parts.join(' | ');
}

/**
 * 分析完成回调
 */
function onAnalysisComplete(result) {
    if (!result) {
        // null = 仅刷新
        if (_state === 'expanded') updatePanelContent();
        else updateHalfContent();
        return;
    }

    const config = getRmaConfig();
    const mode = config?.confirmationMode || 'every_turn';

    if (needsConfirmation(mode, result.json)) {
        // 需要确认：展开面板
        _state = 'expanded';
        applyState();
    } else {
        // 自动确认
        import('./confirmation-ui').then(mod => {
            mod.applyConfirmedResult?.(result, result.narrative);
        }).catch(() => {});
    }
}

/**
 * 确认完成回调
 */
function onConfirmComplete() {
    updatePanelContent();
    updateHalfContent();
}

/**
 * 显示/隐藏面板
 */
export function showRmaPanel() {
    if (_panelEl) {
        _panelEl.style.display = '';
        if (_state === 'minimized') {
            _state = 'half_collapsed';
        }
        applyState();
    }
}

export function hideRmaPanel() {
    if (_panelEl) {
        _panelEl.style.display = 'none';
    }
}

/**
 * 拖拽支持
 */
function enableDrag() {
    const header = _panelEl?.querySelector('#rma-panel-header');
    if (!header) return;

    let isDragging = false;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        _dragOffset.x = e.clientX - _panelEl.offsetLeft;
        _dragOffset.y = e.clientY - _panelEl.offsetTop;
        _panelEl.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        _panelEl.style.left = (e.clientX - _dragOffset.x) + 'px';
        _panelEl.style.top = (e.clientY - _dragOffset.y) + 'px';
        _panelEl.style.right = 'auto';
        _panelEl.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            _panelEl.style.transition = '';
        }
    });
}

function setInner(selector, html) {
    const el = _panelEl?.querySelector(selector);
    if (el) el.innerHTML = html;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
