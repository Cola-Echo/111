# Memory Manager Concurrent (记忆管理并发系统)

[![Version](https://img.shields.io/badge/version-0.4.1-blue.svg)](https://github.com/Cola-Echo/memory-manager-concurrent)
[![License](https://img.shields.io/badge/license-AGPLv3-green.svg)](./LICENSE)
[![SillyTavern](https://img.shields.io/badge/SillyTavern-%3E%3D1.12.0-orange.svg)](https://github.com/SillyTavern/SillyTavern)

为 SillyTavern 设计的智能记忆管理扩展，让 AI 在长期对话中保持记忆连贯性。

---

## 简介

**Memory Manager Concurrent** 是一个智能记忆助手，解决 AI 在长期角色扮演对话中的"失忆"问题。

### 它解决什么问题？

- **AI"失忆"** - 聊了几十条消息后，AI 忘记了之前提到的重要信息
- **角色不一致** - 角色的性格、背景设定前后矛盾
- **剧情混乱** - 复杂的世界观和多条故事线容易搞混
- **信息过载** - 世界书里有几百条设定，AI 无法全部记住

### 它如何工作？

插件就像给 AI 配了一个"智能秘书"：
1. 在你发送消息前，自动分析对话内容
2. 从世界书中检索当前相关的记忆
3. 把这些信息整理好，注入到对话中
4. 让 AI 的回复更加连贯、准确、符合设定

---

## 功能特性

- **智能记忆检索** - 自动分析对话，提取关键词，检索相关记忆
- **并发处理** - 同时处理多个记忆分类，提高效率
- **世界书管理** - 自动识别记忆书和历史书，支持分类配置
- **剧情优化助手** - 分析剧情风险，提供优化建议
- **实时进度显示** - 可视化处理进度，支持任务取消
- **历史事件回溯** - 回忆之前发生的重要事件，保持剧情连贯

---

## 快速开始

### 安装

**方式一：通过 SillyTavern 扩展管理器**
1. 打开 SillyTavern
2. 进入扩展管理器
3. 搜索 "Memory Manager Concurrent"
4. 点击安装

**方式二：手动安装**
1. 下载本仓库
2. 将文件夹复制到 `SillyTavern/public/scripts/extensions/third-party/`
3. 重启 SillyTavern

### 基本配置

1. **打开设置面板**
   - 点击 SillyTavern 顶部的"扩展"菜单
   - 找到"Memory Manager Concurrent"

2. **配置 API**
   - 选择 AI 服务（OpenAI、Claude 等）
   - 填入 API 地址和密钥
   - 测试连接

3. **选择世界书**
   - 在世界书列表中勾选要使用的书
   - 插件会自动识别类型

4. **调整参数**（可选）
   - 上下文轮数：默认 10
   - 相关度阈值：默认 0.5
   - 最大结果数：默认 10

### 推荐配置

**新手配置：**
```
上下文轮数：5
相关度阈值：0.6
最大结果数：5
```

**高级配置：**
```
上下文轮数：15
相关度阈值：0.4
最大结果数：15
```

---

## 使用场景

### 长期角色扮演对话
把重要设定写入世界书，插件会自动在需要时提醒 AI 这些设定。

### 复杂世界观维护
使用分类世界书（角色表、地点表、物品表），配置合适的相关度阈值。

### 多角色一致性保持
为每个角色创建详细档案，使用角色分类功能保持独特性格。

---

## 文档

- [完整用户手册](./docs/USER_GUIDE.md) - 详细的功能说明和使用技巧
- [模块参考手册](./docs/MODULE_REFERENCE.md) - 源代码模块说明（开发者）
- [更新日志](./CHANGELOG.md) - 版本历史和变更记录

---

## 系统要求

- **SillyTavern** >= 1.12.0
- **支持的 AI 服务**：
  - OpenAI (GPT-3.5, GPT-4)
  - Anthropic Claude
  - 本地模型 (Ollama, LM Studio)
  - 其他兼容 OpenAI API 格式的服务

---

## 常见问题

**Q: 插件会让回复变慢吗？**
A: 会稍微增加等待时间（通常 2-5 秒），但换来更准确、更连贯的回复。

**Q: 我的世界书很大（500+ 条目），会有问题吗？**
A: 不会，插件专门优化了大型世界书的处理，使用相关度过滤和并发处理。

**Q: 插件会消耗很多 API 额度吗？**
A: 每次发送消息会额外调用 1-5 次 API。可以使用"索引合并模式"减少调用次数。

更多问题请查看 [完整用户手册](./docs/USER_GUIDE.md#-常见问题)。

---

## 获取帮助

1. **查看控制台日志** - 按 F12 打开开发者工具，搜索 `[MemoryManager]`
2. **检查配置** - 确认 API 地址和密钥正确
3. **提交 Issue** - 在 [GitHub Issues](https://github.com/Cola-Echo/memory-manager-concurrent/issues) 反馈问题

---

## 许可证

本项目采用 [AGPLv3](./LICENSE) 许可证开源。

---

## 作者

**可乐、繁华**

---

## 致谢

感谢 SillyTavern 社区的支持和反馈。
