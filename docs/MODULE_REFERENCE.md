# Memory-Manager-Concurrent 模块参考手册

> 版本: v0.4.0 | 架构: 模块化 + Webpack 打包

## 目录结构总览

```
src/
├── index.js                 # 主入口文件
├── core/                    # 核心基础模块
├── config/                  # 配置管理模块
├── worldbook/               # 世界书处理模块
├── api/                     # AI API 调用模块
├── memory/                  # 记忆处理模块
├── hooks/                   # 钩子拦截模块
├── ui/                      # 用户界面模块
└── utils/                   # 工具函数模块
```

---

## 1. core/ - 核心基础模块

### 1.1 logger.js
**功能**：统一日志输出管理

| 导出 | 类型 | 说明 |
|-----|------|------|
| `Logger` | Object | 日志工具对象 |
| `Logger.log()` | Function | 普通日志 |
| `Logger.debug()` | Function | 调试日志 |
| `Logger.warn()` | Function | 警告日志 |
| `Logger.error()` | Function | 错误日志（始终输出） |

**使用示例**：
```javascript
import Logger from '@core/logger';
Logger.log('初始化完成');
Logger.error('发生错误:', error);
```

### 1.2 constants.js
**功能**：全局常量和路径检测

| 导出 | 类型 | 说明 |
|-----|------|------|
| `EXTENSION_NAME` | String | 插件名称标识 |
| `EXTENSION_FOLDER` | String | 插件文件夹名 |
| `detectExtensionPath()` | Function | 检测插件路径 |
| `getExtensionPath()` | Function | 获取插件路径 |

### 1.3 error.js
**功能**：错误处理和用户提示

| 导出 | 类型 | 说明 |
|-----|------|------|
| `MemoryManagerError` | Class | 自定义错误类 |
| `handleError()` | Function | 统一错误处理 |

### 1.4 sillytavern-api.js
**功能**：封装 SillyTavern API 访问

| 导出 | 类型 | 说明 |
|-----|------|------|
| `getContext()` | Function | 获取 ST 上下文 |
| `getEventSource()` | Function | 获取事件源 |
| `getEventTypes()` | Function | 获取事件类型 |
| `getExtensionSettings()` | Function | 获取扩展设置 |
| `saveSettingsDebounced()` | Function | 防抖保存设置 |
| `getRequestHeaders()` | Function | 获取请求头（含CSRF） |

---

## 2. config/ - 配置管理模块

### 2.1 config-manager.js
**功能**：配置的加载、保存和访问

| 导出 | 类型 | 说明 |
|-----|------|------|
| `loadConfig()` | Function | 加载配置 |
| `saveConfig()` | Function | 保存配置 |
| `getGlobalSettings()` | Function | 获取全局设置 |
| `updateGlobalSettings()` | Function | 更新全局设置 |
| `getMemoryConfig()` | Function | 获取记忆配置 |
| `getSummaryConfig()` | Function | 获取总结配置 |
| `getAIConfig()` | Function | 获取 AI 配置 |
| `updateAIConfig()` | Function | 更新 AI 配置 |

### 2.2 default-config.js
**功能**：默认配置定义

| 导出 | 类型 | 说明 |
|-----|------|------|
| `defaultConfig` | Object | 默认配置对象（冻结） |

### 2.3 imported-books.js
**功能**：已导入世界书名称管理

| 导出 | 类型 | 说明 |
|-----|------|------|
| `getImportedBookNames()` | Function | 获取已导入书名列表 |
| `saveImportedBookNames()` | Function | 保存书名列表 |
| `addImportedBook()` | Function | 添加书名 |
| `removeImportedBook()` | Function | 移除书名 |

### 2.4 prompt-files.js
**功能**：提示词文件存储管理

| 导出 | 类型 | 说明 |
|-----|------|------|
| `getImportedPromptFiles()` | Function | 获取所有提示词文件 |
| `savePromptFileData()` | Function | 保存提示词文件 |
| `getPromptFileData()` | Function | 获取单个文件 |
| `deletePromptFileData()` | Function | 删除文件 |
| `hasPromptFile()` | Function | 检查文件是否存在 |

---

## 3. worldbook/ - 世界书处理模块

### 3.1 api.js
**功能**：世界书 API 操作

| 导出 | 类型 | 说明 |
|-----|------|------|
| `getAllAvailableWorldBooks()` | Function | 获取所有可用世界书 |
| `loadWorldBookByName()` | Function | 按名称加载世界书 |
| `getImportedWorldBooks()` | Function | 获取已导入的世界书 |
| `getWorldBookList()` | Function | 快速获取世界书列表 |

