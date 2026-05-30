import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import type { LlmIwikiDatabase } from './db'
import { stableHash } from './hash'

export interface ProjectRecord {
  id: string
  canonicalName: string
  displayName: string | null
  slug: string
  canonicalRepoUrl: string | null
  identitySource: string
}

export function canonicalizeRemoteUrl(remoteUrl: string): string {
  return remoteUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/^ssh:\/\/git@([^/]+)\//, '$1/')
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
}

export function slugifyProjectName(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[^\w\s./-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s._/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return ascii || 'project'
}

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) return null
  return result.stdout.trim() || null
}

interface ProjectIdentity {
  id: string
  canonicalName: string
  slug: string
  canonicalRepoUrl: string | null
  identitySource: string
}

function computeProjectIdentity(localPath: string): ProjectIdentity {
  const gitRoot = git(localPath, ['rev-parse', '--show-toplevel'])
  const remote = git(localPath, ['config', '--get', 'remote.origin.url'])
  const canonicalRepoUrl = remote ? canonicalizeRemoteUrl(remote) : null
  const canonicalName = canonicalRepoUrl ?? basename(gitRoot ?? localPath)
  const slug = slugifyProjectName(canonicalName)
  const id = `proj_${stableHash(canonicalRepoUrl ?? gitRoot ?? localPath)}`

  return {
    id,
    canonicalName,
    slug,
    canonicalRepoUrl,
    identitySource: canonicalRepoUrl ? 'git_remote' : 'path',
  }
}

function upsertAlias(db: LlmIwikiDatabase, projectId: string, aliasType: string, aliasValue: string): void {
  const id = `alias_${stableHash(`${aliasType}\u0000${aliasValue}`)}`
  db.query(`
    INSERT INTO project_aliases (id, project_id, alias_type, alias_value)
    VALUES ($id, $projectId, $aliasType, $aliasValue)
    ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id
  `).run({ $id: id, $projectId: projectId, $aliasType: aliasType, $aliasValue: aliasValue })
}

function recordProjectAliases(db: LlmIwikiDatabase, identity: ProjectIdentity, localPath: string): void {
  upsertAlias(db, identity.id, 'path', localPath)
  upsertAlias(db, identity.id, 'slug', identity.slug)
  if (identity.canonicalRepoUrl) upsertAlias(db, identity.id, 'repo', identity.canonicalRepoUrl)

  const now = new Date().toISOString()
  const checkoutId = `chk_${stableHash(localPath)}`
  db.query(`
    INSERT INTO project_checkouts (id, project_id, local_path, git_root, remote_url, canonical_remote_url, current_branch, first_seen_at, last_seen_at)
    VALUES ($id, $projectId, $localPath, NULL, NULL, $canonicalRepoUrl, NULL, $now, $now)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      canonical_remote_url = excluded.canonical_remote_url,
      last_seen_at = excluded.last_seen_at
  `).run({
    $id: checkoutId,
    $projectId: identity.id,
    $localPath: localPath,
    $canonicalRepoUrl: identity.canonicalRepoUrl,
    $now: now,
  })
}

function upsertProjectIdentity(db: LlmIwikiDatabase, identity: ProjectIdentity, localPath?: string): ProjectRecord {
  const now = new Date().toISOString()
  db.query(`
    INSERT INTO projects (id, canonical_name, display_name, slug, canonical_repo_url, provider, identity_source, created_at, updated_at)
    VALUES ($id, $canonicalName, NULL, $slug, $canonicalRepoUrl, NULL, $identitySource, $now, $now)
    ON CONFLICT(id) DO UPDATE SET
      canonical_name = excluded.canonical_name,
      slug = excluded.slug,
      canonical_repo_url = excluded.canonical_repo_url,
      identity_source = excluded.identity_source,
      updated_at = excluded.updated_at
  `).run({
    $id: identity.id,
    $canonicalName: identity.canonicalName,
    $slug: identity.slug,
    $canonicalRepoUrl: identity.canonicalRepoUrl,
    $identitySource: identity.identitySource,
    $now: now,
  })

  if (localPath) recordProjectAliases(db, identity, localPath)

  return getProject(db, identity.id)
}

