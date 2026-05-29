import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { parseExperiencesYaml, parseSummariesYaml } from './ai-yaml'
import { readConfig, setConfigValue } from './config'
import { openDatabase, runMigrations } from './db'
import {
  acceptExperience,
  type ExperienceScope,
  listCandidates,
  prepareExperiencesTask,
  proposeExperiences,
  rejectExperience,
} from './experiences'
import { checkVault, exportProject } from './obsidian'
import { getAppPaths, getProjectTaskDir } from './paths'
import { getProject, listProjects, renameProject, resolveProject } from './projects'
import { inspectProject } from './sessions'
import {
  initSkills,
  listSkillTargets,
  listSkillTemplates,
  SKILL_TARGETS,
  SKILLS_BASE_DIR,
  type SkillTarget,
} from './skills'
import { applySummaries, prepareSummariesTask } from './summarize'
import { runSync } from './sync'

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
  llm-iwiki sync [--project <path>]
  llm-iwiki projects list
  llm-iwiki projects resolve <path>
  llm-iwiki projects inspect <path-or-project-id>
  llm-iwiki projects rename <path-or-project-id> <display-name>
  llm-iwiki summarize prepare [changed|all] --project <path> [--out <file>]
  llm-iwiki summarize apply --project <path> --file <summaries.yaml>
  llm-iwiki experiences prepare --project <path> [--from changed-summaries|all-recent] [--out <file>]
  llm-iwiki experiences propose --project <path> --file <experiences.yaml>
  llm-iwiki experiences candidates [--project <path>]
  llm-iwiki experiences accept <candidate-id>
  llm-iwiki experiences reject <candidate-id>
  llm-iwiki obsidian export [--project <path>] [--vault <dir>] [--force]
  llm-iwiki obsidian check
  llm-iwiki config show
  llm-iwiki config set <key> <value>
  llm-iwiki skills [list]
  llm-iwiki skills init [--target codex|claude-code|cursor] [--force] [--dry-run]
