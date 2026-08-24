---
id: harness-inspector
title: Harness Inspector
sidebar_position: 3
---

# Harness Inspector

Harness Inspector 是一个本地、只读的交付溯源工作台。它把已声明的产品意图、
Coding Agent 会话、归一化工具活动、Git 提交与仓库路径放在同一视图中，同时不把
相关性包装成作者身份或改进效果的证明。

它用来回答三个有边界的问题：

1. 当前能看到哪些产品意图、会话、操作、文件与提交？
2. Inspector 为什么关联两个对象，这份证据有多强？
3. 哪些信息仍然缺失、只是推断，或不足以支持更强的结论？

![Harness Inspector 架构：有界的本地证据经过归一化和带限制的关联，最终渲染为自包含只读报告](/img/harness-inspector-architecture-en.svg)

## 工作原理

1. **选择有边界的本地窗口。** CLI 会限制 Provider、日期、会话数与提交数；
   可选 Feature Tree 用于提供经过评审的 Feature 与 Story 意图。
2. **独立采集证据。** Session Adapter 读取受支持的本地 Coding Agent 证据；Git
   与 Entire Reader 采集提交、文件和 checkpoint 事实。缺失的 Provider 会保持为
   显式证据缺口。
3. **归一化但不扩大隐私边界。** Inspector 只保留通过隐私过滤的提示词、跨
   Provider 的动作标签、有界工具细节、已观察时间与仓库相对路径。原始工具
   payload、隐藏推理、凭证与用户目录绝对路径不会进入报告。
4. **建立有证据边界的关联。** 经过评审的引用、显式 commit/session metadata、
   已观察的 commit call、精确路径重合、时间与保留文本拥有不同的结论权限。
   每条关系都携带事实、来源和限制。
5. **渲染一个自包含报告。** 输出是读取投影证据的交互式 HTML 文件；它不会写入
   Git metadata、重新运行工具、恢复代码或恢复原生 Coding Agent 会话。

## 阅读工作台

- **Capability** 按经过评审的 Feature 与 Story 意图限定报告范围。
- **Date** 在产品映射缺失或不完整时，仍然保留可见的会话与提交。
- **User prompts / Agent activity / Commits and files** 是并列的三条信息轨；
  一条信息轨不会静默证明另一条信息轨中的作者身份。
- **Evidence Drawer** 解释当前选中关系以及它的限制。
- **Session Trace** 展示保留的轮次、归一化动作、已观察时间、空闲区间、文件与筛选。
- **Replay** 只沿保留证据前进；没有观察到精确时间的事件会保留 sequence-only 标签。

## 证据词汇

| 标签 | 它能支持什么 | 它不能证明什么 |
| --- | --- | --- |
| Explicit / direct | 保留的评审引用或显式 metadata 直接连接两个对象。 | 每个操作或每行改动都参与了最终交付。 |
| Observed same-path | 会话与提交证据中出现完全相同的仓库相对路径。 | 该会话创作了最终提交内容。 |
| Candidate | 结构、保留文本或时间提示了一个值得检查的关联。 | 经过评审的任务身份或因果关系。 |
| Contextual | 邻近日期或路径历史有助于解释当前交付窗口。 | 直接的会话、Story 或提交关联。 |

Feature Tree 的选择范围与证据置信度彼此独立。一个 Story 可以是有用的导航范围，
但它与会话的关系仍可能只是 candidate。

## 生成私有 Inspector

在需要检查的仓库中运行最短命令。`npx` 会下载或复用当前包，渲染当前工作区，
并打开已经写入的报告：

```bash
npx @qoder-ai/better-harness inspector
```

默认会打开当前工作区，并包含最近 30 个 UTC 日内的活动，最多采集 200 个 commit
和 100 个完整 session。Date 只列出存在已观察证据的日期，不会虚构“零活动”日期。
完成 [Better Harness 安装](../installation)后，或者需要显式限定范围时，仍然可以使用完整形式：

```bash
better-harness harness-inspector render --workspace . --open
```

默认输出位置：

```text
.qoder/better-harness-runs/harness-inspector/inspector.html
```

可以使用 `--platform`、`--since`、`--until`、`--commits` 与
`--max-sessions` 限定范围。`--platform all` 会从 Qoder、Codex、Claude Code、
Cursor、Qwen Code、GitHub Copilot、Pi、Kimi Code、WorkBuddy 和 Grok 中发现
证据，同时保留各 Provider 的证据缺口。

可选的 `.better-harness/feature-tree.md` 用于声明经过评审的意图：

```md
- [ ] Checkout reliability
  - [ ] Explain payment failure telemetry {#payment-failure-telemetry}
```

两个空格的缩进表示父子关系；内部节点成为 Feature，叶子节点成为 Story。当其他
产物需要引用节点时，建议提供稳定的 `{#id}` anchor。

## 边界

- Inspector 是观察界面，不是恢复或变更权限的所有者。
- 标记为 `Run tests` 的 Tool Call 只能证明该调用被观察到，不能单独证明测试通过。
- 相同路径与邻近时间支持相关性判断，但不证明作者身份。
- 缺失的 Token、Cost、Outcome、Base Commit、Budget 或 Harness Revision 证据
  必须保持为 unobserved，不能被转换为零值或干净结果。

## 未来演进

预期演进链路是 **Inspect → Compare → Eval → Decision**。

- **Compare** 应当是顶层工作区模式，而不是 Capability 或 Date 之外的第三种
  Scope。它的第一项能力是判断两条会话是否可比。
- 第一阶段应是以 Story 为主要发现入口的观察性轨迹比较：对齐跨 Provider 的归一化
  动作，中性展示 Delta 与混杂因素，并把 `insufficient evidence` 作为正常结果。
  同一 Story 只是发现入口，不是任务等价证明。
- improvement 或 regression 等更强结论应等待后续 Eval 证据：绑定的 Harness
  Revision、受控 treatment、客观 Outcome、兼容 Budget、重复 Trial，或
  held-out/later-comparable cohort。
- Decision 层才可以支持 retain、narrow、revise 或 revert；Inspector Compare
  本身不能制造这种结论权限。
