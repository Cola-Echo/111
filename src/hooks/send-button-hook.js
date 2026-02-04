/**
 * 发送按钮钩子模块
 * @module hooks/send-button-hook
 */

import Logger from '@core/logger';
import { getContext, getEventSource, getEventTypes } from '@core/sillytavern-api';
import { isPluginEnabled, getGlobalSettings, loadConfig, saveConfig } from '@config/config-manager';
import { getProgressTracker } from '@ui/components/progress-tracker';
import { setMenuButtonProcessing } from '@ui/menu-button';
import { setFloatBallProcessing } from '@ui/float-ball';

// 处理状态
let isProcessing = false;
let skipNextHook = false;
let abortController = null;
let hookInstalled = false;
let currentHookedButton = null; // 追踪当前被hook的按钮元素

// 记忆处理回调（将在初始化时注入）
let processMemoryCallback = null;

/**
 * 设置记忆处理回调
 * @param {Function} callback 记忆处理函数
 */
export function setProcessMemoryCallback(callback) {
    processMemoryCallback = callback;
}

/**
 * 获取处理状态
 * @returns {boolean}
 */
export function getIsProcessing() {
    return isProcessing;
}

/**
 * 设置处理状态
 * @param {boolean} value
 */
export function setIsProcessing(value) {
    isProcessing = value;
}

/**
 * 终止处理
 */
export function stopProcessing() {
    const progressTracker = getProgressTracker();

    // 终止所有任务
    if (progressTracker && progressTracker.taskAbortControllers) {
        for (const [taskId, controller] of progressTracker.taskAbortControllers) {
            controller.abort();
        }
        Logger.warn("用户终止了所有处理");

        // 重置进度追踪器，清除 UI
        progressTracker.reset();
    }

    // 终止全局 abortController
    if (abortController) {
        abortController.abort();
        abortController = null;
    }

    isProcessing = false;
    setMenuButtonProcessing(false);
    setFloatBallProcessing(false);
}

/**
 * 创建新的 AbortController
 * @returns {AbortController}
 */
export function createAbortController() {
    abortController = new AbortController();
    return abortController;
}

/**
 * 获取当前 AbortController
 * @returns {AbortController|null}
 */
export function getAbortController() {
    return abortController;
}

/**
 * 获取跳过下一次 hook 的状态
 * @returns {boolean}
 */
export function getSkipNextHook() {
    return skipNextHook;
}

/**
 * 设置跳过下一次 hook
 * @param {boolean} value
 */
export function setSkipNextHook(value) {
    skipNextHook = value;
}

/**
 * 获取已导入的世界书名称列表
 * @returns {string[]}
 */
function getImportedBookNames() {
    try {
        const config = loadConfig();
        if (config && config.importedBooks) {
            return config.importedBooks;
        }
        // 回退到 localStorage（兼容旧数据）
        const saved = localStorage.getItem("memory_manager_imported_books");
        if (saved) {
            const books = JSON.parse(saved);
            // 迁移到配置中
            if (config) {
                config.importedBooks = books;
                saveConfig(config);
                Logger.log("已导入世界书列表已迁移到配置");
            }
            return books;
        }
        return [];
    } catch (e) {
        Logger.error("加载已导入世界书列表失败:", e);
        return [];
    }
}

/**
 * 获取记忆搜索助手设置
 * @returns {Object}
 */
function getMemorySearchAssistantSettings() {
    const settings = getGlobalSettings();
    return {
        enabled: settings.enableInteractiveSearch === true,
    };
}

/**
 * 检查剧情优化是否启用
 * @returns {boolean}
 */
function isPlotOptimizeEnabled() {
    const settings = getGlobalSettings();
    return settings.enablePlotOptimize === true;
}

/**
 * 钩住发送按钮
 * 使用原生事件监听器，捕获阶段触发，确保优先处理
 */
