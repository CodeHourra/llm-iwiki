import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type LlmIwikiDatabase = Database

export function openDatabase(databaseFile: string): LlmIwikiDatabase {
  mkdirSync(dirname(databaseFile), { recursive: true })
  return new Database(databaseFile)
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
