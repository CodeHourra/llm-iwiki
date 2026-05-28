# llm-iwiki

面向 AI Agent 的本地知识库 CLI。

`llm-iwiki` 会采集 Claude Code、Cursor、Codex、CodeBuddy 等 AI 编程工具的本地会话记录，按项目归一化到 SQLite，再通过 AI 工具生成结构化 YAML 摘要和经验候选，最终导出到 Obsidian。

## 当前状态

项目处于 CLI foundation 阶段。XunJi 桌面应用代码仅作为参考资料保存在 `refer/xunji/`，不参与本项目的构建、测试或发布。
