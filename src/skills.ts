import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type SkillTarget = 'codex' | 'claude-code' | 'cursor'

export const SKILL_TARGETS = ['codex', 'claude-code', 'cursor'] as const satisfies readonly SkillTarget[]

export interface InitSkillsOptions {
  cwd: string
  target: SkillTarget | null
  force: boolean
  dryRun: boolean
}

export interface InitSkillsResult {
  written: string[]
  skipped: string[]
}

interface SkillTemplate {
  directory: string
  content: string
}

const TARGET_NAMES: Record<SkillTarget, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
}

const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    directory: 'aiwiki-after-session',
    content: `---
name: aiwiki-after-session
description: Capture session knowledge into llm-iwiki summaries, experiences, and Obsidian export after project work.
---

# AIWiki After Session

Use this skill after a meaningful coding or design session in the current project.

## Steps

1. Sync the current project:
   \`\`\`bash
   llm-iwiki sync --project .
   \`\`\`
2. Prepare changed summaries:
   \`\`\`bash
   llm-iwiki summarize prepare changed --project . --out .llm-iwiki/tasks/summaries-task.md
   \`\`\`
3. Generate \`.llm-iwiki/tasks/summaries.yaml\` from the prepared task.
4. Apply the summaries:
   \`\`\`bash
   llm-iwiki summarize apply --project . --file .llm-iwiki/tasks/summaries.yaml
   \`\`\`
5. Prepare experience proposals from changed summaries:
   \`\`\`bash
   llm-iwiki experiences prepare --project . --from changed-summaries --out .llm-iwiki/tasks/experiences-task.md
   \`\`\`
6. Generate \`.llm-iwiki/tasks/experiences.yaml\` from the prepared task.
7. Propose the experiences:
   \`\`\`bash
   llm-iwiki experiences propose --project . --file .llm-iwiki/tasks/experiences.yaml
   \`\`\`
8. Export project knowledge to Obsidian:
   \`\`\`bash
   llm-iwiki obsidian export --project .
   \`\`\`
`,
  },
  {
    directory: 'aiwiki-before-debug',
    content: `---
name: aiwiki-before-debug
description: Search project memory before debugging so related history is visible before changing code.
---

# AIWiki Before Debug

Use this skill before investigating a bug, failure, error message, or confusing behavior.

## Steps

1. Search the full project knowledge index:
   \`\`\`bash
   llm-iwiki search "<error or topic>" --project . --index all
   \`\`\`
2. Read any related summaries, experiences, or prior decisions before editing code.
3. Report whether related history was found, and name the most relevant item when it was found.
`,
  },
  {
    directory: 'aiwiki-project-retrospective',
    content: `---
name: aiwiki-project-retrospective
description: Review recent project knowledge and extract retrospective themes from llm-iwiki.
---

# AIWiki Project Retrospective

Use this skill when preparing a project retrospective or looking for recent repeated lessons.

## Steps

1. Prepare a retrospective from recent project history:
   \`\`\`bash
   llm-iwiki experiences prepare --project . --from all-recent --since 30d --out .llm-iwiki/tasks/retrospective-task.md
   \`\`\`
2. Review the prepared task for repeated themes, unresolved questions, and process improvements.
3. Capture any accepted learnings through the normal llm-iwiki experience proposal flow.
`,
  },
]

function appendTargetGuidance(content: string, target: SkillTarget | null): string {
  if (!target) return content

  return `${content}
## Tool Target

This skill is initialized for ${TARGET_NAMES[target]}.
`
}

export function initSkills(options: InitSkillsOptions): InitSkillsResult {
  const written: string[] = []
  const skipped: string[] = []

  for (const template of SKILL_TEMPLATES) {
    const filePath = join(options.cwd, '.agents', 'skills', template.directory, 'SKILL.md')

    if (existsSync(filePath) && !options.force) {
      skipped.push(filePath)
      continue
    }

    written.push(filePath)

    if (options.dryRun) {
      continue
    }

    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, appendTargetGuidance(template.content, options.target))
  }

  return { written, skipped }
}
