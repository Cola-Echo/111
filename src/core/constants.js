/**
 * 常量定义模块
 * @module core/constants
 */

export const EXTENSION_NAME = "memory_manager_concurrent";
export const EXTENSION_FOLDER = "memory-manager-concurrent";

let EXTENSION_BASE_PATH = null;

/**
 * 动态检测扩展路径（支持 extensions 和 third-party 两种安装位置）
 * @returns {Promise<string>} 扩展基础路径
 */
export async function detectExtensionPath() {
    if (EXTENSION_BASE_PATH) return EXTENSION_BASE_PATH;

    const possiblePaths = [
        `/scripts/extensions/third-party/${EXTENSION_FOLDER}`,
        `/scripts/extensions/${EXTENSION_FOLDER}`,
    ];

    for (const basePath of possiblePaths) {
        try {
            const response = await fetch(`${basePath}/ui/panel.html`, {
                method: "HEAD",
            });
            if (response.ok) {
                EXTENSION_BASE_PATH = basePath;
                return basePath;
            }
        } catch (e) {
            // 忽略错误，继续尝试下一个路径
        }
    }

    // 默认使用 third-party 路径
    EXTENSION_BASE_PATH = possiblePaths[0];
    return EXTENSION_BASE_PATH;
}

/**
 * 获取当前扩展路径（同步版本，需要先调用 detectExtensionPath）
 * @returns {string|null} 扩展基础路径
 */
export function getExtensionPath() {
    return EXTENSION_BASE_PATH;
}
