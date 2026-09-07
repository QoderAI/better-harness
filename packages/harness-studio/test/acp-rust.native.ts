import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { HARNESS_RUN_REQUEST_KIND, type HarnessRunStreamEventV1 } from "@qoder-ai/harness/protocol";
import { startHarnessStudioServer, type StartedHarnessStudioServer } from "../src/server/server.js";
import { decodeSseStream } from "./sse-test-utils.js";

const here = dirname(fileURLToPath(import.meta.url));
const HOST_EXECUTABLE = resolve(
  here,
  "../../better-harness-desktop/dist/native",
  process.platform === "win32" ? "harness-acp-host.exe" : "harness-acp-host",
);
const ACP_AGENT_FIXTURE = resolve(here, "../../harness/test/fixtures/acp-agent.mjs");

function runRequest(threadId: string, runId: string, prompt: string): string {
  return JSON.stringify({ kind: HARNESS_RUN_REQUEST_KIND, threadId, runId, prompt });
}

describe("Harness Studio Rust ACP route", () => {
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
      acpHostExecutable: HOST_EXECUTABLE,
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
      acpRuntimeProfile: "acp-v1-rust",
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
