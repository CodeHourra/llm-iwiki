import { Database } from 'bun:sqlite'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Collector, RawMessage, RawSession } from './types'
import { clampTitle, deriveTitle, isEphemeralPath } from './util'

const CURSOR_USER_DIR = 'Library/Application Support/Cursor/User'

interface ComposerMeta {
  cwd: string | null
  name: string | null
  createdAt: string | null
  updatedAt: string | null
}

function epochToIso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function folderUriToPath(uri: string): string | null {
  if (!uri.startsWith('file://')) return null
  try {
    return decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(/\/+$/, '')
  } catch {
    return null
  }
}

function openReadonly(path: string): Database | null {
  try {
    return new Database(path, { readonly: true })
  } catch {
    return null
  }
}

function collectWorkspaceComposers(userDir: string): Map<string, ComposerMeta> {
  const composers = new Map<string, ComposerMeta>()
  const workspaceStorage = join(userDir, 'workspaceStorage')
  if (!existsSync(workspaceStorage)) return composers

  for (const entry of readdirSync(workspaceStorage, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const wsDir = join(workspaceStorage, entry.name)

    let cwd: string | null = null
    const workspaceJson = join(wsDir, 'workspace.json')
    if (existsSync(workspaceJson)) {
      try {
        const parsed = JSON.parse(readFileSync(workspaceJson, 'utf8')) as { folder?: string }
        if (typeof parsed.folder === 'string') cwd = folderUriToPath(parsed.folder)
      } catch {
        // ignore
      }
    }

    const dbPath = join(wsDir, 'state.vscdb')
    if (!existsSync(dbPath)) continue
    const db = openReadonly(dbPath)
    if (!db) continue
    try {
      const row = db.query<{ value: string }, [string]>('SELECT value FROM ItemTable WHERE key = ?').get('composer.composerData')
      if (!row) continue
      const data = JSON.parse(row.value) as { allComposers?: Array<Record<string, unknown>> }
      for (const composer of data.allComposers ?? []) {
        const composerId = composer.composerId
        if (typeof composerId !== 'string') continue
        if (composers.has(composerId)) continue
        composers.set(composerId, {
          cwd,
          name: typeof composer.name === 'string' ? composer.name : null,
          createdAt: epochToIso(composer.createdAt),
          updatedAt: epochToIso(composer.lastUpdatedAt),
        })
      }
    } catch {
      // ignore malformed workspace db
    } finally {
      db.close()
    }
  }

  return composers
}

function buildSession(
  globalDb: Database,
  dbPath: string,
  composerId: string,
  meta: ComposerMeta,
): RawSession | null {
  const composerRow = globalDb
    .query<{ value: string }, [string]>('SELECT value FROM cursorDiskKV WHERE key = ?')
    .get(`composerData:${composerId}`)
  if (!composerRow) return null

  let composer: { name?: string; createdAt?: number; fullConversationHeadersOnly?: Array<{ bubbleId: string; type: number }> }
  try {
    composer = JSON.parse(composerRow.value)
  } catch {
    return null
  }

  const headers = composer.fullConversationHeadersOnly ?? []
  if (headers.length === 0) return null

  const bubbleStmt = globalDb.query<{ value: string }, [string]>('SELECT value FROM cursorDiskKV WHERE key = ?')
  const messages: RawMessage[] = []
  for (const header of headers) {
    if (header.type !== 1 && header.type !== 2) continue
    const bubbleRow = bubbleStmt.get(`bubbleId:${composerId}:${header.bubbleId}`)
    if (!bubbleRow) continue
    let bubble: { text?: string }
    try {
      bubble = JSON.parse(bubbleRow.value)
    } catch {
      continue
    }
    const text = typeof bubble.text === 'string' ? bubble.text.trim() : ''
    if (text === '') continue
    messages.push({ role: header.type === 1 ? 'user' : 'assistant', content: text, timestamp: null })
  }

  if (messages.length === 0) return null
  if (isEphemeralPath(meta.cwd)) return null

  const name = meta.name ?? composer.name ?? null
  const title = name && name.trim() !== '' ? clampTitle(name.trim()) : deriveTitle(messages)

  return {
    sourceSessionId: composerId,
    rawPath: `${dbPath}#${composerId}`,
    rawProjectPath: meta.cwd,
    title,
    createdAt: meta.createdAt ?? epochToIso(composer.createdAt),
    updatedAt: meta.updatedAt,
    messages,
  }
}

export const cursorCollector: Collector = {
  id: 'cursor',
  name: 'Cursor',

  detect(homeDir: string): boolean {
    return existsSync(join(homeDir, CURSOR_USER_DIR, 'globalStorage', 'state.vscdb'))
  },

  collect(homeDir: string): RawSession[] {
    const userDir = join(homeDir, CURSOR_USER_DIR)
    const globalDbPath = join(userDir, 'globalStorage', 'state.vscdb')
    if (!existsSync(globalDbPath)) return []

    const composers = collectWorkspaceComposers(userDir)
    if (composers.size === 0) return []

    const globalDb = openReadonly(globalDbPath)
    if (!globalDb) return []

    const sessions: RawSession[] = []
    try {
      for (const [composerId, meta] of composers) {
        try {
          const session = buildSession(globalDb, globalDbPath, composerId, meta)
          if (session) sessions.push(session)
        } catch {
          continue
        }
      }
    } finally {
      globalDb.close()
    }
    return sessions
  },
}
