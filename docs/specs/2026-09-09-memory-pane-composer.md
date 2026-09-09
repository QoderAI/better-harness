# Memory 分栏与输入区简化

## Traceability
- Spec ID: memory-pane-composer
- Status: Implemented

## Intent
按用户截图收紧 Memory 阅读区，支持调整三栏宽度，并在打开 AI 分析时直接显示可编辑输入框。文件引用、模型选择和会话操作集中在底部。

## Acceptance Scenarios
- AC-1: 目录/正文、正文/AI 两条分隔线支持拖拽、方向键、Home/End 与双击复位；窗口缩小时正文保持可用且页面不横向溢出。
- AC-2: 文档标签使用紧凑高度与间距；正文自动填充可用宽度；frontmatter 默认折叠，可展开查看原文。
- AC-3: 打开分析即显示输入框和文件引用；连接前后可编辑首条请求，选择 ACP 模型后发送，Agent 收到最终请求和固定来源快照。
- AC-4: 会话操作位于底部；去掉重复分析标题、来源标题和就绪占位文本；保留错误、权限、流式响应、后续消息与停止能力。
- AC-5: 宽、紧凑、窄视口及明暗主题通过浏览器布局、焦点、溢出、控制台与截图检查；共享 ACP 默认行为不变。

## Non-goals
不修改原生 Memory 文件，不更换 ACP 协议，不发布。

## Plan and Tasks
- 按现有 Debugger 分隔线交互实现 Memory 宽度状态与边界。
- 使用语义 token 压缩阅读区，局部折叠 YAML 元数据。
- 给共享会话视图增加可选简洁展示和输入区插槽，准备阶段支持提交最终编辑后的请求。
- 使用协议 fixture 验证首条请求、模型、流式首块与关闭；真实 Memory 库验证布局。

## Test and Review Evidence
- AC-1/AC-2: Playwright 实测拖拽、方向键、Home/End、双击，验证取值边界、紧凑标签高度、正文宽度及元数据折叠/展开。
- AC-3/AC-4: fixture 记录 Agent 实际收到的 ACP `session/prompt`，确认连接后编辑的请求、固定快照和所选模型；多轮发送、停止、关闭清理通过。
- AC-5: Memory 与共享 ACP 浏览器套件 22 项通过；最后的输入区样式和组件开关调整后，对应 12 项回归再次通过。Studio 单元测试 612 项、Harness ACP 33 项、文档链接 8 项通过。
- 真实 Qoder CLI ACP 使用合成 Memory：连接获得模型列表，编辑请求后得到中文回答及 `[L3]` 来源引用，无页面错误。
- 本机真实目录 2165 份文件、87 个来源，1600/1024/390 宽度、明暗主题、输入焦点、底部操作位置与页面溢出检查通过；截图位于本机 `/tmp/better-harness-memory-refined/`，运行记录 `/tmp/memory-refine-visual.txt`。
- Harness 与 Studio 构建通过；保留已运行的 Canvas preview，`/health` 和 `/canvas-module.js` 均返回 200。
- Review Readiness: 本次维护直接来自用户截图，无外部 Story；实现由 Codex 完成。改动覆盖本 spec AC；提交范围仅包含 Memory 优化、共享 ACP 必要扩展及对应测试，已有博客及主题修改保持不变。
- 集成前本地 main 与 origin/main 分叉，合入远端时保留 Ontology 提交，并消解 ADR 编号冲突。此合并是拉取最新代码的必要步骤，与本次 UI 优化分开提交。
- 风险边界：prepared prompt 修改仅由支持该操作的 Memory 会话接收，继续校验类型和大小；其他 ACP 调用保留默认流程。验证在 macOS 本机完成，未触发新的跨平台 CI。
