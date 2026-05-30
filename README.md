# llm-iwiki

Turn local AI coding sessions into a searchable Obsidian knowledge base.

`llm-iwiki` collects sessions from Claude Code, Cursor, Codex, Gemini, and CodeBuddy, normalizes them by project in SQLite, prepares AI-friendly summarization tasks, stores accepted project learnings, and exports navigable Markdown notes to Obsidian.

## Features

- Collect local AI coding sessions across multiple tools.
- Resolve sessions by project, repository, path, or slug.
- Generate summarization and experience-extraction task files for AI assistants.
- Review and accept reusable engineering experiences before publishing them.
- Export project summaries, session notes, and project-scoped experiences to Obsidian.
- Preserve user-written note sections while updating managed content blocks.
- Search session summaries and accepted experiences from the CLI.

## Requirements

- Node.js 20 or newer at runtime.
- Bun for local development, testing, and building.

SQLite is provided by `better-sqlite3`; prebuilt binaries are installed automatically by npm where available.

## Installation

```bash
npm install -g @codehourra/llm-iwiki
```

You can also run it without installing globally:

```bash
npx @codehourra/llm-iwiki --help
```

## Quick Start

```bash
llm-iwiki init
llm-iwiki sync
llm-iwiki projects list
llm-iwiki projects inspect .
```

Configure an Obsidian vault and export notes:

```bash
llm-iwiki config set obsidian.vault ~/Obsidian/Vault
llm-iwiki summarize prepare changed --project .
llm-iwiki summarize apply --project . --file .llm-iwiki/exchange/summaries.yaml
llm-iwiki experiences prepare --project . --from changed-summaries
llm-iwiki experiences propose --project . --file .llm-iwiki/exchange/experiences.yaml
llm-iwiki experiences candidates --project .
llm-iwiki experiences accept <candidate-id>
llm-iwiki obsidian export --project .
```

The `prepare` commands generate task files for an AI assistant. Write the corresponding YAML files from those task files, then apply/propose them with the commands above.

## Common Commands

```bash
llm-iwiki sync [--project <path>]
llm-iwiki projects list
llm-iwiki projects inspect <project>
llm-iwiki projects dedupe
llm-iwiki sessions list --project <project>
llm-iwiki sessions read <session-id>
llm-iwiki summarize prepare [changed|all] --project <project>
llm-iwiki summarize apply --project <project> --file <summaries.yaml>
llm-iwiki experiences prepare --project <project> [--since 30d]
llm-iwiki experiences propose --project <project> --file <experiences.yaml>
llm-iwiki experiences accept <candidate-id>
llm-iwiki search <sessions|experiences> <query>
llm-iwiki obsidian export [--project <project>|--all]
llm-iwiki obsidian check
```

`<project>` can be a local path, a `proj_xxx` id, a display name, or a slug. If multiple projects match, use `projects list` to pick the exact project id.

## Obsidian Output

Exports are written under `LLM-iWiki/` in your configured vault:

```text
LLM-iWiki/
├── README.md
├── Projects/
│   └── <project-slug>/
│       ├── Project Summary.md
│       ├── sessions/
│       └── experiences/
└── Topics/
```

Generated notes use frontmatter plus an `aiwiki:managed` block. You can write your own notes outside the managed block; re-exporting preserves those sections unless `--force` is used.

## AI Assistant Skill

Install the bundled `aiwiki-knowledge` skill into the current project:

```bash
llm-iwiki skills init [--target codex|claude-code|cursor] [--force] [--dry-run]
```

The skill teaches compatible assistants how to run the `sync -> summarize -> experiences -> export` workflow and how to produce valid YAML for `summarize apply` and `experiences propose`.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

This project uses Changesets for versioning, changelog generation, and npm publishing:

```bash
bun run changeset
bun run version-packages
bun run release
```

User-facing changes should include a `.changeset/*.md` file. GitHub Actions creates the release PR and publishes to npm after the release PR is merged.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE)
