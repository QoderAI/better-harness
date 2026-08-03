---
id: adapter-matrix
title: 适配矩阵
sidebar_position: 1
---

# 宿主适配矩阵

Better Harness 运行在你现有的编码智能体内。宿主差异只进入一个轻量适配层：
宿主 shell、已配置资产 provider、会话证据适配器和输出模式。规范的产品判断
保持与宿主无关。

## 支持层级

Better Harness 当前声明了八个能力层宿主适配器，其中六个已有验证过的公开
快速开始路径。Pi 与 WorkBuddy 以适配器支持展示，因为它们的安装方式和端到端
证据边界与这六个宿主不同。完整能力层事实源仍是
[规范适配器矩阵](https://github.com/QoderAI/better-harness/blob/main/docs/adapters/README.md)。

## 受支持的宿主适配器

| 宿主 | 公开入口 | 定位 | Shell | 会话证据 | 默认输出 |
| --- | --- | --- | --- | --- | --- |
| Qoder | 已验证快速开始 | 一等产品宿主 | `.qoder-plugin/` | Qoder 会话 | Qoder Canvas 报告 |
| Claude Code | 已验证快速开始 | 具备分析能力的源码本地宿主 | `.claude-plugin/` | 匹配当前工作区的本地 Claude 转录（存在时） | 自包含 HTML + Markdown |
| Codex | 已验证快速开始 | 具备分析能力的源码本地宿主 | `.codex-plugin/` | Codex 会话 | 自包含 HTML + Markdown |
| Cursor | 已验证快速开始 | 支持 Canvas 的源码本地宿主 | `.cursor-plugin/` | 工作区匹配的转录、元数据、审计日志和可选原生 Context Usage 快照；部分覆盖保持显式标注 | Cursor Canvas 报告 |
| Qwen Code | 已验证快速开始 | 具备分析能力的源码本地宿主 | `qwen-extension.json` | 匹配当前工作区的本地 Qwen 转录（存在时） | 自包含 HTML + Markdown |
| GitHub Copilot | 已验证快速开始 | 具备分析能力的源码本地宿主 | `.github/plugin/` | 工作区匹配的 Copilot CLI 转录；部分覆盖保持显式标注 | 自包含 HTML + Markdown |
| Pi | 适配器支持 | 具备分析能力的源码本地宿主 | `package.json` 中的 `pi` manifest | 匹配当前工作区的本地 Pi 会话 | 自包含 HTML + Markdown |
| WorkBuddy | 适配器支持 | 具备分析能力的源码本地宿主 | 无；Skill 使用 WorkBuddy 自有路径 | 匹配工作区的 WorkBuddy JSONL 转录 | 自包含 HTML + Markdown |

`@qoderai/better-harness` npm 包含全部六个插件元数据根目录。生成的 Qoder
运行时 bundle 只包含 Qoder shell。Pi 复用现有 `package.json` 中的安装元数据，
因此不会新增第七个文件系统元数据根目录；非 Qoder 的生成宿主产物保持源码本地。

## 输出模式

- **Qoder Canvas** —— 渲染器负责的 `findings.json`、仅 Canvas 使用的
  `canvas.json` 和 `report.canvas.tsx`。
- **Cursor Canvas** —— 使用 `cursor/canvas`、原生 Context Window 证据和
  IDE actions 渲染同一份完整报告契约。
- **HTML 可视化** —— 面向 Claude Code/Codex/Qwen/Copilot/Pi/WorkBuddy 的可移植契约，覆盖
  `findings.json`、`report.md` 和自包含的 `report.html`
  （见[示例报告](pathname:///demo/better-harness-report/)）。
- **纯 Markdown** —— 无视觉版本。

## 适配器支持边界

### Pi {#pi}

Pi 可以通过 `pi install <source>` 安装本仓库，或使用 `pi -e <source>` 加载。
包发现、已配置资产、工作区匹配的会话证据与可移植 HTML 路由均已实现。
在观察到完整交互式报告闭环冒烟验证前，Pi 仍不进入已验证快速开始集合。

### WorkBuddy {#workbuddy}

WorkBuddy 的已配置资产、工作区匹配的会话证据与可移植 HTML 路由均已实现。
本仓库不提供 WorkBuddy 安装 Shell、插件 manifest 或 npm 打包的宿主产物；安装
仍通过 WorkBuddy 自有的 `~/.workbuddy/skills` 或 Marketplace 入口完成。

## 能力覆盖

各宿主的能力刻意保持差异：没有真实证据源的宿主不会声称具备某项能力，
不受支持的行为会在读取私有数据或修改文件之前失败。逐能力的覆盖表、
TODO 列表和完成定义维护在仓库
[roadmap](https://github.com/QoderAI/better-harness/blob/main/roadmap.md) 中。

## 事实源

规范矩阵、发现规则和拆分触发条件见
[`docs/adapters/README.md`](https://github.com/QoderAI/better-harness/blob/main/docs/adapters/README.md)。

## 贡献新的宿主

请从[贡献新的 Coding Agent 宿主](./contributing-new-coding-agent)开始。
该指南会分别处理原生 Shell、已配置资产、会话、输出和打包声明，并链接
Qwen Code 与 GitHub Copilot PR 作为复盘示例。
