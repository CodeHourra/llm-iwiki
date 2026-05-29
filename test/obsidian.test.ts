import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { readConfig, setConfigValue } from '../src/config'
import { openDatabase, runMigrations, type LlmIwikiDatabase } from '../src/db'
import { exportProject } from '../src/obsidian'
import { getProject } from '../src/projects'

const tmpRoot = join(import.meta.dir, '.tmp-m5')
const vault = join(tmpRoot, 'vault')
const PROJECT = 'proj_test'
const SESSION = 'ses_test'

let db: LlmIwikiDatabase

beforeEach(() => {
  db = openDatabase(join(tmpRoot, 'llm-iwiki.db'))
  runMigrations(db)
  const now = '2026-01-01T00:00:00.000Z'
  db.query(`INSERT INTO projects (id, canonical_name, display_name, slug, canonical_repo_url, identity_source, created_at, updated_at)
    VALUES (?, 'github.com/demo/app', 'Demo App', 'demo-app', 'github.com/demo/app', 'git_remote', ?, ?)`).run(PROJECT, now, now)
  db.query(`INSERT INTO sessions (id, source_id, source_session_id, project_id, message_count, content_hash, status, first_seen_at, last_seen_at)
    VALUES (?, 'codex', 'src-1', ?, 2, 'h', 'new', ?, ?)`).run(SESSION, PROJECT, now, now)
  db.query(`INSERT INTO session_summaries (id, session_id, project_id, title, value, summary_markdown, created_at, updated_at)
    VALUES ('sum_1', ?, ?, '构建失败排查', 'high', '依赖版本不兼容导致构建失败。', ?, ?)`).run(SESSION, PROJECT, now, now)
  db.query(`INSERT INTO experience_candidates (id, project_id, proposed_title, proposed_slug, proposed_body_markdown, source_sessions_json, confidence, status, created_at)
    VALUES ('exp_1', ?, '锁定依赖版本', 'lock-deps', '## 结论\n锁版本。', ?, 'medium', 'proposed', ?)`).run(
    PROJECT,
    JSON.stringify([SESSION]),
    now,
  )
})

afterEach(() => {
  db.close()
  rmSync(tmpRoot, { recursive: true, force: true })
})

function project() {
  return getProject(db, PROJECT)
}

test('exportProject creates managed notes with frontmatter on first run', () => {
  const report = exportProject(db, vault, project(), { force: false })
  expect(report.created).toBe(3)
  expect(report.conflicts).toHaveLength(0)

  const summaryPath = join(vault, 'LLM-iWiki', 'Projects', 'Demo App', 'Sessions', '构建失败排查.md')
  const content = readFileSync(summaryPath, 'utf8')
  expect(content).toContain('aiwiki_id: sum_1')
  expect(content).toContain('<!-- aiwiki:managed:start -->')
  expect(content).toContain('依赖版本不兼容导致构建失败。')
  expect(content).toContain('## 我的补充')
})

test('re-export is idempotent and preserves user section', () => {
  exportProject(db, vault, project(), { force: false })
  const summaryPath = join(vault, 'LLM-iWiki', 'Projects', 'Demo App', 'Sessions', '构建失败排查.md')
  const edited = `${readFileSync(summaryPath, 'utf8')}我自己加的笔记内容\n`
  writeFileSync(summaryPath, edited)

  const report = exportProject(db, vault, project(), { force: false })
  expect(report.updated).toBe(3)
  expect(report.conflicts).toHaveLength(0)

  const after = readFileSync(summaryPath, 'utf8')
  expect(after).toContain('我自己加的笔记内容')
})

test('editing managed block triggers conflict and is skipped without force', () => {
  exportProject(db, vault, project(), { force: false })
  const summaryPath = join(vault, 'LLM-iWiki', 'Projects', 'Demo App', 'Sessions', '构建失败排查.md')
  const tampered = readFileSync(summaryPath, 'utf8').replace('依赖版本不兼容导致构建失败。', '我手动改了托管内容')
  writeFileSync(summaryPath, tampered)

  const report = exportProject(db, vault, project(), { force: false })
  expect(report.conflicts.length).toBe(1)
  expect(readFileSync(summaryPath, 'utf8')).toContain('我手动改了托管内容')

  const forced = exportProject(db, vault, project(), { force: true })
  expect(forced.forced).toBe(1)
  expect(readFileSync(summaryPath, 'utf8')).toContain('依赖版本不兼容导致构建失败。')
})

test('config set/show round-trips obsidian vault', () => {
  const configFile = join(tmpRoot, 'config.toml')
  writeFileSync(configFile, 'obsidian_vault = ""\n')
  const key = setConfigValue(configFile, 'obsidian.vault', '/Users/demo/vault')
  expect(key).toBe('obsidian_vault')
  expect(readConfig(configFile).obsidianVault).toBe('/Users/demo/vault')
})
