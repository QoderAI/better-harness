import { expect, it, vi } from "vitest";
import { createAcpConnectionControl } from "../src/exec/acp-connection-control.js";

it("rejects undeclared discovery and terminal/unknown authentication without transport calls", async () => {
  const transport = { list: vi.fn(), authenticate: vi.fn() };
  const { control } = createAcpConnectionControl({ authMethods: [{ id: "terminal", name: "Terminal", type: "terminal" }] }, transport);
  await expect(control.listSessions()).rejects.toThrow("does not support");
  await expect(control.authenticate("terminal")).rejects.toThrow("not supported");
  await expect(control.authenticate("unknown")).rejects.toThrow("not supported");
  expect(transport.list).not.toHaveBeenCalled();
  expect(transport.authenticate).not.toHaveBeenCalled();
});

it("preserves opaque cursors and rejects relative cwd before dispatch", async () => {
  const response = { sessions: [], nextCursor: "a+/==" };
  const transport = { list: vi.fn().mockResolvedValue(response), authenticate: vi.fn().mockRejectedValue(new Error("login failed")) };
  const { control, dispose } = createAcpConnectionControl({ agentCapabilities: { sessionCapabilities: { list: {} } }, authMethods: [{ id: "login", name: "Login" }] }, transport);
  await expect(control.listSessions({ cwd: "relative" })).rejects.toThrow("absolute");
  expect(transport.list).not.toHaveBeenCalled();
  expect(await control.listSessions({ cursor: "opaque+/==" })).toBe(response);
  expect(transport.list).toHaveBeenCalledWith({ cursor: "opaque+/==" });
  await expect(control.authenticate("login")).rejects.toThrow("login failed");
  dispose();
  await expect(control.listSessions()).rejects.toThrow("closed");
});

it("retries failed setup only after an explicit host selection", async () => {
  const { prepareAcpSession } = await import("../src/exec/acp-connection-control.js");
  const { control } = createAcpConnectionControl({}, { list: vi.fn(), authenticate: vi.fn() });
  const create = vi.fn().mockRejectedValueOnce(new Error("auth required")).mockResolvedValue({ sessionId: "new" });
  const handler = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(null);
  expect(await prepareAcpSession(control, handler, undefined, create)).toEqual({ value: { sessionId: "new" }, recovery: undefined });
  expect(handler).toHaveBeenLastCalledWith(control, { error: "auth required" });
  const failure = vi.fn().mockRejectedValue(new Error("invalid session"));
  await expect(prepareAcpSession(control, async () => undefined, undefined, failure)).rejects.toThrow("invalid session");
  expect(failure).toHaveBeenCalledTimes(1);
});
