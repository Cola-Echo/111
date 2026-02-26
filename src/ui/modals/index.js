/**
 * 弹窗模块导出
 * @module ui/modals
 */

/**
 * 为弹窗添加拖拽移动功能
 * @param {HTMLElement} modal - 弹窗外层容器
 * @param {HTMLElement} content - 弹窗内容区域（可拖拽移动的元素）
 * @param {HTMLElement} header - 拖拽手柄（通常是弹窗头部）
 */
export function enableModalDrag(modal, content, header) {
    if (!modal || !content || !header) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    // 设置初始位置样式
    content.style.position = "relative";
    content.style.left = "0px";
    content.style.top = "0px";

    // 设置拖拽手柄样式
    header.style.cursor = "move";
    header.style.userSelect = "none";

    const onMouseDown = (e) => {
        // 忽略按钮点击
        if (e.target.closest('button')) return;

        isDragging = true;
        startX = e.clientX || e.touches?.[0]?.clientX || 0;
        startY = e.clientY || e.touches?.[0]?.clientY || 0;
        initialLeft = parseInt(content.style.left) || 0;
        initialTop = parseInt(content.style.top) || 0;

        document.body.style.userSelect = "none";
        e.preventDefault();
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;

        const clientX = e.clientX || e.touches?.[0]?.clientX || 0;
        const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;

        content.style.left = `${initialLeft + deltaX}px`;
        content.style.top = `${initialTop + deltaY}px`;

        e.preventDefault();
    };

    const onMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.userSelect = "";
        }
    };

    header.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    header.addEventListener("touchstart", onMouseDown, { passive: false });
    document.addEventListener("touchmove", onMouseMove, { passive: false });
    document.addEventListener("touchend", onMouseUp);

    // 返回清理函数
    return () => {
        header.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        header.removeEventListener("touchstart", onMouseDown);
        document.removeEventListener("touchmove", onMouseMove);
        document.removeEventListener("touchend", onMouseUp);
    };
}

// 请求预览弹窗
export { showRequestPreview } from './request-preview';

// 汇总检查弹窗
export { showSummaryCheckModal } from './summary-check';

// 世界书选择器弹窗
export { showWorldBookSelector, hideWorldBookSelector } from './worldbook-selector';

// AI 配置弹窗
export {
    showConfigModal,
    hideConfigModal,
    saveConfig,
    deleteConfig,
    bindConfigModalEvents,
    getCurrentEditing,
    testConnection,
    fetchModels,
    switchConfigTab,
    toggleCustomFormatOptions,
    loadConfigWorldBooks,
    loadConfigCharDescription,
    getConfigSelectedWorldBooks,
    setUpdateDisplayFunctions,
    initPlotOptimizeContextTab,
} from './config-modal';

// 流程配置弹窗
export {
    SOURCE_LABELS,
    loadFlowConfigFromFile,
    getDefaultFlowConfig,
    buildPromptPartsByFlowConfig,
    showFlowConfigModal,
    hideFlowConfigModal,
    renderFlowConfigList,
    autoSaveFlowConfig,
    saveFlowConfig,
    resetFlowConfig,
    importFlowConfig,
    exportFlowConfig,
    initFlowConfigResize,
    bindFlowConfigEvents,
} from './flow-config';

// 提示词编辑器弹窗
export {
    getCurrentPromptType,
    getCurrentPromptFile,
    getCurrentPromptData,
    showPromptEditor,
    hidePromptEditor,
    hasUnsavedChanges,
    switchPromptField,
    loadPromptFiles,
    loadPromptFileContent,
    savePromptFile,
    importPromptFile,
    exportPromptFile,
    saveAsPromptFile,
    deletePromptFile,
    restoreDefaultPrompt,
    switchPromptType,
    bindPromptEditorEvents,
} from './prompt-editor';

// 提示词预设弹窗
export {
    extractPromptsFromPreset,
    extractPromptsFromCurrentPreset,
    getPromptPresets,
    getPromptPresetById,
    savePromptPreset,
    deletePromptPreset,
    buildMessagesFromPreset,
    showPromptPresetModal,
    hidePromptPresetModal,
    renderPromptPresetList,
} from './prompt-preset';

// 独立模式模板编辑弹窗
export {
    showIndependentTemplateModal,
    hideIndependentTemplateModal,
    bindIndependentTemplateEvents,
    saveAllTemplates,
    importTemplates,
    exportTemplates,
} from './independent-template-modal';

// 总结世界书Part配置弹窗
export {
    showSummaryPartConfigModal,
    hidePartConfigModal,
} from './summary-part-config';


