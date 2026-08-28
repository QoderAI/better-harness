import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessRunEmitter, loadSkillDeliveries, type HarnessExecutor } from "@qoder-ai/harness/exec";
import { decodeSseStream, type HarnessUiExecutorFactory } from "@qoder-ai/harness-ui";
import { isArtifactCatalogResponse } from "../src/contracts/artifact.js";
import { parseHarnessStudioArgs, resolveHarnessStudioSourceRoot, runHarnessStudioCli, discoverDefaultInspectorReport } from "../src/server/cli.js";
import { parseSourceCatalog } from "../src/server/workspace/source-catalog.js";
import { startHarnessStudioServer, type StartedHarnessStudioServer, type StudioWorkspaceDiscovery } from "../src/server/server.js";
import { sessionFromRetainedRun } from "../src/server/debugger-session-transform.js";
import { extractInspectorReportJson } from "../src/server/query/inspector-query.js";
import { DEFAULT_LOCAL_ACP_RUNTIME_ID, DEFAULT_LOCAL_HARNESS_ID, DEFAULT_LOCAL_RUNTIME_ID } from "../src/server/default-local-harness.js";
import type { IntentCorrelationPacketV1 } from "../src/contracts/intent-correlation.js";
import type { CheckpointHistoryAdapter } from "../src/server/query/checkpoint-history.js";
import { FIXTURE_VERDICT } from "./compare-model.test.js";

const EXPERIMENT_MANIFEST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../harness/examples/checkpoint-experiment/experiment.json",
);
const ACP_AGENT_FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../harness/test/fixtures/acp-agent.mjs",
);

const SOURCE = `
  language 0.3
  skill require-tests {
    description "Do not report the task complete until tests prove it."
  }
  workflow single-pass {
    session coder
  }
  harness my-agent {
    workflow single-pass
    agent coder {
      use skill require-tests
    }
  }
  runtime qoder {
    adapter "@harness/adapter-qoder"
  }
  deployment my-agent-qoder {
    harness my-agent
    runtime qoder
  }
`;

const SOURCE_SKILL_HARNESS = `
  language 0.3
  skill deep-guide {
    source "./skills/deep-guide"
  }
  workflow single-pass {
    session coder
  }
  harness my-agent {
    workflow single-pass
    agent coder {
      use skill deep-guide
    }
  }
  runtime qoder {
    adapter "@harness/adapter-qoder"
  }
  deployment my-agent-qoder {
    harness my-agent
    runtime qoder
  }
`;

const scriptedExecutorFactory: HarnessUiExecutorFactory = (context) => {
  const executor: HarnessExecutor = {
    host: "qoder",
    async execute(revision, _bundle, task) {
      const emitter = new HarnessRunEmitter(context.onRunEvent);
      emitter.start({ revisionId: revision.revisionId, host: "qoder" });
      emitter.text(`echo: ${task.prompt}`);
      emitter.toolCall("Read", { toolUseId: "tu_1", input: { path: "README.md" } });
      emitter.toolResult("tu_1", '{"bytes":42}', { messageId: "result_1" });
      emitter.finish(0);
      return {
        host: "qoder",
        revisionId: revision.revisionId,
        exitCode: 0,
        output: `echo: ${task.prompt}`,
        errorOutput: "",
        warnings: [],
      };
    },
  };
  return executor;
};

let started: StartedHarnessStudioServer | undefined;
const tempDirs: string[] = [];

