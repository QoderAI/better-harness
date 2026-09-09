# Memory 目录工作台与 ACP 分析

## Traceability

- Spec ID: memory-explorer-acp
- Status: Implemented; locally verified
- Request: 维护者要求采用类似 VS Code 的左侧目录、右侧多文档标签页，并以 ACP 组件选择模型和呈现会话流。
- Related: [Memory ADR](../adrs/memory-navigation-and-analysis.md)

## Intent

目录承担查找与层级，编辑区标签仅代表已经打开的记忆。分析使用现有ACP会话机制，模型来自所选Agent实际提供的选项，不再使用单独的非流式CLI分析界面。

## Acceptance Scenarios

- AC-1: 左侧树包含个人、通用、项目和来源目录；项目及原生来源保留身份，目录可展开/折叠，搜索包含后代。键盘上下/左右/Home/End及Enter操作可用，大目录虚拟化。
- AC-2: 每次打开记忆新增或激活对应文档标签，不覆盖其他打开项；关闭活动标签选择相邻项，重复打开不重复；保留每项阅读位置、深链接与浏览器返回。
- AC-3: AI面板选择已配置ACP Agent，连接后复用AcpSessionSettings显示宿主提供的模型/模式等；显式发送后复用AcpSessionStream呈现流式内容、权限请求与后续对话。
- AC-4: 会话固定所选文档digest和章节；服务端重新读取并校验，使用隔离临时目录，原生Memory无写接口。切换文档不改变运行中的分析对象；关闭分析中止会话并清理临时目录。模型更改在提示发送前生效。
- AC-5: 无项目亦可分析；无Agent、过期快照、连接/设置失败、取消和重试有可执行路径。连接前不发送真实快照，模型选项不硬编码。
- AC-6: 合成真实ACP协议进程验证模型设置、首块先于完成、后续轮次和关闭；本机实际Agent连接检查与合成快照分析分开记录。三种宽度和明暗主题验证目录、标签、分析、焦点与无溢出/页面错误。

## Non-goals

自动写原生记忆、改变Debugger/Compare交互、创建新Agent适配器、推送/发布/安装。ACP Agent自身的能力与权限仍由已有协议和用户决定，不将隔离工作目录声称为操作系统沙箱。

## Plan and Tasks

- [x] 建立目录数据投影与可键盘操作的虚拟树，右侧多文档标签及阅读状态。
- [x] 替换Memory专用CLI分析通道，接入现有ACP执行器、设置与流组件。
- [x] 服务端固定快照与会话生命周期、Agent发现、合成协议测试和实际连接验证。
- [x] 更新ADR及浏览器测试、构建、预览和文档链接检查。

## Test and Review Evidence

- Studio 构建通过；Memory 浏览/解析/ACP 输入投影 12 项 Vitest 通过；文档图 8 项通过。
- Memory 浏览器 15 项通过：265 文件的虚拟目录、键盘导航、重复打开/相邻关闭/焦点、阅读位置、授权与延迟读取、索引失败重试、项目切换、ACP 模型/三轮对话、等待回复先显示首块、关闭与断开清理。
- 共享 ACP 回归 6 项通过：模型与推理设置、权限、队列、取消、多轮、附件、会话恢复与流式富内容。
- 真实本机库：2165 文件/87 来源（最新复核；前一次为2164）；1440、1024、390 布局各只读取 1 份全局摘要即可展示目录并打开 User Profile/General Tips 两个标签；明暗截图位于 `/tmp/better-harness-memory-explorer/`，浏览器 console/page errors 为 0。
- 本机 Qoder CLI 实际 ACP：连接返回 Auto/Ultimate/Performance/Efficient/Lite 及具名模型选项；仅发送临时合成记忆，收到带 [L1-L3]、[L3] 引用的完整分析，关闭成功，page errors 为 0。截图 `/tmp/memory-real-acp-models.png`、`/tmp/memory-real-acp-response.png`。真实记忆未发送到 AI。
- 已运行的 Canvas preview：`/health` 为 200/ok，`/canvas-module.js` 为 200/100449 bytes。

## Review Readiness

- Request/Spec：维护者本轮目录与文档标签、ACP 组件复用请求对应 AC-1 至 AC-6；没有推断新 Story、外部 CI 或 tracker 状态。
- Scope：Memory UI/路由/目录投影与专用 ACP 启动器；共享改动仅增加 streamRun AbortSignal 与 streamHarnessRun 可信已读输入。原生 v2 和解析器沿用此前切片，ADR 更新为当前决策。
- Risk：临时目录清理由协议测试证明；使用原有 ACP 权限和会话机制，不宣称 OS 沙箱或 Agent 本地历史零持久化。来源变更在连接前重新校验 digest。
- AI：Codex 实施。全部本地改动未暂存、未提交/推送；生成的 app dist 仅用于本地预览。Windows/Linux CI 与安装后的 Desktop 未验证。
- 已知基线：此前 project-shell 的 Debugger 实时 notebook 用例失败在 HEAD31b6375 上复现，独立于本轮 Memory/ACP 测试，不在本轮修复范围。
