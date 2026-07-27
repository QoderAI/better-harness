import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  discoverHistoryRoots,
  loadHistory,
  omitZeroOutliers,
  parseArgs,
  renderFrame,
  resolveHistoryRoots,
  selectHistory,
} from "../dev/terminal-demo/play-better-harness-history.mjs";

async function writeRun(root, date, name, contract, scores, ready = false) {
  const runDirectory = path.join(root, date, name);
  await mkdir(runDirectory, { recursive: true });
  const ids = [
    "task-understanding",
    "controlled-execution",
    "change-validation",
    "reliable-delivery",
    "learning-capture",
  ];
  await writeFile(path.join(runDirectory, "findings.json"), `${JSON.stringify({
    summary: {
      projectName: "fixture",
      modelId: "agent-work-loop-v4",
      reportContractVersion: contract,
      dimensions: ids.map((id, index) => ({ id, score: scores[index] })),
    },
    findings: [{ severity: "Medium", title: "English finding" }],
  })}\n`);
  if (ready) {
    await writeFile(path.join(runDirectory, "report.canvas.status.json"), "{\"status\":\"ready\"}\n");
  }
}

test("history is ordered and report-contract boundaries remain visible", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "terminal-history-"));
  await writeRun(root, "2026-07-20", "130000-fixture", 24, [72, 58, 70, 50, 40], true);
  await writeRun(root, "2026-07-19", "190000-fixture", 23, [70, 60, 74, 50, 38]);

  const runs = loadHistory(root);
  assert.deepEqual(runs.map((run) => run.contract), [23, 24]);
  assert.equal(runs[1].ready, true);
  const output = renderFrame(runs, 1, { color: false, columns: 100 });
  assert.match(output, /fixture · scan 02\/02/u);
  assert.match(output, /contract break/u);
  assert.match(output, /report contract changed/u);
  assert.doesNotMatch(output, /average|averaged headline score/iu);
});

test("CLI accepts a project root and recent-scan limit", () => {
  const options = parseArgs([
    "--history-root",
    "./fixture",
    "--limit",
    "12",
    "--since",
    "2026-07-17",
    "--omit-zero",
    "learning-capture",
    "--speed",
    "2",
  ]);
  assert.deepEqual(options.historyRoots, [path.resolve("./fixture")]);
  assert.equal(options.limit, 12);
  assert.equal(options.since, "2026-07-17");
  assert.deepEqual(options.omitZero, ["learning-capture"]);
  assert.equal(options.speed, 2);
  assert.throws(() => parseArgs(["--limit", "0"]), /positive integer/u);
  assert.throws(() => parseArgs(["--since", "2026-02-31"]), /valid YYYY-MM-DD/u);
});

test("date selection is inclusive and composes with the recent-scan limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "terminal-since-"));
  await writeRun(root, "2026-07-17", "090000-fixture", 23, [70, 60, 65, 50, 35]);
  await writeRun(root, "2026-07-18", "090000-fixture", 23, [71, 61, 66, 51, 38]);
  await writeRun(root, "2026-07-20", "090000-fixture", 24, [72, 62, 67, 52, 40]);

  const history = loadHistory(root);
  assert.deepEqual(selectHistory(history, { since: "2026-07-17" }).map((run) => run.date), [
    "2026-07-17",
    "2026-07-18",
    "2026-07-20",
  ]);
  assert.deepEqual(selectHistory(history, { since: "2026-07-17", limit: 2 }).map((run) => run.date), [
    "2026-07-18",
    "2026-07-20",
  ]);
  assert.throws(() => selectHistory(history, { since: "2026-07-21" }), /on or after 2026-07-21/u);
});

test("workspace discovery merges current host roots", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "terminal-workspace-"));
  const qoderRoot = path.join(workspace, ".qoder", "better-harness");
  const codexRoot = path.join(workspace, ".codex", "better-harness");
  await writeRun(qoderRoot, "2026-07-20", "130000-fixture", 24, [72, 58, 70, 50, 40]);
  await writeRun(codexRoot, "2026-07-19", "190000-fixture", 23, [70, 60, 74, 50, 38]);

  const roots = discoverHistoryRoots(workspace);
  assert.deepEqual(roots, [qoderRoot, codexRoot]);
  assert.deepEqual(loadHistory(roots).map((run) => run.contract), [23, 24]);
});

test("explicit roots expand home and bypass workspace discovery", () => {
  const options = parseArgs([
    "--workspace",
    "/missing-workspace-is-not-read",
    "--history-root",
    "~/.qoder/better-harness",
    "--root",
    "~/.xx/better-harness",
  ]);
  assert.deepEqual(resolveHistoryRoots(options), [
    path.join(os.homedir(), ".qoder", "better-harness"),
    path.join(os.homedir(), ".xx", "better-harness"),
  ]);
});

test("zero-score outliers become gaps without removing their scans", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "terminal-outlier-"));
  await writeRun(root, "2026-07-18", "090000-fixture", 23, [70, 60, 65, 50, 40]);
  await writeRun(root, "2026-07-19", "090000-fixture", 23, [71, 61, 66, 51, 0]);
  await writeRun(root, "2026-07-20", "090000-fixture", 23, [72, 62, 67, 52, 42]);

  const runs = omitZeroOutliers(loadHistory(root), ["learning-capture"]);
  assert.equal(runs.length, 3);
  assert.equal(runs[1].dimensions[4].score, null);
  const output = renderFrame(runs, 2, { color: false, columns: 100 });
  assert.match(output, /Learning Capture.*▄▄/u);
  assert.doesNotMatch(output, /Learning Capture.*·/u);
  assert.match(output, /1 zero outlier omitted/u);
});
