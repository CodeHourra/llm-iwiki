# LLM iWiki CLI 设计草案

日期：2026-05-27
状态：待评审草案

## 1. 目标

构建一个面向 AI Agent 的 CLI 工具。它可以从 Claude Code、Cursor、Codex、CodeBuddy 等 AI 编程工具中采集本地对话记录，把分散在多个项目、多个 checkout、多个会话中的信息归一化，再配合 AI 工具和 skills 总结为项目经验，并写入 Obsidian，形成个人项目经验知识库。

CLI 是执行引擎。Skills 负责告诉 AI 编程助手什么时候调用 CLI、如何调用 CLI，并由当前 AI 工具完成第一版的总结和提炼。Obsidian 是人可读、可编辑、可双链管理的知识库前端。SQLite 是机器侧的状态库和增量索引。

这个项目不是复刻 XunJi 桌面应用。XunJi 只作为参考，用来理解 Claude Code、Cursor、CodeBuddy、Codex 等工具的常见会话存储路径、文件格式和采集实现思路。

代码仓库也按这个边界组织：根目录是新的 `llm-iwiki` CLI 项目，XunJi 只能放在 `refer/xunji/` 作为参考资料和实现样本，不能作为 monorepo package 混入 `llm-iwiki` 的构建、测试或发布流程。

## 2. MVP 非目标

- 不做桌面 UI。
- 第一版不做 MCP server。
- 第一版不做 Obsidian 插件。
- 第一版不内置 LLM API provider。
- 不做云端同步服务。
- 不破坏性覆盖用户手动编辑过的 Obsidian 内容。
- 不要求 Obsidian 正在运行，CLI 直接写 Markdown 文件即可。

如果后续发现 CLI + skills 对 AI 工具来说不够顺手，再增加 `llm-iwiki mcp` 作为增强能力。如果后续希望自闭环完成“采集 -> 提炼 -> 写入”，再增加 OpenAI-compatible 或本地 CLI provider。

## 3. 架构

```text
AI 编程工具
  Claude Code / Cursor / Codex / CodeBuddy
        |
        v
Collectors
  解析各工具本地原始会话存储
        |
        v
Normalizer
  统一为 Session + Message 模型
        |
        v
Project Resolver
  基于 git remote canonical URL 归一化 project_id
        |
        v
SQLite
  原始会话、消息、hash、摘要、经验关系、Obsidian 文件映射
        |
        v
Preprocessor
  清洗、压缩、分块、缓存
        |
        v
AI Summarizer
  由外部 AI 工具基于 CLI 输出生成会话摘要和经验候选
        |
        v
Merge Review
  保守自动合并 + 半自动候选确认
        |
        v
Obsidian Writer
  Markdown、frontmatter、wikilinks、managed blocks
```

## 4. 核心原则

1. CLI 是确定性行为的核心。
   采集、归一化、项目识别、增量状态、总结编排、Obsidian 写入都由 CLI 负责。

2. 第一版不内置 LLM。
   CLI 负责生成压缩后的会话上下文、结构化提炼任务和结果落库接口。总结和提炼由调用 CLI 的 Claude、Cursor、Codex 等 AI 工具完成。

3. SQLite 是机器真相。
   它保存原始会话、消息、hash、处理状态、项目身份，以及生成知识与 Obsidian 文件之间的映射。

4. Obsidian 是知识真相。
   它保存人可读、可编辑、可双链组织的 Markdown 笔记、索引页和人工补充内容。

5. Skills 是工作流适配层。
   它们告诉 Codex、Claude Code、Cursor 等 AI 编程工具，在 debug 前、会话结束后、项目复盘时应该调用哪些 CLI 命令。

6. 路径不是项目身份。
   同一个 git 项目可能在多个磁盘目录、多个 worktree、多个临时 clone 中出现。默认使用 git remote canonical URL 识别项目。

7. AI 产物必须非破坏式更新。
   CLI 只更新 managed block 和少量机器管理的 frontmatter 字段。用户手写内容必须保留。

8. 大会话必须先压缩再调用模型。
   AI coding 对话中常有大量 tool result、源码 dump、重复日志和构建输出，不能直接整段塞给模型。

## 5. 命名决策

推荐 npm package 与 binary 统一使用：

