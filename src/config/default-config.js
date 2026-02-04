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
    },
    memoryConfigs: {},
    summaryConfigs: {},
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
