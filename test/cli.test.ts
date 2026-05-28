import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { runCli } from '../src/cli'
import { getAppPaths } from '../src/paths'

const tmpRoot = join(import.meta.dir, '.tmp-cli')

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function createRuntime(homeDir: string) {
  const stdout: string[] = []
  const stderr: string[] = []

  return {
    runtime: {
      cwd: '/tmp/project',
      homeDir,
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    stdout,
    stderr,
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