```text
llm-iwiki
```

选择理由：

- 能表达目标：面向 LLM/AI 编程会话沉淀的个人 iWiki。
- npm package 和 binary 同名，便于 `npx llm-iwiki` 与全局安装。
- 比 `aiwiki` 更安全：`aiwiki` 在 npm 上曾发布后撤回，不建议使用。
- 比 `code-iwiki`、`dev-iwiki` 更贴近长期方向：本工具不只服务代码搜索，也服务项目经验沉淀。

2026-05-27 使用官方 npm registry 检测结果：

- `llm-iwiki`：未占用。
- `code-iwiki`：未占用。
- `dev-iwiki`：未占用。
- `aiwiki`：曾发布后撤回，不推荐。

命名暂不最终锁定。实现计划中继续使用 `llm-iwiki` 作为工作名；真正发布 npm 前，再做最后一次 registry 查重和命名确认。

## 6. CLI 命令设计

### 6.1 初始化与配置

```bash
llm-iwiki init
llm-iwiki config show
llm-iwiki config set obsidian.vault /path/to/vault
llm-iwiki doctor
```

`init` 创建：

- `~/.llm-iwiki/config.toml`
- `~/.llm-iwiki/llm-iwiki.db`
- 默认数据源配置
- 默认 Obsidian 模板
- skills 目录或安装提示

### 6.2 数据源

```bash
llm-iwiki sources detect
llm-iwiki sources list
llm-iwiki sources enable claude-code
llm-iwiki sources enable cursor
llm-iwiki sources enable codex
llm-iwiki sources enable codebuddy
llm-iwiki sources disable <source>
```

`sources detect` 只检测常见本地存储路径是否存在，不导入数据。

第一版数据源参考：

- Claude Code：读取 `.claude/projects` 和 `.claude-internal/projects` 下的 JSONL。
- Cursor：读取 `User/globalStorage/state.vscdb` 和 `User/workspaceStorage/*`。
- CodeBuddy：读取 `CodeBuddyExtension/Data/**/history/**` 下包含 `index.json` 和 `messages/` 的会话目录。
- Codex：初步识别 `.codex-internal/sessions/YYYY/MM/DD/rollout-*.jsonl`、`.codex-internal/session_index.jsonl`、`.codex-internal/history.jsonl`、`.codex-internal/state_*.sqlite` 等来源；需实现时继续抽象为可配置路径。

### 6.3 同步与增量状态

```bash
llm-iwiki scan
llm-iwiki sync
llm-iwiki sync --source cursor
llm-iwiki sync --project /path/to/checkout
llm-iwiki sync --since 7d
llm-iwiki status
llm-iwiki diff
```

`scan` 只读取原始存储并报告候选会话，不写入 normalized messages。

`sync` 写入或更新 SQLite：

- 新会话：标记为 `new`
- 已知会话且 content hash 未变化：标记为 `unchanged`
- 已知会话且 message hash 变化：标记为 `changed`
- 原始文件消失：保留记录，标记为 `source_missing`

### 6.4 项目归一化

```bash
llm-iwiki projects resolve /path/to/checkout
llm-iwiki projects list
llm-iwiki projects inspect <project-id>
llm-iwiki projects rename <project-id> "Project Display Name"
llm-iwiki projects rename . "Project Display Name"
llm-iwiki projects merge <project-a> <project-b>
llm-iwiki projects split <project-id>
llm-iwiki projects alias add <project-id> /some/path
llm-iwiki projects canonical set <project-id> github.com/owner/repo
```

项目身份识别优先级：

1. Git remote canonical URL。
2. Git root fingerprint。
3. 从 `package.json`、`Cargo.toml`、`pyproject.toml`、`go.mod` 等 manifest 推导项目身份。
4. 路径兜底。
5. 用户手动 merge、split、alias、canonical override。

`project_id` 是机器稳定身份，不随用户改名变化。`projects rename` 只更新 `display_name`，用于 CLI 展示、任务说明和 Obsidian 导出标题。`.` 是快捷写法，表示先解析当前 checkout 对应的 project。

### 6.5 会话查看与压缩