afterEach(async () => {
  await started?.close();
  started = undefined;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeAppDir(): Promise<string> {
  const dir = await makeTempDir("studio-app-");
  await writeFile(join(dir, "index.html"), "<!doctype html><title>studio fixture</title>\n", "utf8");
  return dir;
}

async function makeAcpExperimentManifest(): Promise<string> {
  const directory = await makeTempDir("studio-acp-experiment-");
  await cp(dirname(EXPERIMENT_MANIFEST), directory, { recursive: true });
  const manifestPath = join(directory, "experiment.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    runtime: { host: string; tools: string[]; allowedTools: string[]; disallowedTools: string[] };
    lanes: Array<{ origin: string; runtime?: { profile: string } }>;
  };
  manifest.runtime.host = "acp";
  manifest.runtime.tools = [];
  manifest.runtime.allowedTools = [];
  manifest.runtime.disallowedTools = [];
  for (const lane of manifest.lanes) {
    if (lane.origin === "execute" && lane.runtime !== undefined) lane.runtime.profile = "acp-v1-stdio";
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

async function waitForWorkspaceOpenStage(
  serverUrl: string,
  expected: "idle" | "choosing" | "discovering",
): Promise<string> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${serverUrl}/api/workspace/open/status`);
    const payload = await response.json() as { stage?: string };
    if (payload.stage === expected) return payload.stage;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`Workspace open stage did not become '${expected}'.`);
}

async function waitForCondition(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  }
}

function retainedRunFixture(id: string, savedAt: string, prompt: string, tools: string[]) {
  return {
    id,
    savedAt,
    prompt,
    status: "finished",
    runId: id.replace(/^run_/u, "session_"),
    toolCallCount: tools.length,
    warnings: [],
    timeline: [
      ...tools.map((name, index) => ({ kind: "tool-call", id: `tool_${index}`, name, argsText: "{}", status: "completed", resultText: "ok" })),
      { kind: "message", id: "message_1", text: `${prompt} complete`, complete: true },
    ],
  };
}

function proposedIntentFixture(packet: IntentCorrelationPacketV1) {
  const input = packet.inputs[0]!;
  const edge = packet.observedEdges.find((candidate) => candidate.predicate === "contains")!;
  return {
    kind: "IntentCorrelationAnalysisV1",
    schemaVersion: 1,
    packetDigest: packet.packetDigest,
    intentProposals: [{
      id: "intent:proposed:trace-user-inputs",
      title: "Trace user inputs",
      summary: "Connect the retained user input to observed repository activity without promoting edit targets.",
      sourceRefs: [input.ref],
      reviewStatus: "proposed",
    }],
    claims: [{
      id: "claim:input-creates-trace-intent",
      subjectRef: input.ref,
      predicate: "creates",
      objectRef: "intent:proposed:trace-user-inputs",
      evidenceRefs: [edge.ref],
      counterEvidenceRefs: [],
      alternatives: [],
      evidenceStrength: "direct",
      confidence: { semanticFit: "high", temporalFit: "high", changeFit: "low", acceptanceFit: "low" },
      reason: "The retained prompt begins the bounded execution slice that contains the observed activity.",
      limitations: ["The packet contains no verified content delta or commit evidence."],
      reviewStatus: "proposed",
    }],
    unassignedRefs: packet.changeUnits.map(({ ref }) => ref),
    unresolved: [],
  };
}

describe("harness-studio server", () => {
  it("serves ESM worker assets with a JavaScript MIME type", async () => {
    const appDir = await makeAppDir();
    await mkdir(join(appDir, "assets"));
    await writeFile(join(appDir, "assets", "worker.mjs"), "export {};\n", "utf8");
    started = await startHarnessStudioServer({ appDir });

    const response = await fetch(`${started.url}/assets/worker.mjs`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  it("reports which surfaces are enabled through /api/config", async () => {
    const appDir = await makeAppDir();
    const evidenceDir = await makeTempDir("studio-evidence-");
    await writeFile(join(evidenceDir, "verdict.json"), JSON.stringify(FIXTURE_VERDICT), "utf8");
    started = await startHarnessStudioServer({ appDir, evidenceDir });

    const config = await (await fetch(`${started.url}/api/config`)).json();

    expect(config).toEqual({
      acpAgentLabel: "ACP Agent",
      acpEnabled: false,
      aguiEnabled: false,
      artifactsEnabled: false,
      evidenceEnabled: true,
      experimentEnabled: false,
      gitEnabled: false,
      harnessMode: "none",
      historyEnabled: false,
      inspectorEnabled: false,
      workspaceWorkbenchEnabled: false,
      workspaceDiscoveryEnabled: false,
      workspaceConnected: false,
      projectRevision: 0,
      projectExecutionEnabled: false,
      sessionCount: 0,
      inputCount: 0,
      intentAnalysisEnabled: false,
      customizationAnalysisEnabled: false,
      customizationAnalyzed: false,
      customizationDefinitionCount: 0,
    });
    expect((await fetch(`${started.url}/api/inputs`)).status).toBe(404);
  });

  it("opens a project workspace and serves provider-discovered Sessions without exposing its path", async () => {
    const appDir = await makeAppDir();
    const workspace = await makeTempDir("studio-project-workspace-");
    let pickerCalls = 0;
    const records = [
      retainedRunFixture("run_qoder", "2026-08-20T11:00:00.000Z", "Inspect Qoder session", ["Read", "Bash"]),
      retainedRunFixture("run_codex", "2026-08-20T10:00:00.000Z", "Inspect Codex session", ["Read"]),
    ];
    started = await startHarnessStudioServer({
      appDir,
      workspaceDirectoryPicker: async () => {
        pickerCalls += 1;
        return pickerCalls === 1 ? undefined : workspace;
      },
      workspaceSessionProvider: {
        discover: async (selected) => ({
          label: "fixture-repository",
          providers: [
            { provider: "qoder", status: "ok", discovered: 1, included: 1 },
            { provider: "codex", status: "ok", discovered: 1, included: 1 },
            { provider: "claude", status: "no-evidence", discovered: 0, included: 0 },
          ],
          inspectorReport: {
            kind: "HarnessInspectorReportV1",
            workspace: { name: "fixture-repository" },
            featureTree: { nodes: [], roots: [] },
            sessions: [{
              sessionId: "session-structured",
              platform: "codex",
              dialogue: {
                turns: [{
                  index: 1,
                  prompt: { text: "Trace this input", timestamp: "2026-08-20T12:00:00.000Z" },
                  steps: [
                    { kind: "tool", callId: "read-1", operation: "read-files", filePaths: ["packages/harness-studio/src/server/server.ts"] },
                    { kind: "tool", callId: "edit-1", operation: "edit-files", filePaths: ["packages/harness-studio/src/server/server.ts"] },
                  ],
                }],
              },
            }],
            days: [{ date: "2026-08-20", sessionIds: ["session-structured"], commitHashes: [] }],
          },
          sessions: records.map((record, index) => ({
            summary: {
              id: `${index === 0 ? "qoder" : "codex"}:${record.id}`,
              savedAt: record.savedAt,
              prompt: record.prompt,
              status: "observed",
              toolCallCount: record.toolCallCount,
              provider: index === 0 ? "qoder" : "codex",
              messageCount: 1,
            },
            debugger: {
              ...sessionFromRetainedRun(record),
              id: `${index === 0 ? "qoder" : "codex"}:${record.id}`,
              agent: index === 0 ? "qoder" : "codex",
              protocol: "Inspector normalized local evidence",
              connection: "observed",
            },
          })),
          selected,
        }),
      },
    });

    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({
      workspaceDiscoveryEnabled: true,
      workspaceConnected: false,
      workspaceWorkbenchEnabled: false,
    });
    expect((await fetch(`${started.url}/api/workspace-inspector-report`)).status).toBe(404);

    const hostile = await fetch(`${started.url}/api/workspace/open`, { method: "POST", headers: { Origin: "https://hostile.example" } });
    expect(hostile.status).toBe(403);
    expect(pickerCalls).toBe(0);

    const cancelled = await fetch(`${started.url}/api/workspace/open`, { method: "POST" });
    expect(await cancelled.json()).toEqual({ opened: false, cancelled: true });
    expect(await (await fetch(`${started.url}/api/workspace`)).json()).toMatchObject({ connected: false });

    const opened = await fetch(`${started.url}/api/workspace/open`, { method: "POST" });
    expect(opened.status).toBe(200);
    expect(await opened.json()).toMatchObject({ opened: true, label: "fixture-repository", sessionCount: 2 });
    const workspaceState = await (await fetch(`${started.url}/api/workspace`)).json();
    expect(workspaceState).toMatchObject({
      connected: true,
      label: "fixture-repository",
      sessionCount: 2,
      providers: [
        { provider: "qoder", status: "ok" },
        { provider: "codex", status: "ok" },
        { provider: "claude", status: "no-evidence" },
      ],
    });
    expect(JSON.stringify(workspaceState)).not.toContain(workspace);

    const connectedConfig = await (await fetch(`${started.url}/api/config`)).json();
    expect(connectedConfig).toMatchObject({ workspaceWorkbenchEnabled: true, inputCount: 1 });
    const inspectorReport = await fetch(`${started.url}/api/workspace-inspector-report`);
    expect(inspectorReport.status).toBe(200);
    expect(inspectorReport.headers.get("cache-control")).toBe("no-store");
    expect(await inspectorReport.json()).toMatchObject({
      kind: "HarnessInspectorReportV1",
      sessions: [{ sessionId: "session-structured" }],
    });
    const inputTrace = await fetch(`${started.url}/api/inputs`);
    expect(inputTrace.status).toBe(200);
    expect(inputTrace.headers.get("cache-control")).toBe("no-store");
    expect(await inputTrace.json()).toMatchObject({
      kind: "UserInputTraceV1",
      workspace: { label: "fixture-repository" },
      summary: { inputCount: 1, readCount: 1, editTargetCount: 1, fileCount: 1 },
      inputs: [{ text: "Trace this input", links: [
        { path: "packages/harness-studio/src/server/server.ts", activity: "edit-targeted" },
        { path: "packages/harness-studio/src/server/server.ts", activity: "read" },
      ] }],
    });

    const catalog = await (await fetch(`${started.url}/api/sessions`)).json() as { sessions: Array<{ id: string; provider: string }> };
    expect(catalog.sessions.map((session) => session.id)).toEqual(["qoder:run_qoder", "codex:run_codex"]);
    expect(catalog.sessions.map((session) => session.provider)).toEqual(["qoder", "codex"]);
    const detail = await (await fetch(`${started.url}/api/sessions/${encodeURIComponent("qoder:run_qoder")}/debugger`)).json();
    expect(detail).toMatchObject({ name: "Inspect Qoder session", agent: "qoder", protocol: "Inspector normalized local evidence" });
    const comparison = await (await fetch(`${started.url}/api/session-compare?left=${encodeURIComponent("qoder:run_qoder")}&right=${encodeURIComponent("codex:run_codex")}`)).json();
    expect(comparison).toMatchObject({
      left: { prompt: "Inspect Qoder session", status: "observed", toolSequence: ["Read", "Bash"] },
      right: { prompt: "Inspect Codex session", status: "observed", toolSequence: ["Read"] },
    });
  });

  it("aggregates current workspace Artifacts without requiring a selected Session", async () => {
    const appDir = await makeAppDir();
    const workspace = await makeTempDir("studio-artifact-workspace-");
    await mkdir(join(workspace, "outputs"));
    await writeFile(join(workspace, "outputs", "report.md"), "# Current report\n", "utf8");
    await writeFile(join(workspace, "outputs", "diagram.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" />\n", "utf8");
    await writeFile(join(workspace, "not-observed.txt"), "private workspace file\n", "utf8");
    const discovery: StudioWorkspaceDiscovery = {
      label: "artifact-fixture",
      sessions: [{
        summary: {
          id: "qoder:artifact-session",
          savedAt: "2026-08-24T04:30:00.000Z",
          prompt: "Create the report and diagram",
          status: "observed",
          toolCallCount: 1,
          provider: "qoder",
        },
        debugger: {
          id: "qoder:artifact-session",
          name: "Create the report and diagram",
          agent: "qoder",
          protocol: "Inspector normalized local evidence",
          connection: "observed",
          mode: "Retained run",
          startedAt: "12:29:00",
          finishedAt: "12:30:00",
          events: [{
            id: "change-1",
            kind: "change",
            phase: "Change",
            title: "Deliver outputs",
            summary: "Two output files were observed.",
            timestamp: "12:30:00",
            relativeTime: "retained",
            stopConditions: [],
            toolCalls: ["outputs/report.md", "outputs/diagram.svg", "not-present.md"].map((resource, index) => ({
              id: `write-${index}`,
              name: "Write",
              summary: "Observed output",
              input: "retained",
              output: "retained",
              duration: "1 ms",
              resource,
            })),
            evidence: [],
            rawAcp: {
              direction: "Agent → Client",
              method: "session/tool-call",
              rpcId: "change-1",
              sessionId: "artifact-session",
              traceContext: "fixture",
              payload: {},
            },
          }],
        },
      }],
    };
    started = await startHarnessStudioServer({
      appDir,
      workspaceDirectoryPicker: async () => workspace,
      workspaceSessionProvider: { discover: async () => discovery },
    });

    expect((await fetch(`${started.url}/api/artifacts`)).status).toBe(404);
    expect(await (await fetch(`${started.url}/api/workspace/open`, { method: "POST" })).json()).toMatchObject({ opened: true });
    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({ artifactsEnabled: true, artifactCount: 2 });

    const catalogResponse = await fetch(`${started.url}/api/artifacts`);
    const catalog = await catalogResponse.json();
    expect(catalogResponse.status).toBe(200);
    expect(isArtifactCatalogResponse(catalog)).toBe(true);
    expect(catalog.artifacts.map((artifact: { label: string }) => artifact.label)).toEqual(["outputs/diagram.svg", "outputs/report.md"]);
    expect(catalog.navigation).toMatchObject({
      kind: "HarnessStudioWorkspaceArtifactNavigationV1",
      workspaceLabel: "artifact-fixture",
      observations: [
        { sessionId: "qoder:artifact-session", prompt: "Create the report and diagram", provider: "qoder" },
        { sessionId: "qoder:artifact-session", prompt: "Create the report and diagram", provider: "qoder" },
      ],
    });
    expect(JSON.stringify(catalog)).not.toContain(workspace);
    expect(JSON.stringify(catalog)).not.toContain("not-observed.txt");

    const report = catalog.artifacts.find((artifact: { label: string }) => artifact.label === "outputs/report.md");
    expect(await (await fetch(`${started.url}${report.revision.content.uri}`)).text()).toBe("# Current report\n");
    await writeFile(join(workspace, "outputs", "report.md"), "# Revised report\n", "utf8");
    expect((await fetch(`${started.url}${report.revision.content.uri}`)).status).toBe(409);

    expect((await fetch(`${started.url}/api/workspace`, { method: "DELETE" })).status).toBe(200);
    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({ artifactsEnabled: false });
    expect((await fetch(`${started.url}/api/artifacts`)).status).toBe(404);
  });

  it("serves online Intent proposals only after local evidence validation", async () => {
    const appDir = await makeAppDir();
    const workspace = await makeTempDir("studio-intent-workspace-");
    let observedPacket: IntentCorrelationPacketV1 | undefined;
    let invalid = false;
    let block = false;
    let analyzerCalls = 0;
    let releaseAnalyzer: (() => void) | undefined;
    const analyzerGate = new Promise<void>((resolveGate) => { releaseAnalyzer = resolveGate; });
    started = await startHarnessStudioServer({
      appDir,
      workspaceDirectoryPicker: async () => workspace,
      workspaceSessionProvider: {
        discover: async () => ({
          label: "intent-fixture",
          sessions: [],
          inspectorReport: {
            kind: "HarnessInspectorReportV1",
            workspace: { name: "intent-fixture" },
            featureTree: { nodes: [], roots: [] },
            days: [],
            sessions: [{
              sessionId: "session-intent",
              platform: "codex",
              dialogue: { turns: [{
                index: 1,
                prompt: { text: "Connect this prompt to repository activity", timestamp: "2026-08-22T12:00:00.000Z" },
                steps: [{ kind: "tool", callId: "edit-1", operation: "edit-files", filePaths: ["src/view.tsx"] }],
              }] },
            }],
          },
        }),
      },
      intentAnalyzer: {
        analyze: async (packet) => {
          analyzerCalls += 1;
          observedPacket = packet;
          if (block) await analyzerGate;
          const proposed = proposedIntentFixture(packet);
          return invalid ? { ...proposed, claims: [{ ...proposed.claims[0], reviewStatus: "confirmed" }] } : proposed;
        },
      },
    });
    expect((await fetch(`${started.url}/api/workspace/open`, { method: "POST" })).status).toBe(200);
    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({ intentAnalysisEnabled: true });

    const analyzed = await fetch(`${started.url}/api/intent-analysis`, { method: "POST" });
    expect(analyzed.status).toBe(200);
    expect(analyzed.headers.get("cache-control")).toBe("no-store");
    expect(await analyzed.json()).toMatchObject({ kind: "IntentCorrelationAnalysisV1", claims: [{ reviewStatus: "proposed" }] });
    expect(observedPacket?.changeUnits).toEqual([expect.objectContaining({ path: "src/view.tsx", changeState: "edit-targeted" })]);
    expect(JSON.stringify(observedPacket)).not.toContain(workspace);

    invalid = true;
    const rejected = await fetch(`${started.url}/api/intent-analysis`, { method: "POST" });
    expect(rejected.status).toBe(502);
    expect(await rejected.json()).toEqual({ error: "The Intent analyzer returned claims that failed local evidence validation." });

    const crossOrigin = await fetch(`${started.url}/api/intent-analysis`, { method: "POST", headers: { Origin: "https://example.test" } });
    expect(crossOrigin.status).toBe(403);

    invalid = false;
    block = true;
    const pending = fetch(`${started.url}/api/intent-analysis`, { method: "POST" });
    await waitForCondition(() => analyzerCalls === 3, "Intent analyzer did not start.");
    expect((await fetch(`${started.url}/api/projects/open`, { method: "POST" })).status).toBe(200);
    releaseAnalyzer?.();
    const stale = await pending;
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: "The active Project changed before Intent analysis completed. Run the analysis again for the current Project.",
    });
  });

  it("provides a default local harness and runs it inside the selected workspace", async () => {
    const appDir = await makeAppDir();
    const workspace = await makeTempDir("studio-default-harness-workspace-");
    let observedTask: { cwd?: string; sourceRoot?: string } | undefined;
    let observedRevision: { harnessId: string; runtimeId: string } | undefined;
    started = await startHarnessStudioServer({
      appDir,
      workspaceDirectoryPicker: async () => workspace,
      workspaceSessionProvider: {
        discover: async () => ({ label: "default-harness-project", sessions: [] }),
      },
      executorFactory: (context) => ({
        host: "qoder",
        async execute(revision, _bundle, task) {
          observedTask = task;
          observedRevision = { harnessId: revision.harness.id, runtimeId: revision.target.runtime };
          const emitter = new HarnessRunEmitter(context.onRunEvent);
          emitter.start({ revisionId: revision.revisionId, host: "qoder" });
          emitter.text(`workspace: ${task.prompt}`);
          emitter.finish(0);
          return {
            host: "qoder",
            revisionId: revision.revisionId,
            exitCode: 0,
            output: `workspace: ${task.prompt}`,
            errorOutput: "",
            warnings: [],
          };
        },
      }),
    });

    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({
      aguiEnabled: true,
      harnessMode: "workspace-default",
      workspaceDiscoveryEnabled: true,
    });
    const beforeProject = await fetch(`${started.url}/agui`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "before-project-thread",
        runId: "before-project-run",
        messages: [{ role: "user", content: "must not start" }],
      }),
    });
    expect(beforeProject.status).toBe(409);
    expect(await beforeProject.json()).toEqual({ error: "Open a Project before starting a Project-scoped run." });
    expect(await (await fetch(`${started.url}/api/workspace/open`, { method: "POST" })).json()).toMatchObject({ opened: true });

    const projectCatalog = await (await fetch(`${started.url}/api/projects`)).json() as { activeProjectId: string; revision: number };
    const missingBinding = await fetch(`${started.url}/agui`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "missing-thread",
        runId: "missing-run",
        messages: [{ role: "user", content: "must not start" }],
      }),
    });
    expect(missingBinding.status).toBe(409);
    expect(await missingBinding.json()).toEqual({ error: "A Project id and revision are required to start a Project-scoped run." });
    const staleBinding = await fetch(`${started.url}/agui`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Harness-Project-Id": projectCatalog.activeProjectId,
        "X-Harness-Project-Revision": String(projectCatalog.revision - 1),
      },
      body: JSON.stringify({
        threadId: "stale-thread",
        runId: "stale-run",
        messages: [{ role: "user", content: "must not start" }],
      }),
    });
    expect(staleBinding.status).toBe(409);
    expect(observedTask).toBeUndefined();

    const response = await fetch(`${started.url}/agui`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Harness-Project-Id": projectCatalog.activeProjectId,
        "X-Harness-Project-Revision": String(projectCatalog.revision),
      },
      body: JSON.stringify({
        threadId: "default-thread",
        runId: "default-run",
        messages: [{ role: "user", content: "inspect this workspace" }],
      }),
    });
    const events = decodeSseStream(await response.text());

    expect(events).toContainEqual(expect.objectContaining({ type: "TEXT_MESSAGE_CONTENT", delta: "workspace: inspect this workspace" }));
    const canonicalWorkspace = await realpath(workspace);
    expect(observedTask).toMatchObject({ cwd: canonicalWorkspace, sourceRoot: canonicalWorkspace });
    expect(observedRevision).toEqual({ harnessId: DEFAULT_LOCAL_HARNESS_ID, runtimeId: DEFAULT_LOCAL_RUNTIME_ID });
  });

  it("runs the configured ACP Agent, forwards permission decisions, and exposes real protocol evidence", async () => {
    const appDir = await makeAppDir();
    const workspace = await makeTempDir("studio-acp-workspace-");
    started = await startHarnessStudioServer({
      appDir,
      workspaceDirectoryPicker: async () => workspace,
      workspaceSessionProvider: { discover: async () => ({ label: "acp-project", sessions: [] }) },
      acpAgent: { command: process.execPath, args: [ACP_AGENT_FIXTURE], label: "Fixture ACP" },
    });
    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({
      acpEnabled: true,
      acpAgentLabel: "Fixture ACP",
    });
    await fetch(`${started.url}/api/workspace/open`, { method: "POST" });
    const projectCatalog = await (await fetch(`${started.url}/api/projects`)).json() as { activeProjectId: string; revision: number };

    const runId = "acp-run";
    const response = await fetch(`${started.url}/agui/acp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Harness-Project-Id": projectCatalog.activeProjectId,
        "X-Harness-Project-Revision": String(projectCatalog.revision),
      },
      body: JSON.stringify({
        threadId: "acp-thread",
        runId,
        messages: [{ role: "user", content: "prove the ACP bridge" }],
      }),
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";
    let permissionRequestId: string | undefined;
    while (permissionRequestId === undefined) {
      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      body += decoder.decode(chunk.value, { stream: true });
      const permission = decodeSseStream(body).find((event) => event.type === "CUSTOM"
        && event.name === "harness.protocol-event"
        && (event.value as { method?: string }).method === "session/request_permission");
      if (permission?.type === "CUSTOM") {
        permissionRequestId = (permission.value as { rpcId?: string }).rpcId;
      }
    }
    const decision = await fetch(`${started.url}/api/acp/runs/${runId}/permissions/${permissionRequestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId: "allow-once" }),
    });
    expect(decision.status).toBe(200);
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    const events = decodeSseStream(body);
    expect(events).toContainEqual(expect.objectContaining({ type: "TEXT_MESSAGE_CONTENT", delta: "fixture:allow-once" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "RUN_FINISHED" }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "CUSTOM",
      name: "harness.protocol-event",
      value: expect.objectContaining({ protocol: "acp", method: "session/prompt" }),
    }));
    expect(events.find((event) => event.type === "RUN_STARTED")).toBeDefined();
    expect(DEFAULT_LOCAL_ACP_RUNTIME_ID).toBe("acp");
  });

  it("keeps an explicitly configured harness and cwd authoritative after workspace selection", async () => {
    const appDir = await makeAppDir();
    const workspace = await makeTempDir("studio-configured-workspace-");
    const configuredCwd = await makeTempDir("studio-configured-cwd-");
    let observed: { cwd?: string; harnessId: string } | undefined;
    started = await startHarnessStudioServer({
      appDir,
      harnessSource: SOURCE,
      cwd: configuredCwd,
      workspaceDirectoryPicker: async () => workspace,
      workspaceSessionProvider: { discover: async () => ({ label: "configured-project", sessions: [] }) },
      executorFactory: (context) => ({
        host: "qoder",
        async execute(revision, _bundle, task) {
          observed = { cwd: task.cwd, harnessId: revision.harness.id };
          const emitter = new HarnessRunEmitter(context.onRunEvent);
          emitter.start({ revisionId: revision.revisionId, host: "qoder" });
          emitter.finish(0);
          return { host: "qoder", revisionId: revision.revisionId, exitCode: 0, output: "", errorOutput: "", warnings: [] };
        },
      }),
    });

    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({ harnessMode: "configured" });
    await fetch(`${started.url}/api/workspace/open`, { method: "POST" });
    await fetch(`${started.url}/agui`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: "configured-thread", runId: "configured-run", messages: [{ role: "user", content: "run configured" }] }),
    });

    expect(observed).toEqual({ cwd: configuredCwd, harnessId: "my-agent" });
  });

  it("reports directory selection and Session discovery as separate open stages", async () => {
    const appDir = await makeAppDir();
    const workspace = await makeTempDir("studio-progress-workspace-");
    let selectWorkspace!: (value: string) => void;
    let finishDiscovery!: (value: StudioWorkspaceDiscovery) => void;
    const selected = new Promise<string>((resolveSelection) => { selectWorkspace = resolveSelection; });
    const discovered = new Promise<StudioWorkspaceDiscovery>((resolveDiscovery) => { finishDiscovery = resolveDiscovery; });
    started = await startHarnessStudioServer({
      appDir,
      workspaceDirectoryPicker: async () => selected,
      workspaceSessionProvider: { discover: async () => discovered },
    });

    const opening = fetch(`${started.url}/api/workspace/open`, { method: "POST" });
    expect(await waitForWorkspaceOpenStage(started.url, "choosing")).toBe("choosing");

    selectWorkspace(workspace);
    expect(await waitForWorkspaceOpenStage(started.url, "discovering")).toBe("discovering");

    finishDiscovery({
      label: "progress-project",
      providers: [{ provider: "qoder", status: "no-evidence", discovered: 0, included: 0 }],
      sessions: [],
    });
    expect(await (await opening).json()).toMatchObject({ opened: true, label: "progress-project", sessionCount: 0 });
    expect(await waitForWorkspaceOpenStage(started.url, "idle")).toBe("idle");
  });

  it("opens a browser-selected workspace, indexes Sessions, and compares two retained runs", async () => {
    const appDir = await makeAppDir();
    started = await startHarnessStudioServer({
      appDir,
      workspaceSessionProvider: { discover: async () => ({ label: "unused-local-project", sessions: [] }) },
    });
    const privateImportLabel = "C:\\Users\\private\\review-sessions";
    const created = await fetch(`${started.url}/api/workspaces?label=${encodeURIComponent(privateImportLabel)}`, { method: "POST" });
    expect(created.status).toBe(201);
    const { sessionId } = await created.json() as { sessionId: string };

    const upload = async (path: string, value: unknown): Promise<Response> => fetch(
      `${started!.url}/api/workspaces/${sessionId}/files?path=${encodeURIComponent(path)}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) },
    );
    expect((await upload("review-sessions/nested/run_left.json", retainedRunFixture("run_left", "2026-08-20T10:00:00.000Z", "Repair parser", ["Read", "Edit", "Bash"]))).status).toBe(201);
    expect((await upload("review-sessions/run_right.json", retainedRunFixture("run_right", "2026-08-20T11:00:00.000Z", "Repair renderer", ["Read", "Bash"]))).status).toBe(201);
    expect((await upload("review-sessions/notes.json", { note: "unsupported" })).status).toBe(201);

    expect(await (await fetch(`${started.url}/api/workspace`)).json()).toMatchObject({ connected: false, sessionCount: 0 });
    expect((await fetch(`${started.url}/api/sessions`)).status).toBe(404);

    const committed = await fetch(`${started.url}/api/workspaces/${sessionId}/commit`, { method: "POST" });
    expect(committed.status).toBe(200);
    expect(await committed.json()).toEqual({ label: "review-sessions", sessionCount: 2, omittedCount: 1 });
    const projects = await (await fetch(`${started.url}/api/projects`)).text();
    expect(projects).not.toContain(privateImportLabel);
    expect(projects).not.toContain("Users");

    const config = await (await fetch(`${started.url}/api/config`)).json() as { workspaceConnected: boolean; projectExecutionEnabled: boolean; sessionCount: number };
    expect(config).toMatchObject({ workspaceConnected: true, projectExecutionEnabled: false, sessionCount: 2 });
    const activeProject = await (await fetch(`${started.url}/api/projects`)).json() as { activeProjectId: string; revision: number };
    const runAttempt = await fetch(`${started.url}/agui`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Harness-Project-Id": activeProject.activeProjectId,
        "X-Harness-Project-Revision": String(activeProject.revision),
      },
      body: JSON.stringify({ threadId: "imported-thread", runId: "imported-run", messages: [{ role: "user", content: "must not execute" }] }),
    });
    expect(runAttempt.status).toBe(422);
    expect(await runAttempt.json()).toEqual({ error: "The selected Project is read-only evidence and cannot host a live run." });
    const catalog = await (await fetch(`${started.url}/api/sessions`)).json() as { sessions: Array<{ id: string; prompt: string }> };
    expect(catalog.sessions.map((session) => session.id)).toEqual(["run_right", "run_left"]);
    const debuggerSession = await (await fetch(`${started.url}/api/sessions/run_left/debugger`)).json();
    expect(debuggerSession).toMatchObject({ name: "Repair parser", mode: "Retained run" });

    const comparison = await (await fetch(`${started.url}/api/session-compare?left=run_left&right=run_right`)).json();
    expect(comparison).toMatchObject({
      kind: "observational-session-compare.v1",
      boundary: expect.stringMatching(/no winner/i),
      left: { prompt: "Repair parser", toolCallCount: 3, toolSequence: ["Read", "Edit", "Bash"] },
      right: { prompt: "Repair renderer", toolCallCount: 2, toolSequence: ["Read", "Bash"] },
    });

    expect((await fetch(`${started.url}/api/workspace`, { method: "DELETE" })).status).toBe(200);
    expect(await (await fetch(`${started.url}/api/workspace`)).json()).toMatchObject({ connected: false, sessionCount: 0 });
  });

  it("rejects cross-origin and traversal-shaped workspace imports", async () => {
    const appDir = await makeAppDir();
    started = await startHarnessStudioServer({ appDir });
    expect((await fetch(`${started.url}/api/workspaces`, { method: "POST", headers: { Origin: "https://hostile.example" } })).status).toBe(403);
    const created = await fetch(`${started.url}/api/workspaces`, { method: "POST" });
    const { sessionId } = await created.json() as { sessionId: string };
    const traversal = await fetch(`${started.url}/api/workspaces/${sessionId}/files?path=${encodeURIComponent("../run_escape.json")}`, { method: "PUT", body: "{}" });
    expect(traversal.status).toBe(400);
    expect((await fetch(`${started.url}/api/workspaces/${sessionId}/commit`, { method: "POST" })).status).toBe(422);
    expect((await fetch(`${started.url}/api/workspaces/${sessionId}`, { method: "DELETE" })).status).toBe(200);
  });

  it("serializes upload, commit, and abort operations for one workspace import", async () => {
    const appDir = await makeAppDir();
    started = await startHarnessStudioServer({ appDir });
    const created = await fetch(`${started.url}/api/workspaces`, { method: "POST" });
    const { sessionId } = await created.json() as { sessionId: string };
    let finishUpload!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{\"partial\":"));
        finishUpload = () => {
          controller.enqueue(new TextEncoder().encode("true}"));
          controller.close();
        };
      },
    });
    const upload = fetch(
      `${started.url}/api/workspaces/${sessionId}/files?path=run_serialized.json`,
      { method: "PUT", body, duplex: "half" } as RequestInit & { duplex: "half" },
    );

    let conflictingStatus = 0;
    const deadline = Date.now() + 2_000;
    while (conflictingStatus !== 409 && Date.now() < deadline) {
      conflictingStatus = (await fetch(`${started.url}/api/workspaces/${sessionId}/commit`, { method: "POST" })).status;
      if (conflictingStatus !== 409) await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
    expect(conflictingStatus).toBe(409);
    expect((await fetch(`${started.url}/api/workspaces/${sessionId}`, { method: "DELETE" })).status).toBe(409);
    finishUpload();
    expect((await upload).status).toBe(201);
    expect((await fetch(`${started.url}/api/workspaces/${sessionId}`, { method: "DELETE" })).status).toBe(200);
  });

  it("serves one explicitly configured Inspector report without exposing a file picker", async () => {
    const appDir = await makeAppDir();
    const reportDir = await makeTempDir("studio-inspector-");
    const reportPath = join(reportDir, "inspector.html");
    await writeFile(reportPath, "<!doctype html><title>Inspector fixture</title><h1>Evidence Workbench</h1>\n", "utf8");
    started = await startHarnessStudioServer({ appDir, inspectorReportPath: reportPath });

    const config = await (await fetch(`${started.url}/api/config`)).json();
    const report = await fetch(`${started.url}/inspector`);
    const structured = await fetch(`${started.url}/api/inspector-report`);

    expect(config.inspectorEnabled).toBe(true);
    expect(report.status).toBe(200);
    expect(report.headers.get("content-type")).toContain("text/html");
    expect(report.headers.get("cache-control")).toBe("no-store");
    expect(await report.text()).toContain("Evidence Workbench");
    expect(structured.status).toBe(204);

    await started.close();
    started = await startHarnessStudioServer({ appDir });
    const missing = await fetch(`${started.url}/inspector`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatch(/--inspector/);
  });

  it("switches bounded Studio sources without exposing browser file paths", async () => {
    const appDir = await makeAppDir();
    const reportDir = await makeTempDir("studio-source-switch-");
    const primaryReport = join(reportDir, "primary.html");
    const alternateReport = join(reportDir, "alternate.html");
    await writeFile(primaryReport, "<!doctype html><h1>Primary Evidence</h1>", "utf8");
    await writeFile(alternateReport, "<!doctype html><h1>Alternate Evidence</h1>", "utf8");
    started = await startHarnessStudioServer({
      appDir,
      inspectorReportPath: primaryReport,
      sourceCatalog: [{ id: "inspector_alt", kind: "inspector", label: "Alternate Inspector", path: alternateReport }],
    });

    const listed = await (await fetch(`${started.url}/api/sources`)).json();
    expect(listed.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "inspector_startup", kind: "inspector", active: true }),
      expect.objectContaining({ id: "inspector_alt", kind: "inspector", label: "Alternate Inspector", active: false }),
    ]));
    expect(JSON.stringify(listed)).not.toContain(reportDir);
    expect(await (await fetch(`${started.url}/inspector`)).text()).toContain("Primary Evidence");

    const hostile = await fetch(`${started.url}/api/sources/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://hostile.example" },
      body: JSON.stringify({ kind: "inspector", sourceId: "inspector_alt" }),
    });
    expect(hostile.status).toBe(403);

    const switched = await fetch(`${started.url}/api/sources/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "inspector", sourceId: "inspector_alt" }),
    });
    expect(switched.status).toBe(200);
    expect((await switched.json()).sources).toContainEqual(expect.objectContaining({ id: "inspector_alt", active: true }));
    expect((await (await fetch(`${started.url}/api/config`)).json()).inspectorEnabled).toBe(true);
    expect(await (await fetch(`${started.url}/inspector`)).text()).toContain("Alternate Evidence");

    const unknown = await fetch(`${started.url}/api/sources/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "inspector", sourceId: "unknown_source" }),
    });
    expect(unknown.status).toBe(404);
  });

  it("serves structured Inspector report JSON for the native Studio workbench", async () => {
    const appDir = await makeAppDir();
    const reportDir = await makeTempDir("studio-inspector-json-");
    const reportPath = join(reportDir, "inspector.html");
    const payload = {
      kind: "HarnessInspectorReportV1",
      workspace: { name: "fixture <repo>" },
      featureTree: { nodes: [], roots: [] },
      stories: [],
      days: [],
      sessions: [],
      commits: [],
      providers: [],
      filters: { platform: "qoder" },
    };
    const html = `<!doctype html><title>Inspector fixture</title><script type="application/json" id="inspector-data">${JSON.stringify(payload).replaceAll("<", "\\u003c")}</script>`;
    await writeFile(reportPath, html, "utf8");
    started = await startHarnessStudioServer({ appDir, inspectorReportPath: reportPath });

    expect(JSON.parse(extractInspectorReportJson(html))).toMatchObject({ kind: "HarnessInspectorReportV1", workspace: { name: "fixture <repo>" } });
    expect(() => extractInspectorReportJson("<!doctype html><title>No data</title>")).toThrow(/embedded workbench data/);
    const response = await fetch(`${started.url}/api/inspector-report`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ kind: "HarnessInspectorReportV1", workspace: { name: "fixture <repo>" } });
  });

  it("resolves source-neutral history and activates only the successfully locked manifest", async () => {
    const appDir = await makeAppDir();
    const alternateDir = await makeTempDir("studio-locked-manifest-");
    await cp(dirname(EXPERIMENT_MANIFEST), alternateDir, { recursive: true });
    await writeFile(join(alternateDir, "prompt.md"), "Locked presentation request.\n", "utf8");
    const alternateManifest = join(alternateDir, "experiment.json");
    const adapter: CheckpointHistoryAdapter = {
      descriptor: { id: "pptx-history-v1", label: "Presentation history" },
      async list() {
        return {
          adapter: this.descriptor,
          items: [{
            id: "deck_revision_42",
            title: "Quarterly review edit",
            requestPreview: "Tighten the executive summary.",
            occurredAt: "2026-08-17T08:00:00.000Z",
            adapter: this.descriptor,
            provenance: "verified-history",
            checkpointVerified: true,
          }],
        };
      },
      async resolve() {
        return {
          item: (await this.list()).items[0]!,
          checkpointRef: { planPath: "/adapter-owned/deck-checkpoint.json", digest: `sha256:${"a".repeat(64)}` },
          checkpointSource: {
            status: "ready",
            adapter: this.descriptor,
            resource: { label: "Presentation", value: "Quarterly review.pptx" },
            revision: { label: "Version", value: "42" },
            history: { label: "Edit history", value: "change-108" },
            materialization: { label: "Isolated document copy", value: "10 copies", timing: "on-run", count: 10 },
            capabilities: { isolatedMaterialization: true, observedHistory: true, preserveResult: true },
          },
          request: {
            promptPath: "/adapter-owned/prompt.md",
            prompt: "Tighten the executive summary.\n",
            promptHash: `sha256:${"b".repeat(64)}`,
            verified: true,
          },
          observed: {
            trajectoryPath: "/adapter-owned/trajectory.jsonl",
            startCheckpointVerified: true,
            identity: { harnessId: "readme-grounded", model: "performance" },
          },
        };
      },
    };
    started = await startHarnessStudioServer({
      appDir,
      experimentManifestPath: EXPERIMENT_MANIFEST,
      checkpointHistoryAdapter: adapter,
      experimentLocker: async () => ({
        manifestPath: alternateManifest,
        receipt: {
          lockId: "lock_presentation",
          historyId: "deck_revision_42",
          manifestDigest: `sha256:${"c".repeat(64)}`,
          checkpointDigest: `sha256:${"a".repeat(64)}`,
          manifestName: "experiment.json",
        },
      }),
    });

    const history = await (await fetch(`${started.url}/api/checkpoint-history`)).json();
    expect(history.items[0]).toMatchObject({ id: "deck_revision_42", adapter: { id: "pptx-history-v1" } });
    expect(JSON.stringify(history)).not.toContain("adapter-owned");

    const resolved = await fetch(`${started.url}/api/checkpoint-history/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ historyId: "deck_revision_42" }),
    });
    expect(await resolved.json()).toMatchObject({
      lockable: true,
      setup: {
        checkpointSource: { resource: { label: "Presentation" } },
        request: { provenance: "verified-history" },
      },
    });

    const hostile = await fetch(`${started.url}/api/experiment/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://hostile.example" },
      body: JSON.stringify({ historyId: "deck_revision_42" }),
    });
    expect(hostile.status).toBe(403);

    const locked = await fetch(`${started.url}/api/experiment/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ historyId: "deck_revision_42" }),
    });
    expect(await locked.json()).toMatchObject({
      lock: { lockId: "lock_presentation" },
      setup: { request: { prompt: "Locked presentation request.\n" } },
    });
    const active = await (await fetch(`${started.url}/api/experiment`)).json();
    expect(active).toMatchObject({
      lock: { lockId: "lock_presentation" },
      setup: { request: { prompt: "Locked presentation request.\n" } },
    });
  });

  it("serves the evidence verdict.json and 404s when it is absent", async () => {
    const appDir = await makeAppDir();
    const evidenceDir = await makeTempDir("studio-evidence-");
    await writeFile(join(evidenceDir, "verdict.json"), JSON.stringify(FIXTURE_VERDICT), "utf8");
    started = await startHarnessStudioServer({ appDir, evidenceDir });

    const response = await fetch(`${started.url}/api/evidence`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(FIXTURE_VERDICT)));

    await started.close();
    started = await startHarnessStudioServer({ appDir });
    const missing = await fetch(`${started.url}/api/evidence`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatch(/--evidence/);
  });

  it("serves an experiment preview and multiplexes lane-scoped events", async () => {
    const appDir = await makeAppDir();
    let submittedPrompt: string | undefined;
    started = await startHarnessStudioServer({
      appDir,
      experimentManifestPath: EXPERIMENT_MANIFEST,
      experimentRunner: async (options) => {
        submittedPrompt = options.promptOverride;
        options.onEvent?.({
          type: "lane-started",
          experimentId: options.experimentId!,
          laneId: "fresh-default",
          runId: `${options.experimentId}:fresh-default:1`,
          at: "2026-08-17T00:00:00.000Z",
        });
        options.onEvent?.({
          type: "lane-event",
          experimentId: options.experimentId!,
          laneId: "fresh-default",
          runId: `${options.experimentId}:fresh-default:1`,
          at: "2026-08-17T00:00:01.000Z",
          event: {
            type: "tool.requested",
            toolInvocationId: "read-1",
            toolName: "Read",
            filePath: "README.md",
          } as never,
        });
        options.onEvent?.({
          type: "lane-event",
          experimentId: options.experimentId!,
          laneId: "fresh-default",
          runId: `${options.experimentId}:fresh-default:1`,
          at: "2026-08-17T00:00:01.500Z",
          event: { type: "text-delta", messageId: "message-1", text: "I am checking the project." },
        });
        return {} as never;
      },
    });

    const preview = await (await fetch(`${started.url}/api/experiment`)).json();
    expect(preview.manifest.lanes.map((lane: { id: string }) => lane.id)).toEqual([
      "history",
      "fresh-default",
      "fresh-minimal",
    ]);
    expect(preview.contrasts[0]).toMatchObject({
      id: "profile-effect",
      attribution: { mode: "attributable", axis: "runtime-profile" },
    });
    expect(preview.setup).toMatchObject({
      scenario: "historical-replay",
      checkpointSource: {
        status: "unavailable",
        materialization: { timing: "on-run", count: 10 },
      },
      request: { provenance: "unverified-history" },
    });
    expect(preview.setup.historicalGaps[0]).toMatchObject({ laneId: "history" });
    expect(preview.observedCalls.history[0]).toMatchObject({
      name: "Read",
      input: { path: "README.md" },
      status: "completed",
    });
    expect(preview.observedCallPages.history).toMatchObject({ complete: true, malformedLines: 0 });
    expect(preview).not.toHaveProperty("observedEvents");

    const observedPage = await (await fetch(`${started.url}/api/experiment/observed-calls?laneId=history&limit=100`)).json();
    expect(observedPage.complete).toBe(true);
    expect(observedPage.calls).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Read" })]));
    const invalidPage = await fetch(`${started.url}/api/experiment/observed-calls?laneId=../history`);
    expect(invalidPage.status).toBe(400);

    const stream = await fetch(`${started.url}/api/experiment/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experimentId: "exp_server_test", prompt: "Use this live request exactly.\n" }),
    });
    const body = await stream.text();
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain('"experimentId":"exp_server_test"');
    expect(body).toContain('"laneId":"fresh-default"');
    expect(body).toContain('"type":"tool-call-started"');
    expect(body).toContain('"toolName":"Read"');
    expect(body).toContain('"type":"assistant-text-delta"');
    expect(body).toContain('"text":"I am checking the project."');
    expect(body).not.toContain('"type":"tool.requested"');
    expect(submittedPrompt).toBe("Use this live request exactly.\n");

    const emptyPrompt = await fetch(`${started.url}/api/experiment/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "   " }),
    });
    expect(emptyPrompt.status).toBe(400);
    expect(await emptyPrompt.json()).toMatchObject({ error: expect.stringContaining("non-empty") });
  });

  it("rejects cross-origin experiment execution", async () => {
    const appDir = await makeAppDir();
    started = await startHarnessStudioServer({
      appDir,
      experimentManifestPath: EXPERIMENT_MANIFEST,
      experimentRunner: async () => ({} as never),
    });

    const response = await fetch(`${started.url}/api/experiment/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://hostile.example" },
      body: "{}",
    });

    expect(response.status).toBe(403);
  });

  it("requires a server-configured Agent before starting an ACP experiment stream", async () => {
    const appDir = await makeAppDir();
    const experimentManifestPath = await makeAcpExperimentManifest();
    started = await startHarnessStudioServer({
      appDir,
      experimentManifestPath,
      experimentRunner: async () => ({} as never),
    });

    const response = await fetch(`${started.url}/api/experiment/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experimentId: "exp_acp_missing" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("no available server-registered ACP Agent") });
  });

  it("selects one registered ACP Agent per lane and retains only runtime identity", async () => {
    const appDir = await makeAppDir();
    const experimentManifestPath = await makeAcpExperimentManifest();
    let runtimeSelection: unknown;
    const alpha = { command: process.execPath, args: [ACP_AGENT_FIXTURE], label: "Alpha ACP" };
    const beta = { command: process.execPath, args: [ACP_AGENT_FIXTURE, "--beta"], label: "Beta ACP" };
    started = await startHarnessStudioServer({
      appDir,
      experimentManifestPath,
      acpAgent: alpha,
      acpAgents: [
        { id: "alpha", label: "Alpha ACP", agent: alpha },
        { id: "beta", label: "Beta ACP", agent: beta },
        { id: "missing", label: "Missing ACP", unavailableReason: "bridge not installed" },
      ],
      experimentRunner: async (options) => {
        runtimeSelection = options.runtimeSelection;
        return {} as never;
      },
    });

    const preview = await (await fetch(`${started.url}/api/experiment`)).json() as Record<string, unknown>;
    const agentCatalog = preview.acpAgents as {
      defaultAgentId?: string;
      agents: Array<{ id: string; label: string; available: boolean; detail: string }>;
    };
    expect(agentCatalog.defaultAgentId).toBe("alpha");
    expect(agentCatalog.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "alpha", label: "Alpha ACP", available: true }),
      expect.objectContaining({ id: "missing", label: "Missing ACP", available: false, detail: "bridge not installed" }),
    ]));
    expect(JSON.stringify(preview)).not.toContain(ACP_AGENT_FIXTURE);

    const response = await fetch(`${started.url}/api/experiment/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        experimentId: "exp_acp_agents",
        agentIds: { "fresh-default": "beta", "fresh-minimal": "alpha" },
      }),
    });

    expect(response.status).toBe(200);
    await response.text();
    expect(runtimeSelection).toEqual({
      "fresh-default": { agentId: "beta", agentLabel: "Beta ACP", protocol: "acp-v1-stdio", modelPolicy: "lane" },
      "fresh-minimal": { agentId: "alpha", agentLabel: "Alpha ACP", protocol: "acp-v1-stdio", modelPolicy: "lane" },
    });
  });

  it("rejects unknown and unavailable ACP Agent ids before starting the stream", async () => {
    const appDir = await makeAppDir();
    const experimentManifestPath = await makeAcpExperimentManifest();
    const alpha = { command: process.execPath, args: [ACP_AGENT_FIXTURE], label: "Alpha ACP" };
    started = await startHarnessStudioServer({
      appDir,
      experimentManifestPath,
      acpAgent: alpha,
      acpAgents: [
        { id: "alpha", label: "Alpha ACP", agent: alpha },
        { id: "missing", label: "Missing ACP", unavailableReason: "bridge not installed" },
      ],
      experimentRunner: async () => ({} as never),
    });

    const unknown = await fetch(`${started.url}/api/experiment/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentIds: { "fresh-default": "unknown" } }),
    });
    const unavailable = await fetch(`${started.url}/api/experiment/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentIds: { "fresh-default": "missing" } }),
    });

    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: expect.stringContaining("not registered") });
    expect(unavailable.status).toBe(409);
    expect(await unavailable.json()).toMatchObject({ error: expect.stringContaining("bridge not installed") });
  });

  it("injects the configured ACP lane executor into the experiment runner", async () => {
    const appDir = await makeAppDir();
    const experimentManifestPath = await makeAcpExperimentManifest();
    let factoryConfigured = false;
    started = await startHarnessStudioServer({
      appDir,
      experimentManifestPath,
      acpAgent: { command: process.execPath, args: [ACP_AGENT_FIXTURE] },
      experimentRunner: async (options) => {
        factoryConfigured = options.executorFactory !== undefined;
        return {} as never;
      },
    });

    const response = await fetch(`${started.url}/api/experiment/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experimentId: "exp_acp_factory" }),
    });

    expect(response.status).toBe(200);
    await response.text();
    expect(factoryConfigured).toBe(true);
  });

  it("cancels a running experiment through its lifecycle endpoint", async () => {
    const appDir = await makeAppDir();
    started = await startHarnessStudioServer({
      appDir,
      experimentManifestPath: EXPERIMENT_MANIFEST,
      experimentRunner: (options) => new Promise((_, reject) => {
        options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
      }),
    });
    const stream = await fetch(`${started.url}/api/experiment/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experimentId: "exp_cancel_test" }),
    });

    const cancellation = await fetch(`${started.url}/api/experiment/runs/exp_cancel_test`, { method: "DELETE" });

    expect(cancellation.status).toBe(202);
    expect(await cancellation.json()).toMatchObject({ status: "cancelling" });
    expect(await stream.text()).toContain('"type":"experiment-cancelled"');
  });

  it("aborts a running experiment when its SSE client disconnects", async () => {
    const appDir = await makeAppDir();
    let resolveAborted!: () => void;
    const aborted = new Promise<void>((resolvePromise) => { resolveAborted = resolvePromise; });
    started = await startHarnessStudioServer({
      appDir,
      experimentManifestPath: EXPERIMENT_MANIFEST,
      experimentRunner: (options) => new Promise((_, reject) => {
        options.signal?.addEventListener("abort", () => {
          resolveAborted();
          reject(options.signal?.reason);
        }, { once: true });
      }),
    });
    const target = new URL(`${started.url}/api/experiment/runs`);
    const body = JSON.stringify({ experimentId: "exp_disconnect_test" });
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const request = httpRequest({
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
      }, (response) => {
        response.destroy();
        resolvePromise();
      });
      request.once("error", rejectPromise);
      request.end(body);
    });

    await expect(aborted).resolves.toBeUndefined();
  });

  it("serves the app shell and refuses path escapes", async () => {
    const appDir = await makeAppDir();
    started = await startHarnessStudioServer({ appDir });

    const index = await fetch(`${started.url}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");

    const escape = await fetch(`${started.url}/..%2f..%2fetc%2fpasswd`);
    expect([403, 404]).toContain(escape.status);
  });

  it("mounts the embedded AG-UI endpoint when a harness is loaded", async () => {
    const appDir = await makeAppDir();
    started = await startHarnessStudioServer({
      appDir,
      harnessSource: SOURCE,
      executorFactory: scriptedExecutorFactory,
    });

    const response = await fetch(`${started.url}/agui`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "t1",
        runId: "r1",
        messages: [{ role: "user", content: "hello studio" }],
      }),
    });

    const events = decodeSseStream(await response.text());
    expect(events.map((event) => event.type)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_RESULT",
      "RUN_FINISHED",
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "TEXT_MESSAGE_CONTENT", delta: "echo: hello studio" }),
    );

    const hostile = await fetch(`${started.url}/agui`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://hostile.example" },
      body: JSON.stringify({
        threadId: "t1",
        runId: "r2",
        messages: [{ role: "user", content: "must not run" }],
      }),
    });
    expect(hostile.status).toBe(403);
  });

  it("delivers a source-backed skill through the embedded AG-UI endpoint", async () => {
    const appDir = await makeAppDir();
    const sourceRoot = await makeTempDir("studio-source-");
    await mkdir(join(sourceRoot, "skills", "deep-guide"), { recursive: true });
    await writeFile(
      join(sourceRoot, "skills", "deep-guide", "SKILL.md"),
      "Never touch generated files.\n",
      "utf8",
    );

    let deliveredBody: string | undefined;
    let seenSourceRoot: string | undefined;
    started = await startHarnessStudioServer({
      appDir,
      harnessSource: SOURCE_SKILL_HARNESS,
      sourceRoot,
      executorFactory: (context) => ({
        host: "qoder",
        async execute(revision, bundle, task) {
          seenSourceRoot = task.sourceRoot;
          deliveredBody = (await loadSkillDeliveries(revision, bundle, {
            sourceRoot: task.sourceRoot,
          })).get("deep-guide")?.body;
          const emitter = new HarnessRunEmitter(context.onRunEvent);
          emitter.start({ revisionId: revision.revisionId, host: "qoder" });
          emitter.finish(0);
          return {
            host: "qoder",
            revisionId: revision.revisionId,
            exitCode: 0,
            output: "",
            errorOutput: "",
            warnings: [],
          };
        },
      }),
    });

    const response = await fetch(`${started.url}/agui`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "t1",
        runId: "r-source",
        messages: [{ role: "user", content: "run" }],
      }),
    });

    expect(decodeSseStream(await response.text()).map((event) => event.type)).toEqual([
      "RUN_STARTED",
      "RUN_FINISHED",
    ]);
    expect(seenSourceRoot).toBe(sourceRoot);
    expect(deliveredBody).toBe("Never touch generated files.\n");
  });

  it("keeps /agui closed when no harness is loaded", async () => {
    const appDir = await makeAppDir();
    started = await startHarnessStudioServer({ appDir });

    const response = await fetch(`${started.url}/agui`, { method: "POST", body: "{}" });

    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/--harness/);
  });

  it("saves, lists, and replays Debugger runs behind the harness and same-origin boundary", async () => {
    const appDir = await makeAppDir();
    const runDirectory = join(await makeTempDir("studio-runs-"), "runs");
    started = await startHarnessStudioServer({
      appDir,
      harnessSource: SOURCE,
      executorFactory: scriptedExecutorFactory,
      runDirectory,
    });

    const snapshot = {
      prompt: "Verify saved run catalog",
      status: "finished",
      runId: "r_catalog",
      threadId: "t_catalog",
      warnings: ["one warning"],
      result: { exitCode: 0 },
      timeline: [
        { kind: "message", id: "m1", text: "echo: catalog", complete: true },
        { kind: "tool-call", id: "tu_1", name: "Read", argsText: '{"path":"README.md"}', status: "completed", resultText: '{"bytes":42}' },
        { kind: "tool-call", id: "tu_2", name: "Bash", argsText: '{"command":"npm test"}', status: "failed", resultText: "1 failed" },
      ],
    };

    const hostile = await fetch(`${started.url}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://hostile.example" },
      body: JSON.stringify(snapshot),
    });
    expect(hostile.status).toBe(403);

    const savedResponse = await fetch(`${started.url}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    expect(savedResponse.status).toBe(201);
    const saved = await savedResponse.json();
    expect(saved.id).toMatch(/^run_/);

    const listed = await (await fetch(`${started.url}/api/runs`)).json();
    expect(listed.runs).toEqual([
      expect.objectContaining({ id: saved.id, prompt: "Verify saved run catalog", status: "finished", toolCallCount: 2 }),
    ]);

    const record = await (await fetch(`${started.url}/api/runs/${saved.id}`)).json();
    expect(record).toMatchObject({
      id: saved.id,
      prompt: "Verify saved run catalog",
      warnings: ["one warning"],
      result: { exitCode: 0 },
    });
    expect(record.timeline).toHaveLength(3);
    expect(record.timeline[1]).toMatchObject({ kind: "tool-call", name: "Read", status: "completed" });

    const session = await (await fetch(`${started.url}/api/runs/${saved.id}/session`)).json();
    expect(session).toMatchObject({
      id: "r_catalog",
      name: "Verify saved run catalog",
      mode: "Retained run",
      protocol: "AG-UI retained evidence",
    });
    expect(session.events.map((event: { kind: string }) => event.kind)).toEqual(["prompt", "response", "explore", "verify"]);
    expect(session.events.find((event: { phase: string }) => event.phase === "Verify")).toMatchObject({
      title: "Bash tool call",
      validation: { command: "npm test", status: "failed" },
      stopConditions: ["tests", "failures"],
    });

    const missing = await fetch(`${started.url}/api/runs/run_does_not_exist`);
    expect(missing.status).toBe(404);

    const invalid = await fetch(`${started.url}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "finished", timeline: [] }),
    });
    expect(invalid.status).toBe(400);
  });

  it("keeps the run catalog closed when no harness is loaded", async () => {
    const appDir = await makeAppDir();
    started = await startHarnessStudioServer({ appDir });

    const response = await fetch(`${started.url}/api/runs`);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/--harness/);
  });
});

describe("harness-studio CLI", () => {
  it("prints help and exits 0 without touching files or ports", async () => {
    const out: string[] = [];

    const code = await runHarnessStudioCli(["--help"], {
      stdout: (text) => out.push(text),
      stderr: () => undefined,
    });

    expect(code).toBe(0);
    expect(out.join("")).toContain("--evidence <dir>");
  });

  it("accepts an empty startup so Studio can acquire artifacts in the UI", () => {
    expect(parseHarnessStudioArgs([])).toMatchObject({ host: "127.0.0.1", port: 3311 });
    expect(parseHarnessStudioArgs([]).error).toBeUndefined();
  });

  it("prints its package version without opening a server", async () => {
    const out: string[] = [];
    const errors: string[] = [];

    const code = await runHarnessStudioCli(["--version"], {
      stdout: (text) => out.push(text),
      stderr: (text) => errors.push(text),
    });

    expect(code).toBe(0);
    expect(out.join("").trim()).toBe("0.1.1");
    expect(errors).toEqual([]);
  });

  it("preserves the first invalid option and does not consume a following flag as a value", () => {
    expect(parseHarnessStudioArgs(["--evidenc", "./evidence"]).error).toBe("Unknown option '--evidenc'.");
    const missingHarness = parseHarnessStudioArgs(["--harness", "--port", "9999"]);
    expect(missingHarness.error).toBe("--harness requires a value.");
    expect(missingHarness.port).toBe(9999);
  });

  it("reports a missing harness file with the option and recovery context", async () => {
    const errors: string[] = [];
    const code = await runHarnessStudioCli(["--harness", "./not-a-real-agent.harness"], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text),
    });

    expect(code).toBe(2);
    expect(errors.join("")).toContain("--harness file was not found: ./not-a-real-agent.harness");
    expect(errors.join("")).not.toContain("ENOENT");
  });

  it("explains how to recover when the requested port is occupied", async () => {
    const appDir = await makeAppDir();
    started = await startHarnessStudioServer({ appDir, port: 0 });
    const occupiedPort = new URL(started.url).port;
    const errors: string[] = [];

    const code = await runHarnessStudioCli(["--port", occupiedPort], {
      stdout: () => undefined,
      stderr: (text) => errors.push(text),
    });

    expect(code).toBe(2);
    expect(errors.join("")).toContain(`Port ${occupiedPort} is already in use`);
    expect(errors.join("")).toContain("--port <n>");
  });

  it("parses repeated operator-provisioned Artifact Provider modules", () => {
    expect(parseHarnessStudioArgs([
      "--artifact-provider-module", "@homology/integration-harness-notebook-provider",
      "--artifact-provider-module", "./providers/local.mjs",
    ]).artifactProviderModules).toEqual([
      "@homology/integration-harness-notebook-provider",
      "./providers/local.mjs",
    ]);
    expect(parseHarnessStudioArgs(["--artifact-provider-module"]).error).toBe(
      "--artifact-provider-module requires a package name or filesystem path.",
    );
  });

  it("resolves the default source root from the harness file and honors an override", () => {
    expect(resolveHarnessStudioSourceRoot("/workspace/harnesses/agent.harness")).toBe(
      resolve("/workspace/harnesses"),
    );
    expect(resolveHarnessStudioSourceRoot("/workspace/harnesses/agent.harness", "/skills")).toBe(
      "/skills",
    );
    expect(resolveHarnessStudioSourceRoot(undefined)).toBeUndefined();
  });

  it("parses Inspector, history catalog, runs, source catalog, and lock directory options", () => {
    expect(parseHarnessStudioArgs([
      "--inspector", "inspector.html",
      "--experiment", "experiment.json",
      "--history-catalog", "history.json",
      "--experiment-locks", ".locks",
      "--runs", ".runs",
      "--source-catalog", "sources.json",
    ])).toMatchObject({
      inspector: "inspector.html",
      experiment: "experiment.json",
      historyCatalog: "history.json",
      experimentLocks: ".locks",
      runs: ".runs",
      sourceCatalog: "sources.json",
    });

    expect(parseSourceCatalog({ sources: [{ kind: "evidence", id: "ev_local", label: "Local evidence", path: "evidence" }] }, "/workspace")).toEqual([
      { kind: "evidence", id: "ev_local", label: "Local evidence", path: resolve("/workspace/evidence") },
    ]);
  });

  it("keeps the ACP executable and repeated argv in server-owned CLI configuration", () => {
    expect(parseHarnessStudioArgs([
      "--acp-agent", "codex-acp",
      "--acp-arg", "-c",
      "--acp-arg", 'service_tier="fast"',
    ])).toMatchObject({
      acpAgent: "codex-acp",
      acpArgs: ["-c", 'service_tier="fast"'],
    });
  });

  it("discovers the conventional Inspector report only at its fixed path", async () => {
    const cwd = await makeTempDir("studio-discover-");
    expect(await discoverDefaultInspectorReport(cwd)).toBeUndefined();

    const reportDir = join(cwd, ".qoder", "better-harness-runs", "harness-inspector");
    await mkdir(reportDir, { recursive: true });
    await writeFile(join(reportDir, "inspector.html"), "<!doctype html><title>local report</title>", "utf8");

    expect(await discoverDefaultInspectorReport(cwd)).toBe(join(reportDir, "inspector.html"));
  });

  it("serves Canvas TSX through a revision-bound build and keeps ordinary TSX source-only", async () => {
    const appDir = await makeAppDir();
    const artifactDirectory = await makeTempDir("studio-artifacts-");
    await writeFile(join(artifactDirectory, "card.canvas.tsx"), "export default () => <p>hi</p>;\n", "utf8");
    await writeFile(join(artifactDirectory, "ordinary.tsx"), "export const value = <p>source only</p>;\n", "utf8");
    await writeFile(join(artifactDirectory, "report.pdf"), "%PDF fixture", "utf8");
    await writeFile(join(artifactDirectory, "active.html"), "<script>top.location='https://example.invalid'</script>", "utf8");
    await writeFile(join(artifactDirectory, "diagram.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "utf8");
    await writeFile(join(artifactDirectory, "diagram.mmd"), "graph TD\n  Start --> Finish\n", "utf8");
    started = await startHarnessStudioServer({ appDir, artifactDirectory });

    const catalog: unknown = await (await fetch(`${started.url}/api/artifacts`)).json();
    expect(isArtifactCatalogResponse(catalog)).toBe(true);
    if (!isArtifactCatalogResponse(catalog)) throw new Error("expected typed artifact catalog");
    expect(catalog.kind).toBe("HarnessStudioArtifactCatalogV2");
    expect(catalog.snapshot).toEqual(expect.objectContaining({
      catalogId: expect.stringMatching(/^artifacts-[0-9a-f]{16}$/u),
      revision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    }));
    const card = catalog.artifacts.find((entry) => entry.label === "card.canvas.tsx")!;
    expect(card).toEqual(expect.objectContaining({
      format: "cursor-canvas-tsx",
      backing: "code",
      build: { snapshotUri: expect.stringMatching(/\/build$/u) },
      renderer: expect.objectContaining({ id: "studio.react-preview", type: "sandboxed-web" }),
      capabilities: expect.arrayContaining(["execute", "live-update"]),
    }));
    expect(catalog.artifacts.find((entry) => entry.label === "ordinary.tsx")).toMatchObject({
      format: "tsx",
      backing: "data",
      renderer: { id: "studio.code", type: "native", status: "ready" },
      capabilities: [],
    });
    expect(catalog.artifacts.find((entry) => entry.label === "ordinary.tsx")?.build).toBeUndefined();
    expect(card.revision.content).toEqual(expect.objectContaining({
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      uri: `/api/artifacts/${card.id}/revisions/${card.revision.digest.slice(7)}/content`,
      mediaType: "text/plain; charset=utf-8",
    }));
    const source = await fetch(`${started.url}${card.revision.content.uri}`);
    expect(source.status).toBe(200);
    expect(source.headers.get("content-type")).toBe(card.revision.content.mediaType);
    expect(source.headers.get("etag")).toBe(`"${card.revision.digest.slice(7)}"`);
    expect(await source.text()).toContain("export default");
    expect((await fetch(`${started.url}/api/artifacts/${card.id}/module.js`)).status).toBe(404);

    const svg = catalog.artifacts.find((entry) => entry.label === "diagram.svg")!;
    const mermaid = catalog.artifacts.find((entry) => entry.label === "diagram.mmd")!;
    expect(svg).toMatchObject({
      backing: "code",
      build: { snapshotUri: expect.stringMatching(/\/build$/u) },
      renderer: { id: "studio.svg-react-preview", type: "sandboxed-web" },
    });
    expect(mermaid).toMatchObject({
      backing: "code",
      build: { snapshotUri: expect.stringMatching(/\/build$/u) },
      renderer: { id: "studio.mermaid-react-preview", type: "sandboxed-web" },
    });
    expect((await fetch(`${started.url}${svg.build!.snapshotUri}`)).status).toBe(200);
    expect((await fetch(`${started.url}${mermaid.build!.snapshotUri}`)).status).toBe(200);

    const buildResponse = await fetch(`${started.url}${card.build!.snapshotUri}`);
    expect(buildResponse.status).toBe(200);
    const build = await buildResponse.json();
    expect(build).toEqual(expect.objectContaining({
      kind: "ArtifactBuildSnapshotV1",
      artifactId: card.id,
      revisionId: card.revision.id,
      buildId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      status: "ready",
      previewUri: expect.stringMatching(/\/builds\/[0-9a-f]{64}\/preview$/u),
    }));
    const preview = await fetch(`${started.url}${build.previewUri}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(await preview.text()).toContain("runtime.init");


    for (const descriptor of catalog.artifacts) {
      const content = await fetch(`${started.url}${descriptor.revision.content.uri}`);
      expect(content.headers.get("content-type"), descriptor.label).toBe(descriptor.revision.content.mediaType);
      if (descriptor.label === "active.html" || descriptor.label === "diagram.svg") {
        expect(content.headers.get("content-disposition"), descriptor.label).toMatch(/^attachment;/u);
        expect(content.headers.get("content-security-policy"), descriptor.label).toBe("default-src 'none'; sandbox");
      } else {
        expect(content.headers.get("content-disposition"), descriptor.label).toBeNull();
      }
    }

    // A revision-scoped URL must never answer with different bytes. Once the
    // file moves on, the stale handle is a conflict the client refetches.
    await writeFile(join(artifactDirectory, "card.canvas.tsx"), "export default () => <p>changed</p>;\n", "utf8");
    const stale = await fetch(`${started.url}${card.revision.content.uri}`);
    expect(stale.status).toBe(409);
    const refreshed: unknown = await (await fetch(`${started.url}/api/artifacts`)).json();
    if (!isArtifactCatalogResponse(refreshed)) throw new Error("expected typed artifact catalog");
    const updated = refreshed.artifacts.find((entry) => entry.label === "card.canvas.tsx")!;
    expect(updated.id).toBe(card.id);
    expect(updated.threadId).toBe(card.threadId);
    expect(updated.revision.digest).not.toBe(card.revision.digest);
    expect((await fetch(`${started.url}${updated.revision.content.uri}`)).status).toBe(200);
    const conditional = await fetch(`${started.url}${updated.revision.content.uri}`, {
      headers: { "if-none-match": `"${updated.revision.digest.slice(7)}"` },
    });
    expect(conditional.status).toBe(304);
  });

  it("imports a manually selected artifact set and switches the live catalog atomically", async () => {
    const appDir = await makeAppDir();
    const originalDirectory = await makeTempDir("studio-artifacts-original-");
    const originalPath = join(originalDirectory, "old.tsx");
    await writeFile(originalPath, "export const old = true;\n", "utf8");
    started = await startHarnessStudioServer({ appDir, artifactDirectory: originalDirectory });

    const created = await fetch(`${started.url}/api/artifact-imports`, { method: "POST" });
    expect(created.status).toBe(201);
    const { sessionId, maxFiles, maxBytes } = await created.json() as { sessionId: string; maxFiles: number; maxBytes: number };
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(maxFiles).toBe(256);
    expect(maxBytes).toBe(128 * 1024 * 1024);

    const deck = await fetch(`${started.url}/api/artifact-imports/${sessionId}/files?name=${encodeURIComponent("slides/deck.pptx")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.from("pptx fixture"),
    });
    const source = await fetch(`${started.url}/api/artifact-imports/${sessionId}/files?name=${encodeURIComponent("code/card.tsx")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.from("export default () => <p>imported</p>;\n"),
    });
    expect(deck.status).toBe(201);
    expect(await deck.json()).toMatchObject({ label: "slides--deck.pptx" });
    expect(source.status).toBe(201);
    expect(await source.json()).toMatchObject({ label: "code--card.tsx" });

    const beforeCommit = await (await fetch(`${started.url}/api/artifacts`)).json() as { artifacts: Array<{ label: string }> };
    expect(beforeCommit.artifacts.map((artifact) => artifact.label)).toEqual(["old.tsx"]);

    const committed = await fetch(`${started.url}/api/artifact-imports/${sessionId}/commit`, { method: "POST" });
    expect(committed.status).toBe(200);
    expect(await committed.json()).toMatchObject({ imported: 2 });
    expect(await readFile(originalPath, "utf8")).toBe("export const old = true;\n");

    const config = await (await fetch(`${started.url}/api/config`)).json() as { artifactsEnabled: boolean };
    expect(config.artifactsEnabled).toBe(true);
    const catalog = await (await fetch(`${started.url}/api/artifacts`)).json() as { artifacts: Array<{ label: string }> };
    expect(catalog.artifacts.map((artifact) => artifact.label).sort()).toEqual(["code--card.tsx", "slides--deck.pptx"]);
  });

  it("rejects hostile or incomplete manual artifact imports without changing the catalog", async () => {
    const appDir = await makeAppDir();
    started = await startHarnessStudioServer({ appDir });

    const hostile = await fetch(`${started.url}/api/artifact-imports`, {
      method: "POST",
      headers: { Origin: "https://hostile.example" },
    });
    expect(hostile.status).toBe(403);

    const created = await fetch(`${started.url}/api/artifact-imports`, { method: "POST" });
    const { sessionId, maxBytes } = await created.json() as { sessionId: string; maxBytes: number };
    const oversizedStatus = await new Promise<number | undefined>((resolveStatus, reject) => {
      const upload = httpRequest(
        `${started!.url}/api/artifact-imports/${sessionId}/files?name=oversized.bin`,
        { method: "PUT", headers: { "Content-Length": String(maxBytes + 1) } },
        (response) => {
          response.resume();
          response.once("end", () => resolveStatus(response.statusCode));
        },
      );
      upload.once("error", reject);
      upload.end();
    });
    expect(oversizedStatus).toBe(413);
    const traversal = await fetch(`${started.url}/api/artifact-imports/${sessionId}/files?name=${encodeURIComponent("../secret.txt")}`, {
      method: "PUT",
      body: Buffer.from("must not land"),
    });
    expect(traversal.status).toBe(400);
    expect((await fetch(`${started.url}/api/artifact-imports/${sessionId}/commit`, { method: "POST" })).status).toBe(400);
    expect((await fetch(`${started.url}/api/artifact-imports/${sessionId}`, { method: "DELETE" })).status).toBe(200);

    const config = await (await fetch(`${started.url}/api/config`)).json() as { artifactsEnabled: boolean };
    expect(config.artifactsEnabled).toBe(false);
    expect((await fetch(`${started.url}/api/artifacts`)).status).toBe(404);
  });

  it("rejects malformed percent-encoded artifact ids without taking down the server", async () => {
    const appDir = await makeAppDir();
    const artifactDirectory = await makeTempDir("studio-artifacts-");
    await writeFile(join(artifactDirectory, "card.tsx"), "export default () => null;\n", "utf8");
    started = await startHarnessStudioServer({ appDir, artifactDirectory });
    expect((await fetch(`${started.url}/api/artifacts/%E0%A4%A/revisions/${"0".repeat(64)}/content`)).status).toBe(400);
    expect((await fetch(`${started.url}/api/config`)).status).toBe(200);
  });

  it("answers with a status when the artifact directory disappears after startup", async () => {
    const appDir = await makeAppDir();
    const artifactDirectory = await makeTempDir("studio-artifacts-");
    await writeFile(join(artifactDirectory, "card.tsx"), "export default () => <p>hi</p>;\n", "utf8");
    started = await startHarnessStudioServer({ appDir, artifactDirectory });
    const listed: unknown = await (await fetch(`${started.url}/api/artifacts`)).json();
    if (!isArtifactCatalogResponse(listed)) throw new Error("expected typed artifact catalog");
    const contentUri = listed.artifacts[0]!.revision.content.uri;
    expect((await fetch(`${started.url}${contentUri}`)).status).toBe(200);

    await rm(artifactDirectory, { recursive: true, force: true });

    // An unreadable directory must not reject out of the route handler: that is
    // an unhandled rejection, which takes the whole Studio process down.
    const response = await fetch(`${started.url}${contentUri}`);
    expect(response.status).toBe(404);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("Cannot read the configured artifact directory.");
    expect(body.error).not.toContain(artifactDirectory);

    // The server is still answering, which is the point of the guard.
    expect((await fetch(`${started.url}/api/config`)).status).toBe(200);
  });
});
