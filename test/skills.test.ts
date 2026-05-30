import { afterEach, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initSkills } from '../src/skills'

const tmpRoot = join(import.meta.dir, '.tmp-skills')
const SKILL_FILE = join(tmpRoot, '.agents/skills/aiwiki-knowledge/SKILL.md')

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

test('initSkills writes the knowledge skill', () => {
  const result = initSkills({ cwd: tmpRoot, force: false, dryRun: false, target: null })

  expect(result.written.length).toBe(1)
  expect(existsSync(SKILL_FILE)).toBe(true)
  const content = readFileSync(SKILL_FILE, 'utf8')
  expect(content).toContain('AIWiki 知识沉淀')
  expect(content).toContain('llm-iwiki summarize apply')
})

test('initSkills with target adds target guidance', () => {
  initSkills({ cwd: tmpRoot, force: false, dryRun: false, target: 'codex' })
  const content = readFileSync(SKILL_FILE, 'utf8')
  expect(content).toContain('Codex')
})

test('initSkills without force skips existing skills without overwriting', () => {
  initSkills({ cwd: tmpRoot, force: false, dryRun: false, target: null })
  writeFileSync(SKILL_FILE, 'custom content')
  const result = initSkills({ cwd: tmpRoot, force: false, dryRun: false, target: null })

  expect(result.written.length).toBe(0)
  expect(result.skipped.length).toBe(1)
  expect(readFileSync(SKILL_FILE, 'utf8')).toBe('custom content')
})

test('initSkills with force overwrites existing skills', () => {
  initSkills({ cwd: tmpRoot, force: false, dryRun: false, target: null })
  writeFileSync(SKILL_FILE, 'custom content')
  const result = initSkills({ cwd: tmpRoot, force: true, dryRun: false, target: null })

  expect(result.written.length).toBe(1)
  expect(result.skipped).toEqual([])
  expect(readFileSync(SKILL_FILE, 'utf8')).toContain('AIWiki 知识沉淀')
})
