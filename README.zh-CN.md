<h1 align="center">Better Harness</h1>

<p align="center">
  <a href="README.md">English</a> · 简体中文
</p>

<p align="center">
  <strong>看清你的 AI 编码工作流如何运转，并一步步把它变得更好。</strong>
</p>

<p align="center">
  Better Harness 审视编码智能体理解任务、实施变更、验证结果、安全交付和沉淀经验的全过程，
  再指出下一步的改进方向；每项发现都有可见证据作为依据。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT 许可证"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D22.20.0-brightgreen.svg" alt="Node.js >= 22.20.0"></a>
</p>

<p align="center">
  <a href="#quick-start">快速开始</a> ·
  <a href="#see-it-in-action">实际效果</a> ·
  <a href="#why-better-harness">为什么选择 Better Harness</a> ·
  <a href="#what-is-open">开放了什么</a> ·
  <a href="#installation">安装</a> ·
  <a href="docs/adapters/README.md">宿主支持</a> ·
  <a href="roadmap.md">路线图</a> ·
  <a href="docs/community.md">参与贡献</a>
</p>

<a id="see-it-in-action"></a>

## 看看实际效果

让 `/better-harness` 审查当前任务及其所在项目的 Harness，并生成一份可留存的报告：

```text
/better-harness 审查此项目的 AI 编码工作流并生成报告
```

报告会明确标注证据缺口，并将有证据支撑的问题整理成按优先级排列的发现；
每项发现都包含影响、预期输出、范围明确的修复方案与验收检查。

<p align="center">
  <a href="assets/demo/better-harness-report.html"><img src="assets/demo/better-harness-findings-report.png" alt="Better Harness HTML 报告，展示一项由证据支持的发现及其影响、预期输出、范围明确的 AI 修复方案和验收检查" width="900"></a>
</p>

<p align="center">
  <sub><a href="assets/demo/better-harness-report.html">打开完整的自包含英文 HTML 报告</a>。</sub>
</p>

当你积累了多份可比较的历史报告后，历史视图会展示智能体工作闭环五个维度的变化：

<p align="center">
  <a href="dev/terminal-demo/README.md"><img src="assets/demo/twenty-history.gif" alt="Better Harness 终端历史演示，展示智能体工作闭环五个维度随时间的变化" width="900"></a>
</p>

动画会回放历史 Harness 报告。它展示的是已记录的趋势，并不能证明改进之间存在因果关系。
[查看演示录制方式](dev/terminal-demo/README.md)。

<a id="why-better-harness"></a>

## 为什么选择 Better Harness？

AI 编码智能体修改代码很快，但围绕它们的工作流往往才是薄弱环节：

- 🎯 **目标模糊** —— 智能体信心十足地解决了错误的问题。
- 🧭 **执行路径随意** —— 工作沿着他人无法复现的路径推进。
- ✅ **只有“能运行”，没有证据** —— 验证不完整或完全缺失。
- 🚀 **速度压过保障措施** —— 审查与交付检查被绕过。
- 🧠 **经验没有沉淀** —— 同样的问题在下一个任务中再次出现。

只审查最终 diff 会遗漏这些系统层面的问题。Better Harness 审查的是工作流本身：
它收集项目证据（以及宿主支持时的会话证据），评估五个相互关联的维度，
并将具体差距转化为按优先级排列的发现。每项发现都与证据、预期结果、修复边界和验证路径关联，
让团队能够一次改进一个问题。

<a id="how-better-harness-works"></a>

## Better Harness 如何工作

