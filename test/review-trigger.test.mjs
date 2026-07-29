import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildChangeTestEvidenceFindings,
  normalizeAgentInstructionFindings,
  runReviewTrigger,
} from "../scripts/review-trigger/cli.mjs";

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stderr}`);
  }
  return result.stdout;
}

async function writeFixture(root, filePath, content = "") {
  const absolute = path.join(root, filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function makeRepo(files) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "better-harness-review-trigger-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);

  for (const [filePath, content] of Object.entries(files)) {
    await writeFixture(repo, filePath, content);
  }

  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "initial"]);
  return repo;
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [
    path.join(process.cwd(), "scripts/review-trigger/cli.mjs"),
    ...args,
  ], {
    encoding: "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env,
    input: options.input,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

test("normalizes AGENTS.md review findings for proactive payloads", () => {
  const findings = normalizeAgentInstructionFindings({
    findings: [{
      id: "root-length-hard-cap",
      severity: "warning",
      file: "AGENTS.md",
      line: 1,
      evidence: "AGENTS.md is 205 lines.",
      remediation: "Split long workflows into linked docs.",
    }],
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, "agent-instructions.root-length-hard-cap");
  assert.equal(findings[0].category, "agent-instructions");
  assert.equal(findings[0].source, "agent-lint:agents-md-review");
  assert.equal(findings[0].recommendationId, "agent-lint.agents-md-review.root-length-hard-cap");
  assert.deepEqual(findings[0].title, {
    "zh-CN": "根指引过长导致关键规则难以快速找到",
    en: "The root agent guide is too long to scan reliably",
  });
  assert.match(findings[0].why.en, /hard to scan/);
  assert.match(findings[0].recommendation["zh-CN"], /链接文档或 skill/);
  assert.match(findings[0].passCheck.en, /root guide is below the hard cap/);
  assert.deepEqual(findings[0].aiFixLabel, {
    "zh-CN": "拆分根指引",
    en: "Split root guide",
  });
  assert.deepEqual(findings[0].suggestion, {
    en: findings[0].recommendation.en,
    zh: findings[0].recommendation["zh-CN"],
    "zh-CN": findings[0].recommendation["zh-CN"],
  });
  assert.match(findings[0].fingerprint, /^[a-f0-9]{24}$/u);
});

test("large changes without changed tests become change-test evidence findings", () => {
  const findings = buildChangeTestEvidenceFindings({
    config: {
      thresholds: {
        changedFiles: { warn: 8, high: 16, critical: 30 },
        changedLines: { warn: 250, high: 700, critical: 1500 },
        changedSymbols: { warn: 6, high: 14, critical: 30 },
      },
    },
    blastReport: {
      metrics: {
        changedFiles: 9,
        changedLines: 260,
        changedSymbols: 7,
      },
      changedFiles: [{ filePath: "src/app.ts" }],
    },
    mappingReport: {
      shouldNotify: false,
      shouldBlock: false,
      mappings: [],
    },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, "change-test-evidence.large-change-without-tests");
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].evidence, /no changed test files/);
  assert.equal(findings[0].recommendationId, "review-trigger.change-test-evidence.large-change-without-tests");
  assert.deepEqual(findings[0].title, {
    "zh-CN": "大变更验证证据不足会阻断复核",
    en: "Large change has no test evidence",
  });
  assert.match(findings[0].why["zh-CN"], /可复核的验证线索/);
  assert.deepEqual(findings[0].suggestion, {
    en: findings[0].recommendation.en,
    zh: findings[0].recommendation["zh-CN"],
    "zh-CN": findings[0].recommendation["zh-CN"],
  });
});

test("missing mapped tests are included when mapping gate notifies", () => {
  const findings = buildChangeTestEvidenceFindings({
    config: {
      thresholds: {
        changedFiles: { warn: 8, high: 16, critical: 30 },
        changedLines: { warn: 250, high: 700, critical: 1500 },
        changedSymbols: { warn: 6, high: 14, critical: 30 },
      },
    },
    blastReport: {
      metrics: {
        changedFiles: 1,
        changedLines: 8,
        changedSymbols: 1,
      },
      changedFiles: [{ filePath: "internal/auth/token.go" }],
    },
    mappingReport: {
      shouldNotify: true,
      shouldBlock: true,
      mappings: [{
        sourceFile: "internal/auth/token.go",
        gate: "block",
        status: "missing",
        confidence: "high",
        candidateTestFiles: ["internal/auth/token_test.go"],
      }],
    },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, "change-test-evidence.missing-mapped-tests");
  assert.equal(findings[0].severity, "error");
  assert.equal(findings[0].recommendationId, "review-trigger.change-test-evidence.missing-mapped-tests");
  assert.deepEqual(findings[0].aiFixLabel, {
    "zh-CN": "检查候选测试",
    en: "Check candidate tests",
  });
  assert.equal(findings[0].mappings[0].candidateTestFiles[0], "internal/auth/token_test.go");
});

test("Stop hook stays quiet when a stop hook is already active", async () => {
  const result = await runReviewTrigger({
    cwd: process.cwd(),
    input: { stop_hook_active: true },
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.exitCode, 0);
  assert.equal(result.findings.length, 0);
  assert.equal(Object.hasOwn(result, "deeplink"), false);
});

test("runtime emits AGENTS.md length findings from a real workspace", async () => {
  const repo = await makeRepo({
    "AGENTS.md": `${Array.from({ length: 205 }, (_, index) => `line ${index + 1}`).join("\n")}\n`,
  });

  try {
    const result = await runReviewTrigger({ cwd: repo });
    assert.equal(result.status, "findings");
    assert.ok(result.findings.some((finding) => finding.id === "agent-instructions.root-length-hard-cap"));
    assert.equal(Object.hasOwn(result, "deeplink"), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("CLI JSON output does not expose host-open fields", async () => {
  const repo = await makeRepo({
    "AGENTS.md": `${Array.from({ length: 205 }, (_, index) => `line ${index + 1}`).join("\n")}\n`,
  });

  try {
    const result = spawnSync(process.execPath, [
      path.join(process.cwd(), "scripts/review-trigger/cli.mjs"),
      "--cwd",
      repo,
      "--json",
      "--dry-run",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "findings");
    assert.equal(payload.dryRun, true);
    assert.equal(Object.hasOwn(payload, "deeplink"), false);
    assert.equal(Object.hasOwn(payload, "opened"), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("CLI argument failures exit non-zero without exposing input", () => {
  for (const args of [["--cwd", "--json"], ["--mode", "--json"], ["--cwd=", "--json"], ["--mode=", "--json"]]) {
    const result = runCli(args, {
      input: JSON.stringify({ prompt: "private user prompt" }),
    });
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.kind, "better-harness.review-trigger");
    assert.equal(payload.status, "error");
    assert.equal(payload.error.code, "invalid-arguments");
    assert.doesNotMatch(result.stdout, /private user prompt/u);
    assert.doesNotMatch(result.stderr, /private user prompt/u);
  }
});

test("CLI runtime failures exit non-zero without exposing cwd input", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-review-trigger-missing-"));
  const missingCwd = path.join(root, "does-not-exist");

  try {
    const result = runCli(["--cwd", missingCwd, "--json"]);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.kind, "better-harness.review-trigger");
    assert.equal(payload.status, "error");
    assert.equal(payload.error.code, "runtime-failure");
    assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.doesNotMatch(result.stderr, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI fails closed when the blast-radius base ref is unavailable", async () => {
  const repo = await makeRepo({
    "src/app.ts": "export const value = 1;\n",
  });
  const unavailableRef = "refs/heads/private-missing-review-base";

  try {
    await writeFile(path.join(repo, "src/app.ts"), "export const value = 2;\n");
    const result = runCli(["--cwd", repo, "--json"], {
      env: {
        BETTER_HARNESS_BLAST_RADIUS_BASE: unavailableRef,
      },
    });

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.status, "error");
    assert.equal(payload.error.code, "runtime-failure");
    assert.doesNotMatch(result.stdout, new RegExp(repo.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.doesNotMatch(result.stdout, new RegExp(unavailableRef.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.equal(result.stderr, "");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("runtime ignores harness-owned artifacts before change-test evidence", async () => {
  const repo = await makeRepo({
    "AGENTS.md": "# Project Rules\n\nRun tests before finishing.\nNever commit secrets.\nNode workspace.\n",
    "src/app.ts": "export function app() {\n  return 1;\n}\n",
  });

  try {
    await writeFixture(repo, "AI_READINESS_FINDINGS.json", "{\"findings\":[]}\n");
    await writeFixture(repo, "REPORT_SUMMARY.txt", "generated report\n");
    await writeFixture(repo, "test-report.canvas.tsx", "export const generated = true;\n");
    for (let index = 0; index < 20; index += 1) {
      await writeFixture(
        repo,
        `.qoder/better-harness/2026-07-01/000000-demo/artifact-${index}.json`,
        `${JSON.stringify({ index, content: "x".repeat(200) })}\n`,
      );
    }

    const result = await runReviewTrigger({ cwd: repo });

    assert.equal(result.status, "ok");
    assert.equal(result.findings.some((finding) => finding.id === "change-test-evidence.large-change-without-tests"), false);
    assert.equal(Object.hasOwn(result, "deeplink"), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("runtime emits large-change test evidence findings from a real workspace", async () => {
  const repo = await makeRepo({
    "AGENTS.md": "# Project Rules\n\nRun tests before finishing.\nNever commit secrets.\nNode workspace.\n",
    "src/app.ts": "export function app() {\n  return 1;\n}\n",
  });

  try {
    const lines = [
      "export function app() {",
      ...Array.from({ length: 260 }, (_, index) => `  const value${index} = ${index};`),
      "  return value259;",
      "}",
      "",
    ];
    await writeFile(path.join(repo, "src/app.ts"), lines.join("\n"));

    const result = await runReviewTrigger({ cwd: repo });
    assert.equal(result.status, "findings");
    const finding = result.findings.find((item) => item.id === "change-test-evidence.large-change-without-tests");
    assert.ok(finding);
    assert.equal(finding.source, "git-diff");
    assert.equal(Object.hasOwn(result, "deeplink"), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
