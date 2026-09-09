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

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number;
  killed: boolean;
  kill: () => void;
}

/**
 * Mirrors the real hosts, which read and answer one line at a time. A stalled
 * host never answers and never releases its queue, exactly like a native call
 * that cannot be interrupted.
 */
function serialHostProcess(options: { workMs?: number; stall?: boolean } = {}): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4321;
  child.killed = false;
  child.kill = () => { if (child.killed) return; child.killed = true; child.emit("exit", 0); };
  let busy = Promise.resolve();
  child.stdin.on("data", (chunk: Buffer | string) => {
    for (const line of String(chunk).split("\n")) {
      if (!line.trim()) continue;
      const request = JSON.parse(line) as { id: number; method: string };
      busy = busy.then(() => new Promise<void>((done) => {
        setTimeout(() => {
          if (options.stall) return;
          if (!child.killed) child.stdout.write(`${JSON.stringify({ version: 1, id: request.id, result: { method: request.method } })}\n`);
          done();
        }, options.workMs ?? 0);
      }));
    }
  });
  return child;
}

describe("Rust evidence host queueing", () => {
  it("measures each deadline against host work rather than queue depth", async () => {
    const child = serialHostProcess({ workMs: 60 });
    const host = createRustEvidenceHost({ executable: "/native/host", timeoutMs: 150, spawnProcess: () => child as never });
    const results = await Promise.all([host.discoverMemory({}), host.readMemory({}), host.discover({ workspace: "/project" })]);
    expect(results.map(result => result.method)).toEqual(["memory.discover", "memory.read", "sessions.discover"]);
    expect(child.killed).toBe(false);
    await host.close();
  });

  it("keeps queued requests alive when the in-flight request kills the host", async () => {
    let launches = 0;
    const spawned: FakeChild[] = [];
    const host = createRustEvidenceHost({
      executable: "/native/host",
      timeoutMs: 60,
      spawnProcess: () => { const child = serialHostProcess({ stall: ++launches === 1 }); spawned.push(child); return child as never; },
    });
    const stalled = host.discover({ workspace: "/project" });
    const queued = host.discoverMemory({});
    await expect(stalled).rejects.toThrow("timed out");
    await expect(queued).resolves.toEqual({ method: "memory.discover" });
    expect(launches).toBe(2);
    expect(spawned[0]?.killed).toBe(true);
    await host.close();
  });

  it("reaps the process that survives a restart during close", async () => {
    const spawned: FakeChild[] = [];
    let launches = 0;
    const host = createRustEvidenceHost({
      executable: "/native/host",
      timeoutMs: 60,
      spawnProcess: () => { const child = serialHostProcess({ stall: ++launches === 1 }); spawned.push(child); return child as never; },
    });
    const stalled = host.discover({ workspace: "/project" });
    const closing = host.close();
    await expect(stalled).rejects.toThrow("timed out");
    await closing;
    expect(spawned).toHaveLength(2);
    expect(spawned.map(child => child.killed)).toEqual([true, true]);
  });

  it("bounds restarts when the host cannot stay alive", async () => {
    let launches = 0;
    const host = createRustEvidenceHost({
      executable: "/native/host",
      timeoutMs: 1_000,
      spawnProcess: () => { launches++; const child = serialHostProcess(); queueMicrotask(() => child.kill()); return child as never; },
    });
    const settled = await Promise.allSettled([host.discoverMemory({}), host.readMemory({}), host.discover({ workspace: "/project" })]);
    expect(settled.map(result => result.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(launches).toBeLessThanOrEqual(2);
    await host.close();
  });
});

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
