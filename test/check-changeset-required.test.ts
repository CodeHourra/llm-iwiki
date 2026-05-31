import { expect, test } from 'bun:test'

import { checkChangesetRequirement } from '../scripts/check-changeset-required'

test('requires a changeset when published package files change', () => {
  const result = checkChangesetRequirement({
    changedFiles: ['src/cli.ts', 'test/cli.test.ts'],
    prTitle: 'fix(cli): improve sync output',
    labels: [],
  })

  expect(result.ok).toBe(false)
  expect(result.message).toContain('Missing changeset')
  expect(result.message).toContain('bun run changeset')
})

test('allows package changes when a changeset is present', () => {
  const result = checkChangesetRequirement({
    changedFiles: ['src/cli.ts', '.changeset/friendly-sync.md'],
    prTitle: 'fix(cli): improve sync output',
    labels: [],
  })

  expect(result.ok).toBe(true)
})

test('allows package changes when release is explicitly skipped', () => {
  const result = checkChangesetRequirement({
    changedFiles: ['src/cli.ts'],
    prTitle: 'fix(cli): improve sync output [no-release]',
    labels: [],
  })

  expect(result.ok).toBe(true)
})

test('ignores test-only and workflow-only changes', () => {
  const result = checkChangesetRequirement({
    changedFiles: ['test/cli.test.ts', '.github/workflows/changeset-required.yml'],
    prTitle: 'chore(ci): add checks',
    labels: [],
  })

  expect(result.ok).toBe(true)
})
