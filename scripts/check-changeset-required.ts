import { spawnSync } from 'node:child_process'

export interface CheckChangesetOptions {
  changedFiles: string[]
  prTitle: string
  labels: string[]
}

export interface CheckChangesetResult {
  ok: boolean
  message: string
}

const RELEASE_RELEVANT_PATTERNS = [
  /^src\//,
  /^README(?:\.zh-CN)?\.md$/,
  /^docs\//,
  /^package\.json$/,
  /^bun\.lockb?$/,
  /^LICENSE$/,
]

function isChangeset(file: string): boolean {
  return /^\.changeset\/[^/]+\.md$/.test(file)
}

function isReleaseRelevant(file: string): boolean {
  if (isChangeset(file)) return false
  return RELEASE_RELEVANT_PATTERNS.some((pattern) => pattern.test(file))
}

function hasNoReleaseMarker(title: string, labels: string[]): boolean {
  const normalizedTitle = title.toLowerCase()
  return normalizedTitle.includes('no-release') || labels.some((label) => label.toLowerCase() === 'no-release')
}

export function checkChangesetRequirement(options: CheckChangesetOptions): CheckChangesetResult {
  const changedFiles = options.changedFiles.filter(Boolean)

  if (hasNoReleaseMarker(options.prTitle, options.labels)) {
    return { ok: true, message: 'Release check skipped by no-release marker.' }
  }

  if (!changedFiles.some(isReleaseRelevant)) {
    return { ok: true, message: 'No release-relevant files changed.' }
  }

  if (changedFiles.some(isChangeset)) {
    return { ok: true, message: 'Changeset found.' }
  }

  return {
    ok: false,
    message:
      'Missing changeset for release-relevant changes. Run `bun run changeset` and commit the generated `.changeset/*.md`, or add a `no-release` label/title marker for changes that should not publish.',
  }
}

function readChangedFiles(base: string): string[] {
  const result = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git diff failed with status ${result.status}`)
  }

  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index === -1) return null
  return args[index + 1] ?? null
}

function main(): void {
  const base = readFlag(process.argv, '--base') ?? 'origin/master'
  const prTitle = readFlag(process.argv, '--title') ?? ''
  const labels = (readFlag(process.argv, '--labels') ?? '')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)

  const result = checkChangesetRequirement({
    changedFiles: readChangedFiles(base),
    prTitle,
    labels,
  })

  console.log(result.message)
  if (!result.ok) process.exit(1)
}

if (import.meta.main) {
  main()
}