### 3.2 parser.js
**功能**：世界书内容解析

| 导出 | 类型 | 说明 |
|-----|------|------|
| `parseWorldBook()` | Function | 解析世界书结构 |
| `formatAsWorldBook()` | Function | 格式化为世界书格式 |
| `getSummaryContent()` | Function | 获取总结内容 |

### 3.3 refresh.js
**功能**：世界书列表刷新和 UI 更新

| 导出 | 类型 | 说明 |
|-----|------|------|
| `refreshWorldBookList()` | Function | 刷新世界书列表 |
| `updateWorldBookUI()` | Function | 更新世界书 UI |

---

## 4. api/ - AI API 调用模块

### 4.1 adapter.js
**功能**：统一的 API 调用适配器

| 导出 | 类型 | 说明 |
|-----|------|------|
| `APIAdapter` | Object | API 适配器主对象 |
| `APIAdapter.call()` | Function | 调用 AI API |
| `APIAdapter.callWithRetry()` | Function | 带重试的调用 |
| `APIAdapter.callWithMessages()` | Function | 多消息调用 |
| `APIAdapter.testConnection()` | Function | 测试连接 |

### 4.2 providers/openai.js
**功能**：OpenAI 兼容 API 调用

| 导出 | 类型 | 说明 |
|-----|------|------|
| `callOpenAI()` | Function | 调用 OpenAI API |

### 4.3 providers/anthropic.js
**功能**：Anthropic Claude API 调用

| 导出 | 类型 | 说明 |
|-----|------|------|
| `callAnthropic()` | Function | 调用 Claude API |

### 4.4 providers/google.js
**功能**：Google Gemini API 调用

| 导出 | 类型 | 说明 |
|-----|------|------|
| `callGoogle()` | Function | 调用 Gemini API |

### 4.5 providers/custom.js
**功能**：自定义 API 调用

| 导出 | 类型 | 说明 |
|-----|------|------|
| `callCustom()` | Function | 调用自定义 API |

---

## 5. memory/ - 记忆处理模块

### 5.1 processor.js
**功能**：记忆处理核心逻辑

| 导出 | 类型 | 说明 |
|-----|------|------|
| `processCategory()` | Function | 处理单个分类 |
| `processSummaryBook()` | Function | 处理总结世界书 |
| `processMemoryForMessage()` | Function | 为消息处理记忆 |

### 5.2 result-merger.js
**功能**：AI 返回结果合并

| 导出 | 类型 | 说明 |
|-----|------|------|
| `mergeResults()` | Function | 合并多个结果 |
| `deduplicateKeywords()` | Function | 关键词去重 |

### 5.3 jailbreak.js
**功能**：破限词管理

| 导出 | 类型 | 说明 |
|-----|------|------|
| `JAILBREAK_PROMPTS` | Array | 破限词列表 |
| `getJailbreakPrefix()` | Function | 获取破限前缀 |

### 5.4 prompt-builder.js
**功能**：提示词构建

| 导出 | 类型 | 说明 |
|-----|------|------|
| `buildDataInjection()` | Function | 构建数据注入 |
| `injectDataToPrompt()` | Function | 注入数据到提示词 |
| `buildUserPrompt()` | Function | 构建用户提示词 |
| `replacePromptVariables()` | Function | 替换提示词变量 |

---

## 6. hooks/ - 钩子拦截模块

### 6.1 send-button-hook.js
**功能**：发送按钮拦截

| 导出 | 类型 | 说明 |
|-----|------|------|
| `hookSendButton()` | Function | 挂载发送按钮钩子 |
| `stopProcessing()` | Function | 停止当前处理 |
| `isProcessing` | Boolean | 是否正在处理 |

### 6.2 interceptor.js
**功能**：生成拦截器注册

| 导出 | 类型 | 说明 |
|-----|------|------|
| `registerInterceptor()` | Function | 注册 generate_interceptor |

---

## 7. ui/ - 用户界面模块

### 7.1 template-loader.js
**功能**：HTML 模板加载

| 导出 | 类型 | 说明 |
|-----|------|------|
| `loadTemplate()` | Function | 加载 HTML 模板 |
| `loadAllTemplates()` | Function | 加载所有模板 |

### 7.2 events.js
**功能**：UI 事件绑定

| 导出 | 类型 | 说明 |
|-----|------|------|
| `bindEvents()` | Function | 绑定所有事件 |
| `bindPanelEvents()` | Function | 绑定面板事件 |
| `bindSettingsEvents()` | Function | 绑定设置事件 |

