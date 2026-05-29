import type { LlmIwikiDatabase } from './db'

export interface SessionRow {
  id: string
  sourceId: string
  sourceSessionId: string
  title: string | null
  messageCount: number
  status: string
  rawProjectPath: string | null
  updatedAt: string | null
  lastSeenAt: string
}

export interface SourceBreakdown {
  source: string
  sessionCount: number
}

export interface ProjectInspection {
  sources: SourceBreakdown[]
  sessions: SessionRow[]
}

function mapRow(row: {
  id: string
  source_id: string
  source_session_id: string
  title: string | null
  message_count: number
  status: string
  raw_project_path: string | null
  updated_at: string | null
  last_seen_at: string
}): SessionRow {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceSessionId: row.source_session_id,
    title: row.title,
    messageCount: row.message_count,
    status: row.status,
    rawProjectPath: row.raw_project_path,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  }
}

export function listSessionsByProject(db: LlmIwikiDatabase, projectId: string, limit = 100): SessionRow[] {
  return db
    .query<Parameters<typeof mapRow>[0], [string, number]>(`
      SELECT id, source_id, source_session_id, title, message_count, status, raw_project_path, updated_at, last_seen_at
      FROM sessions
      WHERE project_id = ?
      ORDER BY COALESCE(updated_at, last_seen_at) DESC
      LIMIT ?
    `)
    .all(projectId, limit)
    .map(mapRow)
}

export interface StoredMessage {
  role: string
  content: string
}

export function getSessionMessages(db: LlmIwikiDatabase, sessionId: string): StoredMessage[] {
  return db
    .query<{ role: string; content: string }, [string]>(
      'SELECT role, content FROM messages WHERE session_id = ? ORDER BY seq_order ASC',
    )
    .all(sessionId)
}

export function getSession(db: LlmIwikiDatabase, sessionId: string): SessionRow | null {
  const row = db
    .query<Parameters<typeof mapRow>[0], [string]>(`
      SELECT id, source_id, source_session_id, title, message_count, status, raw_project_path, updated_at, last_seen_at
      FROM sessions
      WHERE id = ?
    `)
    .get(sessionId)
  return row ? mapRow(row) : null
}

export function listSessionsToSummarize(
  db: LlmIwikiDatabase,
  projectId: string,
  scope: 'changed' | 'all',
): SessionRow[] {
  const statusClause = scope === 'changed' ? "AND status IN ('new', 'changed')" : ''
  return db
    .query<Parameters<typeof mapRow>[0], [string]>(`
      SELECT id, source_id, source_session_id, title, message_count, status, raw_project_path, updated_at, last_seen_at
      FROM sessions
      WHERE project_id = ? ${statusClause}
      ORDER BY COALESCE(updated_at, last_seen_at) DESC
    `)
    .all(projectId)
    .map(mapRow)
}

export function inspectProject(db: LlmIwikiDatabase, projectId: string): ProjectInspection {
  const sources = db
    .query<{ source_id: string; session_count: number }, [string]>(`
      SELECT source_id, COUNT(*) AS session_count
      FROM sessions
      WHERE project_id = ?
      GROUP BY source_id
      ORDER BY session_count DESC
    `)
    .all(projectId)
    .map((row) => ({ source: row.source_id, sessionCount: row.session_count }))

  return {
    sources,
    sessions: listSessionsByProject(db, projectId),
  }
}
