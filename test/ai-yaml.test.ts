import { expect, test } from 'bun:test'

import { parseExperiencesYaml, parseSummariesYaml } from '../src/ai-yaml'

test('parseSummariesYaml accepts required fields', () => {
  const result = parseSummariesYaml(`
project_id: proj_123
summaries:
  - session_id: ses_1
    title: 解析 Cursor 会话
    value: high
    summary_markdown: |
      本次会话定位了 Cursor SQLite 解析问题。
`)

  expect(result.projectId).toBe('proj_123')
  expect(result.summaries[0].value).toBe('high')
})

test('parseSummariesYaml rejects invalid value', () => {
  expect(() =>
    parseSummariesYaml(`
project_id: proj_123
summaries:
  - session_id: ses_1
    title: bad
    value: important
    summary_markdown: bad
`),
  ).toThrow('Invalid summary value')
})

test('parseExperiencesYaml accepts required fields', () => {
  const result = parseExperiencesYaml(`
project_id: proj_123
experiences:
  - title: Cursor SQLite + Lexical
    summary: |
      Cursor 正文在 Lexical 中。
    body_markdown: |
      ## 背景
      需要递归解析。
    source_sessions:
      - ses_1
`)

  expect(result.experiences[0].sourceSessions).toEqual(['ses_1'])
})
