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
import { checkVault, exportAll, exportProject, moveProject, writeGlobalIndex } from './obsidian'
import { getAppPaths, getProjectTaskDir } from './paths'
import {
  dedupeProjects,
  listProjects,
  mergeProjects,
  ProjectResolutionError,
  renameProject,
  resolveProject,
  resolveProjectRef,
} from './projects'
import { search, type SearchKind } from './search'
import { inspectProject, listSessionsByProject, readSessionTranscript } from './sessions'
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

提示：所有 --project 都接受「路径 / proj_xxx / 项目名或 slug」三种形式。

Usage:
  llm-iwiki init
  llm-iwiki doctor
  llm-iwiki sync [--project <path>]
  llm-iwiki projects list
  llm-iwiki projects resolve <path>
  llm-iwiki projects inspect <project>
  llm-iwiki projects rename <project> <display-name>
  llm-iwiki projects merge <from-project-id> <into-project-id>
  llm-iwiki projects dedupe [--dry-run]
  llm-iwiki sessions list [--project <project>]
  llm-iwiki sessions read <session-id> [--full]
  llm-iwiki summarize prepare [changed|all] --project <project> [--out <file>]
  llm-iwiki summarize apply [--project <project>] --file <summaries.yaml>
  llm-iwiki experiences prepare --project <project> [--from changed-summaries|all-recent] [--since 30d] [--out <file>]
  llm-iwiki experiences propose [--project <project>] --file <experiences.yaml>
  llm-iwiki experiences candidates [--project <project>]
  llm-iwiki experiences accept <candidate-id>
  llm-iwiki experiences reject <candidate-id>
  llm-iwiki search <sessions|experiences> <query> [--project <project>]
  llm-iwiki obsidian export [--project <project>] [--all] [--vault <dir>] [--force]
  llm-iwiki obsidian move-project <project> [--vault <dir>]
  llm-iwiki obsidian check
  llm-iwiki config show
  llm-iwiki config set <key> <value>
  llm-iwiki skills [list]
  llm-iwiki skills init [--target codex|claude-code|cursor] [--force] [--dry-run]

Global flags:
  --debug   出错时打印详细堆栈
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

function reportError(error: unknown, runtime: CliRuntime, debug: boolean): void {
  if (error instanceof ProjectResolutionError) {
    runtime.stderr(`找不到唯一项目：${error.ref}`)
    if (error.candidates.length === 0) {
      runtime.stderr('可能原因：路径下尚无会话、或项目名写错。建议：')
      runtime.stderr('  - 先运行 llm-iwiki sync 采集会话')
      runtime.stderr('  - 用 llm-iwiki projects list 查看已有项目，再用 proj_xxx 精确指定')
    } else {
      runtime.stderr('存在多个候选（按会话数排序）：')
      for (const candidate of error.candidates) {
        const name = candidate.displayName ?? candidate.canonicalName
        runtime.stderr(`  ${candidate.id}  ${candidate.sessionCount} sessions  ${name}`)
      }
      runtime.stderr('建议：用 --project <proj_xxx> 精确指定，或先 llm-iwiki projects dedupe 合并重复项目。')
    }
    if (debug && error.stack) runtime.stderr(error.stack)
    return
  }
  runtime.stderr(error instanceof Error ? error.message : String(error))
  if (debug && error instanceof Error && error.stack) runtime.stderr(error.stack)
}

/**
 * 解析 --project（默认当前目录），接受 path / proj_id / name，不创建空项目。
 */
function resolveProjectFlag(db: Parameters<typeof resolveProjectRef>[0], args: string[], runtime: CliRuntime) {
  const raw = readFlag(args, '--project') ?? runtime.cwd
  return resolveProjectRef(db, raw, runtime.cwd)
}

function parseSinceToIso(value: string): string {
  const match = value.match(/^(\d+)([dhw])$/)
  if (!match) throw new Error(`Invalid --since: ${value}. Use forms like 30d, 12h, 2w.`)
  const amount = Number(match[1])
  const unitMs = match[2] === 'h' ? 3_600_000 : match[2] === 'w' ? 604_800_000 : 86_400_000
  return new Date(Date.now() - amount * unitMs).toISOString()
}

