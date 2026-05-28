import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import type { LlmIwikiDatabase } from './db'

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

export function resolveProject(db: LlmIwikiDatabase, checkoutPath: string): ProjectRecord {
  const localPath = resolve(checkoutPath)
  if (!existsSync(localPath)) throw new Error(`Path does not exist: ${localPath}`)

  const gitRoot = git(localPath, ['rev-parse', '--show-toplevel'])
  const remote = git(localPath, ['config', '--get', 'remote.origin.url'])
  const canonicalRepoUrl = remote ? canonicalizeRemoteUrl(remote) : null
  const canonicalName = canonicalRepoUrl ?? basename(gitRoot ?? localPath)
  const slug = slugifyProjectName(canonicalName)
  const id = `proj_${Bun.hash(canonicalRepoUrl ?? gitRoot ?? localPath).toString(16)}`
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
    $id: id,
    $canonicalName: canonicalName,
    $slug: slug,
    $canonicalRepoUrl: canonicalRepoUrl,
    $identitySource: canonicalRepoUrl ? 'git_remote' : 'path',
    $now: now,
  })

  return getProject(db, id)
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
