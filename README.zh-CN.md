# llm-iwiki

[English](./README.md)

[![npm version](https://img.shields.io/npm/v/@codehourra/llm-iwiki.svg)](https://www.npmjs.com/package/@codehourra/llm-iwiki)
[![npm downloads](https://img.shields.io/npm/dm/@codehourra/llm-iwiki.svg)](https://www.npmjs.com/package/@codehourra/llm-iwiki)
[![Node.js](https://img.shields.io/node/v/@codehourra/llm-iwiki.svg)](https://www.npmjs.com/package/@codehourra/llm-iwiki)
[![Release](https://github.com/CodeHourra/llm-iwiki/actions/workflows/release.yml/badge.svg)](https://github.com/CodeHourra/llm-iwiki/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Changelog](https://img.shields.io/badge/changelog-CHANGELOG.md-blue)](./CHANGELOG.md)

把本地 AI 编程会话沉淀为可检索的 Obsidian 知识库。

`llm-iwiki` 会采集 Claude Code、Cursor、Codex、Gemini 和 CodeBuddy 的本地会话记录，按项目归一化到 SQLite，生成适合 AI 助手处理的总结任务，保存经过确认的项目经验，并导出为可导航的 Obsidian Markdown 笔记。

## 功能特性

- 采集多个 AI 编程工具的本地会话记录。
- 按项目、仓库、路径或 slug 解析和归类会话。
- 为 AI 助手生成会话总结和经验提取任务文件。
- 在发布到知识库前审核并采纳可复用的工程经验。
- 导出项目摘要、会话笔记和项目经验到 Obsidian。
- 更新托管内容块时保留用户手写区域。
- 通过 CLI 检索会话摘要和已采纳经验。

## 环境要求

- 运行时需要 Node.js 20 或更高版本。
- 本地开发、测试和构建需要 Bun。

SQLite 由 `better-sqlite3` 提供；npm 安装时会自动下载可用的预编译二进制。

## 安装

```bash
npm install -g @codehourra/llm-iwiki
```

也可以不全局安装，直接使用 `npx`：

```bash
npx @codehourra/llm-iwiki --help
```

## 快速开始

```bash
llm-iwiki init
llm-iwiki sync
llm-iwiki projects list
llm-iwiki projects inspect .
```

配置 Obsidian 库并导出笔记：

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

`prepare` 命令会生成供 AI 助手阅读的任务文件。根据任务文件编写对应 YAML 后，再用上面的 `apply` / `propose` 命令落库。

## 常用命令

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

`<project>` 可以是本地路径、`proj_xxx` 项目 id、展示名或 slug。如果匹配到多个项目，请先用 `projects list` 找到准确的项目 id。

## Obsidian 输出结构

导出内容会写入已配置 vault 下的 `LLM-iWiki/` 目录：

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

生成的笔记包含 frontmatter 和 `aiwiki:managed` 托管内容块。你可以在托管块之外自由补充内容；重新导出时会保留这些手写内容，除非显式使用 `--force`。

## AI 助手 Skill

将内置的 `aiwiki-knowledge` skill 安装到当前项目：

```bash
llm-iwiki skills init [--target codex|claude-code|cursor] [--force] [--dry-run]
```

这个 skill 会教兼容的 AI 助手如何执行 `sync -> summarize -> experiences -> export` 流程，以及如何为 `summarize apply` 和 `experiences propose` 生成合法 YAML。

## 开发

```bash
bun install
bun run typecheck
bun test
bun run build
```

项目使用 Changesets 管理版本号、变更记录和 npm 发布：

```bash
bun run changeset
bun run version-packages
bun run release
```

面向用户的变更应包含一个 `.changeset/*.md` 文件。GitHub Actions 会创建发布 PR，并在发布 PR 合并后发布到 npm。

## 变更记录

见 [CHANGELOG.md](./CHANGELOG.md)。

## 路线图

见 [docs/roadmap.zh-CN.md](./docs/roadmap.zh-CN.md)。

## 许可证

[MIT](./LICENSE)
