import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { stringify as stringifyYaml } from 'yaml'

import type { LlmIwikiDatabase } from './db'
import type { ProjectRecord } from './projects'

const MANAGED_START = '<!-- aiwiki:managed:start -->'
const MANAGED_END = '<!-- aiwiki:managed:end -->'

export type NoteWriteStatus = 'created' | 'updated' | 'conflict' | 'forced'

export interface NoteSpec {
  noteType: string
  entityId: string
  relPath: string
  frontmatter: Record<string, unknown>
  title: string
  managedBody: string
  userSectionHeading?: string
}

export interface ExportOptions {
  force: boolean
}

export interface ExportReport {
  created: number
  updated: number
  forced: number
  conflicts: string[]
}

function hash(value: string): string {
  return Bun.hash(value).toString(16)
}

function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return cleaned === '' ? 'untitled' : cleaned
}

function buildNote(spec: NoteSpec): string {
  const frontmatter = stringifyYaml(spec.frontmatter).trimEnd()
  const userHeading = spec.userSectionHeading ?? '## 我的补充'
  return [
    '---',
    frontmatter,
    '---',
    '',
    `# ${spec.title}`,
    '',
    MANAGED_START,
    spec.managedBody.trim(),
    MANAGED_END,
    '',
    userHeading,
    '',
    '',
  ].join('\n')
}

interface ManagedSplit {
  before: string
  managed: string
  after: string
}

function splitManaged(content: string): ManagedSplit | null {
  const startIndex = content.indexOf(MANAGED_START)
  const endIndex = content.indexOf(MANAGED_END)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return null
  return {
    before: content.slice(0, startIndex + MANAGED_START.length),
    managed: content.slice(startIndex + MANAGED_START.length, endIndex).trim(),
    after: content.slice(endIndex),
  }
}

function replaceManaged(split: ManagedSplit, managedBody: string): string {
  return `${split.before}\n${managedBody.trim()}\n${split.after}`
}

interface NoteRecord {
  managed_hash: string | null
  file_path: string
}

function getNoteRecord(db: LlmIwikiDatabase, noteType: string, entityId: string): NoteRecord | null {
  return db
    .query<NoteRecord, [string, string]>(
      'SELECT managed_hash, file_path FROM obsidian_notes WHERE note_type = ? AND entity_id = ?',
    )
    .get(noteType, entityId)
}

function upsertNoteRecord(
  db: LlmIwikiDatabase,
  spec: NoteSpec,
  filePath: string,
  managedHash: string,
  conflictStatus: string,
  now: string,
): void {
  db.query(`
    INSERT INTO obsidian_notes (id, note_type, entity_id, file_path, managed_hash, frontmatter_hash, last_exported_at, conflict_status)
    VALUES ($id, $noteType, $entityId, $filePath, $managedHash, NULL, $now, $conflictStatus)
    ON CONFLICT(note_type, entity_id) DO UPDATE SET
      file_path = excluded.file_path,
      managed_hash = excluded.managed_hash,
      last_exported_at = excluded.last_exported_at,
      conflict_status = excluded.conflict_status
  `).run({
    $id: `note_${hash(`${spec.noteType}\u0000${spec.entityId}`)}`,
    $noteType: spec.noteType,
    $entityId: spec.entityId,
    $filePath: filePath,
    $managedHash: managedHash,
    $conflictStatus: conflictStatus,
    $now: now,
  })
}

export function writeNote(
  db: LlmIwikiDatabase,
  vault: string,
  spec: NoteSpec,
  options: ExportOptions,
  now: string,
): NoteWriteStatus {
  const filePath = join(vault, spec.relPath)
  const managedHash = hash(spec.managedBody.trim())

  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, buildNote(spec))
    upsertNoteRecord(db, spec, filePath, managedHash, 'clean', now)
    return 'created'
  }

  const existing = readFileSync(filePath, 'utf8')
  const split = splitManaged(existing)
  if (!split) {
    upsertNoteRecord(db, spec, filePath, managedHash, 'no_managed_block', now)
    return 'conflict'
  }

  const currentManagedHash = hash(split.managed)
  const record = getNoteRecord(db, spec.noteType, spec.entityId)
  const userEditedManaged = !record || record.managed_hash !== currentManagedHash

  if (userEditedManaged && !options.force) {
    upsertNoteRecord(db, spec, filePath, record?.managed_hash ?? currentManagedHash, 'managed_conflict', now)
    return 'conflict'
  }

  writeFileSync(filePath, replaceManaged(split, spec.managedBody))
  upsertNoteRecord(db, spec, filePath, managedHash, 'clean', now)
  return userEditedManaged ? 'forced' : 'updated'
}

function projectDirName(project: ProjectRecord): string {
  return sanitizeFileName(project.displayName ?? project.canonicalName ?? project.slug)
}

interface SummaryRow {
  id: string
  session_id: string
  title: string
  value: string
  summary_markdown: string
  updated_at: string | null
}

interface ExperienceRow {
  id: string
  title: string
  slug: string
  body_markdown: string
  confidence: string | null
  status: string
  updated_at: string
}

