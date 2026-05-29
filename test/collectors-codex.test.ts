import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { codexCollector } from '../src/collectors/codex'

const tmpHome = join(import.meta.dir, '.tmp-codex')

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
})

function writeRollout(lines: object[]): void {
  const dir = join(tmpHome, '.codex/sessions/2026/01/01')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'rollout-2026-01-01T00-00-00-abc.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`)
}

test('codexCollector parses session_meta cwd and event_msg turns', () => {
  writeRollout([
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'codex-sess-1', cwd: '/Users/steve/Codes/demo', timestamp: '2026-01-01T00:00:00.000Z' },
    },
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '# AGENTS.md noise' }] },
    },
    {
      timestamp: '2026-01-01T00:01:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '[REQ:abc]\n帮我修复构建报错' },
    },
    {
      timestamp: '2026-01-01T00:02:00.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: '好的，我来排查。[AMP_DONE:abc]' },
    },
  ])

  expect(codexCollector.detect(tmpHome)).toBe(true)

  const sessions = codexCollector.collect(tmpHome)
  expect(sessions.length).toBe(1)

  const session = sessions[0]!
  expect(session.sourceSessionId).toBe('codex-sess-1')
  expect(session.rawProjectPath).toBe('/Users/steve/Codes/demo')
  expect(session.title).toBe('帮我修复构建报错')
  expect(session.messages.length).toBe(2)
  expect(session.messages[0]!.content).toBe('帮我修复构建报错')
  expect(session.messages[1]!.content).toBe('好的，我来排查。')
})

test('codexCollector skips ephemeral cwd sessions', () => {
  writeRollout([
    { timestamp: 't', type: 'session_meta', payload: { id: 's', cwd: '/private/var/folders/x/T' } },
    { timestamp: 't', type: 'event_msg', payload: { type: 'user_message', message: 'hi' } },
  ])
  expect(codexCollector.collect(tmpHome).length).toBe(0)
})
