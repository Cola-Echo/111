/**
 * 提示词编辑器模块
 * @module ui/modals/prompt-editor
 */

import Logger from '@core/logger';
import { detectExtensionPath, getExtensionPath } from '@core/constants';
import { getGlobalSettings, updateGlobalSettings } from '@config/config-manager';
import {
    getImportedPromptFiles,
    savePromptFileData,
    deletePromptFileData,
    saveImportedPromptFiles,
    getPromptFileData
} from '@config/prompt-files';

// 内置提示词缓存键前缀（与 prompt-template.js 保持一致）
const BUILTIN_CACHE_PREFIX = '__builtin__';

// 提示词编辑器相关状态
let currentPromptFile = "";
let currentPromptData = null; // 解析后的JSON数据
let currentField = "mainPrompt"; // 当前编辑的字段
let originalPromptDataSnapshot = null; // 用于检测未保存更改

// 内置提示词文件列表（按类型分类）
let BUILTIN_PROMPT_FILES = {
    keywords: [], // 关键词提示词（分类/并发/索引合并）
    historical: [], // 历史事件回忆提示词（总结世界书）
    "plot-optimize": [], // 剧情优化提示词
};

// 当前选中的提示词类型
let currentPromptType = "keywords"; // "keywords", "historical", 或 "plot-optimize"

// 标记事件是否已绑定，避免重复绑定
let promptFileEventsInitialized = false;

// 用于存储 resize 事件处理器的引用，避免内存泄漏
let resizeHandlerCleanup = null;

// 提示词模板缓存（用于清除）
let PROMPT_TEMPLATE = null;
let PROMPT_TEMPLATE_HISTORICAL = null;

/**
 * 设置提示词模板缓存清除函数
 * @param {Function} clearKeywords - 清除关键词模板的函数
 * @param {Function} clearHistorical - 清除历史模板的函数
 */
export function setPromptTemplateClearFunctions(clearKeywords, clearHistorical) {
    // 这个函数用于外部模块注入清除缓存的能力
}

/**
 * 获取当前提示词类型
 */
export function getCurrentPromptType() {
    return currentPromptType;
}

/**
 * 获取当前提示词文件
 */
export function getCurrentPromptFile() {
    return currentPromptFile;
}

/**
 * 获取当前提示词数据
 */
export function getCurrentPromptData() {
    return currentPromptData;
}

/**
 * 显示提示词编辑器
 */
export async function showPromptEditor() {
    const modal = document.getElementById("mm-prompt-editor-modal");
    if (modal) {
        modal.classList.add("mm-modal-visible");

        // 初始化标签状态
        const keywordsBtn = document.getElementById(
            "mm-prompt-type-keywords",
        );
        const historicalBtn = document.getElementById(
            "mm-prompt-type-historical",
        );
        const plotOptimizeBtn = document.getElementById(
            "mm-prompt-type-plot-optimize",
        );
        if (keywordsBtn && historicalBtn && plotOptimizeBtn) {
            keywordsBtn.classList.toggle(
                "mm-tab-active",
                currentPromptType === "keywords",
            );
            historicalBtn.classList.toggle(
                "mm-tab-active",
                currentPromptType === "historical",
            );
            plotOptimizeBtn.classList.toggle(
                "mm-tab-active",
                currentPromptType === "plot-optimize",
            );
        }

        // 显示/隐藏剧情优化模式说明
        updatePlotOptimizeModeHint();

        // 清除缓存的数据，强制重新加载
        currentPromptData = null;
        currentPromptFile = null;

        // 等待文件加载完成
        await loadPromptFiles(currentPromptType);
        initResizableEditor();
    }
}

/**
 * 更新剧情优化模式提示
 */
function updatePlotOptimizeModeHint() {
    const hint = document.getElementById("mm-plot-optimize-mode-hint");
    if (hint) {
        hint.style.display = currentPromptType === "plot-optimize" ? "block" : "none";
    }
}

/**
 * 检查是否有未保存的更改
 */
export function hasUnsavedChanges() {
    if (!currentPromptData || !originalPromptDataSnapshot) return false;

    // 先同步当前编辑器内容到数据
    const editorEl = document.getElementById("mm-prompt-editor");
    if (editorEl && currentPromptData) {
        const promptItem = Array.isArray(currentPromptData)
            ? currentPromptData[0]
            : currentPromptData;
        promptItem[currentField] = editorEl.value;
    }

    // 比较当前数据和原始快照
    const currentSnapshot = JSON.stringify(currentPromptData);
    return currentSnapshot !== originalPromptDataSnapshot;
}

/**
 * 保存当前数据快照（用于检测更改）
 */
function savePromptDataSnapshot() {
    if (currentPromptData) {
        originalPromptDataSnapshot = JSON.stringify(currentPromptData);
    }
}

/**
 * 隐藏提示词编辑器
 * @param {boolean} forceClose - 是否强制关闭（忽略未保存更改）
 * @returns {boolean} 是否成功关闭
 */
