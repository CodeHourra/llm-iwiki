import { claudeCodeCollector } from './claude-code'
import { codebuddyCollector } from './codebuddy'
import { codexCollector } from './codex'
import { cursorCollector } from './cursor'
import { geminiCollector } from './gemini'
import type { Collector } from './types'

export const COLLECTORS: Collector[] = [
  claudeCodeCollector,
  codexCollector,
  cursorCollector,
  geminiCollector,
  codebuddyCollector,
]

export function getCollector(id: string): Collector | null {
  return COLLECTORS.find((collector) => collector.id === id) ?? null
}

export type { Collector, RawMessage, RawSession } from './types'
