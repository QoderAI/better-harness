import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { fileURLToPath } from "node:url";

import {
  buildHarnessInspectorReport,
  featureTreeDescendantIds,
  FeatureTreeParseError,
  main,
  openRenderedReport,
  parseFeatureTreeMarkdown,
  parseRenderOptions,
  renderHarnessInspectorHtml,
} from "../../scripts/harness-inspector/index.mjs";
import { summarizeSessionEvents } from "../../scripts/commit-session-link/index.mjs";

const CLI_PATH = fileURLToPath(new URL("../../scripts/harness-inspector/cli.mjs", import.meta.url));

// `realpathSync.native` expands Windows 8.3 short names (RUNNER~1) that the
// JS implementation keeps, and still resolves symlinks such as macOS /var.
function canonicalPath(target) {
  try {
    return realpathSync.native(target);
  } catch {
    return path.resolve(target);
  }
}

// One commit is enough Git history for a render, and an isolated workspace keeps
// the run away from this repository's own sessions and commits.
async function seededWorkspace(prefix) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), prefix));
  const git = (...args) => spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
  git("init", "--initial-branch=main");
  git("config", "user.email", "inspector@example.com");
  git("config", "user.name", "Inspector Test");
  await writeFile(path.join(workspace, "README.md"), "# fixture\n", "utf8");
  git("add", "README.md");
  git("commit", "-m", "chore: seed fixture");
  return workspace;
}

const FEATURE_TREE = `# Feature: Harness Inspector {#harness-inspector}
- status: active
- evidence: candidate

## Story: Inspect by feature {#inspect-by-feature}
- stage: implementation
- spec: docs/specs/2026-08-12-harness-inspector.md
- issue: QoderAI/better-harness#77
- prompt: Trace one declared delivery story.
- session: codex/session-a

## Story: Inspect by date {#inspect-by-date}
- stage: validation
- date: 2026-08-12
- commit: bbbbbbb
`;

const CHECKLIST_TREE = `- [ ] Better Harness
  - [x] Analyze and Improve
    - [x] Generate a readiness report
  - [ ] Inspector {#inspector}
    - [ ] Browse feature delivery
    - [ ] Correlate sessions and commits
`;

function fixtureSession(overrides = {}) {
  return {
    sessionId: "session-a",
    platform: "codex",
    firstSeen: "2026-08-12T08:00:00.000Z",
    lastSeen: "2026-08-12T09:30:00.000Z",
    durationMs: 90 * 60_000,
    files: ["scripts/harness-inspector/render-html.mjs"],
    prompts: [{ text: "Build the Harness Inspector date picker", timestamp: "2026-08-12T08:00:00.000Z" }],
    promptCount: 1,
    toolCallCount: 2,
    fileEditCount: 1,
    promptObservationCount: 2,
    userTurnCount: 1,
    retainedUserTurnCount: 1,
    assistantMessageCount: 2,
    models: ["gpt-5.6"],
    dialogue: {
      truncated: false,
      turns: [{
        index: 1,
        anchorId: "turn-1",
        prompt: { text: "Build the Harness Inspector date picker", timestamp: "2026-08-12T08:00:00.000Z" },
        steps: [
          { kind: "tool", callStep: 1, toolName: "Read" },
          { kind: "note", text: "I found the existing renderer boundary." },
          { kind: "tool", callStep: 2, toolName: "Bash" },
        ],
        toolCallCount: 2,
        messageCount: 4,
        response: "Implemented the date picker and verified the focused tests.",
        durationMs: 90 * 60_000,
        startMs: Date.parse("2026-08-12T08:00:00.000Z"),
        endMs: Date.parse("2026-08-12T09:30:00.000Z"),
      }],
    },
    toolTrace: {
      schemaVersion: 2,
      totalCalls: 2,
      shownCalls: 2,
      truncated: false,
      calls: [
        { id: "T1", step: 1, toolName: "Read", status: "observed", durationStatus: "observed", durationMs: 120, timingSource: "transcript-pair" },
        { id: "T2", step: 2, toolName: "Bash", status: "failed", durationStatus: "unobserved" },
      ],
    },
    toolActivity: {
      kind: "NormalizedToolActivityV1",
      schemaVersion: 1,
      totalCalls: 2,
      failedCalls: 1,
      familyCounts: { inspect: 1, change: 0, execute: 0, verify: 1, coordinate: 0, deliver: 0, other: 0 },
      segments: [],
      files: [{ path: "scripts/harness-inspector/render-html.mjs", callCount: 1, callIds: ["A1"], families: ["inspect"] }],
      calls: [
        { id: "A1", step: 1, toolName: "Read", operation: "read-files", actionLabel: "Read files", family: "inspect", status: "observed", durationStatus: "observed", durationMs: 120, startedAt: Date.parse("2026-08-12T08:05:00.000Z"), filePath: "scripts/harness-inspector/render-html.mjs", detail: "scripts/harness-inspector/render-html.mjs", detailKind: "redacted-input-summary" },
        { id: "A2", step: 2, toolName: "Bash", operation: "run-tests", actionLabel: "Run tests", family: "verify", status: "failed", durationStatus: "unobserved", startedAt: Date.parse("2026-08-12T09:10:00.000Z"), filePath: "test/reporting/harness-inspector.test.mjs", detail: "node --test test/reporting/harness-inspector.test.mjs", detailKind: "redacted-input-summary" },
      ],
    },
    ...overrides,
  };
}