export function resolveProject(db: LlmIwikiDatabase, checkoutPath: string): ProjectRecord {
  const localPath = resolve(checkoutPath)
  if (!existsSync(localPath)) throw new Error(`Path does not exist: ${localPath}`)
  return upsertProjectIdentity(db, computeProjectIdentity(localPath), localPath)
}

export function resolveProjectByPath(db: LlmIwikiDatabase, rawPath: string): ProjectRecord {
  const localPath = resolve(rawPath)
  return upsertProjectIdentity(db, computeProjectIdentity(localPath), localPath)
}

/**
 * 当 --project 引用无法唯一确定一个项目时抛出，携带候选供 CLI 友好提示。
 */
export class ProjectResolutionError extends Error {
  constructor(
    public readonly ref: string,
    public readonly candidates: ProjectSummaryRow[],
  ) {
    super(
      candidates.length === 0
        ? `No project matched: ${ref}`
        : `Ambiguous project reference: ${ref} (${candidates.length} candidates)`,
    )
    this.name = 'ProjectResolutionError'
  }
}

/**
 * 找出与 ref（路径 / proj_id / 名称或 slug）相关的现有项目候选，按 session 数降序。
 * 仅查询现有记录，不创建新项目。
 */
export function findProjectCandidates(db: LlmIwikiDatabase, ref: string, cwd: string): ProjectSummaryRow[] {
  const all = listProjects(db)
  const byId = new Map(all.map((project) => [project.id, project]))
  const matched = new Map<string, ProjectSummaryRow>()
  const add = (project: ProjectSummaryRow | undefined): void => {
    if (project) matched.set(project.id, project)
  }

  if (ref.startsWith('proj_')) {
    add(byId.get(ref))
    return [...matched.values()]
  }

  const localPath = resolve(cwd, ref)
  if (existsSync(localPath)) {
    const identity = computeProjectIdentity(localPath)
    add(byId.get(identity.id))
    if (identity.canonicalRepoUrl) {
      for (const project of all) {
        if (project.canonicalRepoUrl === identity.canonicalRepoUrl) add(project)
      }
    }
    const aliasRows = db
      .query<{ project_id: string }, [string, string]>(
        'SELECT project_id FROM project_aliases WHERE alias_type = ? AND alias_value = ?',
      )
      .all('path', localPath)
    for (const row of aliasRows) add(byId.get(row.project_id))
    if (matched.size > 0) return sortBySessions([...matched.values()])
  }

  const needle = ref.trim().toLowerCase()
  const needleSlug = slugifyProjectName(ref)
  for (const project of all) {
    const haystacks = [project.slug, project.canonicalName, project.displayName ?? '']
    if (project.slug === needleSlug) add(project)
    else if (haystacks.some((value) => value.toLowerCase().includes(needle))) add(project)
  }

  return sortBySessions([...matched.values()])
}

function sortBySessions(rows: ProjectSummaryRow[]): ProjectSummaryRow[] {
  return [...rows].sort((a, b) => b.sessionCount - a.sessionCount || a.canonicalName.localeCompare(b.canonicalName))
}

/**
 * 把 --project 引用解析为唯一项目：优先 session 数最多者；多候选且并列时报错。
 * 不创建空项目，修复「落到空项目」的核心 bug。
 */
export function resolveProjectRef(db: LlmIwikiDatabase, ref: string, cwd: string): ProjectRecord {
  const candidates = findProjectCandidates(db, ref, cwd)
  if (candidates.length === 0) throw new ProjectResolutionError(ref, candidates)
  if (candidates.length === 1) return getProject(db, candidates[0]!.id)

  const [best, second] = candidates
  if (best && second && best.sessionCount === second.sessionCount) {
    throw new ProjectResolutionError(ref, candidates)
  }
  return getProject(db, best!.id)
}

export interface MergeProjectsResult {
  fromId: string
  intoId: string
  movedSessions: number
}

/**
 * 把 fromId 的所有关联数据重指向 intoId，再删除 fromId 项目记录。
 */
