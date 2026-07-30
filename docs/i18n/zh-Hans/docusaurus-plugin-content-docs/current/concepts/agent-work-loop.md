---
id: agent-work-loop
title: Agent Work Loop
sidebar_position: 1
---

# Agent Work Loop

**Agent Work Loop（智能体工作循环）** 评审一个编码智能体 Harness 能否把一个
任务从清晰的意图带到经过验证、可靠交付的结果，并把有据可依的学习机会转化为
长期有效的改进。它不是强制流程、转录评分、资产清单或仓库成熟度模型。

![Agent Work Loop：从任务理解到经验沉淀的五个维度](/img/agent-work-loop-en.svg)

## 被评审的循环

一个好的 Harness 让智能体能完成一个有边界、可恢复的循环：

```text
understand context -> make a bounded change -> choose the right validation ->
interpret failure -> repair -> re-run validation -> state residual risk
```

## 五个维度

| 维度 | 回答的问题 | 支撑机制 |
| --- | --- | --- |
| **任务理解**（Task Understanding） | 智能体是否清楚目标，以及"完成"意味着什么？ | 规则、`AGENTS.md`、规格、`DESIGN.md` |
| **可控执行**（Controlled Execution） | 工作是否运行在受支持、可重复的路径上？ | Skills、命令、MCP 工具、沙箱边界 |
| **改动验证**（Change Validation） | 是否有证据表明改动真的有效？ | 测试、Lint、Hooks、可观测诊断 |
| **可靠交付**（Reliable Delivery） | AI 的速度是否绕过了质量检查或验收？ | 人工评审、审批、CI/CD、恢复路径 |
| **经验沉淀**（Learning Capture） | 下一个任务能否从这一个任务中受益？ | Loop Discovery、可复用 SDLC Skills、Memory |

每个维度在评分前需要先解决三个稳定的检查项（共十五个检查 id）。经验沉淀的
评分独立于前四个维度。

## 评审单元：Task Episode

一个 **Task Episode** 是一个用户目标加一个验收边界。它可以跨越多轮对话或多个
会话，但每条论断都必须绑定同一个目标、对象、动作和结果。不会因为工作发生在
同一个会话里就合并不相关的内容，聚合计数也不会被当成任务行为。

当符合条件的会话证据不完整或不可用时，评审保持为 `session-limited` 的
Agent Work Loop 评审：不可用的行为保持 `Unobserved`，项目 Harness 证据只
支撑它能支撑的机制。

## 证据状态

- `Present`：存在有归属的机制或评审契约；
- `Wired`：相关任务、触发器或负责路径可以触达它；
- `Exercised`：某个关联的 episode 或检查使用过它并留有结果；
- `Outcome-supported`：可比的后续结果支持所声称的效果；
- `Missing`：经检查的证据确认所需机制或结果缺失；
- `Unobserved`：现有观察边界无法判断；
- `Not applicable`：经检查的任务与项目证据证明它不适用。

证据状态不是通过/失败。被执行的操作可能暴露缺陷，安全的拒绝可能是正确行为，
不可用的外部边界是 `Unobserved`，不会自动变成 `Missing`。

## 证据限定评分置信度

对当前任务相关的四个维度，最高被支持的证据状态设定分数上限：

| 最高被支持的证据 | 绝对分数上限 |
| --- | --- |
| `Missing`、`Unobserved` 或 `Not applicable` | 59 |
| `Present` | 74 |
| `Wired` | 84 |
| `Exercised` | 94 |
| `Outcome-supported` | 100 |

这些是上限，不是评分公式。已配置的能力不等于被观察到的使用；只有
`Outcome-supported` 的后续对比才允许声称某项干预改善了后续工作。

## 完整模型

完整契约——检查表、发现、评分边界和纵向验证——见
[`models/agent-work-loop.md`](https://github.com/QoderAI/better-harness/blob/main/models/agent-work-loop.md)。