function fixtureCorrelation() {
  return {
    schemaVersion: 1,
    commits: [
      {
        hash: "a".repeat(40),
        shortHash: "aaaaaaa",
        subject: "feat(inspector): add feature picker",
        authorName: "Fixture Author",
        authoredAt: "2026-08-12T08:45:00.000Z",
        committedAt: "2026-08-12T08:45:00.000Z",
        fileCount: 2,
        files: [
          { path: "scripts/harness-inspector/render-html.mjs", added: 75, removed: 4 },
          { path: "test/reporting/harness-inspector.test.mjs", added: 5, removed: 0 },
        ],
        linesAdded: 80,
        linesRemoved: 4,
        matches: [{
          sessionId: "session-a",
          platform: "codex",
          confidence: "explicit",
          evidence: { linkType: "harness-session", timeOverlap: true, overlappingFileCount: 1, cwdWithinRepo: true },
        }],
      },
      {
        hash: "b".repeat(40),
        shortHash: "bbbbbbb",
        subject: "test(inspector): validate date scope",
        authorName: "Fixture Author",
        authoredAt: "2026-08-12T09:20:00.000Z",
        committedAt: "2026-08-12T09:20:00.000Z",
        fileCount: 1,
        files: [{ path: "test/reporting/harness-inspector.test.mjs", added: 24, removed: 0 }],
        linesAdded: 24,
        linesRemoved: 0,
        matches: [{
          sessionId: "session-a",
          platform: "codex",
          confidence: "high",
          evidence: { linkType: null, timeOverlap: true, overlappingFileCount: 1, cwdWithinRepo: true },
        }],
      },
      {
        hash: "c".repeat(40),
        shortHash: "ccccccc",
        subject: "docs(inspector): describe renderer evidence",
        authorName: "Fixture Author",
        authoredAt: "2026-08-11T08:00:00.000Z",
        committedAt: "2026-08-11T08:00:00.000Z",
        fileCount: 1,
        files: [{ path: "scripts/harness-inspector/render-html.mjs", added: 8, removed: 1 }],
        linesAdded: 8,
        linesRemoved: 1,
        matches: [],
      },
    ],
  };
}

function scriptBody(html, openingTag) {
  const opening = html.indexOf(openingTag);
  assert.notEqual(opening, -1, `missing ${openingTag}`);
  const contentStart = opening + openingTag.length;
  const closing = html.indexOf("</script>", contentStart);
  assert.notEqual(closing, -1, `missing closing script tag for ${openingTag}`);
  return html.slice(contentStart, closing);
}

test("feature-tree parser builds typed hierarchy and refs (AC-1)", () => {
  const tree = parseFeatureTreeMarkdown(FEATURE_TREE, { source: "fixture.md" });
  assert.equal(tree.kind, "FeatureTreeV1");
  assert.deepEqual(tree.roots, ["harness-inspector"]);
  assert.equal(tree.nodes[0].evidence, "candidate");
  assert.equal(tree.nodes[1].evidence, "declared");
  assert.equal(tree.nodes.length, 3);
  assert.deepEqual(tree.nodes[0].children, ["inspect-by-feature", "inspect-by-date"]);
  assert.equal(tree.nodes[1].parentId, "harness-inspector");
  assert.equal(tree.nodes[1].stage, "implementation");
  assert.deepEqual(tree.nodes[1].refs.sessions, ["codex/session-a"]);
  assert.deepEqual(featureTreeDescendantIds(tree, "harness-inspector"), [
    "harness-inspector",
    "inspect-by-feature",
    "inspect-by-date",
  ]);
});

test("feature-tree parser builds hierarchy and todo state from a Markdown checklist (AC-1)", () => {
  const tree = parseFeatureTreeMarkdown(CHECKLIST_TREE, { source: "checklist.md" });
  assert.deepEqual(tree.roots, ["better-harness"]);
  assert.equal(tree.nodes.length, 6);
  assert.equal(tree.nodes[0].type, "feature");
  assert.equal(tree.nodes[0].status, "todo");
  assert.deepEqual(tree.nodes[0].children, ["analyze-and-improve", "inspector"]);
  assert.equal(tree.nodes[1].status, "complete");
  assert.equal(tree.nodes[2].type, "story");
  assert.equal(tree.nodes[2].parentId, "analyze-and-improve");
  assert.deepEqual(featureTreeDescendantIds(tree, "inspector"), [
    "inspector",
    "browse-feature-delivery",
    "correlate-sessions-and-commits",
  ]);
});

