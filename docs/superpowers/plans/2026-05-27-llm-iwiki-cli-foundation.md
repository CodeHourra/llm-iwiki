# LLM-iWiki CLI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `llm-iwiki` CLI 的第一条可运行纵切：初始化状态库、解析项目身份、设置项目显示名、校验 AI YAML 交换文件、初始化项目本地 skills。

**Architecture:** 在根目录创建独立 `llm-iwiki` CLI 项目，使用 Bun + TypeScript 实现 CLI。SQLite 使用 `bun:sqlite`，配置和状态默认写入用户主目录 `~/.llm-iwiki/`，项目本地 AI 交换文件写入 `.llm-iwiki/tasks/`，skills 写入当前项目 `.agents/skills/`。

**Tech Stack:** TypeScript, Bun, `bun:sqlite`, `yaml`, Node built-ins, Bun test.

---

## Scope

本计划只实现 Milestone 1 的基础纵切和 A/B 讨论中已确认的结构化交换入口：

- `llm-iwiki init`
- `llm-iwiki doctor`
- `llm-iwiki projects resolve .`
- `llm-iwiki projects rename . "显示名"`
- `llm-iwiki summarize apply --project . --file summaries.yaml`
- `llm-iwiki experiences propose --project . --file experiences.yaml`
- `llm-iwiki skills init`
- `llm-iwiki skills init --target codex|claude-code|cursor`

Collectors、会话压缩、Obsidian writer、搜索排序和真实 `prepare` 任务生成留给后续计划。本计划会为它们建立 schema、表结构和命令骨架。

重要边界：`llm-iwiki` 是新项目，不是 XunJi monorepo 的一个 package。当前仓库里的 XunJi 代码只作为参考资料保留到 `refer/xunji/`，不能参与 `llm-iwiki` 的构建、测试或发布。

## File Structure

- Move: existing XunJi project files into `refer/xunji/`
  只保留 `docs/superpowers/` 作为当前 `llm-iwiki` 设计和计划文档。
- Create: `package.json`
  CLI package 定义，binary 名称固定为 `llm-iwiki`。
- Create: `tsconfig.json`
  TypeScript 编译配置。
- Create: `src/index.ts`
  CLI 入口，只负责解析 `argv` 并分发命令。
- Create: `src/cli.ts`
  命令路由、错误格式化、帮助文本。
- Create: `src/paths.ts`
  全局配置目录、数据库路径、项目本地 `.llm-iwiki/tasks` 路径。
- Create: `src/db.ts`
  SQLite 打开、迁移、事务 helper。
- Create: `src/projects.ts`
  project resolver、canonical URL 归一化、rename。
- Create: `src/ai-yaml.ts`
  `summaries.yaml` / `experiences.yaml` 解析和校验。
- Create: `src/skills.ts`
  `.agents/skills` 初始化和 target 接入说明。
- Create: `src/types.ts`
  CLI 内部类型。
- Create: `test/*.test.ts`
  单元测试。
- Modify: `.gitignore`
  忽略 `.llm-iwiki/` 运行期任务文件。

## Task 0: Separate XunJi Reference Material

**Files:**
- Move: `apps/` -> `refer/xunji/apps/`
- Move: `packages/` -> `refer/xunji/packages/`
- Move: `scripts/` -> `refer/xunji/scripts/`
- Move: `design/` -> `refer/xunji/design/`
- Move: `README.md` -> `refer/xunji/README.md`
- Move: `CHANGELOG.md` -> `refer/xunji/CHANGELOG.md`
- Move: `Makefile` -> `refer/xunji/Makefile`
- Move: `bun.lock` -> `refer/xunji/bun.lock`
- Move: existing root `package.json` -> `refer/xunji/package.json`
- Move: `.claude/` -> `refer/xunji/.claude/`
- Move: `.cursor/` -> `refer/xunji/.cursor/`
- Move: `.github/` -> `refer/xunji/.github/`
- Move: `skills-lock.json` -> `refer/xunji/skills-lock.json`
- Move: XunJi docs under `docs/` except `docs/superpowers/` -> `refer/xunji/docs/`
- Create: `README.md`
- Modify: `.gitignore`
- Remove: XunJi `origin` remote from git config

