# Memory 跨平台 CI 与合并验证

## Traceability

- Spec ID: memory-ci-readiness
- Status: In progress
- Request: 维护者要求更新并合并 PR #161。
- Related: [目录与 ACP](2026-09-09-memory-explorer-acp.md)

## Intent and Acceptance

- AC-1: Windows drive/verbatim 路径发现与读取通过原生 Memory 测试；检查完整根和后续组件，仍拒绝符号链接与 reparse points；原生会话 slug 编码不得把 Windows verbatim 前缀写进目录名。
- AC-2: CLI 帮助与 command inventory 基线准确包含新增 Memory 命令，其他字段保持不变；文档包基线包含 ADR 新路由的6份 Memory 文档。
- AC-3: CI 浏览器用例运行前提供原生 Evidence Host，实际验证 Memory 读取，而非缺失运行时或静默跳过。
- AC-4: 同步 main 后本地聚焦验证、PR 最终提交的 Windows/macOS/Linux CI 和远端合并状态分别确认。

## Plan and Non-goals

修正路径 Prefix 检查、更新已审阅的 CLI 基线，补齐浏览器 CI 原生运行时；更新 PR 描述与验证记录。不要修改无关产品行为、版本或发布资料。

## Evidence and Risk

旧 PR CI run 34298413281 的帮助/inventory 基线失败；desktop run 34298413253 的 Windows Memory 三项失败，发现结果均为空。Windows Path components 中 Prefix 不是独立文件系统对象，不应在 RootDir 尚未加入时 stat。AI: Codex。本地 POSIX 通过不等于 Windows 修复，等待对应 hosted job。

## Local Review Readiness

- Rust Memory 7 项通过；CLI contract/native integration/doc links 共20项通过；同步 main 后 Studio 构建与完整612项测试通过。
- command inventory 和 schema 移除唯一新增的 Memory 命令后，哈希分别等于原冻结值；帮助文本仅新增 Memory 行。
- 工作流只为 Linux 浏览器 job 构建 Evidence Host 并传入明确 executable。Windows/macOS/Linux native 证明仍由 Desktop job 提供。
- 差异限定为4个实现/基线文件及本spec；无暂存外文件。最终 hosted CI 结果与合并回执记录在 PR。

追加 CI 证据：run 34313962269 仅 Antigravity 文档包两个冻结数量断言失败；逐项核对增加的是 Memory ADR 与5份关联spec，实际114 nodes/320 edges/117 files，更新源包与成品包的对应基线。

更新基线后的本地完整 root CI suite：1746 passed / 7 skipped；跳过项保持既有环境边界。

Windows hosted run 34313961472 中 Memory 6项全通过；后续 main 带入的 stdio_host 四个夹具在目录创建报 InvalidFilename，因为 canonical Windows 路径的 verbatim 前缀进入了 Claude/Cursor/Pi/WorkBuddy slug。共享编码前去掉该前缀，保持 IO canonical path，并覆盖 drive/UNC 等价行为。

Windows slug 修复的本地验证：Evidence Host 完整46项 Rust 测试通过（21 unit、7 Memory、18 stdio）；新增 drive/UNC 与对应 verbatim 拼写的编码等价断言，保持原有发现行为测试。
