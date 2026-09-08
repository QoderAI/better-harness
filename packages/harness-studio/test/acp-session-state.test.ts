import { describe, expect, it } from "vitest";
import { initialAcpSessionState, projectAcpSession } from "../src/app/run/acp-session-state.js";
import { applyHarnessRunEvent, initialRunState, timelineItems } from "../src/app/run/run-store.js";
import { HARNESS_RUN_STREAM_EVENT_KIND, parseHarnessRunStreamEventV1 } from "@qoder-ai/harness/protocol";
import type { HarnessProtocolEvent, HarnessRunEvent } from "@qoder-ai/harness/exec";

const update = (value: Record<string, unknown>): HarnessProtocolEvent => ({
  protocol: "acp", direction: "Agent → Client", method: "session/update",
  payload: { params: { sessionId: "s1", update: value } },
});
const envelope = (event: HarnessRunEvent, sequence: number) => ({ kind: HARNESS_RUN_STREAM_EVENT_KIND, threadId: "thread", runId: "run", sequence, event });
const protocol = (value: Record<string, unknown>): HarnessRunEvent => ({ type: "protocol-event", ...update(value) });

describe("ACP observation projection", () => {
  it("replaces plan and config snapshots, clears empty lists and applies partial title updates", () => {
    let state = initialAcpSessionState();
    state = projectAcpSession(state, update({ sessionUpdate: "plan", entries: [{ content: "Inspect", status: "pending", priority: "high" }] }));
    expect(state.plan).toEqual([{ content: "Inspect", status: "pending", priority: "high" }]);
    state = projectAcpSession(state, update({ sessionUpdate: "plan", entries: [] }));
    expect(state.plan).toEqual([]);
    state = projectAcpSession(state, update({ sessionUpdate: "config_option_update", configOptions: [{ id: "model", name: "Model", currentValue: "test" }] }));
    expect(state.config).toEqual([{ id: "model", name: "Model", value: "test", type: "unknown", choices: [] }]);
    state = projectAcpSession(state, update({ sessionUpdate: "config_option_update", configOptions: [] }));
    expect(state.config).toEqual([]);
    state = projectAcpSession(state, update({ sessionUpdate: "session_info_update", title: "A" }));
    state = projectAcpSession(state, update({ sessionUpdate: "session_info_update", updatedAt: "2026-09-08T00:00:00Z" }));
    expect(state.title).toBe("A");
    expect(projectAcpSession(state, update({ sessionUpdate: "session_info_update", title: null })).title).toBeUndefined();
  });

  it("projects reported usage, commands and mode, ignoring outbound and unrelated sessions", () => {
    let state = projectAcpSession(initialAcpSessionState(), update({ sessionUpdate: "usage_update", used: 0, size: 32000, cost: { amount: 0, currency: "USD" } }));
    expect(state.usage).toEqual({ used: 0, size: 32000, cost: { amount: 0, currency: "USD" } });
    state = projectAcpSession(state, update({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "Review" }] }));
    expect(state.commands).toEqual([{ name: "review", description: "Review" }]);
    state = projectAcpSession(state, update({ sessionUpdate: "current_mode_update", currentModeId: "plan" }));
    expect(state.mode).toBe("plan");
    expect(projectAcpSession(state, { ...update({ sessionUpdate: "current_mode_update", currentModeId: "code" }), direction: "Client → Agent" })).toBe(state);
    expect(projectAcpSession(state, { ...update({}), payload: { params: { sessionId: "other", update: { sessionUpdate: "plan", entries: [] } } } })).toBe(state);
    expect(projectAcpSession(state, update({ sessionUpdate: "available_commands_update", availableCommands: [] })).commands).toEqual([]);
  });

  it.each(["session/new:response", "response"])("reads initial identity/config through %s for Node and Rust", (method) => {
    const state = projectAcpSession(initialAcpSessionState(), { protocol: "acp", direction: "Agent → Client", method, payload: { result: { sessionId: "s1", modes: { currentModeId: "code" }, configOptions: [{ id: "model", name: "Model", currentValue: "m1" }] } } });
    expect(state).toMatchObject({ sessionId: "s1", mode: "code", config: [{ id: "model", value: "m1" }] });
  });

  it("retains earlier valid state and exposes malformed/truncated/unsupported observations", () => {
    const state = projectAcpSession(initialAcpSessionState(), update({ sessionUpdate: "usage_update", used: 10, size: 100 }));
    expect(projectAcpSession(state, update({ sessionUpdate: "usage_update", used: -1, size: "100" }))).toMatchObject({ usage: state.usage, partial: true });
    expect(projectAcpSession(state, { ...update({}), payload: { truncated: true, preview: "..." } }).partial).toBe(true);
    expect(projectAcpSession(state, update({ sessionUpdate: "plan_update" })).unsupported).toEqual(["plan_update"]);
    expect(projectAcpSession(state, update({ sessionUpdate: "agent_message_chunk", content: { type: "image" } })).partial).toBe(true);
  });

  it("merges partial tool updates without replacing earlier input with null", () => {
    let state = projectAcpSession(initialAcpSessionState(), update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Read" }));
    state = projectAcpSession(state, update({ sessionUpdate: "tool_call_update", toolCallId: "t1", rawInput: { path: "a.txt" } }));
    state = projectAcpSession(state, update({ sessionUpdate: "tool_call_update", toolCallId: "t1", rawInput: null, rawOutput: "done", status: "completed" }));
    expect(state.tools.get("t1")).toEqual({ title: "Read", input: { path: "a.txt" }, output: "done", status: "completed" });
  });
});

