/**
 * 总结世界书Part配置弹窗模块
 * @module ui/modals/summary-part-config
 */

import Logger from "@core/logger";
import {
    getGlobalSettings,
    getSummaryPartApiConfig,
    setSummaryPartApiConfig,
} from "@config/config-manager";
import { refreshWorldBookList, getSummaryParts } from "@worldbook/refresh";
import { formatCharCount } from "@worldbook/summary-splitter";
import APIAdapter from "@api/adapter";
import { buildOpenAIModelsUrl } from "@utils/url-builder";

/**
 * 从API获取模型列表
 * @param {string} apiUrl API地址
 * @param {string} apiKey API密钥
 * @param {string} format API格式
 * @returns {Promise<string[]>} 模型列表
 */
async function fetchModelsFromApi(apiUrl, apiKey, format) {
    let modelsUrl = apiUrl;

    // 统一的反代兼容模型列表 URL 构造
    if (format === 'openai') {
        modelsUrl = buildOpenAIModelsUrl(apiUrl);
    } else if (format === 'anthropic') {
        // Anthropic 不支持获取模型列表，返回常用模型
        return [
            'claude-3-5-sonnet-20241022',
            'claude-3-5-haiku-20241022',
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307',
        ];
    } else if (format === 'google') {
        // Google 不支持获取模型列表，返回常用模型
        return [
            'gemini-2.0-flash-exp',
            'gemini-1.5-pro',
            'gemini-1.5-flash',
            'gemini-1.5-flash-8b',
            'gemini-1.0-pro',
        ];
    } else if (format === 'custom') {
        throw new Error('Custom格式不支持获取模型列表，请手动输入模型名称');
    } else {
        throw new Error('此API格式不支持获取模型列表，请手动输入模型名称');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(modelsUrl, { headers });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    let models = [];
    if (data.data && Array.isArray(data.data)) {
        // OpenAI 格式: { data: [{ id: "model-name" }, ...] }
        models = data.data.map(m => m.id || m.name).filter(Boolean);
    } else if (Array.isArray(data.models)) {
        // 某些 API 格式: { models: ["model1", "model2"] }
        models = data.models;
    } else if (Array.isArray(data)) {
        // 直接数组格式
        models = data.map(m => typeof m === 'string' ? m : m.id || m.name).filter(Boolean);
    }

    return models.sort();
}

// 当前编辑状态
let currentBookName = null;
let currentPartId = null;

/**
 * 获取当前主题
 * @returns {string} 主题名称
 */
function getCurrentTheme() {
    const settings = getGlobalSettings();
    return settings.theme || 'default';
}

/**
 * 应用主题到弹窗
 * @param {HTMLElement} modal 弹窗元素
 */
function applyThemeToModal(modal) {
    if (!modal) return;
    const theme = getCurrentTheme();
    if (theme === 'default') {
        modal.removeAttribute('data-mm-theme');
    } else {
        modal.setAttribute('data-mm-theme', theme);
    }
}

/**
 * 转义HTML特殊字符
 * @param {string} str 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * 显示Part配置弹窗
 * @param {string} bookName 世界书名称
 * @param {string} partId Part ID
 */
export function showSummaryPartConfigModal(bookName, partId) {
    Logger.log(`[SummaryPartConfig] showSummaryPartConfigModal called: book=${bookName}, partId=${partId}`);
    currentBookName = bookName;
    currentPartId = partId;

    // 获取Part信息
    const parts = getSummaryParts(bookName);
    Logger.log(`[SummaryPartConfig] Parts for ${bookName}:`, parts?.length || 0);
    const part = parts?.find(p => p.id === partId);

    if (!part) {
        Logger.warn(`[SummaryPartConfig] 未找到Part: ${bookName} - ${partId}`);
        return;
    }

    // 获取已保存的配置
    const savedConfig = getSummaryPartApiConfig(bookName, partId) || {};
    const apiFormat = savedConfig.apiFormat || 'openai';

    // 创建弹窗HTML - 复刻原有配置弹窗样式
    const modalHtml = `
        <div id="mm-part-config-modal" class="mm-modal">
            <div class="mm-modal-content">
                <div class="mm-modal-header">
                    <h4>配置 AI: <span id="mm-part-config-title">${part.startFloor}-${part.endFloor}楼</span></h4>
                    <button class="mm-modal-close mm-btn mm-btn-icon">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>

                <div class="mm-modal-body">
                    <!-- Part信息横幅 -->
                    <div class="mm-part-info-banner">
                        <i class="fa-solid fa-layer-group"></i>
                        <div class="mm-part-info-details">
                            <div class="mm-part-info-title">${part.startFloor}-${part.endFloor}楼</div>
                            <div class="mm-part-info-meta">
                                ${formatCharCount(part.charCount)} 字符 | ${escapeHtml(bookName)}
                            </div>
                        </div>
                    </div>

                    <!-- API格式 - 使用Radio按钮组 -->
                    <div class="mm-form-group">
                        <label>API 格式</label>
                        <div class="mm-radio-group">
                            <label><input type="radio" name="mm-part-api-format" value="openai" ${apiFormat === 'openai' ? 'checked' : ''} /> OpenAI 兼容</label>
                            <label><input type="radio" name="mm-part-api-format" value="anthropic" ${apiFormat === 'anthropic' ? 'checked' : ''} /> Anthropic</label>
                            <label><input type="radio" name="mm-part-api-format" value="google" ${apiFormat === 'google' ? 'checked' : ''} /> Google</label>
                            <label><input type="radio" name="mm-part-api-format" value="custom" ${apiFormat === 'custom' ? 'checked' : ''} /> Custom</label>
                        </div>
                    </div>

                    <!-- API URL -->
                    <div class="mm-form-group">
                        <label>API URL <span class="mm-required">*</span></label>
                        <input type="text" id="mm-part-api-url" placeholder="https://api.deepseek.com/v1" value="${escapeHtml(savedConfig.apiUrl || '')}">
                        <small class="mm-hint">填写到 /v1 即可，支持反代路径如 /Gemini/v1</small>
                    </div>

                    <!-- API Key -->
                    <div class="mm-form-group">
                        <label>API Key</label>
                        <input type="password" id="mm-part-api-key" placeholder="sk-..." value="${escapeHtml(savedConfig.apiKey || '')}">
                        <small class="mm-hint">本地模型可留空</small>
                    </div>

                    <!-- 模型名称 -->
                    <div class="mm-form-group">
                        <label>模型名称 <span class="mm-required">*</span></label>
                        <div class="mm-model-input-row">
                            <select id="mm-part-model" class="mm-model-select">
                                <option value="" disabled ${!savedConfig.model ? 'selected' : ''}>--- 请获取模型 ---</option>
                                ${savedConfig.model ? `<option value="${escapeHtml(savedConfig.model)}" selected>${escapeHtml(savedConfig.model)}</option>` : ''}
                            </select>
                            <button type="button" id="mm-part-fetch-models" class="mm-btn mm-btn-secondary" title="从API获取模型列表">
                                <i class="fa-solid fa-download"></i> 获取模型
                            </button>
                        </div>
                    </div>

                    <!-- Max Tokens 和 Temperature -->
                    <div class="mm-form-row">
                        <div class="mm-form-group">
                            <label>Max Tokens</label>
                            <input type="number" id="mm-part-max-tokens" value="${savedConfig.maxTokens || 2000}" min="100" max="128000">
                        </div>
                        <div class="mm-form-group">
                            <label>Temperature</label>
                            <input type="range" id="mm-part-temperature" value="${savedConfig.temperature || 0.5}" min="0" max="1" step="0.1">
                            <span id="mm-part-temperature-value">${savedConfig.temperature || 0.5}</span>
                        </div>
                    </div>

                    <!-- 关联性阈值 -->
                    <div class="mm-form-group">
                        <label>关联性阈值</label>
                        <div class="mm-form-row">
                            <input type="range" id="mm-part-relevance" value="${savedConfig.relevanceThreshold || 0.4}" min="0.1" max="1" step="0.1" style="flex: 1">
                            <span id="mm-part-relevance-value" style="min-width: 30px; text-align: center">${savedConfig.relevanceThreshold || 0.4}</span>
                        </div>
                        <small class="mm-hint">数值越小越严格，数值越大越宽松 (0.1-1.0)。占位符：<code>sulv1</code></small>
                    </div>

                    <!-- 历史事件数量 -->
                    <div class="mm-form-group">
                        <label>历史事件数量 (1-35)</label>
                        <input type="number" id="mm-part-max-events" value="${savedConfig.maxHistoryEvents || 10}" min="1" max="35">
                        <small class="mm-hint">AI 最多提取的历史事件数量。占位符：<code>sulv2</code></small>
                    </div>

                    <!-- Custom 格式选项（仅当选择 Custom 时显示） -->
                    <div id="mm-part-custom-format-options" class="${apiFormat === 'custom' ? '' : 'mm-hidden'}">
                        <div class="mm-form-group">
                            <label>自定义请求模板 (JSON)</label>
                            <textarea id="mm-part-custom-template" rows="5" placeholder='{"model": "{{model}}", "prompt": "{{system}}\n\n{{user}}"}'>${escapeHtml(savedConfig.customRequestTemplate || '')}</textarea>
                            <small class="mm-hint">可用变量: {{system}}, {{user}}, {{model}}, {{max_tokens}}, {{temperature}}</small>
                        </div>
                        <div class="mm-form-group">
                            <label>响应解析路径</label>
                            <input type="text" id="mm-part-response-path" placeholder="choices.0.message.content" value="${escapeHtml(savedConfig.customResponsePath || '')}">
                            <small class="mm-hint">用于从 API 响应中提取内容的路径，如：choices.0.message.content</small>
                        </div>
                    </div>
                </div>

                <div class="mm-modal-footer">
                    <button type="button" id="mm-part-test-connection" class="mm-btn mm-btn-secondary">
                        <i class="fa-solid fa-plug"></i> 测试连接
                    </button>
                    <div class="mm-modal-footer-right">
                        <button type="button" id="mm-part-cancel" class="mm-btn">取消</button>
                        <button type="button" id="mm-part-save" class="mm-btn mm-btn-primary">
                            <i class="fa-solid fa-save"></i> 保存配置
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 移除已存在的弹窗
    document.getElementById('mm-part-config-modal')?.remove();

    // 添加弹窗到页面
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 应用主题
    const modal = document.getElementById('mm-part-config-modal');
    applyThemeToModal(modal);

    // 绑定事件
    bindPartConfigEvents();

    // 显示弹窗
    setTimeout(() => modal?.classList.add('mm-modal-visible'), 10);
}

/**
 * 绑定Part配置弹窗事件
 */
function bindPartConfigEvents() {
    const modal = document.getElementById('mm-part-config-modal');
    if (!modal) return;

    // 关闭按钮
    modal.querySelector('.mm-modal-close')?.addEventListener('click', hidePartConfigModal);
    modal.querySelector('#mm-part-cancel')?.addEventListener('click', hidePartConfigModal);

    // Temperature 滑块
    const tempSlider = modal.querySelector('#mm-part-temperature');
    const tempValue = modal.querySelector('#mm-part-temperature-value');
    if (tempSlider && tempValue) {
        tempSlider.addEventListener('input', (e) => {
            tempValue.textContent = e.target.value;
        });
    }

    // 关联性阈值滑块
    const relevanceSlider = modal.querySelector('#mm-part-relevance');
    const relevanceValue = modal.querySelector('#mm-part-relevance-value');
    if (relevanceSlider && relevanceValue) {
        relevanceSlider.addEventListener('input', (e) => {
            relevanceValue.textContent = e.target.value;
        });
    }

    // API 格式切换事件（控制 Custom 选项显示）
    const formatRadios = modal.querySelectorAll('input[name="mm-part-api-format"]');
    formatRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const customOptions = document.getElementById('mm-part-custom-format-options');
            if (customOptions) {
                if (e.target.value === 'custom') {
                    customOptions.classList.remove('mm-hidden');
                } else {
                    customOptions.classList.add('mm-hidden');
                }
            }
        });
    });

    // 获取模型列表
    modal.querySelector('#mm-part-fetch-models')?.addEventListener('click', async () => {
        const apiUrl = document.getElementById('mm-part-api-url')?.value?.trim();
        const apiKey = document.getElementById('mm-part-api-key')?.value?.trim();
        const apiFormat = document.querySelector('input[name="mm-part-api-format"]:checked')?.value || 'openai';

        if (!apiUrl) {
            alert('请先填写API地址');
            return;
        }

        const btn = modal.querySelector('#mm-part-fetch-models');
        const originalHtml = btn.innerHTML;

        try {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 获取中...';
            btn.disabled = true;

            const models = await fetchModelsFromApi(apiUrl, apiKey, apiFormat);

            if (models && models.length > 0) {
                const modelSelect = document.getElementById('mm-part-model');
                if (modelSelect) {
                    const currentValue = modelSelect.value;
                    modelSelect.innerHTML = '<option value="" disabled>--- 请选择模型 ---</option>';
                    models.forEach(modelId => {
                        const option = document.createElement('option');
                        option.value = modelId;
                        option.textContent = modelId;
                        if (modelId === currentValue) {
                            option.selected = true;
                        }
                        modelSelect.appendChild(option);
                    });
                    // 如果之前没有选中的，选择第一个模型
                    if (!currentValue && models.length > 0) {
                        modelSelect.selectedIndex = 1;
                    }
                }
                if (window.toastr) {
                    window.toastr.success(`获取到 ${models.length} 个模型`, '成功');
                }
            } else {
                alert('未获取到模型列表');
            }
        } catch (error) {
            Logger.error('[SummaryPartConfig] 获取模型失败:', error);
            alert('获取模型列表失败: ' + error.message);
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    });

    // 测试连接
    modal.querySelector('#mm-part-test-connection')?.addEventListener('click', async () => {
        const config = getFormConfig();

        if (!config.apiUrl || !config.model) {
            alert('请填写API地址和模型');
            return;
        }

        const btn = modal.querySelector('#mm-part-test-connection');
        const originalHtml = btn.innerHTML;

        try {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 测试中...';
            btn.disabled = true;

            const result = await APIAdapter.testConnection(config);
            if (result.success) {
                if (window.toastr) {
                    window.toastr.success('API连接成功', '测试通过');
                } else {
                    alert('连接成功！');
                }
            } else {
                alert('连接失败: ' + (result.error || '未知错误'));
            }
        } catch (error) {
            Logger.error('[SummaryPartConfig] 测试连接失败:', error);
            alert('测试失败: ' + error.message);
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    });

    // 保存
    modal.querySelector('#mm-part-save')?.addEventListener('click', () => {
        const config = getFormConfig();

        if (!config.apiUrl || !config.model) {
            alert('请至少填写API地址和模型');
            return;
        }

        // 添加enabled字段
        config.enabled = true;

        setSummaryPartApiConfig(currentBookName, currentPartId, config);
        Logger.log(`[SummaryPartConfig] 已保存 ${currentBookName} - ${currentPartId} 的配置`);

        hidePartConfigModal();
        refreshWorldBookList();

        if (window.toastr) {
            window.toastr.success('Part配置已保存', '保存成功');
        }
    });
}

/**
 * 从表单获取配置
 * @returns {object} 配置对象
 */
function getFormConfig() {
    const modelEl = document.getElementById('mm-part-model');
    const modelValue = modelEl?.value || '';
    const apiFormat = document.querySelector('input[name="mm-part-api-format"]:checked')?.value || 'openai';

    const config = {
        apiFormat,
        apiUrl: document.getElementById('mm-part-api-url')?.value || '',
        apiKey: document.getElementById('mm-part-api-key')?.value || '',
        model: modelValue,
        maxTokens: parseInt(document.getElementById('mm-part-max-tokens')?.value) || 2000,
        temperature: parseFloat(document.getElementById('mm-part-temperature')?.value) || 0.5,
        relevanceThreshold: parseFloat(document.getElementById('mm-part-relevance')?.value) || 0.4,
        maxHistoryEvents: parseInt(document.getElementById('mm-part-max-events')?.value) || 10,
        responsePath: 'choices.0.message.content',
    };

    // Custom 格式额外字段
    if (apiFormat === 'custom') {
        config.customRequestTemplate = document.getElementById('mm-part-custom-template')?.value || '';
        config.customResponsePath = document.getElementById('mm-part-response-path')?.value || '';
        // 如果有自定义响应路径，使用它
        if (config.customResponsePath) {
            config.responsePath = config.customResponsePath;
        }
    }

    return config;
}

/**
 * 隐藏Part配置弹窗
 */
export function hidePartConfigModal() {
    const modal = document.getElementById('mm-part-config-modal');
    if (modal) {
        modal.classList.remove('mm-modal-visible');
        setTimeout(() => modal.remove(), 300);
    }
    currentBookName = null;
    currentPartId = null;
}

export default {
    showSummaryPartConfigModal,
    hidePartConfigModal,
};