test("feature-tree checklist rejects malformed indentation and duplicate generated ids (AC-1)", () => {
  const invalid = `- [ ] Root
   - [ ] Bad indent
- [ ] Root
`;
  assert.throws(
    () => parseFeatureTreeMarkdown(invalid, { source: "invalid-checklist.md" }),
    (error) => {
      assert.ok(error instanceof FeatureTreeParseError);
      assert.match(error.diagnostics.map((item) => item.message).join("\n"), /two spaces|duplicate id/u);
      return true;
    },
  );
});

test("feature-tree parser rejects orphan, duplicate, invalid date, and unknown metadata (AC-1)", () => {
  const invalid = `## Story: Orphan {#same}
- date: 2026-02-31
- invented: value
# Feature: Duplicate {#same}
`;
  assert.throws(
    () => parseFeatureTreeMarkdown(invalid, { source: "invalid.md" }),
    (error) => {
      assert.ok(error instanceof FeatureTreeParseError);
      assert.deepEqual(error.diagnostics.map((item) => item.line), [1, 2, 3, 4]);
      assert.match(error.diagnostics.map((item) => item.message).join("\n"), /orphan story|real YYYY-MM-DD|unsupported metadata|duplicate id/u);
      return true;
    },
  );
});

test("report model keeps declared, candidate, exact-file, and date evidence distinct (AC-3, AC-4)", () => {
  const tree = parseFeatureTreeMarkdown(FEATURE_TREE, { source: "/workspace/repo/feature-tree.md" });
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: tree,
    sessions: [fixtureSession()],
    correlation: fixtureCorrelation(),
    filters: { platform: "codex", stage: "implementation", commitLimit: 20, sessionLimit: 20 },
  });
  assert.equal(report.kind, "HarnessInspectorReportV1");
  assert.equal(report.featureTree.source, "feature-tree.md");
  assert.equal(report.days.length, 2);
  assert.deepEqual(report.days[1].sessionIds, ["session-a"]);
  assert.deepEqual(report.days[1].commitHashes, ["a".repeat(40), "b".repeat(40)]);
  assert.deepEqual(report.stories[0].sessionLinks[0], {
    sessionId: "session-a",
    evidenceKind: "declared",
    confidence: "explicit",
    strength: "direct",
    source: "feature-tree",
    facts: ["Feature Tree declares session codex/session-a."],
    limitations: ["A reviewed declaration identifies intended scope; it does not prove that every session action contributed to the delivery."],
  });
  assert.equal(report.stories[1].sessionLinks[0].evidenceKind, "candidate");
  assert.equal(report.stories[1].sessionLinks[0].strength, "candidate");
  assert.equal(report.stories[1].sessionLinks[0].source, "declared-commit-correlation");
  assert.equal(report.sessions[0].commitLinks[0].confidence, "explicit");
  assert.deepEqual(report.sessions[0].commitLinks[0].overlappingFiles, [
    "scripts/harness-inspector/render-html.mjs",
    "test/reporting/harness-inspector.test.mjs",
  ]);
  assert.equal(report.sessions[0].commitLinks[0].strength, "direct");
  assert.equal(report.sessions[0].commitLinks[0].source, "commit-session-link");
  assert.match(report.sessions[0].commitLinks[0].facts.join("\n"), /declares harness-session/u);
  assert.equal(report.sessions[0].commitLinks[1].confidence, "high");
  assert.equal(report.sessions[0].commitLinks[1].strength, "observed");
  assert.match(report.sessions[0].commitLinks[1].limitations.join("\n"), /not proof.*authored/u);
  assert.equal(report.sessions[0].toolActivity.kind, "NormalizedToolActivityV1");
  assert.equal(report.sessions[0].promptObservationCount, 2);
  assert.equal(report.sessions[0].commitLinks.some((link) => link.evidenceKind === "file-context"), true);
});

test("report model distinguishes a session-created commit from files edited in that session", () => {
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [fixtureSession({
      files: [],
      fileEditCount: 0,
      toolActivity: {
        ...fixtureSession().toolActivity,
        calls: fixtureSession().toolActivity.calls.map(({ filePath: _filePath, filePaths: _filePaths, ...call }) => call),
      },
    })],
    correlation: {
      schemaVersion: 1,
      commits: [{
        hash: "d".repeat(40),
        shortHash: "ddddddd",
        subject: "test: commit existing workspace changes",
        authoredAt: "2026-08-12T08:45:00.000Z",
        committedAt: "2026-08-12T08:45:00.000Z",
        fileCount: 1,
        files: [{ path: "test/example.test.mjs", added: 2, removed: 1 }],
        linesAdded: 2,
        linesRemoved: 1,
        matches: [{
          sessionId: "session-a",
          confidence: "high",
          evidence: {
            linkType: null,
            commitObservedInCall: "A3",
            timeOverlap: true,
            overlappingFileCount: 0,
            overlappingFiles: [],
            cwdWithinRepo: true,
          },
        }],
      }],
    },
    filters: { platform: "codex" },
  });

  assert.equal(report.sessions[0].fileEditCount, 0);
  assert.deepEqual(report.sessions[0].toolActivity.files, []);
  assert.equal(report.sessions[0].commitLinks[0].evidenceKind, "observed-commit");
  assert.equal(report.sessions[0].commitLinks[0].strength, "observed");
  assert.equal(report.sessions[0].commitLinks[0].commitCallId, "A3");
  assert.deepEqual(report.sessions[0].commitLinks[0].linkedEditCallIds, []);
  assert.deepEqual(report.sessions[0].commitLinks[0].linkedEditFiles, []);
  assert.match(report.sessions[0].commitLinks[0].facts.join("\n"), /Create commit call A3/u);
  assert.match(report.sessions[0].commitLinks[0].facts.join("\n"), /No observed Edit\/Write path/u);
  assert.match(report.sessions[0].commitLinks[0].limitations.join("\n"), /files may have been changed before/u);
});