- [ ] **Step 1: Move XunJi code and docs into reference directory**

Run:

```bash
mkdir -p refer/xunji
git mv apps refer/xunji/apps
git mv packages refer/xunji/packages
git mv scripts refer/xunji/scripts
git mv design refer/xunji/design
git mv README.md refer/xunji/README.md
git mv CHANGELOG.md refer/xunji/CHANGELOG.md
git mv Makefile refer/xunji/Makefile
git mv bun.lock refer/xunji/bun.lock
git mv package.json refer/xunji/package.json
git mv .claude refer/xunji/.claude
git mv .cursor refer/xunji/.cursor
git mv .github refer/xunji/.github
git mv skills-lock.json refer/xunji/skills-lock.json
```

- [ ] **Step 2: Move XunJi docs while keeping Superpowers docs at root**

Run:

```bash
mkdir -p refer/xunji/docs
find docs -mindepth 1 -maxdepth 1 ! -name superpowers -exec git mv {} refer/xunji/docs/ \;
```

Expected root `docs/` contains only `docs/superpowers/`.

- [ ] **Step 3: Update ignore rules for new project runtime files**

Ensure `.gitignore` contains:

```gitignore
# Agent and local worktree state
.agents/
.worktrees/

# LLM-iWiki runtime task exchange
.llm-iwiki/

# Build output
dist/
node_modules/
```

Keep existing useful OS/editor ignores such as `.DS_Store`, `.idea/`, `.vscode/`, and `*.swp`.

- [ ] **Step 4: Add llm-iwiki root README and detach old remote**

Create root `README.md`:

```markdown
# llm-iwiki

面向 AI Agent 的本地知识库 CLI。

`llm-iwiki` 会采集 Claude Code、Cursor、Codex、CodeBuddy 等 AI 编程工具的本地会话记录，按项目归一化到 SQLite，再通过 AI 工具生成结构化 YAML 摘要和经验候选，最终导出到 Obsidian。

## 当前状态

项目处于 CLI foundation 阶段。XunJi 桌面应用代码仅作为参考资料保存在 `refer/xunji/`，不参与本项目的构建、测试或发布。
```

Remove the stale XunJi remote:

```bash
git remote remove origin
```

Expected `git remote -v` prints nothing until a new `llm-iwiki` remote is configured.

- [ ] **Step 5: Verify separation**

Run:

```bash
test -d refer/xunji/apps
test -d refer/xunji/packages
test -d refer/xunji/.github
test -d refer/xunji/.cursor
test -f refer/xunji/skills-lock.json
test -d docs/superpowers
test ! -d packages
test ! -d apps
test ! -d .github
test ! -d .cursor
test -f README.md
test -z "$(git remote)"
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add .gitignore README.md docs refer
git commit -m "chore: move xunji reference under refer"
```

## Task 1: Scaffold CLI Package

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `src/cli.ts`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add package manifest**

Create `package.json`:

```json
{
  "name": "llm-iwiki",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "llm-iwiki": "./src/index.ts"
  },
  "scripts": {
    "dev": "bun run src/index.ts",
    "test": "bun test --pass-with-no-tests",
    "typecheck": "tsc --noEmit",
    "build": "bun build src/index.ts --compile --outfile dist/llm-iwiki"
  },
  "dependencies": {
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "@types/bun": "^1.3.11",
    "typescript": "~5.7"
  }
}
```

- [ ] **Step 2: Add TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["bun-types"],
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Add CLI entry and router skeleton**

Create `src/index.ts`:

```ts
#!/usr/bin/env bun
import { runCli } from './cli'

const exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: console.log,
  stderr: console.error,
})

process.exit(exitCode)
```

Create `src/cli.ts`:

```ts
export interface CliRuntime {
  cwd: string
  stdout: (message: string) => void
  stderr: (message: string) => void
}

const HELP = `llm-iwiki

Usage:
  llm-iwiki init
  llm-iwiki doctor
  llm-iwiki projects resolve <path>
  llm-iwiki projects rename <path-or-project-id> <display-name>
  llm-iwiki summarize apply --project <path> --file <summaries.yaml>
  llm-iwiki experiences propose --project <path> --file <experiences.yaml>
  llm-iwiki skills init [--target codex|claude-code|cursor] [--force] [--dry-run]
