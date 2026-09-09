# Memory 范围、导航与分析

## Traceability

- ADR ID: `ADR-0008`
- Status: Implemented locally; host validation bounded
- Decision date: 2026-09-09
- Request: 区分 Memory 范围，保留左下角入口与右侧 AI 分析，并确保产品 UI 简洁。
- Consolidates: 原 `memory-scope-and-navigation` 草案与 Memory 导航、AI 分析设计。
- Baseline: PR #161，`904aeebe27788bd2ccb1ea46c724f097510a50c2`。
- Related: [原生 Memory 来源](../specs/2026-09-09-native-memory-sources.md)、[文档读取交互](../specs/2026-09-09-memory-reader-interaction.md)、[Studio 设计规范](../../DESIGN.md)

## Context

全局来源库可以包含项目知识。按文件数量和存储路径组织主界面，会混淆个人偏好、项目知识与历史材料；默认示例 Inbox 又使真实记忆难以发现。

## Decision

1. **左下角保留唯一的 Memory 入口**，与 Customizations 相邻，不依赖当前项目。页面左侧采用目录树，个人、通用、项目、来源为可展开根目录，保留项目和宿主原生身份。
2. **右侧以打开的文档为标签**。打开条目新增或激活标签，重复打开不重复；关闭活动项选择邻项，保留每项阅读位置。分类目录只承担查找，不再占用顶部标签。搜索和宿主筛选不关闭已打开文件。
3. **有界建立浏览目录**。每个全局库优先一份摘要，否则一份索引，最多8份、每份256KiB；其他文件选择后读取。正文快照仅在当前页面会话缓存，显式刷新重新读取。文件数与解析条目数保持区别。
4. **右上角「AI 分析」使用 ACP**。选择已配置 Agent，连接后使用真实 ACP 模型与模式设置，显式发送分析请求后复用会话流、权限交互和后续输入。分析固定来源快照及章节，切换文档不改变当前会话对象，关闭面板中止执行并清理工作目录。
5. **范围与来源分开建模**。来源库记录宿主与原生身份；内容范围记录个人、通用、项目、任务、混合或未知；文件角色记录摘要、索引、知识或支持材料。未知范围不默认为个人，AI 建议不直接覆盖原生范围证据。
6. **窄屏按主任务切换**。文件夹按钮打开目录，右侧文档标签支持横向滚动；分析打开时使用可返回的单面板。键盘导航与焦点、深链接和返回保留。

## UI 简洁约束

- 常态保留目录、文档标签、阅读器与一个分析入口。分析配置按需出现。
- 哈希、支持级别和协议数据放入详情。会话正文显示可读分析请求；来源路径与章节行号可回访。
- 使用共享 ACP 设置、权限与输入组件，模型选项来自 Agent。临时目录是工作目录隔离，不是操作系统沙箱；不增加原生 Memory 写入 API。

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

## 决策依据

以下为 2026-09-09 的研究快照，保留其实现与运行证据边界。

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

## Acceptance Scenarios

- AC-1: Codex 全局库包含 project scoped entries 时，库仍显示全局存放，条目显示其原生项目范围；不得全部标成个人记忆。
- AC-2: 一个 MEMORY.md 包含个人、通用和多个项目章节时保留单一来源文件及多个带定位信息的条目；mixed/unknown 不被强制归为 user。
- AC-3: 265 个来源文件的测试夹具不会显示为 265 条已整理的记忆；摘要/索引优先，256 份历史材料默认折叠。
- AC-4: 未选当前工作区时，各宿主的覆盖意图一致。允许按来源观测列出原生项目键；不能识别路径的项目明确显示未绑定，不猜仓库路径。
- AC-5: 默认进入真实 Memory；没有分析结果时不显示示例 Inbox、虚假计数或有效的持久化动作。
- AC-6: 用户选中文档即读取该文件；建立索引遵循列明的文件集合，保留 size/scan/no-symlink 边界，分类浏览仅加载上述有界的明确摘要/索引集合，不读取历史、技能或其他未选择的正文。
- AC-7: 路径发现、正文读取、条目解析、宿主实际采用是独立状态。未有执行证据时不能称“生效”或“已使用”。
- AC-8: 原生解析器按已识别格式与章节边界保留 source-declared 范围；无法确认的内容保留 unknown，不用文件名或标题语义猜测项目。
- AC-9: 个人条目与项目条目可分别回访；审阅中的 Project 标签由真实范围驱动，持久化目标不重写内容 scope。
- AC-10: 宽/紧凑/窄布局、键盘导航、焦点、受限溢出、错误与空状态通过浏览器验证；项目切换不改变全局库归属。
- AC-11: 左下角唯一入口与页面内二级导航分层呈现，支持深链接和返回恢复；窄屏目录通过文件夹按钮可达，常态无大段解释文案。
- AC-12: 右上角 AI 分析入口按需打开面板；执行前列明所选对象，覆盖未配置、运行、取消、失败重试与来源可追溯结果，不自动改写原生记忆。

