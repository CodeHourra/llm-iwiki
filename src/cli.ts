import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { parseExperiencesYaml, parseSummariesYaml } from './ai-yaml'
import { openDatabase, runMigrations } from './db'
import { getAppPaths } from './paths'
import { renameProject, resolveProject } from './projects'
import { initSkills, SKILL_TARGETS, type SkillTarget } from './skills'

export interface CliRuntime {
  cwd: string
  homeDir?: string
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

function resolveCliPath(cwd: string, targetPath: string): string {
  return isAbsolute(targetPath) ? targetPath : resolve(cwd, targetPath)
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index === -1) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) return null
  return value
}

export async function runCli(args: string[], runtime: CliRuntime): Promise<number> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    runtime.stdout(HELP)
    return 0
  }

  if (args[0] === 'init') {
    const paths = getAppPaths(runtime.homeDir)
    mkdirSync(paths.configDir, { recursive: true })
    if (!existsSync(paths.configFile)) {
      writeFileSync(paths.configFile, 'obsidian_vault = ""\n')
    }
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
    } finally {
      db.close()
    }
    runtime.stdout(`Initialized llm-iwiki at ${paths.configDir}`)
    return 0
  }

  if (args[0] === 'doctor') {
    const paths = getAppPaths(runtime.homeDir)
    if (!existsSync(paths.configFile)) {
      runtime.stderr('llm-iwiki is not initialized. Run: llm-iwiki init')
      return 1
    }
    if (!existsSync(paths.databaseFile)) {
      runtime.stderr('llm-iwiki database is missing. Run: llm-iwiki init')
      return 1
    }
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
    } finally {
      db.close()
    }
    runtime.stdout(`config: ${paths.configFile}`)
    runtime.stdout(`database: ${paths.databaseFile}`)
    runtime.stdout('status: ok')
    return 0
  }

  if (args[0] === 'projects' && args[1] === 'resolve') {
    const targetPath = args[2] ?? runtime.cwd
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const project = resolveProject(db, resolveCliPath(runtime.cwd, targetPath))
      runtime.stdout(JSON.stringify(project, null, 2))
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'projects' && args[1] === 'rename') {
    const target = args[2]
    const displayName = args[3]
    if (!target || !displayName) {
      runtime.stderr('Usage: llm-iwiki projects rename <path-or-project-id> <display-name>')
      return 1
    }
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const project = target.startsWith('proj_')
        ? renameProject(db, target, displayName)
        : renameProject(db, resolveProject(db, resolveCliPath(runtime.cwd, target)).id, displayName)
      runtime.stdout(JSON.stringify(project, null, 2))
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'summarize' && args[1] === 'apply') {
    const file = readFlag(args, '--file')
    if (!file) {
      runtime.stderr('Usage: llm-iwiki summarize apply --project <path> --file <summaries.yaml>')
      return 1
    }
    try {
      const parsed = parseSummariesYaml(readFileSync(resolveCliPath(runtime.cwd, file), 'utf8'))
      runtime.stdout(`validated summaries: ${parsed.summaries.length}`)
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    }
  }

  if (args[0] === 'experiences' && args[1] === 'propose') {
    const file = readFlag(args, '--file')
    if (!file) {
      runtime.stderr('Usage: llm-iwiki experiences propose --project <path> --file <experiences.yaml>')
      return 1
    }
    try {
      const parsed = parseExperiencesYaml(readFileSync(resolveCliPath(runtime.cwd, file), 'utf8'))
      runtime.stdout(`validated experiences: ${parsed.experiences.length}`)
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    }
  }

  if (args[0] === 'skills' && args[1] === 'init') {
    const targetFlag = readFlag(args, '--target')
    if (args.includes('--target') && !targetFlag) {
      runtime.stderr('Invalid --target. Use codex, claude-code, or cursor.')
      return 1
    }
    if (targetFlag && !(SKILL_TARGETS as readonly string[]).includes(targetFlag)) {
      runtime.stderr('Invalid --target. Use codex, claude-code, or cursor.')
      return 1
    }
    const target = targetFlag as SkillTarget | null
    const result = initSkills({
      cwd: runtime.cwd,
      target,
      force: args.includes('--force'),
      dryRun: args.includes('--dry-run'),
    })
    runtime.stdout(`skills written: ${result.written.length}`)
    runtime.stdout(`skills skipped: ${result.skipped.length}`)
    return 0
  }

  runtime.stderr(`Unknown command: ${args.join(' ')}`)
  runtime.stderr(HELP)
  return 1
}