`

export async function runCli(args: string[], runtime: CliRuntime): Promise<number> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    runtime.stdout(HELP)
    return 0
  }

  runtime.stderr(`Unknown command: ${args.join(' ')}`)
  runtime.stderr(HELP)
  return 1
}
```

- [ ] **Step 4: Add root scripts and ignore runtime tasks**

Create root `package.json` as the `llm-iwiki` package manifest. It replaces the moved XunJi monorepo manifest:

```json
{
  "name": "llm-iwiki",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "llm-iwiki": "./src/index.ts"
  },
  "scripts": {
    "dev": "bun run src/index.ts",
    "test": "bun test --pass-with-no-tests",
    "typecheck": "tsc --noEmit",
    "build": "bun build src/index.ts --compile --outfile dist/llm-iwiki"
  },
  "dependencies": {
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "@types/bun": "^1.3.11",
    "typescript": "~5.7"
  }
}
```

Append to `.gitignore`:

```gitignore
# LLM-iWiki runtime task exchange
.llm-iwiki/
```

- [ ] **Step 5: Verify skeleton**

Run:

```bash
bun test
bun run src/index.ts --help
```

Expected:

```text
0 pass
llm-iwiki
Usage:
```

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json src .gitignore
git commit -m "feat(llm-iwiki): scaffold cli package"
```

## Task 2: Add Config Paths And SQLite Migrations

**Files:**
- Create: `src/paths.ts`
- Create: `src/db.ts`
- Create: `test/db.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write database migration tests**

Create `test/db.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase, runMigrations } from '../src/db'

const tmpRoot = join(import.meta.dir, '.tmp-db')

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

test('runMigrations creates core tables', () => {
  const db = openDatabase(join(tmpRoot, 'llm-iwiki.db'))
  runMigrations(db)

  const rows = db
    .query<{ name: string }, []>("select name from sqlite_master where type = 'table' order by name")
    .all()
    .map((row) => row.name)

  expect(rows).toContain('projects')
  expect(rows).toContain('project_checkouts')
  expect(rows).toContain('session_summaries')
  expect(rows).toContain('experience_candidates')
  expect(rows).toContain('obsidian_notes')
})
```

- [ ] **Step 2: Verify the test fails**

Run:

```bash
bun test test/db.test.ts
```

Expected: FAIL with module not found for `../src/db`.

- [ ] **Step 3: Implement paths**

Create `src/paths.ts`:

```ts
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface AppPaths {
  homeDir: string
  configDir: string
  configFile: string
  databaseFile: string
}

export function getAppPaths(homeDir = homedir()): AppPaths {
  const configDir = join(homeDir, '.llm-iwiki')
  return {
    homeDir,
    configDir,
    configFile: join(configDir, 'config.toml'),
    databaseFile: join(configDir, 'llm-iwiki.db'),
  }
}

export function getProjectTaskDir(cwd: string): string {
  return resolve(cwd, '.llm-iwiki', 'tasks')
}
```

- [ ] **Step 4: Implement SQLite migrations**

Create `src/db.ts`:

```ts
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type LlmIwikiDatabase = Database

export function openDatabase(databaseFile: string): LlmIwikiDatabase {
  mkdirSync(dirname(databaseFile), { recursive: true })
  return new Database(databaseFile)
}

export function runMigrations(db: LlmIwikiDatabase): void {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      display_name TEXT,
      slug TEXT NOT NULL,
      canonical_repo_url TEXT,
      provider TEXT,
      identity_source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_checkouts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      local_path TEXT NOT NULL,
      git_root TEXT,
      remote_url TEXT,
      canonical_remote_url TEXT,
      current_branch TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_aliases (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      alias_type TEXT NOT NULL,
      alias_value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_summaries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      value TEXT NOT NULL,
      summary_markdown TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS experience_candidates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      proposed_title TEXT NOT NULL,
      proposed_slug TEXT NOT NULL,
      proposed_body_markdown TEXT NOT NULL,
      source_sessions_json TEXT NOT NULL,
      confidence TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS obsidian_notes (
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
    );
  `)
}
```

- [ ] **Step 5: Wire `init` and `doctor`**

Modify `src/cli.ts` so the router starts with:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { openDatabase, runMigrations } from './db'
import { getAppPaths } from './paths'
```

