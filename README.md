# llm-iwiki

面向 AI Agent 的本地知识库 CLI。

`llm-iwiki` 会采集 Claude Code、Cursor、Codex、CodeBuddy 等 AI 编程工具的本地会话记录，按项目归一化到 SQLite，再通过 AI 工具生成结构化 YAML 摘要和经验候选，最终导出到 Obsidian。

## 当前状态

- Milestone 1（CLI 骨架与状态库）已完成：`init` / `doctor` / `projects resolve` / `projects rename`。
- Milestone 2（Collectors）基本完成：已实现 **Claude Code / Codex / Cursor / Gemini / CodeBuddy** 五个 collector 与 `sync`，可把本地会话按项目归一化入库，并通过 `projects list` / `projects inspect` 按项目维度跨工具聚合查看。

```bash
llm-iwiki sync                 # 采集本地 AI 工具会话
llm-iwiki projects list        # 按项目查看会话数
llm-iwiki projects inspect .   # 查看某项目下各工具的会话
```

XunJi 桌面应用代码仅作为参考资料保存在 `refer/xunji/`，不参与本项目的构建、测试或发布。
