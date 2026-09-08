import type { workspace as enWorkspace } from "../en/workspace.js";

export const workspace: typeof enWorkspace = {
  welcome: {
    title: "欢迎",
    heading: "你的本地 Agent 工作台",
    description: "查看 Agent 的配置、会话与产物。准备好后，打开一个项目即可开始。",
    customizations: "检查 Agent 可用的指令和工具。",
    sessions: "回顾 Agent 活动，对比已保留的会话。",
    artifacts: "浏览并预览 Agent 生成的文件。",
  },
  sources: {
    button: "数据源",
    buttonAria: "数据源（{{count}} 个启用）",
    menuAria: "Studio 数据源",
    inspector: "检查器",
    evidence: "证据结果",
    bench: "试验台",
    active: "已启用",
    switch: "切换",
  },
  gate: {
    eyebrow: "本地项目",
    title: "打开一个项目开始",
    description: "选择仓库或项目目录。Studio 会将其记住为项目，并发现匹配的本地 Agent 输入与会话。",
    footerTitle: "项目范围发现",
    footerDetail: "所选目录限定了会话查找范围；全局会话文件夹不会被当作项目证据。",
    closeAria: "关闭 Studio 导航",
    openAria: "打开 Studio 导航",
    closeTitle: "关闭导航",
    openTitle: "打开导航",
  },
  intake: {
    eyebrow: "本地 Web 工作区",
    title: "打开一个项目工作区",
    description: "选择你工作过的仓库或项目目录。Studio 使用检查器的提供方发现能力，在本地 Agent 证据库中查找匹配的会话。",
    chooseAnotherTitle: "选择另一个项目工作区",
  },
  folderControls: {
    choose: "打开项目",
    change: "更换工作区",
    opening: "打开中…",
    openingAria: "正在打开项目",
    discovering: "正在跨本地提供方查找匹配的项目会话…",
    openingList: "正在打开项目工作台…",
    waiting: "等待选择项目目录…",
    discoveryFailed: "项目发现失败。",
  },
};