test("report model links Edit/Write calls to the next direct commit by time and exact path", () => {
  const session = fixtureSession();
  const firstPath = "src/first.mjs";
  const secondPath = "src/second.mjs";
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [fixtureSession({
      files: [firstPath, secondPath],
      fileEditCount: 2,
      toolActivity: {
        ...session.toolActivity,
        calls: [
          { id: "A1", step: 1, toolName: "Edit", operation: "edit-files", actionLabel: "Edit files", family: "change", status: "observed", durationStatus: "observed", durationMs: 100, startedAt: Date.parse("2026-08-12T08:10:00.000Z"), filePath:firstPath },
          { id: "A2", step: 2, toolName: "Write", operation: "edit-files", actionLabel: "Edit files", family: "change", status: "observed", durationStatus: "observed", durationMs: 100, startedAt: Date.parse("2026-08-12T08:50:00.000Z"), filePath:secondPath },
        ],
      },
    })],
    correlation: {
      schemaVersion: 1,
      commits: [
        {
          hash: "c".repeat(40), shortHash: "ccccccc", subject: "feat: first change",
          authoredAt: "2026-08-12T08:45:00.000Z", committedAt: "2026-08-12T08:45:00.000Z",
          fileCount: 1, files: [{ path:firstPath, added: 1, removed: 0 }], linesAdded: 1, linesRemoved: 0,
          matches: [{ sessionId:"session-a", confidence:"high", evidence:{ commitObservedInCall:"A3", timeOverlap:true, cwdWithinRepo:true } }],
        },
        {
          hash: "e".repeat(40), shortHash: "eeeeeee", subject: "feat: second change",
          authoredAt: "2026-08-12T09:00:00.000Z", committedAt: "2026-08-12T09:00:00.000Z",
          fileCount: 2, files: [{ path:firstPath, added: 1, removed: 0 }, { path:secondPath, added: 1, removed: 0 }], linesAdded: 2, linesRemoved: 0,
          matches: [{ sessionId:"session-a", confidence:"high", evidence:{ commitObservedInCall:"A4", timeOverlap:true, cwdWithinRepo:true } }],
        },
      ],
    },
    filters: { platform:"codex" },
  });

  const first = report.sessions[0].commitLinks.find((link) => link.hash === "c".repeat(40));
  const second = report.sessions[0].commitLinks.find((link) => link.hash === "e".repeat(40));
  assert.deepEqual(first.linkedEditCallIds, ["A1"]);
  assert.deepEqual(first.linkedEditFiles, [firstPath]);
  assert.equal(first.commitCallId, "A3");
  assert.deepEqual(second.linkedEditCallIds, ["A2"]);
  assert.deepEqual(second.linkedEditFiles, [secondPath]);
  assert.equal(second.commitCallId, "A4");
  assert.match(second.facts.join("\n"), /1 observed Edit\/Write call.*1 exact changed path/u);
  assert.match(second.limitations.join("\n"), /event order link the observed edits/u);
});

test("Inspector serializes one self-contained executable report document (AC-2, AC-7)", () => {
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [fixtureSession()],
    correlation: fixtureCorrelation(),
    filters: { platform: "codex", stage: "implementation" },
  });
  const html = renderHarnessInspectorHtml(report);

  assert.equal(html.startsWith("<!DOCTYPE html>"), true);
  assert.equal(html.includes("{{BH_"), false);
  assert.equal(html.includes("<script src="), false);
  assert.equal(html.includes("<link rel=\"stylesheet\""), false);
  assert.equal(html.includes("role=\"tablist\""), true);
  assert.equal(html.includes("role=\"tree\""), true);
  assert.equal(html.includes("role=\"dialog\""), true);

  const embeddedReport = JSON.parse(scriptBody(
    html,
    "<script type=\"application/json\" id=\"inspector-data\">",
  ));
  assert.deepEqual(embeddedReport, JSON.parse(JSON.stringify(report)));

  const clientScript = scriptBody(html, "<script>");
  assert.doesNotThrow(() => new Function(clientScript));
});

