# Codex 项目资产静态盘点

## Traceability

- Spec ID: 219-codex-asset-inventory
- Story: QoderAI/better-harness#219
- Status: Implemented

## Intent

Codex project-scope baseline 已经共享同一份 configured inventory，但 provider 没有读取项目 `.codex/agents/*.toml` 与 `.codex/config.toml` 的 `[mcp_servers.<name>]` 声明，导致 lint summary 的 `agents`、`mcps` 错误地显示为 0。修复 canonical provider，使静态盘点反映项目内实际声明，同时不启动 MCP、不推断运行时可用性。

## Acceptance Scenarios

- AC-1: 合成 Git workspace 中分别放置 1 个合法 `.codex/agents/*.toml` 与 1 个 `[mcp_servers.<name>]` 声明时，Codex asset baseline 的 `envelopes.lint.data.assetInventory.summary.agents` 和 `mcps` 均为 1，public inventory 的 owner routes 与 practice coverage 也能观察对应项目资产。
- AC-2: 多个合法 agent 文件与多个 MCP table 按声明精确计数；同一 MCP 身份在现有 inventory merge 边界去重，不因重复计数或重复 table 产生幻影资产。
- AC-3: 盘点仅保留声明元数据，不执行 agent 或 MCP command，不连接 URL，也不输出 runtime connected/available 结论；MCP command 即使会留下执行标记，该标记也不会出现。
- AC-4: 没有 agent/MCP 声明时计数为 0；非法 TOML、重复 key/table 或非对象 MCP 声明不会使整个 baseline 失败，也不会被计为有效资产。无效文件采用忽略该文件的确定性边界，其他合法声明仍可盘点。
- AC-5: 项目资产路径使用宿主原生文件系统语义构造，报告路由保持 portable `/` 分隔；Windows drive、空格与 Unicode 路径下，agent/MCP 仍归属选中 workspace，不逃逸到 user scope。
- AC-6: 修复位于 `scripts/agent-customize/providers/codex.mjs` 的 canonical configured-asset owner；lint 与 public inventory 继续复用同一 raw inventory，不在 baseline 中另写一套 Codex 解析或计数逻辑。

## Non-goals

- 不启动 MCP server、探测 URL、调用工具或判断运行时可用性。
- 不输出或持久化 agent prompt 正文、MCP env 值、凭据或无关配置正文。
- 不修改 Codex 配置、不新增宿主、不改变 user-home 授权边界。
- 不实现完整 TOML 生态、配置编辑、运行时 schema 校验或其他 provider 重构。
- 不修改 CHANGELOG、版本、发布流程或生成产物。

## Plan and Tasks

1. 在 Codex provider 的项目采集路径中，为 `.codex/agents/*.toml` 与 `.codex/config.toml` 增加有界 TOML 声明采集，复用现有 subagent/MCP item shape、`normalizeMcpServer`、`buildManageCollections` 与 inventory merge 语义。
2. 让 agent-lint 识别 Codex TOML agent 的既有元数据，避免把合法 TOML 误报为 Markdown frontmatter 缺失；保留现有描述与 prompt 长度检查，不推断工具权限。
3. 在 `test/agents/agent-asset-baseline.test.mjs` 增加合成 Git workspace 回归，覆盖单声明、多声明、无声明、非法/重复声明、静态不执行、Windows 路径与 canonical owner 共享快照。
4. 先运行聚焦测试，再运行根 `npm test` 与不触发 build 的 harness generated/test 检查，记录真实结果和剩余风险。

## Test and Review Evidence

- AC-1/AC-2/AC-5：合成 Git workspace 的 asset baseline 行为断言，检查 lint summary、owner routes、coverage rows 与 portable project routes。
- AC-3：MCP command 使用会写入 sentinel 文件的合成命令；断言 baseline 完成后 sentinel 不存在。
- AC-4：空项目、非法 TOML、重复 key/table、非对象 MCP table 与跨来源同名 MCP 的行为断言。
- AC-6：provider inventory 与 lint 均从同一 Codex raw inventory 获得 agent/MCP items；baseline 继续只消费共享快照。
- 执行命令（Windows，Node 24）：
  - `npx --yes node@24 node_modules/vitest/vitest.mjs run test/agents/agent-asset-baseline.test.mjs test/agents/agent-lint.test.mjs test/agents/coding-agent-practices-inventory.test.mjs test/skills-docs/doc-link-graph.test.mjs --reporter=dot`
  - 通过临时 PATH 中的 Node 24 `node.exe` 执行 `npm.cmd test -- --reporter=dot`
  - 同一 Node 24 PATH 下执行 `npm.cmd run harness:generated` 与 `npm.cmd run harness:test`
- 风险：手写静态 TOML 采集必须忽略无效声明且不得把配置值当命令执行；Windows 本地结果不能替代其他平台 CI；新增 item 不得泄露 env 值或 prompt 正文。

## Implementation Evidence

- 环境：Windows 10，默认 Node `v26.5.0` 不符合仓库 `<25` 限制；所有测试使用 `npx --yes node@24` 提供的 Node `v24.22.3`。`npm` 脚本通过临时 PATH 中的 `node.exe` 确保子进程同样使用 Node 24。
- 修复前回归：`npx --yes node@24 node_modules/vitest/vitest.mjs run test/agents/agent-asset-baseline.test.mjs -t "Codex asset baseline"`，4 个新场景中 3 个失败、1 个空声明场景通过，复现 agents/MCP 漏计。
- AC-1–AC-6：`npx --yes node@24 node_modules/vitest/vitest.mjs run test/agents/agent-asset-baseline.test.mjs test/agents/agent-lint.test.mjs test/agents/coding-agent-practices-inventory.test.mjs test/skills-docs/doc-link-graph.test.mjs --reporter=dot`，4 文件、68 测试全部通过。
- 既有 Codex provider 回归：`npx --yes node@24 node_modules/vitest/vitest.mjs run test/agents/agent-customize.test.mjs -t "Codex" --reporter=dot`，4 个 Codex 测试通过、48 个非 Codex 测试按过滤跳过。
- 文档路由图：`npx --yes node@24 scripts/doc-link-graph/cli.mjs skills/better-harness` 执行成功；生成文件内容与 HEAD 一致，无 tracked diff。
- 根全量：Node 24 下 `npm test -- --reporter=dot` 首次为 1788 passed / 8 failed / 8 skipped。2 个 Grok 失败在修改前已存在；6 个 harness-checkup 失败来自临时路径包含 `D:\Cache`，触发既有 immutable-path 规则。改用非 Cache 临时目录并隔离 HOME 后复跑为 1795 passed / 1 failed / 8 skipped；剩余 Pi 测试因隔离 HOME 与子进程 `os.homedir()` 不一致失败，均与本改动无关。
- Harness：`npm run harness:generated` 通过；`npm run harness:test` 27 文件、218 测试通过。注意后者仓库既有 `pretest` 会自动执行 `build`，未单独调用 build 或 publish 命令。
- 静态边界：sentinel-writing MCP command 未执行；TOML env 值与 agent prompt canary 未进入 raw inventory 或 baseline JSON；非法/重复声明不会使 baseline 失败。
