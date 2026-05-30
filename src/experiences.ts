import type { ParsedExperiencesYaml } from './types'
import type { LlmIwikiDatabase } from './db'
import { stableHash } from './hash'
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

const EXPERIENCES_FORMAT = `## 输出格式（务必遵守）

本文件（\`experiences-task.md\`）是任务说明，请勿修改它。
请**另外新建**一个纯 YAML 文件 \`.llm-iwiki/exchange/experiences.yaml\`，然后运行：
\`llm-iwiki experiences propose --project . --file .llm-iwiki/exchange/experiences.yaml\`

输出文件规则：
- 只能是 YAML 内容，不要写 Markdown 标题或说明文字，也不要用 \`\`\` 代码围栏把它包起来。
- 必须基于下方摘要的真实内容归纳，禁止编造；信息不足时宁可少写。
- 不要保留 \`<...>\` 占位符，全部替换成真实内容。
- 一条经验可以聚合多个会话，按主题归纳，不要逐会话复述。
- \`source_sessions\` 必须是字符串数组，填该经验来自哪些 session_id（与下方摘要块标题里的 id 一致）。
- \`confidence\` 可选，只能取 low / medium / high 其中之一。
- \`topic\` 可选，用于跨项目主题归类（如 ai-coding / backend / frontend / devops）。
- \`tech_stack\` 可选，字符串数组，列出涉及的技术栈（如 [go, kratos, sqlite]）。
- \`problem_type\` 可选，一句话问题类型（如 性能优化 / 登录态 / 构建）。

按下面结构填真实内容（# 后是说明，可删）：

\`\`\`yaml
project_id: proj_xxxxxxxx          # 用本文件顶部的 project_id
experiences:
  - title: 经验标题
    slug: stable-short-id          # 可选，省略即可
    summary: |
      一句话说明这条经验。
    body_markdown: |
      ## 背景
      ## 方案
      ## 结论
    source_sessions:
      - cc_xxxxxxxx
    confidence: medium
    topic: backend                 # 可选，跨项目主题
    tech_stack: [go, kratos]       # 可选
    problem_type: 登录态           # 可选
\`\`\``

function fetchSummaries(
  db: LlmIwikiDatabase,
  projectId: string,
  scope: ExperienceScope,
  since: string | null,
): SummaryRow[] {
  const valueClause = scope === 'changed-summaries' ? "AND value IN ('medium', 'high')" : ''
  const sinceClause = since ? 'AND updated_at >= ?' : ''
  const params: string[] = since ? [projectId, since] : [projectId]
  return db
    .query<SummaryRow, string[]>(`
      SELECT session_id, title, value, summary_markdown
      FROM session_summaries
      WHERE project_id = ? ${valueClause} ${sinceClause}
      ORDER BY updated_at DESC
    `)
    .all(...params)
}