```bash
llm-iwiki sessions list
llm-iwiki sessions changed
llm-iwiki sessions show <session-id>
llm-iwiki sessions compact <session-id>
llm-iwiki sessions compact <session-id> --show
llm-iwiki sessions context <session-id>
llm-iwiki sessions context <session-id> --for summarize
```

`sessions compact` 执行确定性的会话压缩管线，并把压缩结果缓存到 SQLite。

`sessions context` 输出给 AI 工具阅读的确定性上下文，不调用内置 LLM。Skills 可以把该输出交给当前 AI 工具总结。

### 6.6 总结与知识提取

```bash
llm-iwiki summarize prepare changed --project . --out .llm-iwiki/tasks/summaries-task.md
llm-iwiki summarize prepare session <session-id> --out .llm-iwiki/tasks/summaries-task.md
llm-iwiki summarize apply --project . --file .llm-iwiki/tasks/summaries.yaml
llm-iwiki experiences prepare --project . --from changed-summaries --out .llm-iwiki/tasks/experiences-task.md
llm-iwiki experiences prepare --project . --from all-recent --since 30d --out .llm-iwiki/tasks/experiences-task.md
llm-iwiki experiences propose --project . --file .llm-iwiki/tasks/experiences.yaml
llm-iwiki experiences candidates
llm-iwiki experiences merge <candidate-id> <experience-id>
llm-iwiki experiences accept <candidate-id>
llm-iwiki experiences reject <candidate-id>
```

总结产物分两层：

- 会话摘要：证据层。一场有价值的对话对应一篇 session summary。
- 主题经验：知识层。一条 topic-oriented experience 可以来自多个会话。

MVP 中，`prepare` 命令只生成 Markdown 任务说明、压缩上下文、YAML 输出格式和提炼要求。Claude、Cursor、Codex 等外部 AI 工具根据 skills 完成总结，产出 `summaries.yaml` / `experiences.yaml`，再通过 `apply` / `propose` 命令把结构化结果写回 SQLite。

AI 交换格式使用 YAML，而不是 JSON。原因是批量会话摘要和经验候选会包含大量 Markdown 正文，YAML 的 block scalar 更省 token、更易读，也更方便人工修复。CLI 内部仍然必须把 YAML 解析为严格结构，校验后再入库。

MVP 合并策略：

- 只按明确相同的 `experience_id` 或稳定 slug 做保守自动合并。
- 对相似主题生成半自动合并候选。
- 用户或 AI skill 决定 accept、reject 或 merge。

默认以 project 为任务边界。`summarize prepare changed --project .` 会把当前项目下新增或变化的多个 session 组织成一个批量任务；AI 一次生成 `summaries.yaml`。`experiences prepare --project . --from changed-summaries` 再基于中高价值的 session summaries 生成项目级经验提取任务。

`summaries.yaml` 必填字段：

```yaml
project_id: proj_xxx

summaries:
  - session_id: ses_001
    title: Cursor SQLite 会话解析失败排查
    value: high
    summary_markdown: |
      本次会话排查了 Cursor state.vscdb 中会话内容无法正确提取的问题。
```

`summaries[].value` 枚举为 `none | low | medium | high`。`none` / `low` 允许入库，但默认不进入 experience prepare；`medium` / `high` 默认作为经验提取输入。

`summaries.yaml` 可选字段：

- `key_points`
- `decisions`
- `files_touched`
- `commands_run`
- `open_questions`
- `experience_seeds`
- `tags`

`experiences.yaml` 必填字段：

```yaml
project_id: proj_xxx

experiences:
  - title: Cursor SQLite + Lexical 富文本解析
    summary: |
      Cursor 的对话内容存储在 state.vscdb 中，消息正文嵌在 Lexical 富文本结构里。
    body_markdown: |
      ## 背景

      在实现 Cursor collector 时，不能把 state.vscdb 当作普通文本数据库读取。
    source_sessions:
      - ses_001
```

`experiences.yaml` 推荐字段包括 `slug`、`confidence`、`problem_type`、`solution_type`、`tech_stack`、`evidence`、`tags`。`confidence` 枚举为 `low | medium | high`。AI 输出中的 `status` 可省略，CLI 入库时统一设为 `proposed`。

`experiences propose` 默认只写入 `experience_candidates`，不直接覆盖已有 `experiences`。若发现同 slug 或相似主题，只标记候选关系。MVP 的 `merge` 保守处理：保留候选内容和证据，不自动改写已有经验正文。