// Chrome copy is asserted through the elements that own it: the sidebar owns
// workspace identity, the breadcrumb owns the selected scope, and the tablist
// names what a reader browses by.
function chromeText(html, pattern) {
  const markup = html.match(pattern)?.[0] ?? "";
  return [...markup.matchAll(/<(?:span|strong|small|button)\b[^>]*>([^<]*)</gu)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

test("workspace identity lives in the sidebar and the breadcrumb starts at the selected scope", () => {
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/atlas-checkout",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [fixtureSession()],
    correlation: fixtureCorrelation(),
    filters: { platform: "codex" },
  });
  const html = renderHarnessInspectorHtml(report);

  // The sidebar names the tool once and the workspace once, with no tagline.
  assert.deepEqual(chromeText(html, /<div class="brand-copy">.*?<\/div>/su), [
    "Harness Inspector",
    "atlas-checkout",
  ]);
  // The breadcrumb no longer repeats the workspace name.
  assert.deepEqual(chromeText(html, /<nav class="workspace-breadcrumb".*?<\/nav>/su), [
    "Harness Inspector",
    "Delivery Workbench",
  ]);
  assert.deepEqual(chromeText(html, /<div class="mode-tabs".*?<\/div>/su), ["Capability", "Date"]);
});

test("a context label is only appended for reports that are not the reader's workspace", () => {
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/atlas-checkout",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [fixtureSession()],
    correlation: fixtureCorrelation(),
    filters: { platform: "codex" },
  });
  const labelled = renderHarnessInspectorHtml(report, { contextLabel: "English sample data" });

  assert.deepEqual(chromeText(labelled, /<div class="brand-copy">.*?<\/div>/su), [
    "Harness Inspector",
    "atlas-checkout · English sample data",
  ]);
});

test("Inspector template assembly does not reinterpret token-like session evidence", () => {
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [fixtureSession({
      toolActivity: {
        ...fixtureSession().toolActivity,
        calls: fixtureSession().toolActivity.calls.map((call, index) => index === 0
          ? { ...call, detail: "inspect literal {{BH_TRACE_TEMPLATES}} in source" }
          : call),
      },
    })],
    correlation: fixtureCorrelation(),
    filters: { platform: "codex" },
  });
  const html = renderHarnessInspectorHtml(report);
  const embeddedReport = JSON.parse(scriptBody(
    html,
    "<script type=\"application/json\" id=\"inspector-data\">",
  ));
  assert.equal(
    embeddedReport.sessions[0].toolActivity.calls[0].detail,
    "inspect literal {{BH_TRACE_TEMPLATES}} in source",
  );
});

test("Inspector tree renders checklist todo state and nested branches (AC-3)", () => {
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(CHECKLIST_TREE),
    sessions: [],
    correlation: { schemaVersion: 1, commits: [] },
    filters: {},
  });
  const html = renderHarnessInspectorHtml(report);
  assert.match(html, /class="tree-check complete" role="img" aria-label="Complete"/u);
  assert.match(html, /class="tree-check todo" role="img" aria-label="Todo"/u);
  assert.match(html, /data-tree-node-id="inspector" aria-expanded="true"/u);
  assert.match(html, /role="tab" aria-controls="panel-feature" aria-selected="false"/u);
  assert.match(html, /role="tab" aria-controls="panel-date" aria-selected="true"/u);
});

test("Inspector final HTML redacts credentials and omits absolute roots (AC-7)", () => {
  const secret = "sk-fixtureSecret123456789";
  const tree = parseFeatureTreeMarkdown(FEATURE_TREE.replace("Trace one declared delivery story.", `Trace secret=${secret}.`), {
    source: "/Users/private/workspace/feature-tree.md",
  });
  const report = buildHarnessInspectorReport({
    repoRoot: "/Users/private/workspace",
    featureTree: tree,
    sessions: [fixtureSession({
      prompts: [{ text: `Authorization: Bearer ${secret} /Users/private/secret.txt`, timestamp: "2026-08-12T08:00:00.000Z" }],
      dialogue: {
        truncated: false,
        turns: [{
          index: 1,
          prompt: { text: `Authorization: Bearer ${secret} /Users/private/prompt.txt`, timestamp: "2026-08-12T08:00:00.000Z" },
          steps: [{ kind: "note", text: `Read /Users/private/note.txt with token=${secret}` }],
          response: `Done in /Users/private/response.txt with secret=${secret}`,
          toolCallCount: 0,
          messageCount: 2,
        }],
      },
      tokenUsage: { inputTokens: 5, outputTokens: 3, secret },
    })],
    correlation: {
      ...fixtureCorrelation(),
      commits: fixtureCorrelation().commits.map((commit) => ({
        ...commit,
        subject: `${commit.subject} /Users/private/commit.txt`,
        authorName: "C:\\Users\\private\\author",
      })),
    },
    filters: { platform: "codex" },
  });
  const html = renderHarnessInspectorHtml(report);
  assert.doesNotMatch(html, new RegExp(secret, "u"));
  assert.doesNotMatch(html, /\/Users\/private/u);
  assert.doesNotMatch(html, /C:\\\\Users\\\\private/u);
  assert.match(html, /&lt;redacted&gt;|\\u003credacted>/u);
  assert.match(html, /absolute-path/u);
});

