import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Public-entrypoint layer: these are the user-facing surfaces that must stay
// synchronized. They are intentionally separate from the capability-local
// SUPPORTED_PLATFORMS set in support-declarations.test.mjs, so a host can exist
// as a partial adapter without being forced into the public Quickstart.

const PUBLIC_QUICKSTART_HOSTS = [
  { name: "Claude Code", anchor: "claude-code", id: "claudeCode" },
  { name: "Codex", anchor: "codex", id: "codex" },
  { name: "Qoder", anchor: "qoder", id: "qoder" },
  { name: "Cursor", anchor: "cursor", id: "cursor" },
  { name: "Qwen Code", anchor: "qwen-code", id: "qwenCode" },
  { name: "GitHub Copilot", anchor: "github-copilot", id: "githubCopilot" },
];

const ADAPTER_SUPPORT_HOSTS = [
  { name: "Pi", anchor: "pi", id: "pi" },
  { name: "WorkBuddy", anchor: "workbuddy", id: "workBuddy" },
];

const SUPPORTED_CARD_HOSTS = [
  ...PUBLIC_QUICKSTART_HOSTS,
  ...ADAPTER_SUPPORT_HOSTS,
];

const README_PRODUCT_ENTRIES = [
  { label: "Claude Code", anchor: "claude-code" },
  { label: "Codex Desktop", anchor: "codex-desktop" },
  { label: "Codex CLI", anchor: "codex-cli" },
  { label: "Qoder Desktop/CLI", anchor: "qoder" },
  { label: "Cursor", anchor: "cursor" },
  { label: "Qwen Code", anchor: "qwen-code" },
  { label: "GitHub Copilot CLI", anchor: "github-copilot" },
];

