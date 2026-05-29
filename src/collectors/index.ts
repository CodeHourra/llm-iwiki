import { claudeCodeCollector } from './claude-code'
import type { Collector } from './types'

export const COLLECTORS: Collector[] = [claudeCodeCollector]

export function getCollector(id: string): Collector | null {
  return COLLECTORS.find((collector) => collector.id === id) ?? null
}

export type { Collector, RawMessage, RawSession } from './types'
