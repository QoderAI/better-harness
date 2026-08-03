import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncAssets } from "../docs/scripts/sync-assets.mjs";

function relativeLuminance(hex) {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/gu)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function writeFixture(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

test("docs asset sync publishes the report as a clean directory route", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-docs-site-"));
  const repoRoot = path.join(root, "repo");
  const siteRoot = path.join(repoRoot, "docs");

  try {
    for (const [relativePath, content] of [
      ["assets/demo/better-harness-report.html", "report"],
      ["assets/demo/better-harness-findings-report.png", "image"],
      ["assets/demo/twenty-history.png", "history"],
      ["assets/agent-work-loop-en.svg", "loop"],
      ["assets/better-harness-architecture-en.svg", "architecture"],
      ["assets/install/codex-add-marketplace.jpg", "install"],
    ]) {
      await writeFixture(repoRoot, relativePath, content);
    }
    await writeFixture(siteRoot, "static/demo/better-harness-report.html", "stale");
    await writeFixture(siteRoot, "static/demo/twenty-history.gif", "stale animation");

    assert.equal(syncAssets({ repoRoot, siteRoot }), 6);
    assert.equal(
      await readFile(
        path.join(siteRoot, "static/demo/better-harness-report/index.html"),
        "utf8",
      ),
      "report",
    );
    await assert.rejects(
      access(path.join(siteRoot, "static/demo/better-harness-report.html")),
      { code: "ENOENT" },
    );
    assert.equal(
      await readFile(path.join(siteRoot, "static/demo/twenty-history.png"), "utf8"),
      "history",
    );
    await assert.rejects(
      access(path.join(siteRoot, "static/demo/twenty-history.gif")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checked-in demo report identifies the sample and provides site exits", async () => {
  const html = await readFile(
    path.join(process.cwd(), "assets", "demo", "better-harness-report.html"),
    "utf8",
  );

  assert.match(html, /data-demo-context="sample"/u);
  assert.match(html, /checked-in, evidence-bounded sample/u);
  assert.match(
    html,
    /href="https:\/\/qoderai\.github\.io\/better-harness\/" data-demo-target=""[^>]*>Back to Better Harness</u,
  );
  assert.match(
    html,
    /data-demo-target="docs\/installation"[^>]*>Install and run your report</u,
  );
  assert.match(html, /routeMarker = "\/demo\/better-harness-report"/u);
  assert.match(html, /window\.location\.pathname\.slice\(0, markerIndex\)/u);
});

test("low-value routes stay out of the sitemap and are marked noindex", async () => {
  const [config, root, blogListPage, demoHtml, favicon] = await Promise.all([
    readFile(path.join(process.cwd(), "docs", "docusaurus.config.js"), "utf8"),
    readFile(path.join(process.cwd(), "docs", "src", "theme", "Root.js"), "utf8"),
    readFile(
      path.join(process.cwd(), "docs", "src", "theme", "BlogListPage", "index.js"),
      "utf8",
    ),
    readFile(
      path.join(process.cwd(), "assets", "demo", "better-harness-report.html"),
      "utf8",
    ),
    readFile(
      path.join(process.cwd(), "docs", "static", "img", "favicon.svg"),
      "utf8",
    ),
  ]);

  // AC1: sitemap excludes search, thin blog taxonomy pages, and zh-Hans blog.
  assert.match(config, /ignorePatterns/u);
  for (const pattern of [
    "/better-harness/search",
    "/better-harness/blog/tags",
    "/better-harness/blog/tags/**",
    "/better-harness/blog/authors",
    "/better-harness/blog/authors/**",
    "/better-harness/blog/archive",
    "/better-harness/zh-Hans/search",
    "/better-harness/zh-Hans/blog",
    "/better-harness/zh-Hans/blog/**",
  ]) {
    assert.ok(
      config.includes(`"${pattern}"`),
      `docusaurus.config.js sitemap ignorePatterns missing ${pattern}`,
    );
  }

  // AC2: the same routes carry noindex,follow via the Root theme wrapper.
  assert.match(root, /content="noindex, follow"/u);
  assert.match(root, /route === "search"/u);
  assert.match(root, /blog\/archive/u);
  assert.match(root, /blog\/tags/u);
  assert.match(root, /blog\/authors/u);
  assert.match(root, /isUntranslatedBlogRoute/u);
  assert.match(root, /currentLocale === defaultLocale/u);

  // AC3: demo report is noindex,follow with a meta description.
  assert.match(demoHtml, /<meta name="robots" content="noindex, follow">/u);
  assert.match(demoHtml, /<meta name="description" content="[^"]+">/u);

  // AC4: blog list page renders a visible H1 from the configured blog title.
  assert.match(blogListPage, /<h1>\{blogTitle\}<\/h1>/u);

  // AC5: favicon declares an intrinsic size of at least 48x48.
  const faviconSize = favicon.match(/<svg[^>]*width="(\d+)" height="(\d+)"/u);
  assert.ok(faviconSize, "favicon.svg missing explicit width/height");
  assert.ok(Number(faviconSize[1]) >= 48 && Number(faviconSize[2]) >= 48);
});

test("homepage leads search visitors from proof to a host-specific setup", async () => {
  const [source, styles, theme, translations] = await Promise.all([
    readFile(path.join(process.cwd(), "docs", "src", "pages", "index.js"), "utf8"),
    readFile(path.join(process.cwd(), "docs", "src", "pages", "index.module.css"), "utf8"),
    readFile(path.join(process.cwd(), "docs", "src", "css", "custom.css"), "utf8"),
    readFile(path.join(process.cwd(), "docs", "i18n", "zh-Hans", "code.json"), "utf8"),
  ]);

  assert.match(
    source,
    /Built into Qoder Desktop; Qoder CLI can reuse it or install separately\./u,
  );
  assert.match(source, /AI Coding Agent Workflow Insights/u);
  assert.match(source, /Open-source insights for the Agent Work Loop/u);
  assert.match(source, /Delegate coding to agents\. Improve the loop around them\./u);
  assert.match(source, /project and session evidence into loop-level/u);
  assert.doesNotMatch(source, /Open-source AI coding workflow review/u);
  assert.match(source, /href="#choose-host"/u);
  assert.match(source, /id="choose-host"/u);
  assert.match(source, /Explore a sample report/u);
  assert.match(source, /Open source · MIT/u);
  assert.match(source, /Host-specific setup/u);
  assert.match(source, /Missing evidence stays explicit/u);
  assert.match(source, /Visible evidence/u);
  assert.match(source, /Prioritized impact/u);
  assert.match(source, /Bounded repair/u);
  assert.match(source, /Acceptance checks/u);
  assert.match(source, /host\.method/u);
  assert.match(source, /host\.output/u);
  assert.match(source, /View setup/u);
  assert.match(source, /View support details/u);
  assert.match(source, /Verified Quickstart/u);
  assert.match(source, /Adapter support/u);
  assert.equal([...source.matchAll(/supportLevel: "quickstart"/gu)].length, 6);
  assert.equal([...source.matchAll(/supportLevel: "adapter"/gu)].length, 3);
  assert.doesNotMatch(
    source,
    /View live demo report|REPORT_PROMPT|CodeBlock|<code>\/better-harness<\/code>/u,
  );
  assert.match(source, /\/demo\/twenty-history\.png/u);
  assert.doesNotMatch(source, /\/demo\/twenty-history\.gif/u);
  assert.equal(
    [...source.matchAll(/\/demo\/better-harness-findings-report\.png/gu)].length,
    1,
  );

  const imageTags = [...source.matchAll(/<img\b[\s\S]*?\/>/gu)].map(
    (match) => match[0],
  );
  assert.equal(imageTags.length, 3);
  assert.match(imageTags[0], /loading="eager"/u);
  assert.match(imageTags[0], /fetchPriority="high"/u);
  for (const image of imageTags.slice(1)) {
    assert.match(image, /loading="lazy"/u);
  }
  for (const image of imageTags) {
    assert.match(image, /width="\d+"/u);
    assert.match(image, /height="\d+"/u);
    assert.match(image, /decoding="async"/u);
    assert.match(image, /alt=\{translate\(/u);
  }

  assert.match(
    styles,
    /--ifm-hero-background-color:\s*var\(--ifm-color-primary-darkest\)/u,
  );
  assert.match(styles, /--ifm-hero-text-color:\s*#ffffff/u);
  assert.doesNotMatch(styles.match(/\.heroLead\s*\{[^}]*\}/u)?.[0] ?? "", /opacity/u);
  const mobileDemoAction =
    styles.match(/\.demoAction\s+:global\(\.button\)\s*\{[^}]*\}/u)?.[0] ?? "";
  assert.match(mobileDemoAction, /width:\s*100%/u);
  assert.match(mobileDemoAction, /white-space:\s*normal/u);
  assert.match(mobileDemoAction, /overflow-wrap:\s*anywhere/u);
  assert.match(
    styles,
    /@media \(min-width: 1200px\)[\s\S]*grid-template-columns:\s*repeat\(4, 1fr\)/u,
  );

  const heroBackgrounds = [
    ...theme.matchAll(/--ifm-color-primary-darkest:\s*(#[0-9a-f]{6})/giu),
  ].map((match) => match[1]);
  assert.equal(heroBackgrounds.length, 2);
  for (const background of heroBackgrounds) {
    assert.ok(
      contrastRatio(background, "#ffffff") >= 4.5,
      `${background} does not meet WCAG AA against white`,
    );
  }

  const zh = JSON.parse(translations);
  assert.match(zh["homepage.hosts.qoder.setup"].message, /Qoder CLI.*单独安装/u);
  assert.equal(zh["homepage.hosts.qoder.method"].message, "Desktop 内置");
  assert.equal(zh["homepage.hosts.output.canvas"].message, "Canvas 报告");
  assert.match(zh["homepage.hosts.pi.setup"].message, /完整交互式报告闭环/u);
  assert.match(zh["homepage.hosts.workBuddy.setup"].message, /WorkBuddy 自有路径/u);
  assert.equal(zh["homepage.hosts.status.quickstart"].message, "已验证快速开始");
  assert.equal(zh["homepage.hosts.status.adapter"].message, "适配器支持");
  assert.equal(
    zh["homepage.hero.eyebrow"].message,
    "Better Harness · 开源 Agent Work Loop 洞察",
  );
  assert.equal(
    zh["homepage.hero.title"].message,
    "把编码交给 Agent，用证据改进它背后的工作流。",
  );
  assert.match(zh["homepage.hero.lead"].message, /项目与会话证据/u);
  assert.equal(zh["homepage.meta.title"].message, "AI 编码智能体工作流洞察");
  assert.equal(zh["homepage.hero.chooseHost"].message, "选择你的 Coding Agent");
  assert.equal(zh["homepage.hero.viewDemo"].message, "查看示例报告");
  assert.match(zh["homepage.proof.evidence.description"].message, /项目或会话信号/u);
  assert.match(zh["homepage.demo.historyCaption"].message, /静态最终帧/u);
});

test("architecture and public matrices explain the nine/six/three support boundary", async () => {
  const [architecture, matrix, matrixZh] = await Promise.all([
    readFile(
      path.join(process.cwd(), "assets", "better-harness-architecture-en.svg"),
      "utf8",
    ),
    readFile(
      path.join(process.cwd(), "docs", "docs", "hosts", "adapter-matrix.md"),
      "utf8",
    ),
    readFile(
      path.join(
        process.cwd(),
        "docs",
        "i18n",
        "zh-Hans",
        "docusaurus-plugin-content-docs",
        "current",
        "hosts",
        "adapter-matrix.md",
      ),
      "utf8",
    ),
  ]);

  assert.match(architecture, /9 CAPABILITY ADAPTERS/u);
  assert.match(architecture, /6 verified Quickstart hosts/u);
  assert.match(architecture, /Pi \+ WorkBuddy \+ Grok adapters/u);
  assert.match(architecture, /Qoder Canvas · portable HTML/u);
  assert.match(architecture, /Better Harness Skill Workflow/u);
  assert.doesNotMatch(architecture, />\/better-harness<\/text>/u);
  assert.doesNotMatch(architecture, /Claude · Codex · Qoder · Cursor<\/text>/u);

  assert.match(matrix, /nine capability-level host adapters/u);
  assert.match(matrix, /Six\nhave verified public Quickstart paths/u);
  assert.match(matrix, /Pi, WorkBuddy, and Grok are visible as adapter\nsupport/u);
  assert.match(matrixZh, /九个能力层宿主适配器/u);
  assert.match(matrixZh, /六个已有验证过的公开\n快速开始路径/u);
  assert.match(matrixZh, /Pi、WorkBuddy 与 Grok 以适配器支持展示/u);
});