function readUtf8(...segments) {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function assertSameSet(actual, expected, label) {
  const a = [...new Set(actual)].sort();
  const b = [...new Set(expected)].sort();
  assert.deepEqual(a, b, `${label}: expected [${b.join(", ")}], got [${a.join(", ")}]`);
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertHeadingOrder(content, before, after, fileLabel) {
  const beforeIndex = content.search(new RegExp(`^##\\s+${escapeRegExp(before)}\\s*$`, "m"));
  const afterIndex = content.search(new RegExp(`^##\\s+${escapeRegExp(after)}\\s*$`, "m"));
  assert.ok(beforeIndex >= 0, `${fileLabel}: missing "## ${before}" heading`);
  assert.ok(afterIndex >= 0, `${fileLabel}: missing "## ${after}" heading`);
  assert.ok(
    beforeIndex < afterIndex,
    `${fileLabel}: "## ${before}" must appear before "## ${after}"`,
  );
}

function extractMarkdownLinks(line) {
  const links = [];
  const pattern = /\[([^\]]+)\]\(#([^\)]+)\)/gu;
  for (const match of line.matchAll(pattern)) {
    links.push({ label: match[1], anchor: match[2] });
  }
  return links;
}

function titleForAnchor(anchor) {
  const map = {
    "claude-code": "Claude Code",
    codex: "Codex",
    qoder: "Qoder",
    cursor: "Cursor",
    "qwen-code": "Qwen Code",
    "github-copilot": "GitHub Copilot",
  };
  if (map[anchor]) return map[anchor];
  return anchor
    .split("-")
    .map((word) => {
      if (word === "cli") return "CLI";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function headingPatternForAnchor(anchor) {
  // README uses `### Name` headings; Docusaurus uses `## Name {#anchor}`.
  const title = titleForAnchor(anchor);
  return new RegExp(`^(#{2,4})\\s+${title}(\\s+\\{#${anchor}\\})?\\s*$`, "m");
}

function checkReadmeQuickstart(filePath, introPattern, fileLabel) {
  const content = readUtf8(...filePath);
  const quickstartMatch = content.match(introPattern);
  assert.ok(quickstartMatch, `${fileLabel}: missing compact Quickstart product-entry line`);

  const links = extractMarkdownLinks(quickstartMatch[0]);
  const actualLabels = links.map((link) => link.label);
  const expectedLabels = README_PRODUCT_ENTRIES.map((entry) => entry.label);
  assertSameSet(actualLabels, expectedLabels, `${fileLabel}: Quickstart product entries`);

  for (const entry of README_PRODUCT_ENTRIES) {
    const link = links.find((l) => l.label === entry.label);
    assert.ok(link, `${fileLabel}: missing link for ${entry.label}`);
    assert.equal(link.anchor, entry.anchor, `${fileLabel}: ${entry.label} links to #${link.anchor}, expected #${entry.anchor}`);

    const headingPattern = headingPatternForAnchor(entry.anchor);
    assert.match(
      content,
      headingPattern,
      `${fileLabel}: ${entry.label} links to #${entry.anchor} but no matching Installation heading exists`,
    );
  }
  return content;
}

test("README.md Quickstart lists all seven product entries with valid installation anchors", () => {
  const content = checkReadmeQuickstart(
    ["README.md"],
    /Analyze and improve your coding workflow with:[^\n]*/u,
    "README.md",
  );
  assertHeadingOrder(content, "Quick start", "See it in action", "README.md");
  assertHeadingOrder(content, "Quick start", "Why Better Harness?", "README.md");
  assertHeadingOrder(content, "Quick start", "Architecture", "README.md");
  const quickStart = content.slice(
    content.indexOf("## Quick start"),
    content.indexOf("## See it in action"),
  );
  assert.doesNotMatch(quickStart, /```text[\s\S]*\/better-harness/u);
  assert.match(
    content,
    /qoderai\.github\.io\/better-harness\/\?utm_source=github&utm_medium=referral&utm_campaign=repository_landing&utm_content=readme_hero/u,
  );
  assert.match(content, /canonical registry covers eight host adapters/u);
  assert.match(content, /Pi and WorkBuddy currently\nremain adapter-support entries/u);
});

test("README.zh-CN.md Quickstart lists all seven product entries with valid installation anchors", () => {
  const content = checkReadmeQuickstart(
    ["README.zh-CN.md"],
    /使用以下 Coding Agent 分析并改进你的工作流：[^\n]*/u,
    "README.zh-CN.md",
  );
  assertHeadingOrder(content, "快速开始", "看看实际效果", "README.zh-CN.md");
  assertHeadingOrder(content, "快速开始", "为什么选择 Better Harness？", "README.zh-CN.md");
  assertHeadingOrder(content, "快速开始", "架构", "README.zh-CN.md");
  const quickStart = content.slice(
    content.indexOf("## 快速开始"),
    content.indexOf("## 看看实际效果"),
  );
  assert.doesNotMatch(quickStart, /```text[\s\S]*\/better-harness/u);
  assert.match(
    content,
    /qoderai\.github\.io\/better-harness\/zh-Hans\/\?utm_source=github&utm_medium=referral&utm_campaign=repository_landing&utm_content=readme_hero/u,
  );
  assert.match(
    content,
    /https:\/\/qoderai\.github\.io\/better-harness\/demo\/better-harness-report\//u,
  );
  assert.match(content, /规范注册表当前包含八个宿主适配器/u);
  assert.match(content, /Pi 与 WorkBuddy 仍属于适配器支持入口/u);
});

test("Docusaurus home page cards expose eight adapters without flattening support levels", () => {
  const source = readUtf8("docs", "src", "pages", "index.js");

  const anchors = [];
  const hostIdPattern = /id:\s*"homepage\.hosts\.([a-zA-Z]+)\.setup"/gu;
  for (const match of source.matchAll(hostIdPattern)) {
    anchors.push(match[1]);
  }

  const expectedIds = SUPPORTED_CARD_HOSTS.map((host) => host.id);
  assertSameSet(anchors, expectedIds, "docs/src/pages/index.js host translation ids");

  const cardAnchors = [];
  const anchorPattern = /anchor:\s*"([^"]+)"/gu;
  for (const match of source.matchAll(anchorPattern)) {
    cardAnchors.push(match[1]);
  }
  const expectedAnchors = SUPPORTED_CARD_HOSTS.map((host) => host.anchor);
  assertSameSet(cardAnchors, expectedAnchors, "docs/src/pages/index.js card anchors");

  const quickStartIndex = source.indexOf("<QuickStart />");
  const liveDemoIndex = source.indexOf("<LiveDemo />");
  const howItWorksIndex = source.indexOf("<HowItWorks />");
  assert.ok(quickStartIndex >= 0, "docs/src/pages/index.js: missing <QuickStart />");
  assert.ok(liveDemoIndex >= 0, "docs/src/pages/index.js: missing <LiveDemo />");
  assert.ok(howItWorksIndex >= 0, "docs/src/pages/index.js: missing <HowItWorks />");
  assert.ok(
    quickStartIndex < liveDemoIndex && liveDemoIndex < howItWorksIndex,
    "docs/src/pages/index.js: expected section order Hero -> QuickStart -> LiveDemo -> HowItWorks",
  );

  for (const host of PUBLIC_QUICKSTART_HOSTS) {
    const expectedPattern = `/docs/installation?host=${host.anchor}#${host.anchor}`;
    assert.ok(
      source.includes(expectedPattern),
      `docs/src/pages/index.js: ${host.name} card must use the Tabs query contract "${expectedPattern}" to activate the correct installation tab`,
    );
  }

  for (const host of ADAPTER_SUPPORT_HOSTS) {
    const expectedPattern = `/docs/hosts/adapter-matrix#${host.anchor}`;
    assert.ok(
      source.includes(expectedPattern),
      `docs/src/pages/index.js: ${host.name} card must link to bounded support details at "${expectedPattern}"`,
    );
  }

  assert.equal(
    [...source.matchAll(/supportLevel: "quickstart"/gu)].length,
    PUBLIC_QUICKSTART_HOSTS.length,
  );
  assert.equal(
    [...source.matchAll(/supportLevel: "adapter"/gu)].length,
    ADAPTER_SUPPORT_HOSTS.length,
  );
});

test("Docusaurus installation.mdx tabs match public Quickstart host anchors", () => {
  const source = readUtf8("docs", "docs", "installation.mdx");
  const tabValues = [];
  const tabPattern = /<TabItem\s+value="([^"]+)"/gu;
  for (const match of source.matchAll(tabPattern)) {
    tabValues.push(match[1]);
  }
  const expectedTabValues = PUBLIC_QUICKSTART_HOSTS.map((host) => host.anchor);
  assertSameSet(tabValues, expectedTabValues, "docs/docs/installation.mdx TabItem values");

  for (const host of PUBLIC_QUICKSTART_HOSTS) {
    const anchorPattern = new RegExp(`##\\s+${host.name}\\s+\\{#${host.anchor}\\}`, "u");
    assert.match(
      source,
      anchorPattern,
      `docs/docs/installation.mdx: missing ## ${host.name} {#${host.anchor}} anchor`,
    );
  }
});

test("zh-Hans installation.mdx tabs match public Quickstart host anchors", () => {
  const source = readUtf8("docs", "i18n", "zh-Hans", "docusaurus-plugin-content-docs", "current", "installation.mdx");
  const tabValues = [];
  const tabPattern = /<TabItem\s+value="([^"]+)"/gu;
  for (const match of source.matchAll(tabPattern)) {
    tabValues.push(match[1]);
  }
  const expectedTabValues = PUBLIC_QUICKSTART_HOSTS.map((host) => host.anchor);
  assertSameSet(tabValues, expectedTabValues, "zh-Hans installation.mdx TabItem values");

  for (const host of PUBLIC_QUICKSTART_HOSTS) {
    const anchorPattern = new RegExp(`##\\s+${host.name}\\s+\\{#${host.anchor}\\}`, "u");
    assert.match(
      source,
      anchorPattern,
      `zh-Hans installation.mdx: missing ## ${host.name} {#${host.anchor}} anchor`,
    );
  }
});

