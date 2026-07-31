---
id: introduction
title: 简介
sidebar_position: 1
---

# 简介

**Better Harness** 为 Agent Work Loop 提供开源洞察。它在你已经使用的 Coding
Agent 中运行，把项目与会话证据转化为有优先级的改进和可验证的下一步。

## 为什么需要 Better Harness？

AI 编码智能体改代码很快，但围绕它的工作流往往才是薄弱环节：

- 🎯 **目标模糊** —— 智能体自信地解决了错误的问题。
- 🧭 **步骤随意** —— 工作发生在没人能复现的路径上。
- ✅ **"能跑"但没有证据** —— 验证不完整或缺失。
- 🚢 **速度压过安全** —— 评审和交付检查被绕过。
- 🧠 **经验流失** —— 同样的摩擦在下一个任务中重演。

只评审最终 diff 会漏掉这些系统级问题。Better Harness 分析的是 diff 背后的
工作流：收集项目证据（在受支持的宿主上还包括会话证据），评估五个相互关联的
维度，并把具体差距转化为按优先级排序的发现——每条都绑定证据、期望结果、
修复边界和验证路径，让团队可以一次改进一个问题。

## 开放了什么

Better Harness 开放的是三个相互连接的层，而不只是一个斜杠命令提示词：

- **工程实践** —— 覆盖
  [Session Evidence、Project Harness、Agent Customize 和 Loop Engineering](https://github.com/QoderAI/better-harness/blob/main/references/README.md)
  的证据与判断指南。
- **评估模型** —— 以任务为中心的
  [Agent Work Loop](./concepts/agent-work-loop.md)，包括证据状态、发现、
  评分边界和纵向验证。
- **可运行实现** —— 规范的
  [`/better-harness` 工作流](https://github.com/QoderAI/better-harness/blob/main/skills/better-harness/SKILL.md)、
  证据收集器、分析器、渲染器和轻量的[宿主适配层](./hosts/adapter-matrix.md)。

三层共享同一条边界：已配置的资产只能证明某个机制存在，只有关联的任务证据
才能证明它被使用过或改善了结果。

## 刻意保持诚实

未被观察到的行为会保持显式标注，而不会变成没有依据的分数或论断。通过当前
检查只能证明该干预被执行过；只有可比的后续结果才能证明循环真的改善了。

## 下一步

- 先检查[前置条件](./installation.mdx#prerequisites)，再为你的编码智能体安装
  Better Harness。
- [生成你的第一份报告](./your-first-report.md)。
- 理解每份报告背后的 [Agent Work Loop](./concepts/agent-work-loop.md)。

:::info 事实源
本站是策展视图。规范判断存放在
[代码仓库](https://github.com/QoderAI/better-harness)的 `skills/`、
`models/`、`references/` 与 `docs/` 目录中。
:::
