---
id: troubleshooting
title: 故障排查
sidebar_position: 4
---

# 故障排查

先对失败步骤做最小检查。不要把删除宿主缓存、插件目录、报告或用户配置作为第一
反应。诊断输出和公开 issue 中不要包含凭据、原始会话记录、私密提示词或完整报告。

## 看不到插件或 Skill

安装或更新 Better Harness 后，请开启新的宿主会话或任务。已有会话可能仍在使用
启动时加载的插件清单。然后执行该宿主支持的检查：

| 宿主 | 最小受支持检查 |
| --- | --- |
| [Claude Code](./installation?host=claude-code#claude-code) | 运行 `claude plugin details better-harness@better-harness`；详情中应包含 `Skills (1) better-harness`。 |
| [Codex](./installation?host=codex#codex) | Desktop 在 **Settings > Plugins** 中检查；CLI 运行 `codex plugin list --marketplace better-harness`。 |
| [Qoder](./installation?host=qoder#qoder) | Desktop 已内置；手动安装 CLI 插件后运行 `qodercli plugin list`。 |
| [Cursor](./installation?host=cursor#cursor) | 使用 `cursor-agent --plugin-dir /path/to/better-harness` 启动，保持该进程打开，并在同一会话运行报告提示词。 |
| [Qwen Code](./installation?host=qwen-code#qwen-code) | 开启新会话并运行报告提示词；本指南不会假定未经验证的扩展列表命令。 |
| [GitHub Copilot](./installation?host=github-copilot#github-copilot) | 运行 `copilot plugin list` 和 `copilot skill list`；两处都应包含 `better-harness`。 |

如果 marketplace 命令失败，请返回对应宿主的安装标签页，逐字核对仓库源和命令。
特别是当前 Codex 先对仓库 URL 使用 `marketplace add`，再使用 `plugin add`；
Qoder CLI 使用 `plugin install`。

## Cursor 无法加载源码本地插件

传给 `--plugin-dir` 的值必须是本仓库根目录，而不是其中的 `.cursor-plugin` 或
`skills` 子目录。该根目录同时包含 `.cursor-plugin/plugin.json` 和
`skills/better-harness/SKILL.md`。

插件只对使用该参数启动的 Cursor Agent 进程生效。如果进程已经关闭，请用同一个
仓库路径重新启动。不要为了排查问题把检出目录复制到全局插件目录。

## 独立或源码 CLI 报告运行时版本不受支持

独立和源码 CLI 在 Windows、macOS 和 Linux 上支持 Node.js
`>=22.20.0 <25.0.0` 及 npm `>=10.9.3 <12.0.0`。请检查当前实际使用的可执行文件：

```bash
node --version
npm --version
```

切换到本仓库选定的运行时后再重试。不要绕过声明的 engine 范围，也不要为了隐藏
版本错误而修改 package lock。

## 源码 CLI 拒绝仓库目录

当 `--cwd` 为空、不存在、不可访问或不是目录时，`better-harness report` 会返回
`INVALID_CWD`。请从要检查的仓库中运行，或显式传入一个已存在的目录。从 Better
Harness 源码检出运行时，可用以下跨平台检查指向当前目录：

```bash
node scripts/better-harness.mjs report --cwd . --json
```

## 没有找到会话证据

会话证据缺失或不完整并不表示安装失败。Better Harness 会明确保留这一限制，而不
编造活动记录。从源码检出运行时，可以主动只检查静态项目证据：

```bash
node scripts/better-harness.mjs report --no-sessions
```

快速开始的会话探测默认使用 Qoder 数据根目录。如果该目录已被有意迁移，请通过
`--qoder-home` 传入已授权的位置：

```bash
node scripts/better-harness.mjs report --qoder-home /path/to/qoder-data
```

不要把搜索范围扩大到无关的用户目录，也不要在 issue 中附加原始会话文件。

## 报告已完成但找不到文件

行内输出或 `no-files` 输出本来就不会写入产物。对于持久化报告，请使用宿主最终
返回的准确报告链接。默认根目录和产物如下：

| 提供方 | 报告根目录 | 持久化产物 |
| --- | --- | --- |
| Qoder | `<target>/.qoder/better-harness/<run>/` | `findings.json`、`canvas.json`、`report.canvas.tsx` |
| Claude Code | `<target>/.claude/better-harness/<run>/` | `findings.json`、`report.md`、`report.html` |
| Codex | `<target>/.codex/better-harness/<run>/` | `findings.json`、`report.md`、`report.html` |
| Cursor | `<target>/.cursor/better-harness/<run>/` | `findings.json`、`report.md`、`report.html` |
| Qwen Code | `<target>/.qwen/better-harness/<run>/` | `findings.json`、`report.md`、`report.html` |
| GitHub Copilot | `<target>/.copilot/better-harness/<run>/` | `findings.json`、`report.md`、`report.html` |

`<target>` 指正在接受评审的仓库；只有当 Better Harness 源码仓库本身就是选定目标
时，它才表示当前源码检出。

## 收集限定范围的诊断信息

报告问题前，只记录复现失败步骤所需的信息：

- 从已安装插件元数据获取 Better Harness 版本；源码检出则运行
  `node scripts/better-harness.mjs --version`。
- 宿主及其版本、操作系统和安装方式。
- 失败的准确命令或功能，以及最小的有效错误信息。
- 最小复现、预期行为和实际行为。
- 仅当问题涉及源码 CLI 或运行时时，提供 Node.js 和 npm 版本。
- 问题涉及会话证据时，说明 `--no-sessions` 是否可用。

请移除 token、凭据、私密路径、原始提示词、会话记录，以及与复现无关的报告内容。

## 报告可复现的问题

如果以上检查仍未解决问题，请打开
[GitHub issue 选择页](https://github.com/QoderAI/better-harness/issues/new/choose)，
选择 **Bug report** 并提供上方限定范围的诊断信息。请先搜索已有 issue，只链接
可以安全共享的产物。
