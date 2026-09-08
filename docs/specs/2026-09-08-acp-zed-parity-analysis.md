# ACP 会话组件与 Zed 的交互对齐分析

## Traceability

- Spec ID: acp-zed-parity-analysis
- Status: Analysis only；待确定实现，不代表下述能力已经完成
- 用户要求：先分析缺少什么；继续优化 UI；与 Zed 保持相同场景下的逻辑一致。
- 参考快照：本地 Zed `1870e269ad`；本地 VS Code `58ae4094`；当前 ACP JS SDK `1.4.0`。
- 本次仅交付分析文档。刚开始的续聊代码草稿已经撤回，上一轮未提交的改动保留。

## 结论

当前组件是「单次 Harness run 的协议观察视图」，Zed 是「持续会话 + 消息编辑器」。
差距首先是生命周期与交互模型，其次才是密度、留白、标签与下拉样式。

上一轮实现了动态配置、权限先到时的工具计数，以及基础富内容展示，但仍有三处结构性问题：

1. `end_turn` 被当作整个运行结束，executor 随即关闭连接/进程，无法继续同一会话。
2. 配置和诊断信息占据 transcript，输入区没有跟随 session 的持久位置。
3. 组件仍依赖单 run 状态及固定 HTTP 地址；会话、轮次、视图、权限和配置缺少明确的所有权。

「与 Zed 一致」应定义为：相同能力和状态下，同一用户动作产生相同的会话结果。
不能把 Zed 内置 Agent 的专有功能无条件复制给所有外部 ACP Agent，也不能因无能力而显示无效按钮。

## 参考与证据边界

源码已核对：

- Z1：`crates/agent_ui/src/conversation_view/thread_view.rs`
  - `send` 1480、`send_impl` 1616、`send_content` 1658、`interrupt_and_send` 1813。
  - `cancel_generation` 1972、`retry_generation` 1981、`regenerate` 2005 附近。
  - 队列 2073–2375；`sync_queue_flag_to_native_thread` 2230。
  - `render_message_editor` 4331、`render_send_button` 5395。
  - 工具分类 8090/8157、权限 9359、富内容 10177、错误 11017。
- Z2：`crates/agent_ui/src/config_options.rs`：横向选择器 276、当前值触发器 407、picker 446。
- Z3：`crates/acp_thread/src/acp_thread.rs`：`ThreadStatus` 2222、消息回声去重 2549、
  `send_inner` 3650 附近、`run_turn` 3733 附近、取消 3901、checkpoint/rewind 3983。
- Z4：`crates/acp_thread/src/connection.rs`：能力接口，默认不支持 retry/truncate/history 等可选操作。
- Z5：`crates/agent_servers/src/acp.rs`：会话列表 559、load/resume 1746–1889、
  认证 1889、配置完整快照替换 4446。
- Z6：`crates/agent_ui/src/message_editor.rs`：SessionCapabilities 49、图片/上下文门控、命令补全。

Better Harness 对照位置：

- H1：`packages/harness/src/exec/acp-sdk.ts` 223/298 与 `acp-rust.ts` 222/256：单轮结束及资源回收。
- H2：`packages/harness-studio/src/app/run/AcpSessionSettings.tsx`：表单式配置、内置 HTTP 请求。
- H3：`packages/harness-studio/src/app/run/AcpSessionStream.tsx`：元信息、配置、计划、命令均位于正文前。
- H4：`packages/harness-studio/src/app/CompareLiveView.tsx` 与 `run/stream-run.ts`：单次启动、组件局部状态、流订阅。
- H5：`packages/harness-studio/src/app/run/TimelineEntry.tsx`、`StreamingMessage.tsx`、`AcpContent.tsx`：通用工具模板和内容呈现。
- H6：`packages/harness-studio/src/server/run-log.ts` 与 `debugger-session-transform.ts`：单 prompt 的结束快照，未有完整会话历史模型。

