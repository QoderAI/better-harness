// @ts-check
// Docusaurus config for the Better Harness website (GitHub Pages).
// The site lives inside docs/: curated pages under docs/docs/, while the
// repository markdown at docs/ root (ARCHITECTURE.md, specs/, adrs/, ...)
// stays canonical and outside the published site.

import { themes as prismThemes } from "prism-react-renderer";

const GITHUB_URL = "https://github.com/QoderAI/better-harness";

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Better Harness",
  tagline:
    "See how your AI coding workflow works—and make it better, one step at a time.",
  favicon: "img/favicon.svg",

  url: "https://qoderai.github.io",
  baseUrl: "/better-harness/",
  organizationName: "QoderAI",
  projectName: "better-harness",
  trailingSlash: false,

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh-Hans"],
    localeConfigs: {
      en: { label: "English" },
      "zh-Hans": { label: "简体中文" },
    },
  },

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: "./sidebars.js",
          editUrl: `${GITHUB_URL}/edit/main/docs/`,
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: "demo/better-harness-findings-report.png",
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: "Better Harness",
        items: [
          {
            type: "docSidebar",
            sidebarId: "docs",
            position: "left",
            label: "Docs",
          },
          {
            href: "pathname:///demo/better-harness-report/",
            label: "Demo Report",
            position: "left",
          },
          {
            type: "localeDropdown",
            position: "right",
          },
          {
            href: `${GITHUB_URL}/blob/main/roadmap.md`,
            label: "Roadmap",
            position: "right",
          },
          {
            href: GITHUB_URL,
            label: "GitHub",
            position: "right",
          },
        ],
      },
      footer: {
        style: "dark",
        links: [
          {
            title: "Docs",
            items: [
              { label: "Introduction", to: "/docs/introduction" },
              { label: "Installation", to: "/docs/installation" },
              { label: "Agent Work Loop", to: "/docs/concepts/agent-work-loop" },
            ],
          },
          {
            title: "Project",
            items: [
              {
                label: "Demo Report",
                href: "pathname:///demo/better-harness-report/",
              },
              { label: "Roadmap", href: `${GITHUB_URL}/blob/main/roadmap.md` },
              {
                label: "Contribute",
                href: `${GITHUB_URL}/blob/main/docs/community.md`,
              },
            ],
          },
          {
            title: "More",
            items: [
              { label: "GitHub", href: GITHUB_URL },
              {
                label: "npm",
                href: "https://www.npmjs.com/package/@qoderai/better-harness",
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Qoder. MIT licensed.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ["bash"],
      },
    }),
};

export default config;
