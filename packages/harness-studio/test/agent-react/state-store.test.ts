import { describe, expect, it, vi } from "vitest";
import { createObservationBridge } from "../../src/agent-react/host/observation-bridge.js";
import { createArtifactStateStore, type StateSchema } from "../../src/agent-react/host/state-store.js";

const ordersV1: StateSchema = {
  name: "orders",
  version: 1,
  initial: { items: [] as unknown[] },
  validate: (value) => (isRecord(value) && Array.isArray(value.items) ? true : "Orders v1 needs an items array."),
};

const ordersV2: StateSchema = {
  name: "orders",
  version: 2,
  initial: { rows: [] as unknown[], total: 0 },
  validate: (value) =>
    isRecord(value) && Array.isArray(value.rows) && typeof value.total === "number"
      ? true
      : "Orders v2 needs rows and a numeric total.",
  migrate: (value) => {
    const items = isRecord(value) && Array.isArray(value.items) ? value.items : [];
    return { rows: items, total: items.length };
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function store(version = 1) {
  const observations = createObservationBridge();
  const state = createArtifactStateStore({
    declarations: [{ path: "/orders", schema: "orders", version }],
    schemas: [ordersV1, ordersV2],
    observations,
  });
  return { state, observations };
}

describe("ArtifactStateStore (AR-AC-8)", () => {
  it("initializes every declared path from its bound schema", () => {
    const { state } = store();

    expect(state.get("/orders")).toEqual({ items: [] });
    expect(state.declaredSchema("/orders")?.version).toBe(1);
  });

  it("refuses to bind a schema the Host does not provide", () => {
    expect(() => createArtifactStateStore({
      declarations: [{ path: "/orders", schema: "orders", version: 9 }],
      schemas: [ordersV1],
    })).toThrow(/does not provide/);
  });

  it("returns a frozen snapshot that later writes do not mutate", () => {
    const { state } = store();
    const before = state.snapshot();

    expect(Object.isFrozen(before)).toBe(true);
    expect(state.set("/orders", { items: [1, 2] })).toEqual({ ok: true });
    expect(before["/orders"]).toEqual({ items: [] });
    expect(state.snapshot()["/orders"]).toEqual({ items: [1, 2] });
  });

  it("freezes nested values so a staging frame cannot mutate what it reads", () => {
    const { state } = store();
    state.set("/orders", { items: [{ id: "a" }] });

    const value = state.get("/orders") as { items: { id: string }[] };

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.items)).toBe(true);
    expect(Object.isFrozen(value.items[0])).toBe(true);
  });

  it("takes an owned copy even when the caller shallow-freezes the outer value", () => {
    const { state } = store();
    const source = Object.freeze({ items: [{ id: "a" }] });

    expect(state.set("/orders", source)).toEqual({ ok: true });
    source.items[0]!.id = "mutated";

    expect(state.get("/orders")).toEqual({ items: [{ id: "a" }] });
    expect(state.get("/orders")).not.toBe(source);
  });

  it("rejects state shapes that cannot stay immutable across a frame boundary", () => {
    const { state, observations } = store();
    const cyclic: { items: unknown[] } = { items: [] };
    cyclic.items.push(cyclic);

    const cycle = state.set("/orders", cyclic);
    const exotic = state.set("/orders", { items: [], generatedAt: new Date() });

    expect(cycle).toMatchObject({ ok: false });
    expect(exotic).toMatchObject({ ok: false });
    expect(state.get("/orders")).toEqual({ items: [] });
    expect(observations.recorded().map((event) => event.kind)).toEqual([
      "stateValidationFailed",
      "stateValidationFailed",
    ]);
  });

  it("rejects an invalid write, keeps the previous value, and observes the failure", () => {
    const { state, observations } = store();
    state.set("/orders", { items: [1] });

    const result = state.set("/orders", { items: "not-an-array" });

    expect(result).toEqual({ ok: false, reason: "Orders v1 needs an items array." });
    expect(state.get("/orders")).toEqual({ items: [1] });
    expect(observations.recorded()).toEqual([{
      kind: "stateValidationFailed",
      sequence: 1,
      detail: { path: "/orders", schema: "orders", version: 1, reason: "Orders v1 needs an items array." },
    }]);
  });

  it("rejects a write to an undeclared path", () => {
    const { state } = store();

    expect(state.set("/unknown", 1)).toEqual({
      ok: false,
      reason: "State path '/unknown' is not declared by this Artifact View.",
    });
  });

  it("notifies only the subscribers of the written path", () => {
    const { state } = store();
    const listener = vi.fn();
    const unsubscribe = state.subscribe("/orders", listener);

    state.set("/orders", { items: [1] });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    state.set("/orders", { items: [1, 2] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("migrates a path forward and notifies subscribers", () => {
    const { state } = store();
    state.set("/orders", { items: [{ id: "a" }, { id: "b" }] });
    const listener = vi.fn();
    state.subscribe("/orders", listener);

    expect(state.migrate("/orders", ordersV2)).toEqual({ ok: true });
    expect(state.get("/orders")).toEqual({ rows: [{ id: "a" }, { id: "b" }], total: 2 });
    expect(state.declaredSchema("/orders")?.version).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("refuses a migration that changes schema name or moves backwards", () => {
    const { state } = store(2);

    expect(state.migrate("/orders", ordersV1)).toEqual({
      ok: false,
      reason: "State path '/orders' is already at version 2.",
    });
    expect(state.migrate("/orders", { ...ordersV1, name: "invoices", version: 3 })).toEqual({
      ok: false,
      reason: "State path '/orders' cannot change schema from 'orders' to 'invoices'.",
    });
  });

  it("refuses a migration whose result fails the new schema", () => {
    const { state, observations } = store();
    const broken: StateSchema = { ...ordersV2, migrate: () => ({ rows: "no" }) };

    expect(state.migrate("/orders", broken)).toEqual({
      ok: false,
      reason: "Orders v2 needs rows and a numeric total.",
    });
    expect(state.get("/orders")).toEqual({ items: [] });
    expect(observations.recorded().map((event) => event.kind)).toEqual(["stateValidationFailed"]);
  });
});
