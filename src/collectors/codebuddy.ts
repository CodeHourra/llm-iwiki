import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { Collector, RawMessage, RawSession } from './types'
import { clampTitle, deriveTitle, isEphemeralPath, normalizeContentParts } from './util'

const APP_SUPPORT = 'Library/Application Support'
const EXTENSION_DIRS = ['CodeBuddyExtension', 'CodeBuddy CN']

interface ConversationMeta {
  id: string
  name?: string
  createdAt?: string
  lastMessageAt?: string
}

function findHistoryDirs(root: string, acc: string[], depth = 0): void {
  if (depth > 6) return
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = join(root, entry.name)
    if (entry.name === 'history') {
      acc.push(full)
    } else if (entry.name !== 'messages') {
      findHistoryDirs(full, acc, depth + 1)
    }
  }
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function extractMessageText(messageField: unknown): string {
  if (typeof messageField !== 'string') return normalizeContentParts(messageField)
  const trimmed = messageField.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && 'content' in parsed) {
        return normalizeContentParts((parsed as { content: unknown }).content)
      }
      return normalizeContentParts(parsed)
    } catch {
      return messageField
    }
  }
  return messageField
}

function extractWorkspaceFolder(text: string): string | null {
  const match = text.match(/Workspace Folder:\s*(.+)/)
  if (!match) return null
  const folder = match[1]!.trim()
  return folder === '' ? null : folder
}

function readConversation(
  convDir: string,
  conversationId: string,
  meta: ConversationMeta,
): RawSession | null {
  const convIndex = readJson<{ messages?: Array<{ id: string; role?: string }> }>(join(convDir, 'index.json'))
  if (!convIndex?.messages) return null

  const messages: RawMessage[] = []
  let rawProjectPath: string | null = null

  for (const entry of convIndex.messages) {
    const raw = readJson<{ role?: string; message?: unknown }>(join(convDir, 'messages', `${entry.id}.json`))
    if (!raw) continue
    const role = entry.role ?? raw.role ?? 'user'
    if (role !== 'user' && role !== 'assistant') continue

    const content = extractMessageText(raw.message)
    if (content.trim() === '') continue

    if (!rawProjectPath && role === 'user') {
      rawProjectPath = extractWorkspaceFolder(content)
    }
    messages.push({ role, content, timestamp: null })
  }

  if (messages.length === 0) return null
  if (isEphemeralPath(rawProjectPath)) return null

  const title = meta.name && meta.name.trim() !== '' ? clampTitle(meta.name.trim()) : deriveTitle(messages)

  return {
    sourceSessionId: conversationId,
    rawPath: convDir,
    rawProjectPath,
    title,
    createdAt: meta.createdAt ?? null,
    updatedAt: meta.lastMessageAt ?? null,
    messages,
  }
}

function collectFromHistory(historyDir: string, sessions: RawSession[]): void {
  for (const workspaceEntry of readdirSync(historyDir, { withFileTypes: true })) {
    if (!workspaceEntry.isDirectory()) continue
    const workspaceDir = join(historyDir, workspaceEntry.name)
    const workspaceIndex = readJson<{ conversations?: ConversationMeta[] }>(join(workspaceDir, 'index.json'))
    if (!workspaceIndex?.conversations?.length) continue

    for (const conversation of workspaceIndex.conversations) {
      if (!conversation.id) continue
      const convDir = join(workspaceDir, conversation.id)
      if (!existsSync(convDir)) continue
      try {
        const session = readConversation(convDir, conversation.id, conversation)
        if (session) sessions.push(session)
      } catch {
        continue
      }
    }
  }
}

function extensionRoots(homeDir: string): string[] {
  return EXTENSION_DIRS.map((dir) => join(homeDir, APP_SUPPORT, dir)).filter((dir) => existsSync(dir))
}

export const codebuddyCollector: Collector = {
  id: 'codebuddy',
  name: 'CodeBuddy',

  detect(homeDir: string): boolean {
    return extensionRoots(homeDir).length > 0
  },

  collect(homeDir: string): RawSession[] {
    const sessions: RawSession[] = []
    const seen = new Set<string>()
    for (const root of extensionRoots(homeDir)) {
      const historyDirs: string[] = []
      findHistoryDirs(join(root, 'Data'), historyDirs)
      for (const historyDir of historyDirs) {
        try {
          if (!statSync(historyDir).isDirectory()) continue
        } catch {
          continue
        }
        collectFromHistory(historyDir, sessions)
      }
    }
    return sessions.filter((session) => {
      if (seen.has(session.sourceSessionId)) return false
      seen.add(session.sourceSessionId)
      return true
    })
  },
}