Replace the body of `runCli` with:

```ts
export async function runCli(args: string[], runtime: CliRuntime): Promise<number> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    runtime.stdout(HELP)
    return 0
  }

  if (args[0] === 'init') {
    const paths = getAppPaths()
    mkdirSync(paths.configDir, { recursive: true })
    writeFileSync(paths.configFile, 'obsidian_vault = ""\n', { flag: 'wx' })
    const db = openDatabase(paths.databaseFile)
    runMigrations(db)
    runtime.stdout(`Initialized llm-iwiki at ${paths.configDir}`)
    return 0
  }

  if (args[0] === 'doctor') {
    const paths = getAppPaths()
    const db = openDatabase(paths.databaseFile)
    runMigrations(db)
    runtime.stdout(`config: ${paths.configFile}`)
    runtime.stdout(`database: ${paths.databaseFile}`)
    runtime.stdout('status: ok')
    return 0
  }

  runtime.stderr(`Unknown command: ${args.join(' ')}`)
  runtime.stderr(HELP)
  return 1
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
bun test test/db.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src test package.json tsconfig.json
git commit -m "feat(llm-iwiki): add sqlite state store"
```

## Task 3: Implement Project Resolve And Rename

**Files:**
- Create: `src/projects.ts`
- Create: `test/projects.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write resolver tests**

Create `test/projects.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { canonicalizeRemoteUrl, slugifyProjectName } from '../src/projects'

test('canonicalizeRemoteUrl normalizes git remotes', () => {
  expect(canonicalizeRemoteUrl('git@github.com:CodeHourra/xunji.git')).toBe('github.com/CodeHourra/xunji')
  expect(canonicalizeRemoteUrl('https://github.com/CodeHourra/xunji.git')).toBe('github.com/CodeHourra/xunji')
})

test('slugifyProjectName keeps readable ascii names stable', () => {
  expect(slugifyProjectName('github.com/CodeHourra/xunji')).toBe('github-com-codehourra-xunji')
  expect(slugifyProjectName('寻迹 XunJi')).toBe('xunji')
})
```

- [ ] **Step 2: Verify resolver tests fail**

Run:

```bash
bun test test/projects.test.ts
```

Expected: FAIL with module not found for `../src/projects`.

- [ ] **Step 3: Implement project helpers**

Create `src/projects.ts`:

```ts
import { spawnSync } from 'node:child_process'
import { basename, resolve } from 'node:path'
import type { LlmIwikiDatabase } from './db'

export interface ProjectRecord {
  id: string
  canonicalName: string
  displayName: string | null
  slug: string
  canonicalRepoUrl: string | null
  identitySource: string
}

export function canonicalizeRemoteUrl(remoteUrl: string): string {
  return remoteUrl
    .trim()
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
}

export function slugifyProjectName(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s._/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return ascii || 'project'
}

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) return null
  return result.stdout.trim() || null
}

export function resolveProject(db: LlmIwikiDatabase, checkoutPath: string): ProjectRecord {
  const localPath = resolve(checkoutPath)
  const gitRoot = git(localPath, ['rev-parse', '--show-toplevel'])
  const remote = git(localPath, ['config', '--get', 'remote.origin.url'])
  const canonicalRepoUrl = remote ? canonicalizeRemoteUrl(remote) : null
  const canonicalName = canonicalRepoUrl ?? basename(gitRoot ?? localPath)
  const slug = slugifyProjectName(canonicalName)
  const id = `proj_${Bun.hash(canonicalRepoUrl ?? gitRoot ?? localPath).toString(16)}`
  const now = new Date().toISOString()

  db.query(`
    INSERT INTO projects (id, canonical_name, display_name, slug, canonical_repo_url, provider, identity_source, created_at, updated_at)
    VALUES ($id, $canonicalName, NULL, $slug, $canonicalRepoUrl, NULL, $identitySource, $now, $now)
    ON CONFLICT(id) DO UPDATE SET
      canonical_name = excluded.canonical_name,
      slug = excluded.slug,
      canonical_repo_url = excluded.canonical_repo_url,
      updated_at = excluded.updated_at
  `).run({
    $id: id,
    $canonicalName: canonicalName,
    $slug: slug,
    $canonicalRepoUrl: canonicalRepoUrl,
    $identitySource: canonicalRepoUrl ? 'git_remote' : 'path',
    $now: now,
  })

  return getProject(db, id)
}

