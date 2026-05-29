import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const nodeRequire = createRequire(import.meta.url)
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'

interface RawStatement {
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}

interface RawDatabase {
  prepare(sql: string): RawStatement
  exec(sql: string): void
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
  close(): void
}

interface RawDatabaseConstructor {
  new (file: string, options?: { readonly?: boolean }): RawDatabase
}

function openRaw(file: string, readonly: boolean): RawDatabase {
  const options = readonly ? { readonly: true } : undefined
  if (isBun) {
    // bun:sqlite is only resolvable under the Bun runtime; load via a dynamic
    // specifier so node bundlers do not try to resolve it.
    const specifier = 'bun:sqlite'
    const { Database } = nodeRequire(specifier) as { Database: RawDatabaseConstructor }
    return new Database(file, options)
  }
  const BetterSqlite = nodeRequire('better-sqlite3') as RawDatabaseConstructor
  return new BetterSqlite(file, options)
}

function isNamedParams(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
}

function normalizeParams(params: unknown[]): unknown[] {
  if (params.length !== 1 || !isNamedParams(params[0])) return params
  // bun:sqlite expects object keys with the `$`/`@`/`:` prefix; better-sqlite3
  // expects the bare name. SQL placeholders use `$name` for both.
  if (isBun) return params
  const stripped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params[0])) {
    stripped[key.replace(/^[$@:]/, '')] = value
  }
  return [stripped]
}

class Query<Row> {
  constructor(private readonly statement: RawStatement) {}

  get(...params: unknown[]): Row | null {
    return (this.statement.get(...normalizeParams(params)) ?? null) as Row | null
  }

  all(...params: unknown[]): Row[] {
    return this.statement.all(...normalizeParams(params)) as Row[]
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    return this.statement.run(...normalizeParams(params))
  }
}

export class LlmIwikiDatabase {
  constructor(private readonly raw: RawDatabase) {}

  query<Row = unknown, _Params = unknown>(sql: string): Query<Row> {
    return new Query<Row>(this.raw.prepare(sql))
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  transaction<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
    return this.raw.transaction(fn as (...args: never[]) => unknown) as unknown as (...args: Args) => R
  }

  close(): void {
    this.raw.close()
  }
}

export function openDatabase(databaseFile: string): LlmIwikiDatabase {
  mkdirSync(dirname(databaseFile), { recursive: true })
  return new LlmIwikiDatabase(openRaw(databaseFile, false))
}

export function openReadonlyDatabase(databaseFile: string): LlmIwikiDatabase | null {
  try {
    return new LlmIwikiDatabase(openRaw(databaseFile, true))
  } catch {
    return null
  }
}

export function runMigrations(db: LlmIwikiDatabase): void {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      display_name TEXT,
      slug TEXT NOT NULL,
      canonical_repo_url TEXT,
      provider TEXT,
      identity_source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_checkouts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      local_path TEXT NOT NULL,
      git_root TEXT,
      remote_url TEXT,
      canonical_remote_url TEXT,
      current_branch TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_aliases (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      alias_type TEXT NOT NULL,
      alias_value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      scan_paths TEXT,
      config_json TEXT,
      last_sync_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      project_id TEXT,
      checkout_id TEXT,
      raw_project_path TEXT,
      raw_path TEXT,
      title TEXT,
      message_count INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(source_id, source_session_id, raw_path)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions (project_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      seq_order INTEGER NOT NULL,
      content_hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id);

    CREATE TABLE IF NOT EXISTS session_summaries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      value TEXT NOT NULL,
      summary_markdown TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS experience_candidates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      proposed_title TEXT NOT NULL,
      proposed_slug TEXT NOT NULL,
      proposed_body_markdown TEXT NOT NULL,
      source_sessions_json TEXT NOT NULL,
      confidence TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS experiences (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      problem_type TEXT,
      solution_type TEXT,
      tech_stack_json TEXT,
      summary TEXT,
      body_markdown TEXT NOT NULL,
      confidence TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, slug)
    );

    CREATE TABLE IF NOT EXISTS session_experience_links (
      session_id TEXT NOT NULL,
      experience_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      PRIMARY KEY (session_id, experience_id)
    );

    CREATE TABLE IF NOT EXISTS obsidian_notes (
      id TEXT PRIMARY KEY,
      note_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      managed_hash TEXT,
      frontmatter_hash TEXT,
      last_exported_at TEXT,
      last_seen_mtime TEXT,
      conflict_status TEXT NOT NULL,
      UNIQUE(note_type, entity_id)
    );
  `)
}