export function exportProject(
  db: LlmIwikiDatabase,
  vault: string,
  project: ProjectRecord,
  options: ExportOptions,
): ExportReport {
  const now = new Date().toISOString()
  const report: ExportReport = { created: 0, updated: 0, forced: 0, conflicts: [] }
  const dirName = projectDirName(project)
  const baseRel = join('LLM-iWiki', 'Projects', dirName)
  const displayName = project.displayName ?? project.canonicalName

  const track = (status: NoteWriteStatus, relPath: string): void => {
    if (status === 'created') report.created += 1
    else if (status === 'updated') report.updated += 1
    else if (status === 'forced') report.forced += 1
    else report.conflicts.push(relPath)
  }

  const summaries = db
    .query<SummaryRow, [string]>(`
      SELECT id, session_id, title, value, summary_markdown, updated_at
      FROM session_summaries WHERE project_id = ? ORDER BY updated_at DESC
    `)
    .all(project.id)

  for (const summary of summaries) {
    const relPath = join(baseRel, 'Sessions', `${sanitizeFileName(summary.title)}.md`)
    const spec: NoteSpec = {
      noteType: 'session-summary',
      entityId: summary.id,
      relPath,
      title: summary.title,
      managedBody: summary.summary_markdown,
      frontmatter: {
        type: 'session-summary',
        aiwiki_id: summary.id,
        aiwiki_project_id: project.id,
        project: displayName,
        session_id: summary.session_id,
        value: summary.value,
        updated_at: summary.updated_at ?? now,
      },
    }
    track(writeNote(db, vault, spec, options, now), relPath)
  }

  const experiences = db
    .query<ExperienceRow, [string]>(`
      SELECT id, title, slug, body_markdown, confidence, status, updated_at
      FROM experiences WHERE project_id = ? AND status = 'accepted' ORDER BY updated_at DESC
    `)
    .all(project.id)

  for (const experience of experiences) {
    const relPath = join(baseRel, 'Experiences', `${sanitizeFileName(experience.slug || experience.title)}.md`)
    const sourceSessions = db
      .query<{ session_id: string }, [string]>(
        'SELECT session_id FROM session_experience_links WHERE experience_id = ?',
      )
      .all(experience.id)
      .map((row) => row.session_id)
    const spec: NoteSpec = {
      noteType: 'experience',
      entityId: experience.id,
      relPath,
      title: experience.title,
      managedBody: experience.body_markdown,
      frontmatter: {
        type: 'experience',
        aiwiki_id: experience.id,
        aiwiki_project_id: project.id,
        project: displayName,
        slug: experience.slug,
        confidence: experience.confidence,
        status: experience.status,
        source_sessions: sourceSessions,
        updated_at: experience.updated_at,
      },
    }
    track(writeNote(db, vault, spec, options, now), relPath)
  }

  const indexRel = join(baseRel, 'Project Summary.md')
  const indexBody = [
    `- canonical: \`${project.canonicalName}\``,
    project.canonicalRepoUrl ? `- repo: ${project.canonicalRepoUrl}` : null,
    `- session summaries: ${summaries.length}`,
    `- experiences: ${experiences.length}`,
  ]
    .filter((line): line is string => line != null)
    .join('\n')
  const indexSpec: NoteSpec = {
    noteType: 'project-summary',
    entityId: project.id,
    relPath: indexRel,
    title: displayName,
    managedBody: indexBody,
    frontmatter: {
      type: 'project-summary',
      aiwiki_project_id: project.id,
      project: displayName,
      canonical_repo_url: project.canonicalRepoUrl,
      updated_at: now,
    },
  }
  track(writeNote(db, vault, indexSpec, options, now), indexRel)

  return report
}

export type CheckStatus = 'clean' | 'drift' | 'missing' | 'no_managed_block'

export interface CheckEntry {
  noteType: string
  entityId: string
  filePath: string
  status: CheckStatus
}

export interface CheckReport {
  total: number
  clean: number
  entries: CheckEntry[]
}

export function checkVault(db: LlmIwikiDatabase): CheckReport {
  const rows = db
    .query<{ note_type: string; entity_id: string; file_path: string; managed_hash: string | null }, []>(
      'SELECT note_type, entity_id, file_path, managed_hash FROM obsidian_notes ORDER BY file_path ASC',
    )
    .all()

  const entries: CheckEntry[] = []
  let clean = 0

  for (const row of rows) {
    let status: CheckStatus
    if (!existsSync(row.file_path)) {
      status = 'missing'
    } else {
      const split = splitManaged(readFileSync(row.file_path, 'utf8'))
      if (!split) {
        status = 'no_managed_block'
      } else if (row.managed_hash && hash(split.managed) === row.managed_hash) {
        status = 'clean'
      } else {
        status = 'drift'
      }
    }
    if (status === 'clean') clean += 1
    else entries.push({ noteType: row.note_type, entityId: row.entity_id, filePath: row.file_path, status })
  }

  return { total: rows.length, clean, entries }
}
