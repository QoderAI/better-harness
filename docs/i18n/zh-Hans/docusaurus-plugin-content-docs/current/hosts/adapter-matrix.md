---
id: adapter-matrix
title: 适配矩阵
sidebar_position: 1
---

# 宿主适配矩阵

Better Harness 运行在你现有的编码智能体内。宿主差异只进入一个轻量适配层：
宿主 shell、已配置资产 provider、会话证据适配器和输出模式。规范的产品判断
保持与宿主无关。

## 宿主一览

| 宿主 | 定位 | Shell | 会话证据 | 默认输出 |
| --- | --- | --- | --- | --- |
| Qoder | 一等产品宿主 | `.qoder-plugin/` | Qoder 会话 | Qoder Canvas 报告 |
| Claude Code | 具备分析能力的源码本地宿主 | `.claude-plugin/` | 匹配当前工作区的本地 Claude 转录（存在时） | 自包含 HTML + Markdown |
| Codex | 具备分析能力的源码本地宿主 | `.codex-plugin/` | Codex 会话 | 自包含 HTML + Markdown |
| Cursor | 具备分析能力的源码本地宿主 | `.cursor-plugin/` | 工作区匹配的转录、元数据和审计日志；部分覆盖保持显式标注 | 自包含 HTML + Markdown |

`@qoderai/better-harness` npm 包含全部四个插件元数据根目录。生成的 Qoder
运行时 bundle 只包含 Qoder shell；非 Qoder 的生成宿主产物保持源码本地。

## 输出模式

- **Qoder Canvas** —— 渲染器负责的 `findings.json`、仅 Canvas 使用的
  `canvas.json` 和 `report.canvas.tsx`。
- **HTML 可视化** —— 面向 Claude Code/Codex/Cursor 的可移植契约，覆盖
  `findings.json`、`report.md` 和自包含的 `report.html`
  （见[在线 Demo](pathname:///demo/better-harness-report/)）。
- **纯 Markdown** —— 无视觉版本。

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
