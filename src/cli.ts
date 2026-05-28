export interface CliRuntime {
  cwd: string
  stdout: (message: string) => void
  stderr: (message: string) => void
}

const HELP = `llm-iwiki

Usage:
  llm-iwiki init
  llm-iwiki doctor
  llm-iwiki projects resolve <path>
  llm-iwiki projects rename <path-or-project-id> <display-name>
  llm-iwiki summarize apply --project <path> --file <summaries.yaml>
  llm-iwiki experiences propose --project <path> --file <experiences.yaml>
  llm-iwiki skills init [--target codex|claude-code|cursor] [--force] [--dry-run]
`

export async function runCli(args: string[], runtime: CliRuntime): Promise<number> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    runtime.stdout(HELP)
    return 0
  }

  runtime.stderr(`Unknown command: ${args.join(' ')}`)
  runtime.stderr(HELP)
  return 1
}
