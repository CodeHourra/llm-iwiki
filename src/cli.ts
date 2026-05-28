import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

import { openDatabase, runMigrations } from './db'
import { getAppPaths } from './paths'

export interface CliRuntime {
  cwd: string
  stdout: (message: string) => void
  stderr: (message: string) => void
}

const HELP = `llm-iwiki

Usage:
  llm-iwiki init
  llm-iwiki doctor
  llm-iwiki projects resolve <path>
  llm-iwiki projects rename <path-or-project-id> <display-name>
  llm-iwiki summarize apply --project <path> --file <summaries.yaml>
  llm-iwiki experiences propose --project <path> --file <experiences.yaml>
  llm-iwiki skills init [--target codex|claude-code|cursor] [--force] [--dry-run]
`

export async function runCli(args: string[], runtime: CliRuntime): Promise<number> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    runtime.stdout(HELP)
    return 0
  }

  if (args[0] === 'init') {
    const paths = getAppPaths()
    mkdirSync(paths.configDir, { recursive: true })
    if (!existsSync(paths.configFile)) {
      writeFileSync(paths.configFile, 'obsidian_vault = ""\n')
    }
    const db = openDatabase(paths.databaseFile)
    runMigrations(db)
    runtime.stdout(`Initialized llm-iwiki at ${paths.configDir}`)
    return 0
  }

  if (args[0] === 'doctor') {
    const paths = getAppPaths()
    const db = openDatabase(paths.databaseFile)
    runMigrations(db)
    runtime.stdout(`config: ${paths.configFile}`)
    runtime.stdout(`database: ${paths.databaseFile}`)
    runtime.stdout('status: ok')
    return 0
  }

  runtime.stderr(`Unknown command: ${args.join(' ')}`)
  runtime.stderr(HELP)
  return 1
}
