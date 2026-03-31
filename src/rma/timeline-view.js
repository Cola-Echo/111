/**
 * RMA 记忆时间线视图
 * 按天分组展示记忆，支持类型图标
 * @module rma/timeline-view
 */

import { getRmaState } from './memory-store';

const TYPE_ICONS = {
    breakthrough: '⭐',
    warmth: '💛',
    crack: '⚡',
    revelation: '👁',
};

const TYPE_LABELS = {
    breakthrough: '破防',
    warmth: '暖意',
    crack: '裂痕',
    revelation: '揭示',
};

/**
 * 渲染完整时间线 HTML
 * @returns {string} HTML 字符串
 */
export function renderTimeline() {
    const state = getRmaState();
    if (!state?.memories?.length) {
        return '<div class="rma-timeline-empty">暂无记忆</div>';
    }

    // 按天分组
    const groups = {};
    for (const mem of state.memories) {
        const day = mem.day || '?';
        if (!groups[day]) groups[day] = [];
        groups[day].push(mem);
    }

    // 倒序排列（最近的在前）
    const days = Object.keys(groups).sort((a, b) => Number(b) - Number(a));

    const html = days.map(day => {
        const memories = groups[day];
        const memHtml = memories.map(m => {
            const icon = TYPE_ICONS[m.type] || '📝';
            const label = TYPE_LABELS[m.type] || m.type;
            const invalidClass = m.invalidated ? ' rma-mem-invalid' : '';
            return `<div class="rma-timeline-item${invalidClass}" data-mem-id="${m.id}">
                <span class="rma-timeline-icon">${icon}</span>
                <div class="rma-timeline-content">
                    <span class="rma-timeline-type">[${label}]</span>
                    <span class="rma-timeline-event">${escapeHtml(m.event)}</span>
                    ${m.emotional_impact ? `<div class="rma-timeline-impact">${escapeHtml(m.emotional_impact)}</div>` : ''}
                    ${m.invalidated ? '<div class="rma-timeline-warn">⚠️ 关联消息已删除</div>' : ''}
                </div>
            </div>`;
        }).join('');

        return `<div class="rma-timeline-group">
            <div class="rma-timeline-day">第 ${day} 天</div>
            ${memHtml}
        </div>`;
    }).join('');

    return `<div class="rma-timeline">${html}</div>`;
}

/**
 * 绑定时间线事件（点击展开详情）
 * @param {HTMLElement} container
 */
export function bindTimelineEvents(container) {
    if (!container) return;

    container.querySelectorAll('.rma-timeline-item').forEach(item => {
        item.addEventListener('click', () => {
            item.classList.toggle('rma-timeline-expanded');
        });
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}
