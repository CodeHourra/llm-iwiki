# llm-iwiki

面向 AI Agent 的本地知识库 CLI。

`llm-iwiki` 会采集 Claude Code、Cursor、Codex、CodeBuddy 等 AI 编程工具的本地会话记录，按项目归一化到 SQLite，再通过 AI 工具生成结构化 YAML 摘要和经验候选，最终导出到 Obsidian。

## 安装

> 运行时依赖 [Bun](https://bun.sh)（CLI 入口为 TypeScript，使用 `bun` shebang）。

```bash
# 全局安装
npm install -g @codehourra/llm-iwiki
# 或使用 bun
bun add -g @codehourra/llm-iwiki

llm-iwiki init      # 初始化配置与状态库
llm-iwiki doctor    # 自检
```

也可以免安装、用 `npx` / `bunx` 直接运行（CLI 入口为 TypeScript，需本机已安装 Bun）：

```bash
# 一次性运行（不全局安装）
npx @codehourra/llm-iwiki init
npx @codehourra/llm-iwiki sync

# 或使用 bunx
bunx @codehourra/llm-iwiki doctor
```

## 当前状态

- Milestone 1（CLI 骨架与状态库）已完成：`init` / `doctor` / `projects resolve` / `projects rename`。
- Milestone 2（Collectors）基本完成：已实现 **Claude Code / Codex / Cursor / Gemini / CodeBuddy** 五个 collector 与 `sync`，可把本地会话按项目归一化入库，并通过 `projects list` / `projects inspect` 按项目维度跨工具聚合查看。
- Milestone 4（AI 协作总结）已完成：`summarize prepare` / `experiences prepare` 生成压缩后的 AI 任务，`summarize apply` / `experiences propose` 把外部 AI 产出的 YAML 落库到 `session_summaries` / `experience_candidates`。
- Milestone 5（Obsidian 导出）已完成：`config set obsidian.vault <dir>` 配置库路径，`obsidian export` 将会话总结、已 accept 的经验和项目索引写成带 frontmatter + managed block 的 Markdown 笔记。更新采用非破坏式协议——保留用户手写区，托管块被手动改动时标记冲突并跳过，`--force` 才覆盖；`obsidian check` 只读扫描 vault 报告 drift/missing。
- 经验生命周期：`experiences propose` 落库为候选（`experience_candidates`），`experiences candidates` 列出待审，`experiences accept/reject` 决定去留；accept 会把候选提升为正式 `experiences` 并建立 `session_experience_links`，再由 `obsidian export` 写出。
- AI 助手集成：`skills init` 把 Claude Code / Codex / Cursor 使用的 skill 模板写入当前项目，驱动上述工作流。

```bash
llm-iwiki sync                                          # 采集本地 AI 工具会话
llm-iwiki projects list                                 # 按项目查看会话数
llm-iwiki projects inspect .                            # 查看某项目下各工具的会话
llm-iwiki summarize prepare changed --project .         # 生成会话总结任务
llm-iwiki summarize apply --project . --file summaries.yaml
llm-iwiki experiences prepare --project . --from changed-summaries
llm-iwiki experiences propose --project . --file experiences.yaml
llm-iwiki experiences candidates --project .            # 查看经验候选
llm-iwiki experiences accept <candidate-id>             # 采纳为正式经验
llm-iwiki config set obsidian.vault ~/Obsidian/Vault    # 配置 Obsidian 库
llm-iwiki obsidian export --project .                   # 导出为 Markdown 笔记
llm-iwiki obsidian check                                # 检查笔记是否漂移
llm-iwiki skills init                                   # 写入 AI 助手 skill 模板
```

### `skills init`

把 AI 编程助手使用的 skill 模板写入当前项目，让 Claude Code / Codex / Cursor 能按规范驱动上面的 `summarize` / `experiences` 工作流。

```bash
llm-iwiki skills init [--target codex|claude-code|cursor] [--force] [--dry-run]
```

- `--target`：只写入指定助手的模板；省略则写入全部三种。
- `--force`：覆盖已存在的同名文件（默认跳过）。
- `--dry-run`：只预演将写入/跳过的文件，不落盘。

## 待完成能力地图

以下为已在设计文档中规划、但尚未实现的进阶能力（按优先级粗排）：

| 能力 | 命令 | 说明 | 状态 |
| --- | --- | --- | --- |
| 经验融合 | `experiences merge <candidate-id> <experience-id>` | 人工确认后把候选正文融合进已有经验，先生成 `merge-preview-*.md` 预览，确认后改写 managed block，合并 `source_sessions` / `evidence`，保留用户手写区 | 待开发 |
| 项目目录迁移 | `obsidian move-project <project-id>` | `projects rename` 后按 `obsidian_notes` 映射与 frontmatter 中的 `aiwiki_project_id` 迁移 vault 目录，目标已存在时先做冲突检查 | 待开发 |
| 结构化检索 | `search [sessions\|experiences] <query>` | SQLite FTS5 为主检索（projects / sessions / messages / summaries / experiences），可选 ripgrep 检索已导出 Markdown，`--index sqlite\|obsidian\|all` 切换 | 待开发 |
| 打开笔记 | `obsidian open <note-id>` | 在 Obsidian 中直接打开对应笔记 | 待开发 |
| 路径冲突批处理 | `obsidian export --overwrite-conflicts \| --skip-conflicts` | 目录迁移 / 导出时对路径冲突批量选择，跳过的标记 `conflict_status=path_conflict` 供 `obsidian check` 持续报告 | 待开发 |
| 增量范围导出 | `obsidian export --changed \| --all` | 按变更范围而非单项目导出 | 待开发 |
| 时间窗筛选 | `experiences prepare --since 30d` | 经验提炼任务按时间窗口限定来源摘要 | 待开发 |
