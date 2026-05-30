import { parse } from 'yaml'

import type { Confidence, ParsedExperiencesYaml, ParsedSummariesYaml, SummaryValue } from './types'

const SUMMARY_VALUES = new Set<SummaryValue>(['none', 'low', 'medium', 'high'])
const CONFIDENCE_VALUES = new Set<Confidence>(['low', 'medium', 'high'])

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

// 仅匹配明显的模板占位符：含空格/中文/省略号的尖括号、模板示例 id、占位说明，
// 避免误伤正文里的 Array<string> / <div> 等真实代码。
const PLACEHOLDER_PATTERN = /<[^>\n]*[\s\u4e00-\u9fff…][^>\n]*>|（空）|\(空\)|占位符|proj_xxxx|cc_xxxxxxxx/

function assertNoPlaceholder(value: string, label: string): void {
  if (PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`${label} still contains a placeholder; replace it with real content`)
  }
}

function requiredString(record: Record<string, unknown>, key: string, label = key): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required string: ${label}`)
  }
  assertNoPlaceholder(value, label)
  return value
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') return null
  return value
}

function optionalStringArray(record: Record<string, unknown>, key: string, label: string): string[] {
  const value = record[key]
  if (value == null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be a string array`)
  }
  return value as string[]
}

function optionalConfidence(record: Record<string, unknown>): Confidence | null {
  if (!('confidence' in record)) return null
  const confidence = record.confidence
  if (typeof confidence !== 'string' || !CONFIDENCE_VALUES.has(confidence as Confidence)) {
    throw new Error(`Invalid confidence: ${String(confidence)}`)
  }
  return confidence as Confidence
}

export function parseSummariesYaml(source: string): ParsedSummariesYaml {
  const root = asRecord(parse(source), 'summaries.yaml')
  const projectId = requiredString(root, 'project_id')
  if (!Array.isArray(root.summaries)) throw new Error('summaries must be an array')

  return {
    projectId,
    summaries: root.summaries.map((item, index) => {
      const itemLabel = `summaries[${index}]`
      const record = asRecord(item, `summaries[${index}]`)
      const value = requiredString(record, 'value', `${itemLabel}.value`)
      if (!SUMMARY_VALUES.has(value as SummaryValue)) throw new Error(`Invalid summary value: ${value}`)
      optionalConfidence(record)
      return {
        sessionId: requiredString(record, 'session_id', `${itemLabel}.session_id`),
        title: requiredString(record, 'title', `${itemLabel}.title`),
        value: value as SummaryValue,
        summaryMarkdown: requiredString(record, 'summary_markdown', `${itemLabel}.summary_markdown`),
        metadata: record,
      }
    }),
  }
}

export function parseExperiencesYaml(source: string): ParsedExperiencesYaml {
  const root = asRecord(parse(source), 'experiences.yaml')
  const projectId = requiredString(root, 'project_id')
  if (!Array.isArray(root.experiences)) throw new Error('experiences must be an array')

  return {
    projectId,
    experiences: root.experiences.map((item, index) => {
      const itemLabel = `experiences[${index}]`
      const record = asRecord(item, itemLabel)
      const sourceSessions = record.source_sessions
      if (!Array.isArray(sourceSessions) || sourceSessions.some((value) => typeof value !== 'string')) {
        throw new Error(`experiences[${index}].source_sessions must be a string array`)
      }
      const confidence = optionalConfidence(record)
      return {
        title: requiredString(record, 'title', `${itemLabel}.title`),
        slug: typeof record.slug === 'string' ? record.slug : null,
        summary: requiredString(record, 'summary', `${itemLabel}.summary`),
        bodyMarkdown: requiredString(record, 'body_markdown', `${itemLabel}.body_markdown`),
        sourceSessions,
        confidence: confidence as Confidence | null,
        topic: optionalString(record, 'topic'),
        techStack: optionalStringArray(record, 'tech_stack', `${itemLabel}.tech_stack`),
        problemType: optionalString(record, 'problem_type'),
        metadata: record,
      }
    }),
  }
}
