---
name: git-pr-npm-release
description: 规范创建分支、提交代码、创建 Pull Request、发布 npm 包的工作流程。当用户要求创建分支、提交代码、创建 PR、发起代码评审、发布或发版 npm 包、调整版本号、执行 npm publish，或提到分支、提交、PR、发版、发布 npm 包时使用。
---

# Git / PR / npm 发布流程

## 核心原则

- 未经用户明确要求，不提交、不推送、不创建 PR、不发布 npm 包。
- 不使用破坏性 Git 命令，例如 `git reset --hard`、`git clean -fd`、`git checkout --`、强制推送；除非用户明确要求并确认风险。
- 不修改 Git 全局或本地配置。
- 不提交敏感文件，例如 `.env`、密钥、证书、凭证、token 文件。
- 工作区可能包含用户已有改动。只处理本次任务相关文件，不回滚用户改动。
- 提交信息遵守用户模板：`<类型>(<范围>): <主题>`，正文和页脚按需要补充。
- 每次声称完成前，必须基于命令输出确认状态，不凭感觉汇报。

## 创建分支

触发场景：用户要求创建分支、开始新功能、切换到新分支。

1. 先检查当前状态：
   - `git status --short --branch`
   - `git branch --show-current`
2. 如果存在未提交改动，判断是否与本次任务相关：
   - 相关：继续在当前工作区处理。
   - 不相关：提醒用户当前有未提交改动，并询问是否继续、暂存、另建 worktree 或指定处理方式。
3. 分支命名优先使用简洁语义：
   - 功能：`feat/<short-topic>`
   - 修复：`fix/<short-topic>`
   - 文档：`docs/<short-topic>`
   - 重构：`refactor/<short-topic>`
   - 发布：`release/<version>`
4. 创建前确认目标基线分支；如果用户未指定，使用当前分支作为基线。
5. 执行后再次运行 `git status --short --branch` 确认当前分支。

## 提交代码

触发场景：用户要求提交、commit、生成提交信息或保存当前修改。

1. 并行收集信息：
   - `git status --short`
   - `git diff`
   - `git diff --staged`
   - `git log --oneline -5`
2. 分析变更，确认只提交本次任务相关文件。
3. 如有未跟踪文件，逐个判断是否应加入提交；不要盲目 `git add .`。
4. 提交信息格式：

   ```text
   <类型>(<范围>): <主题>

   <正文>

   <页脚>
   ```

   常用类型：
   - `feat`: 新功能
   - `fix`: 缺陷修复
   - `docs`: 文档
   - `refactor`: 重构
   - `test`: 测试
   - `chore`: 工程杂项
   - `release`: 发布版本
5. 提交前根据项目习惯运行必要校验，例如 lint、test、typecheck；如果无法运行，说明原因。
6. 使用 heredoc 传递提交信息：

   ```bash
   git commit -m "$(cat <<'EOF'
   feat(scope): concise subject

   Body when needed.
   EOF
   )"
   ```
7. 提交后运行 `git status --short --branch` 确认结果。
8. 如果 pre-commit hook 自动修改了文件：
   - 先检查修改内容。
   - 只有当刚刚的成功提交由当前 agent 创建、尚未推送、且 hook 修改应并入同一提交时，才可考虑 `git commit --amend`。
   - 如果提交失败或被 hook 拒绝，不要 amend；修复问题后创建新的提交。

## 创建 PR

触发场景：用户要求创建 PR、Pull Request、合并请求或发起代码评审。

1. 先确认分支与远端状态：
   - `git status --short --branch`
   - `git remote -v`
   - `git branch -vv`
   - `git log --oneline --decorate -10`
2. 确认目标 base 分支；用户未指定时，优先从仓库默认分支或当前分支追踪关系判断，不确定就询问。
3. 汇总当前分支相对 base 的变更：
   - `git diff <base>...HEAD`
   - `git log --oneline <base>..HEAD`
4. 创建 PR 前确认：
   - 没有不应进入 PR 的本地改动。
   - 当前分支已推送到远端；如未推送，只有在用户明确要求创建 PR 时才执行 `git push -u origin HEAD`。
   - 必要校验已运行，或已说明无法运行的原因。
5. PR 标题使用简洁中文或项目既有风格。
6. PR 描述使用：

   ```markdown
   ## Summary
   - 

   ## Test plan
   - 
   ```
7. 创建完成后向用户返回 PR URL，并说明已运行的校验。

## 发布 npm 包

触发场景：用户要求发布 npm 包、发版、release、bump version、`npm publish`。

1. 发布是高风险操作；必须先获得用户明确授权，且确认目标包、版本、tag、registry。
2. 发布前检查：
   - `git status --short --branch`
   - `npm whoami`
   - `npm config get registry`
   - `npm view <package-name> version`
   - `npm view <package-name> dist-tags --json`
3. 读取 `package.json`，确认：
   - `name`
   - `version`
   - `private`
   - `publishConfig`
   - `files`
   - `main`、`module`、`types`、`exports`
   - `scripts`
4. 根据项目习惯运行发布前校验：
   - 安装依赖状态检查。
   - lint、test、typecheck、build。
   - `npm pack --dry-run`，确认产物内容。
5. 版本变更：
   - 未经用户确认，不自动 bump version。
   - 用户未指定版本策略时，询问 patch、minor、major、prerelease 或指定版本。
   - 遵守仓库现有 release 工具；如果项目使用 changesets、release-it、semantic-release 或自定义脚本，优先使用项目工具。
6. 发布命令需根据确认结果执行：
   - 稳定版通常使用 `npm publish`。
   - 预发布通常使用 `npm publish --tag <tag>`。
   - workspace 包发布时，明确包路径或 workspace 参数。
7. 发布后验证：
   - `npm view <package-name> version`
   - `npm view <package-name> dist-tags --json`
   - 如适用，检查 Git tag、GitHub Release 或 changelog。
8. 发布结果汇报必须包含：
   - 包名
   - 版本
   - registry
   - dist-tag
   - 执行过的校验

## 需要先询问用户的情况

- 是否提交、推送、创建 PR 或发布 npm 包不明确。
- 当前工作区存在与本次任务无关的改动。
- 目标 base 分支、版本号、npm dist-tag 或 registry 不明确。
- 发布前校验失败，但用户仍想继续。
- 需要执行破坏性命令、强制推送或覆盖远端状态。