### 6.7 Obsidian

```bash
llm-iwiki obsidian export --changed
llm-iwiki obsidian export --project <project-id>
llm-iwiki obsidian export --all
llm-iwiki obsidian move-project <project-id>
llm-iwiki obsidian check
llm-iwiki obsidian open <note-id>
```

Writer 直接把 Markdown 文件写入配置的 Obsidian vault。

默认导出行为：

- 文件不存在时创建。
- 安全时更新 managed block。
- 保留用户手写区块。
- 默认跳过冲突文件。

冲突处理参数：

```bash
llm-iwiki obsidian export --changed --force
```

`--force` 只强制覆盖 managed block，不覆盖用户区块。

MVP 不内置 LLM，因此不自动合并冲突。若用户改过 managed block，CLI 默认跳过并报告冲突；用户可以使用 `--force` 明确覆盖 managed block。

`projects rename` 后，Obsidian 项目目录自动迁移。迁移由 `obsidian export --project .` 触发，也可以显式运行 `obsidian move-project <project-id>`。迁移时以 `obsidian_notes` 的文件映射和 frontmatter 中的 `aiwiki_project_id` 为准，不按目录名猜测项目；目标目录已存在时先做冲突检查。

若目标目录存在文件冲突，CLI 列出冲突文件、来源路径和目标路径，并让用户选择覆盖或跳过。默认选择是跳过。支持逐个选择，也支持批量 `--overwrite-conflicts` 或 `--skip-conflicts`。已跳过的文件保留原路径映射并标记为 `conflict_status=path_conflict`，下一次 `obsidian check` 会继续报告。

### 6.8 搜索

```bash
llm-iwiki search "cursor sqlite"
llm-iwiki search "json parse" --project <project-id>
llm-iwiki search sessions "Cursor SQLite" --project <project-id>
llm-iwiki search experiences "JSON 解析失败" --project <project-id>
```

`search` 是确定性检索，返回 SQLite 中匹配的项目、会话、摘要和经验笔记。它会把检索到的会话片段或经验笔记输出给 Claude、Cursor、Codex 等 AI 工具作为上下文。

第一版推荐同时支持两类检索：

- SQLite FTS5：查 SQLite 中的结构化数据，包括 sessions、messages、session summaries、experiences。适合过滤项目、来源、时间、状态和会话关系，是 CLI 的主检索。
- ripgrep over Markdown：查 Obsidian 已导出的 Markdown 文件。适合覆盖用户手写补充、手动改写后的笔记和双链上下文，是 Obsidian 侧的补充检索。

默认 `llm-iwiki search` 先查 SQLite FTS5，再在启用 Obsidian vault 时追加 Markdown 命中。可通过参数拆开：

```bash
llm-iwiki search "Cursor SQLite" --index sqlite
llm-iwiki search "Cursor SQLite" --index obsidian
llm-iwiki search "Cursor SQLite" --index all
```

`--index all` 的排序策略：

1. SQLite 是主排序源。先分别查询 `experiences`、`session_summaries`、`sessions`、`messages`，用 FTS5 rank 计算基础分。
2. Obsidian Markdown 是补充信号。ripgrep 命中的 Markdown 会解析 frontmatter 中的 `aiwiki_id` / `aiwiki_project_id`，能映射回 SQLite 实体时与已有结果合并，不能映射时作为 `markdown_only` 结果追加。
3. 同一实体多处命中时去重合并，保留最强命中片段，并记录命中来源：`sqlite`、`obsidian` 或 `both`。
4. 默认加权：当前 project 命中优先；`experiences` 高于 `session_summaries`，`session_summaries` 高于原始 `messages`；标题和标签命中高于正文命中；`value=high` / `confidence=high` 高于低价值结果；近期 session 有轻微加分。
5. `markdown_only` 结果排在已映射实体之后，但如果来自当前项目且标题命中，可以进入前列。这样用户手写补充不会被淹没，也不会压过机器已知的结构化经验。

MVP 不提供内置 LLM synthesis，不实现 `query`。后续若接入 LLM provider，再增加 `query` 或 `answer` 命令实现自闭环问答。

## 7. SQLite 数据模型