test("declared refs keep platform identity and reject ambiguous commit prefixes", () => {
  const tree = parseFeatureTreeMarkdown(`# Feature: Refs {#refs}\n## Story: Strict refs {#strict-refs}\n- session: qoder/session-a\n- commit: aaaaaaa\n`);
  const correlation = fixtureCorrelation();
  correlation.commits.push({ ...correlation.commits[0], hash: `aaaaaaa${"f".repeat(33)}`, shortHash: "aaaaaaa" });
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: tree,
    sessions: [fixtureSession()],
    correlation,
  });
  assert.deepEqual(report.stories[0].sessionLinks, []);
  assert.deepEqual(report.stories[0].commitHashes, []);
  assert.equal(report.diagnostics.some((item) => item.includes("ambiguous")), true);
});

test("date index includes every UTC day spanned by a session", () => {
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [fixtureSession({
      firstSeen: "2026-08-11T23:30:00.000Z",
      lastSeen: "2026-08-12T01:00:00.000Z",
      prompts: [{ text: "Continue after midnight", timestamp: "2026-08-12T00:10:00.000Z" }],
    })],
    correlation: { commits: [] },
  });
  assert.deepEqual(report.days.map((day) => day.date), ["2026-08-11", "2026-08-12"]);
  assert.deepEqual(report.days.map((day) => day.sessionIds), [["session-a"], ["session-a"]]);
  assert.deepEqual(report.days.map((day) => day.promptCount), [0, 1]);
});

test("session summary retains more than one thousand tool calls unless a caller chooses a limit (AC-5)", () => {
  const events = Array.from({ length: 1_005 }, (_, index) => ({
    type: "tool.requested",
    category: "tool",
    lifecyclePhase: "request",
    toolName: index % 2 ? "Read" : "Bash",
    toolInvocationId: `call-${index}`,
    timestamp: new Date(Date.UTC(2026, 7, 12, 8, 0, index)).toISOString(),
  }));
  const summary = summarizeSessionEvents({ sessionId: "large-session" }, events, {
    repoRoot: "/workspace/repo",
    platform: "codex",
    includeToolTrace: true,
  });
  assert.equal(summary.toolCallCount, 1_005);
  assert.equal(summary.toolTrace.totalCalls, 1_005);
  assert.equal(summary.toolTrace.shownCalls, 1_005);
  assert.equal(summary.toolTrace.truncated, false);
});

test("activity projection carries a wall-clock timeline and falls back to call order", () => {
  const timed = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [fixtureSession()],
    correlation: fixtureCorrelation(),
  }).sessions[0].toolActivity;
  assert.equal(timed.timeline.basis, "observed-time");
  assert.equal(timed.timeline.startMs, Date.parse("2026-08-12T08:05:00.000Z"));
  assert.equal(timed.timeline.spanMs, 65 * 60_000);
  assert.equal(timed.timeline.timedCallCount, 2);
  assert.equal(timed.calls[0].startedAt, Date.parse("2026-08-12T08:05:00.000Z"));

  const base = fixtureSession();
  const untimed = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [{
      ...base,
      toolActivity: { ...base.toolActivity, calls: base.toolActivity.calls.map(({ startedAt, ...call }) => call) },
    }],
    correlation: fixtureCorrelation(),
  }).sessions[0].toolActivity;
  assert.equal(untimed.timeline.basis, "call-sequence");
  assert.equal(untimed.timeline.timedCallCount, 0);
  assert.equal(Object.hasOwn(untimed.calls[0], "startedAt"), false);
});

test("SessionReplay preserves retained order and labels observed versus sequence-only time", () => {
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [fixtureSession()],
    correlation: fixtureCorrelation(),
  });
  const replay = report.sessions[0].replay;
  assert.equal(replay.kind, "SessionReplay");
  assert.equal(replay.schemaVersion, 1);
  assert.equal(replay.timeBasis, "observed-time");
  assert.deepEqual(replay.events.map((event) => event.type), [
    "prompt",
    "tool-call",
    "intermediate",
    "commit",
    "tool-call",
    "response",
  ]);
  assert.deepEqual(replay.events.map((event) => event.order), [1, 2, 3, 4, 5, 6]);
  assert.equal(replay.events.find((event) => event.type === "intermediate").timeBasis, "sequence-only");
  assert.equal(replay.events.find((event) => event.type === "response").timeBasis, "turn-boundary");
  assert.equal(replay.events.find((event) => event.type === "commit").title.startsWith("aaaaaaa"), true);
  assert.equal(replay.events.some((event) => event.id === `commit:${"b".repeat(40)}`), false);
  assert.deepEqual(
    replay.files.find((file) => file.path === "scripts/harness-inspector/render-html.mjs").eventIds,
    ["call:A1", `commit:${"a".repeat(40)}`],
  );

  const base = fixtureSession();
  const sequenceReplay = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [{
      ...base,
      dialogue: {
        ...base.dialogue,
        turns: base.dialogue.turns.map((turn) => ({
          ...turn,
          prompt: { ...turn.prompt, timestamp: null },
          startMs: null,
          endMs: null,
        })),
      },
      toolActivity: { ...base.toolActivity, calls: base.toolActivity.calls.map(({ startedAt, ...call }) => call) },
    }],
    correlation: { commits: [] },
  }).sessions[0].replay;
  assert.equal(sequenceReplay.timeBasis, "call-sequence");
  assert.equal(sequenceReplay.timedEventCount, 0);
  assert.equal(sequenceReplay.events.every((event) => event.timeBasis === "sequence-only"), true);
});