export function renameProject(db: LlmIwikiDatabase, projectId: string, displayName: string): ProjectRecord {
  const now = new Date().toISOString()
  db.query('UPDATE projects SET display_name = $displayName, updated_at = $now WHERE id = $projectId').run({
    $displayName: displayName,
    $projectId: projectId,
    $now: now,
  })
  return getProject(db, projectId)
}

export function getProject(db: LlmIwikiDatabase, projectId: string): ProjectRecord {
  const row = db.query<{
    id: string
    canonical_name: string
    display_name: string | null
    slug: string
    canonical_repo_url: string | null
    identity_source: string
  }, [string]>('SELECT * FROM projects WHERE id = ?').get(projectId)

  if (!row) throw new Error(`Project not found: ${projectId}`)

  return {
    id: row.id,
    canonicalName: row.canonical_name,
    displayName: row.display_name,
    slug: row.slug,
    canonicalRepoUrl: row.canonical_repo_url,
    identitySource: row.identity_source,
  }
}
```

- [ ] **Step 4: Wire project commands**

Modify `src/cli.ts` imports:

```ts
import { renameProject, resolveProject } from './projects'
```

Add before unknown command:

```ts
  if (args[0] === 'projects' && args[1] === 'resolve') {
    const targetPath = args[2] ?? runtime.cwd
    const paths = getAppPaths()
    const db = openDatabase(paths.databaseFile)
    runMigrations(db)
    const project = resolveProject(db, targetPath === '.' ? runtime.cwd : targetPath)
    runtime.stdout(JSON.stringify(project, null, 2))
    return 0
  }

  if (args[0] === 'projects' && args[1] === 'rename') {
    const target = args[2]
    const displayName = args[3]
    if (!target || !displayName) {
      runtime.stderr('Usage: llm-iwiki projects rename <path-or-project-id> <display-name>')
      return 1
    }
    const paths = getAppPaths()
    const db = openDatabase(paths.databaseFile)
    runMigrations(db)
    const project = target.startsWith('proj_')
      ? renameProject(db, target, displayName)
      : renameProject(db, resolveProject(db, target === '.' ? runtime.cwd : target).id, displayName)
    runtime.stdout(JSON.stringify(project, null, 2))
    return 0
  }
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test test/projects.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src test package.json tsconfig.json
git commit -m "feat(llm-iwiki): resolve and rename projects"
```

## Task 4: Validate YAML Exchange Files

**Files:**
- Create: `src/ai-yaml.ts`
- Create: `test/ai-yaml.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write YAML validation tests**

Create `test/ai-yaml.test.ts`:

```ts
import { expect, test } from 'bun:test'
import { parseExperiencesYaml, parseSummariesYaml } from '../src/ai-yaml'

test('parseSummariesYaml accepts required fields', () => {
  const result = parseSummariesYaml(`
project_id: proj_123
summaries:
  - session_id: ses_1
    title: 解析 Cursor 会话
    value: high
    summary_markdown: |
      本次会话定位了 Cursor SQLite 解析问题。
`)

  expect(result.projectId).toBe('proj_123')
  expect(result.summaries[0].value).toBe('high')
})

test('parseSummariesYaml rejects invalid value', () => {
  expect(() => parseSummariesYaml(`
project_id: proj_123
summaries:
  - session_id: ses_1
    title: bad
    value: important
    summary_markdown: bad
`)).toThrow('Invalid summary value')
})

test('parseExperiencesYaml accepts required fields', () => {
  const result = parseExperiencesYaml(`
project_id: proj_123
experiences:
  - title: Cursor SQLite + Lexical
    summary: |
      Cursor 正文在 Lexical 中。
    body_markdown: |
      ## 背景
      需要递归解析。
    source_sessions:
      - ses_1
