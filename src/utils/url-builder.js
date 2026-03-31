/**
 * 统一的 API URL 构造工具
 * 支持标准接口和反代接口（如 域名/Gemini/v1、域名/antigravity/v1）
 * @module utils/url-builder
 */

/**
 * 从用户输入的 apiUrl 中提取 base（到最后一个 /v... 路径段为止）
 * 例：
 *   https://api.example.com/v1               → https://api.example.com/v1
 *   https://proxy.com/Gemini/v1              → https://proxy.com/Gemini/v1
 *   https://proxy.com/antigravity/v1beta     → https://proxy.com/antigravity/v1beta
 *   https://proxy.com/v1/chat/completions    → https://proxy.com/v1
 *   https://proxy.com                        → https://proxy.com （无 /v 段）
 *
 * @param {string} url
 * @returns {{ base: string, hasVersionSegment: boolean }}
 */
function parseApiBase(url) {
    // 去尾斜杠
    url = url.replace(/\/+$/, '');

    // 已包含完整终端路径，先剥离
    const endpointPatterns = [
        /\/chat\/completions$/,
        /\/completions$/,
        /\/messages$/,
        /\/models(\/.*)?$/,
        /:generateContent(\?.*)?$/,
    ];
    for (const pattern of endpointPatterns) {
        if (pattern.test(url)) {
            url = url.replace(pattern, '');
            break;
        }
    }

    // 再次去尾斜杠
    url = url.replace(/\/+$/, '');

    // 检测是否包含版本号路径段 /v1、/v1beta、/v2 等
    const hasVersionSegment = /\/v\d+[a-z]*$/i.test(url);

    return { base: url, hasVersionSegment };
}

/**
 * 构建 OpenAI 兼容的 chat/completions URL
 * @param {string} apiUrl 用户输入的 API URL
 * @returns {string}
 */
export function buildOpenAIChatUrl(apiUrl) {
    const { base, hasVersionSegment } = parseApiBase(apiUrl);
    if (hasVersionSegment) {
        return `${base}/chat/completions`;
    }
    // 无版本段，默认插入 /v1
    return `${base}/v1/chat/completions`;
}

/**
 * 构建 OpenAI 兼容的 models 列表 URL
 * @param {string} apiUrl 用户输入的 API URL
 * @returns {string}
 */
export function buildOpenAIModelsUrl(apiUrl) {
    const { base, hasVersionSegment } = parseApiBase(apiUrl);
    if (hasVersionSegment) {
        return `${base}/models`;
    }
    return `${base}/v1/models`;
}

/**
 * 构建 Anthropic messages URL
 * @param {string} apiUrl 用户输入的 API URL
 * @returns {string}
 */
export function buildAnthropicUrl(apiUrl) {
    const { base, hasVersionSegment } = parseApiBase(apiUrl);
    if (hasVersionSegment) {
        return `${base}/messages`;
    }
    return `${base}/v1/messages`;
}

/**
 * 构建 Google Gemini generateContent URL
 * @param {string} apiUrl 用户输入的 API URL
 * @param {string} model 模型名称
 * @param {string} apiKey API Key
 * @returns {string}
 */
export function buildGoogleUrl(apiUrl, model, apiKey) {
    const { base } = parseApiBase(apiUrl);
    // Google 格式：base/models/{model}:generateContent?key=xxx
    const modelsBase = base.includes('/models') ? base : `${base}/models`;
    return `${modelsBase}/${model}:generateContent?key=${apiKey}`;
}
