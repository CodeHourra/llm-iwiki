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

function upsertProjectIdentity(db: LlmIwikiDatabase, identity: ProjectIdentity): ProjectRecord {
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

  return getProject(db, identity.id)
}

export function resolveProject(db: LlmIwikiDatabase, checkoutPath: string): ProjectRecord {
  const localPath = resolve(checkoutPath)
  if (!existsSync(localPath)) throw new Error(`Path does not exist: ${localPath}`)
  return upsertProjectIdentity(db, computeProjectIdentity(localPath))
}

export function resolveProjectByPath(db: LlmIwikiDatabase, rawPath: string): ProjectRecord {
  const localPath = resolve(rawPath)
  return upsertProjectIdentity(db, computeProjectIdentity(localPath))
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