`)

  expect(result.experiences[0].sourceSessions).toEqual(['ses_1'])
})
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
bun test test/ai-yaml.test.ts
```

Expected: FAIL with module not found for `../src/ai-yaml`.

- [ ] **Step 3: Implement YAML parsers**

Create `src/types.ts`:

```ts
export type SummaryValue = 'none' | 'low' | 'medium' | 'high'
export type Confidence = 'low' | 'medium' | 'high'

export interface ParsedSummariesYaml {
  projectId: string
  summaries: Array<{
    sessionId: string
    title: string
    value: SummaryValue
    summaryMarkdown: string
    metadata: Record<string, unknown>
  }>
}

export interface ParsedExperiencesYaml {
  projectId: string
  experiences: Array<{
    title: string
    slug: string | null
    summary: string
    bodyMarkdown: string
    sourceSessions: string[]
    confidence: Confidence | null
    metadata: Record<string, unknown>
  }>
}
```

Create `src/ai-yaml.ts`:

```ts
import { parse } from 'yaml'
import type { Confidence, ParsedExperiencesYaml, ParsedSummariesYaml, SummaryValue } from './types'

const SUMMARY_VALUES = new Set<SummaryValue>(['none', 'low', 'medium', 'high'])
const CONFIDENCE_VALUES = new Set<Confidence>(['low', 'medium', 'high'])

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required string: ${key}`)
  }
  return value
}

export function parseSummariesYaml(source: string): ParsedSummariesYaml {
  const root = asRecord(parse(source), 'summaries.yaml')
  const projectId = requiredString(root, 'project_id')
  if (!Array.isArray(root.summaries)) throw new Error('summaries must be an array')

  return {
    projectId,
    summaries: root.summaries.map((item, index) => {
      const record = asRecord(item, `summaries[${index}]`)
      const value = requiredString(record, 'value')
      if (!SUMMARY_VALUES.has(value as SummaryValue)) throw new Error(`Invalid summary value: ${value}`)
      return {
        sessionId: requiredString(record, 'session_id'),
        title: requiredString(record, 'title'),
        value: value as SummaryValue,
        summaryMarkdown: requiredString(record, 'summary_markdown'),
        metadata: record,
      }
    }),
  }
}

export function parseExperiencesYaml(source: string): ParsedExperiencesYaml {
  const root = asRecord(parse(source), 'experiences.yaml')
  const projectId = requiredString(root, 'project_id')
  if (!Array.isArray(root.experiences)) throw new Error('experiences must be an array')

  return {
    projectId,
    experiences: root.experiences.map((item, index) => {
      const record = asRecord(item, `experiences[${index}]`)
      const sourceSessions = record.source_sessions
      if (!Array.isArray(sourceSessions) || sourceSessions.some((value) => typeof value !== 'string')) {
        throw new Error(`experiences[${index}].source_sessions must be a string array`)
      }
      const confidence = typeof record.confidence === 'string' ? record.confidence : null
      if (confidence && !CONFIDENCE_VALUES.has(confidence as Confidence)) {
        throw new Error(`Invalid confidence: ${confidence}`)
      }
      return {
        title: requiredString(record, 'title'),
        slug: typeof record.slug === 'string' ? record.slug : null,
        summary: requiredString(record, 'summary'),
        bodyMarkdown: requiredString(record, 'body_markdown'),
        sourceSessions,
        confidence: confidence as Confidence | null,
        metadata: record,
      }
    }),
  }
}
```

- [ ] **Step 4: Wire `summarize apply` and `experiences propose` as validation-only commands**

Modify `src/cli.ts` imports:

```ts
import { readFileSync } from 'node:fs'
import { parseExperiencesYaml, parseSummariesYaml } from './ai-yaml'
```

Add a small flag helper:

```ts
function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index === -1) return null
  return args[index + 1] ?? null
}
```

Add before unknown command:

```ts
  if (args[0] === 'summarize' && args[1] === 'apply') {
    const file = readFlag(args, '--file')
    if (!file) {
      runtime.stderr('Usage: llm-iwiki summarize apply --project <path> --file <summaries.yaml>')
      return 1
    }
    const parsed = parseSummariesYaml(readFileSync(file, 'utf8'))
    runtime.stdout(`validated summaries: ${parsed.summaries.length}`)
    return 0
  }

  if (args[0] === 'experiences' && args[1] === 'propose') {
    const file = readFlag(args, '--file')
    if (!file) {
      runtime.stderr('Usage: llm-iwiki experiences propose --project <path> --file <experiences.yaml>')
      return 1
    }
    const parsed = parseExperiencesYaml(readFileSync(file, 'utf8'))
    runtime.stdout(`validated experiences: ${parsed.experiences.length}`)
    return 0
  }
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test test/ai-yaml.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src test package.json tsconfig.json
git commit -m "feat(llm-iwiki): validate ai yaml exchange files"
```

## Task 5: Implement Skills Init

**Files:**
- Create: `src/skills.ts`
- Create: `test/skills.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write skills init tests**

