# 恢复 Codex 插件启动与会话证据边界

## Traceability

- Spec ID: codex-source-plugin-session-evidence
- PR: https://github.com/QoderAI/better-harness/pull/196
- Status: Implemented

## Intent

隔离可选 DSH 依赖，恢复时间窗口内继续活动的 Codex 会话，并区分宿主上下文与真实用户请求。PR 审查发现原生 `input_image` 附件被文本提取忽略，与页面上下文共存时会丢失任务边界，导致后续修改归入前一任务。

## Acceptance Scenarios

- AC-1: 源码插件未安装 YAML 时，Codex 路由仍可启动；仅选择 DSH 时返回可操作的依赖错误，不修改依赖版本。
- AC-2: 开始时间早于 `since`、但在闭区间内有活动的会话可被发现；读取结果保持时间、工作区和会话身份过滤。
- AC-3: 单独的页面或浏览器上下文不会成为任务请求；附带真实文字请求时保留该文字。
- AC-4: Markdown、XML 和原生 `input_image` 请求均保留任务边界，包括原生图片与页面/浏览器上下文共存的情况。文字任务及图片任务各发生一次修改时，形成两个 episode，前一任务不吸收后一修改；是否启用文本输出不影响分类，图片地址和内容不会进入归一化事件或摘要。
- AC-5: `exec` wrapper 只贡献可观察活动，不推断嵌套命令成功、验证通过或发布批准。

## Non-goals

不识别图片内容，不新增附件格式，不修改原生桌面适配器、发布策略、依赖版本或无关 CI 门禁，不读取真实私人会话。

## Plan and Tasks

1. 核验现有 provider 惰性导入、窗口发现、上下文过滤与 wrapper 活动测试（AC-1/2/3/5）。
2. 扩展匿名多模态消息回归，先确认原实现失败（AC-4）。
3. 在 Codex 原始消息层识别原生图片，保留 `user` 类型及 `userPrompt` 标记；继续使用现有文本输出和隐私清理边界（AC-4）。
4. 执行相关及全量根测试、文档链接检查，核对 PR 的跨平台 CI，再提交修复并 squash 合并。

## Test and Review Evidence

- 独立审查报告：`input_image` 与宿主上下文共存时，两个任务被折叠成一个；其余改动未发现已确认的高信号问题。
- AC-4：新增 4 个回归场景在修复前全部失败，修复后通过；每个场景验证不输出文本、输出用户文本、输出内容三种模式，两个 episode 各保留一次修改，图片无可用摘要时不生成虚构事实。
- AC-1/2/3/4/5：`npm test -- test/sessions/codex-evidence-window.test.mjs test/cli/source-plugin-runtime.test.mjs test/agents/agent-customize-dsh.test.mjs test/skills-docs/doc-link-graph.test.mjs`，4 文件、33 测试通过。
- macOS / Node 24.18.0：隔离 worktree 内执行全量 `npm test`，119 文件通过、1 文件跳过；1782 测试通过、7 测试按既有前置条件跳过，0 失败。
- 初次使用 `vitest --root` 从父目录启动的结果受 cwd 与依赖目录隔离影响，不作为产品回归证据；worktree 内独立安装依赖并通过 `npm --prefix` 使用正确 cwd 后复验通过。
- 文档路由图重新生成后无差异；`git diff --check` 通过。修复提交后的跨平台 CI 结果以 PR 检查记录为准。
- 风险：不能用隐私清理后的空文本判定请求不存在；图片识别仅用于分类，不复制或解码附件。
- 本地 macOS 结果不能替代 Windows/Linux 的 GitHub Actions 结果。