`

const SKILLS_USAGE = `用法:
  llm-iwiki skills list                                  # 列出可用 target 与将写入的 skill
  llm-iwiki skills init [--target codex|claude-code|cursor] [--force] [--dry-run]`

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

  if (args[0] === 'sync') {
    const projectFlag = readFlag(args, '--project')
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const report = runSync(db, {
        homeDir: runtime.homeDir ?? paths.homeDir,
        projectFilter: projectFlag ? resolveCliPath(runtime.cwd, projectFlag) : null,
      })
      if (report.bySource.length === 0) {
        runtime.stdout('No collectors detected on this machine.')
        return 0
      }
      for (const source of report.bySource) {
        runtime.stdout(
          `${source.source}: ${source.total} sessions (new ${source.new}, changed ${source.changed}, unchanged ${source.unchanged}, missing ${source.sourceMissing})`,
        )
      }
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'projects' && args[1] === 'list') {
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const projects = listProjects(db)
      if (projects.length === 0) {
        runtime.stdout('No projects yet. Run: llm-iwiki sync')
        return 0
      }
      for (const project of projects) {
        const name = project.displayName ?? project.canonicalName
        runtime.stdout(`${project.id}  ${project.sessionCount} sessions  ${name}`)
      }
      return 0
    } finally {
      db.close()
    }
  }

  if (args[0] === 'projects' && args[1] === 'inspect') {
    const target = args[2]
    if (!target) {
      runtime.stderr('Usage: llm-iwiki projects inspect <path-or-project-id>')
      return 1
    }
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const project = target.startsWith('proj_')
        ? getProject(db, target)
        : resolveProject(db, resolveCliPath(runtime.cwd, target))
      const inspection = inspectProject(db, project.id)
      runtime.stdout(`project: ${project.displayName ?? project.canonicalName}`)
      runtime.stdout(`id: ${project.id}`)
      if (project.canonicalRepoUrl) runtime.stdout(`repo: ${project.canonicalRepoUrl}`)
      runtime.stdout(`sources: ${inspection.sources.map((s) => `${s.source}(${s.sessionCount})`).join(', ') || 'none'}`)
      runtime.stdout(`sessions: ${inspection.sessions.length}`)
      for (const session of inspection.sessions) {
        runtime.stdout(`  [${session.sourceId}] ${session.title ?? session.sourceSessionId} (${session.messageCount} msgs, ${session.status})`)
      }
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    } finally {
      db.close()
    }
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

  if (args[0] === 'summarize' && args[1] === 'prepare') {
    const scopeArg = args[2] && !args[2].startsWith('--') ? args[2] : 'changed'
    if (scopeArg !== 'changed' && scopeArg !== 'all') {
      runtime.stderr('Usage: llm-iwiki summarize prepare [changed|all] --project <path> [--out <file>]')
      return 1
    }
    const projectPath = resolveCliPath(runtime.cwd, readFlag(args, '--project') ?? runtime.cwd)
    const outFile = readFlag(args, '--out') ?? join(getProjectTaskDir(projectPath), 'summaries-task.md')
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const project = resolveProject(db, projectPath)
      const result = prepareSummariesTask(db, project.id, scopeArg)
      mkdirSync(dirname(resolveCliPath(runtime.cwd, outFile)), { recursive: true })
      writeFileSync(resolveCliPath(runtime.cwd, outFile), result.markdown)
      runtime.stdout(`prepared summaries task: ${result.sessionCount} sessions -> ${outFile}`)
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
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const parsed = parseSummariesYaml(readFileSync(resolveCliPath(runtime.cwd, file), 'utf8'))
      const result = applySummaries(db, parsed)
      runtime.stdout(`applied summaries: ${result.written}`)
      if (result.skipped.length > 0) {
        runtime.stdout(`skipped (unknown session): ${result.skipped.length}`)
      }
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'experiences' && args[1] === 'prepare') {
    const fromArg = (readFlag(args, '--from') ?? 'changed-summaries') as ExperienceScope
    if (fromArg !== 'changed-summaries' && fromArg !== 'all-recent') {
      runtime.stderr('Invalid --from. Use changed-summaries or all-recent.')
      return 1
    }
    const projectPath = resolveCliPath(runtime.cwd, readFlag(args, '--project') ?? runtime.cwd)
    const outFile = readFlag(args, '--out') ?? join(getProjectTaskDir(projectPath), 'experiences-task.md')
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const project = resolveProject(db, projectPath)
      const result = prepareExperiencesTask(db, project.id, fromArg)
      mkdirSync(dirname(resolveCliPath(runtime.cwd, outFile)), { recursive: true })
      writeFileSync(resolveCliPath(runtime.cwd, outFile), result.markdown)
      runtime.stdout(`prepared experiences task: ${result.summaryCount} summaries -> ${outFile}`)
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'experiences' && args[1] === 'propose') {
    const file = readFlag(args, '--file')
    if (!file) {
      runtime.stderr('Usage: llm-iwiki experiences propose --project <path> --file <experiences.yaml>')
      return 1
    }
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const parsed = parseExperiencesYaml(readFileSync(resolveCliPath(runtime.cwd, file), 'utf8'))
      const result = proposeExperiences(db, parsed)
      runtime.stdout(`proposed experiences: ${result.written}`)
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'experiences' && args[1] === 'candidates') {
    const projectFlag = readFlag(args, '--project')
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const projectId = projectFlag ? resolveProject(db, resolveCliPath(runtime.cwd, projectFlag)).id : null
      const candidates = listCandidates(db, projectId)
      if (candidates.length === 0) {
        runtime.stdout('No experience candidates. Run: llm-iwiki experiences propose')
        return 0
      }
      for (const candidate of candidates) {
        runtime.stdout(
          `${candidate.id}  [${candidate.status}]  ${candidate.confidence ?? '-'}  ${candidate.proposed_title}`,
        )
      }
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'experiences' && (args[1] === 'accept' || args[1] === 'reject')) {
    const candidateId = args[2]
    if (!candidateId) {
      runtime.stderr(`Usage: llm-iwiki experiences ${args[1]} <candidate-id>`)
      return 1
    }
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      if (args[1] === 'accept') {
        const result = acceptExperience(db, candidateId)
        runtime.stdout(`accepted: ${result.experienceId} (${result.slug}), linked sessions: ${result.linkedSessions}`)
      } else {
        rejectExperience(db, candidateId)
        runtime.stdout(`rejected: ${candidateId}`)
      }
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'config' && args[1] === 'show') {
    const paths = getAppPaths(runtime.homeDir)
    const config = readConfig(paths.configFile)
    runtime.stdout(`config: ${paths.configFile}`)
    runtime.stdout(`obsidian.vault: ${config.obsidianVault ?? '(unset)'}`)
    return 0
  }

  if (args[0] === 'config' && args[1] === 'set') {
    const key = args[2]
    const value = args[3]
    if (!key || value === undefined) {
      runtime.stderr('Usage: llm-iwiki config set <key> <value>')
      return 1
    }
    const paths = getAppPaths(runtime.homeDir)
    mkdirSync(paths.configDir, { recursive: true })
    try {
      const normalizedKey = setConfigValue(paths.configFile, key, value)
      runtime.stdout(`set ${normalizedKey} = ${value}`)
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    }
  }

  if (args[0] === 'obsidian' && args[1] === 'export') {
    const paths = getAppPaths(runtime.homeDir)
    const vaultFlag = readFlag(args, '--vault')
    const vault = vaultFlag
      ? resolveCliPath(runtime.cwd, vaultFlag)
      : readConfig(paths.configFile).obsidianVault
    if (!vault) {
      runtime.stderr('No Obsidian vault configured. Run: llm-iwiki config set obsidian.vault <dir>')
      return 1
    }
    const projectPath = resolveCliPath(runtime.cwd, readFlag(args, '--project') ?? runtime.cwd)
    const force = args.includes('--force')
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const project = resolveProject(db, projectPath)
      const report = exportProject(db, vault, project, { force })
      runtime.stdout(`vault: ${vault}`)
      runtime.stdout(
        `exported: created ${report.created}, updated ${report.updated}, forced ${report.forced}, conflicts ${report.conflicts.length}`,
      )
      for (const conflict of report.conflicts) {
        runtime.stdout(`  conflict (skipped): ${conflict}`)
      }
      if (report.conflicts.length > 0 && !force) {
        runtime.stdout('Re-run with --force to overwrite managed blocks of conflicting notes.')
      }
      return 0
    } catch (error) {
      runtime.stderr(error instanceof Error ? error.message : String(error))
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'obsidian' && args[1] === 'check') {
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const report = checkVault(db)
      runtime.stdout(`notes: ${report.total}, clean: ${report.clean}, needs attention: ${report.entries.length}`)
      for (const entry of report.entries) {
        runtime.stdout(`  ${entry.status}: ${entry.filePath}`)
      }
      return 0
    } finally {
      db.close()
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

  if (args[0] === 'skills' && (args[1] === undefined || args[1] === 'list')) {
    runtime.stdout(SKILLS_USAGE)
    runtime.stdout('')
    runtime.stdout('可用 target:')
    for (const target of listSkillTargets()) {
      runtime.stdout(`  ${target.id}  (${target.name})`)
    }
    runtime.stdout('')
    runtime.stdout(`将写入的 skill (位于 ${SKILLS_BASE_DIR}/):`)
    for (const template of listSkillTemplates()) {
      runtime.stdout(`  ${template.directory}  ->  ${template.relPath}`)
    }
    return 0
  }

  if (args[0] === 'skills') {
    runtime.stderr(`Unknown skills subcommand: ${args[1]}`)
    runtime.stderr(SKILLS_USAGE)
    return 1
  }

  runtime.stderr(`Unknown command: ${args.join(' ')}`)
  runtime.stderr(HELP)
  return 1
}
