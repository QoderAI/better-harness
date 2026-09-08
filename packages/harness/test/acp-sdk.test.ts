import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileHarness } from "../src/compiler/compile.js";
import { AcpSdkExecutor } from "../src/exec/acp-sdk.js";
import { resolveHarness } from "../src/resolver/resolve.js";
import { ACP_ADAPTER_DESCRIPTOR } from "../src/resolver/adapter-registry.js";

const SOURCE = `
  language 0.3
  skill verify { description "Return verified evidence." }
  workflow single { session coder }
  harness live-acp {
    workflow single
    agent coder { use skill verify }
  }
  runtime acp { adapter "@harness/adapter-acp" }
  deployment live-acp-run { harness live-acp runtime acp }
`;

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/acp-agent.mjs");
const LAUNCHER_FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/acp-agent-launcher.mjs");

describe("AcpSdkExecutor", () => {
  it("runs the stable ACP v1 lifecycle and retains real redacted protocol frames", async () => {
    const { bundle } = await compileHarness(SOURCE);
    const { revision, report } = resolveHarness(bundle!, "live-acp", "acp", {
      adapter: () => ACP_ADAPTER_DESCRIPTOR,
    });
    expect(report.errors).toEqual([]);
    const protocolEvents: unknown[] = [];
    const executor = new AcpSdkExecutor({
      command: process.execPath,
      args: [FIXTURE],
      onRunEvent: (event) => {
        if (event.type === "protocol-event") protocolEvents.push(event);
      },
      requestPermission: async (_requestId, request) => ({
        outcome: { outcome: "selected", optionId: request.options[0]!.optionId },
      }),
    });

    const result = await executor.execute(revision!, bundle!, { prompt: "Prove ACP works" });

    expect(result).toMatchObject({
      host: "acp",
      exitCode: 0,
      output: "fixture:allow-once",
      runtimeReceipt: {
        executor: "@agentclientprotocol/sdk",
        runtimeProfile: "acp-v1-stdio",
        permissionCallback: "configured",
      },
      metrics: { sessionId: "fixture-session", stopReason: "end_turn" },
    });
    expect(protocolEvents).toHaveLength((result.trace as unknown[]).length);
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: "Client → Agent", method: "initialize" }),
      expect.objectContaining({ direction: "Client → Agent", method: "session/new" }),
      expect.objectContaining({ direction: "Client → Agent", method: "session/prompt" }),
      expect.objectContaining({ direction: "Agent → Client", method: "session/request_permission" }),
      expect.objectContaining({ direction: "Agent → Client", method: "session/update" }),
    ]));
    expect(JSON.stringify(result.trace)).not.toContain("fixture-secret");
    expect(JSON.stringify(result.trace)).toContain("[REDACTED]");
  });

  it("reports a missing configured executable as a failed run", async () => {
    const { bundle } = await compileHarness(SOURCE);
    const { revision } = resolveHarness(bundle!, "live-acp", "acp", {
      adapter: () => ACP_ADAPTER_DESCRIPTOR,
    });
    const executor = new AcpSdkExecutor({ command: resolve("/definitely-missing", "better-harness-acp") });
    const startedAt = Date.now();

    const result = await executor.execute(revision!, bundle!, { prompt: "This cannot start" });

    expect(result.exitCode).toBe(1);
    expect(result.errorOutput).toMatch(/ENOENT|not found/u);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("applies and verifies lane session configuration before prompting", async () => {
    const { bundle } = await compileHarness(SOURCE);
    const { revision } = resolveHarness(bundle!, "live-acp", "acp", {
      adapter: () => ACP_ADAPTER_DESCRIPTOR,
    });
    const executor = new AcpSdkExecutor({
      command: process.execPath,
      args: [FIXTURE],
      sessionConfig: { model: "fixture-candidate" },
      requestPermission: async (_requestId, request) => ({
        outcome: { outcome: "selected", optionId: request.options[0]!.optionId },
      }),
    });

    const result = await executor.execute(revision!, bundle!, { prompt: "Use the configured model" });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("fixture:allow-once:fixture-candidate");
    expect(result.runtimeReceipt).toMatchObject({
      model: "fixture-candidate",
      sessionConfig: { model: "fixture-candidate" },
    });
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        direction: "Client → Agent",
        method: "session/set_config_option",
      }),
    ]));
  });

  it("fails instead of silently running with an unacknowledged session configuration", async () => {
    const { bundle } = await compileHarness(SOURCE);
    const { revision } = resolveHarness(bundle!, "live-acp", "acp", {
      adapter: () => ACP_ADAPTER_DESCRIPTOR,
    });
    const executor = new AcpSdkExecutor({
      command: process.execPath,
      args: [FIXTURE, "--reject-config"],
      sessionConfig: { model: "fixture-candidate" },
    });

    const result = await executor.execute(revision!, bundle!, { prompt: "Do not use a fallback" });

    expect(result.exitCode).toBe(1);
    expect(result.errorOutput).toContain("did not acknowledge session option 'model'");
    expect(result.trace).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "session/prompt" }),
    ]));
  });

  it("maps abort to session/cancel on the active ACP session", async () => {
    const { bundle } = await compileHarness(SOURCE);
    const { revision } = resolveHarness(bundle!, "live-acp", "acp", {
      adapter: () => ACP_ADAPTER_DESCRIPTOR,
    });
    const abortController = new AbortController();
    const methods: string[] = [];
    const executor = new AcpSdkExecutor({
      command: process.execPath,
      args: [FIXTURE, "--wait-for-cancel"],
      abortSignal: abortController.signal,
      requestPermission: async (_requestId, request) => ({
        outcome: { outcome: "selected", optionId: request.options[0]!.optionId },
      }),
      onRunEvent: (event) => {
        if (event.type !== "protocol-event") return;
        methods.push(event.method);
        if (event.direction === "Agent → Client" && event.method === "session/update") {
          abortController.abort();
        }
      },
    });

    const result = await executor.execute(revision!, bundle!, { prompt: "Wait until cancelled" });

    expect(result.exitCode).toBe(1);
    expect(result.metrics).toMatchObject({ sessionId: "fixture-session", stopReason: "cancelled" });
    expect(methods).toContain("session/cancel");
  });

  it("bounds cancellation while session creation is incomplete", async () => {
    const { bundle } = await compileHarness(SOURCE);
    const { revision } = resolveHarness(bundle!, "live-acp", "acp", {
      adapter: () => ACP_ADAPTER_DESCRIPTOR,
    });
    const abortController = new AbortController();
    const methods: string[] = [];
    const executor = new AcpSdkExecutor({
      command: process.execPath,
      args: [FIXTURE, "--delay-new"],
      abortSignal: abortController.signal,
      onRunEvent: (event) => {
        if (event.type !== "protocol-event") return;
        methods.push(event.method);
        if (event.direction === "Client → Agent" && event.method === "session/new") {
          setTimeout(() => abortController.abort(), 0);
        }
      },
    });
    const startedAt = Date.now();

    const result = await executor.execute(revision!, bundle!, { prompt: "Cancel before session creation" });

    expect(result.exitCode).toBe(1);
    expect(result.errorOutput).toContain("ACP session/new cancelled.");
    expect(methods).toContain("$/cancel_request");
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("reaps the Agent before resolving so the run workspace can be removed", async () => {
    const { bundle } = await compileHarness(SOURCE);
    const { revision } = resolveHarness(bundle!, "live-acp", "acp", {
      adapter: () => ACP_ADAPTER_DESCRIPTOR,
    });
    const workspace = await mkdtemp(join(tmpdir(), "acp-agent-cwd-"));
    const agents: ChildProcess[] = [];
    const executor = new AcpSdkExecutor({
      command: process.execPath,
      args: [FIXTURE],
      requestPermission: async (_requestId, request) => ({
        outcome: { outcome: "selected", optionId: request.options[0]!.optionId },
      }),
      spawnAgent: ((command, args, options) => {
        const child = spawn(command as string, args as string[], options as object);
        agents.push(child);
        return child;
      }) as typeof spawn,
    });

    // The fixture Agent stays alive until its stdio closes, so a run that
    // resolves without reaping it leaves the process holding this cwd.
    const result = await executor.execute(revision!, bundle!, {
      prompt: "Prove ACP works",
      cwd: workspace,
    });

    expect(result.exitCode).toBe(0);
    expect(agents).toHaveLength(1);
    const agentProcess = agents[0]!;
    expect(agentProcess.exitCode === null && agentProcess.signalCode === null).toBe(false);
    // Windows refuses to remove a directory that is a live process' cwd.
    await rm(workspace, { recursive: true });
  });

  it("reaps native descendants retained by a package launcher", async () => {
    const { bundle } = await compileHarness(SOURCE);
    const { revision } = resolveHarness(bundle!, "live-acp", "acp", {
      adapter: () => ACP_ADAPTER_DESCRIPTOR,
    });
    const executor = new AcpSdkExecutor({
      command: process.execPath,
      args: [LAUNCHER_FIXTURE],
      requestPermission: async (_requestId, request) => ({
        outcome: { outcome: "selected", optionId: request.options[0]!.optionId },
      }),
    });

    const result = await executor.execute(revision!, bundle!, { prompt: "Run through the launcher" });

    expect(result.exitCode).toBe(0);
    expect(result.metrics).toMatchObject({ sessionId: "fixture-session", stopReason: "end_turn" });
  });
});

