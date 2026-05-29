import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import type { Collector, RawMessage, RawSession } from './types'
import { deriveTitle, isEphemeralPath } from './util'

const INTERNAL_ROOTS = ['.gemini-internal', '.gemini']

function loadProjectNameMap(geminiRoot: string): Map<string, string> {
  const nameToPath = new Map<string, string>()
  const projectsFile = join(geminiRoot, 'projects.json')
  if (!existsSync(projectsFile)) return nameToPath
  try {
    const parsed = JSON.parse(readFileSync(projectsFile, 'utf8')) as { projects?: Record<string, string> }
    for (const [path, name] of Object.entries(parsed.projects ?? {})) {
      if (typeof name === 'string' && !nameToPath.has(name)) nameToPath.set(name, path)
    }
  } catch {
    // ignore malformed projects.json
  }
  return nameToPath
}

function looksLikeAbsolutePath(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith('/') && !trimmed.includes('\n') && trimmed.length < 256
}

function parseChatFile(filePath: string, projectDir: string, nameToPath: Map<string, string>): RawSession | null {
  let parsed: {
    sessionId?: string
    startTime?: string
    lastUpdated?: string
    messages?: Array<{ type?: string; content?: unknown; timestamp?: string }>
  }
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }

  const messages: RawMessage[] = []
  for (const message of parsed.messages ?? []) {
    if (message.type !== 'user' && message.type !== 'gemini') continue
    const content = typeof message.content === 'string' ? message.content : ''
    if (content.trim() === '') continue
    messages.push({
      role: message.type === 'user' ? 'user' : 'assistant',
      content,
      timestamp: typeof message.timestamp === 'string' ? message.timestamp : null,
    })
  }

  if (messages.length === 0) return null

  let rawProjectPath = nameToPath.get(projectDir) ?? null
  if (!rawProjectPath) {
    const firstUser = messages.find((message) => message.role === 'user')
    if (firstUser && looksLikeAbsolutePath(firstUser.content)) {
      rawProjectPath = firstUser.content.trim().replace(/\/+$/, '')
    }
  }
  if (isEphemeralPath(rawProjectPath)) return null

  const timestamps = messages.map((message) => message.timestamp).filter((value): value is string => value != null)

  return {
    sourceSessionId: parsed.sessionId ?? basename(filePath).replace(/\.json$/, ''),
    rawPath: filePath,
    rawProjectPath,
    title: deriveTitle(messages),
    createdAt: parsed.startTime ?? timestamps[0] ?? null,
    updatedAt: parsed.lastUpdated ?? timestamps[timestamps.length - 1] ?? null,
    messages,
  }
}

function resolveGeminiRoot(homeDir: string): string | null {
  const seen = new Set<string>()
  for (const root of INTERNAL_ROOTS) {
    const dir = join(homeDir, root)
    if (!existsSync(dir)) continue
    let canonical: string
    try {
      canonical = realpathSync(dir)
    } catch {
      canonical = dir
    }
    if (seen.has(canonical)) continue
    seen.add(canonical)
    return dir
  }
  return null
}

function listChatFiles(geminiRoot: string): string[] {
  const tmpDir = join(geminiRoot, 'tmp')
  if (!existsSync(tmpDir)) return []

  const files: string[] = []
  for (const projectEntry of readdirSync(tmpDir, { withFileTypes: true })) {
    if (!projectEntry.isDirectory()) continue
    const chatsDir = join(tmpDir, projectEntry.name, 'chats')
    if (!existsSync(chatsDir)) continue
    for (const fileEntry of readdirSync(chatsDir, { withFileTypes: true })) {
      if (fileEntry.isFile() && fileEntry.name.startsWith('session-') && fileEntry.name.endsWith('.json')) {
        files.push(join(chatsDir, fileEntry.name))
      }
    }
  }
  return files
}

export const geminiCollector: Collector = {
  id: 'gemini',
  name: 'Gemini',

  detect(homeDir: string): boolean {
    const root = resolveGeminiRoot(homeDir)
    return root != null && existsSync(join(root, 'tmp'))
  },

  collect(homeDir: string): RawSession[] {
    const geminiRoot = resolveGeminiRoot(homeDir)
    if (!geminiRoot) return []
    const nameToPath = loadProjectNameMap(geminiRoot)

    const sessions: RawSession[] = []
    for (const filePath of listChatFiles(geminiRoot)) {
      try {
        if (!statSync(filePath).isFile()) continue
        const projectDir = basename(dirname(dirname(filePath)))
        const session = parseChatFile(filePath, projectDir, nameToPath)
        if (session) sessions.push(session)
      } catch {
        continue
      }
    }
    return sessions
  },
}