export async function runCli(args: string[], runtime: CliRuntime): Promise<number> {
  const debug = args.includes('--debug')

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
        const name = project.displayName ?? project.slug
        const repo = project.canonicalRepoUrl ? `  repo: ${project.canonicalRepoUrl}` : ''
        runtime.stdout(`${project.id}  ${project.sessionCount} sessions  ${name}${repo}`)
      }
      return 0
    } finally {
      db.close()
    }
  }

  if (args[0] === 'projects' && args[1] === 'inspect') {
    const target = args[2]
    if (!target) {
      runtime.stderr('Usage: llm-iwiki projects inspect <project>')
      return 1
    }
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const project = resolveProjectRef(db, target, runtime.cwd)
      const inspection = inspectProject(db, project.id)
      runtime.stdout(`project: ${project.displayName ?? project.canonicalName}`)
      runtime.stdout(`id: ${project.id}`)
      if (project.canonicalRepoUrl) runtime.stdout(`repo: ${project.canonicalRepoUrl}`)
      runtime.stdout(`sources: ${inspection.sources.map((s) => `${s.source}(${s.sessionCount})`).join(', ') || 'none'}`)
      runtime.stdout(`sessions: ${inspection.sessions.length}`)
      for (const session of inspection.sessions) {
        runtime.stdout(`  ${session.id}  [${session.sourceId}] ${session.title ?? session.sourceSessionId} (${session.messageCount} msgs, ${session.status})`)
      }
      return 0
    } catch (error) {
      reportError(error, runtime, debug)
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'projects' && args[1] === 'merge') {
    const fromId = args[2]
    const intoId = args[3]
    if (!fromId || !intoId) {
      runtime.stderr('Usage: llm-iwiki projects merge <from-project-id> <into-project-id>')
      return 1
    }
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const result = mergeProjects(db, fromId, intoId)
      runtime.stdout(`merged ${result.fromId} -> ${result.intoId} (moved ${result.movedSessions} sessions)`)
      return 0
    } catch (error) {
      reportError(error, runtime, debug)
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'projects' && args[1] === 'dedupe') {
    const dryRun = args.includes('--dry-run')
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      if (dryRun) {
        const projects = listProjects(db)
        const groups = new Map<string, typeof projects>()
        for (const project of projects) {
          const key = project.canonicalRepoUrl ? `repo:${project.canonicalRepoUrl}` : `slug:${project.slug}`
          groups.set(key, [...(groups.get(key) ?? []), project])
        }
        let dupGroups = 0
        for (const [, group] of groups) {
          if (group.length < 2) continue
          dupGroups += 1
          runtime.stdout(`would merge ${group.length} duplicates of ${group[0]!.canonicalName}`)
        }
        runtime.stdout(`dry-run: ${dupGroups} duplicate group(s)`)
        return 0
      }
      const result = dedupeProjects(db)
      runtime.stdout(`deduped: merged ${result.merges.length} duplicate project(s)`)
      for (const merge of result.merges) {
        runtime.stdout(`  ${merge.fromId} -> ${merge.intoId} (moved ${merge.movedSessions} sessions)`)
      }
      return 0
    } catch (error) {
      reportError(error, runtime, debug)
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'sessions' && args[1] === 'list') {
    const projectFlag = readFlag(args, '--project')
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const project = projectFlag ? resolveProjectRef(db, projectFlag, runtime.cwd) : resolveProjectFlag(db, args, runtime)
      const sessions = listSessionsByProject(db, project.id)
      runtime.stdout(`project: ${project.displayName ?? project.canonicalName} (${project.id})`)
      runtime.stdout(`sessions: ${sessions.length}`)
      for (const session of sessions) {
        runtime.stdout(`  ${session.id}  [${session.sourceId}] ${session.title ?? session.sourceSessionId} (${session.messageCount} msgs, ${session.status})`)
      }
      return 0
    } catch (error) {
      reportError(error, runtime, debug)
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'sessions' && args[1] === 'read') {
    const sessionId = args[2]
    if (!sessionId || sessionId.startsWith('--')) {
      runtime.stderr('Usage: llm-iwiki sessions read <session-id> [--full]')
      return 1
    }
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const { session, transcript, messageCount } = readSessionTranscript(db, sessionId, {
        full: args.includes('--full'),
      })
      runtime.stdout(`# ${session.title ?? session.sourceSessionId}`)
      runtime.stdout(`session: ${session.id}  source: ${session.sourceId}  messages: ${messageCount}`)
      runtime.stdout('')
      runtime.stdout(transcript)
      return 0
    } catch (error) {
      reportError(error, runtime, debug)
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
    const projectRef = readFlag(args, '--project') ?? runtime.cwd
    const taskBase = projectRef.startsWith('proj_') ? runtime.cwd : resolveCliPath(runtime.cwd, projectRef)
    const outFile = readFlag(args, '--out') ?? join(getProjectTaskDir(taskBase), 'summaries-task.md')
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const project = resolveProjectRef(db, projectRef, runtime.cwd)
      const result = prepareSummariesTask(db, project.id, scopeArg)
      mkdirSync(dirname(resolveCliPath(runtime.cwd, outFile)), { recursive: true })
      writeFileSync(resolveCliPath(runtime.cwd, outFile), result.markdown)
      runtime.stdout(`prepared summaries task: ${result.sessionCount} sessions -> ${outFile}`)
      return 0
    } catch (error) {
      reportError(error, runtime, debug)
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
    const projectRef = readFlag(args, '--project') ?? runtime.cwd
    const taskBase = projectRef.startsWith('proj_') ? runtime.cwd : resolveCliPath(runtime.cwd, projectRef)
    const outFile = readFlag(args, '--out') ?? join(getProjectTaskDir(taskBase), 'experiences-task.md')
    const sinceFlag = readFlag(args, '--since')
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const since = sinceFlag ? parseSinceToIso(sinceFlag) : null
      const project = resolveProjectRef(db, projectRef, runtime.cwd)
      const result = prepareExperiencesTask(db, project.id, fromArg, since)
      mkdirSync(dirname(resolveCliPath(runtime.cwd, outFile)), { recursive: true })
      writeFileSync(resolveCliPath(runtime.cwd, outFile), result.markdown)
      runtime.stdout(`prepared experiences task: ${result.summaryCount} summaries -> ${outFile}`)
      return 0
    } catch (error) {
      reportError(error, runtime, debug)
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
      const projectId = projectFlag ? resolveProjectRef(db, projectFlag, runtime.cwd).id : null
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
      reportError(error, runtime, debug)
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
    const all = args.includes('--all')
    const projectRef = readFlag(args, '--project') ?? runtime.cwd
    const force = args.includes('--force')
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      let report
      if (all) {
        report = exportAll(db, vault, { force })
      } else {
        const project = resolveProjectRef(db, projectRef, runtime.cwd)
        report = exportProject(db, vault, project, { force })
        const indexReport = writeGlobalIndex(db, vault, { force })
        report.created += indexReport.created
        report.updated += indexReport.updated
        report.forced += indexReport.forced
        report.conflicts.push(...indexReport.conflicts)
      }
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
      reportError(error, runtime, debug)
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'obsidian' && args[1] === 'move-project') {
    const target = args[2]
    if (!target || target.startsWith('--')) {
      runtime.stderr('Usage: llm-iwiki obsidian move-project <project> [--vault <dir>]')
      return 1
    }
    const paths = getAppPaths(runtime.homeDir)
    const vaultFlag = readFlag(args, '--vault')
    const vault = vaultFlag ? resolveCliPath(runtime.cwd, vaultFlag) : readConfig(paths.configFile).obsidianVault
    if (!vault) {
      runtime.stderr('No Obsidian vault configured. Run: llm-iwiki config set obsidian.vault <dir>')
      return 1
    }
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const project = resolveProjectRef(db, target, runtime.cwd)
      const result = moveProject(db, vault, project)
      if (result.moved === 0) {
        runtime.stdout('nothing to move (already at target or no exported notes).')
      } else {
        runtime.stdout(`moved project notes to slug directory: ${project.slug}`)
        for (const dir of result.fromDirs) runtime.stdout(`  from: ${dir}`)
      }
      return 0
    } catch (error) {
      reportError(error, runtime, debug)
      return 1
    } finally {
      db.close()
    }
  }

  if (args[0] === 'search') {
    const kind = args[1]
    const query = args[2]
    if ((kind !== 'sessions' && kind !== 'experiences') || !query || query.startsWith('--')) {
      runtime.stderr('Usage: llm-iwiki search <sessions|experiences> <query> [--project <project>]')
      return 1
    }
    const projectFlag = readFlag(args, '--project')
    const paths = getAppPaths(runtime.homeDir)
    const db = openDatabase(paths.databaseFile)
    try {
      runMigrations(db)
      const projectId = projectFlag ? resolveProjectRef(db, projectFlag, runtime.cwd).id : null
      const hits = search(db, kind as SearchKind, query, projectId)
      runtime.stdout(`matches: ${hits.length}`)
      for (const hit of hits) {
        runtime.stdout(`  ${hit.id}  ${hit.title}`)
        runtime.stdout(`    ${hit.snippet}`)
      }
      return 0
    } catch (error) {
      reportError(error, runtime, debug)
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
