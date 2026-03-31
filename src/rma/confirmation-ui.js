/**
 * RMA 确认 UI
 * 处理用户对分析结果的确认/编辑/拒绝
 * @module rma/confirmation-ui
 */

import Logger from '@core/logger';
import { getCurrentRmaConfig, getPhaseDefinitions } from './config-loader';
import { addMemory, setPhase, setCurrentTexture, updateSecretStage, addThread, resolveThread, updateStoryState, saveRmaState, getPhase } from './memory-store';
import { assessPhaseChange, executePhaseChange, updateTendency } from './phase-manager';
import { switchPhaseEntry, rewriteTextureEntry, checkAndUnlockEntries } from './worldbook-sync';
import { getRmaState } from './memory-store';
import { clearPendingAnalysis } from './response-hook';

const log = Logger.createModuleLogger('RMA-ConfirmationUI');

let _onConfirmComplete = null;

/**
 * 设置确认完成回调
 * @param {Function} fn
 */
export function setOnConfirmCompleteCallback(fn) {
    _onConfirmComplete = fn;
}

/**
 * 渲染待确认区域 HTML
 * @param {object} analysisResult 分析结果 { json, narrative }
 * @returns {string} HTML 字符串
 */
export function renderPendingConfirmation(analysisResult) {
    if (!analysisResult?.json) {
        return '<div class="rma-pending-empty">无分析结果</div>';
    }

    const { json, narrative } = analysisResult;
    const config = getCurrentRmaConfig();
    const parts = [];

    // 新记忆
    if (json.new_memories?.length > 0) {
        const memHtml = json.new_memories.map((m, i) => {
            const typeLabel = { breakthrough: '⭐ 破防', warmth: '💛 暖意', crack: '⚡ 裂痕', revelation: '👁 揭示' }[m.type] || m.type;
            return `<div class="rma-pending-item" data-index="${i}">
                <span class="rma-type-badge rma-type-${m.type}">${typeLabel}</span>
                <span class="rma-pending-event">${escapeHtml(m.event)}</span>
                <div class="rma-pending-actions">
                    <button class="rma-btn-sm rma-edit-mem" data-index="${i}" title="编辑">✏️</button>
                    <button class="rma-btn-sm rma-delete-mem" data-index="${i}" title="删除">✕</button>
                </div>
            </div>`;
        }).join('');
        parts.push(`<div class="rma-pending-section">
            <div class="rma-pending-label">新记忆</div>
            ${memHtml}
        </div>`);
    }

    // 阶段变化
    if (json.phase_assessment) {
        const pa = json.phase_assessment;
        const tendencyIcon = { warming: '🔥', stable: '➡️', cooling: '❄️' }[pa.tendency] || '➡️';
        let phaseHtml = `<span>${tendencyIcon} 趋势: ${pa.tendency || 'stable'}</span>`;
        if (pa.phase_changed && pa.new_phase) {
            phaseHtml += `<div class="rma-phase-change">阶段变化: ${getPhase()} → <strong>${pa.new_phase}</strong>
                <button class="rma-btn-sm rma-reject-phase" title="拒绝变化">✕</button>
            </div>`;
        }
        parts.push(`<div class="rma-pending-section">
            <div class="rma-pending-label">关系评估</div>
            ${phaseHtml}
        </div>`);
    }

    // Narrative
    if (narrative) {
        parts.push(`<div class="rma-pending-section">
            <div class="rma-pending-label">AI 将看到的情绪质感</div>
            <div class="rma-narrative-preview" contenteditable="true">${escapeHtml(narrative)}</div>
        </div>`);
    }

    // 操作按钮
    parts.push(`<div class="rma-pending-actions-bar">
        <button class="rma-btn rma-btn-confirm" id="rma-confirm-btn">✅ 确认</button>
        <button class="rma-btn rma-btn-reanalyze" id="rma-reanalyze-btn">🔄 重新分析</button>
    </div>`);

    return parts.join('');
}

/**
 * 绑定确认区域事件
 * @param {HTMLElement} container 确认区域容器
 * @param {object} analysisResult 分析结果
 */
