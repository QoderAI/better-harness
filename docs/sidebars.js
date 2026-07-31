// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    {
      type: "category",
      label: "Getting Started",
      collapsed: false,
      items: [
        "introduction",
        "installation",
        "your-first-report",
        "troubleshooting",
      ],
    },
    {
      type: "category",
      label: "Concepts",
      collapsed: false,
      items: [
        "concepts/agent-work-loop",
        "concepts/findings-and-evidence",
        "concepts/glossary",
      ],
    },
    {
      type: "category",
      label: "Hosts",
      items: [
        "hosts/adapter-matrix",
        "hosts/contributing-new-coding-agent",
      ],
    },
    {
      type: "category",
      label: "Reference",
      items: ["reference/architecture"],
    },
  ],
};

export default sidebars;
