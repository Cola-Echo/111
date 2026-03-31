/**
 * 默认配置模块
 * @module config/default-config
 */

/**
 * 默认配置对象
 */
export const defaultConfig = Object.freeze({
    global: {
        enabled: true,
        showLogs: false,
        showFloatBall: false,
        relevanceThreshold: 0.6,
        contextRounds: 5,
        selectedPromptFile: "", // 保留用于兼容，实际使用下面两个
        keywordsPromptFile: "", // 关键词提示词（分类/并发/索引合并API使用）
        historicalPromptFile: "", // 历史事件回忆提示词（总结世界书API使用）
        showRequestPreview: false,
        sendIndexOnly: false,
        showSummaryCheck: false,
        enableRecentPlot: true, // 启用剧情末尾（截取并注入到汇总检查）
        recentPlotLength: 200, // 剧情末尾截取字数（10-300）
        // 索引合并模式配置
        indexMergeEnabled: false, // 是否启用索引合并
        indexMergeConfig: {
            apiFormat: "openai",
            apiUrl: "",
            apiKey: "",
            model: "",
            maxTokens: 2000,
            temperature: 0.7,
            relevanceThreshold: 0.6,
            maxKeywords: 10,
            customTemplate: "",
            responsePath: "choices.0.message.content",
        },
        // 剧情优化助手配置
        plotOptimizeConfig: {
            apiFormat: "openai",
            apiUrl: "",
            apiKey: "",
            model: "",
            maxTokens: 2000,
            temperature: 0.7,
            customTemplate: "",
            responsePath: "choices.0.message.content",
            // 上下文选择配置
            contextRounds: 5, // 上下文参考轮次
            selectedBooks: [], // 选中的世界书名称列表
            selectedEntries: {}, // 选中的条目 {"世界书名": ["uid1", "uid2"]}
            includeCharDescription: true, // 是否包含角色描述
        },
        // 上下文标签过滤配置
        contextTagFilter: {
            // 用户消息过滤配置
            user: {
                enableExtract: false,
                enableExclude: false,
                excludeTags: ["Plot_progression"],
                extractTags: [],
            },
            // AI消息过滤配置
            ai: {
                enableExtract: false,
                enableExclude: false,
                excludeTags: [],
                extractTags: [],
            },
            // 通用设置
            caseSensitive: false,
        },
        // 多AI并发生成配置
        multiAIGeneration: {
            enabled: false, // 是否启用多AI生成功能
            providers: [], // API配置列表
            promptPresets: [], // 提示词预设列表
        },
        // 剧情优化助手开关（移到 global 内部保持一致性）
        enablePlotOptimize: false,
        // 表格填表并发配置
        tableFillerConfig: {
            enabled: false,
            // 调用模式：'auto'（自动选择）、'bus_only'（仅Bus）、'intercept_only'（仅拦截）
            callMode: "auto",
            // 提示词模式：'independent'（独立）或 'shared'（共享）
            promptMode: "shared",
            // 重试次数（单个表格失败后重试的次数）
            retryCount: 2,
            // 重试延迟基数（毫秒），使用指数退避：第N次重试等待 retryDelay * 2^(N-1)
            retryDelay: 2000,
            // 导入的预设 JSON（包含所有表格的提示词配置）
            importedPreset: null,
            // 默认 API（未单独配置的表格使用）
            defaultApi: {
                apiUrl: "",
                apiKey: "",
                model: "",
                apiFormat: "openai",
                maxTokens: 4096,
                temperature: 0.7,
                responsePath: "choices.0.message.content",
            },
            // 每个表格的 API 配置（可选，留空则使用 defaultApi）
            tableApiConfigs: {
                // "角色表": { useDefault: true } 或 { apiUrl, apiKey, model, ... }
            },
        },
        // 总结世界书自动拆分配置
        summaryAutoSplit: {
            enabled: false,                    // 全局开关
            targetChars: 50000,                // 目标拆分字符数
            minChars: 40000,                   // 最小字符数（确保段落完整）
            maxChars: 60000,                   // 最大字符数（确保段落完整）
        },
        // RMA 关系记忆系统配置
        rmaConfig: {
            enabled: false,                    // 全局开关
            confirmationMode: 'every_turn',    // every_turn | important_only | auto
            analysisApi: {
                apiFormat: 'openai',
                apiUrl: '',
                apiKey: '',
                model: '',
                maxTokens: 1500,
                temperature: 0.3,
                customTemplate: '',
                responsePath: 'choices.0.message.content',
            },
            floatPanel: {
                defaultState: 'half_collapsed', // expanded | half_collapsed | minimized
                position: { x: 'right', y: 'top' },
            },
        },
    },
    memoryConfigs: {},
    summaryConfigs: {},
    // 拆分后的Part配置（动态生成，每个Part可独立配置API）
    summaryPartConfigs: {
        // "Amily2-Lore-char-哥布林杀手9.6": {
        //     parts: [
        //         {
        //             id: "floor_1_60",
        //             startFloor: 1,
        //             endFloor: 60,
        //             charCount: 48000,
        //             apiConfig: { enabled: true, apiUrl: "...", model: "...", ... }
        //         },
        //         ...
        //     ]
        // }
    },
    importedBooks: [],
    importedPromptFiles: {}, // 提示词文件存储（跨浏览器同步）
});

/**
 * 默认多AI提供商配置
 */
export const defaultMultiAIProvider = Object.freeze({
    id: "", // 唯一ID（使用uuid生成）
    name: "", // 显示名称
    enabled: true, // 是否启用
    apiFormat: "openai", // openai | anthropic | google | custom
    apiUrl: "", // API地址
    apiKey: "", // API密钥
    model: "", // 模型名称
    maxTokens: 4000, // 最大输出Token
    temperature: 0.7, // 温度
    streaming: true, // 是否流式输出
    customTemplate: "", // 自定义请求模板
    responsePath: "choices.0.message.content", // 响应解析路径
    // 提示词预设相关
    usePromptPreset: false, // 是否使用提示词预设
    promptPresetId: "", // 选中的预设ID
});

/**
 * 默认提示词预设配置
 */
export const defaultPromptPreset = Object.freeze({
    id: "", // 唯一ID
    name: "", // 预设名称
    createdAt: 0, // 创建时间
    updatedAt: 0, // 更新时间
    prompts: [], // 提示词列表
});

/**
 * 默认提示词项配置
 */
export const defaultPromptItem = Object.freeze({
    id: "", // 唯一ID
    name: "", // 显示名称
    role: "system", // 角色: system | user | assistant
    content: "", // 提示词内容
    enabled: true, // 是否启用
    type: "custom", // 类型: custom | memory | history | character | user
    historyCount: 10, // 聊天历史轮数（仅type=history时有效）
});

/**
 * 默认 AI 配置
 */
export const defaultAIConfig = Object.freeze({
    apiFormat: "openai",
    apiUrl: "",
    apiKey: "",
    model: "",
    maxTokens: 2000,
    temperature: 0.7,
    relevanceThreshold: 0.6,
    maxKeywords: 10,
    maxHistoryEvents: 15,
    customTemplate: "",
    responsePath: "choices.0.message.content",
});