Create `test/skills.test.ts`:

```ts
import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { initSkills } from '../src/skills'

const tmpRoot = join(import.meta.dir, '.tmp-skills')

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

test('initSkills writes the three project skills', () => {
  const result = initSkills({ cwd: tmpRoot, force: false, dryRun: false, target: null })

  expect(result.written.length).toBe(3)
  expect(existsSync(join(tmpRoot, '.agents/skills/aiwiki-after-session/SKILL.md'))).toBe(true)
  expect(readFileSync(join(tmpRoot, '.agents/skills/aiwiki-before-debug/SKILL.md'), 'utf8')).toContain('llm-iwiki search')
})

test('initSkills with target adds target guidance', () => {
  initSkills({ cwd: tmpRoot, force: false, dryRun: false, target: 'codex' })
  const content = readFileSync(join(tmpRoot, '.agents/skills/aiwiki-after-session/SKILL.md'), 'utf8')
  expect(content).toContain('Codex')
})
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
bun test test/skills.test.ts
```

Expected: FAIL with module not found for `../src/skills`.

- [ ] **Step 3: Implement skills templates**

Create `src/skills.ts`:

```ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type SkillTarget = 'codex' | 'claude-code' | 'cursor'

export interface InitSkillsOptions {
  cwd: string
  target: SkillTarget | null
  force: boolean
  dryRun: boolean
}

export interface InitSkillsResult {
  written: string[]
  skipped: string[]
}

const TARGET_NOTES: Record<SkillTarget, string> = {
  codex: 'Codex: 引用当前项目 .agents/skills 中的 SKILL.md，并在会话结束、debug 前或复盘时调用对应 skill。',
  'claude-code': 'Claude Code: 将本 skill 作为项目技能读取，按命令块调用 llm-iwiki。',
  cursor: 'Cursor: 在项目 rules 中引用 .agents/skills，并按本 skill 的命令顺序执行。',
}

const SKILLS: Array<{ name: string; description: string; body: string }> = [
  {
    name: 'aiwiki-after-session',
    description: '一次 coding session 结束后，同步当前项目会话并生成 summaries.yaml / experiences.yaml。',
    body: `# aiwiki-after-session

用于一次 coding session 结束后沉淀项目经验。

1. 运行 \`llm-iwiki sync --project .\`
2. 运行 \`llm-iwiki summarize prepare changed --project . --out .llm-iwiki/tasks/summaries-task.md\`
3. 阅读 \`.llm-iwiki/tasks/summaries-task.md\`，生成 \`.llm-iwiki/tasks/summaries.yaml\`
4. 运行 \`llm-iwiki summarize apply --project . --file .llm-iwiki/tasks/summaries.yaml\`
5. 运行 \`llm-iwiki experiences prepare --project . --from changed-summaries --out .llm-iwiki/tasks/experiences-task.md\`
6. 阅读 \`.llm-iwiki/tasks/experiences-task.md\`，生成 \`.llm-iwiki/tasks/experiences.yaml\`
7. 运行 \`llm-iwiki experiences propose --project . --file .llm-iwiki/tasks/experiences.yaml\`
8. 运行 \`llm-iwiki obsidian export --project .\`
`,
  },
  {
    name: 'aiwiki-before-debug',
    description: '开始 debug 前检索当前项目历史经验。',
    body: `# aiwiki-before-debug

用于开始 debug 前检索历史经验。

1. 运行 \`llm-iwiki sync --project .\`
2. 使用错误信息或主题运行 \`llm-iwiki search "<error or topic>" --project . --index all\`
3. 在修复前说明找到了哪些相关历史经验；如果没有命中，也明确说明没有找到相关经验。
`,
  },
  {
    name: 'aiwiki-project-retrospective',
    description: '周期性复盘当前项目最近会话并提炼经验候选。',
    body: `# aiwiki-project-retrospective

用于周期性项目复盘。

1. 运行 \`llm-iwiki sync --project .\`
2. 运行 \`llm-iwiki summarize prepare changed --project . --out .llm-iwiki/tasks/summaries-task.md\`
3. 生成并应用 \`.llm-iwiki/tasks/summaries.yaml\`
4. 运行 \`llm-iwiki experiences prepare --project . --from all-recent --since 30d --out .llm-iwiki/tasks/experiences-task.md\`
5. 生成并提交 \`.llm-iwiki/tasks/experiences.yaml\`
6. 运行 \`llm-iwiki obsidian export --project .\`
`,
  },
]

