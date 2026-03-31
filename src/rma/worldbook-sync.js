/**
 * RMA 世界书同步
 * 切换阶段条目（互斥）、改写质感条目、检查事件解锁
 * @module rma/worldbook-sync
 */

import Logger from '@core/logger';
import { getContext, loadWorldInfo } from '@core/sillytavern-api';
import { getSecretState } from './memory-store';

const log = Logger.createModuleLogger('RMA-WorldbookSync');

/**
 * 获取请求头（含 CSRF）
 */
function getRequestHeaders() {
    const context = getContext();
    if (context && typeof context.getRequestHeaders === 'function') {
        return context.getRequestHeaders();
    }
    return { 'Content-Type': 'application/json' };
}

/**
 * 保存世界书（三级 fallback）
 */
async function saveWorldBook(bookName, bookData) {
    try {
        const context = getContext();

        // 方法 1: context API
        if (context?.saveWorldInfo) {
            await context.saveWorldInfo(bookName, bookData, true);
            return true;
        }

        // 方法 2: 全局函数
        if (typeof saveWorldInfo === 'function') {
            await saveWorldInfo(bookName, bookData, true);
            return true;
        }

        // 方法 3: REST API
        const response = await fetch('/api/worldinfo/edit', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name: bookName, data: bookData }),
        });
        return response.ok;
    } catch (e) {
        log.warn(`保存世界书 "${bookName}" 失败:`, e);
        return false;
    }
}

/**
 * 在世界书中查找 RMA 相关条目
 * @param {object} bookData 世界书数据
 * @returns {{ phaseEntries: object, textureEntry: object, eventEntries: object }}
 */
export function findRmaEntries(bookData) {
    const phaseEntries = {};   // { phaseName: { uid, entry } }
    const eventEntries = {};   // { comment: { uid, entry } }
    let textureEntry = null;   // { uid, entry }

    if (!bookData?.entries) return { phaseEntries, textureEntry, eventEntries };

    for (const [uid, entry] of Object.entries(bookData.entries)) {
        const comment = entry.comment || '';

        // [RMA:Phase:xxx]
        const phaseMatch = comment.match(/\[RMA:Phase:(.+?)\]/);
        if (phaseMatch) {
            phaseEntries[phaseMatch[1]] = { uid, entry };
            continue;
        }

        // [RMA:Texture]
        if (comment.includes('[RMA:Texture]')) {
            textureEntry = { uid, entry };
            continue;
        }

        // [RMA:Secret:xxx] 或 [RMA:Event:xxx]
        if (comment.match(/\[RMA:(Secret|Event):.+?\]/)) {
            eventEntries[comment] = { uid, entry };
        }
    }

    return { phaseEntries, textureEntry, eventEntries };
}

/**
 * 在角色关联的所有世界书中查找 RMA 条目所在的世界书
 * @returns {Promise<{bookName: string, bookData: object, rmaEntries: object}|null>}
 */
export async function findRmaWorldBook() {
    try {
        const context = getContext();
        if (!context) return null;

        // 获取角色绑定的世界书
        const charBook = context.characters?.[context.characterId]?.data?.extensions?.world;
        const worldNames = [];

        if (charBook) worldNames.push(charBook);

        // 也检查全局启用的世界书
        const globalBooks = context.world_names || [];
        for (const name of globalBooks) {
            if (!worldNames.includes(name)) worldNames.push(name);
        }

        for (const bookName of worldNames) {
            const bookData = await loadWorldInfo(bookName);
            if (!bookData) continue;

            const rmaEntries = findRmaEntries(bookData);
            const hasRma = Object.keys(rmaEntries.phaseEntries).length > 0 || rmaEntries.textureEntry;

            if (hasRma) {
                log.log(`找到 RMA 世界书: "${bookName}"`);
                return { bookName, bookData, rmaEntries };
            }
        }

        return null;
    } catch (e) {
        log.warn('查找 RMA 世界书失败:', e);
        return null;
    }
}

/**
 * 切换阶段条目（互斥：禁用旧阶段，启用新阶段）
 * @param {string} oldPhase 旧阶段名
 * @param {string} newPhase 新阶段名
 * @returns {Promise<boolean>}
 */
