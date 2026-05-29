# llm-iwiki

面向 AI Agent 的本地知识库 CLI。

`llm-iwiki` 会采集 Claude Code、Cursor、Codex、CodeBuddy 等 AI 编程工具的本地会话记录，按项目归一化到 SQLite，再通过 AI 工具生成结构化 YAML 摘要和经验候选，最终导出到 Obsidian。

## 当前状态

- Milestone 1（CLI 骨架与状态库）已完成：`init` / `doctor` / `projects resolve` / `projects rename`。
- Milestone 2（Collectors）基本完成：已实现 **Claude Code / Codex / Cursor / Gemini / CodeBuddy** 五个 collector 与 `sync`，可把本地会话按项目归一化入库，并通过 `projects list` / `projects inspect` 按项目维度跨工具聚合查看。
- Milestone 4（AI 协作总结）已完成：`summarize prepare` / `experiences prepare` 生成压缩后的 AI 任务，`summarize apply` / `experiences propose` 把外部 AI 产出的 YAML 落库到 `session_summaries` / `experience_candidates`。
- Milestone 5（Obsidian 导出）基本完成：`config set obsidian.vault <dir>` 配置库路径，`obsidian export` 将会话总结、经验候选和项目索引写成带 frontmatter + managed block 的 Markdown 笔记。更新采用非破坏式协议——保留用户手写区，托管块被手动改动时标记冲突并跳过，`--force` 才覆盖。

```bash
llm-iwiki sync                                          # 采集本地 AI 工具会话
llm-iwiki projects list                                 # 按项目查看会话数
llm-iwiki projects inspect .                            # 查看某项目下各工具的会话
llm-iwiki summarize prepare changed --project .         # 生成会话总结任务
llm-iwiki summarize apply --project . --file summaries.yaml
llm-iwiki experiences prepare --project . --from changed-summaries
llm-iwiki experiences propose --project . --file experiences.yaml
llm-iwiki config set obsidian.vault ~/Obsidian/Vault    # 配置 Obsidian 库
llm-iwiki obsidian export --project .                   # 导出为 Markdown 笔记
```

XunJi 桌面应用代码仅作为参考资料保存在 `refer/xunji/`，不参与本项目的构建、测试或发布。
