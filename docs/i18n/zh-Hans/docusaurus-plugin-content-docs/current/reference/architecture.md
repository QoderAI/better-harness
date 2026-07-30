---
id: architecture
title: 架构
sidebar_position: 1
---

# 架构

![Better Harness 架构：宿主集成、三个独立证据智能体、由一个主导智能体统一分析、发现、宿主输出和修复](/img/better-harness-architecture-en.svg)

架构让三个证据域在主导智能体统一分析之前保持相互独立。每个结果都保留可见的
证据来源、负责人和验证路径。

## 前馈与反馈

Better Harness 使用
[前馈加反馈](https://martinfowler.com/articles/harness-engineering.html#FeedforwardandFeedback)
循环，把工作开始前可用的引导与智能体行动后可用的信号结合起来：

- **前馈引导** —— `AGENTS.md`、规格、Skills 和验收标准在智能体行动前引导它。
- **反馈传感器** —— Lint、测试、Hooks 和评审智能体观察结果，帮助智能体自我
  纠正。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `skills/` | 可重复的智能体工作流（从 `better-harness` 开始） |
| `models/` | 评估模型；默认模型在前，高级模型在后 |
| `references/` | 按需加载的文字指南 |
| `templates/` | 报告骨架、输出模式和样式 |
| `hooks/` | 改动时的强制检查 |
| `scripts/` | 按能力划分的 CLI |

## 底层运行的能力

| 能力 | CLI | 职责 |
| --- | --- | --- |
| Quickstart | `better-harness report` | 收集证据并交接给 skill |
| 就绪度分析 | `/better-harness` skill | 综合生成有证据支撑的报告 |
| 项目证据 | `better-harness core-change-watch` | 项目、历史、核心路径和 diff 信号 |
| 改动置信度 | `hooks/git-scripts/blast-radius` | 改动的符号图影响半径 |
| 依赖治理 | `better-harness dependency-governance` | 更新自动化、审计、过期依赖信号 |
| 会话证据 | `better-harness session-analysis` | 归一化 Qoder、Codex、Claude 或 Cursor 会话行为 |
| 智能体资产 | `better-harness coding-agent-practices inventory` | 盘点已配置的智能体接口 |
| 守护 | `hooks/`、`scripts/agent-guardrails` | 密钥扫描和生命周期检查 |

## 事实源

目录路由、模板归属和规范负责目录规则见
[`docs/ARCHITECTURE.md`](https://github.com/QoderAI/better-harness/blob/main/docs/ARCHITECTURE.md)。
