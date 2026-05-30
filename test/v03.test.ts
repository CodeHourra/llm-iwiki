import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { mkdirSync, writeFileSync } from 'node:fs'

import { parseExperiencesYaml } from '../src/ai-yaml'
import { openDatabase, runMigrations, type LlmIwikiDatabase } from '../src/db'
import { acceptExperience, proposeExperiences } from '../src/experiences'
import { exportAll, moveProject } from '../src/obsidian'
import {
  dedupeProjects,
  getProject,
  mergeProjects,
  ProjectResolutionError,
  resolveProjectRef,
} from '../src/projects'
import { search } from '../src/search'
import { readSessionTranscript } from '../src/sessions'

const tmpRoot = join(import.meta.dir, '.tmp-v03')
const vault = join(tmpRoot, 'vault')

let db: LlmIwikiDatabase

const now = '2026-01-01T00:00:00.000Z'

function insertProject(id: string, repo: string | null, slug: string, name: string): void {
  db.query(`INSERT INTO projects (id, canonical_name, display_name, slug, canonical_repo_url, identity_source, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`).run(id, name, slug, repo, repo ? 'git_remote' : 'path', now, now)
}

function insertSession(id: string, projectId: string): void {
  db.query(`INSERT INTO sessions (id, source_id, source_session_id, project_id, message_count, content_hash, status, first_seen_at, last_seen_at)
    VALUES (?, 'codex', ?, ?, 1, ?, 'new', ?, ?)`).run(id, id, projectId, id, now, now)
}

beforeEach(() => {
  db = openDatabase(join(tmpRoot, 'llm-iwiki.db'))
  runMigrations(db)
})

afterEach(() => {
  db.close()
  rmSync(tmpRoot, { recursive: true, force: true })
})

test('resolveProjectRef picks the candidate with the most sessions among duplicates', () => {
  insertProject('proj_full', 'github.com/demo/app', 'app', 'github.com/demo/app')
  insertProject('proj_empty', 'github.com/demo/app', 'app', 'github.com/demo/app')
  insertSession('ses_1', 'proj_full')
  insertSession('ses_2', 'proj_full')

  const resolved = resolveProjectRef(db, 'app', tmpRoot)
  expect(resolved.id).toBe('proj_full')
})

test('resolveProjectRef throws with candidates when names tie', () => {
  insertProject('proj_a', 'github.com/demo/a', 'shared', 'A shared')
  insertProject('proj_b', 'github.com/demo/b', 'shared', 'B shared')

  expect(() => resolveProjectRef(db, 'shared', tmpRoot)).toThrow(ProjectResolutionError)
})

test('resolveProjectRef errors when nothing matches instead of creating an empty project', () => {
  expect(() => resolveProjectRef(db, 'proj_does_not_exist', tmpRoot)).toThrow(ProjectResolutionError)
  expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM projects').get()?.n).toBe(0)
})

test('mergeProjects repoints sessions and removes the duplicate', () => {
  insertProject('proj_keep', 'github.com/demo/app', 'app', 'app')
  insertProject('proj_dup', 'github.com/demo/app', 'app', 'app')
  insertSession('ses_keep', 'proj_keep')
  insertSession('ses_dup', 'proj_dup')

  const result = mergeProjects(db, 'proj_dup', 'proj_keep')
  expect(result.movedSessions).toBe(1)
  expect(() => getProject(db, 'proj_dup')).toThrow()
  const count = db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM sessions WHERE project_id = ?').get('proj_keep')
  expect(count?.n).toBe(2)
})

test('dedupeProjects merges same-repo duplicates into the busiest project', () => {
  insertProject('proj_busy', 'github.com/demo/app', 'app', 'app')
  insertProject('proj_idle', 'github.com/demo/app', 'app', 'app')
  insertSession('ses_a', 'proj_busy')
  insertSession('ses_b', 'proj_busy')
  insertSession('ses_c', 'proj_idle')

  const result = dedupeProjects(db)
  expect(result.merges).toHaveLength(1)
  expect(result.merges[0]?.intoId).toBe('proj_busy')
  expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM projects').get()?.n).toBe(1)
})

