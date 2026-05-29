import type { RawMessage } from './collectors'

export interface CompactionOptions {
  maxPerMessage: number
  maxMessages: number
}

const DEFAULTS: CompactionOptions = {
  maxPerMessage: 1200,
  maxMessages: 60,
}

function squashWhitespace(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function truncate(text: string, max: number): string {
  const cleaned = squashWhitespace(text)
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max)}\n…[truncated ${cleaned.length - max} chars]`
}

export interface CompactMessageInput {
  role: string
  content: string
}

/**
 * Deterministic, dependency-free compaction. Keeps the head and tail of long
 * conversations and truncates oversized individual messages so the result is a
 * readable transcript that fits a token budget without calling any model.
 */
export function compactTranscript(
  messages: CompactMessageInput[],
  options: Partial<CompactionOptions> = {},
): string {
  const opts = { ...DEFAULTS, ...options }
  const meaningful = messages.filter((message) => message.content.trim() !== '')

  let kept = meaningful
  let omittedNote = ''
  if (meaningful.length > opts.maxMessages) {
    const head = Math.ceil(opts.maxMessages * 0.6)
    const tail = opts.maxMessages - head
    kept = [...meaningful.slice(0, head), ...meaningful.slice(meaningful.length - tail)]
    omittedNote = `\n…[omitted ${meaningful.length - opts.maxMessages} middle messages]\n`
  }

  const lines: string[] = []
  kept.forEach((message, index) => {
    if (omittedNote && index === Math.ceil(opts.maxMessages * 0.6)) {
      lines.push(omittedNote)
    }
    const label = message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : message.role
    lines.push(`**${label}:** ${truncate(message.content, opts.maxPerMessage)}`)
  })

  return lines.join('\n\n')
}

export function compactRawMessages(messages: RawMessage[], options?: Partial<CompactionOptions>): string {
  return compactTranscript(messages, options)
}
