import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";

import {
  analyzeAiContributionCensus,
  renderMarkdown,
} from "../../scripts/ai-contribution-census/cli.mjs";

function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stderr}`);
  }
  return result.stdout.trim();
}

async function writeText(root, filePath, content) {
  const absolute = path.join(root, filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function commit(repo, subject, body = "", options = {}) {
  git(repo, ["add", "."]);
  const args = ["commit", "-q", "-m", subject];
  if (body) {
    args.push("-m", body);
  }
  if (options.author) {
    args.push("--author", options.author);
  }
  git(repo, args, {
    env: {
      GIT_AUTHOR_DATE: options.date ?? "2026-06-01T00:00:00+08:00",
      GIT_COMMITTER_DATE: options.date ?? "2026-06-01T00:00:00+08:00",
    },
  });
}

async function makeFixtureRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "better-harness-ai-census-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "human@example.com"]);
  git(repo, ["config", "user.name", "Human Author"]);

  await writeText(repo, "README.md", "# Demo\n");
  await commit(repo, "initial");

  await writeText(repo, "src/claude.ts", "export const claude = true;\n");
  await commit(
    repo,
    "fix: add Claude-generated path",
    [
      "Spec: docs/specs/claude-generated-path.md",
      "",
      "Generated with [Claude Code](https://claude.com/claude-code)",
      "",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
    ].join("\n"),
    { date: "2026-06-02T00:00:00+08:00" },
  );

  await writeText(repo, "src/aone.ts", "export const aone = true;\n");
  await writeText(repo, "src/aone.test.ts", "import './aone';\n");
  await writeText(repo, "docs/specs/aone-flow.md", "# Aone Flow\n");
  await commit(
    repo,
    "feat: add Aone-backed flow",
    "Co-developed-by: Aone Copilot <noreply@example.invalid>",
    { date: "2026-06-03T00:00:00+08:00" },
  );

  await writeText(repo, "src/qoder-fix.ts", "export const qoderFix = true;\n");
  await commit(
    repo,
    "fix(#123): generated bug fix",
    "问题表现: fixture bug\n根因分析: generated fix path",
    {
      author: "qoder-fixer <qoder-fixer@example.invalid>",
      date: "2026-06-04T00:00:00+08:00",
    },
  );

  await writeText(repo, "docs/claude-code-compat.md", "Claude Code compatibility note.\n");
  await commit(repo, "docs: mention Claude Code compatibility", "", {
    date: "2026-06-05T00:00:00+08:00",
  });

  await writeText(repo, "src/integration.ts", "export const integration = true;\n");
  await commit(
    repo,
    "Merge branch 'feature/claude-path' into main",
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    { date: "2026-06-05T01:00:00+08:00" },
  );

  await writeText(repo, "src/scm-merge.ts", "export const scmMerge = true;\n");
  await commit(repo, "scm-auto: merge feature into dev", "", {
    author: "q-flow-platform <q-flow-platform@example.invalid>",
    date: "2026-06-06T00:00:00+08:00",
  });

  return repo;
}

describe("AI contribution census", { concurrency: false }, () => {
  let repo;

  beforeAll(async () => {
    repo = await makeFixtureRepo();
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  test("separates AI code candidates from weak mentions and merge automation", () => {
    const result = analyzeAiContributionCensus({ cwd: repo, maxCommits: 20 });

    assert.equal(result.status, "ok");
    assert.equal(result.summary.analyzedCommits, 7);
    assert.equal(result.summary.aiEvidenceCommits, 6);
    assert.equal(result.summary.aiCodeContributionCandidates, 3);
    assert.equal(result.summary.automationMergeOrSync, 2);
    assert.equal(result.summary.weakMentionsOnly, 1);
    assert.equal(result.summary.missingSpecEvidence, 1);
    assert.equal(result.summary.missingTestEvidence, 2);
    assert.equal(result.summary.missingSpecAndTestEvidence, 1);

    const bySubject = new Map(result.commits.map((commitItem) => [commitItem.subject, commitItem]));
    assert.equal(bySubject.get("fix: add Claude-generated path").aiCodeContributionCandidate, true);
    assert.equal(bySubject.get("fix: add Claude-generated path").traceability.hasSpecEvidence, true);
    assert.equal(bySubject.get("fix: add Claude-generated path").traceability.hasTestEvidence, false);
    assert.equal(bySubject.get("feat: add Aone-backed flow").traceability.hasSpecEvidence, true);
    assert.equal(bySubject.get("feat: add Aone-backed flow").traceability.hasChangedTestFile, true);
    assert.equal(bySubject.get("fix(#123): generated bug fix").traceability.missing.join(","), "spec,test");
    assert.equal(bySubject.get("docs: mention Claude Code compatibility").ai.weakOnly, true);
    assert.equal(bySubject.get("docs: mention Claude Code compatibility").aiCodeContributionCandidate, false);
    assert.equal(bySubject.get("Merge branch 'feature/claude-path' into main").ai.automationMergeOrSync, true);
    assert.equal(bySubject.get("Merge branch 'feature/claude-path' into main").aiCodeContributionCandidate, false);
    assert.equal(bySubject.get("scm-auto: merge feature into dev").ai.automationMergeOrSync, true);
    assert.equal(bySubject.get("scm-auto: merge feature into dev").aiCodeContributionCandidate, false);
  });

  test("CLI emits parser-safe JSON and compact Markdown", () => {
    const script = path.join(process.cwd(), "scripts/ai-contribution-census/cli.mjs");
    const jsonRun = spawnSync(process.execPath, [
      script,
      "--cwd",
      repo,
      "--max-commits",
      "20",
      "--json",
    ], { encoding: "utf8" });

    assert.equal(jsonRun.status, 0, jsonRun.stderr);
    const json = JSON.parse(jsonRun.stdout);
    assert.equal(json.schemaVersion, 1);
    assert.equal(json.summary.aiCodeContributionCandidates, 3);
    assert.match(json.summary.recommendation, /lack both spec and test evidence/);

    const markdown = renderMarkdown(json);
    assert.match(markdown, /# AI Contribution Census/);
    assert.match(markdown, /AI code contribution candidates: 3/);
    assert.match(markdown, /Missing both spec and test evidence: 1/);
    assert.match(markdown, /weak mention only/);
    assert.match(markdown, /merge\/sync integration/);
  });
});
