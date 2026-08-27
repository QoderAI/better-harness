import { describe, expect, it } from "vitest";
import {
  grantedAgentReactCapabilities,
  isAgentReactFrameRequest,
  stageAgentReactState,
  validateAgentReactStateValue,
  type AgentReactStateSlot,
} from "../../src/app/artifacts/AgentReactHostServices.js";

describe("AgentReact Host services", () => {
  it("retains state only across an exact schema and version match", () => {
    const current = new Map<string, AgentReactStateSlot>([
      ["/orders", { schema: "list", version: 1, value: ["A-1"] }],
      ["/stale", { schema: "record", version: 1, value: { kept: false } }],
    ]);
    const staged = stageAgentReactState([
      { path: "/orders", schema: "list", version: 1 },
      { path: "/stale", schema: "list", version: 1 },
      { path: "/options", schema: "record", version: 1 },
    ], current);

    expect(staged.values).toEqual({ "/orders": ["A-1"], "/stale": [], "/options": {} });
    expect(staged.values["/orders"]).not.toBe(current.get("/orders")?.value);
  });

  it.each([
    ["list", [1, "two", null]],
    ["record", { enabled: true, count: 2 }],
    ["json", { nested: [1, 2] }],
  ])("accepts bounded %s@1 JSON state", (schema, value) => {
    expect(validateAgentReactStateValue(schema, 1, value)).toEqual({ ok: true, value });
  });

  it.each([
    ["list", 1, {}, "requires an array"],
    ["record", 1, [], "requires an object"],
    ["custom", 1, null, "is not provided"],
    ["json", 2, null, "is not provided"],
    ["json", 1, Number.NaN, "finite JSON"],
    ["json", 1, { value: undefined }, "finite JSON"],
  ])("refuses invalid %s@%s values", (schema, version, value, reason) => {
    expect(validateAgentReactStateValue(schema, version, value)).toEqual({ ok: false, reason: expect.stringContaining(reason) });
  });

  it("grants only the explicit Host action and deduplicates requests", () => {
    expect(grantedAgentReactCapabilities([
      "orders.delete",
      "studio.show-source",
      "studio.show-source",
    ])).toEqual(["studio.show-source"]);
  });

  it("accepts only correlated, positive-id state and action requests", () => {
    expect(isAgentReactFrameRequest({
      type: "state.set",
      buildDigest: "sha256:build",
      frameToken: "frame",
      requestId: 1,
      path: "/orders",
      value: [],
    })).toBe(true);
    expect(isAgentReactFrameRequest({
      type: "action.request",
      buildDigest: "sha256:build",
      frameToken: "frame",
      requestId: 0,
    })).toBe(false);
    expect(isAgentReactFrameRequest({
      type: "runtime.promote",
      buildDigest: "sha256:build",
      frameToken: "frame",
      requestId: 1,
    })).toBe(false);
  });
});
