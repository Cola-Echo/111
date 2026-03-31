/**
 * RMA 阶段管理器
 * 阶段切换判断和执行
 * @module rma/phase-manager
 */

import Logger from '@core/logger';
import { getPhaseDefinitions } from './config-loader';
import { getPhase, setPhase, setPhaseTendency } from './memory-store';

const log = Logger.createModuleLogger('RMA-PhaseManager');

/**
 * 评估分析结果中的阶段变化
 * @param {object} analysisJson AI 分析 JSON 结果
 * @param {object} config RMA 配置
 * @returns {{ shouldChange: boolean, newPhase: string|null, tendency: string }}
 */
export function assessPhaseChange(analysisJson, config) {
    const assessment = analysisJson?.phase_assessment;
    if (!assessment) {
        return { shouldChange: false, newPhase: null, tendency: 'stable' };
    }

    const phaseDefs = getPhaseDefinitions(config);
    const phaseNames = phaseDefs.map(p => p.name || p.id);
    const currentPhase = getPhase();

    // 更新趋势
    const tendency = assessment.tendency || 'stable';

    // 检查是否建议阶段变化
    if (!assessment.phase_changed || !assessment.new_phase) {
        return { shouldChange: false, newPhase: null, tendency };
    }

    const newPhase = assessment.new_phase;

    // 验证阶段名合法
    if (!phaseNames.includes(newPhase)) {
        log.warn(`非法阶段名: ${newPhase}`);
        return { shouldChange: false, newPhase: null, tendency };
    }

    // 不重复切换
    if (newPhase === currentPhase) {
        return { shouldChange: false, newPhase: null, tendency };
    }

    return { shouldChange: true, newPhase, tendency };
}

/**
 * 执行阶段切换
 * @param {string} newPhase 新阶段名
 * @param {string} triggerMemoryId 触发记忆 ID
 */
export function executePhaseChange(newPhase, triggerMemoryId = null) {
    const oldPhase = getPhase();
    setPhase(newPhase, triggerMemoryId);
    log.log(`阶段已切换: ${oldPhase} → ${newPhase}`);
}

/**
 * 更新阶段趋势
 * @param {string} tendency
 */
export function updateTendency(tendency) {
    if (['warming', 'stable', 'cooling'].includes(tendency)) {
        setPhaseTendency(tendency);
    }
}

/**
 * 获取阶段在定义中的序号（用于 UI 进度条）
 * @param {string} phaseName
 * @param {object} config
 * @returns {number} 0-based index, -1 if not found
 */
export function getPhaseIndex(phaseName, config) {
    const defs = getPhaseDefinitions(config);
    return defs.findIndex(p => (p.name || p.id) === phaseName);
}
