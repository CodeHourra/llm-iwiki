import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { codebuddyCollector } from '../src/collectors/codebuddy'

const tmpHome = join(import.meta.dir, '.tmp-codebuddy')

const HISTORY = join(tmpHome, 'Library/Application Support/CodeBuddyExtension/Data/default/CodeBuddyIDE/history')

function writeConversation(workspace: string, convId: string, name: string, messages: Array<{ id: string; role: string; message: string }>): void {
  const wsDir = join(HISTORY, workspace)
  mkdirSync(wsDir, { recursive: true })
  writeFileSync(
    join(wsDir, 'index.json'),
    JSON.stringify({ conversations: [{ id: convId, type: 'craft', name }], current: '' }),
  )

  const convDir = join(wsDir, convId)
  mkdirSync(join(convDir, 'messages'), { recursive: true })
  writeFileSync(join(convDir, 'index.json'), JSON.stringify({ messages: messages.map((m) => ({ id: m.id, role: m.role })) }))
  for (const message of messages) {
    writeFileSync(join(convDir, 'messages', `${message.id}.json`), JSON.stringify({ role: message.role, message: message.message }))
  }
}

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
})

test('codebuddyCollector reads conversations, name as title, and cwd from user_info', () => {
  const userMessage = JSON.stringify({
    role: 'user',
    content: [
      { type: 'text', text: '<user_info>\nWorkspace Folder: /Users/steve/Codes/demo\n</user_info>\n\n帮我加个功能' },
    ],
  })
  const assistantMessage = JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: '好的，我来实现。' }] })

  writeConversation('ws-hash-1', 'conv-1', '加个新功能', [
    { id: 'm1', role: 'user', message: userMessage },
    { id: 'm2', role: 'assistant', message: assistantMessage },
  ])

  expect(codebuddyCollector.detect(tmpHome)).toBe(true)

  const sessions = codebuddyCollector.collect(tmpHome)
  expect(sessions.length).toBe(1)

  const session = sessions[0]!
  expect(session.sourceSessionId).toBe('conv-1')
  expect(session.title).toBe('加个新功能')
  expect(session.rawProjectPath).toBe('/Users/steve/Codes/demo')
  expect(session.messages.length).toBe(2)
  expect(session.messages[1]!.content).toBe('好的，我来实现。')
})

test('codebuddyCollector skips workspaces without conversations', () => {
  const wsDir = join(HISTORY, 'empty-ws')
  mkdirSync(wsDir, { recursive: true })
  writeFileSync(join(wsDir, 'index.json'), JSON.stringify({ conversations: [], current: '' }))

  expect(codebuddyCollector.collect(tmpHome).length).toBe(0)
})
