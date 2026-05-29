import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { Collector, RawMessage, RawSession } from './types'
import { deriveTitle, isEphemeralPath, normalizeContentParts } from './util'

const PROJECT_ROOTS = ['.claude/projects', '.claude-internal/projects']

function parseSessionFile(filePath: string): RawSession | null {
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n')

  const messages: RawMessage[] = []
  let rawProjectPath: string | null = null
  let sourceSessionId: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }

    if (typeof parsed.sessionId === 'string' && !sourceSessionId) {
      sourceSessionId = parsed.sessionId
    }
    if (typeof parsed.cwd === 'string' && !rawProjectPath) {
      rawProjectPath = parsed.cwd
    }

    const type = parsed.type
    if (type !== 'user' && type !== 'assistant') continue
    if (parsed.isSidechain === true) continue

    const message = parsed.message
    if (!message || typeof message !== 'object') continue
    const messageRecord = message as Record<string, unknown>
    const role = typeof messageRecord.role === 'string' ? messageRecord.role : type
    const content = normalizeContentParts(messageRecord.content)
    if (content.trim() === '') continue

    messages.push({
      role,
      content,
      timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
    })
  }

  if (messages.length === 0) return null
  if (isEphemeralPath(rawProjectPath)) return null

  sourceSessionId ??= basename(filePath).replace(/\.jsonl$/, '')
  const timestamps = messages.map((message) => message.timestamp).filter((value): value is string => value != null)

  return {
    sourceSessionId,
    rawPath: filePath,
    rawProjectPath,
    title: deriveTitle(messages),
    createdAt: timestamps[0] ?? null,
    updatedAt: timestamps[timestamps.length - 1] ?? null,
    messages,
  }
}

function listSessionFiles(homeDir: string): string[] {
  const files: string[] = []
  const seenRoots = new Set<string>()
  for (const root of PROJECT_ROOTS) {
    const projectsDir = join(homeDir, root)
    if (!existsSync(projectsDir)) continue

    let canonicalRoot: string
    try {
      canonicalRoot = realpathSync(projectsDir)
    } catch {
      canonicalRoot = projectsDir
    }
    if (seenRoots.has(canonicalRoot)) continue
    seenRoots.add(canonicalRoot)

    for (const projectEntry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!projectEntry.isDirectory()) continue
      const projectDir = join(projectsDir, projectEntry.name)
      for (const fileEntry of readdirSync(projectDir, { withFileTypes: true })) {
        if (fileEntry.isFile() && fileEntry.name.endsWith('.jsonl')) {
          files.push(join(projectDir, fileEntry.name))
        }
      }
    }
  }
  return files
}

export const claudeCodeCollector: Collector = {
  id: 'claude-code',
  name: 'Claude Code',

  detect(homeDir: string): boolean {
    return PROJECT_ROOTS.some((root) => existsSync(join(homeDir, root)))
  },

  collect(homeDir: string): RawSession[] {
    const sessions: RawSession[] = []
    for (const filePath of listSessionFiles(homeDir)) {
      try {
        if (!statSync(filePath).isFile()) continue
        const session = parseSessionFile(filePath)
        if (session) sessions.push(session)
      } catch {
        continue
      }
    }
    return sessions
  },
}