ACP 的 [Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn) 明确：一轮结束后可再次向同一 session 发送 prompt；cancel 结束当前轮次，需处理待决权限。
[Config options](https://agentclientprotocol.com/protocol/session-config-options) 则提供 Agent 定义的选项与整组更新。
VS Code AHP 只能作为编辑器交互参考，不能作为 ACP 协议兼容性依据。

本分析是指定本地源码快照与现有组件的对照，没有运行 Zed 做视觉逐像素验收；
也没有证明所有 Agent 支持表中可选能力。接口存在、能力被声明、实际调用成功是不同证据。

## 完整缺口矩阵

优先级：P0 为会话语义基础；P1 为常见交互和界面一致性；P2 为能力驱动的扩展场景。
「部分」表示上一轮已有基础，不应推倒重做。

| ID | 场景 | Zed 的行为 / 能力边界 | 当前状态与缺口 | 级别 |
| --- | --- | --- | --- | --- |
| G01 | 同一 session 多轮对话 | 一轮结束回到 Idle，下一条复用 session，Z3 | 缺失；end_turn 后回收 Agent，H1 | P0 |
| G02 | Stop、Close、新会话 | 停止生成清理当前轮次，连接关闭是不同动作，Z3/Z4 | 当前 Interrupt 终止整次 run，不能停止后继续，H1/H4 | P0 |
| G03 | 生成中输入 | 普通发送加入队列；立即发送先取消再提交，Z1 | 无底部输入、队列、队列暂停或编辑；不能仅禁用输入代替 | P0 |
| G04 | 轮次结果 | completed/cancelled/refusal/limits/error 的反馈不同，Z1/Z3 | 非 end_turn 一律映射非零 exit/error，丢失可继续的语义，H1 | P0 |
| G05 | 消息身份和回声 | 用户消息先入时间线；只去重匹配的 optimistic 回声；按 role/messageId 合并，Z3 | 仅助手文字支持部分 framing；用户回声会重复，富内容块被拆成独立消息，H5 | P0 |
| G06 | 稳定输入区 | transcript 下方常驻 editor，空会话有更大输入面积；支持展开，Z1 | 共享 prompt 在顶部，每列再展示 request，没有每列续聊 composer，H3/H4 | P0 |
| G07 | 配置位置和密度 | composer 工具条显示当前值；名称、说明放 tooltip/picker，Z2 | 部分：正确配置 schema 已有，但自动展开整个表单占据正文，H2 | P1 |
| G08 | 模型 picker | 搜索、分组、当前项、说明、收藏/循环快捷动作，Z2 | 分组 native select 已有；长列表搜索、收藏、快捷切换缺失；同名分组身份需保留，H2 | P1 |
| G09 | 依赖配置和故障 | 完整快照替换，订阅动态变更；当前选项消失须同步，Z5 | 部分：替换和失败重试已实现；需要统一请求/通知顺序与单一状态源，H2 | P1 |
| G10 | 默认配置 | Zed 有 Agent settings/default_config_options 路径，Z5 | 仅当前 run；「此会话」和「新会话默认值」无独立 UX；需另定义作用域 | P1 |
| G11 | 普通工具密度 | read/search 等通常紧凑行；edit/execute/待授权有更完整区域，Z1 | 所有工具都套 Tool call/名称/参数摘要/状态/详情，出现重复路径和无参数占位，H5 | P1 |
| G12 | 工具身份与权限状态 | 权限挂在对应工具；pending/waiting/rejected/cancelled/completed 保持区别，Z3 | ID 计数与部分更新已有；权限单独顶部 gate，拒绝/取消/授权等待缺少统一工具状态，H3/H5 | P0 |
| G13 | 多个权限/子会话权限 | 可定位到对应会话/工具；取消清理所有待决请求，Z1/Z3 | 已有待决权限集合基础；缺可扫描请求队列、定位及子会话关联 UX | P1 |
| G14 | 工具内容呈现 | Markdown、diff、终端、资源按内容类型分派，Z1 | 部分：已有基础内容视图；工具 text 仍 pre，非工具消息与同 messageId 多内容未统一，H5 | P1 |
| G15 | 文件和 diff 行动 | 路径可在编辑器定位；diff 与 action log 集成，Z1 | 路径多为文本、diff 多为展示；缺 open/reveal/copy 统一动作和变化汇总 | P1 |
| G16 | 终端 | 专用终端视图及对应状态；交互依赖宿主服务，Z1/Z3 | 仅已观察 output 快照；无统一终端控制/活动视图；Node 与 Rust 客户端能力不同 | P1 |
| G17 | 图片、文件、引用输入 | 按 promptCapabilities 开启图片和上下文；文件/符号/选区等由编辑器解析，Z6 | 只有文本发送；展示图片不等于可以输入图片；缺附件列表、删除、加载失败和发送能力校验 | P1 |
| G18 | Slash commands | / 补全来自当前会话，参数提示；native command 有专门路径，Z1/Z6 | 只是完整命令清单；无补全或发送。不能把所有 /command 当原生命令处理 | P1 |
| G19 | 计划和上下文 | 计划摘要、当前项、完成项；usage 紧凑呈现，Z1 | 计划优先级/usage 已有；计划完整展开，usage 在正文，缺 context pressure / completed 收束 UX | P1 |
| G20 | 草稿、滚动与切换 | thread 保存 draft/scroll；源码持久化有 native 分支，Z1 | 局部 React 状态；无会话级恢复；不能假设卸载组件就关闭 fetch，H4 | P0 |
| G21 | 历史加载/恢复 | list/load/resume 按 capability 使用，Z4/Z5 | 无会话管理调用；本地 Saved run 是观察快照，不是 Agent 已恢复的 session，H6 | P1 |
| G22 | 历史保真 | live/history 复用会话条目，恢复时更新配置和状态，Z3/Z5 | 工具 kind/content/locations 与会话配置未完整进入 SavedRunTimelineItem；缺 turn 分组和真实时间链，H6 | P1 |
| G23 | 发送故障、重试、认证 | 区分断线、认证、模型不可用、上下文过大等；retry 有能力门控，Z1/Z4 | generic alert；无保留发送尝试/安全重试语义和认证入口。不能网络超时就自动重复 prompt | P0 |
| G24 | 编辑历史/重新生成/checkpoint | client message id、truncate/rewind 等能力与工作区 action log 关联，Z3/Z4 | 缺失；不能仅删掉屏幕消息就伪装 Agent 上下文已回退 | P2 |
| G25 | 子会话、elicitation、压缩 | 专门条目/请求状态；native/扩展能力须区分，Z1/Z3/Z4 | 无完整交互，仅 unsupported 或原始证据；按版本与协商能力接入 | P2 |
| G26 | 长会话与可访问性 | 列表定位、局部展开、输入焦点、快捷动作；滚动不抢阅读，Z1/Z2 | 基础跟随/键盘已测；缺长期会话虚拟化、搜索、draft focus 恢复、稳定条目 UI 状态，H3/H5 | P1 |
| G27 | Compare 两列/多列 | Zed 单会话语义应成为每列的公共规则 | 缺独立 draft/queue/turn/session，首轮广播与后续分歧无显式状态；共享工作区不能被 checkpoint 隐式回退 | P0 |

## UI 目标：减少常驻信息，而不是缩小字体

### 每个会话只保留三个区域

1. **顶栏**：Agent / 会话短标题、一个必要状态、溢出菜单。工具计数降为次要信息，
   完整 sessionId、更新时间、成本和协议诊断进入 Session details / Inspector。
2. **正文**：用户消息、助手内容、紧凑工具活动。普通成功工具默认一行；需要决定的权限、
   错误和正在查看的 diff 才展开。计划仅默认显示当前步骤与完成度。
3. **底部 composer**：草稿、附件/引用、紧凑配置选择器、Send/Queue/Stop。
   没有必要再在正文中放一组完整配置表单和整段使用说明。

推荐结构（这是目标线框，不是已完成界面）：

```text
Agent / session title                         state  ⋯
─────────────────────────────────────────────────────
User prompt
Assistant response
▸ Read README.md                              done
Assistant response

─────────────────────────────────────────────────────
Follow-up draft…
[+ context]  [Mode ▾] [Model ▾] [Effort ▾] […]  [Send]
```

- 初始 Compare composer 只负责选择 Agent 和首轮共享内容；进入会话后收为紧凑的比较工具条。
- 每列单独续聊、配置、暂停和关闭；默认不把某列输入广播到其他列。
- 如提供「发送给所有列」，必须显式选择，定义忙碌列入队/空闲列立即发送的语义，
  并显示各列自己的轮次结果；不能以一个全局 Running 掩盖各列状态。
- 对齐 Zed 当前值触发器，不机械复制“所有配置都常驻”。3 个核心选择器是 Studio
  多列窄空间的建议；剩余选项进入统一 picker/更多菜单，能力和可编辑性不变。
- 选择器标题、说明、键盘帮助进入 popup；checkbox 型选项用紧凑开关/菜单项。
- Agent 未提供推理强度就不显示；未知配置类型可只读查看，不能猜测可提交值。
- 高密度不意味着缩小字号：沿用 DESIGN tokens；文本正文保持可读，去掉重复的
  Assistant / Tool call 标签、双重路径、No arguments retained 等非行动信息。
- 窄屏将 lane 切换/纵排与会话内部滚动明确分开，保持输入可达；不能同时产生三层无提示滚动。

## 逻辑一致性的交互契约

Zed 核心 ThreadStatus 只有 Idle/Generating；认证、加载、权限、错误、队列等由其他状态承载。
我们也应分开建模，避免把十几种互相独立的事实塞进一个 run.status 字符串。

| 当前条件 | 用户动作 | 必须发生的结果 |
| --- | --- | --- |
| Session ready + Idle + 非空草稿 | Send | 解析附件后发送一次，创建新 turn，复用 sessionId；保留该发送尝试以供故障恢复 |
| Generating + 空草稿 | 主按钮 | Stop；取消当前 turn，待决权限返回 cancelled，保留 session 和历史 |
| Generating + 非空草稿 | 普通 Send | 加入此 session 的队列；不并发提交第二个 prompt |
| Generating + 非空草稿 | Send immediately | 暂停普通队列；cancel 当前轮并等待协议完成，再发送新内容 |
| Generating / awaiting permission | Stop | 未结束工具立即标取消；允许接收原轮次的最终更新；不把迟到更新归入下一轮 |
| Idle + 非空队列 | 正常轮次结束 | 按顺序处理下一项；手动 Stop 后队列暂停，避免刚停止就又启动 |
| Idle | 改模型/推理强度 | 会话配置确认后生效；下一轮使用 Agent 返回的完整最新选项 |
| Generating | 改配置 | 按 Agent 支持处理并说明作用域；没有证据时不能声称改变了已开始生成的模型 |
| 任何状态 | Close session | 明确结束该会话，清理请求、权限和资源；能力支持时调用 close；不等价于删除历史 |
| 页面/侧栏切换 | 切换视图 | 会话控制器与草稿不因视图卸载而丢失；连接策略由 session owner 管，不由 JSX 生命周期偶然决定 |
| 发送请求超时/断流 | Retry / reconnect | 先区分未发出、Agent 已收到但结果未知、连接不可恢复；防止重复执行工具 |
| 历史消息编辑 | Edit and resend | 只在可以真实 rewind/truncate 时原会话重发；否则提供显式新会话分支，不伪装上下文已回退 |
| 有 native steer 能力 | Steer queued message | 才能声明“下一步边界生效”；外部 ACP cancel+prompt 不是同一个能力 |

错误、拒绝、Token 上限和用户取消需独立呈现，并各自给出可执行的下一步。
其中「重发用户输入」和 Agent 提供的「retry generation」不是同一个动作。

## 组件与运行时的边界

不建议仅在现有 `execute()` 内增加一个永久等待下一句的循环：这会把 run-finished、
保存时机、计量、Bench 任务终结和 session 生命周期继续绑在一起。

建议形成以下清晰边界，具体类型与迁移方式在实现 spec 中确定：

- **Session controller**：连接、sessionId、协商能力、配置、会话级队列、会话关闭与恢复。
  不由 Compare 列组件卸载隐式销毁；独立定义资源回收策略。
- **Turn controller**：prompt、turnId、生成/取消、stopReason、权限/询问、轮次结果和持久化。
  既有 Harness run 结果仍可按轮次结算；会话通过关联 ID 聚合多轮，不能只在关闭会话时保存。
- **统一会话状态 reducer**：消息/工具/计划/usage/config 的事实来源；UI 不再各自持有一份
  被 HTTP 回应与 protocol notification 竞争覆盖的独立配置。
- **ConversationView / Composer / ConfigPicker / ToolEntry**：只接收状态与动作接口。
  例如由 `actions.setConfig` 执行配置，移除可复用组件内部固定的 `api/acp/runs/...` 请求。
- **Compare owner**：首轮分发、lane 布局、共享目录提示、列间状态；不重写 Send/Queue/Cancel 规则。
- **Debugger owner**：观察光标、Raw ACP 与证据侧栏；复用相同的单会话动作逻辑。
  只读历史没有运行时控制器时，明确只读，不伪造续聊可用。

第一步需要确定数据主键：Agent connection / ACP session / 本地 conversation / turn / Harness run / message。
不能继续让前端 runId 兼任所有身份；多列、重连、回放和晚到事件会相互污染。

## 必须覆盖的验收场景

以下不是“源码有这个函数”的检查，而是端到端行为断言。

- AC-01：连续三轮只发生一次 session/new；sessionId 一致；preamble 只进入首轮。
- AC-02：两列分别输入/排队/切换配置，内容和结果从不串列；忙碌列不阻塞空闲列。
- AC-03：生成中普通发送入队，结束后发送；立即发送先取消；手动停止后队列保持暂停。
- AC-04：Stop 在流式文本、工具执行、多个权限等待期间均可用；之后仍能继续同会话。
- AC-05：取消确认与晚到 tool/update/message 的竞态不会开启两次 prompt、覆盖新轮状态或丢权限。
- AC-06：用户文本/图片组合消息回声不重复；相同内容的不同真实消息不能被误去重。
- AC-07：同 messageId 的文字/图片/资源合并，同角色不同 id 分开；累计计数不按 chunk 增长。
- AC-08：改模型后 dependent effort 整组替换；请求失败、选项消失、通知先/后于 HTTP 均正确。
- AC-09：能力缺失时隐藏不可执行入口；声明支持但实际拒绝时显示错误并保留草稿。
- AC-10：图片/文件加载失败、超限、删除附件、粘贴多内容、IME Enter、换行与发送均有明确结果。
- AC-11：命令补全使用当前会话命令；有参数命令保留参数；native command 特殊处理只按声明启用。
- AC-12：reload、视图切换、连接退出、恢复失败均不把旧 run 假装成 live session；草稿恢复策略明确。
- AC-13：每轮落盘；重开历史仍显示消息、工具富内容、配置与轮次；真实时间不得用数组序号伪造。
- AC-14：只有可用 retry/rewind/checkpoint 能力才出现对应动作；Compare 共享目录不静默回退其他列改动。
- AC-15：普通工具一行、待授权内容可见、终端/diff 可展开定位；没有空 Arguments/Result 占位堆积。
- AC-16：1440/1024/390 布局、200% 缩放、键盘/屏幕阅读器、中文输入法、弹层 Escape/focus return 通过。
- AC-17：长会话保持阅读位置，新增消息有提示，发送后跟随；虚拟化不会丢展开状态、焦点或终端快照。
- AC-18：Node、Rust stdio、NSXPC 跑同一会话一致性 fixture；再用真实 Agent 验证同一 session 的多轮与取消。

## 建议实现顺序

1. **会话语义**：G01–G06、G12、G20、G23、G27；先固定身份、turn/session 边界、停止与队列语义。
2. **核心 UI**：composer/紧凑 picker/工具行/元信息归位；与第一步一起交付，避免后端支持了而 UI 仍是报告页。
3. **日常使用闭环**：命令、附件、文件动作、计划/上下文、历史恢复、保真存储、长会话阅读。
4. **可选能力一致性**：native steer、retry/truncate、checkpoint、子会话、elicitation、压缩；逐项声明与验收。

阶段 1+2 才能称为「可继续对话且界面结构接近 Zed」。阶段 3+4 完成能力矩阵后，才能对
指定 Agent/transport 宣称相同场景下逻辑一致。现有 12 个浏览器用例证明上一轮功能，不能证明这些新场景。

## 分析交付与检查

- 本次没有完成或保留新的 runtime/UI 实现，未提交代码。
- 已核对本地 Zed、现有组件与 ACP 官方 prompt lifecycle，已区分通用 ACP 与宿主扩展能力。
- 未运行 Zed live UI；UI 目标仍需下一阶段实际截图和交互回归验证。
- 文档链接与路由图检查在交付前执行；不以文档检查代替运行时测试。