export function hidePromptEditor(forceClose = false) {
    // 检查未保存更改
    if (!forceClose && hasUnsavedChanges()) {
        if (!confirm("有未保存的更改，确定要关闭吗？")) {
            return false;
        }
    }

    const modal = document.getElementById("mm-prompt-editor-modal");
    if (modal) {
        modal.classList.remove("mm-modal-visible");
        // 注意：不再清空 currentPromptFile 和 currentPromptData
        // 保留选中状态，下次打开时可以继续编辑
        currentField = "mainPrompt";
        originalPromptDataSnapshot = null;

        // 清理 resize 事件监听器
        if (resizeHandlerCleanup) {
            resizeHandlerCleanup();
            resizeHandlerCleanup = null;
        }
    }
    return true;
}

/**
 * 切换提示词字段
 * @param {string} field - 字段名
 */
export function switchPromptField(field) {
    if (!currentPromptData || !field) return;

    // 保存当前字段的内容到数据中
    const editorEl = document.getElementById("mm-prompt-editor");
    if (editorEl) {
        const currentContent = editorEl.value;
        const promptItem = Array.isArray(currentPromptData)
            ? currentPromptData[0]
            : currentPromptData;
        promptItem[currentField] = currentContent;
    }

    // 切换到新字段
    currentField = field;

    // 更新编辑器内容和标签
    const promptItem = Array.isArray(currentPromptData)
        ? currentPromptData[0]
        : currentPromptData;
    const fieldContent = promptItem[currentField] || "";

    if (editorEl) {
        editorEl.value = fieldContent;
    }

    const fieldLabelEl = document.getElementById("mm-current-field-label");
    if (fieldLabelEl) {
        const fieldLabels = {
            mainPrompt: "主提示词 (数据注入区前)",
            systemPrompt: "辅助提示词 (数据注入区后)",
            finalSystemDirective: "最终注入词",
        };
        fieldLabelEl.innerHTML = `${
            fieldLabels[currentField] || currentField
        } <span class="mm-required">*</span>`;
    }
}

/**
 * 初始化可调整大小的编辑器
 */
function initResizableEditor() {
    // 清理之前的事件监听器
    if (resizeHandlerCleanup) {
        resizeHandlerCleanup();
        resizeHandlerCleanup = null;
    }

    const container = document.querySelector(
        ".mm-resizable-editor-container",
    );
    const editor = document.getElementById("mm-prompt-editor");
    const handle = document.querySelector(".mm-resize-handle");

    if (!container || !editor || !handle) return;

    let isResizing = false;
    let startY, startHeight;

    // 确保编辑器样式正确
    editor.style.width = "100%";
    editor.style.resize = "none";

    function resizeEditor(e) {
        if (!isResizing) return;

        // 支持触摸事件
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        // 只允许垂直方向调整大小，只设置最小高度，不限制最大高度
        const deltaY = clientY - startY;
        const newHeight = Math.max(150, startHeight + deltaY);

        editor.style.height = `${newHeight}px`;

        // 防止文本选择
        e.preventDefault();
    }

    function stopResize() {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            document.removeEventListener("mousemove", resizeEditor);
            document.removeEventListener("mouseup", stopResize);
            document.removeEventListener("touchmove", resizeEditor);
            document.removeEventListener("touchend", stopResize);
        }
    }

    function handleStart(e) {
        isResizing = true;
        // 支持触摸事件
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        startHeight = parseInt(window.getComputedStyle(editor).height, 10);

        // 设置全局光标和禁止选择
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";

        document.addEventListener("mousemove", resizeEditor);
        document.addEventListener("mouseup", stopResize);
        document.addEventListener("touchmove", resizeEditor, {
            passive: false,
        });
        document.addEventListener("touchend", stopResize);

        // 防止文本选择
        e.preventDefault();
    }

    handle.addEventListener("mousedown", handleStart);
    handle.addEventListener("touchstart", handleStart, { passive: false });

    // 保存清理函数
    resizeHandlerCleanup = () => {
        handle.removeEventListener("mousedown", handleStart);
        handle.removeEventListener("touchstart", handleStart);
        document.removeEventListener("mousemove", resizeEditor);
        document.removeEventListener("mouseup", stopResize);
        document.removeEventListener("touchmove", resizeEditor);
        document.removeEventListener("touchend", stopResize);
    };
}

/**
 * 加载指定类型的提示词文件列表
 * @param {string} type - "keywords", "historical" 或 "plot-optimize"
 */