it("preserves thought framing without mixing thoughts into the executor's final output", async () => {
  const { bundle } = await compileHarness(SOURCE);
  const { revision } = resolveHarness(bundle!, "live-acp", "acp", { adapter: () => ACP_ADAPTER_DESCRIPTOR });
  const messages: Array<{ role?: "thought"; text: string }> = [];
  const executor = new AcpSdkExecutor({
    command: process.execPath,
    args: [FIXTURE, "--session-stream"],
    onRunEvent: (event) => {
      if (event.type === "message-started") messages.push({ role: event.role, text: "" });
      if (event.type === "text-delta") messages[messages.length - 1]!.text += event.text;
    },
    requestPermission: async (_id, request) => ({ outcome: { outcome: "selected", optionId: request.options[0]!.optionId } }),
  });
  const result = await executor.execute(revision!, bundle!, { prompt: "Inspect session stream" });
  expect(result.exitCode).toBe(0);
  expect(messages.slice(0, 2)).toEqual([{ role: undefined, text: "Starting inspection." }, { role: "thought", text: "Inspecting the evidence." }]);
  expect(result.output).not.toContain("Inspecting the evidence.");
  expect(result.output).toContain("stream:complete");
});


it("exposes live config controls before prompting and revokes them after completion", async () => {
  const { bundle } = await compileHarness(SOURCE);
  const { revision } = resolveHarness(bundle!, "live-acp", "acp", { adapter: () => ACP_ADAPTER_DESCRIPTOR });
  const readiness: boolean[] = [];
  const executor = new AcpSdkExecutor({
    command: process.execPath, args: [FIXTURE, "--session-controls"],
    onSessionReady: async (control) => {
      readiness.push(control !== undefined);
      if (!control) return;
      const response = await control.setConfigOption("model", "fixture-candidate");
      expect(response).toMatchObject({ configOptions: expect.arrayContaining([expect.objectContaining({ id: "effort", currentValue: "medium" })]) });
      await control.setConfigOption("effort", "low");
      await control.setConfigOption("fast", true);
    },
    requestPermission: async (_id, request) => ({ outcome: { outcome: "selected", optionId: request.options[0]!.optionId } }),
  });
  const result = await executor.execute(revision!, bundle!, { prompt: "Use configured values" });
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("configured:fixture-candidate:low:true");
  expect(readiness).toEqual([true, false]);
});
