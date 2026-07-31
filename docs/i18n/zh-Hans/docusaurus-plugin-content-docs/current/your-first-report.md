---
id: your-first-report
title: 你的第一份报告
sidebar_position: 3
---

# 你的第一份报告

[安装](./installation.mdx)完成后，打开要分析的仓库并开启新的会话或任务。请使用
对应宿主 **验证安装** 小节里的调用方式——不同宿主的语法并不相同：

- Claude Code、Qoder、Cursor 和 Qwen Code 使用文档中的 `/better-harness`
  报告提示词。
- Codex Desktop 使用 `@better-harness`；Codex CLI 使用
  `$better-harness:better-harness`。
- 对于 GitHub Copilot，请先确认 `copilot skill list` 包含 `better-harness`，
  再让 Copilot 使用该 Skill 完成分析。本站不会声称未经验证的斜杠命令别名。

Better Harness 会把行为论断限定在相关的 Task Episode 和周边的项目机制内。
Qoder 产出 Canvas 报告；Claude Code、Codex、Cursor、Qwen Code 和 GitHub Copilot
产出自包含 HTML 并配套 Markdown。缺失或不完整的证据保持显式标注。

想了解 HTML 输出的样子，可以查看
[示例报告](pathname:///demo/better-harness-report/)。

## 阅读报告

报告由 Agent Work Loop 五维概览、按优先级排序的发现、检测到的智能体资产和
证据简报组成。请通过[五个工作循环问题](./concepts/agent-work-loop.md)来阅读
它；会话证据改变的是置信度和覆盖范围，而不是模型本身。

## 从报告到行动

报告是循环的起点，不是终审判决。每条发现都是一行带下一步动作的条目，让分数
变成实际改变：

1. **起草限定范围的修复。** 运行 `/better-harness repair-plan` 验证单条发现
   并起草限定范围的修复方案，不产生新的报告产物。
2. **给重复工作指定负责机制。** 当某条发现看起来是重复劳动时，通过
   [Loop Discovery](https://github.com/QoderAI/better-harness/blob/main/references/loop-engineering/loop-discovery.md)
   选出最小的持久化负责者：skill、hook、脚本、自动化或规则。
3. **安排后续跟进。** 具备调度条件的发现会渲染出行级
   `/schedule /better-harness` 交接，带节奏、验证方式和停止条件。
4. **确认改进落地。** 重新运行分析，检查改动已生效、能力信号有变化。

## 纯静态检查

从源码仓库出发，可以在不读取本地会话的情况下检查仓库证据：

```bash
node scripts/better-harness.mjs report --no-sessions
```