test("SessionReplay flags a clipped body as an excerpt and leaves whole bodies unmarked", () => {
  const base = fixtureSession();
  const longDetail = `rg -n ${"pattern ".repeat(80)}`;
  const replay = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [{
      ...base,
      toolActivity: {
        ...base.toolActivity,
        calls: base.toolActivity.calls.map((call, index) => (index === 0 ? { ...call, detail: longDetail } : call)),
      },
    }],
    correlation: fixtureCorrelation(),
  }).sessions[0].replay;
  const clipped = replay.events.find((event) => event.id === "call:A1");
  const prompt = replay.events.find((event) => event.type === "prompt");
  assert.equal(clipped.body.endsWith("\u2026"), true);
  assert.equal(clipped.bodyExcerpt, true);
  assert.equal(Object.hasOwn(prompt, "bodyExcerpt"), false);
});

test("one turn vocabulary is projected and retained prompts resolve to their real Turn", () => {
  const base = fixtureSession();
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [{
      ...base,
      // A capped, de-duplicated prompt list must not be read as Turn numbers.
      prompts: [{ text: "Second question", timestamp: "2026-08-12T08:40:00.000Z" }],
      userTurnCount: 3,
      promptObservationCount: 9,
      dialogue: {
        truncated: false,
        turns: [
          { index: 1, anchorId: "turn-1", prompt: { text: "First question", timestamp: "2026-08-12T08:00:00.000Z" }, steps: [], toolCallCount: 0, messageCount: 2, response: null },
          { index: 2, anchorId: "turn-2", prompt: { text: "Second question", timestamp: "2026-08-12T08:40:00.000Z" }, steps: [], toolCallCount: 0, messageCount: 2, response: null },
        ],
      },
    }],
    correlation: fixtureCorrelation(),
  });
  const session = report.sessions[0];
  assert.equal(session.prompts[0].turnIndex, 2);
  assert.deepEqual(session.turnCoverage, {
    basis: "dialogue-turns",
    turnCount: 2,
    shownPromptCount: 1,
    normalizedUserTurnCount: 3,
    observationCount: 9,
    truncated: true,
  });
});

test("dialogue projection preserves ordered process steps and explicit response availability", () => {
  const base = fixtureSession();
  const sourceTurn = base.dialogue.turns[0];
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: parseFeatureTreeMarkdown(FEATURE_TREE),
    sessions: [{
      ...base,
      dialogue: {
        truncated: false,
        turns: [{
          ...sourceTurn,
          response: null,
          responseStatus: "incomplete",
          intermediateCount: 1,
          eventCount: 3,
          shownEventCount: 3,
          processTruncated: false,
        }],
      },
    }],
    correlation: fixtureCorrelation(),
  });

  const turn = report.sessions[0].dialogue.turns[0];
  assert.deepEqual(turn.steps.map((step) => step.kind), ["tool", "note", "tool"]);
  assert.equal(turn.response, null);
  assert.equal(turn.responseStatus, "incomplete");
  assert.equal(turn.intermediateCount, 1);
  assert.equal(turn.eventCount, 3);
  assert.equal(turn.shownEventCount, 3);
  assert.equal(turn.processTruncated, false);
});