### 7.1 Projects

```sql
projects (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  display_name TEXT,
  slug TEXT NOT NULL,
  canonical_repo_url TEXT,
  provider TEXT,
  identity_source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

project_checkouts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  local_path TEXT NOT NULL,
  git_root TEXT,
  remote_url TEXT,
  canonical_remote_url TEXT,
  current_branch TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
)

project_aliases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  alias_type TEXT NOT NULL,
  alias_value TEXT NOT NULL
)
```

`canonical_name` 来自机器推导，默认由 canonical repo URL 或 manifest 生成；`display_name` 是用户通过 `projects rename` 设置的可读名称；`slug` 用于文件路径和冲突规避。若未设置 `display_name`，CLI 展示和导出使用 `canonical_name`。

### 7.2 Sources And Sessions

```sql
sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  scan_paths TEXT,
  config_json TEXT,
  last_sync_at TEXT
)

sessions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  project_id TEXT,
  checkout_id TEXT,
  raw_project_path TEXT,
  raw_path TEXT,
  title TEXT,
  message_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(source_id, source_session_id, raw_path)
)

messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  seq_order INTEGER NOT NULL,
  content_hash TEXT NOT NULL
)
```

### 7.3 Compaction And AI Outputs

```sql
session_compactions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  compact_text TEXT NOT NULL,
  token_estimate INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, strategy, input_hash)
)

session_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  compaction_id TEXT NOT NULL,
  summary_markdown TEXT NOT NULL,
  key_points_json TEXT,
  value TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

experiences (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  problem_type TEXT,
  solution_type TEXT,
  tech_stack_json TEXT,
  summary TEXT,
  body_markdown TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, slug)
)

session_experience_links (
  session_id TEXT NOT NULL,
  experience_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  PRIMARY KEY (session_id, experience_id)
)

experience_candidates (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  source_session_id TEXT,
  proposed_title TEXT NOT NULL,
  proposed_slug TEXT NOT NULL,
  proposed_body_markdown TEXT NOT NULL,
  similar_experience_ids_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
)
```

### 7.4 Obsidian File Mapping

```sql
obsidian_notes (
  id TEXT PRIMARY KEY,
  note_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  managed_hash TEXT,
  frontmatter_hash TEXT,
  last_exported_at TEXT,
  last_seen_mtime TEXT,
  conflict_status TEXT NOT NULL,
  UNIQUE(note_type, entity_id)
)
```

## 8. 会话压缩管线

AI 编程对话可能包含大量 tool result、源码 dump、重复 diff、构建日志和内部 reasoning。CLI 必须先压缩，再送给 AI 总结。

管线：

```text
raw messages
  -> normalize roles
  -> strip internal thinking where present
  -> compress tool calls and tool results
  -> summarize command outputs
  -> remove duplicated source/log content
  -> preserve user goals, errors, decisions, files changed, commands, test results
  -> split into chunks when over budget
  -> summarize chunks
  -> merge chunk summaries
```

默认保留：

- 用户目标和约束。
- AI 的关键决策和解释。
- 读取或修改过的文件。
- 执行过的命令及成功/失败状态。
- 错误信息和 stack trace。
- 测试与验证结果。
- 最终结果和未解决问题。

默认压缩：

- 长文件读取结果。
- 超过阈值的 tool result。
- 重复日志。
- lockfile 和生成物。
- 完整 diff，除非 diff 本身就是这场会话的主题。

压缩示例：

```text
[Tool Result: Read apps/foo.ts, 820 lines]
```

压缩为：

```text
[File Read: apps/foo.ts, 820 lines, symbols: parseSession, syncProject, exportNote]
```

命令输出压缩为：

```text
[Command: npm test]
status: failed
key errors:
- CursorCollector should parse richText
- expected 3 sessions, got 0
```

长会话使用 map-reduce：

```text
chunk summaries -> session summary -> experience candidates
```

压缩结果按 `session_id + strategy + input_hash` 缓存。

## 9. Obsidian 结构

Obsidian 根目录允许用户配置。推荐默认值是 vault 内的 `LLM-iWiki/`，但不强制。

默认 vault 布局：