export async function loadPromptFiles(type = currentPromptType) {
    const selectEl = document.getElementById("mm-prompt-file-select");
    if (!selectEl) return;

    currentPromptType = type;

    // 清除所有缓存，确保重新加载时获取最新内容
    PROMPT_TEMPLATE = null;
    PROMPT_TEMPLATE_HISTORICAL = null;
    currentPromptData = null;

    // 获取之前保存的选择
    const settings = getGlobalSettings();
    let selectedFile = "";
    if (type === "keywords") {
        selectedFile =
            settings.keywordsPromptFile || settings.selectedPromptFile;
    } else if (type === "historical") {
        selectedFile = settings.historicalPromptFile;
    } else if (type === "plot-optimize") {
        const plotConfig = settings.plotOptimizeConfig || {};
        selectedFile = plotConfig.promptFile || "";
    }

    const subFolder =
        type === "keywords"
            ? "keywords"
            : type === "historical"
              ? "historical"
              : "plot-optimize";

    try {
        // 清空选择框
        selectEl.innerHTML =
            '<option value="" disabled selected>--- 选择提示词文件 ---</option>';

        // 1. 首先加载已保存/导入文件（按类型过滤）
        const importedFiles = getImportedPromptFiles();
        for (const [fileName, fileData] of Object.entries(importedFiles)) {
            try {
                const jsonData = JSON.parse(fileData);

                // 优先根据文件名前缀判断类型（saveAsPromptFile 保存时使用 ${currentPromptType}_xxx 格式）
                let fileType = "unknown";

                // 检查文件名前缀
                if (fileName.startsWith("keywords_")) {
                    fileType = "keywords";
                } else if (fileName.startsWith("historical_")) {
                    fileType = "historical";
                } else if (fileName.startsWith("plot-optimize_")) {
                    fileType = "plot-optimize";
                } else if (jsonData && typeof jsonData === "object") {
                    // 如果文件名没有类型前缀，则根据内容判断
                    const promptItem = Array.isArray(jsonData)
                        ? jsonData[0]
                        : jsonData;

                    if (promptItem.mainPrompt || promptItem.systemPrompt) {
                        if (
                            promptItem.name &&
                            promptItem.name.includes("关键词")
                        ) {
                            fileType = "keywords";
                        } else if (
                            promptItem.name &&
                            promptItem.name.includes("历史")
                        ) {
                            fileType = "historical";
                        } else if (
                            promptItem.name &&
                            promptItem.name.includes("剧情")
                        ) {
                            fileType = "plot-optimize";
                        } else {
                            const content =
                                JSON.stringify(jsonData).toLowerCase();
                            if (
                                content.includes("关键词") ||
                                content.includes("keywords")
                            ) {
                                fileType = "keywords";
                            } else if (
                                content.includes("历史事件") ||
                                content.includes("历史") ||
                                content.includes("historical")
                            ) {
                                fileType = "historical";
                            } else if (
                                content.includes("剧情优化") ||
                                content.includes("剧情") ||
                                content.includes("plot")
                            ) {
                                fileType = "plot-optimize";
                            }
                        }
                    }
                }

                // 只添加与当前类型匹配的文件
                if (fileType === type) {
                    const promptItem = Array.isArray(jsonData)
                        ? jsonData[0]
                        : jsonData;
                    const displayName =
                        promptItem?.name ||
                        fileName
                            .replace(`${type}_`, "")
                            .replace("imported_", "")
                            .replace(/_\d+\.json$/, "");
                    const option = document.createElement("option");
                    option.value = fileName;
                    option.textContent = displayName + " (自定义)";
                    option.dataset.isImported = "true";
                    option.dataset.fileType = fileType;
                    selectEl.appendChild(option);
                }
            } catch (e) {
                Logger.error(`加载文件 ${fileName} 失败:`, e);
            }
        }

        // 2. 自动扫描对应子目录中的 JSON 文件
        await detectExtensionPath();

        // 清空该类型的内置文件列表
        BUILTIN_PROMPT_FILES[type] = [];

        // 使用 Set 存储文件列表，自动去重
        const detectedFiles = new Set();

        // 读取 manifest.json 文件获取文件列表
        try {
            const basePath = getExtensionPath();
            const manifestPath = `${basePath}/prompts/manifest.json?_t=${Date.now()}`;
            const manifestResponse = await fetch(manifestPath, {
                cache: "no-store",
            });
            if (manifestResponse.ok) {
                const manifest = await manifestResponse.json();
                const typeKey =
                    type === "keywords"
                        ? "keywords"
                        : type === "historical"
                          ? "historical"
                          : "plot-optimize";
                if (
                    manifest.files &&
                    Array.isArray(manifest.files[typeKey])
                ) {
                    let addedFromManifest = 0;
                    for (const file of manifest.files[typeKey]) {
                        if (
                            file.endsWith(".json") &&
                            !detectedFiles.has(file)
                        ) {
                            detectedFiles.add(file);
                            addedFromManifest++;
                        }
                    }
                    Logger.debug(
                        `[提示词] 通过 manifest.json 额外获取到 ${addedFromManifest} 个文件`,
                    );
                }
            }
        } catch (e) {
            Logger.debug(`[提示词] manifest.json 不可用，忽略`);
        }

        // 注意：已移除 HEAD 请求探测，因为 SillyTavern 服务器不支持 HEAD 方法
        // 改为完全依赖 manifest.json，如果 manifest.json 不存在则使用默认文件列表

        // 如果 manifest.json 没有找到文件，添加默认文件列表
        if (detectedFiles.size === 0) {
            const defaultFiles = {
                keywords: ["default_keywords.json"],
                historical: ["default_historical.json"],
                "plot-optimize": ["default_plot_optimize.json"],
            };
            const defaults = defaultFiles[type] || [];
            for (const file of defaults) {
                detectedFiles.add(file);
            }
            Logger.debug(`[提示词] 使用默认文件列表: ${defaults.join(", ")}`);
        }

        // 转换 Set 为数组，更新内置文件列表
        BUILTIN_PROMPT_FILES[type] = Array.from(detectedFiles);
        Logger.debug(
            `[提示词] 共发现 ${BUILTIN_PROMPT_FILES[type].length} 个内置文件:`,
            BUILTIN_PROMPT_FILES[type],
        );

        // 清理重复选项
        const customOptions = [];

        for (let i = 0; i < selectEl.options.length; i++) {
            const option = selectEl.options[i];
            if (option.dataset.isImported === "true") {
                customOptions.push(option.cloneNode(true));
            }
        }

        // 清空选择框，只保留默认选项
        selectEl.innerHTML =
            '<option value="" disabled selected>--- 选择提示词文件 ---</option>';

        // 重新添加自定义文件
        customOptions.forEach((option) => selectEl.appendChild(option));

        // 加载内置文件
        for (const file of BUILTIN_PROMPT_FILES[type]) {
            const importedKey = `${type}_${file}`;
            const hasImportedVersion = !!importedFiles[importedKey];
            const builtinCacheKey = `${BUILTIN_CACHE_PREFIX}${subFolder}/${file}`;

            try {
                let jsonContent = null;

                // 1. 优先从持久化缓存加载
                if (importedFiles[builtinCacheKey]) {
                    try {
                        jsonContent = JSON.parse(importedFiles[builtinCacheKey]);
                        Logger.debug(`[提示词编辑器] 使用持久化缓存: ${file}`);
                    } catch (e) {
                        Logger.warn(`[提示词编辑器] 解析持久化缓存失败: ${file}`);
                        jsonContent = null;
                    }
                }

                // 2. 持久化缓存不存在，从服务器获取
                if (!jsonContent) {
                    const encodedFile = encodeURIComponent(file);
                    const basePath = getExtensionPath();
                    const filePath = `${basePath}/prompts/${subFolder}/${encodedFile}?_t=${Date.now()}`;
                    const response = await fetch(filePath, {
                        cache: "no-store",
                    });
                    if (response.ok) {
                        jsonContent = await response.json();

                        // 3. 服务器获取成功，保存到持久化缓存
                        try {
                            savePromptFileData(builtinCacheKey, JSON.stringify(jsonContent));
                            Logger.debug(`[提示词编辑器] 已保存到持久化缓存: ${file}`);
                        } catch (cacheError) {
                            Logger.warn(`[提示词编辑器] 保存持久化缓存失败: ${file}`, cacheError);
                        }
                    }
                }

                if (jsonContent) {
                    const promptItem = Array.isArray(jsonContent)
                        ? jsonContent[0]
                        : jsonContent;
                    const displayName = promptItem?.name || file;
                    const option = document.createElement("option");
                    option.value = `${subFolder}/${file}`;

                    option.textContent = hasImportedVersion
                        ? displayName + " (内置-有修改)"
                        : displayName + " (内置)";
                    option.dataset.isBuiltin = "true";
                    option.dataset.subFolder = subFolder;
                    option.dataset.hasImportedVersion =
                        hasImportedVersion.toString();
                    selectEl.appendChild(option);
                }
            } catch (e) {
                Logger.warn(`加载内置文件 ${file} 失败:`, e);
            }
        }

        // 只绑定一次事件
        if (!promptFileEventsInitialized) {
            selectEl.addEventListener("change", (e) => {
                const value = e.target.value;
                if (value) {
                    loadPromptFileContent(value);
                }
            });

            const fieldSelectEl = document.getElementById(
                "mm-prompt-field-select",
            );
            if (fieldSelectEl) {
                fieldSelectEl.addEventListener("change", (e) => {
                    switchPromptField(e.target.value);
                });
            }

            promptFileEventsInitialized = true;
        }

        // 恢复之前选中的文件
        let fileToSelect = selectedFile;
        if (
            !fileToSelect ||
            !Array.from(selectEl.options).some(
                (opt) => opt.value === fileToSelect,
            )
        ) {
            const firstValidOption = Array.from(selectEl.options).find(
                (opt) => opt.value && !opt.disabled,
            );
            if (firstValidOption) {
                fileToSelect = firstValidOption.value;
                // 保存自动选择的文件
                if (type === "keywords") {
                    updateGlobalSettings({
                        keywordsPromptFile: fileToSelect,
                    });
                } else if (type === "historical") {
                    updateGlobalSettings({
                        historicalPromptFile: fileToSelect,
                    });
                } else if (type === "plot-optimize") {
                    const plotConfig =
                        getGlobalSettings().plotOptimizeConfig || {};
                    updateGlobalSettings({
                        plotOptimizeConfig: {
                            ...plotConfig,
                            promptFile: fileToSelect,
                        },
                    });
                }
            }
        }

        if (fileToSelect) {
            const optionExists = Array.from(selectEl.options).some(
                (opt) => opt.value === fileToSelect,
            );
            if (optionExists) {
                selectEl.value = fileToSelect;
                loadPromptFileContent(fileToSelect);
            }
        }
    } catch (error) {
        Logger.error("加载提示词文件列表失败:", error);
        alert(`加载提示词文件列表失败: ${error.message}`);
    }
}

