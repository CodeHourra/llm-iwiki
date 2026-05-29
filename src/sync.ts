import type { LlmIwikiDatabase } from './db'
import { resolveProjectByPath } from './projects'
import { COLLECTORS, type Collector, type RawSession } from './collectors'

export interface SourceSyncReport {
  source: string
  new: number
  changed: number
  unchanged: number
  sourceMissing: number
  total: number
}

export interface SyncReport {
  bySource: SourceSyncReport[]
}

export interface SyncOptions {
  homeDir: string
  projectFilter?: string | null
}

function hash(value: string): string {
  return Bun.hash(value).toString(16)
}

function sessionPrimaryId(sourceId: string, session: RawSession): string {
  return `ses_${hash(`${sourceId}\u0000${session.sourceSessionId}\u0000${session.rawPath}`)}`
}

function messageContentHash(role: string, content: string): string {
  return hash(`${role}\u0000${content}`)
}

function sessionContentHash(messageHashes: string[]): string {
  return hash(`${messageHashes.length}\u0000${messageHashes.join('\u0000')}`)
}

function upsertSource(db: LlmIwikiDatabase, collector: Collector, now: string): void {
  db.query(`
    INSERT INTO sources (id, name, enabled, scan_paths, config_json, last_sync_at)
    VALUES ($id, $name, 1, NULL, NULL, $now)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      last_sync_at = excluded.last_sync_at
  `).run({ $id: collector.id, $name: collector.name, $now: now })
}

function resolveProjectId(db: LlmIwikiDatabase, rawProjectPath: string | null): string | null {
  if (!rawProjectPath) return null
  try {
    return resolveProjectByPath(db, rawProjectPath).id
  } catch {
    return null
  }
}

function writeSession(
  db: LlmIwikiDatabase,
  collector: Collector,
  session: RawSession,
  now: string,
  report: SourceSyncReport,
): string {
  const id = sessionPrimaryId(collector.id, session)
  const messageHashes = session.messages.map((message) => messageContentHash(message.role, message.content))
  const contentHash = sessionContentHash(messageHashes)
  const projectId = resolveProjectId(db, session.rawProjectPath)

  const existing = db
    .query<{ content_hash: string; first_seen_at: string }, [string]>(
      'SELECT content_hash, first_seen_at FROM sessions WHERE id = ?',
    )
    .get(id)

  if (existing && existing.content_hash === contentHash) {
    db.query('UPDATE sessions SET project_id = $projectId, status = $status, last_seen_at = $now WHERE id = $id').run({
      $projectId: projectId,
      $status: 'unchanged',
      $now: now,
      $id: id,
    })
    report.unchanged += 1
    return id
  }

  const status = existing ? 'changed' : 'new'
  const firstSeenAt = existing?.first_seen_at ?? now

  db.query(`
    INSERT INTO sessions (
      id, source_id, source_session_id, project_id, checkout_id, raw_project_path, raw_path,
      title, message_count, content_hash, status, created_at, updated_at, first_seen_at, last_seen_at
    ) VALUES (
      $id, $sourceId, $sourceSessionId, $projectId, NULL, $rawProjectPath, $rawPath,
      $title, $messageCount, $contentHash, $status, $createdAt, $updatedAt, $firstSeenAt, $now
    )
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      raw_project_path = excluded.raw_project_path,
      title = excluded.title,
      message_count = excluded.message_count,
      content_hash = excluded.content_hash,
      status = excluded.status,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at
  `).run({
    $id: id,
    $sourceId: collector.id,
    $sourceSessionId: session.sourceSessionId,
    $projectId: projectId,
    $rawProjectPath: session.rawProjectPath,
    $rawPath: session.rawPath,
    $title: session.title,
    $messageCount: session.messages.length,
    $contentHash: contentHash,
    $status: status,
    $createdAt: session.createdAt,
    $updatedAt: session.updatedAt,
    $firstSeenAt: firstSeenAt,
    $now: now,
  })

  db.query('DELETE FROM messages WHERE session_id = ?').run(id)
  session.messages.forEach((message, index) => {
    db.query(`
      INSERT INTO messages (id, session_id, role, content, timestamp, seq_order, content_hash)
      VALUES ($id, $sessionId, $role, $content, $timestamp, $seqOrder, $contentHash)
    `).run({
      $id: `msg_${id}_${index}`,
      $sessionId: id,
      $role: message.role,
      $content: message.content,
      $timestamp: message.timestamp,
      $seqOrder: index,
      $contentHash: messageHashes[index]!,
    })
  })

  if (status === 'new') report.new += 1
  else report.changed += 1
  return id
}

function markMissingSessions(
  db: LlmIwikiDatabase,
  sourceId: string,
  seenIds: Set<string>,
  now: string,
  report: SourceSyncReport,
): void {
  const rows = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM sessions WHERE source_id = ? AND status != 'source_missing'",
    )
    .all(sourceId)

  for (const row of rows) {
    if (seenIds.has(row.id)) continue
    db.query('UPDATE sessions SET status = $status, last_seen_at = $now WHERE id = $id').run({
      $status: 'source_missing',
      $now: now,
      $id: row.id,
    })
    report.sourceMissing += 1
  }
}

export function runSync(db: LlmIwikiDatabase, options: SyncOptions): SyncReport {
  const now = new Date().toISOString()
  const bySource: SourceSyncReport[] = []

  for (const collector of COLLECTORS) {
    if (!collector.detect(options.homeDir)) continue

    upsertSource(db, collector, now)
    const report: SourceSyncReport = {
      source: collector.id,
      new: 0,
      changed: 0,
      unchanged: 0,
      sourceMissing: 0,
      total: 0,
    }

    const sessions = collector.collect(options.homeDir)
    const seenIds = new Set<string>()

    const writeAll = db.transaction(() => {
      for (const session of sessions) {
        if (options.projectFilter && session.rawProjectPath !== options.projectFilter) continue
        const id = writeSession(db, collector, session, now, report)
        seenIds.add(id)
        report.total += 1
      }
      if (!options.projectFilter) {
        markMissingSessions(db, collector.id, seenIds, now, report)
      }
    })
    writeAll()

    bySource.push(report)
  }

  return { bySource }
}
