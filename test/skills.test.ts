import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initSkills } from '../src/skills'

const tmpRoot = join(import.meta.dir, '.tmp-skills')

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

test('initSkills writes the three project skills', () => {
  const result = initSkills({ cwd: tmpRoot, force: false, dryRun: false, target: null })

  expect(result.written.length).toBe(3)
  expect(existsSync(join(tmpRoot, '.agents/skills/aiwiki-after-session/SKILL.md'))).toBe(true)
  expect(readFileSync(join(tmpRoot, '.agents/skills/aiwiki-before-debug/SKILL.md'), 'utf8')).toContain(
    'llm-iwiki search',
  )
})

test('initSkills with target adds target guidance', () => {
  initSkills({ cwd: tmpRoot, force: false, dryRun: false, target: 'codex' })
  const content = readFileSync(join(tmpRoot, '.agents/skills/aiwiki-after-session/SKILL.md'), 'utf8')
  expect(content).toContain('Codex')
})

test('initSkills without force skips existing skills without overwriting', () => {
  const skillFile = join(tmpRoot, '.agents/skills/aiwiki-before-debug/SKILL.md')

  initSkills({ cwd: tmpRoot, force: false, dryRun: false, target: null })
  writeFileSync(skillFile, 'custom content')
  const result = initSkills({ cwd: tmpRoot, force: false, dryRun: false, target: null })

  expect(result.written.length).toBe(0)
  expect(result.skipped.length).toBe(3)
  expect(readFileSync(skillFile, 'utf8')).toBe('custom content')
})

test('initSkills with force overwrites existing skills', () => {
  const skillFile = join(tmpRoot, '.agents/skills/aiwiki-before-debug/SKILL.md')

  initSkills({ cwd: tmpRoot, force: false, dryRun: false, target: null })
  writeFileSync(skillFile, 'custom content')
  const result = initSkills({ cwd: tmpRoot, force: true, dryRun: false, target: null })

  expect(result.written.length).toBe(3)
  expect(result.skipped).toEqual([])
  expect(readFileSync(skillFile, 'utf8')).toContain('llm-iwiki search "<error or topic>" --project . --index all')
})
