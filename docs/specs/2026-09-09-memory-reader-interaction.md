# Memory 文档选择与来源展示

## Traceability

- Spec ID: memory-reader-interaction
- Status: Implemented and locally verified
- Request: 维护者要求选中文档默认读取、将 Agent/scope/role 合入顶部路径区、来源折叠时仍展示路径。
- Baseline: PR #161，904aeeb。补充 [Native Memory sources](2026-09-09-native-memory-sources.md)，取代其中通过第二次点击才读取正文的 UI 交互。

## Intent

选中文档即查看正文，路径、宿主与范围作为一个紧凑的标题区域；来源路径保持可见，摘要哈希等次要信息按需展开。

## Acceptance Scenarios

- AC-1: 初始只加载元数据；通过点击文档或键盘 Enter 选中时，仅对该文档发送带 id/scope/authorized 的读取请求，不再需要第二个读取按钮。
- AC-2: 快速切换文档、改变筛选、关闭或刷新时取消过期读取；迟到结果不得覆盖当前文档。失败可重试。
- AC-3: 相对文件路径与 Agent/scope/role 位于同一标题区域；窄屏在该区域自然换行，不再单独占一条 metadata 栏。
- AC-4: 来源详情默认折叠；折叠时完整原生路径仍可见，展开后显示支持级别、工作区、SHA-256 与时间。
- AC-5: API 继续拒绝无授权、错误 scope 和跨源读取；加载正文不扩大为预读其它文档。
- AC-6: light/dark、1440×900、1024×768、390×844 下标题、路径、正文与键盘操作可用，无文档级横向溢出和 console/page errors。

## Non-goals

本轮不实施语义 scope 解析、Memory 导航重构、记忆编辑或持久化。

## Plan and Tasks

- [x] MemoryView 将显式文档选择映射为读取，保留取消、世代隔离和失败重试。
- [x] 合并阅读器标题布局，来源 summary 常显完整路径。
- [x] 更新浏览器场景，覆盖无预读、键盘选择、快速切换、筛选取消及重试。
- [x] 构建、文档链接、相关测试及真实本机页面检查。

## Test and Review Evidence

验证环境：2026-09-09，macOS，Node 24；PR 独立目录中的本地修改。

- Studio 构建通过。
- `memory.spec.mjs` 与 `memory-workbench.spec.mjs`：12 项 Playwright 测试通过。AC-1/3/4/6 覆盖三种屏宽与 light/dark；AC-2 覆盖筛选取消、迟到结果隔离与失败重试；AC-5 覆盖 API 授权、scope 与来源检查。
- 文档链接图重新生成后无差异，`doc-link-graph.test.mjs` 8 项通过；`git diff --check` 通过。
- 真实本机页面 `http://127.0.0.1:3317/#/memory-sources` 在三种屏宽复核：选中文档前无读取、Enter 选择后只读取一次、标题内元信息、折叠路径、键盘展开/折叠、关闭后的焦点返回全部通过，无整体横向溢出与 console/page errors。
- 合成数据截图保存在 Studio 的 ignored `test-results/` 中；已查看 wide/compact/narrow 折叠状态及 narrow 深色截图。真实正文未保存为测试附件。

### Review Readiness

请求证据来自维护者本次三点 UI 要求，无外部 Story。AI 实施者：Codex；尚无新提交，因此没有提交 co-author trailer。

| 文件 | 范围与证据 |
| --- | --- |
| `MemoryView.tsx` | 选择即读、取消及世代隔离、合并标题与来源布局；AC-1 至 AC-4 |
| `styles/memory.css` | 使用既有语义 token，标题及完整路径换行；AC-3/4/6 |
| `i18n/en/common.ts` | 删除二次读取提示，增加失败重试文案 |
| `i18n/zh-CN/common.ts` | 同步中文重试文案 |
| `test/browser/memory.spec.mjs` | 自动读取、API 边界、三屏宽、迟到结果和重试行为 |
| 本 spec | 定义本次交互要求并记录本地证据 |
| [Memory 范围、导航与分析](../adrs/memory-navigation-and-analysis.md) | 原范围分析草案已合入统一 ADR；语义分类方案仍待实施 |

全部修改未暂存，构建与截图为 ignored 产物。风险集中在读取时机变化，已确认只有显式选择的文档触发读取；API 授权检查保留。本次验证不代表 Windows/Linux CI 或安装后的 Desktop 验证，也不代表 scope 语义问题已解决。
