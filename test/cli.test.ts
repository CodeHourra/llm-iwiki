import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCli } from '../src/cli'
import { openDatabase } from '../src/db'
import { getAppPaths } from '../src/paths'

const tmpRoot = join(tmpdir(), 'llm-iwiki-cli-test')

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function createRuntime(homeDir: string, cwd = '/tmp/project') {
  const stdout: string[] = []
  const stderr: string[] = []

  return {
    runtime: {
      cwd,
      homeDir,
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    stdout,
    stderr,
  }
}

function getProjectCount(databaseFile: string): number {
  const db = openDatabase(databaseFile)
  try {
    return db.query<{ count: number }, []>('SELECT count(*) as count FROM projects').get()?.count ?? 0
  } finally {
    db.close()
  }
}

test('prints help for --help', async () => {
  const stdout: string[] = []
  const stderr: string[] = []

  const exitCode = await runCli(['--help'], {
    cwd: '/tmp/project',
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  })

  expect(exitCode).toBe(0)
  expect(stderr).toEqual([])
  expect(stdout.join('\n')).toContain('llm-iwiki')
  expect(stdout.join('\n')).toContain('Usage:')
})

test('doctor fails for a fresh home without creating state', async () => {
  const homeDir = join(tmpRoot, 'fresh-home')
  const paths = getAppPaths(homeDir)
  const { runtime, stdout, stderr } = createRuntime(homeDir)

  const exitCode = await runCli(['doctor'], runtime)

  expect(exitCode).toBe(1)
  expect(stdout).toEqual([])
  expect(stderr.join('\n')).toContain('llm-iwiki is not initialized. Run: llm-iwiki init')
  expect(existsSync(paths.configFile)).toBe(false)
  expect(existsSync(paths.databaseFile)).toBe(false)
})

test('init creates config and database', async () => {
  const homeDir = join(tmpRoot, 'init-home')
  const paths = getAppPaths(homeDir)
  const { runtime, stderr } = createRuntime(homeDir)

  const exitCode = await runCli(['init'], runtime)

  expect(exitCode).toBe(0)
  expect(stderr).toEqual([])
  expect(readFileSync(paths.configFile, 'utf8')).toBe('obsidian_vault = ""\n')
  expect(existsSync(paths.databaseFile)).toBe(true)
})

test('init is idempotent and does not overwrite existing config', async () => {
  const homeDir = join(tmpRoot, 'idempotent-home')
  const paths = getAppPaths(homeDir)
  const { runtime } = createRuntime(homeDir)

  await runCli(['init'], runtime)
  writeFileSync(paths.configFile, 'obsidian_vault = "/Users/steve/Vault"\n')

  const exitCode = await runCli(['init'], runtime)

  expect(exitCode).toBe(0)
  expect(readFileSync(paths.configFile, 'utf8')).toBe('obsidian_vault = "/Users/steve/Vault"\n')
  expect(existsSync(paths.databaseFile)).toBe(true)
})

test('doctor succeeds after init', async () => {
  const homeDir = join(tmpRoot, 'doctor-home')
  const paths = getAppPaths(homeDir)
  const initRuntime = createRuntime(homeDir)
  const doctorRuntime = createRuntime(homeDir)

  await runCli(['init'], initRuntime.runtime)
  const exitCode = await runCli(['doctor'], doctorRuntime.runtime)

  expect(exitCode).toBe(0)
  expect(doctorRuntime.stderr).toEqual([])
  expect(doctorRuntime.stdout).toContain(`config: ${paths.configFile}`)
  expect(doctorRuntime.stdout).toContain(`database: ${paths.databaseFile}`)
  expect(doctorRuntime.stdout).toContain('status: ok')
})

test('projects resolve and rename preserve display name for path identity', async () => {
  const homeDir = join(tmpRoot, 'projects-home')
  const projectDir = join(tmpRoot, 'checkout-without-remote')
  mkdirSync(projectDir, { recursive: true })
  const runtime = createRuntime(homeDir, projectDir)

  await runCli(['init'], runtime.runtime)

  const resolveExitCode = await runCli(['projects', 'resolve', '.'], runtime.runtime)
  const resolved = JSON.parse(runtime.stdout.at(-1) ?? '{}') as {
    id: string
    canonicalName: string
    displayName: string | null
    identitySource: string
  }

  expect(resolveExitCode).toBe(0)
  expect(runtime.stderr).toEqual([])
  expect(resolved.id).toStartWith('proj_')
  expect(resolved.canonicalName).toBe('checkout-without-remote')
  expect(resolved.displayName).toBeNull()
  expect(resolved.identitySource).toBe('path')

  const renameExitCode = await runCli(['projects', 'rename', '.', 'XunJi Knowledge Base'], runtime.runtime)
  const renamed = JSON.parse(runtime.stdout.at(-1) ?? '{}') as { id: string; displayName: string | null }

  expect(renameExitCode).toBe(0)
  expect(renamed.id).toBe(resolved.id)
  expect(renamed.displayName).toBe('XunJi Knowledge Base')

  const repeatedResolveExitCode = await runCli(['projects', 'resolve', '.'], runtime.runtime)
  const repeatedResolve = JSON.parse(runtime.stdout.at(-1) ?? '{}') as { id: string; displayName: string | null }

  expect(repeatedResolveExitCode).toBe(0)
  expect(repeatedResolve.id).toBe(resolved.id)
  expect(repeatedResolve.displayName).toBe('XunJi Knowledge Base')
})

test('projects resolve and rename relative paths against runtime cwd', async () => {
  const homeDir = join(tmpRoot, 'relative-path-home')
  const checkoutRoot = join(tmpRoot, 'relative-checkout')
  const childDir = join(checkoutRoot, 'child')
  mkdirSync(childDir, { recursive: true })
  const runtime = createRuntime(homeDir, checkoutRoot)

  await runCli(['init'], runtime.runtime)

  const resolveExitCode = await runCli(['projects', 'resolve', 'child'], runtime.runtime)
  const resolved = JSON.parse(runtime.stdout.at(-1) ?? '{}') as {
    id: string
    canonicalName: string
    displayName: string | null
  }

  expect(resolveExitCode).toBe(0)
  expect(runtime.stderr).toEqual([])
  expect(resolved.canonicalName).toBe('child')
  expect(resolved.displayName).toBeNull()

  const renameExitCode = await runCli(['projects', 'rename', 'child', 'Child Project'], runtime.runtime)
  const renamed = JSON.parse(runtime.stdout.at(-1) ?? '{}') as { id: string; displayName: string | null }

  expect(renameExitCode).toBe(0)
  expect(renamed.id).toBe(resolved.id)
  expect(renamed.displayName).toBe('Child Project')
})

test('projects resolve fails for nonexistent path without inserting a project', async () => {
  const homeDir = join(tmpRoot, 'missing-path-home')
  const missingPath = join(tmpRoot, 'does-not-exist')
  const paths = getAppPaths(homeDir)
  const runtime = createRuntime(homeDir)

  await runCli(['init'], runtime.runtime)

  const exitCode = await runCli(['projects', 'resolve', missingPath], runtime.runtime)

  expect(exitCode).toBe(1)
  expect(runtime.stdout.at(-1)).not.toStartWith('{')
  expect(runtime.stderr).toEqual([`Path does not exist: ${missingPath}`])
  expect(getProjectCount(paths.databaseFile)).toBe(0)
})

test('projects rename reports missing project as a concise cli error', async () => {
  const homeDir = join(tmpRoot, 'missing-project-home')
  const runtime = createRuntime(homeDir)

  await runCli(['init'], runtime.runtime)

  const exitCode = await runCli(['projects', 'rename', 'proj_missing', 'Name'], runtime.runtime)

  expect(exitCode).toBe(1)
  expect(runtime.stdout.at(-1)).not.toStartWith('{')
  expect(runtime.stderr).toEqual(['Project not found: proj_missing'])
})

test('summarize apply validates a summaries yaml file', async () => {
  const homeDir = join(tmpRoot, 'summaries-home')
  const fixtureDir = join(tmpRoot, 'fixtures')
  const summariesFile = join(fixtureDir, 'summaries.yaml')
  mkdirSync(fixtureDir, { recursive: true })
  writeFileSync(
    summariesFile,
    `
project_id: proj_123
summaries:
  - session_id: ses_1
    title: 解析 Cursor 会话
    value: high
    summary_markdown: ok
`,
  )
  const { runtime, stdout, stderr } = createRuntime(homeDir)

  const exitCode = await runCli(['summarize', 'apply', '--project', '/tmp/project', '--file', summariesFile], runtime)

  expect(exitCode).toBe(0)
  expect(stdout).toEqual(['validated summaries: 1'])
  expect(stderr).toEqual([])
})

test('summarize apply reports concise validation errors', async () => {
  const homeDir = join(tmpRoot, 'invalid-summaries-home')
  const fixtureDir = join(tmpRoot, 'fixtures')
  const summariesFile = join(fixtureDir, 'summaries.yaml')
  mkdirSync(fixtureDir, { recursive: true })
  writeFileSync(
    summariesFile,
    `
project_id: proj_123
summaries:
  - session_id: ses_1
    title: bad
    value: important
    summary_markdown: bad
`,
  )
  const { runtime, stdout, stderr } = createRuntime(homeDir)

  const exitCode = await runCli(['summarize', 'apply', '--file', summariesFile], runtime)

  expect(exitCode).toBe(1)
  expect(stdout).toEqual([])
  expect(stderr).toEqual(['Invalid summary value: important'])
})

test('summarize apply reports usage when file flag is missing', async () => {
  const homeDir = join(tmpRoot, 'missing-file-home')
  const { runtime, stdout, stderr } = createRuntime(homeDir)

  const exitCode = await runCli(['summarize', 'apply', '--project', '/tmp/project'], runtime)

  expect(exitCode).toBe(1)
  expect(stdout).toEqual([])
  expect(stderr).toEqual(['Usage: llm-iwiki summarize apply --project <path> --file <summaries.yaml>'])
})

test('experiences propose validates an experiences yaml file', async () => {
  const homeDir = join(tmpRoot, 'experiences-home')
  const fixtureDir = join(tmpRoot, 'fixtures')
  const experiencesFile = join(fixtureDir, 'experiences.yaml')
  mkdirSync(fixtureDir, { recursive: true })
  writeFileSync(
    experiencesFile,
    `
project_id: proj_123
experiences:
  - title: Cursor SQLite + Lexical
    summary: ok
    body_markdown: ok
    source_sessions:
      - ses_1
`,
  )
  const { runtime, stdout, stderr } = createRuntime(homeDir)

  const exitCode = await runCli(['experiences', 'propose', '--project', '/tmp/project', '--file', experiencesFile], runtime)

  expect(exitCode).toBe(0)
  expect(stdout).toEqual(['validated experiences: 1'])
  expect(stderr).toEqual([])
})