### 7.3 menu-button.js
**功能**：扩展菜单按钮

| 导出 | 类型 | 说明 |
|-----|------|------|
| `createExtensionMenuButton()` | Function | 创建菜单按钮 |
| `updateMenuButtonStatus()` | Function | 更新按钮状态 |

### 7.4 float-ball.js
**功能**：悬浮球控制

| 导出 | 类型 | 说明 |
|-----|------|------|
| `createFloatBall()` | Function | 创建悬浮球 |
| `updateFloatBallVisibility()` | Function | 更新可见性 |
| `showFloatBall()` | Function | 显示悬浮球 |
| `hideFloatBall()` | Function | 隐藏悬浮球 |

### 7.5 components/progress-tracker.js
**功能**：进度追踪器

| 导出 | 类型 | 说明 |
|-----|------|------|
| `ProgressTracker` | Class | 进度追踪器类 |
| `progressTracker` | Instance | 全局实例 |

### 7.6 components/message-progress.js
**功能**：消息进度面板

| 导出 | 类型 | 说明 |
|-----|------|------|
| `MessageProgressPanel` | Class | 消息进度面板类 |
| `messageProgressPanel` | Instance | 全局实例 |

### 7.7 components/search-panel.js
**功能**：记忆搜索助手

| 导出 | 类型 | 说明 |
|-----|------|------|
| `initSearchPanel()` | Function | 初始化搜索面板 |
| `showSearchPanel()` | Function | 显示搜索面板 |
| `hideSearchPanel()` | Function | 隐藏搜索面板 |

### 7.8 components/plot-optimize.js
**功能**：剧情优化助手

| 导出 | 类型 | 说明 |
|-----|------|------|
| `initPlotOptimizePanel()` | Function | 初始化面板 |
| `showPlotOptimizePanel()` | Function | 显示面板 |
| `hidePlotOptimizePanel()` | Function | 隐藏面板 |

### 7.9 modals/config-modal.js
**功能**：配置弹窗

| 导出 | 类型 | 说明 |
|-----|------|------|
| `showConfigModal()` | Function | 显示配置弹窗 |
| `hideConfigModal()` | Function | 隐藏配置弹窗 |
| `bindConfigModalEvents()` | Function | 绑定弹窗事件 |

### 7.10 modals/worldbook-selector.js
**功能**：世界书选择器弹窗

| 导出 | 类型 | 说明 |
|-----|------|------|
| `showWorldbookSelector()` | Function | 显示选择器 |
| `hideWorldbookSelector()` | Function | 隐藏选择器 |

### 7.11 modals/request-preview.js
**功能**：请求预览弹窗

| 导出 | 类型 | 说明 |
|-----|------|------|
| `showRequestPreview()` | Function | 显示请求预览 |
| `hideRequestPreview()` | Function | 隐藏请求预览 |

### 7.12 modals/summary-check.js
**功能**：汇总检查弹窗

| 导出 | 类型 | 说明 |
|-----|------|------|
| `showSummaryCheck()` | Function | 显示汇总检查 |
| `hideSummaryCheck()` | Function | 隐藏汇总检查 |

### 7.13 modals/flow-config.js
**功能**：流程配置弹窗

| 导出 | 类型 | 说明 |
|-----|------|------|
| `showFlowConfig()` | Function | 显示流程配置 |
| `hideFlowConfig()` | Function | 隐藏流程配置 |
| `loadFlowConfig()` | Function | 加载流程配置 |
| `saveFlowConfig()` | Function | 保存流程配置 |

### 7.14 modals/prompt-editor.js
**功能**：提示词编辑器

| 导出 | 类型 | 说明 |
|-----|------|------|
| `showPromptEditor()` | Function | 显示编辑器 |
| `hidePromptEditor()` | Function | 隐藏编辑器 |
| `loadPromptFiles()` | Function | 加载提示词文件 |
| `savePromptFile()` | Function | 保存提示词 |
| `saveAsPromptFile()` | Function | 另存为 |
| `switchPromptType()` | Function | 切换提示词类型 |
| `getCurrentPromptType()` | Function | 获取当前类型 |

---

## 8. utils/ - 工具函数模块

### 8.1 message.js
**功能**：消息处理工具

| 导出 | 类型 | 说明 |
|-----|------|------|
| `getLastUserMessage()` | Function | 获取最后用户消息 |
| `getRecentContext()` | Function | 获取最近上下文 |
| `injectMemory()` | Function | 注入记忆到聊天 |

### 8.2 tag-filter.js
**功能**：标签过滤

