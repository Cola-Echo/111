/**
 * 面板模板加载模块
 * @module ui/template-loader
 */

import Logger from '@core/logger';
import { detectExtensionPath } from '@core/constants';
import { getGlobalSettings } from '@config/config-manager';

/**
 * 加载面板模板
 */
export async function loadPanelTemplate() {
    try {
        const basePath = await detectExtensionPath();
        const response = await fetch(`${basePath}/ui/panel.html`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const html = await response.text();

        const container = document.createElement("div");
        container.innerHTML = html;

        while (container.firstElementChild) {
            document.body.appendChild(container.firstElementChild);
        }

        Logger.debug("面板模板已加载");
    } catch (e) {
        Logger.error("加载面板模板失败:", e);
    }
}

/**
 * 加载设置模板
 */
export async function loadSettingsTemplate() {
    try {
        const basePath = await detectExtensionPath();
        const response = await fetch(`${basePath}/ui/settings.html`);
        const html = await response.text();

        const container = document.createElement("div");
        container.innerHTML = html;

        const settingsPanel = container.querySelector("#memory-manager-settings");
        const configModal = container.querySelector("#mm-ai-config-modal");
        const plotOptimizeModal = container.querySelector("#mm-plot-optimize-modal");
        const flowConfigModal = container.querySelector("#mm-flow-config-modal");
        const multiAIConfigModal = container.querySelector("#mm-multi-ai-config-modal");

        if (settingsPanel) document.body.appendChild(settingsPanel);
        if (configModal) document.body.appendChild(configModal);
        if (plotOptimizeModal) document.body.appendChild(plotOptimizeModal);
        if (flowConfigModal) document.body.appendChild(flowConfigModal);
        if (multiAIConfigModal) document.body.appendChild(multiAIConfigModal);

        Logger.debug("设置模板已加载");
    } catch (e) {
        Logger.error("加载设置模板失败:", e);
    }
}

/**
 * 加载剧情优化助手面板模板
 */
export async function loadPlotOptimizePanelTemplate() {
    try {
        const basePath = await detectExtensionPath();
        const response = await fetch(`${basePath}/ui/plot-optimize-panel.html`);
        if (!response.ok) {
            Logger.warn("剧情优化面板模板加载失败:", response.status);
            return;
        }
        const html = await response.text();

        const container = document.createElement("div");
        container.innerHTML = html;

        const plotPanel = container.querySelector("#mm-plot-optimize-panel");
        if (plotPanel) {
            document.body.appendChild(plotPanel);
            const settings = getGlobalSettings();
            const theme = settings.theme || "default";
            if (theme !== "default") {
                plotPanel.setAttribute("data-mm-theme", theme);
            }
            Logger.debug("剧情优化面板模板已加载");
        }
    } catch (e) {
        Logger.error("加载剧情优化面板模板失败:", e);
    }
}

/**
 * 加载记忆搜索助手对话面板模板
 */
export async function loadSearchDialogTemplate() {
    try {
        const basePath = await detectExtensionPath();
        const response = await fetch(`${basePath}/ui/search-dialog.html`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const html = await response.text();

        const container = document.createElement("div");
        container.innerHTML = html;

        const searchDialog = container.querySelector("#mm-search-dialog");
        if (searchDialog) {
            document.body.appendChild(searchDialog);
            const settings = getGlobalSettings();
            const theme = settings.theme || "default";
            if (theme !== "default") {
                searchDialog.setAttribute("data-mm-theme", theme);
            }
            Logger.debug("记忆搜索助手对话面板模板已加载");
        }
    } catch (e) {
        Logger.error("加载记忆搜索助手对话面板模板失败:", e);
    }
}

/**
 * 加载所有模板
 */
export async function loadAllTemplates() {
    await Promise.all([
        loadPanelTemplate(),
        loadSettingsTemplate(),
        loadPlotOptimizePanelTemplate(),
        loadSearchDialogTemplate(),
    ]);
    Logger.log("所有模板加载完成");
}
