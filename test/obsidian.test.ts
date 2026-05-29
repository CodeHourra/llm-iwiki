import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { readConfig, setConfigValue } from '../src/config'
import { openDatabase, runMigrations, type LlmIwikiDatabase } from '../src/db'
import { acceptExperience, rejectExperience } from '../src/experiences'
import { checkVault, exportProject } from '../src/obsidian'
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
    VALUES ('cand_1', ?, '锁定依赖版本', 'lock-deps', '## 结论\n锁版本。', ?, 'medium', 'proposed', ?)`).run(
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
  acceptExperience(db, 'cand_1')
  const report = exportProject(db, vault, project(), { force: false })
  expect(report.created).toBe(3)
  expect(report.conflicts).toHaveLength(0)

  const summaryPath = join(vault, 'LLM-iWiki', 'Projects', 'Demo App', 'Sessions', '构建失败排查.md')
  const content = readFileSync(summaryPath, 'utf8')
  expect(content).toContain('aiwiki_id: sum_1')
  expect(content).toContain('<!-- aiwiki:managed:start -->')
  expect(content).toContain('依赖版本不兼容导致构建失败。')
  expect(content).toContain('## 我的补充')

  const expPath = join(vault, 'LLM-iWiki', 'Projects', 'Demo App', 'Experiences', 'lock-deps.md')
  const expContent = readFileSync(expPath, 'utf8')
  expect(expContent).toContain('status: accepted')
  expect(expContent).toContain(`- ${SESSION}`)
})

test('proposed experiences are not exported until accepted', () => {
  const report = exportProject(db, vault, project(), { force: false })
  expect(report.created).toBe(2)
})

test('re-export is idempotent and preserves user section', () => {
  acceptExperience(db, 'cand_1')
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

test('acceptExperience promotes candidate and links sessions', () => {
  const result = acceptExperience(db, 'cand_1')
  expect(result.slug).toBe('lock-deps')
  expect(result.linkedSessions).toBe(1)

  const exp = db.query<{ status: string; title: string }, [string]>(
    'SELECT status, title FROM experiences WHERE id = ?',
  ).get(result.experienceId)
  expect(exp?.status).toBe('accepted')

  const cand = db.query<{ status: string }, []>('SELECT status FROM experience_candidates').get()
  expect(cand?.status).toBe('accepted')

  const link = db.query<{ relation: string }, [string]>(
    'SELECT relation FROM session_experience_links WHERE experience_id = ?',
  ).get(result.experienceId)
  expect(link?.relation).toBe('source')
})

test('rejectExperience marks candidate rejected and keeps it unexported', () => {
  rejectExperience(db, 'cand_1')
  const cand = db.query<{ status: string }, []>('SELECT status FROM experience_candidates').get()
  expect(cand?.status).toBe('rejected')

  const report = exportProject(db, vault, project(), { force: false })
  expect(report.created).toBe(2)
})

test('checkVault reports drift when managed block is edited', () => {
  acceptExperience(db, 'cand_1')
  exportProject(db, vault, project(), { force: false })

  const clean = checkVault(db)
  expect(clean.total).toBe(3)
  expect(clean.clean).toBe(3)
  expect(clean.entries).toHaveLength(0)

  const summaryPath = join(vault, 'LLM-iWiki', 'Projects', 'Demo App', 'Sessions', '构建失败排查.md')
  writeFileSync(summaryPath, readFileSync(summaryPath, 'utf8').replace('依赖版本不兼容导致构建失败。', '被改动'))

  const drifted = checkVault(db)
  expect(drifted.clean).toBe(2)
  expect(drifted.entries).toHaveLength(1)
  expect(drifted.entries[0]?.status).toBe('drift')
})
