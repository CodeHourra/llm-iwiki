import { afterEach, beforeEach, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { openDatabase, runMigrations, type LlmIwikiDatabase } from '../src/db'
import { parseExperiencesYaml, parseSummariesYaml } from '../src/ai-yaml'
import { prepareExperiencesTask, proposeExperiences } from '../src/experiences'
import { applySummaries, prepareSummariesTask } from '../src/summarize'

const tmpRoot = join(import.meta.dir, '.tmp-m4')
const PROJECT = 'proj_test'
const SESSION = 'ses_test'

let db: LlmIwikiDatabase

beforeEach(() => {
  db = openDatabase(join(tmpRoot, 'llm-iwiki.db'))
  runMigrations(db)
  const now = '2026-01-01T00:00:00.000Z'
  db.query(`INSERT INTO projects (id, canonical_name, slug, identity_source, created_at, updated_at)
    VALUES (?, 'demo', 'demo', 'path', ?, ?)`).run(PROJECT, now, now)
  db.query(`INSERT INTO sessions (id, source_id, source_session_id, project_id, message_count, content_hash, status, first_seen_at, last_seen_at)
    VALUES (?, 'codex', 'src-1', ?, 2, 'h', 'new', ?, ?)`).run(SESSION, PROJECT, now, now)
  db.query(`INSERT INTO messages (id, session_id, role, content, seq_order, content_hash)
    VALUES ('m1', ?, 'user', '修复构建失败', 0, 'h1')`).run(SESSION)
  db.query(`INSERT INTO messages (id, session_id, role, content, seq_order, content_hash)
    VALUES ('m2', ?, 'assistant', '已修复，是依赖版本问题', 1, 'h2')`).run(SESSION)
})

afterEach(() => {
  db.close()
  rmSync(tmpRoot, { recursive: true, force: true })
})

test('prepareSummariesTask includes session id and compacted transcript', () => {
  const result = prepareSummariesTask(db, PROJECT, 'changed')
  expect(result.sessionCount).toBe(1)
  expect(result.markdown).toContain(SESSION)
  expect(result.markdown).toContain('修复构建失败')
  expect(result.markdown).toContain('project_id: proj_test')
})

test('applySummaries writes session_summaries and skips unknown sessions', () => {
  const parsed = parseSummariesYaml(`
project_id: ${PROJECT}
summaries:
  - session_id: ${SESSION}
    title: 构建失败排查
    value: high
    summary_markdown: |
      依赖版本不兼容导致构建失败。
  - session_id: ses_missing
    title: 不存在
    value: low
    summary_markdown: 无
`)
  const result = applySummaries(db, parsed)
  expect(result.written).toBe(1)
  expect(result.skipped).toEqual(['ses_missing'])

  const row = db.query<{ value: string; title: string }, [string]>(
    'SELECT value, title FROM session_summaries WHERE session_id = ?',
  ).get(SESSION)
  expect(row?.value).toBe('high')
})

test('experiences prepare picks medium/high summaries and propose stores candidates', () => {
  applySummaries(
    db,
    parseSummariesYaml(`
project_id: ${PROJECT}
summaries:
  - session_id: ${SESSION}
    title: 构建失败排查
    value: high
    summary_markdown: 依赖版本问题
`),
  )

  const prepared = prepareExperiencesTask(db, PROJECT, 'changed-summaries')
  expect(prepared.summaryCount).toBe(1)
  expect(prepared.markdown).toContain('构建失败排查')

  const proposed = proposeExperiences(
    db,
    parseExperiencesYaml(`
project_id: ${PROJECT}
experiences:
  - title: 锁定依赖版本避免构建漂移
    slug: lock-dependency-versions
    summary: 固定依赖版本
    body_markdown: |
      ## 结论
      锁版本。
    source_sessions:
      - ${SESSION}
    confidence: medium
`),
  )
  expect(proposed.written).toBe(1)

  const row = db.query<{ proposed_slug: string; status: string }, []>(
    'SELECT proposed_slug, status FROM experience_candidates',
  ).get()
  expect(row?.status).toBe('proposed')
  expect(row?.proposed_slug).toBe('lock-dependency-versions')
})