```text
LLM-iWiki/
  Projects/
    <project-display-name-or-slug>/
      Project Summary.md
      Experience Index.md
      Sessions/
        <date>-<source>-<title>.md
      Experiences/
        <experience-title>.md
  Problems/
    <problem-type>.md
  Solutions/
    <solution-type>.md
  Tech/
    <tech-name>.md
  Sources/
    <source-name>.md
```

项目目录名默认来自 `display_name`，没有自定义名称时使用项目 slug。底层身份仍然写入 frontmatter 中的 `aiwiki_project_id` 和 `canonical_repo_url`，不能只依赖目录名识别项目。

## 10. Markdown 更新协议

CLI 直接把 Markdown 写入 Obsidian vault。

每个生成笔记都包含：

- 带稳定 `aiwiki_id` 的 YAML frontmatter。
- AI 自动维护的 managed block。
- managed block 外部的用户可编辑区块。

示例：

```markdown
---
type: experience
aiwiki_id: exp_123
aiwiki_project_id: proj_123
project: 寻迹 XunJi
canonical_repo_url: github.com/CodeHourra/xunji
problem_type: 会话采集
solution_type: SQLite 解析
tech_stack:
  - Cursor
  - SQLite
source_sessions:
  - ses_123
updated_at: 2026-05-27
---

# Cursor SQLite 会话解析

<!-- aiwiki:managed:start -->
AI 自动维护内容写在这里。
<!-- aiwiki:managed:end -->

## 我的补充

用户可以在这里自由编辑。CLI 不允许覆盖这个区块。

## 关联

- [[Projects/github.com-CodeHourra-xunji/Project Summary]]
- [[Problems/会话采集]]
- [[Solutions/SQLite 解析]]
- [[Tech/Cursor]]
- [[Tech/SQLite]]
```

更新规则：

- 文件不存在时创建。
- 文件存在且 managed block hash 与 SQLite 记录一致时，替换 managed block。
- 文件存在但 managed block hash 与 SQLite 记录不一致时，标记冲突并默认跳过。
- 使用 `--force` 时，只覆盖 managed block。
- `experiences merge` 允许在人工确认后重写对应 experience 的 managed block。
- 永远不删除 managed marker 外部的用户区块。

`experiences merge <candidate-id> <experience-id>` 的正文融合需要人工确认。CLI 先生成临时 Markdown 预览文件，例如 `.llm-iwiki/tasks/merge-preview-<candidate-id>.md`，其中包含候选内容、已有正文、合并后的 managed block 预览和确认说明。用户或 AI 工具审阅并确认后，CLI 更新 SQLite 中的 `experiences.body_markdown`、合并 `source_sessions` / `evidence`，下一次 `obsidian export` 替换 managed block。用户手写区块始终保留。

Frontmatter 更新规则：

- 更新 `updated_at`、`source_sessions`、`aiwiki_id` 等机器字段。
- 保留用户新增的未知 frontmatter 字段。
- 不做不必要的整文件重写。

## 11. Skills 设计

Skills 随 CLI 分发，通过命令初始化到当前项目：

```bash
llm-iwiki skills init
```

`skills init` 默认写入：

```text
.agents/
  skills/
    aiwiki-after-session/
      SKILL.md
    aiwiki-before-debug/
      SKILL.md
    aiwiki-project-retrospective/
      SKILL.md

.llm-iwiki/
  tasks/
    summaries-task.md
    summaries.yaml
    experiences-task.md
    experiences.yaml
```

`.agents/skills/` 是项目本地的长期 skill 定义，供 Codex、Claude Code、Cursor 等工具读取或引用。`.llm-iwiki/tasks/` 是每次运行生成的临时 AI 交换文件。`skills init` 默认不覆盖已有文件；支持 `--force` 覆盖和 `--dry-run` 查看将写入的文件。

第一版只维护一份通用 skills，不分别为 Codex、Claude Code、Cursor 设计不同版本。各 AI 工具只需要能读取同一份 `SKILL.md`，并按其中命令调用 CLI。

同时支持生成工具专用接入片段：

```bash
llm-iwiki skills init --target codex
llm-iwiki skills init --target claude-code
llm-iwiki skills init --target cursor
```

默认行为仍然写入 `.agents/skills/`。指定 `--target` 时，CLI 在这几个已设计的 skills 中补充该工具的接入说明和调用提示：

