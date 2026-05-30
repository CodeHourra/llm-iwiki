import type { LlmIwikiDatabase } from './db'

export type SearchKind = 'sessions' | 'experiences'

export interface SearchHit {
  id: string
  title: string
  snippet: string
  projectId: string | null
}

function makeSnippet(text: string, query: string, width = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const idx = flat.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return flat.slice(0, width)
  const start = Math.max(0, idx - width / 4)
  const slice = flat.slice(start, start + width)
  return `${start > 0 ? '…' : ''}${slice}${start + width < flat.length ? '…' : ''}`
}

/**
 * 子串检索（对中文等无空格语言更可靠，不依赖 FTS5 分词器）。
 */
export function search(
  db: LlmIwikiDatabase,
  kind: SearchKind,
  query: string,
  projectId: string | null,
  limit = 20,
): SearchHit[] {
  const like = `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`

  if (kind === 'experiences') {
    const rows = db
      .query<
        { id: string; title: string; summary: string | null; body_markdown: string; project_id: string | null },
        [string, string, string]
      >(`
        SELECT id, title, summary, body_markdown, project_id
        FROM experiences
        WHERE status = 'accepted'
          AND (title LIKE ? ESCAPE '\\' OR COALESCE(summary, '') LIKE ? ESCAPE '\\' OR body_markdown LIKE ? ESCAPE '\\')
        ORDER BY updated_at DESC
      `)
      .all(like, like, like)
    return rows
      .filter((row) => !projectId || row.project_id === projectId)
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        title: row.title,
        snippet: makeSnippet(row.summary ?? row.body_markdown, query),
        projectId: row.project_id,
      }))
  }

  const rows = db
    .query<
      { id: string; title: string; summary_markdown: string; project_id: string | null },
      [string, string]
    >(`
      SELECT id, title, summary_markdown, project_id
      FROM session_summaries
      WHERE title LIKE ? ESCAPE '\\' OR summary_markdown LIKE ? ESCAPE '\\'
      ORDER BY updated_at DESC
    `)
    .all(like, like)
  return rows
    .filter((row) => !projectId || row.project_id === projectId)
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      title: row.title,
      snippet: makeSnippet(row.summary_markdown, query),
      projectId: row.project_id,
    }))
}