/**
 * 加载提示词文件内容
 * @param {string} filename - 文件名
 * @param {boolean} forceFromFile - 是否强制从文件加载
 */
export async function loadPromptFileContent(filename, forceFromFile = false) {
    if (!filename) return;

    // 清除所有缓存数据
    currentPromptData = null;
    PROMPT_TEMPLATE = null;
    PROMPT_TEMPLATE_HISTORICAL = null;

    // 立即清空编辑器，避免显示旧内容
    const editorEl = document.getElementById("mm-prompt-editor");
    if (editorEl) {
        editorEl.value = "加载中...";
    }

    try {
        // 检查是否是内置文件路径
        const isBuiltinPath = filename.includes("/");

        // 检查是否是已保存的文件
        const importedFiles = getImportedPromptFiles();

        if (!isBuiltinPath && !forceFromFile && importedFiles[filename]) {
            // 从 extensionSettings 加载
            const jsonData = JSON.parse(importedFiles[filename]);
            currentPromptFile = filename;
            currentPromptData = jsonData;

            // 根据当前类型保存选择
            if (currentPromptType === "keywords") {
                updateGlobalSettings({ keywordsPromptFile: filename });
            } else if (currentPromptType === "historical") {
                updateGlobalSettings({ historicalPromptFile: filename });
            } else if (currentPromptType === "plot-optimize") {
                const plotConfig =
                    getGlobalSettings().plotOptimizeConfig || {};
                updateGlobalSettings({
                    plotOptimizeConfig: {
                        ...plotConfig,
                        promptFile: filename,
                    },
                });
            }

            // 获取当前字段的内容
            const promptItem = Array.isArray(jsonData)
                ? jsonData[0]
                : jsonData;
            const fieldContent = promptItem[currentField] || "";

            const editorEl = document.getElementById("mm-prompt-editor");
            const fieldLabelEl = document.getElementById(
                "mm-current-field-label",
            );
            if (editorEl) {
                editorEl.value = fieldContent;
            }

            // 更新字段标签
            if (fieldLabelEl) {
                const fieldLabels = {
                    mainPrompt: "主提示词 (数据注入区前)",
                    systemPrompt: "辅助提示词 (数据注入区后)",
                    finalSystemDirective: "最终注入词",
                };
                fieldLabelEl.innerHTML = `${
                    fieldLabels[currentField] || currentField
                } <span class="mm-required">*</span>`;
            }

            // 保存快照用于检测更改
            savePromptDataSnapshot();
            return;
        }

        // 否则加载内置文件（优先持久化缓存，除非强制刷新）
        const builtinCacheKey = `${BUILTIN_CACHE_PREFIX}${filename}`;
        let jsonData = null;

        // 1. 优先从持久化缓存加载（非强制刷新时）
        if (!forceFromFile && importedFiles[builtinCacheKey]) {
            try {
                jsonData = JSON.parse(importedFiles[builtinCacheKey]);
                Logger.debug(`[提示词编辑器] 使用持久化缓存: ${filename}`);
            } catch (e) {
                Logger.warn(`[提示词编辑器] 解析持久化缓存失败: ${filename}`);
                jsonData = null;
            }
        }

        // 2. 持久化缓存不存在或强制刷新，从服务器获取
        if (!jsonData) {
            await detectExtensionPath();
            const basePath = getExtensionPath();
            const parts = filename.split("/");
            const encodedParts = parts.map((p) => encodeURIComponent(p));
            const encodedFilename = encodedParts.join("/");
            const cacheBuster = `_t=${Date.now()}_r=${Math.random()
                .toString(36)
                .substring(7)}`;
            const filePath = `${basePath}/prompts/${encodedFilename}?${cacheBuster}`;
            const response = await fetch(filePath, {
                cache: "no-store",
                headers: {
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    Pragma: "no-cache",
                    Expires: "0",
                },
            });
            if (!response.ok) {
                throw new Error(
                    `Failed to fetch prompt file: ${response.status}`,
                );
            }

            jsonData = await response.json();

            // 3. 服务器获取成功，保存到持久化缓存
            try {
                savePromptFileData(builtinCacheKey, JSON.stringify(jsonData));
                Logger.debug(`[提示词编辑器] 已保存到持久化缓存: ${filename}`);
            } catch (cacheError) {
                Logger.warn(`[提示词编辑器] 保存持久化缓存失败: ${filename}`, cacheError);
            }
        }

        currentPromptFile = filename;
        currentPromptData = jsonData;

        // 根据当前类型保存选择
        if (currentPromptType === "keywords") {
            updateGlobalSettings({ keywordsPromptFile: filename });
        } else if (currentPromptType === "historical") {
            updateGlobalSettings({ historicalPromptFile: filename });
        } else if (currentPromptType === "plot-optimize") {
            const plotConfig = getGlobalSettings().plotOptimizeConfig || {};
            updateGlobalSettings({
                plotOptimizeConfig: { ...plotConfig, promptFile: filename },
            });
        }

        // 获取当前字段的内容
        const promptItem = Array.isArray(jsonData) ? jsonData[0] : jsonData;
        const fieldContent = promptItem[currentField] || "";

        const editorEl = document.getElementById("mm-prompt-editor");
        const fieldLabelEl = document.getElementById(
            "mm-current-field-label",
        );
        if (editorEl) {
            editorEl.value = fieldContent;
        }

        // 更新字段标签
        if (fieldLabelEl) {
            const fieldLabels = {
                mainPrompt: "主提示词 (数据注入区前)",
                systemPrompt: "辅助提示词 (数据注入区后)",
                finalSystemDirective: "最终注入词",
            };
            fieldLabelEl.innerHTML = `${
                fieldLabels[currentField] || currentField
            } <span class="mm-required">*</span>`;
        }

        // 保存快照用于检测更改
        savePromptDataSnapshot();
    } catch (error) {
        Logger.error("加载提示词文件内容失败:", error);
        alert(`加载提示词文件内容失败: ${error.message}`);
    }
}