- `aiwiki-after-session`
- `aiwiki-before-debug`
- `aiwiki-project-retrospective`

工具专用内容只描述“这个工具如何发现和触发这三个 skills”，不复制多份不同逻辑。后续如果某个工具需要 `AGENTS.md`、`CLAUDE.md` 或 Cursor rules 片段，也应只写入引用 `.agents/skills/` 的说明。

### aiwiki-after-session

用于一次 coding session 结束后：

```bash
llm-iwiki sync --project .
llm-iwiki summarize prepare changed --project . --out .llm-iwiki/tasks/summaries-task.md
```

Skill 随后要求当前 AI 工具阅读 `.llm-iwiki/tasks/summaries-task.md`，生成 `.llm-iwiki/tasks/summaries.yaml`，再运行：

```bash
llm-iwiki summarize apply --project . --file .llm-iwiki/tasks/summaries.yaml
llm-iwiki experiences prepare --project . --from changed-summaries --out .llm-iwiki/tasks/experiences-task.md
```

AI 再阅读 `.llm-iwiki/tasks/experiences-task.md`，生成 `.llm-iwiki/tasks/experiences.yaml`，再运行：

```bash
llm-iwiki experiences propose --project . --file .llm-iwiki/tasks/experiences.yaml
llm-iwiki experiences candidates --project .
llm-iwiki obsidian export --project .
```

MVP 默认不自动 accept 所有 candidates。高置信度自动接受可以留作后续参数，例如 `--auto-accept-high-confidence-new`，但不作为默认行为。

### aiwiki-before-debug

用于开始 debug 前：

```bash
llm-iwiki sync --project .
llm-iwiki search "<error or topic>" --project .
```

AI 应先阅读匹配的经验笔记，再开始提出修复方案。Skill 应要求 AI 明确说明“找到了哪些相关历史经验”或“没有找到相关经验”。

### aiwiki-project-retrospective

用于周期性项目复盘：

```bash
llm-iwiki sync --project .
llm-iwiki summarize prepare changed --project . --out .llm-iwiki/tasks/summaries-task.md
```

AI 生成 `.llm-iwiki/tasks/summaries.yaml` 后：

```bash
llm-iwiki summarize apply --project . --file .llm-iwiki/tasks/summaries.yaml
llm-iwiki experiences prepare --project . --from all-recent --since 30d --out .llm-iwiki/tasks/experiences-task.md
```

AI 生成 `.llm-iwiki/tasks/experiences.yaml` 后：

```bash
llm-iwiki experiences propose --project . --file .llm-iwiki/tasks/experiences.yaml
llm-iwiki obsidian export --project .
```

这里和 after-session 的区别是：它可以跨最近一段时间的更多 session 做项目级整合。

### aiwiki-experience-merge

用于处理相似经验候选：

```bash
llm-iwiki experiences candidates --project .
llm-iwiki experiences merge <candidate-id> <experience-id>
```

## 12. MVP 里程碑

### Milestone 1: CLI 骨架与状态库

- npm CLI package。
- 配置文件。
- SQLite migrations。
- 基于 git remote canonical URL 的项目解析器。
- 项目自定义显示名。
- `init`、`doctor`、`projects resolve`、`projects rename`。

### Milestone 2: Collectors

- Claude Code collector。
- Cursor collector。
- CodeBuddy collector。
- Codex collector 调研与初版实现。
- `sources detect`、`sync`、`sessions list`、`sessions show`。

### Milestone 3: 增量压缩

- Message hashing。
- Session content hashing。
- Compaction cache。
- 确定性的 tool/log/source 压缩。
- `sessions compact`。

### Milestone 4: AI 协作式总结与经验提取

- `summarize prepare` 生成项目级批量 Markdown 任务。
- `summarize apply` 解析并校验外部 AI 生成的 `summaries.yaml`，写入 session summaries。
- `experiences prepare` 生成经验提取上下文。
- `experiences propose` 解析并校验外部 AI 生成的 `experiences.yaml`，写入 experience candidates。
- 保守自动合并和半自动合并流程。

### Milestone 5: Obsidian 导出

- Markdown writer。
- Frontmatter merge。
- Managed block 更新协议。
- 项目目录自动迁移。
- 冲突检测。
- 项目、会话、经验、问题、方案、技术栈索引笔记。

