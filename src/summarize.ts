import type { ParsedSummariesYaml } from './types'
import type { LlmIwikiDatabase } from './db'
import { stableHash } from './hash'
import { compactTranscript } from './compaction'
import { getSessionMessages, listSessionsToSummarize } from './sessions'

export interface PrepareSummariesResult {
  markdown: string
  sessionCount: number
}

const SUMMARIES_FORMAT = `## 输出格式

请阅读下面每个会话的压缩记录，为有价值的会话生成一份 \`summaries.yaml\`，写入
\`.llm-iwiki/tasks/summaries.yaml\`，再运行 \`llm-iwiki summarize apply\`。

\`\`\`yaml
project_id: <见下方 project_id>
summaries:
  - session_id: <会话的 session_id，原样照抄>
    title: <一句话标题>
    value: none | low | medium | high
    summary_markdown: |
      用 Markdown 概括这次会话解决了什么问题、关键决策、结论。
\`\`\`

要求：
- \`value\` 表示这次会话的沉淀价值，\`medium\` / \`high\` 会进入经验提取。
- \`session_id\` 必须与下面给出的完全一致。
- 没有价值的会话可以省略，不必每个都写。`

export function prepareSummariesTask(
  db: LlmIwikiDatabase,
  projectId: string,
  scope: 'changed' | 'all',
): PrepareSummariesResult {
  const sessions = listSessionsToSummarize(db, projectId, scope)

  const blocks: string[] = []
  for (const session of sessions) {
    const messages = getSessionMessages(db, session.id)
    if (messages.length === 0) continue
    const transcript = compactTranscript(messages)
    blocks.push(
      [
        `### ${session.id}`,
        `- source: ${session.sourceId}`,
        `- title: ${session.title ?? '(无标题)'}`,
        `- messages: ${session.messageCount}`,
        '',
        transcript,
      ].join('\n'),
    )
  }

  const markdown = [
    `# Summaries Task`,
    '',
    `project_id: ${projectId}`,
    `scope: ${scope}`,
    `sessions: ${blocks.length}`,
    '',
    SUMMARIES_FORMAT,
    '',
    '---',
    '',
    blocks.join('\n\n---\n\n'),
    '',
  ].join('\n')

  return { markdown, sessionCount: blocks.length }
}

export interface ApplySummariesResult {
  written: number
  skipped: string[]
}

function hash(value: string): string {
  return stableHash(value)
}

export function applySummaries(db: LlmIwikiDatabase, parsed: ParsedSummariesYaml): ApplySummariesResult {
  const now = new Date().toISOString()
  let written = 0
  const skipped: string[] = []

  const apply = db.transaction(() => {
    for (const summary of parsed.summaries) {
      const session = db
        .query<{ project_id: string | null }, [string]>('SELECT project_id FROM sessions WHERE id = ?')
        .get(summary.sessionId)
      if (!session) {
        skipped.push(summary.sessionId)
        continue
      }

      db.query(`
        INSERT INTO session_summaries (id, session_id, project_id, title, value, summary_markdown, metadata_json, created_at, updated_at)
        VALUES ($id, $sessionId, $projectId, $title, $value, $summaryMarkdown, $metadata, $now, $now)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          value = excluded.value,
          summary_markdown = excluded.summary_markdown,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run({
        $id: `sum_${hash(summary.sessionId)}`,
        $sessionId: summary.sessionId,
        $projectId: session.project_id ?? parsed.projectId,
        $title: summary.title,
        $value: summary.value,
        $summaryMarkdown: summary.summaryMarkdown,
        $metadata: JSON.stringify(summary.metadata),
        $now: now,
      })
      written += 1
    }
  })
  apply()

  return { written, skipped }
}