export function prepareExperiencesTask(
  db: LlmIwikiDatabase,
  projectId: string,
  scope: ExperienceScope,
  since: string | null = null,
): PrepareExperiencesResult {
  const summaries = fetchSummaries(db, projectId, scope, since)

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
  return stableHash(value)
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
          id, project_id, proposed_title, proposed_slug, proposed_summary, proposed_body_markdown,
          source_sessions_json, confidence, tech_stack_json, problem_type, topic, status, created_at
        ) VALUES (
          $id, $projectId, $title, $slug, $summary, $body,
          $sources, $confidence, $techStack, $problemType, $topic, 'proposed', $now
        )
        ON CONFLICT(id) DO UPDATE SET
          proposed_title = excluded.proposed_title,
          proposed_summary = excluded.proposed_summary,
          proposed_body_markdown = excluded.proposed_body_markdown,
          source_sessions_json = excluded.source_sessions_json,
          confidence = excluded.confidence,
          tech_stack_json = excluded.tech_stack_json,
          problem_type = excluded.problem_type,
          topic = excluded.topic
      `).run({
        $id: id,
        $projectId: parsed.projectId,
        $title: experience.title,
        $slug: slug,
        $summary: experience.summary,
        $body: experience.bodyMarkdown,
        $sources: JSON.stringify(experience.sourceSessions),
        $confidence: experience.confidence,
        $techStack: experience.techStack.length > 0 ? JSON.stringify(experience.techStack) : null,
        $problemType: experience.problemType,
        $topic: experience.topic,
        $now: now,
      })
      written += 1
    }
  })
  propose()

  return { written }
}

export interface CandidateRow {
  id: string
  project_id: string
  proposed_title: string
  proposed_slug: string
  confidence: string | null
  status: string
  source_sessions_json: string
  created_at: string
}

export function listCandidates(db: LlmIwikiDatabase, projectId: string | null): CandidateRow[] {
  if (projectId) {
    return db
      .query<CandidateRow, [string]>(
        'SELECT id, project_id, proposed_title, proposed_slug, confidence, status, source_sessions_json, created_at FROM experience_candidates WHERE project_id = ? ORDER BY created_at DESC',
      )
      .all(projectId)
  }
  return db
    .query<CandidateRow, []>(
      'SELECT id, project_id, proposed_title, proposed_slug, confidence, status, source_sessions_json, created_at FROM experience_candidates ORDER BY created_at DESC',
    )
    .all()
}

export interface AcceptExperienceResult {
  experienceId: string
  slug: string
  linkedSessions: number
}

export function acceptExperience(db: LlmIwikiDatabase, candidateId: string): AcceptExperienceResult {
  const candidate = db
    .query<
      {
        project_id: string
        proposed_title: string
        proposed_slug: string
        proposed_summary: string | null
        proposed_body_markdown: string
        confidence: string | null
        tech_stack_json: string | null
        problem_type: string | null
        topic: string | null
        source_sessions_json: string
      },
      [string]
    >(
      'SELECT project_id, proposed_title, proposed_slug, proposed_summary, proposed_body_markdown, confidence, tech_stack_json, problem_type, topic, source_sessions_json FROM experience_candidates WHERE id = ?',
    )
    .get(candidateId)

  if (!candidate) throw new Error(`Experience candidate not found: ${candidateId}`)

  let sourceSessions: string[] = []
  try {
    const parsed = JSON.parse(candidate.source_sessions_json) as unknown
    if (Array.isArray(parsed)) sourceSessions = parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    sourceSessions = []
  }

  const now = new Date().toISOString()
  const experienceId = `exp_${hash(`${candidate.project_id}\u0000${candidate.proposed_slug}`)}`

  const accept = db.transaction(() => {
    db.query(`
      INSERT INTO experiences (
        id, project_id, title, slug, summary, body_markdown, confidence, tech_stack_json, problem_type, topic, status, created_at, updated_at
      ) VALUES ($id, $projectId, $title, $slug, $summary, $body, $confidence, $techStack, $problemType, $topic, 'accepted', $now, $now)
      ON CONFLICT(project_id, slug) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        body_markdown = excluded.body_markdown,
        confidence = excluded.confidence,
        tech_stack_json = excluded.tech_stack_json,
        problem_type = excluded.problem_type,
        topic = excluded.topic,
        status = 'accepted',
        updated_at = excluded.updated_at
    `).run({
      $id: experienceId,
      $projectId: candidate.project_id,
      $title: candidate.proposed_title,
      $slug: candidate.proposed_slug,
      $summary: candidate.proposed_summary,
      $body: candidate.proposed_body_markdown,
      $confidence: candidate.confidence,
      $techStack: candidate.tech_stack_json,
      $problemType: candidate.problem_type,
      $topic: candidate.topic,
      $now: now,
    })

    const resolved = db
      .query<{ id: string }, [string, string]>('SELECT id FROM experiences WHERE project_id = ? AND slug = ?')
      .get(candidate.project_id, candidate.proposed_slug)
    const finalId = resolved?.id ?? experienceId

    for (const sessionId of sourceSessions) {
      db.query(`
        INSERT INTO session_experience_links (session_id, experience_id, relation)
        VALUES (?, ?, 'source')
        ON CONFLICT(session_id, experience_id) DO NOTHING
      `).run(sessionId, finalId)
    }

    db.query("UPDATE experience_candidates SET status = 'accepted' WHERE id = ?").run(candidateId)
  })
  accept()

  return { experienceId, slug: candidate.proposed_slug, linkedSessions: sourceSessions.length }
}

export function rejectExperience(db: LlmIwikiDatabase, candidateId: string): void {
  const changes = db.query("UPDATE experience_candidates SET status = 'rejected' WHERE id = ?").run(candidateId)
  if (changes.changes === 0) throw new Error(`Experience candidate not found: ${candidateId}`)
}
