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

export const SKILLS_BASE_DIR = join('.agents', 'skills')

export interface SkillTargetInfo {
  id: SkillTarget
  name: string
}

export interface SkillTemplateInfo {
  directory: string
  relPath: string
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
    directory: 'aiwiki-knowledge',
    content: `---
name: aiwiki-knowledge
description: 用 llm-iwiki 把当前项目跨 AI 工具的会话沉淀成知识库——采集会话、生成总结与经验、导出到 Obsidian。当用户提到"沉淀/总结这次工作""存进知识库""项目复盘""跑一下 llm-iwiki"或想把会话经验归档时使用。
---

# AIWiki 知识沉淀

用 \`llm-iwiki\` 把当前项目里跨 AI 工具（Claude Code / Cursor / Codex / CodeBuddy / Gemini）的会话，沉淀为「会话总结 → 可复用经验 → Obsidian 笔记」。

## 何时使用

- 完成一段有价值的编码 / 设计工作后，想把过程沉淀进知识库。
- 用户说「沉淀这次工作」「总结到知识库」「项目复盘」「跑一下 llm-iwiki」。

## 整体流程

\`采集(命令) → 生成总结任务(命令) → 你产出 summaries.yaml → 落库(命令) → 生成经验任务(命令) → 你产出 experiences.yaml → 落库为候选(命令) → 人工审核 → 导出 Obsidian(命令)\`

其中**只有「产出两个 YAML」需要你来做**，其余都是直接跑命令。务必先读下方「YAML 输出规则」再动手，这是最容易出错的地方。

## 步骤（在项目根目录执行）

1. 采集并确认项目已识别，记下顶部的 project_id（形如 \`proj_xxxx\`）：
   \`\`\`bash
   llm-iwiki sync
   llm-iwiki projects inspect .
   \`\`\`
   若显示 \`sessions: 0\`，说明本机暂无该项目会话，停止并告知用户。

2. 生成总结任务文件（想覆盖全部历史把 \`changed\` 换成 \`all\`）：
   \`\`\`bash
   llm-iwiki summarize prepare changed --project . --out .llm-iwiki/tasks/summaries-task.md
   \`\`\`

3. 阅读 \`.llm-iwiki/tasks/summaries-task.md\`，据此**新建** \`.llm-iwiki/tasks/summaries.yaml\`（纯 YAML，见下方规则）。

4. 落库；若报解析 / 校验错，按报错修正 YAML 后重跑：
   \`\`\`bash
   llm-iwiki summarize apply --project . --file .llm-iwiki/tasks/summaries.yaml
   \`\`\`

5. 生成经验任务文件（只吃 value=medium/high 的总结）：
   \`\`\`bash
   llm-iwiki experiences prepare --project . --from changed-summaries --out .llm-iwiki/tasks/experiences-task.md
   \`\`\`

6. 阅读 \`.llm-iwiki/tasks/experiences-task.md\`，据此**新建** \`.llm-iwiki/tasks/experiences.yaml\`（纯 YAML）。

7. 落库为候选：
   \`\`\`bash
   llm-iwiki experiences propose --project . --file .llm-iwiki/tasks/experiences.yaml
   \`\`\`

8. 列出候选交用户决定，**不要自行 accept**：
   \`\`\`bash
   llm-iwiki experiences candidates --project .
   # 用户确认后再：llm-iwiki experiences accept <candidate-id>
   \`\`\`

9. 导出到 Obsidian（只导出已 accept 的经验；库路径仅首次需配置）：
   \`\`\`bash
   llm-iwiki config set obsidian.vault <库目录>
   llm-iwiki obsidian export --project .
   \`\`\`

## YAML 输出规则（最重要，避免格式错误）

- \`*-task.md\` 是**输入说明**，绝不要修改它，更不要把它改名当成输出。
- 输出文件（\`summaries.yaml\` / \`experiences.yaml\`）**只能包含 YAML**：
  - 不要写 Markdown 标题或说明文字；
  - 不要用 \`\`\` 代码围栏把整段内容包起来；
  - 不要保留 \`<...>\` 占位符，全部换成真实内容。
- \`project_id\` 用对应任务文件顶部给出的值。
- summaries 每条：\`session_id\`（与任务文件里会话块标题的 id 完全一致）、\`title\`、\`value\`（只能是 none / low / medium / high 之一）、\`summary_markdown\`（用 \`|\` 块标量，正文缩进保持一致）。
- experiences 每条：\`title\`、\`summary\`、\`body_markdown\`、\`source_sessions\`（字符串数组）必填；\`slug\`、\`confidence\`（low / medium / high）可选。

### summaries.yaml 正确示例

\`\`\`yaml
project_id: proj_071be0c7a2e9ccc6
summaries:
  - session_id: cc_ab12cd34
    title: 修复切换租户后登录态丢失
    value: high
    summary_markdown: |
      ## 问题
      切换租户后登录态丢失。
      ## 关键决策
      统一在中间件按租户刷新 token。
      ## 结论
      已修复并补了回归测试。
\`\`\`

### experiences.yaml 正确示例

\`\`\`yaml
project_id: proj_071be0c7a2e9ccc6
experiences:
  - title: 多租户下的登录态刷新策略
    summary: |
      切换租户必须按租户维度刷新会话凭证。
    body_markdown: |
      ## 背景
      多租户切换会丢登录态。
      ## 方案
      中间件按租户统一刷新 token。
      ## 结论
      回归通过，沉淀为团队规范。
    source_sessions:
      - cc_ab12cd34
    confidence: medium
\`\`\`
`,
  },
]

function appendTargetGuidance(content: string, target: SkillTarget | null): string {
  if (!target) return content

  return `${content}
## 适配工具

本 skill 为 ${TARGET_NAMES[target]} 初始化。
`
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

export function listSkillTargets(): SkillTargetInfo[] {
  return SKILL_TARGETS.map((id) => ({ id, name: TARGET_NAMES[id] }))
}

export function listSkillTemplates(): SkillTemplateInfo[] {
  return SKILL_TEMPLATES.map((template) => ({
    directory: template.directory,
    relPath: join(SKILLS_BASE_DIR, template.directory, 'SKILL.md'),
  }))
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
    const content = appendTargetGuidance(template.content, options.target)
    if (options.force) {
      writeFileSync(filePath, content)
      continue
    }

    try {
      writeFileSync(filePath, content, { flag: 'wx' })
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error
      }
      written.pop()
      skipped.push(filePath)
    }
  }

  return { written, skipped }
}
