# Roadmap

[简体中文](./roadmap.zh-CN.md)

This document tracks planned capabilities that are not part of the current release. Completed changes are recorded in [CHANGELOG.md](../CHANGELOG.md).

## Planned

### Experience Merge

Command: `llm-iwiki experiences merge <candidate-id> <experience-id>`

Merge a proposed experience into an existing accepted experience. The workflow should generate a preview first, let the user review the merged managed block, and only then update the stored experience and source-session links.

### Open Obsidian Note

Command: `llm-iwiki obsidian open <note-id>`

Open a generated note directly in Obsidian from its `obsidian_notes` record.

## Principles

- Keep `README.md` focused on installation, quick start, and common usage.
- Record released changes in `CHANGELOG.md`.
- Track larger future work as GitHub issues when implementation details are clear enough.