- AC-13: 默认界面无介绍横幅、概念说明段落、重复导航或默认分析占位；必要状态使用短标签，空态与失败态最多一句原因及一个下一步。展开详情后仍能查到范围依据、来源与分析对象。

## Non-goals

ChatGPT 云端记忆连接器、读取私有数据库、修改原生 Memory、跨宿主自动合并、自动认定团队共享或上下文注入、AST 分析执行器，以及 ADR/Wiki 自动写入。

## Implementation Plan

- [x] Rust 为来源库与文档角色提供独立结构，保留原生身份；处理无 workspace 的 Qoder 项目发现，不用源码文本正则充当行为测试。
- [x] 新合同显式版本化并定义旧 CLI/报告兼容投影；不能把旧 scope 字符串静默改义。
- [x] 授权快照后添加 bounded 的 Codex registry/summary 解析边界，保留混合范围与 section-level provenance；其他宿主按可证实的格式逐步接入。
- [x] Studio 左下角入口保持唯一，内容区增加二级导航与材料层级，右侧按需打开 AI 分析；示例审阅退出默认路径。
- [x] 使用合成的生产规模夹具覆盖文件角色、混合章节、双项目同名、未知范围、不同账户、工作树和读取权限。
- [x] 在真实本机元数据与有限授权快照上复核分类，保留 Windows/Linux/installed Desktop 的独立证据边界。

- [x] 接入显式选择范围的 AI 分析执行、取消、重试与来源可追溯结果；实现前按仓库规则补充对应切片 spec。

## Consequences and Evidence

浏览已有记忆不经过 Accept/Promote；有真实分析结果后才进入审阅。读取与 AI 分析是独立动作，分析固定选择的来源集合，不隐式扩展到整个记忆库。存储身份、内容范围与写入目标独立，兼容旧合同需要显式版本化。

范围与导航研究曾完成安装包、PR 实现、真实文件角色快照检查；早期交互草图通过三种屏宽、键盘和溢出检查。这些早期证据仅代表研究与草图；当前实现和验证由下述切片 spec 单独记录。

文档读取交互已在 `31b6375` 提交，构建、12 项浏览器测试与真实数据三种屏宽验证记录见关联 spec。后续实现须覆盖上述 AC、明暗主题及 console/page errors，并分别记录 Windows/Linux CI 与安装后的 Desktop 证据。

本轮已按 [Memory 浏览与分析实现](../specs/2026-09-09-memory-browser-implementation.md) 完成本地代码与验证。原生 v2 保留旧 CLI 投影，默认 Memory 接入真实库，分析使用固定来源及章节 focus；本地结果不代表 Windows/Linux CI 或安装后的 Desktop 已验证。

维护者后续反馈二级侧栏与空分类形成交互绕路，已按 [Memory 分类导航交互调整](../specs/2026-09-09-memory-navigation-interaction.md) 收敛为紧凑页签、有界摘要加载、分类状态恢复和单条直读。该调整替代早期“四项独占侧栏、先手工读来源才有分类”的交互。

最新交互以 [Memory 目录工作台与 ACP 分析](../specs/2026-09-09-memory-explorer-acp.md) 为准，替代分类标签与独立 CLI 分析通道。早期 spec 的验证属于对应历史切片。
