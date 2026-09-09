import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  EVIDENCE_HOST_PROTOCOL_VERSION,
  createRustEvidenceHost,
} from "../src/server/workspace/rust-evidence-provider.js";

function fakeHostProcess(onRequest: (request: { id: number; method: string }) => object | void) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    killed: boolean;
    kill: () => void;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4321;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit("exit", 0);
  };
  child.stdin.on("data", (chunk: Buffer | string) => {
    const line = String(chunk).trim();
    if (!line) return;
    const request = JSON.parse(line) as { id: number; method: string };
    const result = onRequest(request);
    if (result !== undefined) {
      child.stdout.write(`${JSON.stringify({ version: 1, id: request.id, result })}\n`);
    }
  });
  return child;
}

describe("Rust evidence host client", () => {
  it("routes Memory calls through the injected native transport", async () => {
    const methods: string[] = [];
    const child = fakeHostProcess(request => { methods.push(request.method); return { native: true }; });
    const host = createRustEvidenceHost({ executable: "/native/host", spawnProcess: () => child as never });
    await expect(host.discoverMemory({ workspace: "/project" })).resolves.toEqual({ native: true });
    await expect(host.readMemory({ id: "document", scope: "project" })).resolves.toEqual({ native: true });
    expect(methods).toEqual(["memory.discover", "memory.read"]);
    await host.close();
  });

  it("rejects a timed out Memory call rather than leaving its promise pending", async () => {
    const child = fakeHostProcess(() => undefined);
    const host = createRustEvidenceHost({ executable: "/native/host", timeoutMs: 10, spawnProcess: () => child as never });
    await expect(host.discoverMemory({})).rejects.toThrow("timed out");
    expect(child.killed).toBe(true);
    await host.close();
  });
  it("describes the evidence protocol over stdio", async () => {
    const child = fakeHostProcess((request) => {
      if (request.method === "host.describe") {
        return { protocol: EVIDENCE_HOST_PROTOCOL_VERSION, pid: 99, platforms: ["grok", "qoder"] };
      }
      if (request.method === "shutdown") return { status: "shutting-down" };
      return undefined;
    });
    const host = createRustEvidenceHost({
      executable: "/native/harness-evidence-host",
      transport: "stdio",
      timeoutMs: 1_000,
      spawnProcess: () => child as never,
    });
    await expect(host.describe()).resolves.toMatchObject({
      protocol: EVIDENCE_HOST_PROTOCOL_VERSION,
      platforms: ["grok", "qoder"],
    });
    await host.close();
    expect(child.killed).toBe(true);
  });

  it("refuses a stdio host when NSXPC was required", async () => {
    const child = fakeHostProcess((request) => {
      if (request.method === "host.describe") {
        return { protocol: EVIDENCE_HOST_PROTOCOL_VERSION, pid: 99, platforms: ["grok"] };
      }
      return undefined;
    });
    const host = createRustEvidenceHost({
      executable: "/native/harness-evidence-client",
      transport: "nsxpc",
      timeoutMs: 200,
      spawnProcess: () => child as never,
    });
    await expect(host.describe()).rejects.toThrow(/NSXPC/);
  });
});
