---
slug: harness-inspector
title: "Harness Inspector：看清一次 Agent 交付，从需求到提交"
description: Session 日志只能告诉你 Agent 做了什么，却无法解释任务为何开始、哪些行为真正进入了代码库。Harness Inspector 把需求、Session、文件活动和 Git Commit 重新连接成一条可以读懂的交付链路。
date: 2026-08-14T10:00:00+08:00
authors: [qoder]
tags: [better-harness, harness-inspector, coding-agent, provenance, agent-skills]
---

最近，我们一直在尝试优化 Better Harness 的 **SKILL 自动沉淀**能力：从 Agent 的真实会话中识别重复出现的工作路径，再判断其中哪些经验值得进一步沉淀成可复用的 SKILL。真正做起来以后，我们发现这件事远比“把一段 Session 分析一遍”复杂得多。

对于一次软件开发任务来说，Agent 的行为并不是孤立发生的。它从一个需求或者用户故事开始，经过对需求的理解、上下文探索、代码修改和验证，最终才形成一次可以被评审的代码贡献。只看中间的 Session，我们能看到 Agent 做了什么，却很难判断这些行为为什么发生，又有哪些行为真正进入了最后的交付。

因此，我们开始把一次 Agent 的交付理解成一条连续的链路。现在，只需要在项目目录执行：

```bash
npx @qoder-ai/better-harness inspector
```

就可以生成一个本地、只读的 Harness Inspector 页面，把当前项目中的 Agent Session、文件活动和 Git Commit 放到同一个交互界面里。

<!-- truncate -->

