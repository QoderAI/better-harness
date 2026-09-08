import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createPiTerminalHost, type PiTerminalHost } from "../src/server/pi-terminal-host.js";
const command = { command: process.execPath, args: [fileURLToPath(new URL("./fixtures/pi-terminal.mjs", import.meta.url))] };
let host: PiTerminalHost;
afterEach(async () => { await host?.close(); });
describe("native Pi terminal lifecycle", () => {
  it("reuses concurrent starts, streams output by cursor, and resizes the native terminal", async () => {
    host = createPiTerminalHost(command);
    const [first, second] = await Promise.all([host.open("project-a", process.cwd()), host.open("project-a", process.cwd())]);
    expect(first.id).toBe(second.id);
    await expect.poll(() => host.state("project-a").data).toContain("PI_FIXTURE_READY");
    const cursor = host.state("project-a").cursor;
    host.control("project-a", first.id!, { data: "draft", cols: 70, rows: 20 });
    await expect.poll(() => host.state("project-a", cursor).data).toContain("draft");
    await expect.poll(() => host.state("project-a", cursor).data).toContain("SIZE:70x20");
  });
  it("rejects stale session and Project input, and replaces only on explicit start", async () => {
    host = createPiTerminalHost(command);
    const first = await host.open("a", process.cwd());
    expect(host.state("b")).toEqual({ status: "stopped" });
    expect(() => host.control("b", first.id!, { data: "x" })).toThrow();
    expect(() => host.control("a", "stale", { data: "x" })).toThrow();
    const second = await host.open("b", process.cwd());
    expect(second.id).not.toBe(first.id);
    expect(() => host.control("a", first.id!, { data: "x" })).toThrow();
    await host.close();
    expect(host.state("b")).toEqual({ status: "stopped" });
    await expect(host.open("a", process.cwd())).rejects.toThrow("shutting down");
  });
  it("validates input limits and stops on bounded output overflow", async () => {
    host = createPiTerminalHost(command, { maxOutput: 1000 });
    const state = await host.open("a", process.cwd());
    await expect.poll(() => host.state("a").data).toContain("READY");
    expect(() => host.control("a", state.id!, { data: "x".repeat(16385) })).toThrow();
    expect(() => host.control("a", state.id!, { cols: 0, rows: 20 })).toThrow();
    host.control("a", state.id!, { data: "FLOOD" });
    await expect.poll(() => host.state("a").status).toBe("error");
    expect(host.state("a").data!.length).toBeLessThanOrEqual(1000);
    expect(() => host.control("a", state.id!, { data: "x" })).toThrow();
  });
  it("reports a native exit and allows a fresh explicit launch", async () => {
    host = createPiTerminalHost(command);
    const state = await host.open("a", process.cwd());
    await expect.poll(() => host.state("a").data).toContain("READY");
    host.control("a", state.id!, { data: "EXIT" });
    await expect.poll(() => host.state("a").status).toBe("error");
    expect((await host.open("a", process.cwd())).id).not.toBe(state.id);
  });
});