test('readSessionTranscript returns the real conversation body', () => {
  insertProject('proj_x', null, 'x', 'x')
  insertSession('ses_x', 'proj_x')
  db.query("INSERT INTO messages (id, session_id, role, content, seq_order, content_hash) VALUES ('m1', 'ses_x', 'user', '我要排查登录态丢失', 0, 'h1')").run()
  db.query("INSERT INTO messages (id, session_id, role, content, seq_order, content_hash) VALUES ('m2', 'ses_x', 'assistant', '按租户刷新 token', 1, 'h2')").run()

  const { transcript, messageCount } = readSessionTranscript(db, 'ses_x')
  expect(messageCount).toBe(2)
  expect(transcript).toContain('登录态丢失')
  expect(transcript).toContain('按租户刷新 token')
})

test('experiences carry summary/topic/tech_stack into export and the global index', () => {
  insertProject('proj_app', 'github.com/demo/app', 'app', 'Demo App')
  insertSession('ses_1', 'proj_app')
  db.query(`INSERT INTO session_summaries (id, session_id, project_id, title, value, summary_markdown, created_at, updated_at)
    VALUES ('sum_1', 'ses_1', 'proj_app', '登录态排查', 'high', '切租户丢登录态。', ?, ?)`).run(now, now)

  proposeExperiences(
    db,
    parseExperiencesYaml(`
project_id: proj_app
experiences:
  - title: 多租户登录态刷新
    slug: tenant-auth-refresh
    summary: 切换租户必须按租户刷新凭证。
    body_markdown: |
      ## 结论
      中间件按租户刷新 token。
    source_sessions:
      - ses_1
    topic: backend
    tech_stack: [go, kratos]
    problem_type: 登录态
`),
  )
  const candidate = db.query<{ id: string }, []>('SELECT id FROM experience_candidates').get()
  acceptExperience(db, candidate!.id)

  const report = exportAll(db, vault, { force: false })
  expect(report.conflicts).toHaveLength(0)

  const expPath = join(vault, 'LLM-iWiki', 'Projects', 'app', 'experiences', 'tenant-auth-refresh.md')
  const expContent = readFileSync(expPath, 'utf8')
  expect(expContent).toContain('切换租户必须按租户刷新凭证')
  expect(expContent).toContain('topic: backend')
  expect(expContent).toContain('go')

  const readme = readFileSync(join(vault, 'LLM-iWiki', 'README.md'), 'utf8')
  expect(readme).toContain('## 项目')
  expect(readme).toContain('## 主题')

  const topicPath = join(vault, 'LLM-iWiki', 'Topics', 'Topic - backend.md')
  expect(existsSync(topicPath)).toBe(true)
  expect(readFileSync(topicPath, 'utf8')).toContain('tenant-auth-refresh')
})

test('moveProject migrates an old export directory to the slug directory', () => {
  insertProject('proj_app', 'github.com/demo/app', 'app', 'Demo App')
  const oldDir = join(vault, 'LLM-iWiki', 'Projects', 'github.com demo app')
  mkdirSync(join(oldDir, 'sessions'), { recursive: true })
  const oldSummary = join(oldDir, 'Project Summary.md')
  writeFileSync(oldSummary, '# old')
  writeFileSync(join(oldDir, 'sessions', 's.md'), '# s')
  db.query(`INSERT INTO obsidian_notes (id, note_type, entity_id, file_path, managed_hash, conflict_status)
    VALUES ('note_1', 'project-summary', 'proj_app', ?, 'h', 'clean')`).run(oldSummary)

  const result = moveProject(db, vault, getProject(db, 'proj_app'))
  expect(result.moved).toBe(1)
  expect(existsSync(join(vault, 'LLM-iWiki', 'Projects', 'app', 'Project Summary.md'))).toBe(true)
  expect(existsSync(oldSummary)).toBe(false)

  const note = db.query<{ file_path: string }, []>('SELECT file_path FROM obsidian_notes').get()
  expect(note?.file_path).toContain(join('Projects', 'app'))
})

test('search finds experiences by Chinese substring', () => {
  insertProject('proj_app', 'github.com/demo/app', 'app', 'Demo App')
  insertSession('ses_1', 'proj_app')
  proposeExperiences(
    db,
    parseExperiencesYaml(`
project_id: proj_app
experiences:
  - title: 多租户登录态刷新
    slug: tenant-auth
    summary: 按租户刷新凭证。
    body_markdown: |
      ## 结论
      刷新 token。
    source_sessions:
      - ses_1
`),
  )
  const candidate = db.query<{ id: string }, []>('SELECT id FROM experience_candidates').get()
  acceptExperience(db, candidate!.id)

  const hits = search(db, 'experiences', '租户', null)
  expect(hits.length).toBe(1)
  expect(hits[0]?.title).toBe('多租户登录态刷新')
})
