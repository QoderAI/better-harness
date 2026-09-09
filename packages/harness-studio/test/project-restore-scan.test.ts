import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { createAgentCustomizationCollector } from "../src/server/customization-collector.js";
import { startHarnessStudioServer, type StartedHarnessStudioServer } from "../src/server/server.js";

let started: StartedHarnessStudioServer | undefined;
let root: string | undefined;
const projectId = `project_${"a".repeat(32)}`;
afterEach(async () => {
  await started?.close();
  started = undefined;
  if (root) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  root = await realpath(await mkdtemp(join(tmpdir(), "studio-restore-scan-")));
  const workspace = join(root, "project");
  const appDir = join(root, "app");
  const projectStateRoot = join(root, "state");
  for (const directory of [workspace, appDir, projectStateRoot]) await mkdir(directory);
  await writeFile(join(appDir, "index.html"), "<!doctype html><title>Studio fixture</title>");
  await writeFile(join(projectStateRoot, "projects.json"), JSON.stringify({
    version: 1, activeProjectId: projectId,
    projects: [{ id: projectId, kind: "local", label: "Remembered Project", localDirectory: workspace,
      lastOpenedAt: "2026-09-09T00:00:00.000Z", sessionCount: 99, inputCount: 10,
      artifactCount: 20, gitEnabled: true, workspaceWorkbenchEnabled: true }],
  }));
  return { workspace, appDir, projectStateRoot };
}

async function get(path: string) {
  const response = await fetch(`${started!.url}${path}`);
  expect(response.status).toBe(200);
  return response.json();
}

it("restores only the directory binding and scans all Project evidence on explicit request", async () => {
  const files = await fixture();
  await promisify(execFile)("git", ["init", files.workspace]);
  const skill = join(files.workspace, "SKILL.md");
  await writeFile(skill, "# Review\n");
  await writeFile(join(files.workspace, "report.md"), "# Report\n");
  let discoveryCalls = 0;
  let inventoryCalls = 0;
  let fail = false;
  let release: (() => void) | undefined;
  let gate = Promise.resolve();
  const collector = createAgentCustomizationCollector({ hosts: ["codex"], collectInventory: async () => {
    inventoryCalls += 1;
    return { provider: "codex", plugins: [], manage: { skills: [{
      id: "review", kind: "skill", scope: "project", name: "review", filePath: skill,
      evidence: { path: skill },
    }], rules: [], commands: [], subagents: [], hooks: [], mcps: [] } };
  } });
  started = await startHarnessStudioServer({ ...files,
    customizationCollector: { analyze: async (workspace) => {
      if (fail) throw new Error("collector unavailable");
      return collector.analyze(workspace);
    } },
    workspaceSessionProvider: { discover: async (workspace) => {
      discoveryCalls += 1;
      expect(await realpath(workspace)).toBe(files.workspace);
      await gate;
      return { label: "Remembered Project", sessions: [{
        summary: { id: "observed", savedAt: "2026-09-09T00:00:00.000Z", prompt: "Write report", status: "observed", toolCallCount: 1 },
        debugger: { id: "observed", name: "Write report", agent: "codex", protocol: "fixture", connection: "observed", mode: "Retained run", startedAt: "00:00:00", finishedAt: "00:00:01", events: [{
          id: "write", kind: "change", phase: "Change", title: "Write report", summary: "Write report", timestamp: "00:00:00", relativeTime: "retained", stopConditions: [], evidence: [],
          toolCalls: [{ id: "write-report", name: "Write", summary: "Write report", input: "retained", output: "retained", duration: "1 ms", resource: "report.md" }],
          rawAcp: { direction: "Agent → Client", method: "session/tool-call", rpcId: "write", sessionId: "observed", traceContext: "fixture", payload: {} },
        }] },
      }] };
    } },
  });
  expect(await get("/api/config")).toMatchObject({ activeProjectId: projectId, workspaceConnected: true,
    workspaceScanRequired: true, sessionCount: 0, artifactCount: 0, gitEnabled: false, customizationAnalyzed: false });
  expect(discoveryCalls).toBe(0);
  expect(inventoryCalls).toBe(0);
  expect((await get("/api/projects")).projects[0]).toMatchObject({ sessionCount: 0, artifactCount: 0 });

  const scanUrl = `${started.url}/api/projects/${projectId}/scan`;
  expect((await fetch(scanUrl, { method: "POST", headers: { Origin: "https://invalid.example" } })).status).toBe(403);
  gate = new Promise<void>(resolve => { release = resolve; });
  const pending = fetch(scanUrl, { method: "POST" });
  try {
    await expect.poll(() => discoveryCalls).toBe(1);
    expect((await get("/api/projects")).stage).toBe("discovering");
    expect((await fetch(scanUrl, { method: "POST" })).status).toBe(409);
    expect((await fetch(`${started.url}/api/projects/${projectId}`, { method: "DELETE" })).status).toBe(409);
    expect((await fetch(`${started.url}/api/customizations/analyze`, { method: "POST" })).status).toBe(409);
    expect(await get("/api/config")).toMatchObject({ workspaceScanRequired: true, sessionCount: 0 });
  } finally { release?.(); }
  expect((await pending).status).toBe(200);
  expect(discoveryCalls).toBe(1);
  expect(inventoryCalls).toBe(1);
  const scanned = await get("/api/config");
  expect(scanned).toMatchObject({ workspaceScanRequired: false, sessionCount: 1, artifactCount: 1,
    gitEnabled: true, customizationAnalyzed: true, customizationDefinitionCount: 1 });
  expect((await get("/api/customizations")).catalog.definitions[0].name).toBe("review");

  fail = true;
  expect((await fetch(scanUrl, { method: "POST" })).status).toBe(422);
  expect(await get("/api/config")).toEqual(scanned);
  expect((await get("/api/projects")).stage).toBe("idle");
  fail = false;
  expect((await fetch(scanUrl, { method: "POST" })).status).toBe(200);
  expect((await get("/api/config")).projectRevision).toBeGreaterThan(scanned.projectRevision);
});

it("starts with an unavailable remembered directory without invoking collectors", async () => {
  const files = await fixture();
  await rm(files.workspace, { recursive: true });
  let discoveryCalls = 0;
  started = await startHarnessStudioServer({ ...files, workspaceSessionProvider: {
    discover: async () => { discoveryCalls += 1; throw new Error("must not run"); },
  } });
  expect(await get("/api/config")).toMatchObject({ workspaceConnected: false });
  expect((await get("/api/projects")).projects[0]).toMatchObject({ id: projectId, availability: "unavailable" });
  expect(discoveryCalls).toBe(0);
});
