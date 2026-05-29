import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { geminiCollector } from '../src/collectors/gemini'

const tmpHome = join(import.meta.dir, '.tmp-gemini')

function writeGemini(projectsMap: Record<string, string>, projectDir: string, chat: object): void {
  const root = join(tmpHome, '.gemini-internal')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'projects.json'), JSON.stringify({ projects: projectsMap }))
  const chatsDir = join(root, 'tmp', projectDir, 'chats')
  mkdirSync(chatsDir, { recursive: true })
  writeFileSync(join(chatsDir, 'session-2026-01-01T00-00-abc.json'), JSON.stringify(chat))
}

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
})

test('geminiCollector resolves cwd via projects.json and parses messages', () => {
  writeGemini({ '/Users/steve/Codes/demo': 'demo' }, 'demo', {
    sessionId: 'gem-1',
    startTime: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:05:00.000Z',
    messages: [
      { id: 'a', timestamp: '2026-01-01T00:00:00.000Z', type: 'user', content: '解释下这个项目结构' },
      { id: 'b', timestamp: '2026-01-01T00:01:00.000Z', type: 'gemini', content: '这是一个 CLI 项目。' },
    ],
  })

  expect(geminiCollector.detect(tmpHome)).toBe(true)

  const sessions = geminiCollector.collect(tmpHome)
  expect(sessions.length).toBe(1)

  const session = sessions[0]!
  expect(session.sourceSessionId).toBe('gem-1')
  expect(session.rawProjectPath).toBe('/Users/steve/Codes/demo')
  expect(session.title).toBe('解释下这个项目结构')
  expect(session.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
})

test('geminiCollector falls back to absolute-path first message when project unknown', () => {
  writeGemini({}, 'deadbeefhash', {
    sessionId: 'gem-2',
    messages: [
      { type: 'user', content: '/Users/steve/Codes/fallback-proj/' },
      { type: 'gemini', content: '好的。' },
    ],
  })

  const session = geminiCollector.collect(tmpHome)[0]!
  expect(session.rawProjectPath).toBe('/Users/steve/Codes/fallback-proj')
})
