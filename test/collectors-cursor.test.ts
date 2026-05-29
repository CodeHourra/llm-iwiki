import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { cursorCollector } from '../src/collectors/cursor'

const tmpHome = join(import.meta.dir, '.tmp-cursor')
const USER_DIR = join(tmpHome, 'Library/Application Support/Cursor/User')

function kvDatabase(path: string, table: string, rows: Array<[string, string]>): void {
  const db = new Database(path, { create: true })
  db.exec(`CREATE TABLE ${table} (key TEXT PRIMARY KEY, value TEXT)`)
  const insert = db.query(`INSERT INTO ${table} (key, value) VALUES (?, ?)`)
  for (const [key, value] of rows) insert.run(key, value)
  db.close()
}

function setupCursor(): void {
  const wsDir = join(USER_DIR, 'workspaceStorage', 'ws1')
  mkdirSync(wsDir, { recursive: true })
  writeFileSync(join(wsDir, 'workspace.json'), JSON.stringify({ folder: 'file:///Users/steve/Codes/demo' }))
  kvDatabase(join(wsDir, 'state.vscdb'), 'ItemTable', [
    [
      'composer.composerData',
      JSON.stringify({
        allComposers: [{ composerId: 'c1', name: '修复登录 bug', createdAt: 1700000000000, lastUpdatedAt: 1700000600000 }],
      }),
    ],
  ])

  mkdirSync(join(USER_DIR, 'globalStorage'), { recursive: true })
  kvDatabase(join(USER_DIR, 'globalStorage', 'state.vscdb'), 'cursorDiskKV', [
    [
      'composerData:c1',
      JSON.stringify({
        fullConversationHeadersOnly: [
          { bubbleId: 'b1', type: 1 },
          { bubbleId: 'b2', type: 2 },
          { bubbleId: 'b3', type: 2 },
        ],
      }),
    ],
    ['bubbleId:c1:b1', JSON.stringify({ type: 1, text: '登录页面报错了' })],
    ['bubbleId:c1:b2', JSON.stringify({ type: 2, text: '' })],
    ['bubbleId:c1:b3', JSON.stringify({ type: 2, text: '我来排查一下登录流程。' })],
  ])
}

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
})

test('cursorCollector joins workspace folder with global composer bubbles', () => {
  setupCursor()

  expect(cursorCollector.detect(tmpHome)).toBe(true)

  const sessions = cursorCollector.collect(tmpHome)
  expect(sessions.length).toBe(1)

  const session = sessions[0]!
  expect(session.sourceSessionId).toBe('c1')
  expect(session.rawProjectPath).toBe('/Users/steve/Codes/demo')
  expect(session.title).toBe('修复登录 bug')
  expect(session.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  expect(session.messages[1]!.content).toBe('我来排查一下登录流程。')
})

test('cursorCollector returns nothing without storage', () => {
  expect(cursorCollector.detect(tmpHome)).toBe(false)
  expect(cursorCollector.collect(tmpHome)).toEqual([])
})
