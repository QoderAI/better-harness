---
id: glossary
title: 术语表
sidebar_position: 3
---

# 术语表

报告和文档中词汇的一站式解码器。入门只需要两个术语：**生命周期维度**和
**报告**。下面的内容都是按需加载的渐进式细节。

## 三行心智模型

- **Harness** 包裹目标对象，让智能体能运行一个有边界、可恢复的循环：
  理解 → 改动 → 验证 → 修复 → 再验证 → 说明残余风险。
- Better Harness 从 Agent Work Loop 出发，用可用的会话和项目证据对其进行
  限定，在改动发生时守护改动，并把学到的内容反哺回规则。
- 会话证据改变的是置信度和覆盖范围，不是模型本身。

## 核心概念

| 术语 | 含义 |
| --- | --- |
| Harness | 智能体周围的工程环境，让改动循环有边界且可恢复。 |
| The loop | `understand context -> bounded change -> choose validation -> interpret failure -> repair -> re-run validation -> state residual risk` |
| Agent Work Loop | 默认的 `/better-harness` 模型：Harness 支持什么、可观察时智能体实际做了什么、任务循环在哪里失控、下一步该改进什么。 |
| Task Episode | 一个用户目标加一个验收边界；行为论断的评审单元。 |
| Software Fluency | 用于显式仓库静态评分和独立项目证据评审的静态视角。 |
| 渐进式披露 | 按任务向智能体披露上下文，而不是一次性全部给出。 |

## 视角与模型

| 术语 | 含义 |
| --- | --- |
| 五个生命周期维度 | 任务理解、可控执行、改动验证、可靠交付、经验沉淀。 |
| 五个软件能力 | Context Map、Environment Readiness、Fast Feedback、Quality Gates、Change Safety。 |
| AI Readiness Ladder | L1–L5 成熟度阶梯（Awareness → Assisted → Structured → Spec-Governed → Closed-Loop）。 |
| Style | 报告的视觉呈现（analyst、audit scorecard、consulting deck、dashboard 等）。 |
| 输出模式 | 报告的渲染形态：Qoder Canvas、HTML 可视化或 Markdown。 |

## 证据与评分

| 术语 | 含义 |
| --- | --- |
| 证据边界 | 区分静态文件证据与已执行命令、CI、运行时或 UI 证据的规则；未验证的区域限制置信度上限。 |
| 证据状态 | `Present`、`Wired`、`Exercised`、`Outcome-supported`、`Missing`、`Unobserved` 或 `Not applicable`——见 [Agent Work Loop](./agent-work-loop.md)。 |
| 置信度 | 低/中/高评级，绑定实际执行了多少（而非只是阅读）。 |
| 改动置信度 | 一个 AI 生成的改动是否可以落地，由影响半径、敏感路径、规模和验证情况判断。 |

## 行动循环（报告 → 改变）

| 术语 | 含义 |
| --- | --- |
| Handoff | 报告内行级的下一步动作（起草修复、安排跟进），而不是死胡同式的分数。 |
| 修复方案 | 针对单条发现的有边界修复方案，通过 `/better-harness repair-plan` 起草，不产生报告产物。 |
| Loop Engineering | 判断是否存在重复工作、应由哪个持久化机制（skill、hook、脚本、自动化、规则）承接的领域。 |
| Loop Discovery | 用证据证明循环存在并选出最小持久化负责者的路由关卡。 |
| Schedule-ready | 稳定到可以变成周期性 `/schedule /better-harness` 跟进的发现，带节奏、验证方式和停止条件。 |

## 扩展与宿主

| 术语 | 含义 |
| --- | --- |
| Skill | 由 `SKILL.md` frontmatter 加简洁工作流定义的可重复智能体工作流。 |
| 宿主适配层 | 按宿主的发现与证据形态胶水层；保持引擎与宿主无关。 |
| 宿主 shell | 轻量宿主元数据（`.claude-plugin/`、`.qoder-plugin/`、`.cursor-plugin/`、`.codex-plugin/`、`.github/plugin/`、`qwen-extension.json`、`package.json` 中的 `pi` manifest、`.codebuddy-plugin/` + `settings.json` + `agents/` 或未来的生命周期 shell），暴露规范行为但不拥有产品逻辑；公共 npm 包包含当前八个原生元数据根目录，而 Qoder 运行时 bundle 只包含 `.qoder-plugin/`。 |
| 规范负责目录 | 唯一拥有某行为产品判断的目录；宿主 shell 和镜像都指回它。 |

带负责方链接的完整术语表见
[`docs/glossary.md`](https://github.com/QoderAI/better-harness/blob/main/docs/glossary.md)。
