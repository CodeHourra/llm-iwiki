import { expect, test } from 'bun:test'

import { runCli } from '../src/cli'

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