| 导出 | 类型 | 说明 |
|-----|------|------|
| `filterContentByTags()` | Function | 按标签过滤内容 |

### 8.3 prompt-template.js
**功能**：提示词模板加载

| 导出 | 类型 | 说明 |
|-----|------|------|
| `getPromptTemplate()` | Function | 获取关键词提示词模板 |
| `getHistoricalPromptTemplate()` | Function | 获取历史提示词模板 |
| `getPlotOptimizeTemplate()` | Function | 获取剧情优化模板 |

---

## 模块依赖关系图

```
┌─────────────────────────────────────────────────────────────┐
│                        src/index.js                         │
│                        (主入口)                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
    ┌─────────────────────┼─────────────────────┐
    │                     │                     │
    ▼                     ▼                     ▼
┌─────────┐        ┌─────────────┐        ┌─────────┐
│  core/  │◄───────│    ui/      │        │ hooks/  │
│ logger  │        │ components  │        │ send-   │
│ const   │        │ modals      │        │ button  │
│ error   │        │ events      │        │ inter-  │
│ st-api  │        └──────┬──────┘        │ ceptor  │
└────┬────┘               │               └────┬────┘
     │                    │                    │
     │              ┌─────┴─────┐              │
     │              │           │              │
     ▼              ▼           ▼              ▼
┌─────────┐   ┌─────────┐ ┌─────────┐   ┌─────────┐
│ config/ │◄──│ world-  │ │ memory/ │──►│  api/   │
│ manager │   │ book/   │ │ process │   │ adapter │
│ default │   │ api     │ │ merger  │   │ openai  │
│ books   │   │ parser  │ │ prompt  │   │ claude  │
│ prompts │   │ refresh │ │ jailbrk │   │ google  │
└─────────┘   └─────────┘ └─────────┘   └─────────┘
                  │             │
                  └──────┬──────┘
                         │
                    ┌────┴────┐
                    │ utils/  │
                    │ message │
                    │ tag-flt │
                    │ prompt  │
                    └─────────┘
```

---

## 常见维护场景

### 场景 1：修改 AI API 调用逻辑
- 查看 `src/api/adapter.js`
- 各提供商实现在 `src/api/providers/`

### 场景 2：修改配置保存逻辑
- 查看 `src/config/config-manager.js`
- 默认值在 `src/config/default-config.js`

### 场景 3：修改提示词编辑器
- 查看 `src/ui/modals/prompt-editor.js`
- 提示词文件存储在 `src/config/prompt-files.js`

### 场景 4：修改世界书处理
- 解析逻辑在 `src/worldbook/parser.js`
- API 调用在 `src/worldbook/api.js`

### 场景 5：修改记忆处理流程
- 核心处理在 `src/memory/processor.js`
- 结果合并在 `src/memory/result-merger.js`

### 场景 6：修改 UI 事件
- 事件绑定在 `src/ui/events.js`
- 各弹窗在 `src/ui/modals/`

---

## 构建命令

```bash
# 开发模式（带 source map）
npm run build:dev

# 生产模式（压缩）
npm run build

# 监听模式（自动重建）
npm run dev
```

---

## 文件路径别名

在源代码中可以使用以下路径别名：

| 别名 | 实际路径 |
|-----|---------|
| `@` | `src/` |
| `@core` | `src/core/` |
| `@config` | `src/config/` |
| `@worldbook` | `src/worldbook/` |
| `@api` | `src/api/` |
| `@memory` | `src/memory/` |
| `@hooks` | `src/hooks/` |
| `@ui` | `src/ui/` |
| `@utils` | `src/utils/` |

---

## 版本信息

- **版本**: v0.4.1
- **架构**: 模块化 + Webpack 打包
- **入口**: `dist/index.js`
- **许可**: AGPL-3.0
- **作者**: 可乐、繁华

---

## 版本号更新清单

发布新版本时，需要更新以下文件中的版本号：

| 文件 | 位置 | 说明 |
|-----|------|------|
| `manifest.json` | `version` 字段 | 插件清单版本 |
| `package.json` | `version` 字段 | NPM 包版本 |
| `README.md` | 版本徽章 URL | 显示版本徽章 |
| `CHANGELOG.md` | 新版本条目 | 更新日志 |
| `ui/panel.html` | 第92行 `mm-author-text` | 界面显示版本 |
| `docs/MODULE_REFERENCE.md` | 版本信息章节 | 模块文档版本 |

**更新后必须重新构建**：
```bash
npm install
npm run build
```

构建后 `dist/index.js` 会更新，发布前删除 `node_modules/`。
