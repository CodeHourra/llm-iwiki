import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { stringify as stringifyYaml } from 'yaml'

import type { LlmIwikiDatabase } from './db'
import { stableHash } from './hash'
import { getProject, listProjects, type ProjectRecord } from './projects'

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
  return stableHash(value)
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

const VAULT_ROOT = 'LLM-iWiki'

function projectDirName(project: ProjectRecord): string {
  // 用 slug 而非完整 repo URL 命名目录，避免 "github.com xxx yyy" 这类难读路径。
  return sanitizeFileName(project.slug || project.displayName || project.canonicalName)
}

function wikiLink(name: string): string {
  return `[[${name.replace(/[[\]|]/g, ' ').trim()}]]`
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
  summary: string | null
  body_markdown: string
  confidence: string | null
  topic: string | null
  tech_stack_json: string | null
  status: string
  updated_at: string
}

function parseTechStack(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function buildProjectSummaryBody(
  project: ProjectRecord,
  summaries: SummaryRow[],
  experiences: ExperienceRow[],
): string {
  const techStack = [...new Set(experiences.flatMap((exp) => parseTechStack(exp.tech_stack_json)))]
  const topics = [...new Set(experiences.map((exp) => exp.topic).filter((t): t is string => !!t))]

  const timeline = [...summaries]
    .filter((summary) => summary.updated_at)
    .sort((a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? ''))
    .map((summary) => `| ${(summary.updated_at ?? '').slice(0, 10)} | ${summary.title} |`)

  const lines: string[] = []
  lines.push('## 概览')
  lines.push('')
  lines.push(`- 标识：\`${project.canonicalName}\``)
  if (project.canonicalRepoUrl) lines.push(`- 仓库：${project.canonicalRepoUrl}`)
  lines.push(`- 会话总结：${summaries.length} 条`)
  lines.push(`- 沉淀经验：${experiences.length} 条`)
  if (techStack.length > 0) lines.push(`- 技术栈：${techStack.join(' / ')}`)
  if (topics.length > 0) lines.push(`- 主题：${topics.map((t) => wikiLink(`Topic - ${t}`)).join(' ')}`)
  lines.push('')

  lines.push('## 相关经验')
  lines.push('')
  if (experiences.length === 0) {
    lines.push('_暂无已采纳经验。_')
  } else {
    for (const exp of experiences) {
      const summary = exp.summary ? ` — ${exp.summary.trim().split('\n')[0]}` : ''
      lines.push(`- ${wikiLink(exp.slug || exp.title)}${summary}`)
    }
  }
  lines.push('')

  lines.push('## 演进时间线')
  lines.push('')
  if (timeline.length === 0) {
    lines.push('_暂无会话总结。_')
  } else {
    lines.push('| 日期 | 里程碑 |')
    lines.push('| --- | --- |')
    lines.push(...timeline)
  }

  return lines.join('\n')
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
  const baseRel = join(VAULT_ROOT, 'Projects', dirName)
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
    const relPath = join(baseRel, 'sessions', `${sanitizeFileName(summary.title)}.md`)
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
      SELECT id, title, slug, summary, body_markdown, confidence, topic, tech_stack_json, status, updated_at
      FROM experiences WHERE project_id = ? AND status = 'accepted' ORDER BY updated_at DESC
    `)
    .all(project.id)

  for (const experience of experiences) {
    const relPath = join(baseRel, 'experiences', `${sanitizeFileName(experience.slug || experience.title)}.md`)
    const sourceSessions = db
      .query<{ session_id: string }, [string]>(
        'SELECT session_id FROM session_experience_links WHERE experience_id = ?',
      )
      .all(experience.id)
      .map((row) => row.session_id)
    const techStack = parseTechStack(experience.tech_stack_json)
    const managedBody = [
      experience.summary ? `> ${experience.summary.trim().replace(/\n+/g, ' ')}` : null,
      experience.summary ? '' : null,
      `- 所属项目：${wikiLink(project.slug || displayName)}`,
      experience.topic ? `- 主题：${wikiLink(`Topic - ${experience.topic}`)}` : null,
      techStack.length > 0 ? `- 技术栈：${techStack.join(' / ')}` : null,
      '',
      experience.body_markdown.trim(),
    ]
      .filter((line): line is string => line != null)
      .join('\n')
    const spec: NoteSpec = {
      noteType: 'experience',
      entityId: experience.id,
      relPath,
      title: experience.title,
      managedBody,
      frontmatter: {
        type: 'experience',
        aiwiki_id: experience.id,
        aiwiki_project_id: project.id,
        project: displayName,
        slug: experience.slug,
        topic: experience.topic,
        tech_stack: techStack,
        confidence: experience.confidence,
        status: experience.status,
        source_sessions: sourceSessions,
        updated_at: experience.updated_at,
      },
    }
    track(writeNote(db, vault, spec, options, now), relPath)
  }

  const indexRel = join(baseRel, 'Project Summary.md')
  const indexSpec: NoteSpec = {
    noteType: 'project-summary',
    entityId: project.id,
    relPath: indexRel,
    title: displayName,
    managedBody: buildProjectSummaryBody(project, summaries, experiences),
    frontmatter: {
      type: 'project-summary',
      aiwiki_project_id: project.id,
      project: displayName,
      slug: project.slug,
      canonical_repo_url: project.canonicalRepoUrl,
      updated_at: now,
    },
  }
  track(writeNote(db, vault, indexSpec, options, now), indexRel)

  return report
}

function mergeReports(into: ExportReport, from: ExportReport): void {
  into.created += from.created
  into.updated += from.updated
  into.forced += from.forced
  into.conflicts.push(...from.conflicts)
}

interface TopicExperienceRow {
  title: string
  slug: string
  summary: string | null
  topic: string
  project_slug: string
  project_name: string
}

/**
 * 生成跨项目的全局导航：知识库 README 索引 + 每个主题的聚合页。
 */
export function writeGlobalIndex(db: LlmIwikiDatabase, vault: string, options: ExportOptions): ExportReport {
  const now = new Date().toISOString()
  const report: ExportReport = { created: 0, updated: 0, forced: 0, conflicts: [] }
  const track = (status: NoteWriteStatus, relPath: string): void => {
    if (status === 'created') report.created += 1
    else if (status === 'updated') report.updated += 1
    else if (status === 'forced') report.forced += 1
    else report.conflicts.push(relPath)
  }

  const projects = listProjects(db).filter((project) => project.sessionCount > 0 || hasExportedNotes(db, project.id))

  const topicRows = db
    .query<TopicExperienceRow, []>(`
      SELECT e.title, e.slug, e.summary, e.topic, p.slug AS project_slug,
             COALESCE(p.display_name, p.canonical_name) AS project_name
      FROM experiences e
      JOIN projects p ON p.id = e.project_id
      WHERE e.status = 'accepted' AND e.topic IS NOT NULL AND e.topic != ''
      ORDER BY e.topic ASC, e.updated_at DESC
    `)
    .all()

  const topics = new Map<string, TopicExperienceRow[]>()
  for (const row of topicRows) {
    const group = topics.get(row.topic) ?? []
    group.push(row)
    topics.set(row.topic, group)
  }

  // README 根索引
  const readmeLines: string[] = []
  readmeLines.push('## 项目')
  readmeLines.push('')
  if (projects.length === 0) {
    readmeLines.push('_暂无项目。运行 `llm-iwiki obsidian export` 导出。_')
  } else {
    for (const project of projects) {
      const name = project.displayName ?? project.canonicalName
      const dir = sanitizeFileName(project.slug || name)
      readmeLines.push(
        `- [${name}](Projects/${encodeURIComponent(dir)}/Project%20Summary.md) — 总结 ${project.sessionCount} 会话`,
      )
    }
  }
  readmeLines.push('')
  readmeLines.push('## 主题')
  readmeLines.push('')
  if (topics.size === 0) {
    readmeLines.push('_暂无主题分类。在经验 YAML 中填写 `topic` 即可聚合。_')
  } else {
    for (const topic of [...topics.keys()].sort()) {
      readmeLines.push(`- ${wikiLink(`Topic - ${topic}`)}（${topics.get(topic)!.length} 条经验）`)
    }
  }

  track(
    writeNote(
      db,
      vault,
      {
        noteType: 'index',
        entityId: 'root',
        relPath: join(VAULT_ROOT, 'README.md'),
        title: 'LLM-iWiki 知识库',
        managedBody: readmeLines.join('\n'),
        frontmatter: { type: 'index', updated_at: now },
        userSectionHeading: '## 备注',
      },
      options,
      now,
    ),
    join(VAULT_ROOT, 'README.md'),
  )

  // 每个主题一页
  for (const [topic, rows] of topics) {
    const body = rows
      .map((row) => {
        const summary = row.summary ? ` — ${row.summary.trim().split('\n')[0]}` : ''
        return `- ${wikiLink(row.slug || row.title)}${summary}（${wikiLink(row.project_slug || row.project_name)}）`
      })
      .join('\n')
    const relPath = join(VAULT_ROOT, 'Topics', `Topic - ${sanitizeFileName(topic)}.md`)
    track(
      writeNote(
        db,
        vault,
        {
          noteType: 'topic',
          entityId: topic,
          relPath,
          title: `Topic - ${topic}`,
          managedBody: body,
          frontmatter: { type: 'topic', topic, updated_at: now },
        },
        options,
        now,
      ),
      relPath,
    )
  }

  return report
}

function hasExportedNotes(db: LlmIwikiDatabase, projectId: string): boolean {
  const row = db
    .query<{ n: number }, [string]>(
      "SELECT COUNT(*) AS n FROM obsidian_notes WHERE note_type = 'project-summary' AND entity_id = ?",
    )
    .get(projectId)
  return (row?.n ?? 0) > 0
}

/**
 * 导出全部项目并刷新全局索引。
 */
export function exportAll(db: LlmIwikiDatabase, vault: string, options: ExportOptions): ExportReport {
  const report: ExportReport = { created: 0, updated: 0, forced: 0, conflicts: [] }
  for (const project of listProjects(db)) {
    if (project.sessionCount === 0 && !hasExportedNotes(db, project.id)) continue
    mergeReports(report, exportProject(db, vault, getProject(db, project.id), options))
  }
  mergeReports(report, writeGlobalIndex(db, vault, options))
  return report
}

export interface MoveProjectResult {
  moved: number
  fromDirs: string[]
}

/**
 * 把某项目已导出的笔记从旧路径迁移到当前 slug 目录（重命名/去重后调用）。
 */
export function moveProject(db: LlmIwikiDatabase, vault: string, project: ProjectRecord): MoveProjectResult {
  const targetBase = join(vault, VAULT_ROOT, 'Projects', projectDirName(project))

  // 通过 obsidian_notes 中 project-summary 记录推断旧目录，再迁移整个项目目录。
  const summaryNote = db
    .query<{ file_path: string }, [string]>(
      "SELECT file_path FROM obsidian_notes WHERE note_type = 'project-summary' AND entity_id = ?",
    )
    .get(project.id)

  const fromDirs: string[] = []
  let moved = 0
  if (summaryNote) {
    const oldDir = dirname(summaryNote.file_path)
    if (existsSync(oldDir) && oldDir !== targetBase) {
      mkdirSync(dirname(targetBase), { recursive: true })
      if (existsSync(targetBase)) {
        throw new Error(`Target already exists: ${targetBase}`)
      }
      renameSync(oldDir, targetBase)
      fromDirs.push(oldDir)
      moved += 1
      // 重写 obsidian_notes 中该项目相关笔记的 file_path 前缀。
      const notes = db
        .query<{ id: string; file_path: string }, []>('SELECT id, file_path FROM obsidian_notes')
        .all()
      for (const note of notes) {
        if (note.file_path.startsWith(oldDir)) {
          const next = note.file_path.replace(oldDir, targetBase)
          db.query('UPDATE obsidian_notes SET file_path = ? WHERE id = ?').run(next, note.id)
        }
      }
    }
  }

  return { moved, fromDirs }
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