test("Harness Inspector help is workspace-independent and sanitizes bad argv (AC-2, AC-8)", () => {
  const help = spawnSync(process.execPath, [CLI_PATH, "--help"], { cwd: os.tmpdir(), encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Harness Inspector v1/u);
  assert.match(help.stdout, /Feature Tree and Date scope pickers/u);
  assert.match(help.stdout, /inspector\s+Render and open the current workspace with activity/u);
  assert.match(help.stdout, /latest 30 UTC days.*200 commits/u);
  assert.equal(help.stderr, "");

  const privateValue = path.join(os.tmpdir(), "private-feature-tree");
  const invalid = spawnSync(process.execPath, [CLI_PATH, "render", "--unknown", privateValue], { encoding: "utf8" });
  assert.equal(invalid.status, 64);
  assert.equal(invalid.stderr.includes(privateValue), false);
});

test("--open is parsed as a valueless flag without consuming the next argument", () => {
  assert.deepEqual(parseRenderOptions(["--open"]), { "--open": true });
  assert.deepEqual(parseRenderOptions(["--open", "--out", "report.html"]), {
    "--open": true,
    "--out": "report.html",
  });
  assert.deepEqual(parseRenderOptions(["--out", "report.html", "--open"]), {
    "--out": "report.html",
    "--open": true,
  });

  // A value handed to a boolean flag stays a stray token rather than a silently
  // accepted argument, and value options still require their value.
  assert.throws(() => parseRenderOptions(["--open", "true"]), (error) => error.exitCode === 64);
  assert.throws(() => parseRenderOptions(["--open", "--open"]), /duplicate option: --open/u);
  assert.throws(() => parseRenderOptions(["--out"]), /missing option value: --out/u);
});

test("opening a report launches an absolute file URL and reports launch failure", () => {
  const launched = [];
  const opened = openRenderedReport(path.join("out", "inspector.html"), {
    open: (url) => {
      launched.push(url);
      return true;
    },
  });

  assert.equal(opened, true);
  assert.equal(launched.length, 1);
  assert.equal(launched[0].startsWith("file:///"), true);
  assert.equal(fileURLToPath(launched[0]), path.resolve("out", "inspector.html"));
  assert.equal(openRenderedReport("inspector.html", { open: () => false }), false);
});

test("render writes the report before opening it and reports the launch in its summary", async () => {
  const workspace = await seededWorkspace("better-harness-inspector-open-");
  const outputPath = path.join(workspace, "inspector.html");
  const openedPaths = [];
  const written = [];
  const stdoutWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  let exitCode;
  try {
    exitCode = await main(["render", "--workspace", workspace, "--out", outputPath, "--open"], {
      open: (target) => {
        // The file must already exist when the viewer is launched.
        openedPaths.push({ target, exists: existsSync(target) });
        return true;
      },
    });
  } finally {
    process.stdout.write = stdoutWrite;
    await rm(workspace, { recursive: true, force: true });
  }

  assert.equal(exitCode, 0);
  assert.deepEqual(openedPaths, [{ target: outputPath, exists: true }]);
  const summary = JSON.parse(written.join(""));
  assert.equal(summary.outputPath, outputPath);
  assert.equal(summary.opened, true);
});

test("zero arguments render the current workspace and open the written report", async () => {
  const workspace = await seededWorkspace("better-harness-inspector-default-");
  // The CLI derives the default output path from `git rev-parse --show-toplevel`,
  // which reports the long Windows path, so the expectation must expand 8.3 short
  // names in the temp dir as well as macOS /var -> /private/var symlinks.
  const canonicalWorkspace = canonicalPath(workspace);
  const openedPaths = [];
  const written = [];
  const stdoutWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  let exitCode;
  let summary;
  let embeddedReport;
  try {
    exitCode = await main([], {
      cwd: workspace,
      now: new Date("2026-08-14T10:00:00.000Z"),
      open: (target) => {
        openedPaths.push({ target, exists: existsSync(target) });
        return true;
      },
    });
    summary = JSON.parse(written.join(""));
    const html = await readFile(summary.outputPath, "utf8");
    embeddedReport = JSON.parse(scriptBody(
      html,
      "<script type=\"application/json\" id=\"inspector-data\">",
    ));
  } finally {
    process.stdout.write = stdoutWrite;
    await rm(workspace, { recursive: true, force: true });
  }

  assert.equal(exitCode, 0);
  assert.equal(
    summary.outputPath,
    path.join(canonicalWorkspace, ".qoder", "better-harness-runs", "harness-inspector", "inspector.html"),
  );
  assert.deepEqual(openedPaths, [{ target: summary.outputPath, exists: true }]);
  assert.equal(summary.opened, true);
  assert.equal(embeddedReport.filters.since, "2026-07-16T00:00:00.000Z");
  assert.equal(embeddedReport.filters.until, "2026-08-14T23:59:59.999Z");
  assert.equal(embeddedReport.filters.commitLimit, 200);
  assert.equal(embeddedReport.filters.sessionLimit, 100);
});

test("render leaves the browser alone when --open is absent", async () => {
  const workspace = await seededWorkspace("better-harness-inspector-no-open-");
  const outputPath = path.join(workspace, "inspector.html");
  let openCalls = 0;
  const written = [];
  const stdoutWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  let exitCode;
  try {
    exitCode = await main(["render", "--workspace", workspace, "--out", outputPath], {
      open: () => {
        openCalls += 1;
        return true;
      },
    });
  } finally {
    process.stdout.write = stdoutWrite;
    await rm(workspace, { recursive: true, force: true });
  }

  assert.equal(exitCode, 0);
  assert.equal(openCalls, 0);
  assert.equal(Object.hasOwn(JSON.parse(written.join("")), "opened"), false);
});

test("a report that could not be opened still succeeds and says so", async () => {
  const workspace = await seededWorkspace("better-harness-inspector-open-failure-");
  const outputPath = path.join(workspace, "inspector.html");
  const written = [];
  const stdoutWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  let exitCode;
  try {
    exitCode = await main(["render", "--workspace", workspace, "--out", outputPath, "--open"], {
      open: () => false,
    });
  } finally {
    process.stdout.write = stdoutWrite;
  }

  assert.equal(exitCode, 0);
  assert.equal(existsSync(outputPath), true);
  assert.equal(JSON.parse(written.join("")).opened, false);
  await rm(workspace, { recursive: true, force: true });
});
