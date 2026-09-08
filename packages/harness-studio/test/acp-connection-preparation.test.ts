import { expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { AcpConnectionPreparation } from "../src/server/acp-connection-preparation.js";

it("only restores discovered project sessions and forwards opaque pagination", async () => {
  const cwd = resolve(".");
  const connection = { canListSessions: true, recovery: "load" as const, authMethods: [], authenticate: vi.fn(), listSessions: vi.fn()
    .mockResolvedValueOnce({ sessions: [{ sessionId: "current", cwd }, { sessionId: "foreign", cwd: resolve("..") }], nextCursor: "opaque+/==" })
    .mockResolvedValueOnce({ sessions: [{ sessionId: "older", cwd }] }) };
  const preparation = new AcpConnectionPreparation(connection, cwd, new AbortController().signal);
  const pending = preparation.wait();
  await expect(preparation.act({ action: "connection-select", sessionId: "forged" })).rejects.toThrow("Select a restorable");
  expect(await preparation.act({ action: "connection-list" })).toEqual({ sessions: [{ sessionId: "current", cwd }], nextCursor: "opaque+/==" });
  await expect(preparation.act({ action: "connection-select", sessionId: "foreign" })).rejects.toThrow("Select a restorable");
  await expect(preparation.act({ action: "connection-list", cursor: "forged" })).rejects.toThrow("cursor");
  await preparation.act({ action: "connection-list", cursor: "opaque+/==" });
  expect(connection.listSessions).toHaveBeenLastCalledWith({ cwd, cursor: "opaque+/==" });
  await preparation.act({ action: "connection-select", sessionId: "older" });
  expect(await pending).toEqual({ sessionId: "older", method: "load" });
  await expect(preparation.act({ action: "connection-list" })).rejects.toThrow("no longer available");
});

it("keeps authentication errors retryable and releases preparation on abort", async () => {
  const abort = new AbortController();
  const authenticate = vi.fn().mockRejectedValueOnce(new Error("login failed")).mockResolvedValue({});
  const preparation = new AcpConnectionPreparation({ canListSessions: false, authMethods: [], authenticate, listSessions: vi.fn() }, resolve("."), abort.signal);
  const pending = preparation.wait();
  await expect(preparation.act({ action: "connection-authenticate", methodId: "login" })).rejects.toThrow("login failed");
  await expect(preparation.act({ action: "connection-authenticate", methodId: "login" })).resolves.toEqual({ authenticated: true });
  const rejected = expect(pending).rejects.toThrow("cancelled"); abort.abort(); await rejected;
  await expect(preparation.act({ action: "connection-select" })).rejects.toThrow("no longer available");
});
