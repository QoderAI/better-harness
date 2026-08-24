import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { createSessionExecutionPlan } from "@qoder-ai/harness/session-executor";
import { startHarnessStudioServer } from "../../dist/server/server.js";

const packageRoot = resolve(import.meta.dirname, "../..");
const workspace = resolve(packageRoot, "../..");
const historySource = process.env.HARNESS_STUDIO_HISTORY;
if (historySource === undefined) {
  throw new Error("HARNESS_STUDIO_HISTORY must point to an observed trajectory JSONL file.");
}
const resolvedHistorySource = resolve(historySource);
const fixture = await mkdtemp(join(tmpdir(), "better-harness-real-project-"));
const baseCommit = git(workspace, ["rev-parse", "HEAD"]);
const timestamp = new Date().toISOString();
const sessionPath = join(fixture, "session.jsonl");
await writeFile(sessionPath, [
  { type: "session", version: CURRENT_SESSION_VERSION, id: "studio-real-project", timestamp, cwd: workspace },
  { type: "custom", id: "root0001", parentId: null, timestamp, customType: "studio-demo" },
  { type: "custom", id: "checkpoint", parentId: "root0001", timestamp, customType: "studio-demo" },
].map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");

const plan = await createSessionExecutionPlan({
  workspace,
  base: baseCommit,
  sessionFile: sessionPath,
  entryId: "checkpoint",
  prompt: "Inspect the real Better Harness checkpoint without editing it.",
  commitMessage: "test: retain read-only experiment result",
});
const planSource = `${JSON.stringify(plan, null, 2)}\n`;
await writeFile(join(fixture, "checkpoint.json"), planSource, "utf8");
await writeFile(join(fixture, "checkpoint-compare.harness"), `
language 0.3
skill evidence-first { description "Inspect implementation files before drawing conclusions. Do not edit for a read-only task." }
workflow single-pass { session coder }
harness checkpoint-agent {
  workflow single-pass
  agent coder { use skill evidence-first }
}
runtime qoder {
  adapter "@harness/adapter-qoder"
}
deployment checkpoint-agent-qoder {
  harness checkpoint-agent
  runtime qoder
}
`, "utf8");
await writeFile(join(fixture, "prompt.md"), `Inspect packages/harness/src/experiment/runner.ts and packages/harness-studio/src/app/ExperimentView.tsx in this real Better Harness checkout. Do not edit files. Explain how ACP tool calls are streamed and correlated across the historical lane and two fresh lanes. Keep the answer concise.\n`, "utf8");
await writeFile(join(fixture, "grader.json"), `${JSON.stringify({
  requiredHeadings: ["Better Harness"],
  publicApi: ["compileHarness"],
  requiredCodeTokens: ["compileHarness"],
  requiredAnyCodeTokens: [],
  forbiddenClaims: [],
  exampleLanguages: ["js"],
  forbidRemoteLinks: false,
}, null, 2)}\n`, "utf8");
await copyFile(resolvedHistorySource, join(fixture, "history.jsonl"));

const digest = `sha256:${createHash("sha256").update(planSource).digest("hex")}`;
await writeFile(join(fixture, "history-catalog.json"), `${JSON.stringify({
  schemaVersion: "checkpoint-history.v1",
  adapter: { id: "imported-qoder-history-v1", label: "Imported Qoder project history" },
  items: [{
    id: "better_harness_imported_episode",
    title: "Better Harness ACP inspection",
    occurredAt: timestamp,
    checkpointRef: { plan: "./checkpoint.json", digest },
    request: { prompt: "./prompt.md", verified: false },
    observed: {
      trajectory: "./history.jsonl",
      startCheckpointVerified: false,
      identity: { harnessId: "checkpoint-agent", model: "performance" },
    },
  }],
}, null, 2)}\n`, "utf8");
await writeFile(join(fixture, "experiment.json"), `${JSON.stringify({
  schemaVersion: "harness-experiment.v1",
  harness: "./checkpoint-compare.harness",
  checkpointRef: { plan: "./checkpoint.json", digest },
  task: {
    prompt: "./prompt.md",
    expectedFiles: ["README.md"],
    grader: { kind: "readme-package-v1", contract: "./grader.json" },
  },
  runtime: {
    host: "qoder",
    tools: ["Read", "Write", "Edit", "Bash"],
    allowedTools: [],
    disallowedTools: ["WebFetch", "WebSearch", "Agent", "Task"],
    permissionMode: "default",
    maxTurns: 8,
    timeoutMs: 180_000,
    network: "deny",
    enableFileCheckpointing: false,
  },
  lanes: [
    {
      id: "history",
      origin: "observed",
      trajectory: "./history.jsonl",
      identity: { harnessId: "checkpoint-agent", model: "performance" },
    },
    {
      id: "fresh-default",
      origin: "execute",
      harnessId: "checkpoint-agent",
      trials: 1,
      runtime: { profile: "qoder-default-v1", model: "performance" },
    },
    {
      id: "fresh-minimal",
      origin: "execute",
      harnessId: "checkpoint-agent",
      trials: 1,
      runtime: { profile: "qoder-minimal-v1", model: "performance" },
    },
  ],
  contrasts: [
    { id: "profile-effect", lanes: ["fresh-default", "fresh-minimal"] },
    { id: "history-context", lanes: ["history", "fresh-default", "fresh-minimal"] },
  ],
  trials: { seed: 17, order: "randomized" },
}, null, 2)}\n`, "utf8");

await mkdir(join(fixture, "evidence"));
const started = await startHarnessStudioServer({
  appDir: resolve(packageRoot, "dist/app"),
  experimentManifestPath: join(fixture, "experiment.json"),
  checkpointHistoryCatalogPath: join(fixture, "history-catalog.json"),
  experimentLockDirectory: join(fixture, "locks"),
  experimentOutputDirectory: join(fixture, "evidence"),
  port: Number(process.env.HARNESS_STUDIO_DEMO_PORT ?? 3312),
});
process.stdout.write(`${started.url}\nfixture=${fixture}\ncheckpoint=${baseCommit}\nhistory=${resolvedHistorySource}\n`);

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
