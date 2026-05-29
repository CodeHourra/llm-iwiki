import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { Collector, RawMessage, RawSession } from './types'
import { deriveTitle, isEphemeralPath } from './util'

const SESSION_ROOTS = ['.codex/sessions', '.codex-internal/sessions']

function cleanCodexText(text: string): string {
  return text
    .replace(/\[REQ:[0-9a-f-]+\]/gi, '')
    .replace(/\[AMP_DONE:[0-9a-f-]+\]/gi, '')
    .trim()
}

function walkRolloutFiles(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkRolloutFiles(full, acc)
    } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      acc.push(full)
    }
  }
}

function parseRolloutFile(filePath: string): RawSession | null {
  const raw = readFileSync(filePath, 'utf8')
  const messages: RawMessage[] = []
  let rawProjectPath: string | null = null
  let sourceSessionId: string | null = null
  let createdAt: string | null = null

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }

    const payload = entry.payload
    if (!payload || typeof payload !== 'object') continue
    const payloadRecord = payload as Record<string, unknown>
    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : null

    if (entry.type === 'session_meta') {
      if (typeof payloadRecord.id === 'string') sourceSessionId = payloadRecord.id
      if (typeof payloadRecord.cwd === 'string') rawProjectPath = payloadRecord.cwd
      if (typeof payloadRecord.timestamp === 'string') createdAt = payloadRecord.timestamp
      continue
    }

    if (entry.type !== 'event_msg') continue
    const eventType = payloadRecord.type
    if (eventType !== 'user_message' && eventType !== 'agent_message') continue
    if (typeof payloadRecord.message !== 'string') continue

    const content = cleanCodexText(payloadRecord.message)
    if (content === '') continue
    messages.push({
      role: eventType === 'user_message' ? 'user' : 'assistant',
      content,
      timestamp,
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
    createdAt: createdAt ?? timestamps[0] ?? null,
    updatedAt: timestamps[timestamps.length - 1] ?? null,
    messages,
  }
}

function listRolloutFiles(homeDir: string): string[] {
  const files: string[] = []
  const seenRoots = new Set<string>()
  for (const root of SESSION_ROOTS) {
    const sessionsDir = join(homeDir, root)
    if (!existsSync(sessionsDir)) continue

    let canonicalRoot: string
    try {
      canonicalRoot = realpathSync(sessionsDir)
    } catch {
      canonicalRoot = sessionsDir
    }
    if (seenRoots.has(canonicalRoot)) continue
    seenRoots.add(canonicalRoot)

    walkRolloutFiles(sessionsDir, files)
  }
  return files
}

export const codexCollector: Collector = {
  id: 'codex',
  name: 'Codex',

  detect(homeDir: string): boolean {
    return SESSION_ROOTS.some((root) => existsSync(join(homeDir, root)))
  },

  collect(homeDir: string): RawSession[] {
    const sessions: RawSession[] = []
    for (const filePath of listRolloutFiles(homeDir)) {
      try {
        if (!statSync(filePath).isFile()) continue
        const session = parseRolloutFile(filePath)
        if (session) sessions.push(session)
      } catch {
        continue
      }
    }
    return sessions
  },
}
