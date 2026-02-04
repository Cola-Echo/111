/**
 * SillyTavern API 封装模块
 * 提供统一的 SillyTavern API 访问接口
 * @module core/sillytavern-api
 */

/**
 * 获取 SillyTavern 上下文
 * @returns {object|null} SillyTavern 上下文对象
 */
export function getContext() {
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        return SillyTavern.getContext();
    }
    return null;
}

/**
 * 获取事件源
 * @returns {object|null} 事件源对象
 */
export function getEventSource() {
    const context = getContext();
    return context?.eventSource || null;
}

/**
 * 获取事件类型
 * @returns {object} 事件类型枚举
 */
export function getEventTypes() {
    const context = getContext();
    return context?.event_types || {};
}

/**
 * 获取扩展设置
 * @returns {object} 扩展设置对象
 */
export function getExtensionSettings() {
    const context = getContext();
    return context?.extensionSettings || {};
}

/**
 * 保存设置（带防抖）
 */
export function saveSettingsDebounced() {
    const context = getContext();
    if (context?.saveSettingsDebounced) {
        context.saveSettingsDebounced();
    }
}

/**
 * 触发正常生成
 * @returns {boolean} 是否成功触发
 */
export function generateNormal() {
    const context = getContext();
    if (context?.Generate) {
        context.Generate('normal');
        return true;
    }
    return false;
}

/**
 * 获取当前聊天记录
 * @returns {Array} 聊天消息数组
 */
export function getCurrentChat() {
    const context = getContext();
    return context?.chat || [];
}

/**
 * 获取当前角色名称
 * @returns {string} 角色名称
 */
export function getCurrentCharacterName() {
    const context = getContext();
    if (context?.characterId >= 0 && context?.characters) {
        return context.characters[context.characterId]?.name || '';
    }
    return '';
}

/**
 * 获取当前角色描述
 * @returns {string} 角色描述
 */
export function getCurrentCharacterDescription() {
    const context = getContext();
    if (context?.characterId >= 0 && context?.characters) {
        return context.characters[context.characterId]?.description || '';
    }
    return '';
}

/**
 * 获取世界书名称列表
 * @returns {Array<string>} 世界书名称数组
 */
export function getWorldNames() {
    const context = getContext();
    return context?.worldNames || context?.world_names || [];
}

/**
 * 加载世界书
 * @param {string} name 世界书名称
 * @returns {Promise<object>} 世界书数据
 */
export async function loadWorldInfo(name) {
    const context = getContext();
    if (context?.loadWorldInfo) {
        return await context.loadWorldInfo(name);
    }
    return null;
}

/**
 * 获取共享库
 * @returns {object} 共享库对象
 */
export function getLibs() {
    if (typeof SillyTavern !== 'undefined' && SillyTavern.libs) {
        return SillyTavern.libs;
    }
    return {};
}

/**
 * 获取 DOMPurify 库
 * @returns {object|null} DOMPurify 对象
 */
export function getDOMPurify() {
    const libs = getLibs();
    return libs.DOMPurify || null;
}
