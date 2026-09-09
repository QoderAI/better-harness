# Memory 分类导航交互调整

## Traceability

- Spec ID: memory-navigation-interaction
- Status: Implemented; locally verified
- Request: 维护者截图反馈二级导航不合理、交互不顺畅。
- Related: [Memory ADR](../adrs/memory-navigation-and-analysis.md)

## Intent

分类只占紧凑的一行页签，让列表与阅读器直接相邻。进入分类即可浏览可识别的摘要条目，不要求先绕道来源文件手工读取。

## Acceptance Scenarios

- AC-1: 四个分类为内容区顶部页签，无单独的空白分类侧栏、重复分类标题或窄屏分类抽屉；键盘方向键、Home/End、Enter/Space可操作，URL可深链接。
- AC-2: 打开语义分类后，按已发现的明确全局摘要/索引集合加载，每个库优先一份摘要、没有摘要才使用索引，最多8份、每份不超过256KiB；发现接口仍仅返回元数据，不扫描历史或技能正文。来源文件页仍选择即读。
- AC-3: 桌面语义分类在可用时直接选中首个已解析条目，单条时直接显示正文；窄屏先保留列表。分类分别恢复选择、筛选和滚动位置；来源行读取与分析保持原有边界。
- AC-4: 项目筛选位于项目页签内，保留宿主/库身份。无可识别摘要时给出准确空态，读取失败可原地重试，未完成加载不伪装为空。
- AC-5: 265份合成材料和真实本机库在宽、紧凑、窄布局及明暗主题完成浏览器检查，包含键盘、返回、加载失败、阅读、分析、溢出和页面错误。

## Non-goals

原生记忆写入、全量正文扫描、改变分析执行器、提交/推送或安装发布。

## Plan and Tasks

- [x] 把分类侧栏收为页签，项目选择放入过滤栏，合并列表/阅读布局。
- [x] 增加有界摘要加载、原地加载/失败状态及分类状态恢复。
- [x] 更新ADR相应交互决策与行为测试，构建后复核真实页面。

## Test and Review Evidence

- AC-1/3/4: 17项 Memory Playwright 测试全部通过，覆盖页签手动键盘激活、深链接、单条直读、分类筛选恢复、长条目500px阅读位置恢复、加载失败原地重试及原有读取/分析流程。
- AC-2: `memory-browser.test.ts` 12项通过，新增每库摘要优先、8份上限、256KiB边界和支持材料排除测试。真实分类首开在三种宽度下均只读取一份明确摘要，未读取历史/技能正文。
- AC-5: 265份合成材料、真实本机库分别验证1440/1024/390px；真实中文版明暗主题截图位于 `/tmp/better-harness-memory-navigation/`，0次AI请求、0 console/page errors、无页面横向溢出；同时检查页签hover/selected/focus和返回恢复。
- Studio构建通过；doc-link 8项通过，路由图已重生成；preview `/health` 与 `/canvas-module.js` 均200，SDK 100449 bytes。`git diff --check`通过。

## Review Readiness

- 维护者截图反馈、此spec、更新后的ADR与实现相互对应；无独立外部Story或CI状态推断。
- 本轮在上一轮未提交实现上仅调整Memory导航、局部快照读取/阅读状态、相关文案/测试/文档；没有原生写入、执行器变更、提交、推送或安装。
- AI: Codex。主要风险已覆盖有界摘要读取、错误重试、分类切换恢复、长文阅读位置、窄屏和键盘激活。Discovery保持元数据；分类条目使用会话内固定快照，来源文件选择仍重新读取，刷新重新获取摘要。
- 验证为macOS本地浏览器；不代表Windows/Linux CI或安装版Desktop结果。
