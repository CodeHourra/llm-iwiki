import { claudeCodeCollector } from './claude-code'
import { codexCollector } from './codex'
import { geminiCollector } from './gemini'
import type { Collector } from './types'

export const COLLECTORS: Collector[] = [claudeCodeCollector, codexCollector, geminiCollector]

export function getCollector(id: string): Collector | null {
  return COLLECTORS.find((collector) => collector.id === id) ?? null
}

export type { Collector, RawMessage, RawSession } from './types'