export function hookSendButton() {
    Logger.log("🔧 [发送前检查] hookSendButton 被调用");

    // SillyTavern 的发送按钮 ID 是 send_but
    const sendButton = document.getElementById("send_but");
    const sendTextarea = document.getElementById("send_textarea");

    Logger.log("🔍 [发送前检查] 查找元素", {
        sendButton: !!sendButton,
        sendTextarea: !!sendTextarea,
    });

    if (!sendButton || !sendTextarea) {
        Logger.warn("⚠️ [发送前检查] 元素未就绪，2秒后重试...");
        setTimeout(hookSendButton, 2000);
        return;
    }

    // 检查是否需要重新安装（按钮元素变化了）
    if (hookInstalled && currentHookedButton === sendButton) {
        Logger.log("✅ [发送前检查] Hook 已安装在当前按钮上，跳过重复安装");
        return;
    }

    // 如果之前安装过但按钮变了，需要重新安装
    if (hookInstalled && currentHookedButton !== sendButton) {
        Logger.log("�� [发送前检查] 检测到按钮元素变化，重新安装 Hook");
        hookInstalled = false;
    }

    const btn = sendButton;
    const textarea = sendTextarea;

    // 创建点击处理函数
    async function handleSendWithMemory(event) {
        Logger.log("🔍 [记忆管理] 点击事件触发, skipNextHook=", skipNextHook, "isPluginEnabled=", isPluginEnabled());

        // 如果设置了跳过标志，直接放行
        if (skipNextHook) {
            skipNextHook = false;
            return;
        }

        // 如果插件禁用，直接返回让原始处理继续
        if (!isPluginEnabled()) {
            Logger.log("⚠️ [记忆管理] 插件未启用，跳过拦截");
            return;
        }

        // 如果正在处理中，阻止重复发送
        if (isProcessing) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            Logger.warn("正在处理中，请稍候...");
            return;
        }

        // 获取用户输入
        const userMessage = textarea.value.trim();

        // 如果没有输入内容，让原始处理继续
        if (!userMessage) {
            return;
        }

        // 检查是否有需要处理的世界书
        const importedBooks = getImportedBookNames();
        Logger.log("📚 [记忆管理] 导入的世界书:", importedBooks);

        if (importedBooks.length === 0) {
            // 没有导入世界书，直接放行（不需要拦截）
            Logger.log("⚠️ [记忆管理] 未导入世界书，跳过记忆处理");
            return;
        }

        const globalSettings = getGlobalSettings();
        const memorySearchSettings = getMemorySearchAssistantSettings();

        // 检查是否需要用户交互的功能（记忆搜索助手、剧情优化）
        // 注意：发送前检查弹窗（showRequestPreview）不再作为拦截条件，而是在记忆处理器内部决定是否显示
        const needsInteraction =
            memorySearchSettings.enabled ||
            isPlotOptimizeEnabled();

        // 阻止原始发送事件
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        Logger.log("拦截发送事件，开始处理记忆...");
        if (needsInteraction) {
            Logger.log("需要用户交互（记忆搜索助手或剧情优化）");
        } else if (globalSettings.showRequestPreview) {
            Logger.log("启用了发送前检查弹窗");
        } else {
            Logger.log("静默模式：无弹窗，直接处理记忆");
        }
        isProcessing = true;

        try {
            // 处理记忆（如果有回调）
            let result = null;
            if (processMemoryCallback) {
                result = await processMemoryCallback(userMessage);
            }

            // 检查用户是否取消了发送前检查
            if (result && result.cancelled) {
                Logger.log("用户取消了发送");
                isProcessing = false;
                return;
            }

            // 解析返回结果
            let memory = null;
            let editorContent = null;
            let multiAIResponse = null;
            if (result) {
                if (typeof result === "string") {
                    memory = result;
                } else if (typeof result === "object") {
                    memory = result.memory || null;
                    editorContent = result.editorContent || null;
                    multiAIResponse = result.multiAIResponse || null;
                }
            }

            // 如果用户选择了多AI生成的结果，直接使用该结果
            if (multiAIResponse) {
                Logger.log("[发送前检查] 使用多AI生成的结果");

                // 构建最终消息（包含记忆和剧情优化内容）
                let finalMessage = userMessage;
                if (memory) {
                    // 构建 Editor 部分
                    let editorSection = "";
                    if (editorContent) {
                        editorSection = `\n<Editor>\n${editorContent}\n</Editor>`;
                    }

                    // 将记忆包装并添加到用户消息后面
                    const wrappedMemory = `<Plot_progression>
<details>
<summary>【过去记忆碎片】</summary>
<p>以上是用户的最新输入，请勿忽略。</p>
<memory>
${memory}
</memory>${editorSection}
</details>
</Plot_progression>`;
                    finalMessage = userMessage + "\n\n" + wrappedMemory;
                }

                // 使用 SillyTavern API 直接添加用户消息和助手回复
                try {
                    const context = getContext();
                    if (context && context.chat) {
                        // 清空输入框
                        textarea.value = "";
                        textarea.dispatchEvent(new Event("input", { bubbles: true }));

                        // 构建用户消息对象
                        const userMsg = {
                            name: context.name1 || "User",
                            is_user: true,
                            mes: finalMessage,
                            send_date: Date.now(),
                        };

                        // 构建助手消息对象（使用用户选择的多AI回复）
                        const aiMsg = {
                            name: context.name2 || context.characterName || "Assistant",
                            is_user: false,
                            mes: multiAIResponse,
                            send_date: Date.now() + 1,
                            extra: {
                                multi_ai_generated: true,
                            },
                        };

                        // 添加消息到聊天数组
                        context.chat.push(userMsg);
                        context.chat.push(aiMsg);

                        // 保存聊天
                        if (typeof context.saveChat === "function") {
                            await context.saveChat();
                        }

                        // 重新渲染聊天界面
                        if (typeof context.printMessages === "function") {
                            await context.printMessages();
                        } else if (typeof context.reloadChat === "function") {
                            await context.reloadChat();
                        } else if (typeof context.addOneMessage === "function") {
                            // 备用方案：逐条渲染
                            await context.addOneMessage(userMsg);
                            await context.addOneMessage(aiMsg);
                        }

                        // 滚动到底部
                        const chatContainer = document.getElementById("chat");
                        if (chatContainer) {
                            chatContainer.scrollTop = chatContainer.scrollHeight;
                        }

                        // 手动触发渲染事件，通知 JS-Slash-Runner 等插件进行 iframe 渲染
                        const eventSource = getEventSource();
                        const eventTypes = getEventTypes();
                        if (eventSource && eventTypes) {
                            const userMsgId = context.chat.length - 2;
                            const aiMsgId = context.chat.length - 1;
                            await eventSource.emit(eventTypes.USER_MESSAGE_RENDERED, userMsgId);
                            await eventSource.emit(eventTypes.CHARACTER_MESSAGE_RENDERED, aiMsgId);
                        }

                        Logger.log("[发送前检查] 多AI回复已添加到聊天，内容长度:", multiAIResponse.length);
                        isProcessing = false;
                        return;
                    }
                } catch (e) {
                    Logger.error("[发送前检查] 添加多AI回复失败:", e);
                }
            }

            // 构建最终消息
            let finalMessage = userMessage;
            if (memory) {
                // 构建 Editor 部分
                let editorSection = "";
                if (editorContent) {
                    editorSection = `\n<Editor>\n${editorContent}\n</Editor>`;
                }

                // 将记忆包装并添加到用户消息后面
                const wrappedMemory = `<Plot_progression>
<details>
<summary>【过去记忆碎片】</summary>
<p>以上是用户的最新输入，请勿忽略。</p>
<memory>
${memory}
</memory>${editorSection}
</details>
</Plot_progression>`;
                finalMessage = userMessage + "\n\n" + wrappedMemory;
                Logger.log("[发送前检查] 记忆已合并到用户消息，长度:", finalMessage.length);
            }

            // 更新输入框内容
            textarea.value = finalMessage;
            textarea.dispatchEvent(new Event("input", { bubbles: true }));

            // 设置跳过标志
            skipNextHook = true;
            isProcessing = false;

            // 尝试直接调用 SillyTavern 的 Generate 函数
            let sent = false;
            try {
                const context = getContext();
                if (context && typeof context.Generate === "function") {
                    Logger.log("[发送前检查] 使用 Generate 函数发送");
                    context.Generate("normal");
                    sent = true;
                }
            } catch (e) {
                Logger.warn("[发送前检查] Generate 调用失败:", e);
            }

            // 备用方法：使用 jQuery 触发
            if (!sent) {
                Logger.log("[发送前检查] 使用备用方法发送");
                if (typeof jQuery !== "undefined") {
                    jQuery("#send_but").trigger("click");
                } else if (typeof $ !== "undefined") {
                    $("#send_but").trigger("click");
                } else {
                    const clickEvent = new MouseEvent("click", {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                    });
                    btn.dispatchEvent(clickEvent);
                }
            }
        } catch (error) {
            Logger.error("处理发送时出错:", error);
            isProcessing = false;
            skipNextHook = false;
            alert("记忆处理失败: " + error.message);
        }
    }

    // 使用原生方式添加事件监听器，捕获阶段触发
    btn.addEventListener("click", handleSendWithMemory, true);

    // 添加冒泡阶段监听器作为调试
    btn.addEventListener("click", function(e) {
        console.log("[记忆管理] 冒泡阶段点击事件触发");
    }, false);

    // 标记 Hook 已安装，并记录当前按钮
    hookInstalled = true;
    currentHookedButton = btn;
    Logger.log("✅ [发送前检查] Hook 已安装成功！按钮:", sendButton.id);

    // 设置 MutationObserver 监听按钮是否被替换
    setupButtonObserver();

    // 验证安装
    setTimeout(() => {
        const btn = document.getElementById("send_but");
        if (btn) {
            if (btn === currentHookedButton) {
                Logger.log("✅ [发送前检查] Hook 安装验证通过");
            } else {
                Logger.warn("⚠️ [发送前检查] 按钮元素已变化，重新安装 Hook");
                hookInstalled = false;
                hookSendButton();
            }
        } else {
            Logger.error("❌ [发送前检查] Hook 安装验证失败：按钮元素丢失");
        }
    }, 1000);
}