test("zh-Hans code.json has translations for all eight homepage host cards", () => {
  const codeJson = JSON.parse(readUtf8("docs", "i18n", "zh-Hans", "code.json"));
  for (const host of SUPPORTED_CARD_HOSTS) {
    for (const field of ["method", "setup"]) {
      const key = `homepage.hosts.${host.id}.${field}`;
      assert.ok(codeJson[key], `docs/i18n/zh-Hans/code.json missing ${key}`);
      assert.ok(codeJson[key].message, `docs/i18n/zh-Hans/code.json ${key} has no message`);
    }
  }
  assert.ok(codeJson["homepage.hosts.output.html"]?.message);
  assert.ok(codeJson["homepage.hosts.output.canvas"]?.message);
  assert.ok(codeJson["homepage.hosts.setupAction"]?.message);
  assert.ok(codeJson["homepage.hosts.supportAction"]?.message);
  assert.ok(codeJson["homepage.hosts.status.quickstart"]?.message);
  assert.ok(codeJson["homepage.hosts.status.adapter"]?.message);
});

test("public adapter matrix documents all eight adapters and their support boundaries", () => {
  const matrix = readUtf8("docs", "docs", "hosts", "adapter-matrix.md");
  const tableRows = matrix
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| ---") && !line.includes("Public entry"));
  const hostNames = tableRows.map((line) => line.split("|")[1].trim());
  const expectedNames = SUPPORTED_CARD_HOSTS.map((host) => host.name);
  assertSameSet(hostNames, expectedNames, "docs/docs/hosts/adapter-matrix.md host table");

  assert.match(
    matrix,
    /native metadata for all\neight adapters/u,
    "docs/docs/hosts/adapter-matrix.md does not declare eight native adapter metadata roots",
  );

  assert.match(
    matrix,
    /Claude Code\/Codex\/Cursor\/Qwen\/Copilot\/Pi\/WorkBuddy/u,
    "docs/docs/hosts/adapter-matrix.md HTML visual contract omits supported HTML hosts",
  );
  assert.match(matrix, /### Pi \{#pi\}/u);
  assert.match(matrix, /### WorkBuddy \{#workbuddy\}/u);
});

test("zh-Hans public adapter matrix documents all eight adapters and their support boundaries", () => {
  const matrix = readUtf8("docs", "i18n", "zh-Hans", "docusaurus-plugin-content-docs", "current", "hosts", "adapter-matrix.md");
  const tableRows = matrix
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| ---") && !line.includes("公开入口"));
  const hostNames = tableRows.map((line) => line.split("|")[1].trim());
  const expectedNames = SUPPORTED_CARD_HOSTS.map((host) => host.name);
  assertSameSet(hostNames, expectedNames, "zh-Hans adapter-matrix.md host table");

  assert.match(
    matrix,
    /八个宿主的原生元数据/u,
    "zh-Hans adapter-matrix.md does not declare eight native adapter metadata roots",
  );

  assert.match(
    matrix,
    /Claude Code\/Codex\/Cursor\/Qwen\/Copilot\/Pi\/WorkBuddy/u,
    "zh-Hans adapter-matrix.md HTML visual contract omits supported HTML hosts",
  );
  assert.match(matrix, /### Pi \{#pi\}/u);
  assert.match(matrix, /### WorkBuddy \{#workbuddy\}/u);
});

test("installation pages connect missing-host developers to matrices and pull requests", () => {
  const sources = [
    readUtf8("docs", "docs", "installation.mdx"),
    readUtf8("docs", "i18n", "zh-Hans", "docusaurus-plugin-content-docs", "current", "installation.mdx"),
  ];

  for (const source of sources) {
    assert.match(source, /\.\/hosts\/adapter-matrix/u);
    assert.match(source, /\.\/hosts\/contributing-new-coding-agent/u);
    assert.match(source, /https:\/\/github\.com\/QoderAI\/better-harness\/pulls/u);
  }
});

test("README.md documents the Qwen Code native install command", () => {
  const readme = readUtf8("README.md");
  assert.match(
    readme,
    /qwen extensions install QoderAI\/better-harness/,
    "README.md: missing Qwen Code native install command 'qwen extensions install QoderAI/better-harness'",
  );
});

test("README.zh-CN.md documents the Qwen Code native install command", () => {
  const readme = readUtf8("README.zh-CN.md");
  assert.match(
    readme,
    /qwen extensions install QoderAI\/better-harness/,
    "README.zh-CN.md: missing Qwen Code native install command 'qwen extensions install QoderAI/better-harness'",
  );
});

test("English installation.mdx documents Qwen Code and GitHub Copilot native install contracts", () => {
  const mdx = readUtf8("docs", "docs", "installation.mdx");
  assert.match(
    mdx,
    /qwen extensions install QoderAI\/better-harness/,
    "docs/docs/installation.mdx: missing Qwen Code command 'qwen extensions install QoderAI/better-harness'",
  );
  assert.match(
    mdx,
    /copilot plugin marketplace add QoderAI\/better-harness/,
    "docs/docs/installation.mdx: missing Copilot marketplace-add command",
  );
  assert.match(
    mdx,
    /copilot plugin install better-harness@better-harness/,
    "docs/docs/installation.mdx: missing Copilot plugin-install command",
  );
});

test("zh-Hans installation.mdx documents Qwen Code and GitHub Copilot native install contracts", () => {
  const mdx = readUtf8("docs", "i18n", "zh-Hans", "docusaurus-plugin-content-docs", "current", "installation.mdx");
  assert.match(
    mdx,
    /qwen extensions install QoderAI\/better-harness/,
    "zh-Hans installation.mdx: missing Qwen Code command 'qwen extensions install QoderAI/better-harness'",
  );
  assert.match(
    mdx,
    /copilot plugin marketplace add QoderAI\/better-harness/,
    "zh-Hans installation.mdx: missing Copilot marketplace-add command",
  );
  assert.match(
    mdx,
    /copilot plugin install better-harness@better-harness/,
    "zh-Hans installation.mdx: missing Copilot plugin-install command",
  );
});
