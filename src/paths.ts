import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface AppPaths {
  homeDir: string
  configDir: string
  configFile: string
  databaseFile: string
}

export function getAppPaths(homeDir = homedir()): AppPaths {
  const configDir = join(homeDir, '.llm-iwiki')
  return {
    homeDir,
    configDir,
    configFile: join(configDir, 'config.toml'),
    databaseFile: join(configDir, 'llm-iwiki.db'),
  }
}

export function getProjectTaskDir(cwd: string): string {
  return resolve(cwd, '.llm-iwiki', 'tasks')
}