export async function switchPhaseEntry(oldPhase, newPhase) {
    const wb = await findRmaWorldBook();
    if (!wb) {
        log.warn('未找到 RMA 世界书');
        return false;
    }

    const { bookName, bookData, rmaEntries } = wb;
    const { phaseEntries } = rmaEntries;

    let changed = false;

    // 禁用旧阶段
    if (oldPhase && phaseEntries[oldPhase]) {
        const { uid } = phaseEntries[oldPhase];
        if (bookData.entries[uid]) {
            bookData.entries[uid].enabled = false;
            if (bookData.entries[uid].extensions) {
                bookData.entries[uid].extensions.enabled = false;
            }
            changed = true;
            log.log(`禁用阶段条目: [RMA:Phase:${oldPhase}]`);
        }
    }

    // 启用新阶段
    if (newPhase && phaseEntries[newPhase]) {
        const { uid } = phaseEntries[newPhase];
        if (bookData.entries[uid]) {
            bookData.entries[uid].enabled = true;
            if (bookData.entries[uid].extensions) {
                bookData.entries[uid].extensions.enabled = true;
            }
            changed = true;
            log.log(`启用阶段条目: [RMA:Phase:${newPhase}]`);
        }
    }

    if (changed) {
        return await saveWorldBook(bookName, bookData);
    }
    return true;
}

/**
 * 改写质感条目内容
 * @param {string} newContent 新的情绪质感文本
 * @returns {Promise<boolean>}
 */
export async function rewriteTextureEntry(newContent) {
    const wb = await findRmaWorldBook();
    if (!wb) return false;

    const { bookName, bookData, rmaEntries } = wb;
    const { textureEntry } = rmaEntries;

    if (!textureEntry) {
        log.warn('未找到 [RMA:Texture] 条目');
        return false;
    }

    const { uid } = textureEntry;
    bookData.entries[uid].content = newContent;
    log.log(`更新质感条目: ${newContent.slice(0, 50)}...`);

    return await saveWorldBook(bookName, bookData);
}

/**
 * 检查并解锁事件条目
 * @param {object} rmaState 当前 RMA 状态
 * @param {object} config RMA 配置
 * @returns {Promise<Array<string>>} 本次解锁的条目注释列表
 */
export async function checkAndUnlockEntries(rmaState, config) {
    const wb = await findRmaWorldBook();
    if (!wb) return [];

    const { bookName, bookData, rmaEntries } = wb;
    const entryConfig = config?.worldbook_entries?.event_entries || [];
    const unlocked = [];
    let changed = false;

    for (const cfg of entryConfig) {
        if (!cfg.unlock_condition) continue;

        const entryData = rmaEntries.eventEntries[cfg.comment];
        if (!entryData) continue;

        // 已启用则跳过
        const { uid, entry } = entryData;
        if (entry.enabled) continue;

        // 检查解锁条件
        let shouldUnlock = false;
        const cond = cfg.unlock_condition;

        if (cond.type === 'secret_stage') {
            const secretState = getSecretState(cond.secret);
            if (secretState) {
                const secretConfig = config.secrets?.[cond.secret];
                const stages = secretConfig?.stages || [];
                const currentIdx = stages.findIndex(s => s.id === secretState.current_stage);
                const requiredIdx = stages.findIndex(s => s.id === cond.min_stage);
                shouldUnlock = currentIdx >= 0 && requiredIdx >= 0 && currentIdx >= requiredIdx;
            }
        } else if (cond.type === 'memory_exists') {
            shouldUnlock = rmaState.memories.some(m =>
                m.type === cond.memory_type &&
                m.tags?.includes(cond.secret_id) &&
                !m.invalidated
            );
        }

        if (shouldUnlock) {
            bookData.entries[uid].enabled = true;
            if (bookData.entries[uid].extensions) {
                bookData.entries[uid].extensions.enabled = true;
            }
            unlocked.push(cfg.comment);
            changed = true;
            log.log(`解锁事件条目: ${cfg.comment}`);
        }
    }

    if (changed) {
        await saveWorldBook(bookName, bookData);
    }

    return unlocked;
}
