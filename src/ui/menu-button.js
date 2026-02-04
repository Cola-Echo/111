/**
 * 扩展菜单按钮模块
 * @module ui/menu-button
 */

import Logger from '@core/logger';
import { isPluginEnabled } from '@config/config-manager';

// 面板切换函数引用（将在初始化时注入）
let togglePanelFn = null;

/**
 * 设置面板切换函数
 * @param {Function} fn 面板切换函数
 */
export function setTogglePanelFunction(fn) {
    togglePanelFn = fn;
}

/**
 * 在酒馆扩展菜单（魔法棒）中添加按钮
 */
export function createExtensionMenuButton() {
    const extensionsMenu = document.getElementById("extensionsMenu");
    if (!extensionsMenu) {
        Logger.warn("扩展菜单不存在，2秒后重试...");
        setTimeout(createExtensionMenuButton, 2000);
        return;
    }

    if (document.getElementById("mm-extension-btn")) {
        Logger.debug("扩展菜单按钮已存在");
        return;
    }

    const menuItem = document.createElement("div");
    menuItem.id = "mm-extension-btn";
    menuItem.className = "extensionsMenuExtension";
    menuItem.title = "记忆管理并发系统";
    menuItem.innerHTML = `
        <i class="fa-solid fa-brain" style="color: #87CEEB;"></i>
        <span>记忆管理</span>
    `;

    menuItem.addEventListener("click", () => {
        if (togglePanelFn) {
            togglePanelFn();
        }
        const dropdown = document.getElementById("extensionsMenu");
        if (dropdown && dropdown.classList.contains("show")) {
            dropdown.classList.remove("show");
        }
    });

    extensionsMenu.appendChild(menuItem);
    Logger.log("扩展菜单按钮已添加");
}

/**
 * 更新菜单按钮状态
 */
export function updateMenuButtonStatus() {
    const btn = document.getElementById("mm-extension-btn");
    if (!btn) return;

    const enabled = isPluginEnabled();
    const icon = btn.querySelector("i");
    if (icon) {
        icon.style.color = enabled ? "#87CEEB" : "#888";
    }
}

/**
 * 设置处理状态
 * @param {boolean} processing 是否处理中
 */
export function setMenuButtonProcessing(processing) {
    const btn = document.getElementById("mm-extension-btn");
    if (!btn) return;

    const icon = btn.querySelector("i");
    if (icon) {
        if (processing) {
            icon.className = "fa-solid fa-spinner fa-spin";
            icon.style.color = "#FFD700";
        } else {
            icon.className = "fa-solid fa-brain";
            updateMenuButtonStatus();
        }
    }
}
