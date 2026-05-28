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

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required string: ${key}`)
  }
  return value
}

export function parseSummariesYaml(source: string): ParsedSummariesYaml {
  const root = asRecord(parse(source), 'summaries.yaml')
  const projectId = requiredString(root, 'project_id')
  if (!Array.isArray(root.summaries)) throw new Error('summaries must be an array')

  return {
    projectId,
    summaries: root.summaries.map((item, index) => {
      const record = asRecord(item, `summaries[${index}]`)
      const value = requiredString(record, 'value')
      if (!SUMMARY_VALUES.has(value as SummaryValue)) throw new Error(`Invalid summary value: ${value}`)
      return {
        sessionId: requiredString(record, 'session_id'),
        title: requiredString(record, 'title'),
        value: value as SummaryValue,
        summaryMarkdown: requiredString(record, 'summary_markdown'),
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
      const record = asRecord(item, `experiences[${index}]`)
      const sourceSessions = record.source_sessions
      if (!Array.isArray(sourceSessions) || sourceSessions.some((value) => typeof value !== 'string')) {
        throw new Error(`experiences[${index}].source_sessions must be a string array`)
      }
      const confidence = typeof record.confidence === 'string' ? record.confidence : null
      if (confidence && !CONFIDENCE_VALUES.has(confidence as Confidence)) {
        throw new Error(`Invalid confidence: ${confidence}`)
      }
      return {
        title: requiredString(record, 'title'),
        slug: typeof record.slug === 'string' ? record.slug : null,
        summary: requiredString(record, 'summary'),
        bodyMarkdown: requiredString(record, 'body_markdown'),
        sourceSessions,
        confidence: confidence as Confidence | null,
        metadata: record,
      }
    }),
  }
}
