import type { ParsedSummariesYaml } from './types'
import type { LlmIwikiDatabase } from './db'
import { stableHash } from './hash'
import { compactTranscript } from './compaction'
import { getSessionMessages, listSessionsToSummarize } from './sessions'

export interface PrepareSummariesResult {
  markdown: string
  sessionCount: number
}

const SUMMARIES_FORMAT = `## 输出格式（务必遵守）

本文件（\`summaries-task.md\`）是任务说明，请勿修改它。
请**另外新建**一个纯 YAML 文件 \`.llm-iwiki/tasks/summaries.yaml\`，然后运行：
\`llm-iwiki summarize apply --project . --file .llm-iwiki/tasks/summaries.yaml\`

输出文件规则：
- 只能是 YAML 内容，不要写 Markdown 标题或说明文字，也不要用 \`\`\` 代码围栏把它包起来。
- 不要保留 \`<...>\` 占位符，全部替换成真实内容。
- \`value\` 只能取 none / low / medium / high 其中之一（不要照抄“none | low | medium | high”整行）；medium / high 才会进入经验提取。
- \`session_id\` 必须与下方各会话块标题里的 id 完全一致。
- 没价值的会话直接省略，不必每个都写。

按下面结构填真实内容（# 后是说明，可删）：

\`\`\`yaml
project_id: proj_xxxxxxxx          # 用本文件顶部的 project_id
summaries:
  - session_id: cc_xxxxxxxx        # 与下方会话块标题里的 id 完全一致
    title: 一句话标题
    value: high
    summary_markdown: |
      ## 问题
      这次会话要解决什么。
      ## 关键决策
      做了哪些选择、为什么。
      ## 结论
      最终结果与后续动作。
\`\`\``

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
