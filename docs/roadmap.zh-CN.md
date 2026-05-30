# 路线图

[English](./roadmap.md)

本文记录尚未进入当前版本的计划能力。已经发布的变更请查看 [CHANGELOG.md](../CHANGELOG.md)。

## 计划中

### 经验融合

命令：`llm-iwiki experiences merge <candidate-id> <experience-id>`

将候选经验合并到已有的已采纳经验中。该流程应先生成合并预览，让用户确认合并后的托管内容块，再更新已存储的经验正文和来源会话链接。

### 打开 Obsidian 笔记

命令：`llm-iwiki obsidian open <note-id>`

根据 `obsidian_notes` 记录，直接在 Obsidian 中打开已生成的笔记。

## 原则

- `README.md` 只保留安装、快速开始和常用命令。
- 已发布变更记录在 `CHANGELOG.md`。
- 当未来工作具备足够实现细节后，再拆成 GitHub Issues。
