import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readUtf8(...segments) {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function countMatches(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

const ZH_DOCS_ROOT = [
  "docs",
  "i18n",
  "zh-Hans",
  "docusaurus-plugin-content-docs",
  "current",
];

test("Docusaurus uses credential-free local search for docs and blog plus a visible issue route", () => {
  const packageJson = JSON.parse(readUtf8("docs", "package.json"));
  const config = readUtf8("docs", "docusaurus.config.js");
  const navbarZh = JSON.parse(
    readUtf8("docs", "i18n", "zh-Hans", "docusaurus-theme-classic", "navbar.json"),
  );

  assert.equal(
    packageJson.dependencies["@easyops-cn/docusaurus-search-local"],
    "0.55.3",
  );
  assert.match(config, /themes:\s*\[/u);
  assert.match(config, /"@easyops-cn\/docusaurus-search-local"/u);
  assert.match(config, /indexDocs:\s*true/u);
  assert.match(config, /indexBlog:\s*true/u);
  assert.match(config, /indexPages:\s*false/u);
  assert.match(config, /language:\s*\["en",\s*"zh"\]/u);
  assert.match(config, /hashed:\s*"filename"/u);
  assert.match(config, /"i18n\/zh-Hans\/docusaurus-plugin-content-docs\/current"/u);
  assert.match(config, /searchBarShortcutKeymap:\s*"mod\+k"/u);
  assert.match(config, /issues\/new\/choose/u);
  assert.equal(navbarZh["item.label.Report Issue"].message, "报告问题");
});

test("installation prerequisites and verification paths stay aligned across locales", () => {
  const installation = readUtf8("docs", "docs", "installation.mdx");
  const installationZh = readUtf8(...ZH_DOCS_ROOT, "installation.mdx");

  assert.match(installation, /## Prerequisites \{#prerequisites\}/u);
  assert.match(installationZh, /## 前置条件 \{#prerequisites\}/u);
  for (const content of [installation, installationZh]) {
    assert.match(content, /Node\.js `>=22\.20\.0 <25\.0\.0`/u);
    assert.match(content, /npm `>=10\.9\.3 <12\.0\.0`/u);
    assert.match(content, /Windows/u);
    assert.match(content, /macOS/u);
    assert.match(content, /Linux/u);
    assert.equal(countMatches(content, /<TabItem\s+value="[^"]+"/gu), 6);
  }

  assert.equal(countMatches(installation, /^### Verify installation\s*$/gmu), 6);
  assert.equal(countMatches(installationZh, /^### 验证安装\s*$/gmu), 6);

  for (const content of [installation, installationZh]) {
    assert.match(content, /@better-harness /u);
    assert.match(content, /\$better-harness:better-harness /u);
    assert.match(content, /claude plugin details better-harness@better-harness/u);
    assert.match(content, /codex plugin list --marketplace better-harness/u);
    assert.match(content, /qodercli plugin list/u);
    assert.match(content, /qwen extensions list/u);
    assert.match(content, /copilot plugin list/u);
    assert.match(content, /copilot skill list/u);
  }
});

test("Pi single-run guidance keeps temporary loading separate from a persisted install", () => {
  const matrix = readUtf8("docs", "docs", "hosts", "adapter-matrix.md");
  const matrixZh = readUtf8(...ZH_DOCS_ROOT, "hosts", "adapter-matrix.md");

  for (const content of [matrix, matrixZh]) {
    assert.match(content, /pi -e <source>/u);
    assert.match(content, /cli-session/u);
  }
  assert.match(matrix, /one-run `pi -e` activation as the\n?separate `cli-session` session-only surface/u);
  assert.match(matrixZh, /单次\n?`pi -e` 激活作为独立的 `cli-session` session-only surface/u);
});

test("troubleshooting is bilingual, safe, linked, and routed through Getting Started", () => {
  const troubleshooting = readUtf8("docs", "docs", "troubleshooting.md");
  const troubleshootingZh = readUtf8(...ZH_DOCS_ROOT, "troubleshooting.md");
  const sidebars = readUtf8("docs", "sidebars.js");
  const introduction = readUtf8("docs", "docs", "introduction.md");
  const introductionZh = readUtf8(...ZH_DOCS_ROOT, "introduction.md");

  assert.match(sidebars, /"troubleshooting"/u);
  assert.match(introduction, /\.\/installation\.mdx#prerequisites/u);
  assert.match(introductionZh, /\.\/installation\.mdx#prerequisites/u);

  for (const content of [troubleshooting, troubleshootingZh]) {
    assert.equal(countMatches(content, /\.\/installation\?host=/gu), 6);
    assert.match(content, /\.\/hosts\/adapter-matrix#pi/u);
    assert.match(content, /\.\/hosts\/adapter-matrix#workbuddy/u);
    assert.match(content, /issues\/new\/choose/u);
    assert.match(content, /--no-sessions/u);
    assert.match(content, /INVALID_CWD/u);
    assert.match(content, /--qoder-home/u);
    assert.match(content, /\.copilot\/better-harness/u);
    assert.match(content, /qwen extensions list/u);
    assert.doesNotMatch(content, /cursor-agent[^\n]*--plugin-dir/u);
    assert.doesNotMatch(content, /rm\s+-rf|Remove-Item|del\s+\/s/iu);
  }
});

test("Cursor adapter guidance does not advertise an unavailable install flag", () => {
  const adapters = readUtf8("docs", "adapters", "README.md");

  assert.match(adapters, /native `cursor-agent --help` contract check/u);
  assert.match(adapters, /unavailable install plan/u);
  assert.doesNotMatch(adapters, /cursor-agent[^\n]*--plugin-dir/u);
});

test("first-report guidance no longer claims one invocation works for every host", () => {
  const firstReport = readUtf8("docs", "docs", "your-first-report.md");
  const firstReportZh = readUtf8(...ZH_DOCS_ROOT, "your-first-report.md");

  for (const content of [firstReport, firstReportZh]) {
    assert.match(content, /@better-harness/u);
    assert.match(content, /\$better-harness:better-harness/u);
    assert.match(content, /copilot skill list/u);
    assert.doesNotMatch(
      content,
      /```text\s*\/better-harness analyze this project's AI coding workflow and generate an evidence-backed report\s*```/u,
    );
  }
  assert.match(firstReport, /\[sample report\]\(pathname:\/\/\/demo\/better-harness-report\/\)/u);
  assert.match(firstReportZh, /\[示例报告\]\(pathname:\/\/\/demo\/better-harness-report\/\)/u);
});

test("bug report intake stays lightweight and covers current host paths", () => {
  const issueForm = readUtf8(".github", "ISSUE_TEMPLATE", "bug_report.yml");

  assert.doesNotMatch(issueForm, /current repository baseline|placeholder:\s*0\.3\.0/u);
  for (const host of [
    "Claude Code",
    "Codex",
    "Qoder",
    "Cursor",
    "Qwen Code",
    "GitHub Copilot",
    "Pi",
  ]) {
    assert.match(issueForm, new RegExp(`- ${host.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`));
  }
  assert.match(issueForm, /id: environment/u);
  assert.doesNotMatch(issueForm, /id: operating-system|id: installation|id: command/u);
  assert.doesNotMatch(issueForm, /Host marketplace or plugin manager|Cursor source-local --plugin-dir|npm package or standalone CLI/u);
  assert.equal(countMatches(issueForm, /required: true/gu), 6);
});

test("feature request intake stays outcome-focused", () => {
  const issueForm = readUtf8(".github", "ISSUE_TEMPLATE", "feature_request.yml");

  assert.match(issueForm, /What problem are you trying to solve\?/u);
  assert.match(issueForm, /What would success look like\?/u);
  assert.match(issueForm, /id: scope/u);
  assert.doesNotMatch(
    issueForm,
    /Likely extension surface|Proposed approach|Validation plan|Compatibility and delivery impact|canonical owner|activation path/u,
  );
  assert.equal(countMatches(issueForm, /required: true/gu), 4);
});
