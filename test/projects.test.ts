import { expect, test } from 'bun:test'

import { canonicalizeRemoteUrl, slugifyProjectName } from '../src/projects'

test('canonicalizeRemoteUrl normalizes git remotes', () => {
  expect(canonicalizeRemoteUrl('git@github.com:CodeHourra/xunji.git')).toBe('github.com/CodeHourra/xunji')
  expect(canonicalizeRemoteUrl('https://github.com/CodeHourra/xunji.git')).toBe('github.com/CodeHourra/xunji')
})

test('slugifyProjectName keeps readable ascii names stable', () => {
  expect(slugifyProjectName('github.com/CodeHourra/xunji')).toBe('github-com-codehourra-xunji')
  expect(slugifyProjectName('寻迹 XunJi')).toBe('xunji')
})
