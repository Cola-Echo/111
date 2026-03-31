/**
 * RMA 记忆存储管理
 * 使用 chat_metadata.cola_rma 持久化 RMA 状态
 * @module rma/memory-store
 */

import Logger from '@core/logger';
import { getContext } from '@core/sillytavern-api';
import { getInitialPhase, getSecrets } from './config-loader';

const log = Logger.createModuleLogger('RMA-MemoryStore');

/**
 * 生成唯一记忆 ID
 */
function generateMemoryId() {
    return 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

/**
 * 获取 chat_metadata 引用
 * @returns {object|null}
 */
function getChatMetadata() {
    const context = getContext();
    return context?.chat_metadata || (typeof window !== 'undefined' ? window.chat_metadata : null);
}

/**
 * 初始化 RMA 状态结构
 * @param {object} rmaConfig 角色卡中的 RMA 配置
 */
export function initRmaState(rmaConfig) {
    const meta = getChatMetadata();
    if (!meta) {
        log.warn('chat_metadata 不可用');
        return;
    }

    if (meta.cola_rma) {
        log.log('RMA 状态已存在，跳过初始化');
        return;
    }

    const initialPhase = getInitialPhase(rmaConfig);
    const secrets = getSecrets(rmaConfig);

    // 初始化秘密状态
    const secretStates = {};
    for (const [id, secret] of Object.entries(secrets)) {
        secretStates[id] = {
            current_stage: secret.initial_stage || secret.stages?.[0]?.id || 'unknown',
        };
    }

    // 初始化故事状态
    const storyState = {};
    if (rmaConfig.story_state) {
        for (const [id, field] of Object.entries(rmaConfig.story_state)) {
            storyState[id] = field.initial;
        }
    }

    meta.cola_rma = {
        config_id: rmaConfig.config_id || '',
        last_updated: new Date().toISOString(),
        memories: [],
        phase: {
            current: initialPhase,
            tendency: 'stable',
            history: [],
        },
        secrets: secretStates,
        story_state: storyState,
        unresolved_threads: [],
        current_texture: rmaConfig.initial_texture || '',
    };

    log.log(`RMA 状态初始化完成: 阶段=${initialPhase}`);
    saveRmaState();
}

/**
 * 获取当前 RMA 状态
 * @returns {object|null}
 */
export function getRmaState() {
    const meta = getChatMetadata();
    return meta?.cola_rma || null;
}

/**
 * 持久化 RMA 状态
 */
export async function saveRmaState() {
    try {
        const state = getRmaState();
        if (state) {
            state.last_updated = new Date().toISOString();
        }
        const context = getContext();
        if (context?.saveChat) {
            await context.saveChat();
        }
    } catch (e) {
        log.warn('保存 RMA 状态失败:', e);
    }
}

// ==================== 记忆操作 ====================

/**
 * 添加记忆
 * @param {object} memory 记忆数据
 * @returns {string} 记忆 ID
 */
export function addMemory(memory) {
    const state = getRmaState();
    if (!state) return null;

    const id = generateMemoryId();
    state.memories.push({
        id,
        type: memory.type || 'warmth',
        day: memory.day || state.story_state?.day_count || 1,
        time: memory.time || state.story_state?.time_of_day || '',
        message_id: memory.message_id || null,
        event: memory.event || '',
        emotional_impact: memory.emotional_impact || '',
        character_reaction: memory.character_reaction || '',
        lasting_effect: memory.lasting_effect || '',
        tags: memory.tags || [],
        significance: memory.significance || 'medium',
        invalidated: false,
    });

    return id;
}

/**
 * 更新记忆
 * @param {string} id 记忆 ID
 * @param {object} updates 更新字段
 */
export function updateMemory(id, updates) {
    const state = getRmaState();
    if (!state) return;

    const mem = state.memories.find(m => m.id === id);
    if (mem) {
        Object.assign(mem, updates);
    }
}

/**
 * 删除记忆
 * @param {string} id 记忆 ID
 */
export function deleteMemory(id) {
    const state = getRmaState();
    if (!state) return;

    state.memories = state.memories.filter(m => m.id !== id);
}

/**
 * 标记与指定消息关联的记忆为无效
 * @param {number} messageId 消息 ID
 */
export function invalidateMemoriesByMessage(messageId) {
    const state = getRmaState();
    if (!state) return;

    let count = 0;
    for (const mem of state.memories) {
        if (mem.message_id === messageId && !mem.invalidated) {
            mem.invalidated = true;
            count++;
        }
    }
    if (count > 0) {
        log.log(`已标记 ${count} 条记忆为无效 (message_id=${messageId})`);
    }
}

// ==================== 阶段操作 ====================

/**
 * 获取当前阶段
 * @returns {string|null}
 */
export function getPhase() {
    return getRmaState()?.phase?.current || null;
}

/**
 * 设置阶段
 * @param {string} newPhase 新阶段名
 * @param {string} triggerMemoryId 触发该变化的记忆 ID
 */
export function setPhase(newPhase, triggerMemoryId = null) {
    const state = getRmaState();
    if (!state) return;

    const oldPhase = state.phase.current;
    if (oldPhase === newPhase) return;

    state.phase.history.push({
        from: oldPhase,
        to: newPhase,
        day: state.story_state?.day_count || 1,
        trigger_memory: triggerMemoryId,
    });
    state.phase.current = newPhase;

    log.log(`阶段切换: ${oldPhase} → ${newPhase}`);
}

/**
 * 更新阶段趋势
 * @param {string} tendency warming | stable | cooling
 */
export function setPhaseTendency(tendency) {
    const state = getRmaState();
    if (state?.phase) {
        state.phase.tendency = tendency;
    }
}

// ==================== 秘密操作 ====================

/**
 * 获取秘密状态
 * @param {string} secretId
 * @returns {object|null}
 */
export function getSecretState(secretId) {
    return getRmaState()?.secrets?.[secretId] || null;
}

/**
 * 更新秘密阶段
 * @param {string} secretId
 * @param {string} newStage
 */
export function updateSecretStage(secretId, newStage) {
    const state = getRmaState();
    if (!state?.secrets) return;

    if (!state.secrets[secretId]) {
        state.secrets[secretId] = {};
    }
    state.secrets[secretId].current_stage = newStage;
    log.log(`秘密更新: ${secretId} → ${newStage}`);
}

// ==================== 线索/未解决事项 ====================

/**
 * 获取未解决事项列表
 * @returns {Array<string>}
 */
export function getUnresolvedThreads() {
    return getRmaState()?.unresolved_threads || [];
}

/**
 * 添加未解决事项
 * @param {string} text
 */
export function addThread(text) {
    const state = getRmaState();
    if (!state) return;
    if (!state.unresolved_threads.includes(text)) {
        state.unresolved_threads.push(text);
    }
}

/**
 * 解决事项
 * @param {string} text
 */
export function resolveThread(text) {
    const state = getRmaState();
    if (!state) return;
    state.unresolved_threads = state.unresolved_threads.filter(t => t !== text);
}

// ==================== 故事状态 ====================

/**
 * 获取故事状态
 * @returns {object}
 */
export function getStoryState() {
    return getRmaState()?.story_state || {};
}

/**
 * 更新故事状态
 * @param {object} updates
 */
export function updateStoryState(updates) {
    const state = getRmaState();
    if (!state) return;
    Object.assign(state.story_state, updates);
}

// ==================== 质感 ====================

/**
 * 设置当前情绪质感文本
 * @param {string} text
 */
export function setCurrentTexture(text) {
    const state = getRmaState();
    if (state) {
        state.current_texture = text;
    }
}

/**
 * 获取当前情绪质感文本
 * @returns {string}
 */
export function getCurrentTexture() {
    return getRmaState()?.current_texture || '';
}

// ==================== 记忆检索 ====================

/**
 * 按检索策略获取相关记忆
 * 规则：最近 3-5 条 + 所有未解决 crack + top 2 breakthrough + 话题相关
 * @param {string} currentDialogue 当前对话文本（用于关键词匹配）
 * @returns {Array}
 */
export function getRelevantMemories(currentDialogue = '') {
    const state = getRmaState();
    if (!state?.memories?.length) return [];

    const validMemories = state.memories.filter(m => !m.invalidated);
    const selected = new Set();

    // 1. 最近 5 条
    const recent = validMemories.slice(-5);
    recent.forEach(m => selected.add(m.id));

    // 2. 所有未解决 crack
    validMemories
        .filter(m => m.type === 'crack' && m.lasting_effect && !m.resolved)
        .forEach(m => selected.add(m.id));

    // 3. Top 2 breakthrough（按时间降序取最近的）
    validMemories
        .filter(m => m.type === 'breakthrough')
        .slice(-2)
        .forEach(m => selected.add(m.id));

    // 4. 话题相关（简单关键词匹配）
    if (currentDialogue) {
        const dialogueWords = currentDialogue.toLowerCase();
        validMemories.forEach(m => {
            if (m.tags?.some(tag => dialogueWords.includes(tag.toLowerCase()))) {
                selected.add(m.id);
            }
        });
    }

    return validMemories.filter(m => selected.has(m.id));
}
