---
id: troubleshooting
title: 故障排查
sidebar_position: 4
---

# 故障排查

先对失败步骤做最小检查。不要把删除宿主缓存、插件目录、报告或用户配置作为第一
反应。诊断输出和公开 issue 中不要包含凭据、原始会话记录、私密提示词或完整报告。

如果独立 CLI 可用，请先运行只读生命周期检查：

```bash
better-harness plugin status --host all
better-harness doctor --platform all
```

这两个命令不访问远程注册表、不写配置、不执行安装命令，也不读取原始会话正文。
`partial`、`unobserved`、`manual` 或 `unavailable` 表示保留证据边界，不能据此推断
宿主已经加载插件。

## 看不到插件或 Skill

安装或更新 Better Harness 后，请开启新的宿主会话或任务。已有会话可能仍在使用
启动时加载的插件清单。然后执行该宿主支持的检查：

| 宿主 | 最小受支持检查 |
| --- | --- |
| [Claude Code](./installation?host=claude-code#claude-code) | 运行 `claude plugin details better-harness@better-harness`；详情中应包含 `Skills (1) better-harness`。 |
| [Codex](./installation?host=codex#codex) | Desktop 在 **Settings > Plugins** 中检查；CLI 运行 `codex plugin list --marketplace better-harness`。 |
| [Qoder](./installation?host=qoder#qoder) | Desktop 已内置；手动安装 CLI 插件后运行 `qodercli plugin list`；生命周期计划不会输出已经漂移的安装语法。 |
| [Cursor](./installation?host=cursor#cursor) | 运行 `better-harness plugin status --host cursor --surface agent`；在本机 Cursor help 合同完成核对前，安装保持不可用。 |
| [Qwen Code](./installation?host=qwen-code#qwen-code) | 运行 `qwen extensions list` 并确认其中包含 Better Harness，然后开启新会话并运行报告提示词。 |
| [GitHub Copilot](./installation?host=github-copilot#github-copilot) | 运行 `copilot plugin list` 和 `copilot skill list`；两处都应包含 `better-harness`。 |
| [Pi](./hosts/adapter-matrix#pi) | 运行 `pi --version`，然后在加载该 package 的新 Pi 会话中运行 `/better-harness`。 |
| [WorkBuddy](./hosts/adapter-matrix#workbuddy) | 运行 `codebuddy --plugin-dir .` 做本地专家团发现，并运行 `npm run workbuddy:verify` 做离线 manifest 校验。 |

如果 marketplace 命令失败，请返回对应宿主的安装标签页，逐字核对仓库源和命令。
特别是当前 Codex 先对仓库 URL 使用 `marketplace add`，再使用 `plugin add`。
如果本机原生 help 没有公开同样的合同，请不要复制旧版 Qoder 或 Cursor 安装示例；
生命周期计划会刻意返回手工或不可用状态。

## Cursor 源码本地加载当前不可用

已核对的原生 `cursor-agent` help 没有公开受支持的源码本地插件参数。不要复用旧版
启动命令，也不要因为仓库包含 `.cursor-plugin/plugin.json` 就推断当前运行时可以
加载这个源码检出。

请用 `better-harness plugin status --host cursor --surface agent` 检查有边界的会话
证据。在 Cursor 发布匹配的原生合同之前，Better Harness 没有可供排查的受支持安装
命令；应保留生命周期结果 `unavailable`，而不是把检出目录复制到全局插件目录。

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
| Pi | `<target>/.pi/better-harness/` | `findings.json`、`report.md`、`report.html` |
| WorkBuddy | `<target>/.workbuddy/better-harness/` | `findings.json`、`report.md`、`report.html` |

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
