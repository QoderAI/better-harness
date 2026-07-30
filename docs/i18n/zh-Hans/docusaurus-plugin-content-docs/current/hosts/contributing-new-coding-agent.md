---
id: contributing-new-coding-agent
title: 贡献新的 Coding Agent 宿主
sidebar_position: 2
---

# 贡献新的 Coding Agent 宿主

宿主支持是一组由证据支撑的能力声明，不是单个 manifest 或会话解析器。
贡献可以只实现宿主确实具备的部分，但必须明确标注部分支持和不可用能力。

完整且规范的流程位于仓库中：

- [新增 Coding Agent 贡献指南](https://github.com/QoderAI/better-harness/blob/main/docs/adapters/contributing-new-coding-agent.md)
- [仓库 Agent 指令](https://github.com/QoderAI/better-harness/blob/main/AGENTS.md)
- [社区扩展地图](https://github.com/QoderAI/better-harness/blob/main/docs/community.md)
- [架构原则](https://github.com/QoderAI/better-harness/blob/main/docs/ARCHITECTURE.md)

## 先确定支持边界

| 能力切片 | 必须明确的决定 |
| --- | --- |
| 原生契约 | 已验证的宿主版本与第一手来源 |
| Shell | 原生、源码本地、生成产物或不提供 |
| 已配置资产 | 可用、部分可用或不可用的作用域 |
| 会话证据 | 可用、部分可用或不可用的字段与事件 |
| 公共注册 | 只注册实际实现的能力 |
| 输出 | 现有 Canvas、HTML、Markdown，或理由充分的新模式 |
| 打包 | 公共 npm、运行时 bundle、仅源码或不打包 |

Shell 不代表已经支持会话证据，解析器也不代表 Skill 能被宿主原生发现。
请在带日期的 spec 中为每项声明设置稳定的验收 id 和证据路径。

## 贡献流程

1. 阅读宿主带版本的第一手契约，核对 manifest、路径、配置优先级、
   工作区身份、事件和隐私边界。
2. 保持宿主 Shell 轻量；规范的判断继续归属于共享 Skill、模型、参考资料、
   模板和能力自有脚本。
3. 分别实现已配置资产和会话适配器。使用脱敏 fixture，拒绝其他工作区的
   证据，并把缺失字段标为未观测，而不是记为零。
4. 只在已实现相应能力的注册表中加入宿主 id。遇到不支持的能力时应明确
   报错，不能回退到其他宿主。
5. 按风险验证聚焦测试、完整测试、真实宿主 smoke、打包边界，以及
   Windows、macOS、Linux 行为。
6. 更新[适配矩阵](./adapter-matrix)，并通过仓库 PR 模板提交
   Story/Spec/Test/Risk 证据。

## PR 示例

- [PR #6 — Qwen Code](https://github.com/QoderAI/better-harness/pull/6)
  展示了为什么除合成测试外，还需要原生源码核对、环境变量优先级、隐私边界
  和大小写不敏感文件系统测试。
- [PR #22 — GitHub Copilot](https://github.com/QoderAI/better-harness/pull/22)
  展示了如何用 spec 把 Shell、资产、会话、注册、文档和证据诚实性拆成
  可审查的部分。

PR 会在审查中变化。请把它们当作复盘示例，并以仓库当前指令和规范指南为准。