### Milestone 6: Skills

- `llm-iwiki skills init`。
- 当前项目 `.agents/skills/` 初始化。
- `skills init --target codex|claude-code|cursor` 工具专用接入片段。
- `.llm-iwiki/tasks/` 任务交换目录。
- after-session 工作流。
- before-debug 搜索工作流。
- project-retrospective 工作流。

## 13. Codex 本地存储初探

当前本机观察到 Codex 相关数据主要在 `.codex-internal/` 下：

- `sessions/YYYY/MM/DD/rollout-*.jsonl`：按日期分层的会话 JSONL。
- `archived_sessions/rollout-*.jsonl`：归档会话。
- `session_index.jsonl`：线程索引，包含 `id`、`thread_name`、`updated_at`。
- `history.jsonl`：历史请求索引，包含 `session_id`、`ts`、`text`。
- `state_*.sqlite`：SQLite 状态库，`threads` 表包含 `id`、`rollout_path`、`cwd`、`title`、`git_origin_url`、`git_branch`、`model`、`preview` 等字段。

`rollout-*.jsonl` 每行结构为：

```json
{
  "timestamp": "string",
  "type": "string",
  "payload": {}
}
```

已观察到的 `type` 包括：

- `session_meta`
- `turn_context`
- `event_msg`
- `response_item`

实现 Codex collector 时，优先读取 `state_*.sqlite` 的 `threads` 表做索引和项目归一化，再按 `rollout_path` 读取 JSONL 解析消息。若没有 SQLite，则回退到扫描 `sessions/**/rollout-*.jsonl` 和 `session_index.jsonl`。

## 14. 已决策问题

1. npm package 与 binary 最终发布为 `llm-iwiki`。
2. MVP 不内置 LLM provider。总结由外部 AI 工具 + skills 完成，CLI 只提供上下文、schema、落库和导出能力。
3. Obsidian 根目录允许用户配置；默认建议为 vault 内 `LLM-iWiki/`。
4. Codex collector 先按 `.codex-internal/state_*.sqlite + rollout JSONL` 方向实现，路径保持可配置；非 internal 版本暂按相同目录结构处理。
5. MVP 只做确定性 `search`，把检索到的会话和经验内容交给 Claude、Cursor、Codex 等 AI 工具；暂不做内置 `query` 和 LLM synthesis。
6. Skills 第一版只维护一份通用版本，不为不同 AI 工具分别适配。
7. Search 第一版同时支持 SQLite FTS5 和 Obsidian Markdown ripgrep：SQLite 是主索引，Markdown 是补充索引。
8. AI 交换格式使用 YAML：`summaries.yaml` 和 `experiences.yaml`。`prepare` 输出 Markdown 任务说明，CLI 对 YAML 做严格 schema 校验后入库。
9. 总结和经验提取按 project 批量执行。底层仍按 session 保存证据摘要，经验层按 project 聚合多个 session 的可复用知识。
10. 支持自定义项目显示名。`project_id` 和 `canonical_repo_url` 保持稳定，`display_name` 只影响展示、任务说明和 Obsidian 导出。
11. MVP 使用 `llm-iwiki skills init` 在当前项目生成 `.agents/skills/`，任务交换文件放在 `.llm-iwiki/tasks/`。
12. 支持 `skills init --target codex|claude-code|cursor` 为 `aiwiki-after-session`、`aiwiki-before-debug`、`aiwiki-project-retrospective` 补充工具专用接入说明。默认仍写入 `.agents/skills/`，工具片段只引用这套通用 skills。
13. `search --index all` 使用 SQLite FTS5 作为主排序，Obsidian Markdown 作为补充信号；能映射到同一实体时合并去重，不能映射时作为 `markdown_only` 结果追加。
14. `projects rename` 后，Obsidian 项目目录自动迁移。迁移由 `obsidian export --project .` 触发，也可显式运行 `obsidian move-project <project-id>`。若目标目录有文件冲突，CLI 列出冲突文件，由用户选择覆盖或跳过，默认跳过。
15. `experiences merge` 允许通过临时 Markdown 预览人工确认后重写 experience 的 managed block；用户手写区块永远保留。

## 15. 开放问题

暂无。
