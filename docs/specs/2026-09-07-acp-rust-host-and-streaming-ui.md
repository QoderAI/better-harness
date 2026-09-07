# ACP Rust 宿主与流式渲染链路

## Traceability

- Spec ID: acp-rust-host-and-streaming-ui
- Status: Draft

## Intent

当前 ACP 执行器 `AcpSdkExecutor` 是**一次性**的：每次 `execute()` 都 spawn 一个 Agent 进程、`initialize`、`session/new`、发**一次** `session/prompt`，然后在 `finally` 里 `reapAgent` 杀掉进程（[acp-sdk.ts#L64-L287](../../packages/harness/src/exec/acp-sdk.ts#L64-L287)）。它声明 `clientCapabilities: {}`——**空能力**，因此外部 Agent 在 Better Harness 里既不能读写文件，也不能开终端，只能产出纯文本与 tool-call 回显。

这带来三个可观察的后果：

1. **多轮对话不可能**。一个会话只能有一个 prompt，Studio 的调试器无法做「追问」。
2. **证据强度受限**。Agent 无法落地文件改动，因此 Target Binding 拿不到 materialization/diff 证据。
3. **流式输出卡顿**。不同 ACP Agent 的 chunk 粒度差异极大，事件直通到浏览器，表现为「跳字」。

本规格把 ACP 客户端下沉为一个持久化的 Rust 可执行服务（对齐 `docs/ARCHITECTURE.md:16-18` 已声明的 "future ACP services are Rust executables"），开启 `fs/*` 与 `terminal/*` 客户端能力，并把 Studio 的流式渲染链路改为按 entry 增量更新。

Rust 侧的会话状态归并、chunk 合并、权限状态机形态参照 Zed 的 `acp_thread`/`agent_servers` 实现（本仓库外部参考，非依赖）。

## Acceptance Scenarios

### 连接与会话生命周期

- **AC-1**：`harness-acp-host` 以 NDJSON over stdio 启动后，对同一个 Agent 连接可连续处理 ≥2 次 `session.prompt` 而不重启 Agent 子进程；第二次 prompt 复用第一次的 `sessionId`，且 `initialize` 只发生一次。
- **AC-2**：Node 侧 `AcpRustExecutor` 的 `execute()` 返回后，若会话被标记为保持，Agent 子进程仍存活；显式 `shutdown` 或宿主进程退出后，Agent 子进程与其整个进程组在 2s 内被回收，其 cwd 可被删除（Windows 下不出现 `EBUSY`）。
- **AC-3**：Rust 宿主异常退出时，所有在途请求以 `error` 帧结束，Node 侧不悬挂；Studio 收到 `run-error` 后 `run-finished`。

### fs/\* 能力与路径围栏

- **AC-4**：`fs/read_text_file` 的行号语义为：`line` 缺省、`0`、`1` 三者等价于从第一行开始；`limit` 表示**行数**；起始行超过文件末行时返回 `invalid_params`，错误消息中的行号为 1-based。
- **AC-5**：路径围栏对 `canonicalize` 之后的真实路径做前缀判定。以下四类请求全部被拒绝并返回不含绝对路径的错误：（a）allow-root 之外的绝对路径；（b）经 `..` 逃逸的路径；（c）指向 allow-root 之外的 symlink；（d）写入目标的父目录不存在。
- **AC-6**：`fs/write_text_file` 写入成功后，磁盘内容与请求内容逐字节相同；超过 8 MiB 的读或写被拒绝。

### terminal/\* 能力

- **AC-7**：`terminal/create` 创建的终端，其环境变量中 `PAGER` 为空串、`GIT_PAGER` 为 `cat`，且 Agent 显式传入的同名变量可覆盖它们（先设默认、后 extend）；stdin 重定向到空设备，命令不因等待 stdin 而挂起。
- **AC-8**：`terminal/output` 的截断为「保留头部 + 行对齐」：先把字节上限**向下**取到合法 UTF-8 字符边界，再回退到最后一个 `\n`，不返回半行；`truncated` 标志与实际是否截断一致。有效上限为 `min(Agent 请求值, 宿主上限 1 MiB)`，Agent 传 `None` 时取宿主上限。
- **AC-9**：`terminal/kill` 停止进程但保留句柄，其后 `terminal/output` 与 `terminal/wait_for_exit` 仍可用；`terminal/release` 停止并注销句柄，其后按 id 查找返回错误，但已渲染到 tool call 里的终端输出不消失。
- **AC-10**：单个 session 的并发终端数超过 8 时，`terminal/create` 返回错误而非无限创建。

### 权限

- **AC-11**：`session/request_permission` 到达时，Rust 侧把待授权状态**内联**到对应 ToolCall 上（持有 oneshot sender）；该 ToolCall 被替换或会话销毁时，请求自动降级为 `cancelled`，永不悬挂。
- **AC-12**：同一个 requestId 只能被授权一次；重复决策返回错误。Agent 侧 `$/cancelRequest` 与用户侧取消都把 ToolCall 状态改为 `Canceled`，且仅在当前仍为待授权时才改（并发点击不产生错误状态）。
- **AC-13**：权限请求经 Rust → Node → SSE 到达浏览器，用户决策经 `POST /api/acp/runs/{runId}/permissions/{requestId}` 回到 Rust，Agent 收到 `selected` 结果。Rust 侧不设超时，Node 侧保留既有 5 分钟外层超时。

### 背压

- **AC-14**：Rust → Node 的事件通道有界。通道接近上限时，连续的助手文本增量被**合并**而非丢弃；非文本事件（entry 结构变化、权限、协议帧）不被合并也不被丢弃。压力解除后 UI 最终状态与无压力时一致。

### 事件契约与 host 扩展

- **AC-15**：Harness DSL 的 `host` **保持** `"qoder" | "acp"`；Rust 与 Node 两条 ACP 通路都实现同一个 `"acp"` host，因为 `preflightRevision` 要求执行器 host 与已解析 revision 的 host 相等。运行时差异由 receipt 表达：Rust 通路的 `runtimeProfile` 为 `"acp-v1-rust"`，既有 Node 通路仍为 `"acp-v1-stdio"`；Rust receipt 的 `tools` 如实列出已实际开启的 `fs`/`terminal` 能力。
- **AC-16**：Rust host 的私有 NDJSON 通道发出 entry 取向事件（`entry-appended` / `entry-updated` / `entries-removed`）；`AcpRustExecutor` 将其投影为既有 `message-*` / `tool-call-*` 公共事件。`HarnessRunStreamEventV1` 与 `parseHarnessRunEvent` 保持不变，既有消费者无需识别 Rust 实现细节。
- **AC-17**：Rust 二进制缺失时，Studio 回落到既有 `AcpSdkExecutor`（`host="acp"`），功能不减、无报错弹窗，`/api/config` 如实反映当前可用的 ACP 宿主。

### UI 流式渲染

- **AC-18**：助手文本在浏览器侧平滑揭示：每帧揭示当前积压的 8%（向上取整），目标 200ms 排空当前积压；截断不切断 UTF-8 字符与代理对；消息切换或运行结束时立即排空剩余积压。
- **AC-19**：`entry-updated(index)` 只更新该 index 对应的条目，不重建整个 entry 数组的标识，`@tanstack/react-virtual` 的 `measureElement` 高度缓存对未变化条目保持有效。
- **AC-20**：尾部跟随可被用户中断：运行中用户向上滚动超过阈值后停止自动跟随，滚回底部后恢复跟随。当前实现把 `followLatest` 直接绑定到 `state.status === "running"`（[RunView.tsx#L767-L768](../../packages/harness-studio/src/app/run/RunView.tsx#L767-L768)），会在用户上滚阅读时强行拉回底部，属本项修复目标。
- **AC-21**：Agent 发送**全量文本快照**（而非增量）时，客户端自行做前缀比对：新内容以旧内容为前缀则只追加后缀；否则整体替换。相同内容不产生更新。
- **AC-22**：焦点守卫——用户正在编辑的输入控件不被流式更新覆盖。

## Non-goals

- **不改服务发现**。[acp-agent-catalog.ts](../../packages/harness-studio/src/server/acp-agent-catalog.ts) 的 PRESET + PATH 探测保持原样。不引入 Zed 式的 settings/ACP Registry 驱动，不下载二进制，不安装 npm 包，不新增 host adapter。
- **不新增 Markdown 渲染**。当前 UI 无 markdown 渲染，引入渲染器与其消毒是独立的安全面与设计面，另开规格。本规格的助手文本仍按纯文本渲染。
- **不改 SSE 传输**。仍是 `POST /api/acp/runs/stream` + `text/event-stream`，不换 WebSocket。
- **不动 `/api/acp/runs/*` 的 HTTP 形状**，包括权限与取消两个路由的路径、方法与同源校验。
- **不移植 Zed 的编辑器语义**。Zed 的 `fs/read` 读的是编辑器未保存的 buffer、`fs/write` 走 diff-then-edit 以保住 anchor；本宿主无编辑器，直接读写磁盘。这是**有意的语义偏离**，需在实现注释中标明。
- **不移植 Zed 的 GPUI 桥接层**（`ForegroundWork` / `fn` 指针 / `spawn_dedicated`）。那套机制的存在理由是 GPUI 的单线程 `!Send` 模型；tokio 宿主用单 owner 任务串行化即可。
- **不做 Zed 的 elicitation、subagent、context compaction、checkpoint/rewind**。
- **不改 experiment compare 的 lane 语义**，只扩展 host 字面量使 `acp-rust` 可作为 lane host。

## Plan and Tasks

### 分层与归属

```
浏览器 (harness-studio/src/app/run)
  ├─ 平滑揭示缓冲（rAF，8%/帧，200ms 目标）      ← AC-18
  ├─ entry 增量归并 + 前缀比对                    ← AC-19 AC-21
  └─ 尾部跟随策略 + 焦点守卫                      ← AC-20 AC-22
        ▲ SSE (text/event-stream，形状不变)
Studio 服务端 (harness-studio/src/server)
  └─ acp-runs.ts：executor factory 增加 acp-rust 分支；权限/取消路由不变
        ▲ 注入 executor
harness (packages/harness/src/exec)
  └─ acp-rust.ts：AcpRustExecutor + NDJSON 客户端（executable 由宿主注入）
        ▲ NDJSON over stdio（acp-host-jsonl-v1）
harness-acp-host (packages/better-harness-desktop/rust/acp-host)
  ├─ agent-client-protocol 2.0.0 ClientSideConnection
  ├─ 连接注册表（持久连接、会话句柄、task 取消）
  ├─ AcpThread 状态归并（chunk 合并 + ID 回填）
  ├─ fs 能力（canonicalize 围栏）
  ├─ terminal 能力（portable-pty）
  └─ 有界事件通道（文本增量可合并）
```

**为什么平滑揭示放浏览器而不是 Rust**：若在 Rust 侧按 16ms 排空，200ms 的一段文本会被拆成约 12.5 条 NDJSON 帧再经 SSE 放大一次。放在浏览器侧用 `requestAnimationFrame` 实现同一公式，视觉效果一致且省掉这次放大。

**为什么 Rust crate 放在 `better-harness-desktop/rust/` 而 TS 客户端放在 `harness/src/exec/`**：沿用 oxc 既有先例——Rust 服务在 desktop 包（[rust/oxc-service](../../packages/better-harness-desktop/rust/oxc-service)），TS 客户端在消费方（[rust-oxc-compiler.ts](../../packages/harness-studio/src/agent-react/host/rust-oxc-compiler.ts)），二进制路径由宿主注入、被消费方视为不透明字符串。这样 `harness` 不获得任何打包知识，符合 `core <- adapters <- devtools` 的依赖方向。

### Node ↔ Rust 线协议：`acp-host-jsonl-v1`

沿用 oxc 服务已验证的信封与边界策略（`{version, id, ...}`、帧上限、pending 上限、超时即整进程失败、可注入 `spawnProcess` 缝），新增**非请求响应的通知帧**——这是 oxc 协议没有的唯一扩展。

```
请求  Node→Rust  {"version":1,"id":<u32>,"method":"...","params":{...}}
响应  Rust→Node  {"version":1,"id":<u32>,"result":{...}}
                 {"version":1,"id":<u32>,"error":{"code":"...","message":"..."}}
通知  Rust→Node  {"version":1,"event":{"type":"...", ...}}      // 无 id
```

方法集：`connection.open` / `session.create` / `session.prompt` / `session.cancel` /
`session.setConfigOption` / `permission.decide` / `connection.close` / `shutdown`

事件集（Zed `AcpThreadEvent` 的最小对应）：

| 事件 | 载荷 | 对应 AC |
|---|---|---|
| `entry-appended` | `index`, `entry` | AC-16 AC-19 |
| `entry-updated` | `index`, `patch` | AC-16 AC-19 |
| `entries-removed` | `start`, `end` | AC-16 |
| `status-changed` | `status`, `stopReason?` | AC-3 |
| `permission-requested` | `requestId`, `toolCallId`, `title`, `options[]` | AC-13 |
| `permission-resolved` | `requestId`, `outcome` | AC-12 |
| `protocol-frame` | `direction`, `method`, `rpcId?`, `payload` | 既有证据链 |
| `usage-updated` / `title-updated` / `plan-updated` | 见实现 | — |

版本戳常量 `ACP_HOST_VERSION = "acp-rust-2.0.0+jsonl-v1"`，与 `RUST_OXC_COMPILER_VERSION` 同风格。

### 任务清单

**T1 — Rust crate 骨架**（AC-1 AC-2 AC-3）
新增 `packages/better-harness-desktop/rust/acp-host/`：`Cargo.toml`（`agent-client-protocol` 精确锁 `=2.0.0`、`tokio`、`portable-pty`、`serde`/`serde_json`、`anyhow`、`uuid`）、`src/lib.rs`、`src/main.rs`（stdio NDJSON 循环）。
先跑通 `connection.open` → `session.create` → `session.prompt`，用既有 fixture [acp-agent.mjs](../../packages/harness/test/fixtures/acp-agent.mjs) 对拍。

**已核实（原待确认项）**：`=2.0.0` **不需要** `features = ["unstable"]`。该 umbrella 只含 `unstable_auth_methods`、`unstable_elicitation`、`unstable_end_turn_token_usage`、`unstable_mcp_over_acp`、`unstable_session_fork`，全部在本规格范围之外（elicitation 已列为 non-goal）。`FileSystemCapabilities`、`TerminalId`/`TerminalOutputRequest`/`TerminalExitStatus`、`ClientSessionCapabilities`/`SessionConfigOptionsCapabilities`/`BooleanConfigOptionCapabilities` 均未被 feature gate，默认 feature 即可用。结论记录在 `Cargo.toml` 注释中。

**运行时选择**：该 crate 内部用 `async-io`/`async-process`（smol 生态），`tokio` 仅为其 dev-dependency；官方 client 示例本身以 `#[tokio::main]` 驱动，故 tokio 宿主是被支持的组合，代价是 `async-io` 自带一个独立 reactor 线程。选 tokio 是因为 T5 的 `portable-pty` 需要阻塞线程池、且有界通道与定时器在 tokio 下更直接。

**T2 — 连接注册表与持久会话**（AC-1 AC-2 AC-10）
连接按 Agent 身份缓存复用；会话句柄 + RAII 生命周期；`task_id` 取消通道。

**进程回收不自行实现**。原计划移植 [acp-sdk.ts#L328-L373](../../packages/harness/src/exec/acp-sdk.ts#L328-L373) 的 `reapAgent`/`terminateAgentTree`，但核实后发现 `agent-client-protocol` 的 `AcpAgent` 已经做了同一件事：spawn 时 `process_group(0)`，`ChildGuard` 的 `Drop` 里 `kill_process_group(pid, SIGKILL)`，并有 1s `SHUTDOWN_GRACE_PERIOD` 与 64 KiB 上限的 stderr 捕获。因此 T2 依赖 `AcpAgent` 的 `ChildGuard`，不重复实现杀进程树；AC-2 仍需独立断言 cwd 可删除，因为这是**行为**契约而非实现细节，且 Windows 语义与 POSIX 进程组不同。

**T3 — 状态归并**（AC-16 AC-21）
移植 Zed 的三层 chunk 合并与合并谓词：仅当「两侧都有 message id 且不相等」时拒绝合并，任一侧为空则乐观合并并**回填 id**。三层分别对应「改文本 / 改 entry 内 block / 追加 entry」三种更新粒度，避免要么闪烁要么 entry 爆炸。全量快照走前缀比对转增量。

**T4 — fs 能力**（AC-4 AC-5 AC-6）
`ClientCapabilities.fs.read_text_file/write_text_file = true`。
路径围栏**不照抄 Zed**——Zed 的 worktree 前缀匹配是「这个文件属于哪个 worktree」的查找，不是安全边界（无 `canonicalize`、不规范化 `..`、不处理 symlink 逃逸）。本宿主：allow-root 为 `task.cwd` 加显式配置的额外根；读取时 canonicalize 目标本身，写入时 canonicalize 父目录，再对 canonical 结果做前缀判定；错误消息不回显绝对路径。
行号语义与读写上限按 AC-4/AC-6。所有路径用 `std::path` 构造与比较，不做字符串拼接。

**T5 — terminal 能力**（AC-7 AC-8 AC-9 AC-10）
`ClientCapabilities.terminal = true`。`portable-pty` spawn；terminal id 由**宿主**生成（UUID v4），不接受 Agent 指定。
移植三条实战细节：先设 `PAGER=""`/`GIT_PAGER=cat` 再 extend Agent env（顺序决定可覆盖性，且 git 优先读 `core.pager` 故须单独设 `GIT_PAGER`）；stdin 重定向空设备；经用户默认 shell 启动以获得其 PATH。
输出截断按 AC-8（**向下**取字符边界，与文本揭示的向上取整方向相反：截断宁少不多，揭示须保证每帧至少前进一个字符）。`kill` 用 get、`release` 用 remove，两者都停进程——差别仅在是否注销。退出状态用可多次 await 的共享 future。

**T6 — 权限状态机**（AC-11 AC-12 AC-13）
oneshot sender 内联在 ToolCall 的待授权状态里，而非旁路 pending map。这样「ToolCall 消失 ⇒ sender drop ⇒ 请求自动 cancelled」成为类型层面的不变量，同时「只能授权一次」由 `mem::replace` 取出 sender 保证。取消路径两条（Agent 侧 `$/cancelRequest`、用户侧取消）都要有「仅当前仍为待授权时才改状态」的守卫。

**T7 — 有界事件通道**（AC-14）
`tokio::sync::mpsc::channel` 有界（4096）。这是**有意偏离 Zed**：Zed 用 unbounded 队列、无背压，其自身注释亦承认这是已知边界。文本增量在接近上限时合并，结构性事件不合并不丢弃。

**T8 — Node 侧执行器**（AC-2 AC-3 AC-15 AC-17）
新增 `packages/harness/src/exec/acp-rust.ts`：`AcpRustExecutor`，`executable` 为必填选项（不自行解析二进制路径），`spawnProcess` 为可注入测试缝。帧边界、pending 上限、超时即整进程失败、stderr `resume()` 排空等策略照搬 [rust-oxc-compiler.ts](../../packages/harness-studio/src/agent-react/host/rust-oxc-compiler.ts)。
从 `packages/harness/src/exec/index.ts` 导出。**保留 `AcpSdkExecutor` 不动**，作为二进制缺失时的回落（AC-17）。

**T9 — Runtime profile 与适配器描述符**（AC-15）
Harness DSL 的 host union **不扩展**。实施验证发现 `preflightRevision` 会以 `assertRevisionHost` 强制 executor host 与 revision host 相等；增加 `"acp-rust"` 会拒绝所有现存 `"acp"` revision，与无迁移接入目标相反。Rust 执行器因此仍声明 `host = "acp"`，并以 `runtimeProfile = "acp-v1-rust"` 区分实现；既有 Node 执行器维持 `"acp-v1-stdio"`。无需增加第二个适配器描述符，两条通路共同服从 `ACP_ADAPTER_DESCRIPTOR`。

**T10 — 服务端接线（最小改动）**（AC-15 AC-17）
`acp-runs.ts` 的既有 `acpExecutorFactory` 根据 `acpHostExecutable` 选择 `AcpRustExecutor` 或回落到 `AcpSdkExecutor`，保持调用面不分叉；`server.ts` 传入宿主路径与当前 Project 根，并由 `/api/config` 返回实际 runtime profile。权限与取消路由、`AcpRunControl`、`waitForAcpPermission` 的 HTTP 形状与语义**不变**——Rust permission 适配为同一个 pending store，settle 后经私有 `permission.decide` 转发给 Rust。

**T11 — 私有 entry 事件与公共事件投影**（AC-16）
Rust host 的私有 NDJSON 协议包含 `entry-appended` / `entry-updated` / `entries-removed`；`AcpRustExecutor` 在 Node 侧将其投影为既有 `HarnessRunEvent`。不扩展公共事件联合，也不修改 `HarnessRunStreamEventV1`：这保留浏览器、TUI、dashboard 和持久化 run 消费者的兼容性，同时让 Rust 侧用 entry index 做精细状态归并。助手 entry 的全量快照在投影时做前缀比较，只把新增后缀发成 `text-delta`。

**T12 — UI 流式渲染**（AC-18 至 AC-22）
- `AcpRustExecutor` 先把私有 entry 事件投影为既有公共事件，因此 `run-store.ts` 不引入第二套 reducer 分支；当前 `patchItem`/`appendItem` 仍靠稳定 key 与 `timelineRevision` 驱动局部列表更新。
- 新增浏览器侧平滑揭示缓冲：`ceil(积压 * 0.08)`/帧，按码点边界切分，消息切换与运行终止时立即排空。
- `RunView.tsx`：修 `followLatest`（AC-20），加焦点守卫（AC-22），使未变化条目的 key 与对象标识稳定以保住 `measureElement` 缓存（AC-19），`liveBins` 改为节流重算而非每事件重算。
- **保留** `@tanstack/react-virtual`。它已提供 `measureElement` 可变高度测量，不需要替换。
- 遵守 `DESIGN.md`：docked workbench 取向、语义 token、无一次性颜色/字号/圆角。

**T13 — 构建与 CI**
`packages/better-harness-desktop/scripts/rust.mjs` 增加 acp-host 的 build/test/stage；macOS 上 NSXPC 变体复用 [nsxpc-bundle.mjs](../../packages/better-harness-desktop/scripts/nsxpc-bundle.mjs) 的 bundle+codesign 流程（Windows/Linux 仅 stdio）。

**CI 决策**：新增 `.github/workflows/acp-host.yml`，`dtolnay/rust-toolchain` 固定版本，在 ubuntu/macos/windows 三个 OS 上跑 `cargo fmt --check` 与 `cargo test --locked`，后续加一个针对已构建二进制的 Node 集成测试。
不往 `ci.yml` 加 Rust 工具链——它当前 4 个 job 全无 Rust，加进去会拖慢整个主矩阵；`ci.yml` 继续覆盖 Node 回落通路（AC-17），这本身就是需要长期保有的证据。

**不改 `.tool-versions`**。原计划在其中声明 rust 版本，但仓库先例是在 workflow 里用 `dtolnay/rust-toolchain@<version>` 钉住（`better-harness-desktop.yml` 即如此），`.tool-versions` 只声明 nodejs。往其中加 rust 会让 asdf/mise 用户在不需要 Rust 时也去安装工具链，收益不抵副作用。

**crate 本地 `.gitignore`**。oxc-service 因为总被 `rust.mjs` 以 `--target-dir dist/rust` 驱动，所以从未产生 crate 内 `target/`，仓库也就没有对应的 ignore 规则。但任何人直接跑 `cargo test` 都会生成它，因此 acp-host 自带一份 `/target` 的 `.gitignore`（`cargo new` 的标准行为），不依赖构建脚本的重定向才能保持工作区干净。

## Test and Review Evidence

### 命令

| 命令 | 覆盖 |
|---|---|
| `cargo test --manifest-path packages/better-harness-desktop/rust/acp-host/Cargo.toml` | AC-1 AC-4~AC-12 AC-14 AC-21 |
| `npx vitest run packages/harness/test/acp-rust.test.ts` | AC-2 AC-3 AC-15 AC-16 AC-17 |
| `npx vitest run packages/harness/test/acp-sdk.test.ts` | 回落通路无回归 |
| `npm run harness:test && npm run harness-studio:test` | T9/T11 的连带影响 |
| `npm run harness-studio:test:browser` | AC-18~AC-22 |
| `npx vitest run test/skills-docs/doc-link-graph.test.mjs` | 本规格的相对链接可解析 |

### 按 AC 的证据要求

- **AC-1 / AC-2**：断言**行为**而非源码文本。`initialize` 只发一次由协议帧计数证明；进程存活/回收由 `exitCode`/`signalCode` 与「cwd 可被 `rm` 」证明——后者是既有 Windows `EBUSY` 回归测试已建立的手法（[acp-sdk.test.ts](../../packages/harness/test/acp-sdk.test.ts)），沿用它。
- **AC-5**：四类逃逸各一个用例，断言返回错误**且** `doesNotMatch` 绝对路径（这是 AGENTS.md 允许 regex 的「redaction 保证」场景之一，测试标题需点明该契约）。symlink 用例在 Windows 上按平台语义处理或显式跳过并说明理由，不得让 POSIX 通过冒充 Windows 证据。
- **AC-8**：字符边界与行对齐用**参数化**输入证明：ASCII、CJK、恰好落在多字节字符中间的上限、无换行的长行。断言返回值，不断言实现文本。
- **AC-14**：构造超过通道容量的事件洪泛，断言「最终状态一致」与「结构性事件零丢失」，不断言中间帧数量（那是实现细节）。
- **AC-18 / AC-20**：Playwright 对 preview URL 验证，检查 console/page 错误，并在 wide/compact/narrow 三档各存截图供布局评审。AC-20 需显式模拟「运行中上滚 → 断开跟随 → 滚回底部 → 恢复跟随」。
- **AC-4 / AC-16 / AC-21**：调用函数断言返回值或事件序列，不对源码或渲染标记做 pattern match。

### 跨平台

- 所有原生文件系统路径用 `node:path` / `std::path` 构造与检查，不切 `/`、不拼分隔符、不假设 `/tmp`、不忽略 Windows 盘符与 UNC 根。
- NDJSON 帧内的路径若需可移植表示，使用 `path.posix` 并与文件系统路径分开。
- 本地 POSIX 通过不构成 Windows 证据；以 `acp-host.yml` 的对应 OS job 作为权威凭据。

### 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| **开启 fs/terminal 扩大信任边界** | 外部 Agent 可读写 workspace、执行命令 | canonicalize 围栏（AC-5）+ 读写上限（AC-6）+ 终端并发上限（AC-10）+ 权限请求经用户确认（AC-13）。围栏是本规格中安全影响最大的一段，需单独评审 |
| `agent-client-protocol` 2.0.0 与 npm `@agentclientprotocol/sdk` 1.4.0 库版本落差 | 两条通路能力覆盖面不同，行为分叉 | 两者协议层同为 V1；用同一 fixture Agent 对拍两条通路（T1/T8），差异写进 `runtimeReceipt` 而非隐藏 |
| 首次把 cargo 引入 `harness` 的运行时依赖路径 | 无 Rust 环境时 Studio 不可用 | 二进制为可选、缺失即回落（AC-17）；`ci.yml` 持续覆盖回落通路 |
| Rust 侧未优化构建的深层 async 栈 | dev 构建可能栈溢出 | tokio 默认 worker 栈 2 MiB，比 Zed 遇到的 macOS GCD 512 KiB 宽松 4 倍，预计不触发；不预先引入专用线程，若实测触发再按需设 `thread_stack_size` |
| `parseHarnessRunEvent` 事件联合封闭 | 新事件使旧解析器抛错 | 服务端与客户端同包同版本发布；T11 同步改解析器；不新增外部消费者承诺 |
| UI 改动打掉虚拟列表高度缓存 | 流式输出时列表跳动 | AC-19 显式断言未变化条目标识稳定 |

### 与既有规格的关系

- [2026-08-24-harness-studio-acp-live-runs.md](2026-08-24-harness-studio-acp-live-runs.md) 与 [2026-08-26-studio-realtime-acp-compare.md](2026-08-26-studio-realtime-acp-compare.md) 确立的 `"acp"` 通路 AC 全部**继续有效**，由 AC-17 的回落通路保障。本规格是**并列新增**，不取代它们。
- `docs/ARCHITECTURE.md:16-18` 已声明 "future ACP services are Rust executables"，本规格是该原则的落地，不是新架构决策。
