/**
 * 多AI配置弹窗模块
 * @module ui/modals/multi-ai-config
 */

import Logger from '@core/logger';
import {
    getMultiAIConfig,
    addProvider,
    updateProvider,
    getProviderById,
    getGlobalSettings,
} from '@config/config-manager';
import { defaultMultiAIProvider } from '@config/default-config';
import { APIAdapter } from '@api/adapter';
import { getPromptPresets, showPromptPresetModal, getPromptPresetById } from './prompt-preset';
import { buildOpenAIModelsUrl } from '@utils/url-builder';

const log = Logger.createModuleLogger('多AI配置');

// 当前编辑的provider ID（null表示新建）
let currentEditingId = null;

/**
 * 生成UUID
 * @returns {string}
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 显示多AI配置弹窗
 * @param {string|null} providerId - 要编辑的provider ID，null表示新建
 * @returns {Promise<object|null>} 保存的provider配置或null
 */
export function showMultiAIConfigModal(providerId = null) {
    return new Promise((resolve) => {
        currentEditingId = providerId;

        const modal = document.getElementById('mm-multi-ai-config-modal');
        if (!modal) {
            log.error('找不到多AI配置弹窗');
            resolve(null);
            return;
        }

        // 获取表单元素
        const titleEl = document.getElementById('mm-multi-ai-config-title');
        const nameInput = document.getElementById('mm-multi-ai-name');
        const urlInput = document.getElementById('mm-multi-ai-url');
        const keyInput = document.getElementById('mm-multi-ai-key');
        const modelSelect = document.getElementById('mm-multi-ai-model');
        const maxTokensInput = document.getElementById('mm-multi-ai-max-tokens');
        const temperatureInput = document.getElementById('mm-multi-ai-temperature');
        const temperatureValue = document.getElementById('mm-multi-ai-temperature-value');
        const customOptions = document.getElementById('mm-multi-ai-custom-options');
        const customTemplate = document.getElementById('mm-multi-ai-custom-template');
        const responsePath = document.getElementById('mm-multi-ai-response-path');
        const testResult = document.getElementById('mm-multi-ai-test-result');

        // 预设相关元素 - 需要在 resetForm 之前定义
        const usePresetCheckbox = document.getElementById('mm-multi-ai-use-preset');
        const presetOptions = document.getElementById('mm-multi-ai-preset-options');
        const presetSelect = document.getElementById('mm-multi-ai-preset-select');
        const editPresetBtn = document.getElementById('mm-multi-ai-edit-preset');
        const newPresetBtn = document.getElementById('mm-multi-ai-new-preset');
        const presetPreview = document.getElementById('mm-multi-ai-preset-preview');

        // 重置表单
        resetForm();

        // 如果是编辑模式，填充数据
        if (providerId) {
            const provider = getProviderById(providerId);
            if (provider) {
                titleEl.textContent = `配置AI: ${provider.name}`;
                fillForm(provider);
            } else {
                titleEl.textContent = '配置AI: 新建配置';
            }
        } else {
            titleEl.textContent = '配置AI: 新建配置';
        }

        // 应用当前主题
        const settings = getGlobalSettings();
        const theme = settings.theme || 'default';
        if (theme !== 'default') {
            modal.setAttribute('data-mm-theme', theme);
        } else {
            modal.removeAttribute('data-mm-theme');
        }

        // 显示弹窗
        modal.classList.add('mm-modal-visible');

        // 绑定事件
        const closeBtn = modal.querySelector('.mm-modal-close');
        const cancelBtn = document.getElementById('mm-multi-ai-cancel');
        const saveBtn = document.getElementById('mm-multi-ai-save');
        const testBtn = document.getElementById('mm-multi-ai-test');
        const fetchModelsBtn = document.getElementById('mm-multi-ai-fetch-models');
        const formatRadios = document.querySelectorAll('input[name="mm-multi-ai-format"]');

        const cleanup = () => {
            modal.classList.remove('mm-modal-visible');
            closeBtn.removeEventListener('click', handleClose);
            cancelBtn.removeEventListener('click', handleClose);
            saveBtn.removeEventListener('click', handleSave);
            testBtn.removeEventListener('click', handleTest);
            fetchModelsBtn.removeEventListener('click', handleFetchModels);
            temperatureInput.removeEventListener('input', handleTemperatureChange);
            formatRadios.forEach(r => r.removeEventListener('change', handleFormatChange));
            // 预设相关事件清理
            usePresetCheckbox?.removeEventListener('change', handleUsePresetChange);
            presetSelect?.removeEventListener('change', handlePresetSelectChange);
            editPresetBtn?.removeEventListener('click', handleEditPreset);
            newPresetBtn?.removeEventListener('click', handleNewPreset);
        };

        const handleClose = () => {
            cleanup();
            resolve(null);
        };

        const handleSave = () => {
            const provider = collectFormData();
            if (!provider) return;

            if (currentEditingId) {
                // 更新现有provider
                updateProvider(currentEditingId, provider);
                log.log(`已更新API配置: ${provider.name}`);
            } else {
                // 添加新provider
                provider.id = generateUUID();
                addProvider(provider);
                log.log(`已添加API配置: ${provider.name}`);
            }

            toastr.success(`API配置 "${provider.name}" 已保存`, '记忆管理并发系统');
            cleanup();
            resolve(provider);
        };

        const handleTest = async () => {
            testResult.textContent = '测试中...';
            testResult.className = 'mm-test-result';

            const config = collectFormData();
            if (!config) {
                testResult.textContent = '请填写必要字段';
                testResult.className = 'mm-test-result mm-test-error';
                return;
            }

            try {
                const result = await APIAdapter.testConnection(config);
                if (result.success) {
                    testResult.textContent = `连接成功 (${result.latency}ms)`;
                    testResult.className = 'mm-test-result mm-test-success';
                } else {
                    testResult.textContent = `连接失败: ${result.message}`;
                    testResult.className = 'mm-test-result mm-test-error';
                }
            } catch (error) {
                testResult.textContent = `连接失败: ${error.message}`;
                testResult.className = 'mm-test-result mm-test-error';
            }
        };

        const handleFetchModels = async () => {
            const apiUrl = urlInput.value.trim();
            const apiKey = keyInput.value.trim();
            const format = document.querySelector('input[name="mm-multi-ai-format"]:checked')?.value || 'openai';

            if (!apiUrl) {
                toastr.warning('请先填写 API URL', '记忆管理并发系统');
                return;
            }

            fetchModelsBtn.disabled = true;
            fetchModelsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 获取中...';

            try {
                const models = await fetchModels(apiUrl, apiKey, format);
                modelSelect.innerHTML = '';

                if (models.length === 0) {
                    modelSelect.innerHTML = '<option value="" disabled selected>--- 未获取到模型 ---</option>';
                } else {
                    models.forEach(model => {
                        const option = document.createElement('option');
                        option.value = model;
                        option.textContent = model;
                        modelSelect.appendChild(option);
                    });
                }

                toastr.success(`获取到 ${models.length} 个模型`, '记忆管理并发系统');
            } catch (error) {
                toastr.error(`获取模型失败: ${error.message}`, '记忆管理并发系统');
                modelSelect.innerHTML = '<option value="" disabled selected>--- 获取失败 ---</option>';
            } finally {
                fetchModelsBtn.disabled = false;
                fetchModelsBtn.innerHTML = '<i class="fa-solid fa-download"></i> 获取模型';
            }
        };

        const handleTemperatureChange = () => {
            temperatureValue.textContent = temperatureInput.value;
        };

        const handleFormatChange = (e) => {
            if (e.target.value === 'custom') {
                customOptions.classList.remove('mm-hidden');
            } else {
                customOptions.classList.add('mm-hidden');
            }
        };

        // 加载预设列表
        function loadPresetList() {
            const presets = getPromptPresets();
            presetSelect.innerHTML = '<option value="">-- 请选择预设 --</option>';
            presets.forEach(preset => {
                const option = document.createElement('option');
                option.value = preset.id;
                option.textContent = `${preset.name} (${preset.prompts?.length || 0}条)`;
                presetSelect.appendChild(option);
            });
        }

        // 更新预设预览
        function updatePresetPreview(presetId) {
            if (!presetId) {
                presetPreview.innerHTML = '';
                return;
            }
            const preset = getPromptPresetById(presetId);
            if (!preset) {
                presetPreview.innerHTML = '<span class="mm-preset-preview-empty">预设不存在</span>';
                return;
            }
            const enabledCount = preset.prompts?.filter(p => p.enabled).length || 0;
            const totalCount = preset.prompts?.length || 0;
            const promptNames = preset.prompts
                ?.filter(p => p.enabled)
                .slice(0, 5)
                .map(p => p.name)
                .join('、') || '';
            const suffix = enabledCount > 5 ? '...' : '';
            presetPreview.innerHTML = `
                <div class="mm-preset-preview-info">
                    <span class="mm-preset-preview-count">已启用 ${enabledCount}/${totalCount} 条提示词</span>
                    <span class="mm-preset-preview-names">${promptNames}${suffix}</span>
                </div>
            `;
        }

        // 处理使用预设复选框变化
        const handleUsePresetChange = (e) => {
            if (e.target.checked) {
                presetOptions.classList.remove('mm-hidden');
                loadPresetList();
            } else {
                presetOptions.classList.add('mm-hidden');
            }
        };

        // 处理预设选择变化
        const handlePresetSelectChange = (e) => {
            updatePresetPreview(e.target.value);
        };

        // 处理编辑预设
        const handleEditPreset = async () => {
            const presetId = presetSelect.value;
            if (!presetId) {
                toastr.warning('请先选择一个预设', '记忆管理并发系统');
                return;
            }
            await showPromptPresetModal(presetId);
            loadPresetList();
            // 保持当前选择
            presetSelect.value = presetId;
            updatePresetPreview(presetId);
        };

        // 处理新建预设
        const handleNewPreset = async () => {
            const result = await showPromptPresetModal(null);
            if (result) {
                loadPresetList();
                presetSelect.value = result.id;
                updatePresetPreview(result.id);
            }
        };

        // 绑定预设相关事件
        usePresetCheckbox?.addEventListener('change', handleUsePresetChange);
        presetSelect?.addEventListener('change', handlePresetSelectChange);
        editPresetBtn?.addEventListener('click', handleEditPreset);
        newPresetBtn?.addEventListener('click', handleNewPreset);

        // 绑定事件监听
        closeBtn.addEventListener('click', handleClose);
        cancelBtn.addEventListener('click', handleClose);
        saveBtn.addEventListener('click', handleSave);
        testBtn.addEventListener('click', handleTest);
        fetchModelsBtn.addEventListener('click', handleFetchModels);
        temperatureInput.addEventListener('input', handleTemperatureChange);
        formatRadios.forEach(r => r.addEventListener('change', handleFormatChange));

        /**
         * 重置表单
         */
        function resetForm() {
            nameInput.value = '';
            urlInput.value = '';
            keyInput.value = '';
            modelSelect.innerHTML = '<option value="" disabled selected>--- 请获取模型 ---</option>';
            maxTokensInput.value = defaultMultiAIProvider.maxTokens;
            temperatureInput.value = defaultMultiAIProvider.temperature;
            temperatureValue.textContent = defaultMultiAIProvider.temperature;
            customTemplate.value = '';
            responsePath.value = defaultMultiAIProvider.responsePath;
            testResult.textContent = '';
            testResult.className = 'mm-test-result';

            // 重置格式选择
            document.querySelector('input[name="mm-multi-ai-format"][value="openai"]').checked = true;
            customOptions.classList.add('mm-hidden');

            // 重置流式选择
            document.querySelector('input[name="mm-multi-ai-streaming"][value="true"]').checked = true;

            // 重置预设选择
            if (usePresetCheckbox) usePresetCheckbox.checked = false;
            if (presetOptions) presetOptions.classList.add('mm-hidden');
            if (presetSelect) presetSelect.value = '';
            if (presetPreview) presetPreview.innerHTML = '';
        }

        /**
         * 填充表单数据
         * @param {object} provider
         */
        function fillForm(provider) {
            nameInput.value = provider.name || '';
            urlInput.value = provider.apiUrl || '';
            keyInput.value = provider.apiKey || '';
            maxTokensInput.value = provider.maxTokens || defaultMultiAIProvider.maxTokens;
            temperatureInput.value = provider.temperature || defaultMultiAIProvider.temperature;
            temperatureValue.textContent = temperatureInput.value;
            customTemplate.value = provider.customTemplate || '';
            responsePath.value = provider.responsePath || defaultMultiAIProvider.responsePath;

            // 设置格式
            const formatRadio = document.querySelector(`input[name="mm-multi-ai-format"][value="${provider.apiFormat}"]`);
            if (formatRadio) {
                formatRadio.checked = true;
                if (provider.apiFormat === 'custom') {
                    customOptions.classList.remove('mm-hidden');
                }
            }

            // 设置流式
            const streamingRadio = document.querySelector(`input[name="mm-multi-ai-streaming"][value="${provider.streaming}"]`);
            if (streamingRadio) {
                streamingRadio.checked = true;
            }

            // 设置模型
            if (provider.model) {
                modelSelect.innerHTML = `<option value="${provider.model}" selected>${provider.model}</option>`;
            }

            // 设置预设选择
            if (usePresetCheckbox) {
                usePresetCheckbox.checked = provider.usePromptPreset || false;
                if (provider.usePromptPreset) {
                    presetOptions.classList.remove('mm-hidden');
                    loadPresetList();
                    if (provider.promptPresetId) {
                        presetSelect.value = provider.promptPresetId;
                        updatePresetPreview(provider.promptPresetId);
                    }
                }
            }
        }

        /**
         * 收集表单数据
         * @returns {object|null}
         */
        function collectFormData() {
            const name = nameInput.value.trim();
            const apiUrl = urlInput.value.trim();
            const model = modelSelect.value;

            if (!name) {
                toastr.warning('请填写配置名称', '记忆管理并发系统');
                nameInput.focus();
                return null;
            }

            if (!apiUrl) {
                toastr.warning('请填写 API URL', '记忆管理并发系统');
                urlInput.focus();
                return null;
            }

            if (!model) {
                toastr.warning('请选择模型', '记忆管理并发系统');
                return null;
            }

            const format = document.querySelector('input[name="mm-multi-ai-format"]:checked')?.value || 'openai';
            const streaming = document.querySelector('input[name="mm-multi-ai-streaming"]:checked')?.value === 'true';

            // 收集预设配置
            const usePromptPreset = usePresetCheckbox?.checked || false;
            const promptPresetId = usePromptPreset ? (presetSelect?.value || '') : '';

            return {
                id: currentEditingId || '',
                name,
                enabled: true,
                apiFormat: format,
                apiUrl,
                apiKey: keyInput.value.trim(),
                model,
                maxTokens: parseInt(maxTokensInput.value) || defaultMultiAIProvider.maxTokens,
                temperature: parseFloat(temperatureInput.value) || defaultMultiAIProvider.temperature,
                streaming,
                customTemplate: customTemplate.value.trim(),
                responsePath: responsePath.value.trim() || defaultMultiAIProvider.responsePath,
                usePromptPreset,
                promptPresetId,
            };
        }
    });
}

/**
 * 从API获取模型列表
 * @param {string} apiUrl API地址
 * @param {string} apiKey API密钥
 * @param {string} format API格式
 * @returns {Promise<string[]>} 模型列表
 */
async function fetchModels(apiUrl, apiKey, format) {
    let modelsUrl = apiUrl;

    // 统一的反代兼容模型列表 URL 构造
    if (format === 'openai') {
        modelsUrl = buildOpenAIModelsUrl(apiUrl);
    } else {
        // 其他格式暂不支持获取模型列表
        throw new Error('此API格式不支持获取模型列表，请手动输入模型名称');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(modelsUrl, { headers });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const models = data.data || data.models || [];

    return models.map(m => m.id || m.name || m).filter(Boolean).sort();
}

export default { showMultiAIConfigModal };
