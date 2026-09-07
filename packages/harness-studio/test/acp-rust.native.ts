import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { HARNESS_RUN_REQUEST_KIND, type HarnessRunStreamEventV1 } from "@qoder-ai/harness/protocol";
import { startHarnessStudioServer, type StartedHarnessStudioServer } from "../src/server/server.js";
import { decodeSseStream } from "./sse-test-utils.js";

const here = dirname(fileURLToPath(import.meta.url));
const nativeDir = resolve(here, "../../better-harness-desktop/dist/native");
const STDIO_HOST = join(nativeDir, process.platform === "win32" ? "harness-acp-host.exe" : "harness-acp-host");
// The NSXPC bridge only resolves its launchd service from inside the dev .app.
const NSXPC_BRIDGE = join(nativeDir, "Harness ACP.app", "Contents", "MacOS", "harness-acp-client");
const ACP_AGENT_FIXTURE = resolve(here, "../../harness/test/fixtures/acp-agent.mjs");

const transports = [
  { transport: "stdio" as const, executable: STDIO_HOST, profile: "acp-v1-rust" as const },
  ...(process.platform === "darwin"
    ? [{ transport: "nsxpc" as const, executable: NSXPC_BRIDGE, profile: "acp-v1-nsxpc" as const }]
    : []),
];

function runRequest(threadId: string, runId: string, prompt: string): string {
  return JSON.stringify({ kind: HARNESS_RUN_REQUEST_KIND, threadId, runId, prompt });
}

describe.each(transports)("Harness Studio Rust ACP route ($transport)", ({ transport, executable, profile }) => {
  let started: StartedHarnessStudioServer | undefined;
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await started?.close();
    started = undefined;
    await Promise.all(temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })));
  });

  it("streams a Rust-hosted ACP run through the unchanged permission endpoint", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "studio-acp-rust-app-"));
    const workspace = await mkdtemp(join(tmpdir(), "studio-acp-rust-workspace-"));
    temporaryDirectories.push(appDir, workspace);
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>Studio native test</title>");

    started = await startHarnessStudioServer({
      appDir,
      acpHostExecutable: executable,
      acpHostTransport: transport,
      workspaceDirectoryPicker: async () => workspace,
      workspaceSessionProvider: {
        discover: async () => ({ label: "rust-acp-project", sessions: [] }),
      },
      acpAgent: {
        command: process.execPath,
        args: [ACP_AGENT_FIXTURE],
        label: "Fixture ACP via Rust",
      },
    });

    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({
      acpEnabled: true,
      acpAgentLabel: "Fixture ACP via Rust",
      acpRuntimeProfile: profile,
    });
    await fetch(`${started.url}/api/workspace/open`, { method: "POST" });
    const catalog = await (await fetch(`${started.url}/api/projects`)).json() as {
      activeProjectId: string;
      revision: number;
    };

    const runId = "rust-acp-route";
    const response = await fetch(`${started.url}/api/acp/runs/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Harness-Project-Id": catalog.activeProjectId,
        "X-Harness-Project-Revision": String(catalog.revision),
      },
      body: runRequest("rust-acp-thread", runId, "prove the Rust route"),
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
      const permission = decodeSseStream<HarnessRunStreamEventV1>(body).find((entry) =>
        entry.event.type === "protocol-event"
          && entry.event.method === "session/request_permission"
          // The host UUID is a standard UUID, unlike the Agent's numeric wire id.
          && typeof entry.event.rpcId === "string"
          && entry.event.rpcId.includes("-"));
      if (permission?.event.type === "protocol-event") permissionRequestId = permission.event.rpcId;
    }

    const decision = await fetch(
      `${started.url}/api/acp/runs/${runId}/permissions/${permissionRequestId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId: "allow-once" }),
      },
    );
    expect(decision.status).toBe(200);

    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    const events = decodeSseStream<HarnessRunStreamEventV1>(body);
    expect(events).toContainEqual(expect.objectContaining({
      event: expect.objectContaining({ type: "text-delta", text: "fixture:allow-once" }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      event: expect.objectContaining({
        type: "run-finished",
        exitCode: 0,
        metrics: expect.objectContaining({ stopReason: "end_turn" }),
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      event: expect.objectContaining({
        type: "protocol-event",
        protocol: "acp",
        method: "session/prompt",
      }),
    }));
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("fixture-secret");
    expect(serialized).toContain("[REDACTED]");

    // close() must wait for the host and Agent to release their cwd. Windows
    // reports EBUSY here when either child is only signalled rather than reaped.
    await started.close();
    started = undefined;
    await expect(rm(workspace, { recursive: true })).resolves.toBeUndefined();
    temporaryDirectories.splice(temporaryDirectories.indexOf(workspace), 1);
  });
});

describe.skipIf(process.platform !== "darwin")("Apple NSXPC ACP transport requires a real service", () => {
  let started: StartedHarnessStudioServer | undefined;
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await started?.close();
    started = undefined;
    await Promise.all(temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })));
  });

  it("fails the run rather than falling back to stdio when the host is not the bridge", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "studio-acp-nsxpc-guard-app-"));
    const workspace = await mkdtemp(join(tmpdir(), "studio-acp-nsxpc-guard-ws-"));
    temporaryDirectories.push(appDir, workspace);
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>guard</title>");

    // The plain stdio driver never emits the `transport` proof frame, so a
    // client told NSXPC is mandatory must refuse it.
    started = await startHarnessStudioServer({
      appDir,
      acpHostExecutable: STDIO_HOST,
      acpHostTransport: "nsxpc",
      workspaceDirectoryPicker: async () => workspace,
      workspaceSessionProvider: { discover: async () => ({ label: "guard", sessions: [] }) },
      acpAgent: { command: process.execPath, args: [ACP_AGENT_FIXTURE], label: "guard" },
    });
    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({
      acpRuntimeProfile: "acp-v1-nsxpc",
    });
    await fetch(`${started.url}/api/workspace/open`, { method: "POST" });
    const catalog = await (await fetch(`${started.url}/api/projects`)).json() as {
      activeProjectId: string;
      revision: number;
    };

    const response = await fetch(`${started.url}/api/acp/runs/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Harness-Project-Id": catalog.activeProjectId,
        "X-Harness-Project-Revision": String(catalog.revision),
      },
      body: runRequest("guard-thread", "guard-run", "should not run"),
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    const events = decodeSseStream<HarnessRunStreamEventV1>(body);
    const finished = events.find((entry) => entry.event.type === "run-finished");
    expect(finished?.event).toMatchObject({ type: "run-finished", exitCode: 1 });
    expect(JSON.stringify(events)).toContain("stdio fallback");
  });
});
