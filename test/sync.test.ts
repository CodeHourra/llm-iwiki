import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { openDatabase, runMigrations, type LlmIwikiDatabase } from '../src/db'
import { listProjects } from '../src/projects'
import { inspectProject } from '../src/sessions'
import { runSync } from '../src/sync'

const tmpRoot = join(import.meta.dir, '.tmp-sync')
const tmpHome = join(tmpRoot, 'home')

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function sessionDir(cwd: string): string {
  return join(tmpHome, '.claude/projects', cwd.replace(/\//g, '-'))
}

function writeSession(sessionId: string, cwd: string, lines: object[]): void {
  const dir = sessionDir(cwd)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`)
}

function openDb(): LlmIwikiDatabase {
  const db = openDatabase(join(tmpRoot, 'llm-iwiki.db'))
  runMigrations(db)
  return db
}

const CWD = '/Users/demo/Codes/llm-iwiki-demo-project'

function userLine(content: string, ts: string) {
  return { type: 'user', sessionId: 'sess-1', cwd: CWD, timestamp: ts, message: { role: 'user', content } }
}

test('runSync ingests sessions, aggregates by project, and is idempotent', () => {
  writeSession('sess-1', CWD, [userLine('第一条消息', '2026-05-01T10:00:00.000Z')])
  const db = openDb()
  try {
    const first = runSync(db, { homeDir: tmpHome })
    const claude = first.bySource.find((s) => s.source === 'claude-code')!
    expect(claude.new).toBe(1)
    expect(claude.total).toBe(1)

    const projects = listProjects(db)
    expect(projects.length).toBe(1)
    expect(projects[0]!.sessionCount).toBe(1)

    const inspection = inspectProject(db, projects[0]!.id)
    expect(inspection.sources).toEqual([{ source: 'claude-code', sessionCount: 1 }])
    expect(inspection.sessions[0]!.title).toBe('第一条消息')

    const second = runSync(db, { homeDir: tmpHome })
    const claude2 = second.bySource.find((s) => s.source === 'claude-code')!
    expect(claude2.unchanged).toBe(1)
    expect(claude2.new).toBe(0)
  } finally {
    db.close()
  }
})

test('runSync marks changed and source_missing sessions', () => {
  writeSession('sess-1', CWD, [userLine('原始内容', '2026-05-01T10:00:00.000Z')])
  const db = openDb()
  try {
    runSync(db, { homeDir: tmpHome })

    writeSession('sess-1', CWD, [
      userLine('原始内容', '2026-05-01T10:00:00.000Z'),
      userLine('新增内容', '2026-05-01T10:05:00.000Z'),
    ])
    const changed = runSync(db, { homeDir: tmpHome }).bySource.find((s) => s.source === 'claude-code')!
    expect(changed.changed).toBe(1)

    rmSync(sessionDir(CWD), { recursive: true, force: true })
    const missing = runSync(db, { homeDir: tmpHome }).bySource.find((s) => s.source === 'claude-code')
    expect(missing?.sourceMissing).toBe(1)
  } finally {
    db.close()
  }
})
