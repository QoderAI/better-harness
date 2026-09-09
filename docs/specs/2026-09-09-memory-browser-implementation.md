# Memory 浏览与分析实现

## Traceability

- Spec ID: memory-browser-implementation
- Status: Implemented; local verification
- Request: 维护者要求开始实施合并后的 [Memory ADR](../adrs/memory-navigation-and-analysis.md)。
- Baseline: PR #161 与阅读器提交 `31b6375`；无独立外部 Story。

## Intent

从左下角 Memory 进入真实数据，通过个人偏好、通用经验、项目和来源文件浏览；阅读与 AI 分析按需执行，界面保留短标签和必要操作。

## Acceptance Scenarios

- AC-1: v2 discovery 分开返回库、原生绑定、材料角色与内容范围；未指定 v2 的 CLI 保持旧返回合同及 scope 含义。无项目时能枚举 Qoder 原生项目，账户与同名项目不合并。
- AC-2: 选中并读取 Codex 摘要/索引后，版本化解析器保留显式个人、通用、项目章节及 digest/行范围；混合章节拆成条目，无法确认的内容保持未知。Discovery 不预读正文。
- AC-3: 左下角唯一 Memory 入口打开真实页面；二级导航支持深链接、返回与筛选恢复；来源按角色分组，生产规模历史材料默认折叠，文件数与条目数分开。
- AC-4: 保留选择即读、失败重试、快速切换隔离、标题内元信息和折叠来源路径；常态无说明横幅、长段概念文案或默认分析占位。
- AC-5: 右上角 AI 分析按需打开面板；固定所选来源快照，点击开始后调用已配置执行器。无执行器时入口解释未配置；支持取消、错误重试与带有效来源引用的结果，不写原生文件。
- AC-6: 合成 fixture 与真实本机数据在宽/紧凑/窄及明暗主题验证导航、分析面板、键盘焦点、溢出和 console/page errors；Mac 本地结果不充作 Windows/Linux 或 installed Desktop 证明。

## Non-goals

原生记忆写入、自动持久化分析建议、云端 ChatGPT 连接器、无依据的项目推断与后台扫描全部正文。

## Plan and Tasks

- [x] Rust 增加显式 opt-in v2 原生投影；JS transport 和 Studio 合同接受新结构，v1 保持兼容。
- [x] 实现有界章节解析与来源定位；UI 缓存仅保留当前浏览会话的已读结果。
- [x] Memory 真实入口、二级导航、材料折叠、阅读与响应式分析面板。
- [x] 服务端分析合同与只读执行器；使用已有 Qoder CLI 配置时关闭工具/MCP，隔离临时工作目录，固定输入，取消进程并校验返回来源。
- [x] Rust/JS/浏览器行为测试，构建、预览 smoke、文档链接和真实数据验证。

## Test and Review Evidence

- AC-1: `cargo +1.96.0 test --locked --test memory`：7 项通过；`test/agents/native-memory.test.mjs`：5 项通过，覆盖旧 CLI、授权读取、边界和 v2 原生投影。
- AC-2: Studio `memory-browser.test.ts`：11 项通过，包含 CRLF、Windows drive/UNC、显式 cwd、混合章节、代码围栏、128 条上限与项目账户身份。
- AC-3–5: 浏览器 fixture 包含 265 个 Codex 文件，其中 256 个历史文件。覆盖三种宽度、明暗主题、显式读取、来源折叠、虚拟滚动、返回/深链接、筛选、错误重试、迟到结果、分析启动/取消/重试、digest 过期拒绝、章节分析范围和源行定位。最终 15 项 Memory 浏览器测试全部通过，含当前项目切换保持全局 Memory 选择、窄屏抽屉焦点环与关闭恢复。
- AC-6: 本机 `http://127.0.0.1:3317/#/memory`：2026-09-09 发现 2,164 文件、87 来源；材料为 registry 3、knowledge 1,897、extension 4、summary 1、working 1、episode 256、skill 2。摘要读取后得到 Personal 2 条、General 1 条、Projects 13 条；原生 personal/project 文件仍单列文件数，未冒充已解析条目。
- 本机浏览器 1440/1024/390 px、明暗分析面板及阅读布局：每个上下文只读取两次明确选择的摘要；0 次真实记忆 AI 请求，0 console/page errors，无页面和分析面板横向溢出。截图与 JSON 保留在 `/tmp/better-harness-memory-final/`。
- 真实 Qoder CLI 合成快照 smoke：关闭工具、MCP、项目设置和会话持久化；返回 6 条 findings，documentId、digest 和来源行全部通过合同校验。未发送真实记忆内容。CLI 常规启动会发现已安装的 Qoder CLI，库调用也支持注入分析执行器；选中章节时传递显式 focus 与完整来源快照。
- Studio 构建通过；Canvas preview `/health` 返回 `200 ok`，`/canvas-module.js` 返回 `200`、100449 bytes。文档路由图已重生成，doc-link 8 项通过。

## Review Readiness

- 维护者请求与本 spec/ADR 对应；没有独立外部 Story，未推断 tracker 或 CI 状态。AI 实施者为 Codex。
- 变更按原生 v2、Studio 解析/导航/分析、测试与关联文档四组审阅；原生只读和旧 CLI scope 保持独立，未加入记忆持久化写入。未暂存、提交或推送本轮实现。
- 风险检查覆盖旧 scope 兼容、跨账户项目身份、未知范围、迟到响应、固定分析快照与取消清理；请求关闭后服务端终止分析，失败不暴露原生内容。
- Windows/Linux 路径语义有定向测试，但没有这些系统的 CI 或 installed Desktop 运行证据。Qoder 分析直接执行原生命令；`.cmd`/`.bat` 入口保持不可用，避免隐式 shell 执行。

- 扩展 Project shell 回归：8 项通过；`keeps a live run bound to its starting Project across a sidebar switch` 仍失败于 notebook 缺少文本事件。在 `31b6375` 的完整 tracked Studio source（排除本轮新增 source）重建并运行同一测试，也复现相同失败。对照输出：`/tmp/memory-project-baseline.txt`；本轮未修改 Debugger。
- 最终 `git diff --check` 通过；变更均为未暂存的本轮实现及合并后的关联设计文档。
