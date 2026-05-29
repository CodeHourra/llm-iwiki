import type { ParsedExperiencesYaml } from './types'
import type { LlmIwikiDatabase } from './db'
import { slugifyProjectName } from './projects'

export type ExperienceScope = 'changed-summaries' | 'all-recent'

export interface PrepareExperiencesResult {
  markdown: string
  summaryCount: number
}

interface SummaryRow {
  session_id: string
  title: string
  value: string
  summary_markdown: string
}

const EXPERIENCES_FORMAT = `## 输出格式

基于下面这些会话摘要，提炼出可复用的项目经验，生成 \`experiences.yaml\` 写入
\`.llm-iwiki/tasks/experiences.yaml\`，再运行 \`llm-iwiki experiences propose\`。

\`\`\`yaml
project_id: <见下方 project_id>
experiences:
  - title: <经验标题>
    slug: <可选，稳定短标识>
    summary: |
      一句话说明这条经验。
    body_markdown: |
      ## 背景
      ## 方案
      ## 结论
    source_sessions:
      - <相关 session_id>
    confidence: low | medium | high
\`\`\`

要求：
- 一条经验可以聚合多个会话，按主题归纳，不要逐会话复述。
- \`source_sessions\` 填写该经验来自哪些 session_id。`

function fetchSummaries(db: LlmIwikiDatabase, projectId: string, scope: ExperienceScope): SummaryRow[] {
  const valueClause = scope === 'changed-summaries' ? "AND value IN ('medium', 'high')" : ''
  return db
    .query<SummaryRow, [string]>(`
      SELECT session_id, title, value, summary_markdown
      FROM session_summaries
      WHERE project_id = ? ${valueClause}
      ORDER BY updated_at DESC
    `)
    .all(projectId)
}

export function prepareExperiencesTask(
  db: LlmIwikiDatabase,
  projectId: string,
  scope: ExperienceScope,
): PrepareExperiencesResult {
  const summaries = fetchSummaries(db, projectId, scope)

  const blocks = summaries.map((summary) =>
    [`### ${summary.session_id} — ${summary.title}`, `- value: ${summary.value}`, '', summary.summary_markdown].join('\n'),
  )

  const markdown = [
    `# Experiences Task`,
    '',
    `project_id: ${projectId}`,
    `scope: ${scope}`,
    `summaries: ${blocks.length}`,
    '',
    EXPERIENCES_FORMAT,
    '',
    '---',
    '',
    blocks.join('\n\n---\n\n'),
    '',
  ].join('\n')

  return { markdown, summaryCount: blocks.length }
}

export interface ProposeExperiencesResult {
  written: number
}

function hash(value: string): string {
  return Bun.hash(value).toString(16)
}

export function proposeExperiences(db: LlmIwikiDatabase, parsed: ParsedExperiencesYaml): ProposeExperiencesResult {
  const now = new Date().toISOString()
  let written = 0

  const propose = db.transaction(() => {
    for (const experience of parsed.experiences) {
      const slug = experience.slug && experience.slug.trim() !== '' ? experience.slug : slugifyProjectName(experience.title)
      const id = `cand_${hash(`${parsed.projectId}\u0000${slug}`)}`

      db.query(`
        INSERT INTO experience_candidates (
          id, project_id, proposed_title, proposed_slug, proposed_body_markdown, source_sessions_json, confidence, status, created_at
        ) VALUES ($id, $projectId, $title, $slug, $body, $sources, $confidence, 'proposed', $now)
        ON CONFLICT(id) DO UPDATE SET
          proposed_title = excluded.proposed_title,
          proposed_body_markdown = excluded.proposed_body_markdown,
          source_sessions_json = excluded.source_sessions_json,
          confidence = excluded.confidence
      `).run({
        $id: id,
        $projectId: parsed.projectId,
        $title: experience.title,
        $slug: slug,
        $body: experience.bodyMarkdown,
        $sources: JSON.stringify(experience.sourceSessions),
        $confidence: experience.confidence,
        $now: now,
      })
      written += 1
    }
  })
  propose()

  return { written }
}