it("folds thoughts once, keeps separate responses and settles busy content on error", () => {
  const events: HarnessRunEvent[] = [
    { type: "run-started", revisionId: "r1", host: "acp" },
    { type: "message-started", messageId: "thought1", role: "thought" },
    { type: "text-delta", messageId: "thought1", text: "Inspect " },
    protocol({ sessionUpdate: "usage_update", used: 100, size: 1000 }),
    { type: "text-delta", messageId: "thought1", text: "files" },
    { type: "message-finished", messageId: "thought1" },
    protocol({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Response" } }),
    { type: "message-started", messageId: "m1" },
    { type: "text-delta", messageId: "m1", text: "Response" },
    { type: "run-error", message: "lost" },
  ];
  let state = events.map((event, index) => parseHarnessRunStreamEventV1(envelope(event, index + 1))).reduce(applyHarnessRunEvent, initialRunState());
  state = applyHarnessRunEvent(state, envelope(events[2]!, 2));
  expect(timelineItems(state)).toMatchObject([{ role: "thought", text: "Inspect files", complete: true }, { text: "Response", complete: true }]);
});

it("queues independent decisions, ignores native wire-only permission ids and clears terminal requests", () => {
  const permission = (id: string): HarnessRunEvent => ({ type: "protocol-event", protocol: "acp", direction: "Agent → Client", method: "session/request_permission", rpcId: id, payload: { params: { sessionId: "s1", toolCall: { toolCallId: id, title: id }, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }] } } });
  let state = initialRunState();
  const raw = { ...permission("wire"), permissionActionable: false };
  state = applyHarnessRunEvent(state, parseHarnessRunStreamEventV1(envelope(raw as HarnessRunEvent, 1)));
  expect(state.pendingPermissions).toEqual([]);
  state = applyHarnessRunEvent(state, envelope(permission("host1"), 2));
  state = applyHarnessRunEvent(state, envelope(permission("host2"), 3));
  expect(state.pendingPermission?.requestId).toBe("host1");
  state = applyHarnessRunEvent(state, envelope({ type: "protocol-event", protocol: "acp", direction: "Client → Agent", method: "session/request_permission:response", rpcId: "host1", payload: {} }, 4));
  expect(state.pendingPermission?.requestId).toBe("host2");
  state = applyHarnessRunEvent(state, envelope({ type: "run-finished", exitCode: 0 }, 5));
  expect(state.pendingPermission).toBeUndefined();
  expect(state.pendingPermissions).toEqual([]);
});
