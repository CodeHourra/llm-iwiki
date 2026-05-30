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
  // 避免使用 "tasks" 目录名：编辑器的 YAML/Ansible 插件会把 **/tasks/*.yaml
  // 误匹配为 Ansible 剧本并套错 schema。
  return resolve(cwd, '.llm-iwiki', 'exchange')
}
