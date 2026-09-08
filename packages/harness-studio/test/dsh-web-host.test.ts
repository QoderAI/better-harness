import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDshWebHost, dshReadyUrl, type DshWebHost } from "../src/server/dsh-web-host.js";
const fixture = fileURLToPath(new URL("./fixtures/dsh-web.mjs", import.meta.url));
let host: DshWebHost | undefined;
let directory: string | undefined;
afterEach(async () => { await host?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });
async function setup(mode = "ready", startupTimeoutMs = 3000) {
  directory = await realpath(await mkdtemp(join(tmpdir(), "studio-dsh-host-")));
  host = createDshWebHost({ command: process.execPath, args: [fixture, mode] }, { startupTimeoutMs });
  return host;
}
describe("official DSH Web application lifecycle", () => {
  it("reuses one process across concurrent opens and Project directories, then stops its endpoint", async () => {
    const h = await setup();
    expect(h.state()).toEqual({ status: "stopped" });
    const [first, second] = await Promise.all([h.open(directory!), h.open(tmpdir())]);
    expect(first.status).toBe("ready"); expect(second).toEqual(first);
    const response = await fetch(first.url!);
    expect(await response.json()).toEqual({ cwd: directory, argv: ["--profile", "web", "--no-open", "--host", "127.0.0.1", "--port", "0"] });
    await h.stop(); expect(h.state()).toEqual({ status: "stopped" });
    await expect(fetch(first.url!)).rejects.toThrow();
    const reopened = await h.open(directory!); expect(reopened.status).toBe("ready");
    await h.close(); await expect(fetch(reopened.url!)).rejects.toThrow();
    await expect(h.open(directory!)).rejects.toThrow("shutting down");
  });
  for (const mode of ["exit", "hang", "oversize"]) it(`settles ${mode} startup and permits a bounded retry`, async () => {
    const h = await setup(mode, 300);
    const first = await h.open(directory!); expect(first.status).toBe("error"); expect(first.url).toBeUndefined();
    const retried = await Promise.all([h.open(directory!), h.open(directory!)]);
    expect(retried.every(value => value.status === "error")).toBe(true);
    await h.stop(); expect(h.state().status).toBe("stopped");
  });
  it("reports a running host's death and forgets its launch credential", async () => {
    const h = await setup("crash");
    expect((await h.open(directory!)).status).toBe("ready");
    await vi.waitFor(() => expect(h.state().status).toBe("error"));
    expect(h.state().url).toBeUndefined();
  });
  it("handles spawn errors without exposing executable paths or diagnostics", async () => {
    const h = await setup(); await h.close();
    host = createDshWebHost({ command: join(directory!, "missing-secret-executable") });
    expect(await host.open(directory!)).toEqual({ status: "error", error: "Could not launch DSH Web. Check its executable and web profile." });
  });
  it("only admits the native tokenized loopback readiness URL", () => {
    expect(dshReadyUrl("dsh web: http://127.0.0.1:1234/?token=abc")).toBe("http://127.0.0.1:1234/?token=abc");
    for (const line of ["http://127.0.0.1:1234/?token=abc", "dsh web: https://evil.test/?token=abc", "dsh web: http://user@127.0.0.1:1234/?token=abc", "dsh web: http://127.0.0.1:1234/", "dsh web: http://127.0.0.1:1234/api?token=abc"]) expect(dshReadyUrl(line)).toBeUndefined();
  });
});
