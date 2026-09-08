import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileHarness } from "../src/compiler/compile.js";
import { AcpRustExecutor } from "../src/exec/acp-rust.js";
import type { HarnessRunEvent } from "../src/exec/events.js";
import { resolveHarness } from "../src/resolver/resolve.js";
import { ACP_ADAPTER_DESCRIPTOR } from "../src/resolver/adapter-registry.js";

/**
 * These drive the staged `harness-acp-host` release executable, so they need
 * `npm run build:rust -w @qoder-ai/better-harness-desktop` first and live outside
 * the default suite. `vitest run` does not match `*.native.ts`, so a checkout
 * without the binary is never asked to run them.
 */

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

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_AGENT = resolve(here, "fixtures/acp-agent.mjs");
const HOST_EXECUTABLE = resolve(
  here,
  "../../better-harness-desktop/dist/native",
  process.platform === "win32" ? "harness-acp-host.exe" : "harness-acp-host",
);

async function revisionUnderTest() {
  const { bundle } = await compileHarness(SOURCE);
  const { revision, report } = resolveHarness(bundle!, "live-acp", "acp", {
    adapter: () => ACP_ADAPTER_DESCRIPTOR,
  });
  expect(report.errors).toEqual([]);
  return { bundle: bundle!, revision: revision! };
}

function approveFirstOption() {
  return async (request: { options: ReadonlyArray<{ optionId: string }> }) =>
    request.options[0]?.optionId;
}

