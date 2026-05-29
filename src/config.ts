import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export interface LlmIwikiConfig {
  obsidianVault: string | null
}

const KEY_ALIASES: Record<string, string> = {
  'obsidian.vault': 'obsidian_vault',
  obsidian_vault: 'obsidian_vault',
}

function parseToml(source: string): Record<string, string> {
  const config: Record<string, string> = {}
  for (const line of source.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('[')) continue
    const match = trimmed.match(/^([\w.]+)\s*=\s*(.*)$/)
    if (!match) continue
    const key = match[1]!
    let value = match[2]!.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    config[key] = value
  }
  return config
}

export function readConfig(configFile: string): LlmIwikiConfig {
  if (!existsSync(configFile)) return { obsidianVault: null }
  const raw = parseToml(readFileSync(configFile, 'utf8'))
  const vault = raw.obsidian_vault
  return { obsidianVault: vault && vault.trim() !== '' ? vault : null }
}

export function setConfigValue(configFile: string, key: string, value: string): string {
  const normalizedKey = KEY_ALIASES[key]
  if (!normalizedKey) {
    throw new Error(`Unknown config key: ${key}. Supported: obsidian.vault`)
  }

  const existing = existsSync(configFile) ? readFileSync(configFile, 'utf8') : ''
  const lines = existing.split('\n')
  const line = `${normalizedKey} = "${value}"`
  let replaced = false
  const next = lines.map((entry) => {
    if (entry.trim().startsWith(`${normalizedKey} `) || entry.trim().startsWith(`${normalizedKey}=`)) {
      replaced = true
      return line
    }
    return entry
  })
  if (!replaced) next.push(line)

  writeFileSync(configFile, `${next.filter((entry, index) => !(entry === '' && index === next.length - 1)).join('\n')}\n`)
  return normalizedKey
}