export function initSkills(options: InitSkillsOptions): InitSkillsResult {
  const result: InitSkillsResult = { written: [], skipped: [] }

  for (const skill of SKILLS) {
    const dir = join(options.cwd, '.agents', 'skills', skill.name)
    const file = join(dir, 'SKILL.md')
    const targetNote = options.target ? `\n## Tool Target\n\n${TARGET_NOTES[options.target]}\n` : ''
    const content = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body}${targetNote}`

    if (existsSync(file) && !options.force) {
      result.skipped.push(file)
      continue
    }
    if (!options.dryRun) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, content)
    }
    result.written.push(file)
  }

  return result
}
```

- [ ] **Step 4: Wire `skills init` command**

Modify `src/cli.ts` imports:

```ts
import { initSkills, type SkillTarget } from './skills'
```

Add before unknown command:

```ts
  if (args[0] === 'skills' && args[1] === 'init') {
    const target = readFlag(args, '--target') as SkillTarget | null
    if (target && !['codex', 'claude-code', 'cursor'].includes(target)) {
      runtime.stderr('Invalid --target. Use codex, claude-code, or cursor.')
      return 1
    }
    const result = initSkills({
      cwd: runtime.cwd,
      target,
      force: args.includes('--force'),
      dryRun: args.includes('--dry-run'),
    })
    runtime.stdout(`skills written: ${result.written.length}`)
    runtime.stdout(`skills skipped: ${result.skipped.length}`)
    return 0
  }
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test test/skills.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src test package.json tsconfig.json
git commit -m "feat(llm-iwiki): initialize project skills"
```

## Task 6: Foundation Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-llm-iwiki-cli-design.md` only if implementation discoveries require a spec correction.

- [ ] **Step 1: Run full package tests**

Run:

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 3: Smoke test CLI help**

Run:

```bash
bun run src/index.ts --help
```

Expected output includes:

```text
llm-iwiki
Usage:
```

- [ ] **Step 4: Smoke test skills dry run**

Run:

```bash
bun run src/index.ts skills init --dry-run
```

Expected output includes:

```text
skills written: 3
skills skipped: 0
```

- [ ] **Step 5: Commit final cleanup**

If no files changed after verification, skip this commit. If small fixes were needed:

```bash
git add src test package.json tsconfig.json docs/superpowers/specs/2026-05-27-llm-iwiki-cli-design.md
git commit -m "chore(llm-iwiki): verify cli foundation"
```

## Self-Review

- Spec coverage: This plan covers CLI naming, init, SQLite foundation, project rename/display name, YAML exchange validation, and `.agents/skills` initialization. It does not implement collectors, search ranking, Obsidian export, project directory migration, or merge preview; those are separate later milestones.
- Placeholder scan: No placeholder tasks remain. Later-milestone work is explicitly out of scope rather than left unspecified inside tasks.
- Type consistency: `ProjectRecord`, `ParsedSummariesYaml`, `ParsedExperiencesYaml`, `SummaryValue`, and `Confidence` are introduced before use and reused consistently.

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-05-27-llm-iwiki-cli-foundation.md`. Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
