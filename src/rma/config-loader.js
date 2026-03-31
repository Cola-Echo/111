/**
 * RMA 配置加载器
 * 从角色卡 extensions.cola_rma_config 读取 RMA 配置
 * @module rma/config-loader
 */

import Logger from '@core/logger';
import { getContext } from '@core/sillytavern-api';

const log = Logger.createModuleLogger('RMA-ConfigLoader');

let _cachedConfig = null;
let _cachedCharId = null;

/**
 * 从当前角色卡加载 RMA 配置
 * @returns {object|null} RMA 配置对象，无配置返回 null
 */
export function loadRmaConfigFromCharacter() {
    try {
        const context = getContext();
        if (!context) return null;

        const chid = context.characterId;
        if (chid === undefined || chid < 0) return null;

        // 使用缓存避免重复读取
        if (_cachedConfig && _cachedCharId === chid) {
            return _cachedConfig;
        }

        const charData = context.characters?.[chid]?.data;
        if (!charData) return null;

        const rmaConfig = charData.extensions?.cola_rma_config;
        if (!rmaConfig) {
            _cachedConfig = null;
            _cachedCharId = chid;
            return null;
        }

        log.log(`加载角色 RMA 配置: ${rmaConfig.character_name || '未知'} (v${rmaConfig.version || '?'})`);
        _cachedConfig = rmaConfig;
        _cachedCharId = chid;
        return rmaConfig;
    } catch (e) {
        log.warn('加载 RMA 配置失败:', e);
        return null;
    }
}

/**
 * 检测当前角色是否有 RMA 配置
 * @returns {boolean}
 */
export function hasRmaConfig() {
    return loadRmaConfigFromCharacter() !== null;
}

/**
 * 获取缓存的 RMA 配置
 * @returns {object|null}
 */
export function getCurrentRmaConfig() {
    const context = getContext();
    const chid = context?.characterId;

    // 角色切换时清除缓存
    if (chid !== _cachedCharId) {
        _cachedConfig = null;
        _cachedCharId = null;
    }

    if (!_cachedConfig) {
        return loadRmaConfigFromCharacter();
    }
    return _cachedConfig;
}

/**
 * 清除配置缓存（角色切换时调用）
 */
export function clearRmaConfigCache() {
    _cachedConfig = null;
    _cachedCharId = null;
}

/**
 * 获取 RMA 配置中的阶段定义列表
 * @param {object} config RMA 配置
 * @returns {Array<{id: string, name: string, order: number}>}
 */
export function getPhaseDefinitions(config) {
    return config?.phases?.definitions || [];
}

/**
 * 获取 RMA 配置中的初始阶段
 * @param {object} config RMA 配置
 * @returns {string|null}
 */
export function getInitialPhase(config) {
    return config?.phases?.initial_phase || null;
}

/**
 * 获取 RMA 配置中的敏感点
 * @param {object} config RMA 配置
 * @returns {object}
 */
export function getSensitivities(config) {
    return config?.sensitivities || {};
}

/**
 * 获取 RMA 配置中的情感处理模式
 * @param {object} config RMA 配置
 * @returns {object}
 */
export function getEmotionalProcessing(config) {
    return config?.emotional_processing || {};
}

/**
 * 获取 RMA 配置中的秘密路径
 * @param {object} config RMA 配置
 * @returns {object}
 */
export function getSecrets(config) {
    return config?.secrets || {};
}

/**
 * 获取世界书条目映射配置
 * @param {object} config RMA 配置
 * @returns {object}
 */
export function getWorldbookEntryConfig(config) {
    return config?.worldbook_entries || {};
}