describe("AcpRustExecutor", () => {
  it("runs a prompt session through the Rust host and reports the rust runtime profile", async () => {
    const { bundle, revision } = await revisionUnderTest();
    const events: HarnessRunEvent[] = [];
    const executor = new AcpRustExecutor({
      hostExecutable: HOST_EXECUTABLE,
      command: process.execPath,
      args: [FIXTURE_AGENT],
      onRunEvent: (event) => events.push(event),
      requestPermission: approveFirstOption(),
    });

    const result = await executor.execute(revision, bundle, { prompt: "Prove the Rust host works" });

    expect(result).toMatchObject({
      // The revision declares host "acp", and preflight requires the executor to
      // match it, so choosing the Rust host must not change the authored host.
      host: "acp",
      exitCode: 0,
      output: "fixture:allow-once",
      runtimeReceipt: {
        executor: "harness-acp-host",
        runtimeProfile: "acp-v1-rust",
        permissionCallback: "configured",
      },
      metrics: { sessionId: "fixture-session", stopReason: "end_turn" },
    });
  });

  it("emits each stretch of agent text once instead of resending the whole entry", async () => {
    const { bundle, revision } = await revisionUnderTest();
    const events: HarnessRunEvent[] = [];
    const executor = new AcpRustExecutor({
      hostExecutable: HOST_EXECUTABLE,
      command: process.execPath,
      args: [FIXTURE_AGENT],
      onRunEvent: (event) => events.push(event),
      requestPermission: approveFirstOption(),
    });

    const result = await executor.execute(revision, bundle, { prompt: "Prove deltas are deltas" });

    // The host reports a whole entry per update. If the client forwarded those
    // verbatim, concatenating the deltas would repeat the text as it grew.
    const streamed = events
      .flatMap((event) => (event.type === "text-delta" ? [event.text] : []))
      .join("");
    expect(streamed).toBe(result.output);
    expect(streamed).toBe("fixture:allow-once");
  });

  it("retains real ACP protocol frames with credentials redacted", async () => {
    const { bundle, revision } = await revisionUnderTest();
    const protocolEvents: HarnessRunEvent[] = [];
    const executor = new AcpRustExecutor({
      hostExecutable: HOST_EXECUTABLE,
      command: process.execPath,
      args: [FIXTURE_AGENT],
      onRunEvent: (event) => {
        if (event.type === "protocol-event") protocolEvents.push(event);
      },
      requestPermission: approveFirstOption(),
    });

    const result = await executor.execute(revision, bundle, { prompt: "Prove the trace arrives" });

    // Same evidence contract the Node executor already satisfies, so a reviewer
    // reading a trace never has to know which host produced it.
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: "Client → Agent", method: "initialize" }),
      expect.objectContaining({ direction: "Client → Agent", method: "session/new" }),
      expect.objectContaining({ direction: "Client → Agent", method: "session/prompt" }),
      expect.objectContaining({
        direction: "Agent → Client",
        method: "session/request_permission",
      }),
      expect.objectContaining({ direction: "Agent → Client", method: "session/update" }),
    ]));
    expect(protocolEvents).toHaveLength((result.trace as unknown[]).length);

    // The fixture puts a bearer token in _meta precisely so this is exercised.
    // Redaction happens in the host, before the frame ever reaches this process.
    const serialized = JSON.stringify(result.trace);
    expect(serialized).not.toContain("fixture-secret");
    expect(serialized).toContain("[REDACTED]");
  });

  it("cancels a permission request when no handler is configured", async () => {
    const { bundle, revision } = await revisionUnderTest();
    const executor = new AcpRustExecutor({
      hostExecutable: HOST_EXECUTABLE,
      command: process.execPath,
      args: [FIXTURE_AGENT],
    });

    const result = await executor.execute(revision, bundle, { prompt: "No approver is present" });

    // The turn still completes: the fixture treats a cancelled request as a
    // declined action. What matters is that the Agent is never left waiting.
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("fixture:cancelled");
    expect(result.runtimeReceipt?.permissionCallback).toBe("none");
  });

  it("grants no filesystem tools unless roots were configured", async () => {
    const { bundle, revision } = await revisionUnderTest();
    const withoutRoots = new AcpRustExecutor({
      hostExecutable: HOST_EXECUTABLE,
      command: process.execPath,
      args: [FIXTURE_AGENT],
      requestPermission: approveFirstOption(),
    });
    const closed = await withoutRoots.execute(revision, bundle, { prompt: "No roots" });
    expect(closed.runtimeReceipt?.tools).toEqual([]);

    const workspace = await mkdtemp(join(tmpdir(), "acp-rust-roots-"));
    try {
      const withRoots = new AcpRustExecutor({
        hostExecutable: HOST_EXECUTABLE,
        command: process.execPath,
        args: [FIXTURE_AGENT],
        allowRoots: [workspace],
        requestPermission: approveFirstOption(),
      });
      const opened = await withRoots.execute(revision, bundle, { prompt: "One root" });
      // The receipt must describe reach that was actually granted, so a reader
      // cannot mistake a fenced run for an unfenced one.
      expect(opened.runtimeReceipt?.tools).toEqual([
        "terminal",
        "fs/read_text_file",
        "fs/write_text_file",
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("serves fenced file operations and terminal lifecycle calls", async () => {
    const { bundle, revision } = await revisionUnderTest();
    const workspace = await mkdtemp(join(tmpdir(), "acp-rust-services-"));
    const source = join(workspace, "source.txt");
    const target = join(workspace, "target.txt");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(source, "one\ntwo\nthree\n"));
    try {
      const executor = new AcpRustExecutor({
        hostExecutable: HOST_EXECUTABLE,
        command: process.execPath,
        args: [FIXTURE_AGENT, "--exercise-client-services", "--require-client-services"],
        env: {
          ...process.env,
          ACP_SERVICE_SOURCE: source,
          ACP_SERVICE_TARGET: target,
          ACP_SERVICE_CWD: workspace,
        },
        allowRoots: [workspace],
        requestPermission: approveFirstOption(),
      });

      const result = await executor.execute(revision, bundle, {
        prompt: "Exercise client services",
        cwd: workspace,
      });

      expect(result).toMatchObject({ exitCode: 0, errorOutput: "" });
      expect(result.output).toBe("services:two:terminal-ok:0");
      await expect(import("node:fs/promises").then(({ readFile }) => readFile(target, "utf8")))
        .resolves.toBe("copied:two\n");
      expect(result.runtimeReceipt?.tools).toEqual([
        "terminal",
        "fs/read_text_file",
        "fs/write_text_file",
      ]);
      expect(result.trace).toEqual(expect.arrayContaining([
        expect.objectContaining({ method: "fs/read_text_file" }),
        expect.objectContaining({ method: "fs/write_text_file" }),
        expect.objectContaining({ method: "terminal/create" }),
        expect.objectContaining({ method: "terminal/wait_for_exit" }),
        expect.objectContaining({ method: "terminal/output" }),
        expect.objectContaining({ method: "terminal/release" }),
      ]));
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("applies a session option and fails the run when the agent refuses it", async () => {
    const { bundle, revision } = await revisionUnderTest();
    const accepted = new AcpRustExecutor({
      hostExecutable: HOST_EXECUTABLE,
      command: process.execPath,
      args: [FIXTURE_AGENT],
      sessionConfig: { model: "fixture-candidate" },
      requestPermission: approveFirstOption(),
    });
    const result = await accepted.execute(revision, bundle, { prompt: "Pick a model" });
    expect(result.exitCode).toBe(0);
    expect(result.runtimeReceipt).toMatchObject({
      model: "fixture-candidate",
      sessionConfig: { model: "fixture-candidate" },
    });
    expect(result.output).toBe("fixture:allow-once:fixture-candidate");

    const refused = new AcpRustExecutor({
      hostExecutable: HOST_EXECUTABLE,
      command: process.execPath,
      // The fixture drops the option instead of echoing it under this flag.
      args: [FIXTURE_AGENT, "--reject-config"],
      sessionConfig: { model: "fixture-candidate" },
      requestPermission: approveFirstOption(),
    });
    const rejected = await refused.execute(revision, bundle, { prompt: "Pick a model" });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.errorOutput).toContain("acknowledge");
  });

  it("leaves the run workspace removable after the host is closed", async () => {
    const { bundle, revision } = await revisionUnderTest();
    const workspace = await mkdtemp(join(tmpdir(), "acp-rust-workspace-"));
    const executor = new AcpRustExecutor({
      hostExecutable: HOST_EXECUTABLE,
      command: process.execPath,
      args: [FIXTURE_AGENT],
      requestPermission: approveFirstOption(),
    });

    await executor.execute(revision, bundle, { prompt: "Hold a cwd", cwd: workspace });

    // A live agent keeps a handle on its cwd, so this is the behaviour that
    // failed on Windows with EBUSY before the Node executor learned to reap.
    await expect(rm(workspace, { recursive: true })).resolves.toBeUndefined();
  });

  it("fails fast with a directed message when the host executable is missing", async () => {
    const { bundle, revision } = await revisionUnderTest();
    const executor = new AcpRustExecutor({
      hostExecutable: resolve(here, "fixtures/no-such-acp-host"),
      command: process.execPath,
      args: [FIXTURE_AGENT],
    });

    const result = await executor.execute(revision, bundle, { prompt: "Missing host" });

    expect(result.exitCode).toBe(1);
    expect(result.errorOutput).toContain("could not start");
  });
});

// The macOS bridge resolves its launchd service only from inside the dev .app.
const NSXPC_BRIDGE = resolve(
  here,
  "../../better-harness-desktop/dist/native/Harness ACP.app/Contents/MacOS/harness-acp-client",
);

describe.skipIf(process.platform !== "darwin")("AcpRustExecutor over NSXPC", () => {
  it("runs a prompt session through the launchd service and stamps the nsxpc profile", async () => {
    const { bundle, revision } = await revisionUnderTest();
    const executor = new AcpRustExecutor({
      hostExecutable: NSXPC_BRIDGE,
      transport: "nsxpc",
      command: process.execPath,
      args: [FIXTURE_AGENT],
      requestPermission: approveFirstOption(),
    });

    const result = await executor.execute(revision, bundle, { prompt: "Prove the NSXPC route" });

    expect(result).toMatchObject({
      host: "acp",
      exitCode: 0,
      output: "fixture:allow-once",
      runtimeReceipt: { executor: "harness-acp-host", runtimeProfile: "acp-v1-nsxpc" },
      metrics: { sessionId: "fixture-session", stopReason: "end_turn" },
    });
    // The permission round trip and the redacted trace must survive the XPC hop.
    const serialized = JSON.stringify(result.trace);
    expect(serialized).not.toContain("fixture-secret");
    expect(serialized).toContain("[REDACTED]");
  });

  it("refuses a stdio host when NSXPC was required instead of silently downgrading", async () => {
    const { bundle, revision } = await revisionUnderTest();
    const executor = new AcpRustExecutor({
      // The plain driver never emits the `transport` proof frame.
      hostExecutable: HOST_EXECUTABLE,
      transport: "nsxpc",
      command: process.execPath,
      args: [FIXTURE_AGENT],
      requestPermission: approveFirstOption(),
    });

    const result = await executor.execute(revision, bundle, { prompt: "Should not run" });

    expect(result.exitCode).toBe(1);
    expect(result.errorOutput).toContain("stdio fallback");
  });
});

it.each([
  { transport: "stdio" as const, executable: HOST_EXECUTABLE },
  ...(process.platform === "darwin" ? [{ transport: "nsxpc" as const, executable: NSXPC_BRIDGE }] : []),
])("preserves rich transcript order and native tool fields through $transport", async ({ transport, executable }) => {
  const { bundle, revision } = await revisionUnderTest();
  const events: HarnessRunEvent[] = [];
  const result = await new AcpRustExecutor({
    hostExecutable: executable, transport, command: process.execPath,
    args: [FIXTURE_AGENT, "--session-stream"],
    requestPermission: approveFirstOption(), onRunEvent: (event) => events.push(event),
  }).execute(revision, bundle, { prompt: "Inspect rich stream" });
  expect(result.exitCode).toBe(0);
  expect(events.flatMap((event) => event.type === "message-started" ? [event.role ?? "assistant"] : event.type === "tool-call-started" ? ["tool"] : [])).toEqual(["tool", "assistant", "thought", "tool", "assistant", "tool", "assistant"]);
  expect(events.find((event) => event.type === "tool-call-started" && event.toolCallId === "read-stream")).toMatchObject({ toolCallId: "read-stream" });
  const output = events.find((event) => event.type === "tool-call-result");
  expect(output?.type === "tool-call-result" ? JSON.parse(output.content) : undefined).toEqual({ files: ["fixture.txt"], verified: true });
  expect(result.output).not.toContain("Inspecting the evidence.");
  expect(result.output).toContain("stream:complete");
  expect(events.some((event) => event.type === "protocol-event" && event.method === "session/request_permission" && event.permissionActionable === false)).toBe(true);
});


it.each([
  { transport: "stdio" as const, executable: HOST_EXECUTABLE },
  ...(process.platform === "darwin" ? [{ transport: "nsxpc" as const, executable: NSXPC_BRIDGE }] : []),
])("applies full live session configuration before prompt through $transport", async ({ transport, executable }) => {
  const { bundle, revision } = await revisionUnderTest();
  const readiness: boolean[] = [];
  const result = await new AcpRustExecutor({
    hostExecutable: executable, transport, command: process.execPath,
    args: [FIXTURE_AGENT, "--session-controls"], requestPermission: approveFirstOption(),
    onSessionReady: async (control) => {
      readiness.push(control !== undefined);
      if (!control) return;
      expect(await control.setConfigOption("model", "fixture-candidate")).toMatchObject({ configOptions: expect.arrayContaining([expect.objectContaining({ id: "effort", currentValue: "medium" })]) });
      await control.setConfigOption("effort", "low");
      await control.setConfigOption("fast", true);
    },
  }).execute(revision, bundle, { prompt: "Use the configured model" });
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("configured:fixture-candidate:low:true");
  expect(readiness).toEqual([true, false]);
});


it.each([
  { transport: "stdio" as const, executable: HOST_EXECUTABLE },
  ...(process.platform === "darwin" ? [{ transport: "nsxpc" as const, executable: NSXPC_BRIDGE }] : []),
])("preserves rich content and applies legacy mode through $transport", async ({ transport, executable }) => {
  const { bundle, revision } = await revisionUnderTest();
  const events: HarnessRunEvent[] = [];
  const result = await new AcpRustExecutor({
    hostExecutable: executable, transport, command: process.execPath,
    args: [FIXTURE_AGENT, "--rich-content", "--legacy-modes"], requestPermission: approveFirstOption(),
    onRunEvent: (event) => events.push(event), onSessionReady: async (control) => { await control?.setMode("plan"); },
  }).execute(revision, bundle, { prompt: "Render rich evidence" });
  expect(result.exitCode).toBe(0);
  expect(events.filter((event) => event.type === "message-content")).toHaveLength(4);
  expect(events.find((event) => event.type === "message-started" && event.role === "user")).toBeDefined();
  expect(events.filter((event) => event.type === "tool-call-started")).toHaveLength(2);
  expect(result.output).toContain("**Rich content**");
});
