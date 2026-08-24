import { link, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { DebuggerSession } from "../src/app/session-debugger-model.js";
import { indexArtifactDirectory } from "../src/server/artifact-catalog.js";
import { collectWorkspaceArtifactObservations } from "../src/server/workspace-artifacts.js";

function session(id: string, savedAt: string, resources: string[]): { summary: { id: string; savedAt: string; prompt: string; provider: string }; debugger: DebuggerSession } {
  return {
    summary: { id, savedAt, prompt: `Session ${id}`, provider: "fixture" },
    debugger: {
      id,
      name: id,
      agent: "fixture",
      protocol: "fixture",
      connection: "observed",
      mode: "Retained run",
      startedAt: "10:00:00",
      finishedAt: "10:01:00",
      events: [{
        id: `${id}-change`,
        kind: "change",
        phase: "Change",
        title: "Write files",
        summary: "fixture",
        timestamp: "10:00:30",
        relativeTime: "retained",
        stopConditions: [],
        toolCalls: resources.map((resource, index) => ({
          id: `${id}-${index}`,
          name: "Write",
          summary: "Write file",
          input: "retained",
          output: "retained",
          duration: "1 ms",
          resource,
        })),
        evidence: [],
        rawAcp: { direction: "Agent → Client", method: "session/tool-call", rpcId: id, sessionId: id, traceContext: "fixture", payload: {} },
      }],
    },
  };
}

describe("workspace Artifact observations", () => {
  it("keeps current changed files confined, portable, deduplicated, and newest first", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "studio-workspace-artifacts-"));
    await mkdir(join(workspace, "outputs"));
    await writeFile(join(workspace, "outputs", "report.md"), "# Report", "utf8");
    await writeFile(join(workspace, "outputs", "diagram.svg"), "<svg />", "utf8");
    await mkdir(join(workspace, "not-a-file"));
    const outside = join(workspace, "..", "outside-artifact.txt");
    await writeFile(outside, "outside", "utf8");

    const older = session("older", "2026-08-23T10:00:00.000Z", [
      join("outputs", "report.md"),
      join("outputs", "report.md"),
      "not-a-file",
      "missing.txt",
      outside,
    ]);
    const newer = session("newer", "2026-08-24T10:00:00.000Z", [join("outputs", "diagram.svg")]);
    const observations = await collectWorkspaceArtifactObservations(workspace, [older, newer]);

    expect(observations.map((observation) => [observation.sessionId, observation.relativePath])).toEqual([
      ["newer", "outputs/diagram.svg"],
      ["older", "outputs/report.md"],
    ]);
  });

  it("does not promote multiply-linked files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "studio-workspace-links-"));
    await writeFile(join(workspace, "report.md"), "report", "utf8");
    await link(join(workspace, "report.md"), join(workspace, "report-copy.md"));

    expect(await collectWorkspaceArtifactObservations(workspace, [session("linked", "2026-08-24T10:00:00.000Z", ["report.md", "report-copy.md"])])).toEqual([]);
  });
});

describe("nested Artifact catalog paths", () => {
  it("indexes only the explicit portable paths and preserves hierarchy in labels", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "studio-artifact-index-"));
    await mkdir(join(workspace, "outputs"));
    await writeFile(join(workspace, "outputs", "report.md"), "# Report", "utf8");
    await writeFile(join(workspace, "unobserved.txt"), "not listed", "utf8");

    const index = await indexArtifactDirectory(workspace, { includeDigests: true, includePaths: ["outputs/report.md"] });

    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]).toMatchObject({ label: "outputs/report.md", kind: "markdown" });
    expect(index.entries[0]?.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("rejects traversal and non-portable include paths before indexing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "studio-artifact-invalid-index-"));

    await expect(indexArtifactDirectory(workspace, { includePaths: ["../outside.txt"] })).rejects.toThrow(/portable relative paths/u);
    await expect(indexArtifactDirectory(workspace, { includePaths: ["outputs\\report.md"] })).rejects.toThrow(/portable relative paths/u);
    await expect(indexArtifactDirectory(workspace, { includePaths: ["C:/outputs/report.md"] })).rejects.toThrow(/portable relative paths/u);
  });
});
