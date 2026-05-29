import { tmpdir } from 'node:os'

import type { RawMessage } from './types'

const TITLE_MAX_LENGTH = 120

const EPHEMERAL_PREFIXES = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/']

export function isEphemeralPath(path: string | null): boolean {
  if (!path) return false
  const temp = tmpdir()
  if (path === temp) return true
  const normalized = path.endsWith('/') ? path : `${path}/`
  const prefixes = [...EPHEMERAL_PREFIXES, `${temp}/`]
  return prefixes.some((prefix) => normalized.startsWith(prefix))
}

export function clampTitle(value: string): string {
  return value.length > TITLE_MAX_LENGTH ? `${value.slice(0, TITLE_MAX_LENGTH)}…` : value
}

function firstMeaningfulLine(content: string): string | null {
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || /^[-=*#>`~]+$/.test(trimmed)) continue
    return trimmed
  }
  return null
}

export function deriveTitle(messages: RawMessage[]): string | null {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const line = firstMeaningfulLine(message.content)
    if (line) return clampTitle(line)
  }
  return null
}

export function normalizeContentParts(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const record = part as Record<string, unknown>
          if (typeof record.text === 'string') return record.text
          return JSON.stringify(record)
        }
        return String(part)
      })
      .join('\n')
      .trim()
  }
  if (content == null) return ''
  return JSON.stringify(content)
}
