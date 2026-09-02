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
    "Open-source insights for the Agent Work Loop.",
  favicon: "img/favicon.svg",
  headTags: [
    {
      tagName: "meta",
      attributes: {
        name: "google-site-verification",
        content: "0hOARr2OBFHmWVFf1Bank71Vem1i36aGZnnwKLevZbM",
      },
    },
  ],

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
        blog: {
          path: "blog",
          routeBasePath: "blog",
          blogTitle: "Better Harness Blog",
          blogDescription:
            "Engineering practices for reliable coding-agent workflows.",
          showReadingTime: true,
          editUrl: `${GITHUB_URL}/edit/main/docs/`,
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
        sitemap: {
          // Keep low-value routes out of the sitemap: on-site search, thin
          // blog taxonomy pages, and the whole zh-Hans blog tree (its list and
          // taxonomy pages still serve English-fallback excerpts). Individual
          // zh-Hans posts with a real Chinese translation are made indexable by
          // the TRANSLATED_ZH_BLOG_ROUTES allowlist in src/theme/Root.js and are
          // discoverable via their hreflang alternate on the English post; they
          // are intentionally left out of this sitemap until the zh-Hans blog is
          // predominantly native Chinese and the tree exclusion can be dropped.
          ignorePatterns: [
            "/better-harness/search",
            "/better-harness/blog/tags",
            "/better-harness/blog/tags/**",
            "/better-harness/blog/authors",
            "/better-harness/blog/authors/**",
            "/better-harness/blog/archive",
            "/better-harness/zh-Hans/search",
            "/better-harness/zh-Hans/blog",
            "/better-harness/zh-Hans/blog/**",
          ],
        },
      }),
    ],
  ],

  themes: [
    [
      "@easyops-cn/docusaurus-search-local",
      {
        indexDocs: true,
        indexBlog: true,
        indexPages: false,
        language: ["en", "zh"],
        hashed: "filename",
        docsDir: [
          "docs",
          "i18n/zh-Hans/docusaurus-plugin-content-docs/current",
        ],
        searchBarPosition: "right",
        searchBarShortcutKeymap: "mod+k",
      },
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
            to: "/inspector",
            label: "Inspector",
            position: "left",
            className: "navbar__link--inspector-new",
            "aria-label": "Inspector",
          },
          {
            to: "/blog",
            label: "Blog",
            position: "left",
          },
          {
            href: "pathname:///demo/better-harness-report/",
            label: "Demo Report",
            position: "left",
          },
          {
            href: `${GITHUB_URL}/issues/new/choose`,
            label: "Report Issue",
            position: "right",
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
              { label: "Blog", to: "/blog" },
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
                href: "https://www.npmjs.com/package/@qoder-ai/better-harness",
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