GitHub：[https://github.com/QoderAI/better-harness](https://github.com/QoderAI/better-harness)

## 从 Session 到一次完整的交付过程

Harness Inspector 最初只是一个会话调试工具：帮助我们查看 Agent 说了什么、调用了哪些工具，以及修改了哪些文件。但随着 Session、文件活动和 Git 历史逐渐被连接起来，我们发现，真正需要观察的并不是会话本身，而是：

> 一次软件变更如何从一个意图出发，经过 Agent 的执行，最终形成可以进入工程系统的产出。

Session 只是这条链路的中间部分。

### 从意图到产出的交付链

我们将一次 Coding Agent 的交付拆成三个连续、但边界不同的部分：

![意图、过程与产出构成一条从需求到提交的交付链](/img/harness-inspector-architecture-en.svg)

- **意图（Intent）** 是一次变化的语义化起点，例如用户的需求、Issue、Spec 或者架构约束。
- **过程（Process）** 体现的是这次变化真正发生的过程，对于 Agent 来说，主要体现为 Session 记录以及其中的搜索、读取、修改和验证。
- **产出（Output）** 则是 Agent 交付到工程系统的最终结果，现阶段最清晰的锚点就是代码 Commit。

所以，Story、Session 和 Commit 并不是三个并列的抽象概念，它们分别是 **Intent、Process 和 Output 在当前软件开发工具链中的可观察对象**（意图在不同场景下也可能表现为 Issue 或 Spec）。Harness Inspector 要做的，也不是把一段对话展示得更完整，而是重新建立这条从需求到提交、可以追溯的交付链路。

从叙述上看，它是一条连续的交付链；但在真实项目中，它更接近一张证据图。一个 Story 可能经历多个 Session，一段 Session 也可能涉及多个 Commit。

### 一个简单的示例：从 Story 到 Commit

我们在 Better Harness 文档页创建了一个只读的公开样本（英文示例数据，不读取本地内容）：[https://qoderai.github.io/better-harness/inspector](https://qoderai.github.io/better-harness/inspector)。

只看 Session，我们只能看到它是一串搜索、读取、修改和测试活动，很难确定它是否一直围绕最初的需求展开，也不知道其中哪些修改真正进入了代码库。单独看 Commit，我们虽然可以看到最终修改了哪些文件，却无法知道 Agent 在提交之前如何理解问题、建立上下文和完成验证。

当 Story、Session 和 Commit 被放到同一个界面后，这次变化才成为一段相对完整的交付过程：Story 说明为什么要修改，Session 展示修改是怎样发生的，Commit 则记录最后留下了什么。

把需求、Agent 行为和代码提交连接起来，让我们第一次能够从整体上检查一次交付。但真正打开一些包含数百次 Tool Call 的真实 Session 后，另一个问题很快出现了：**能够把一次交付连接起来，并不意味着我们已经能够读懂它。**

## Harness Inspector 如何读懂一次 Agent 交付？

围绕 Better Harness 的 Harness 模型，我们将 Harness Inspector 定义为：

> **Harness Inspector 是一个面向 Agent 交付过程的本地、只读工作台。它将需求、Agent Session、文件活动和 Git Commit 放在同一个交互界面中，用来检查一次软件变化为什么发生、怎样发生，以及最终留下了什么。**

Harness Inspector 以一次完整交付为中心，围绕从需求到提交的链路，提供了三种观察方式：

- **Workbench**：查看需求、Session 与 Commit 之间的关系；
- **Trace**：查看 Session 内部的工作结构；
- **Replay**：按照事件顺序重新观察任务如何展开。

简单来说，**Workbench 看关系，Trace 看结构，Replay 看顺序**。三者共同帮助我们还原一个需求如何经过 Agent 的理解、探索、修改和验证，最终形成一次可以被评审的代码提交。

### Workbench：连接需求、过程与产出

Workbench 是一次交付的整体视图。在左侧，我们可以看到触发这段 Session 的用户需求，以及执行过程中对目标的补充和调整；中间展示 Agent 在 Session 中发生的搜索、读取、工具调用和 Git 操作；右侧则是当前范围内观察到的 Commit，以及它最终修改的文件。

它关注的不是简单地把数据放在一起，而是展示需求、过程和产出之间**已经观察到**的关系。关系证据不足时，Inspector 会继续把它保留为候选或未映射，而不是自动拼出一条看起来完整的交付路径。

### Trace：把 Session 读成一条工作轨迹

Workbench 帮助我们找到一次交付，Trace 则进一步展开其中的 Session。

进入 Session 后，Trace 会按照 Turn 组织用户输入、中间回复、Tool Call 和文件活动，并通过顶部的时间轴连接事件在时间上的位置。点击某个区段可以跳转到对应调用，连续重复的活动也会被折叠，避免大量相似操作淹没真正重要的变化。

Trace 并不试图还原模型没有暴露的思考过程，而是将已经记录下来的行为重新组织成一条可以阅读的工作轨迹，帮助我们检查 Agent 如何搜索上下文、修改代码和执行验证。

### Replay：沿事件顺序回看一次交付

Replay 则沿着已经保留的事件逐步回看任务如何展开。Reviewer 可以依次查看用户输入、Agent 回复、Tool Call、文件和 Commit，观察 Agent 在什么上下文中形成方向，又在什么时候进行了修改和验证。

它只是一次只读的证据回放，不会重新运行工具、恢复工作区或者继续原来的 Session；没有精确时间的内容，也只保留顺序，不会补充没有被记录的过程。

Workbench 建立交付上下文，Trace 展开 Session 的工作轨迹，Replay 补充事件发生的顺序。三者共同把一次从需求到提交的 Agent 交付，变成可以逐层进入和检查的过程。当我们真正把一次交付读清楚之后，就可以回到最初的问题：这条轨迹里，哪些经验真正值得留下来。

## 从交付证据到 SKILL 沉淀

当一次交付能够被看清之后，我们才能重新回到最初的问题：Session 中的哪些经验，真正值得沉淀成 SKILL？答案显然不是出现次数最多的 Tool Call。Agent 可能因为上下文不足而反复读取同一个文件，也可能因为命令失败不断重试；这些行为虽然频繁出现，却更可能是一次交付中的噪声，而不是值得复用的工程经验。

真正值得沉淀的，通常是一条能够在相似任务中重复出现，并且得到最终产出与验证结果支持的工作路径。例如，Agent 如何从需求中确定修改边界，如何建立必要的上下文，又如何完成修改、执行验证并检查最终结果。只有把这些行为放回对应的 Story、Session 和 Commit 中，我们才能判断它们是当前任务中的偶然选择，还是一套相对稳定、可以迁移到其他任务中的工作方式。

因此，SKILL 自动沉淀并不是将一段 Session 总结成新的 `SKILL.md`，而是从多次真实交付中识别稳定模式，再为它补充适用场景、上下文边界、执行步骤和验证方式。Inspector 当前解决的，正是这一过程最基础的一环：先让真实交付留下边界清晰、可以检查的证据。只有在此基础上，我们才可能进一步比较相似任务，形成 SKILL 候选，并在后续交付中验证它是否真的改善了 Agent 的工作方式。

## 结语：先看清交付，再沉淀经验

我们最初想解决的是，如何从 Agent Session 中识别可复用的工作路径。但真正分析之后会发现，Session 只能记录 Agent 做了什么，却无法单独解释任务为什么开始，也不能证明哪些行为最终形成了工程产出。

Harness Inspector 将需求、Session、文件活动和 Git Commit 重新连接起来，让一次 Agent 交付变得可以观察、检查和追溯。只有先看清一次交付，我们才可能判断哪些行为只是偶然选择，哪些路径值得进一步沉淀成 SKILL。

从 Session 到交付，再从交付中沉淀经验，这正是 SKILL 自动演进的起点。