/**
 * 保存提示词文件
 */
export async function savePromptFile() {
    if (!currentPromptData) {
        alert("请先选择或导入提示词文件");
        return;
    }

    const editorEl = document.getElementById("mm-prompt-editor");
    if (!editorEl) return;

    // 检查是否是内置文件
    const isBuiltinFile =
        currentPromptFile && currentPromptFile.includes("/");
    if (isBuiltinFile) {
        alert(
            "内置提示词文件不能直接修改！\n\n请使用「另存为」按钮保存为新文件。",
        );
        return;
    }

    // 保存当前字段的内容到数据中
    const newContent = editorEl.value;
    const promptItem = Array.isArray(currentPromptData)
        ? currentPromptData[0]
        : currentPromptData;
    promptItem[currentField] = newContent;

    try {
        // 转换回JSON格式
        const jsonString = JSON.stringify(currentPromptData, null, 2);

        // 保存到 extensionSettings
        savePromptFileData(currentPromptFile, jsonString);

        // 标记当前文件为已导入
        const selectEl = document.getElementById("mm-prompt-file-select");
        if (selectEl) {
            const selectedOption = selectEl.options[selectEl.selectedIndex];
            if (
                selectedOption &&
                selectedOption.dataset.isImported !== "true"
            ) {
                selectedOption.dataset.isImported = "true";
                const displayName = promptItem?.name || currentPromptFile;
                selectedOption.textContent = displayName + " (已修改)";
            }
        }

        // 更新快照
        savePromptDataSnapshot();
        alert("提示词已保存！（支持跨浏览器同步）");
    } catch (error) {
        Logger.error("保存提示词文件失败:", error);

        // 保存失败，使用下载替代方案
        try {
            const promptItem = Array.isArray(currentPromptData)
                ? currentPromptData[0]
                : currentPromptData;
            const fileName =
                currentPromptFile ||
                (promptItem.name || "prompt") + ".json";

            const jsonString = JSON.stringify(currentPromptData, null, 2);
            const blob = new Blob([jsonString], {
                type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            alert(
                `保存失败，已将文件下载到本地！\n错误信息: ${error.message}`,
            );
        } catch (downloadError) {
            alert(`保存失败: ${downloadError.message}`);
        }
    }
}

/**
 * 导入提示词文件
 */
export function importPromptFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const jsonData = JSON.parse(e.target.result);
                    currentPromptData = jsonData;

                    const promptItem = Array.isArray(jsonData)
                        ? jsonData[0]
                        : jsonData;
                    const fieldContent = promptItem[currentField] || "";

                    const tempFileName = "imported_" + Date.now() + ".json";

                    savePromptFileData(
                        tempFileName,
                        JSON.stringify(jsonData, null, 2),
                    );

                    const selectEl = document.getElementById(
                        "mm-prompt-file-select",
                    );
                    if (selectEl) {
                        const option = document.createElement("option");
                        option.value = tempFileName;
                        option.textContent =
                            promptItem.name || "已导入的提示词";
                        option.dataset.isImported = "true";
                        selectEl.appendChild(option);
                        selectEl.value = tempFileName;
                    }

                    const editorEl =
                        document.getElementById("mm-prompt-editor");
                    const fieldLabelEl = document.getElementById(
                        "mm-current-field-label",
                    );
                    if (editorEl) {
                        editorEl.value = fieldContent;
                        currentPromptFile = tempFileName;
                    }

                    if (fieldLabelEl) {
                        const fieldLabels = {
                            mainPrompt: "主提示词内容",
                            systemPrompt: "辅助提示词内容",
                            finalSystemDirective: "最终注入词内容",
                        };
                        fieldLabelEl.innerHTML = `${
                            fieldLabels[currentField] || currentField
                        } <span class="mm-required">*</span>`;
                    }

                    updateGlobalSettings({
                        selectedPromptFile: tempFileName,
                    });

                    savePromptDataSnapshot();
                    alert("提示词文件导入成功！（支持跨浏览器同步）");
                } catch (error) {
                    alert(`导入失败: ${error.message}`);
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

/**
 * 导出提示词文件
 */
export function exportPromptFile() {
    if (!currentPromptData) {
        alert("请先选择或导入提示词文件");
        return;
    }

    const editorEl = document.getElementById("mm-prompt-editor");
    if (!editorEl) return;

    const promptItem = Array.isArray(currentPromptData)
        ? currentPromptData[0]
        : currentPromptData;
    promptItem[currentField] = editorEl.value;

    const promptName =
        promptItem?.name ||
        `custom-prompt-${new Date().toISOString().slice(0, 10)}`;

    const jsonContent = Array.isArray(currentPromptData)
        ? currentPromptData
        : [currentPromptData];

    const blob = new Blob([JSON.stringify(jsonContent, null, 2)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${promptName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 另存为新文件
 */
export function saveAsPromptFile() {
    if (!currentPromptData) {
        alert("请先选择或导入提示词文件");
        return;
    }

    const editorEl = document.getElementById("mm-prompt-editor");
    if (!editorEl) return;

    const newContent = editorEl.value;
    const promptItem = Array.isArray(currentPromptData)
        ? currentPromptData[0]
        : currentPromptData;
    promptItem[currentField] = newContent;

    const defaultName = promptItem.name || "custom-prompt";
    const fileName = prompt(
        "请输入新文件名（无需.json后缀）:",
        defaultName,
    );
    if (!fileName) return;

    try {
        const newPromptItem = Array.isArray(currentPromptData)
            ? currentPromptData[0]
            : currentPromptData;
        newPromptItem.name = fileName;

        const jsonString = JSON.stringify(currentPromptData, null, 2);
        const uniqueFileName = `${currentPromptType}_${fileName}_${Date.now()}.json`;

        savePromptFileData(uniqueFileName, jsonString);

        const selectEl = document.getElementById("mm-prompt-file-select");
        if (selectEl) {
            const option = document.createElement("option");
            option.value = uniqueFileName;
            option.textContent = fileName + " (自定义)";
            option.dataset.isImported = "true";
            option.dataset.fileType = currentPromptType;
            selectEl.appendChild(option);

            selectEl.value = uniqueFileName;
            currentPromptFile = uniqueFileName;
        }

        // 根据当前类型保存选择（关键修复：确保切换类型后能找回文件）
        if (currentPromptType === "keywords") {
            updateGlobalSettings({
                keywordsPromptFile: uniqueFileName,
                selectedPromptFile: uniqueFileName
            });
        } else if (currentPromptType === "historical") {
            updateGlobalSettings({
                historicalPromptFile: uniqueFileName,
                selectedPromptFile: uniqueFileName
            });
        } else if (currentPromptType === "plot-optimize") {
            const plotConfig = getGlobalSettings().plotOptimizeConfig || {};
            updateGlobalSettings({
                plotOptimizeConfig: {
                    ...plotConfig,
                    promptFile: uniqueFileName,
                },
                selectedPromptFile: uniqueFileName
            });
        }

        // 保存快照
        savePromptDataSnapshot();

        alert(`提示词文件 "${fileName}" 已保存！（支持跨浏览器同步）`);
    } catch (error) {
        Logger.error("另存为提示词文件失败:", error);
        alert(`另存为失败: ${error.message}`);
    }
}

/**
 * 删除当前文件
 */
export function deletePromptFile() {
    if (!currentPromptFile) {
        alert("请先选择要删除的提示词文件");
        return;
    }

    const selectEl = document.getElementById("mm-prompt-file-select");
    const selectedOption = selectEl?.options[selectEl.selectedIndex];
    const isImported = selectedOption?.dataset.isImported === "true";

    if (!isImported) {
        alert("只能删除导入或修改过的提示词文件，内置文件不能删除");
        return;
    }

    if (
        !confirm(
            `确定要删除提示词文件 "${selectedOption.textContent}" 吗？`,
        )
    ) {
        return;
    }

    try {
        const optionValue = selectedOption.value;

        deletePromptFileData(optionValue);

        const importedFiles = getImportedPromptFiles();
        delete importedFiles[optionValue];
        saveImportedPromptFiles(importedFiles);

        if (selectEl && selectedOption) {
            selectEl.removeChild(selectedOption);
            selectEl.value = "";
            currentPromptFile = null;
            currentPromptData = null;
        }

        const editorEl = document.getElementById("mm-prompt-editor");
        if (editorEl) {
            editorEl.value = "";
        }

        loadPromptFiles(currentPromptType);
        alert("提示词文件已删除！");
    } catch (error) {
        Logger.error("删除提示词文件失败:", error);
        alert(`删除失败: ${error.message}`);
    }
}

/**
 * 恢复默认提示词
 */
export async function restoreDefaultPrompt() {
    const selectEl = document.getElementById("mm-prompt-file-select");

    const defaultFileNames = {
        keywords: "keywords/default_keywords.json",
        historical: "historical/default_historical.json",
        "plot-optimize": "plot-optimize/default_plot_optimize.json",
    };

    let promptType = currentPromptType;
    if (!promptType && currentPromptFile) {
        if (currentPromptFile.includes("keywords/")) {
            promptType = "keywords";
        } else if (currentPromptFile.includes("historical/")) {
            promptType = "historical";
        } else if (currentPromptFile.includes("plot-optimize/")) {
            promptType = "plot-optimize";
        }
    }

    if (!promptType) {
        promptType = "keywords";
    }

    const defaultFileName = defaultFileNames[promptType];

    if (!defaultFileName) {
        alert("无法确定默认提示词文件");
        return;
    }

    if (
        !confirm(
            "确定要恢复默认提示词吗？\n\n这将切换到内置的默认提示词文件，您的自定义提示词不会被删除，可以随时切换回来。",
        )
    ) {
        return;
    }

    try {
        PROMPT_TEMPLATE = null;
        PROMPT_TEMPLATE_HISTORICAL = null;
        currentPromptData = null;

        // 清除该内置文件的持久化缓存，强制从服务器重新获取最新版本
        const builtinCacheKey = `${BUILTIN_CACHE_PREFIX}${defaultFileName}`;
        const importedFiles = getImportedPromptFiles();
        if (importedFiles[builtinCacheKey]) {
            delete importedFiles[builtinCacheKey];
            saveImportedPromptFiles(importedFiles);
            Logger.debug(`[提示词编辑器] 已清除持久化缓存: ${defaultFileName}`);
        }

        let hasDefaultOption = false;
        for (let i = 0; i < selectEl.options.length; i++) {
            if (selectEl.options[i].value === defaultFileName) {
                hasDefaultOption = true;
                break;
            }
        }

        if (!hasDefaultOption) {
            await loadPromptFiles(promptType);
        }

        selectEl.value = defaultFileName;

        if (promptType === "keywords") {
            updateGlobalSettings({ keywordsPromptFile: defaultFileName });
        } else if (promptType === "historical") {
            updateGlobalSettings({ historicalPromptFile: defaultFileName });
        } else if (promptType === "plot-optimize") {
            const plotConfig = getGlobalSettings().plotOptimizeConfig || {};
            updateGlobalSettings({
                plotOptimizeConfig: {
                    ...plotConfig,
                    promptFile: defaultFileName,
                },
            });
        }

        // 强制从服务器加载（forceFromFile = true）
        await loadPromptFileContent(defaultFileName, true);
        alert("已恢复默认提示词！（已从服务器获取最新版本）");
    } catch (error) {
        Logger.error("恢复默认提示词失败:", error);
        alert(`恢复失败: ${error.message}`);
    }
}

/**
 * 切换提示词类型
 * @param {string} type - 提示词类型
 */
export async function switchPromptType(type) {
    currentPromptType = type;

    // 更新标签状态
    const keywordsBtn = document.getElementById("mm-prompt-type-keywords");
    const historicalBtn = document.getElementById("mm-prompt-type-historical");
    const plotOptimizeBtn = document.getElementById("mm-prompt-type-plot-optimize");

    if (keywordsBtn) keywordsBtn.classList.toggle("mm-tab-active", type === "keywords");
    if (historicalBtn) historicalBtn.classList.toggle("mm-tab-active", type === "historical");
    if (plotOptimizeBtn) plotOptimizeBtn.classList.toggle("mm-tab-active", type === "plot-optimize");

    // 更新剧情优化模式提示
    updatePlotOptimizeModeHint();

    // 重新加载文件列表
    await loadPromptFiles(type);
}

/**
 * 绑定提示词编辑器事件
 */
export function bindPromptEditorEvents() {
    // 保存按钮
    document.getElementById("mm-prompt-save")
        ?.addEventListener("click", savePromptFile);

    // 导入按钮
    document.getElementById("mm-prompt-import")
        ?.addEventListener("click", importPromptFile);

    // 导出按钮
    document.getElementById("mm-prompt-export")
        ?.addEventListener("click", exportPromptFile);

    // 另存为按钮
    document.getElementById("mm-prompt-save-as")
        ?.addEventListener("click", saveAsPromptFile);

    // 删除按钮
    document.getElementById("mm-prompt-delete")
        ?.addEventListener("click", deletePromptFile);

    // 恢复默认按钮
    document.getElementById("mm-prompt-restore-default")
        ?.addEventListener("click", restoreDefaultPrompt);

    // 关闭按钮
    document.getElementById("mm-prompt-editor-close")
        ?.addEventListener("click", () => hidePromptEditor());

    // 类型切换标签
    document.getElementById("mm-prompt-type-keywords")
        ?.addEventListener("click", () => switchPromptType("keywords"));

    document.getElementById("mm-prompt-type-historical")
        ?.addEventListener("click", () => switchPromptType("historical"));

    document.getElementById("mm-prompt-type-plot-optimize")
        ?.addEventListener("click", () => switchPromptType("plot-optimize"));
}