export function bindConfirmationEvents(container, analysisResult) {
    if (!container || !analysisResult) return;

    // 删除记忆
    container.querySelectorAll('.rma-delete-mem').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.index);
            if (analysisResult.json?.new_memories) {
                analysisResult.json.new_memories.splice(idx, 1);
                const item = btn.closest('.rma-pending-item');
                if (item) item.remove();
            }
        });
    });

    // 拒绝阶段变化
    container.querySelector('.rma-reject-phase')?.addEventListener('click', () => {
        if (analysisResult.json?.phase_assessment) {
            analysisResult.json.phase_assessment.phase_changed = false;
            analysisResult.json.phase_assessment.new_phase = null;
            const el = container.querySelector('.rma-phase-change');
            if (el) el.textContent = '（已拒绝阶段变化）';
        }
    });

    // 确认按钮
    container.querySelector('#rma-confirm-btn')?.addEventListener('click', async () => {
        // 读取可能被编辑的 narrative
        const narrativeEl = container.querySelector('.rma-narrative-preview');
        const finalNarrative = narrativeEl?.textContent || analysisResult.narrative;
        await applyConfirmedResult(analysisResult, finalNarrative);
    });
}

/**
 * 应用已确认的分析结果
 * @param {object} analysisResult
 * @param {string} finalNarrative 最终的 narrative 文本
 */
async function applyConfirmedResult(analysisResult, finalNarrative) {
    const config = getCurrentRmaConfig();
    if (!config) return;

    const { json } = analysisResult;
    const oldPhase = getPhase();

    try {
        // 1. 写入新记忆
        let firstMemId = null;
        if (json?.new_memories) {
            for (const mem of json.new_memories) {
                const id = addMemory(mem);
                if (!firstMemId) firstMemId = id;
            }
        }

        // 2. 处理阶段变化
        if (json?.phase_assessment) {
            updateTendency(json.phase_assessment.tendency);
            if (json.phase_assessment.phase_changed && json.phase_assessment.new_phase) {
                executePhaseChange(json.phase_assessment.new_phase, firstMemId);
                await switchPhaseEntry(oldPhase, json.phase_assessment.new_phase);
            }
        }

        // 3. 处理秘密更新
        if (json?.secret_updates) {
            for (const [id, update] of Object.entries(json.secret_updates)) {
                if (update.stage_changed && update.new_stage) {
                    updateSecretStage(id, update.new_stage);
                }
            }
        }

        // 4. 处理未解决事项
        if (json?.unresolved_threads) {
            (json.unresolved_threads.added || []).forEach(t => addThread(t));
            (json.unresolved_threads.resolved || []).forEach(t => resolveThread(t));
        }

        // 5. 处理故事状态
        if (json?.story_state_updates) {
            const updates = {};
            for (const [key, value] of Object.entries(json.story_state_updates)) {
                if (value !== undefined && value !== null) {
                    updates[key] = value;
                }
            }
            if (Object.keys(updates).length > 0) {
                updateStoryState(updates);
            }
        }

        // 6. 更新质感
        if (finalNarrative) {
            setCurrentTexture(finalNarrative);
            await rewriteTextureEntry(finalNarrative);
        }

        // 7. 检查事件解锁
        const state = getRmaState();
        if (state) {
            await checkAndUnlockEntries(state, config);
        }

        // 8. 持久化
        await saveRmaState();

        // 清除待确认
        clearPendingAnalysis();

        log.log('确认完成，已写入所有更新');

        // 通知 UI 刷新
        if (_onConfirmComplete) {
            _onConfirmComplete();
        }
    } catch (e) {
        log.warn('应用确认结果失败:', e);
    }
}

/**
 * 根据确认模式判断是否需要用户确认
 * @param {string} mode every_turn | important_only | auto
 * @param {object} analysisJson
 * @returns {boolean}
 */
export function needsConfirmation(mode, analysisJson) {
    if (mode === 'every_turn') return true;
    if (mode === 'auto') return false;

    // important_only: 阶段变化、秘密进展、crack 需要确认
    if (mode === 'important_only') {
        if (analysisJson?.phase_assessment?.phase_changed) return true;
        if (analysisJson?.secret_updates && Object.values(analysisJson.secret_updates).some(s => s.stage_changed)) return true;
        if (analysisJson?.new_memories?.some(m => m.type === 'crack')) return true;
        return false;
    }

    return true;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