Better Harness 使用
[前馈与反馈](https://martinfowler.com/articles/harness-engineering.html#FeedforwardandFeedback)
闭环，把工作开始前可用的指引与智能体行动后可用的信号结合起来：

- **前馈指引** —— `AGENTS.md`、spec、Skill 和验收标准在智能体行动前为其指明方向。
- **反馈传感器** —— linter、测试、Hook 和审查智能体观察结果并帮助智能体自我纠正。

在这一闭环中，它评估交付过程的五个部分，也就是**智能体工作闭环（Agent Work Loop）**：

[![智能体工作闭环：从任务理解到经验沉淀的五个维度](assets/agent-work-loop-en.svg)](models/agent-work-loop.md)

| 维度 | 它回答的问题 | 支撑机制 |
| --- | --- | --- |
| **任务理解（Task Understanding）** | 智能体是否知道目标以及“完成”的含义？ | 规则、`AGENTS.md`、spec、`DESIGN.md` |
| **受控执行（Controlled Execution）** | 工作是否沿着受支持且可重复的路径进行？ | Skill、命令、MCP 工具、沙箱边界 |
| **变更验证（Change Validation）** | 是否有证据表明变更确实有效？ | 测试、lint、Hook、可观察的诊断信息 |
| **可靠交付（Reliable Delivery）** | AI 的速度是否绕过了质量检查或验收？ | 人工审查、审批、CI/CD、恢复路径 |
| **经验沉淀（Learning Capture）** | 下一个任务能否从本次任务中受益？ | Loop Discovery、可复用的 SDLC Skill、Memory |

运行 `/better-harness` 会建立一个以任务为边界的基线，并根据宿主生成可视化报告、
Markdown 报告或两者兼有。报告会整合五维概览、按优先级排列的发现、检测到的智能体资产和证据摘要。
每项发现都包含一个修复动作，用于起草范围明确、可供审查的修复计划。

Better Harness 坚持如实呈现：未观察到的行为会被明确标注，而不会被转化为缺乏依据的评分或断言。
当前检查通过，只能证明改进措施确实执行过；只有后续可比较的结果才能证明闭环确实有所改进。

<a id="what-is-open"></a>

## 开放了什么

Better Harness 开放了三个相互关联的层次，而不只是一个斜杠命令提示词：

- **工程实践** —— 覆盖
  [会话证据、项目 Harness、智能体定制和闭环工程](references/README.md)
  的证据与判断指南。
- **评估模型** —— 以任务为中心的
  [智能体工作闭环](models/agent-work-loop.md)，包括证据状态、发现、评分边界和纵向验证。
- **可运行实现** —— 规范的
  [`/better-harness` 工作流](skills/better-harness/SKILL.md)、证据收集器、分析器、渲染器和轻量
  [宿主适配器](docs/adapters/README.md)。

这三个层次共享同一条边界：已配置的资产可以证明某种机制存在，
但只有与任务关联的证据才能证明该机制被使用过，或确实改善了结果。

<a id="architecture"></a>

## 架构

[![Better Harness 架构：宿主集成、三个独立证据智能体、一个主智能体进行统一分析、输出发现、生成宿主产物并实施修复](assets/better-harness-architecture-en.svg)](docs/ARCHITECTURE.md)

该架构让三个证据域保持独立，直到主智能体进行统一分析。
每个结果都会保留可见的证据来源、责任归属和验证路径。

<a id="quick-start"></a>

## 快速开始

选择你的编码智能体——几分钟内即可看到第一份报告：

| 编码智能体 | 设置方式 |
| --- | --- |
| **Claude Code** | 添加本仓库 Marketplace，安装 `better-harness@better-harness`，启动新会话，然后使用下方的报告提示词。 |
| **Codex Desktop** | 在 **Settings > Plugins > + Add > From Marketplace** 中添加本仓库，安装 Better Harness，启动新任务，然后调用 `@better-harness`。 |
| **Codex CLI** | 添加 Git Marketplace，运行 `codex plugin add better-harness@better-harness`，然后调用 `$better-harness:better-harness`。 |
| **Qoder Desktop / CLI** | 安装 Qoder Desktop 后无需额外安装——Better Harness 已内置，并可在桌面端和 CLI 中使用。打开仓库并使用下方的报告提示词。 |
| **Cursor** | 从源码加载插件——参见[安装](#installation)。 |

安装完成后，让 Better Harness 生成当前宿主支持的持久化报告：

```text
/better-harness 审查此项目的 AI 编码工作流并生成报告
```

Better Harness 会将行为断言限定在相关的任务过程片段（Task Episode）及其周边项目机制内。
Qoder 生成 Canvas 报告；Claude Code、Codex 和 Cursor 生成自包含的 HTML 报告及配套 Markdown。
缺失或不完整的证据会被明确标注。有关当前覆盖范围和输出差异，请参阅
[宿主适配器矩阵](docs/adapters/README.md)。

<a id="installation"></a>

## 安装

不同编码智能体的安装方式不同。除 Qoder CLI 可使用 Qoder Desktop 内置版本外，
需要为每个宿主单独安装 Better Harness。安装或更新插件后，请启动新的会话或任务，
让宿主重新加载插件清单。

### Claude Code

将本仓库注册为 Claude Code Marketplace：

```text
/plugin marketplace add QoderAI/better-harness
```

然后安装 Better Harness：

```text
/plugin install better-harness@better-harness
```

通过 shell 验证插件是否已被发现：

```bash
claude plugin details better-harness@better-harness
```

详细信息应包含 `Skills (1) better-harness`。然后在需要审查的仓库中启动新的 Claude 会话，
并运行报告提示词：

```text
/better-harness 审查此项目的 AI 编码工作流并生成报告
```

Claude Code 默认会在仓库的 `.claude/better-harness` 报告根目录下生成自包含的
`report.html`，以及配套的 `report.md` 和 `findings.json`。
如果希望结果只保留在聊天中，可以要求行内输出或不生成文件。
在可用时，报告会包含与工作区匹配的本地 Claude 会话；
缺失的证据会被明确标注，而不会依靠推断补齐。

### Codex

#### Codex Desktop

1. 打开 **Settings > Plugins**。
2. 选择 **+ Add > From Marketplace**。
3. 输入 Git 仓库 URL，设置 Git ref；对于这个单插件仓库，**Sparse paths** 留空。
4. 选择 **Add marketplace**，然后从新 Marketplace 中安装 **Better Harness**。
5. 在需要审查的仓库中启动新任务，并运行报告提示词：

```text
@better-harness 审查此项目的 AI 编码工作流并生成报告
```

仓库 URL 使用 `https://github.com/QoderAI/better-harness.git`，Git ref 使用 `main`。

![Codex 添加插件 Marketplace 的对话框，包含仓库、Git ref 和可选的 sparse paths](assets/install/codex-add-marketplace.jpg)

#### Codex CLI

添加仓库源：

```bash
codex plugin marketplace add \
  'https://github.com/QoderAI/better-harness.git' \
  --ref main
```

然后查看并安装 Better Harness：

```bash
codex plugin list --marketplace better-harness
codex plugin add better-harness@better-harness
```

在需要审查的仓库中启动新的 Codex 任务，并运行报告提示词：

```text
$better-harness:better-harness 审查此项目的 AI 编码工作流并生成报告
```

使用 `marketplace add` 时应传入仓库 URL，而不是原始 `marketplace.json` URL。
当前 Codex 版本使用 `plugin add` 和 `--marketplace`；
使用 `plugin install` 或 `--source` 的示例对应的是另一套 CLI 接口。

### Qoder

Better Harness 已内置于 [Qoder](https://qoder.com/) 桌面应用，因此无需通过 Marketplace
或本地插件安装。可以选择以下任一入口：

1. **从会话进入：** 打开需要审查的仓库，启动新会话，然后运行报告提示词：

   ```text
   /better-harness 审查此项目的 AI 编码工作流并生成报告
   ```

2. **从 Quest 进入（Qoder 1.18.0+）：** 打开 Quest，然后从左侧边栏选择
   **Better Harness (Beta)**。

#### Qoder CLI

如果已安装 Qoder Desktop，Better Harness 在 Qoder CLI 中也已可用，
无需安装 Marketplace 或插件。在需要审查的仓库中启动新的 Qoder CLI 会话，
然后运行报告提示词：

```text
/better-harness 审查此项目的 AI 编码工作流并生成报告
```

只有在未安装 Qoder Desktop、单独使用 Qoder CLI 时，才需要手动添加本仓库作为
Marketplace 并安装 Better Harness：

```bash
qodercli plugin marketplace add \
  'https://github.com/QoderAI/better-harness.git'
qodercli plugin install better-harness@better-harness
```

验证手动安装：

```bash
qodercli plugin list
```

然后启动新的 Qoder CLI 会话，再使用 `/better-harness`。

### Cursor

Cursor 插件尚未发布到 Marketplace。可以在单次 Cursor Agent 会话中从源码加载本地插件：

```bash
git clone https://github.com/QoderAI/better-harness.git
cursor-agent --plugin-dir /path/to/better-harness
```

Cursor 会话证据来自与工作区匹配的会话记录、元数据和审计日志。
覆盖范围不完整或不可用时会被明确标注。

<a id="develop-and-package-from-source"></a>

## 从源码开发和打包

开发环境需要 Node.js `>=22.20.0 <25.0.0` 和 npm
`>=10.9.3 <12.0.0`，支持 Windows、macOS 和 Linux。

```bash
npm ci
npm test
npm run pack:verify
```

使用以下命令构建源码中的 Codex 本地插件产物：

```bash
node scripts/packaging/build-host-plugin.mjs
```

通过验证的产物会写入 `dist/plugins/better-harness`。

在同一份源码检出中，可以使用以下命令检查仓库证据，而不读取本地会话：

```bash
node scripts/better-harness.mjs report --no-sessions
```

在源码检出目录中，`npm run preview -- --open` 会提供一个内置测试样例（fixture）。
Canvas 预览需要已安装的 Qoder 运行时，或显式指定 `--sdk-media`/`--sdk-root` 路径。
服务默认监听 `127.0.0.1`；它是本地检查工具，不是带身份验证的共享服务。

<a id="contribute"></a>

## 参与贡献

你无需理解整个运行时即可参与贡献。请从与你希望改进的内容最匹配的最小范围入手：

| 可贡献的内容 | 从这里开始 | 示例 |
| --- | --- | --- |
| 工作流指导与工程实践 | [`skills/`](skills/) 或 [`references/`](references/) | 为某种语言、框架、审查模式或重复出现的智能体工作流添加有来源支撑的指南。 |
| 审查模型与可执行分析 | [`models/`](models/) 或 [`scripts/`](scripts/) | 添加由证据支持的审查视角、检测器，或带 fixture 和测试的智能体友好分析命令。 |
| 交付控制与宿主支持 | [`hooks/`](hooks/) 或[宿主适配器矩阵](docs/adapters/README.md) | 添加范围明确的生命周期检查，或记录并验证另一种编码智能体宿主的证据支持情况。 |
| 报告与视觉语言 | [`templates/reporting/`](templates/reporting/) 或 [`templates/style/`](templates/style/) | 添加报告模式、可复用的报告契约，或带验证证据的纯指令式视觉样式。 |
| 示例与运行模型 | [`case-studies/`](case-studies/) | 分享经过脱敏且以证据为边界的示例，展示团队如何应用智能体审查与交付实践。 |

开始贡献：

1. 阅读[社区扩展地图](docs/community.md)，找到规范的归属位置并了解相应契约。
2. 按照[贡献指南](CONTRIBUTING.md)设置项目并确定变更范围。
3. 当贡献会改变运行时行为或渲染输出时，添加测试、fixture 或预览证据。
4. 提交一个聚焦的 Pull Request，说明改了什么、为什么修改以及如何验证。

不确定某个想法应该放在哪里？在创建新的顶层功能区，或修改公共报告、schema、打包或兼容性契约之前，
请先[创建 issue](https://github.com/QoderAI/better-harness/issues)。

<a id="license"></a>

## 许可证

Better Harness 采用 [MIT 许可证](LICENSE)。

---

<p align="center">
  如果 Better Harness 帮助你改进了智能体工作流，欢迎点一个 ⭐——这会帮助更多人发现本项目。
</p>
