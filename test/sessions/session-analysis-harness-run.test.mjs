import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { collectMultiPlatformSessionSummaries } from "../../scripts/commit-session-link/session-source.mjs";
import { HarnessRunSessionAnalyzer } from "../../scripts/session-analysis/platforms/harness-run.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function harnessEvidenceFixture() {
  const workspace = await mkdtemp(path.join(tmpdir(), "harness-run-session-"));
  temporaryDirectories.push(workspace);
  const variant = path.join(workspace, ".better-harness", "harness-runs", "compare-1", "H1");
  const trial = path.join(variant, "trial-001");
  await mkdir(trial, { recursive: true });
  await writeFile(path.join(variant, "revision.json"), JSON.stringify({ revisionId: "hr_0123456789abcdef0123456789abcdef" }));
  await writeFile(path.join(trial, "trace.jsonl"), [
    { type: "run-started", revisionId: "hr_0123456789abcdef0123456789abcdef", host: "qoder" },
    { type: "tool-call-started", toolCallId: "call_1", toolName: "Read", input: { file_path: path.join(workspace, "README.md") } },
    { type: "tool-call-finished", toolCallId: "call_1" },
    { type: "tool-call-result", toolCallId: "call_1", content: "ok" },
    { type: "run-finished", exitCode: 0 },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n");
  return workspace;
}

describe("harness-run session adapter", () => {
  it("normalizes persisted run traces and preserves the revision link", async () => {
    const workspace = await harnessEvidenceFixture();
    const analyzer = new HarnessRunSessionAnalyzer();
    const scope = await analyzer.resolveScope({ workspace });
    const roots = await analyzer.discoverSourceRoots(scope);
    const sessions = await analyzer.discoverSessions(scope, roots);
    const events = await analyzer.readSession(sessions[0], scope);

    expect(sessions[0]).toMatchObject({
      platform: "harness-run",
      revisionId: "hr_0123456789abcdef0123456789abcdef",
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool.requested", toolName: "Read", lifecyclePhase: "request" }),
      expect.objectContaining({ type: "tool.execution.finished", success: true, lifecyclePhase: "result" }),
    ]));

    const collected = await collectMultiPlatformSessionSummaries({
      workspace,
      repoRoot: workspace,
      platforms: ["harness-run"],
      includeToolTrace: true,
    });
    expect(collected.providers).toEqual([
      expect.objectContaining({ platform: "harness-run", status: "ok", included: 1 }),
    ]);
    expect(collected.sessions[0]).toMatchObject({
      platform: "harness-run",
      revisionId: "hr_0123456789abcdef0123456789abcdef",
      toolCallCount: 1,
      toolActivity: expect.objectContaining({ totalCalls: 1 }),
    });
  });
});
