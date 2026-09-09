# Memory 的范围与浏览流程

## Traceability

- Spec ID: memory-scope-and-navigation
- Status: Draft
- Request: 维护者在 PR #161 本地验证后指出浏览流程不顺，要求分析 `/Applications/ChatGPT.app`，区分 global、user、project 等维度。
- Baseline: PR #161，`904aeebe27788bd2ccb1ea46c724f097510a50c2`。
- Related: [Native Memory sources in Studio](2026-09-09-native-memory-sources.md)。本草案修正范围建模与入口，不宣称已实施。

## Intent

让用户首先理解 Agent 记住了哪些个人偏好、通用经验和项目知识，再查看相关来源。全局存储库可以包含项目限定的知识；来源文件数不能被当成记忆条目数。区分存储位置、内容适用范围、材料角色与宿主使用策略。

## 已核实的证据

### 已安装应用

- `Info.plist`：bundle ID `com.openai.codex`，版本 `26.901.51231`，build `8109`。目录名 ChatGPT.app 不代表只包含 ChatGPT 云端产品。
- `app.asar/.vite/build/main-BT6ViFC-.js`：`readSummary()` 经 executionHost 的 codexHome 和 platformPath 读取 `memories/memory_summary.md`。
- `app.asar/webview/assets/personalization-settings-4bda34582051.js`：本机级设置分别写入 `memories.generate_memories` 与 `memories.use_memories`。
- `app.asar/webview/assets/app-primary-6cd7b8b3f5e3.js`：当前聊天使用记忆与允许生成记忆是两个控制；生成模式通过 `thread/memoryMode/set` 发送。
- 同一包另有 ChatGPT 项目的 `memory_scope`（`project_v2` 对应 project-only）和账户记忆 API。它们与本地 Codex 文件库是不同来源，不能借用云端项目字段解释本地仓库的读权限。
- `Contents/Resources/codex` 的内嵌记忆维护和导入模板区分：紧凑全局索引、可检索的 MEMORY.md、项目 scoped entry、详细来源材料。导入流程保留 `scope.json` 中的 cwd；项目知识不能因存入全局摘要而变成全局偏好。
- 上述为包内代码和模板证据，不是账户功能启用、后台维护执行或所有聊天实际使用这些记忆的证明。
- [官方 Memories 文档](https://learn.chatgpt.com/docs/customization/memories?surface=app) 也区分 ChatGPT 记忆与 Codex 本地库，以及使用现有记忆、为后续记忆提供输入。

### PR 与本机数据

- Rust `memory.rs:281` 将 Codex 根下的全部 Markdown 放入 user scope。
- `scripts/memory/contract.mjs:23` 强制 document.scope 等于 source.scope，无法表达全局库中的混合范围文档或项目条目。
- `memory.rs:485` 将 MEMORY.md 和 memory_summary.md 合并为 consolidated，其余 Codex 文件均为 generated；历史证据、技能、扩展指令与原始中间产物未区分。
- 无 workspace 时，Claude 枚举各项目，Qoder 只返回 global 文档；当前全局入口对各宿主覆盖范围不一致。
- Memory 默认路由打开静态 preview candidates；Sources 是另一个页面。没有从本机来源到 Inbox 的分析链路。
- Preview candidate 没有实际 scope 字段；Inspector 硬编码 Project。接受为 Personal Memory 后，条目同时离开 Inbox 和 Project，没有个人记忆目的地。
- 2026-09-09T02:51:15Z 本机 Codex 快照为 265 个文件：摘要 1、索引 1、rollout 摘要 256、技能文件 2、扩展材料 4、raw 汇总 1。文件数可能随后台维护改变。
- 上一轮的路径、字节和 digest 校验证明 I/O 与旧采集器一致，不证明语义分类准确。现有同构 fixtures 未覆盖混合范围索引。

## 范围模型

| 维度 | 表达 | 示例与约束 |
| --- | --- | --- |
| 来源库 | host、account namespace（存在时）、execution host、root | Codex 的本机用户库，Qoder 的某账户库。仅表示归属与存放位置。 |
| 原生绑定 | 全局库 / 项目 / checkout / 未知，加原生 identity 与证据 | Claude 的项目目录；Qoder 的原生项目键。不可按 basename 跨项目合并。 |
| 内容适用范围 | personal / cross-project / project / task / mixed / unknown | Codex MEMORY.md 可为 mixed；其中一个条目可明确绑定 better-harness。 |
| 材料角色 | summary / registry / knowledge / episode / skill / extension / working / unknown | rollout 摘要是 episode；raw 汇总和临时 consolidation diff 是 working。 |
| 使用与共享策略 | 宿主显式观测结果，缺失时 unknown | 目录位置不证明跨项目使用、团队共享、已注入上下文或 project-only 隔离。 |

文件与记忆条目是两个对象。Discovery 保持只读元数据，返回来源库、原生绑定和可识别的文件角色；内容范围可以是 mixed/unknown。授权读取后，版本化解析器建立条目，每个条目保留文档 digest、章节/行范围、原生项目证据与内容来源。未解析不等于没有记忆，也不能默认 personal。

`user` 不能同时承担“当前 OS 用户拥有”与“内容是个人偏好”的含义。`team` 表示潜在共享维度，`agent` 表示宿主/生产者，均不应与 project 放在一个互斥下拉框中。

## 浏览流程

1. Memory 打开真实数据视图，默认浏览“个人与通用”，并提供独立的项目导航。显示已识别来源以及尚未读取/解析的状态。
2. 个人与通用分别呈现用户偏好与跨项目经验。项目导航按可靠的原生身份列出项目；个人偏好可以作为可选关联上下文，不混入项目计数。
3. 若只有元数据，优先列出摘要、索引与原生知识文件；按来源分组，并标明“内容范围待解析”。不能填充示例知识。
4. 授权针对具体对象与操作：根据维护者后续指示，选择文档即读取该文档正文，交互见 [Memory 文档选择与来源展示](2026-09-09-memory-reader-interaction.md)。未来“读取并建立索引”需列出固定文件集合，不能扩展为扫描所有历史材料。去掉把正常查看混同为 Accept/Promote 的流程。
5. 右侧详情区展示内容、范围、来源与适用依据；历史摘要、扩展材料、技能、原始中间产物在“来源文件”或条目证据中按需展开。
6. 保留未支持宿主的覆盖信息，但折叠到来源管理中，不挤占主记忆列表。
7. 只有存在真实分析结果时才显示“待审阅”。示例设计独立于默认入口；浏览已有原生记忆不要求提升到 ADR 或 Wiki。
8. 未来条目审阅先确认内容范围与项目，再决定写入目标；scope 与 destination 分开。个人目标有明确可追踪的归档位置。

## Acceptance Scenarios

- AC-1: Codex 全局库包含 project scoped entries 时，库仍显示全局存放，条目显示其原生项目范围；不得全部标成个人记忆。
- AC-2: 一个 MEMORY.md 包含个人、通用和多个项目章节时保留单一来源文件及多个带定位信息的条目；mixed/unknown 不被强制归为 user。
- AC-3: 265 个来源文件的测试夹具不会显示为 265 条已整理的记忆；摘要/索引优先，256 份历史材料默认折叠。
- AC-4: 未选当前工作区时，各宿主的覆盖意图一致。允许按来源观测列出原生项目键；不能识别路径的项目明确显示未绑定，不猜仓库路径。
- AC-5: 默认进入真实 Memory；没有分析结果时不显示示例 Inbox、虚假计数或有效的持久化动作。
- AC-6: 用户选中文档即读取该文件；建立索引遵循列明的文件集合，保留 size/scan/no-symlink 边界，不后台读取未选择的正文。
- AC-7: 路径发现、正文读取、条目解析、宿主实际采用是独立状态。未有执行证据时不能称“生效”或“已使用”。
- AC-8: 原生解析器按已识别格式与章节边界保留 source-declared 范围；无法确认的内容保留 unknown，不用文件名或标题语义猜测项目。
- AC-9: 个人条目与项目条目可分别回访；审阅中的 Project 标签由真实范围驱动，持久化目标不重写内容 scope。
- AC-10: 宽/紧凑/窄布局、键盘导航、焦点、受限溢出、错误与空状态通过浏览器验证；项目切换不改变全局库归属。

## Non-goals

ChatGPT 云端记忆连接器、读取私有数据库、修改原生 Memory、跨宿主自动合并、自动认定团队共享或上下文注入、AST 分析执行器，以及 ADR/Wiki 自动写入。

## Plan and Tasks

- [ ] Rust 为来源库与文档角色提供独立结构，保留原生身份；处理无 workspace 的 Qoder 项目发现，不用源码文本正则充当行为测试。
- [ ] 新合同显式版本化并定义旧 CLI/报告兼容投影；不能把旧 scope 字符串静默改义。
- [ ] 授权快照后添加 bounded 的 Codex registry/summary 解析边界，保留混合范围与 section-level provenance；其他宿主按可证实的格式逐步接入。
- [ ] Studio 默认入口与来源管理合一，独立显示个人/通用/项目导航与材料层级；示例审阅退出默认路径。
- [ ] 使用合成的生产规模夹具覆盖文件角色、混合章节、双项目同名、未知范围、不同账户、工作树和读取权限。
- [ ] 在真实本机元数据与有限授权快照上复核分类，保留 Windows/Linux/installed Desktop 的独立证据边界。

## Test and Review Evidence

本轮是分析与交互草图，未修改产品运行时代码。已检查安装包、相关 PR 实现、源合同、真实文件角色快照与官方说明。后续实现必须以 AC 行为验证，不能仅复用旧采集器的错误分类作为唯一 oracle。

新文档 doc-link-graph 检查 8 项通过，重新生成 routing graph 后无变化。交互草图在 1440×900、1024×768、390×844 验证导航、选中详情、支持材料展开、Enter 操作与受限溢出，console/page errors 为零；已检查项目视图宽屏和来源视图窄屏深色截图。尚未实现的解析器、兼容策略和宿主策略读取不得算作验收通过。
