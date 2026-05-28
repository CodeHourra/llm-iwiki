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
