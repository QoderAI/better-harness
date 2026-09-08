import { describe, expect, it } from "vitest";
import { parseAcpConfig, acceptsAcpConfig } from "../src/contracts/acp-session-config.js";
import { projectAcpSession, initialAcpSessionState } from "../src/app/run/acp-session-state.js";

describe("ACP configuration schema and observations", () => {
  it("retains grouped choices, booleans, categories and descriptions and rejects unoffered values", () => {
    const config = parseAcpConfig([
      { id: "model", name: "Model", type: "select", category: "model", description: "Choose model", currentValue: "a", options: [{ group: "provider", name: "Provider", options: [{ value: "a", name: "Model A", description: "Fast" }] }] },
      { id: "fast", name: "Fast mode", type: "boolean", currentValue: false },
      { id: "future", name: "Future", type: "unknown", currentValue: "default" },
    ])!;
    expect(config[0]).toMatchObject({ category: "model", description: "Choose model", choices: [{ value: "a", name: "Model A", description: "Fast", group: "Provider" }] });
    expect(acceptsAcpConfig(config[0]!, "a")).toBe(true);
    expect(acceptsAcpConfig(config[0]!, "invented")).toBe(false);
    expect(acceptsAcpConfig(config[1]!, true)).toBe(true);
    expect(acceptsAcpConfig(config[1]!, "true")).toBe(false);
    expect(acceptsAcpConfig(config[2]!, "default")).toBe(false);
  });
  it("replaces dependent options from a set response that has no sessionId", () => {
    const state = projectAcpSession(initialAcpSessionState(), { protocol: "acp", direction: "Agent → Client", method: "response", payload: { result: { configOptions: [{ id: "effort", name: "Reasoning effort", type: "select", currentValue: "low", options: [{ value: "low", name: "Low" }] }] } } });
    expect(state.config?.[0]?.value).toBe("low");
  });
  it("preserves tool content and locations across status-only updates, including empty snapshots", () => {
    const project = (state: ReturnType<typeof initialAcpSessionState>, update: unknown) => projectAcpSession(state, { protocol: "acp", direction: "Agent → Client", method: "session/update", payload: { params: { sessionId: "s", update } } });
    let state = project(initialAcpSessionState(), { sessionUpdate: "tool_call_update", toolCallId: "t", kind: "edit", content: [{ type: "diff", path: "x", oldText: "a", newText: "b" }], locations: [{ path: "x", line: 3 }] });
    state = project(state, { sessionUpdate: "tool_call_update", toolCallId: "t", status: "completed" });
    expect(state.tools.get("t")).toMatchObject({ kind: "edit", status: "completed", locations: [{ path: "x", line: 3 }], content: [{ type: "diff" }] });
    state = project(state, { sessionUpdate: "tool_call_update", toolCallId: "t", content: [], locations: [] });
    expect(state.tools.get("t")).toMatchObject({ content: [], locations: [] });
  });
});

it("retains terminal output after release and matches agent RPC ids", () => {
  let state = initialAcpSessionState();
  const apply = (direction: "Agent → Client" | "Client → Agent", method: string, rpcId: string, payload: unknown) => { state = projectAcpSession(state, { protocol: "acp", direction, method, rpcId, payload }); };
  apply("Agent → Client", "terminal/output", "output-1", { params: { sessionId: "s", terminalId: "t" } });
  apply("Client → Agent", "response", "output-1", { result: { output: "terminal evidence", truncated: true, exitStatus: { exitCode: 0 } } });
  apply("Agent → Client", "terminal/release", "release-1", { params: { sessionId: "s", terminalId: "t" } });
  apply("Client → Agent", "response", "release-1", { result: {} });
  expect(state.terminals?.get("t")).toEqual({ output: "terminal evidence", truncated: true, exitCode: 0, released: true });
  expect(state.terminalRequests?.size).toBe(0);
});

it("merges session info patches and explicitly clears nullable fields", () => {
  const apply = (state: ReturnType<typeof initialAcpSessionState>, update: unknown) => projectAcpSession(state, { protocol: "acp", direction: "Agent → Client", method: "session/update", payload: { params: { sessionId: "s", update } } });
  let state = apply(initialAcpSessionState(), { sessionUpdate: "session_info_update", title: "Title", updatedAt: "2026-09-08T00:00:00Z" });
  state = apply(state, { sessionUpdate: "session_info_update", title: "Renamed" });
  expect(state).toMatchObject({ title: "Renamed", updatedAt: "2026-09-08T00:00:00Z" });
  state = apply(state, { sessionUpdate: "session_info_update", title: null, updatedAt: null });
  expect(state.title).toBeUndefined();
  expect(state.updatedAt).toBeUndefined();
});
