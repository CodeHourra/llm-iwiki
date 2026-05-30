# llm-iwiki

面向 AI Agent 的本地知识库 CLI。

`llm-iwiki` 会采集 Claude Code、Cursor、Codex、CodeBuddy 等 AI 编程工具的本地会话记录，按项目归一化到 SQLite，再通过 AI 工具生成结构化 YAML 摘要和经验候选，最终导出到 Obsidian。

## 安装

> 运行时只需 [Node.js](https://nodejs.org) ≥ 20（无需 Bun）。SQLite 通过原生模块 `better-sqlite3` 提供，`npm install` 时自动下载预编译二进制。

```bash
# 全局安装
npm install -g @codehourra/llm-iwiki

llm-iwiki init      # 初始化配置与状态库
llm-iwiki doctor    # 自检
```

也可以免安装、用 `npx` 直接运行：

```bash
npx @codehourra/llm-iwiki init
npx @codehourra/llm-iwiki sync
```

## 发布与变更记录

项目使用 [Changesets](https://github.com/changesets/changesets) 管理版本号、`CHANGELOG.md` 与 npm 发布：

```bash
bun run changeset          # 为当前改动创建 changeset
bun run version-packages   # 本地生成版本号和 CHANGELOG（通常由 CI 执行）
bun run release            # 构建并发布到 npm（通常由 CI 执行）
```

每个会影响用户的 PR 应附带一个 `.changeset/*.md` 文件。PR 合并到 `master` 后，GitHub Actions 会自动创建/更新 Release PR；合并 Release PR 后，workflow 使用仓库 Secret `NPM_TOKEN` 发布到 npm。`GITHUB_TOKEN` 由 GitHub Actions 自动提供，不需要手动配置。

## 当前状态

- Milestone 1（CLI 骨架与状态库）已完成：`init` / `doctor` / `projects resolve` / `projects rename`。
- Milestone 2（Collectors）基本完成：已实现 **Claude Code / Codex / Cursor / Gemini / CodeBuddy** 五个 collector 与 `sync`，可把本地会话按项目归一化入库，并通过 `projects list` / `projects inspect` 按项目维度跨工具聚合查看。
- Milestone 4（AI 协作总结）已完成：`summarize prepare` / `experiences prepare` 生成压缩后的 AI 任务，`summarize apply` / `experiences propose` 把外部 AI 产出的 YAML 落库到 `session_summaries` / `experience_candidates`。
- Milestone 5（Obsidian 导出）已完成：`config set obsidian.vault <dir>` 配置库路径，`obsidian export` 将会话总结、已 accept 的经验和项目索引写成带 frontmatter + managed block 的 Markdown 笔记。更新采用非破坏式协议——保留用户手写区，托管块被手动改动时标记冲突并跳过，`--force` 才覆盖；`obsidian check` 只读扫描 vault 报告 drift/missing。
- 经验生命周期：`experiences propose` 落库为候选（`experience_candidates`），`experiences candidates` 列出待审，`experiences accept/reject` 决定去留；accept 会把候选提升为正式 `experiences` 并建立 `session_experience_links`，再由 `obsidian export` 写出。
- AI 助手集成：`skills init` 把一个中文 skill（`aiwiki-knowledge`）写入当前项目的 `.agents/skills/`，让 Claude Code / Codex / Cursor 读了即可自驱动「采集 → 总结 → 经验 → 导出」全流程，并内置了 YAML 输出规则避免格式错误。
- v0.3 输出质量与匹配增强：
  - 统一项目解析：所有 `--project` 接受「路径 / `proj_xxx` / 名称或 slug」，按 session 数最多者匹配现有项目，**不再误建空项目**；`projects dedupe` / `projects merge` 清理历史重复记录。
  - 会话可读：`sessions list` / `sessions read <id>` 直接查看压缩后的真实对话正文，配合落库占位符校验，避免凭空编造摘要。
  - Obsidian 目录重构：项目目录用 slug 命名（不再是整串 URL），`Projects/<slug>/{sessions,experiences}` 分类存放，自动生成知识库根 `README.md` 索引与 `Topics/` 跨项目主题聚合页，Project Summary 富化为「概览 / 技术栈 / 相关经验 / 演进时间线」并带 wikilink 回链。
  - 经验内容更厚：YAML 支持 `topic` / `tech_stack` / `problem_type`，落库并写入笔记 frontmatter 与主题索引。
  - 检索与增量：`search <sessions|experiences> <query>`（中文子串检索）、`experiences prepare --since 30d`、`obsidian export --all`、`obsidian move-project` 迁移旧目录。

```bash
llm-iwiki sync                                          # 采集本地 AI 工具会话
llm-iwiki projects list                                 # 按项目查看会话数
llm-iwiki projects inspect .                            # 查看某项目下各工具的会话（--project 也接受 proj_xxx / 名称）
llm-iwiki projects dedupe                                # 合并历史重复项目记录
llm-iwiki sessions list --project .                     # 列出会话及其 id
llm-iwiki sessions read <session-id>                    # 查看真实会话正文，避免编造
llm-iwiki summarize prepare changed --project .         # 生成会话总结任务
llm-iwiki summarize apply --project . --file summaries.yaml
llm-iwiki experiences prepare --project . --from changed-summaries --since 30d
llm-iwiki experiences propose --project . --file experiences.yaml
llm-iwiki experiences candidates --project .            # 查看经验候选
llm-iwiki experiences accept <candidate-id>             # 采纳为正式经验
llm-iwiki search experiences 登录态                       # 跨项目检索经验/会话
llm-iwiki config set obsidian.vault ~/Obsidian/Vault    # 配置 Obsidian 库
llm-iwiki obsidian export --project .                   # 导出为 Markdown 笔记（--all 导出全部）
llm-iwiki obsidian move-project .                        # 把旧目录迁移到新的 slug 结构
llm-iwiki obsidian check                                # 检查笔记是否漂移
llm-iwiki skills init                                   # 写入 AI 助手 skill 模板
```

### `skills init`

把中文 skill `aiwiki-knowledge` 写入当前项目的 `.agents/skills/`，让 Claude Code / Codex / Cursor 读了就能自驱动 `sync` → `summarize` → `experiences` → `obsidian export` 全流程。该 skill 内置了 YAML 输出规则（纯 YAML、不要代码围栏、不要占位符、`value` 四选一等），避免常见的格式错误。

```bash
llm-iwiki skills                # 列出可用 target 与将写入的 skill（等同 skills list）
llm-iwiki skills init [--target codex|claude-code|cursor] [--force] [--dry-run]
```

- 裸 `skills` / `skills list`：只读列出可用 target 和将写入 `.agents/skills/` 的 skill，不落盘。
- `--target`：在 skill 末尾附上对应助手（Codex / Claude Code / Cursor）的适配说明；省略则不附加。
- `--force`：覆盖已存在的同名文件（默认跳过）。
- `--dry-run`：只预演将写入/跳过的文件，不落盘。

## 待完成能力地图

以下为已在设计文档中规划、但尚未实现的进阶能力（按优先级粗排）：

| 能力 | 命令 | 说明 | 状态 |
| --- | --- | --- | --- |
| 项目去重 / 合并 | `projects dedupe` / `projects merge <from> <into>` | 按 repo / slug 合并重复项目，重指向 sessions / summaries / experiences / candidates / notes | 已实现（v0.3） |
| 会话内容读取 | `sessions read <id>` / `sessions list` | 输出压缩后的真实对话正文，避免编造摘要 | 已实现（v0.3） |
| 项目目录迁移 | `obsidian move-project <project>` | 把旧导出目录迁移到当前 slug 目录，目标已存在时报冲突 | 已实现（v0.3） |
| 结构化检索 | `search <sessions\|experiences> <query>` | 子串检索（对中文友好，不依赖 FTS5 分词器）；`--project` 限定范围 | 已实现（v0.3） |
| 增量范围导出 | `obsidian export --all` | 一次导出全部项目并刷新全局索引 | 已实现（v0.3） |
| 时间窗筛选 | `experiences prepare --since 30d` | 经验提炼任务按时间窗口限定来源摘要 | 已实现（v0.3） |
| 经验融合 | `experiences merge <candidate-id> <experience-id>` | 人工确认后把候选正文融合进已有经验，先生成预览再改写 managed block | 待开发 |
| 打开笔记 | `obsidian open <note-id>` | 在 Obsidian 中直接打开对应笔记 | 待开发 |

## 常见问题（FAQ）

- **`--project` 报「找不到唯一项目」或多个候选？** 先 `llm-iwiki sync` 采集会话；历史库里有重复项目时运行 `llm-iwiki projects dedupe`；或直接用 `--project proj_xxx` 精确指定（`projects list` 可查 id）。
- **怎么避免 AI 编造摘要？** 摘要任务文件已内嵌压缩会话正文；也可用 `llm-iwiki sessions read <id>` 单独核对。落库时会校验占位符，残留 `<...>` 会被拒绝。
- **导出目录名是整串仓库 URL？** v0.3 起目录改用 slug 命名；旧库执行 `llm-iwiki obsidian move-project <project>` 迁移到新结构，再 `obsidian export --all` 刷新索引。
