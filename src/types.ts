export type SummaryValue = 'none' | 'low' | 'medium' | 'high'
export type Confidence = 'low' | 'medium' | 'high'

export interface ParsedSummariesYaml {
  projectId: string
  summaries: Array<{
    sessionId: string
    title: string
    value: SummaryValue
    summaryMarkdown: string
    metadata: Record<string, unknown>
  }>
}

export interface ParsedExperiencesYaml {
  projectId: string
  experiences: Array<{
    title: string
    slug: string | null
    summary: string
    bodyMarkdown: string
    sourceSessions: string[]
    confidence: Confidence | null
    topic: string | null
    techStack: string[]
    problemType: string | null
    metadata: Record<string, unknown>
  }>
}
