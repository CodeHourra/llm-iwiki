import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { claudeCodeCollector } from '../src/collectors/claude-code'

const tmpHome = join(import.meta.dir, '.tmp-collectors')

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
})

function writeClaudeSession(sessionId: string, cwd: string, lines: object[]): void {
  const dir = join(tmpHome, '.claude/projects', cwd.replace(/\//g, '-'))
  mkdirSync(dir, { recursive: true })
  const body = lines.map((line) => JSON.stringify(line)).join('\n')
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${body}\n`)
}

test('claudeCodeCollector detects storage and parses a session', () => {
  writeClaudeSession('sess-1', '/Users/steve/Codes/demo', [
    { type: 'permission-mode', permissionMode: 'default', sessionId: 'sess-1' },
    {
      type: 'user',
      sessionId: 'sess-1',
      cwd: '/Users/steve/Codes/demo',
      timestamp: '2026-05-01T10:00:00.000Z',
      message: { role: 'user', content: '修复 SQLite 解析报错' },
    },
    {
      type: 'assistant',
      sessionId: 'sess-1',
      cwd: '/Users/steve/Codes/demo',
      timestamp: '2026-05-01T10:01:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: '我来排查一下。' }] },
    },
  ])

  expect(claudeCodeCollector.detect(tmpHome)).toBe(true)

  const sessions = claudeCodeCollector.collect(tmpHome)
  expect(sessions.length).toBe(1)

  const session = sessions[0]!
  expect(session.sourceSessionId).toBe('sess-1')
  expect(session.rawProjectPath).toBe('/Users/steve/Codes/demo')
  expect(session.title).toBe('修复 SQLite 解析报错')
  expect(session.messages.length).toBe(2)
  expect(session.messages[1]!.content).toBe('我来排查一下。')
  expect(session.createdAt).toBe('2026-05-01T10:00:00.000Z')
  expect(session.updatedAt).toBe('2026-05-01T10:01:00.000Z')
})

test('claudeCodeCollector skips sidechain-only sessions and trivial title lines', () => {
  writeClaudeSession('title-gen', '/Users/steve/Codes/demo', [
    {
      type: 'user',
      isSidechain: true,
      sessionId: 'title-gen',
      cwd: '/Users/steve/Codes/demo',
      message: { role: 'user', content: '-\nYou are a conversation title generator.' },
    },
  ])
  writeClaudeSession('real', '/Users/steve/Codes/demo', [
    {
      type: 'user',
      sessionId: 'real',
      cwd: '/Users/steve/Codes/demo',
      timestamp: '2026-05-01T10:00:00.000Z',
      message: { role: 'user', content: '---\n实现 collector' },
    },
  ])

  const sessions = claudeCodeCollector.collect(tmpHome)
  expect(sessions.length).toBe(1)
  expect(sessions[0]!.sourceSessionId).toBe('real')
  expect(sessions[0]!.title).toBe('实现 collector')
})

test('claudeCodeCollector skips sessions running in ephemeral temp directories', () => {
  writeClaudeSession('tmp-util', '/private/var/folders/85/abc/T', [
    {
      type: 'user',
      sessionId: 'tmp-util',
      cwd: '/private/var/folders/85/abc/T',
      message: { role: 'user', content: 'You are a conversation title generator.' },
    },
  ])

  expect(claudeCodeCollector.collect(tmpHome).length).toBe(0)
})

test('claudeCodeCollector detect returns false without storage', () => {
  expect(claudeCodeCollector.detect(tmpHome)).toBe(false)
})