/**
 * 设置 MutationObserver 监听发送按钮的变化
 */
let buttonObserver = null;
function setupButtonObserver() {
    // 如果已有observer，不重复创建
    if (buttonObserver) {
        return;
    }

    // 监听 send_form 或其父元素的变化
    const sendForm = document.getElementById("send_form") || document.getElementById("form_sheld");
    if (!sendForm) {
        Logger.warn("⚠️ [发送前检查] 未找到表单容器，无法设置变化监听");
        return;
    }

    buttonObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                // 检查按钮是否被移除或替换
                const currentButton = document.getElementById("send_but");
                if (currentButton && currentButton !== currentHookedButton) {
                    Logger.log("🔄 [发送前检查] MutationObserver 检测到按钮变化，重新安装 Hook");
                    hookInstalled = false;
                    hookSendButton();
                    break;
                }
            }
        }
    });

    buttonObserver.observe(sendForm, {
        childList: true,
        subtree: true
    });

    Logger.log("✅ [发送前检查] MutationObserver 已设置");
}

/**
 * 重置 Hook 状态（用于测试或重新初始化）
 */
export function resetHookState() {
    hookInstalled = false;
    currentHookedButton = null;
    isProcessing = false;
    skipNextHook = false;
    abortController = null;
    if (buttonObserver) {
        buttonObserver.disconnect();
        buttonObserver = null;
    }
}