export function mergeProjects(db: LlmIwikiDatabase, fromId: string, intoId: string): MergeProjectsResult {
  if (fromId === intoId) throw new Error('Cannot merge a project into itself')
  getProject(db, fromId)
  getProject(db, intoId)

  let movedSessions = 0
  const run = db.transaction(() => {
    movedSessions = db.query('UPDATE sessions SET project_id = ? WHERE project_id = ?').run(intoId, fromId).changes
    db.query('UPDATE session_summaries SET project_id = ? WHERE project_id = ?').run(intoId, fromId)
    db.query('UPDATE experience_candidates SET project_id = ? WHERE project_id = ?').run(intoId, fromId)
    db.query('UPDATE experiences SET project_id = ? WHERE project_id = ?').run(intoId, fromId)
    db.query('UPDATE project_aliases SET project_id = ? WHERE project_id = ?').run(intoId, fromId)
    db.query('UPDATE project_checkouts SET project_id = ? WHERE project_id = ?').run(intoId, fromId)
    db.query(
      "UPDATE obsidian_notes SET entity_id = ? WHERE note_type = 'project-summary' AND entity_id = ?",
    ).run(intoId, fromId)
    db.query('DELETE FROM projects WHERE id = ?').run(fromId)
  })
  run()

  return { fromId, intoId, movedSessions }
}

export interface DedupeResult {
  merges: MergeProjectsResult[]
}

/**
 * 自动合并重复项目：按 canonical_repo_url（无则 slug）分组，并入 session 数最多者。
 */
export function dedupeProjects(db: LlmIwikiDatabase): DedupeResult {
  const projects = sortBySessions(listProjects(db))
  const groups = new Map<string, ProjectSummaryRow[]>()
  for (const project of projects) {
    const key = project.canonicalRepoUrl ? `repo:${project.canonicalRepoUrl}` : `slug:${project.slug}`
    const group = groups.get(key) ?? []
    group.push(project)
    groups.set(key, group)
  }

  const merges: MergeProjectsResult[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const sorted = sortBySessions(group)
    const keep = sorted[0]!
    for (const dup of sorted.slice(1)) {
      merges.push(mergeProjects(db, dup.id, keep.id))
    }
  }
  return { merges }
}

export function renameProject(db: LlmIwikiDatabase, projectId: string, displayName: string): ProjectRecord {
  const now = new Date().toISOString()
  const changes = db
    .query('UPDATE projects SET display_name = $displayName, updated_at = $now WHERE id = $projectId')
    .run({
      $displayName: displayName,
      $projectId: projectId,
      $now: now,
    })

  if (changes.changes === 0) throw new Error(`Project not found: ${projectId}`)

  return getProject(db, projectId)
}

export interface ProjectSummaryRow extends ProjectRecord {
  sessionCount: number
  lastSeenAt: string | null
}

export function listProjects(db: LlmIwikiDatabase): ProjectSummaryRow[] {
  const rows = db
    .query<
      {
        id: string
        canonical_name: string
        display_name: string | null
        slug: string
        canonical_repo_url: string | null
        identity_source: string
        session_count: number
        last_seen_at: string | null
      },
      []
    >(`
      SELECT
        p.id,
        p.canonical_name,
        p.display_name,
        p.slug,
        p.canonical_repo_url,
        p.identity_source,
        COUNT(s.id) AS session_count,
        MAX(s.last_seen_at) AS last_seen_at
      FROM projects p
      LEFT JOIN sessions s ON s.project_id = p.id
      GROUP BY p.id
      ORDER BY session_count DESC, p.canonical_name ASC
    `)
    .all()

  return rows.map((row) => ({
    id: row.id,
    canonicalName: row.canonical_name,
    displayName: row.display_name,
    slug: row.slug,
    canonicalRepoUrl: row.canonical_repo_url,
    identitySource: row.identity_source,
    sessionCount: row.session_count,
    lastSeenAt: row.last_seen_at,
  }))
}

export function getProject(db: LlmIwikiDatabase, projectId: string): ProjectRecord {
  const row = db
    .query<
      {
        id: string
        canonical_name: string
        display_name: string | null
        slug: string
        canonical_repo_url: string | null
        identity_source: string
      },
      [string]
    >('SELECT * FROM projects WHERE id = ?')
    .get(projectId)

  if (!row) throw new Error(`Project not found: ${projectId}`)

  return {
    id: row.id,
    canonicalName: row.canonical_name,
    displayName: row.display_name,
    slug: row.slug,
    canonicalRepoUrl: row.canonical_repo_url,
    identitySource: row.identity_source,
  }
}
