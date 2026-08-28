import { describe, expect, it, vi } from "vitest";
import type { Digest } from "../../src/agent-react/contracts/index.js";
import { createActionGateway } from "../../src/agent-react/host/action-gateway.js";
import { createCapabilityBroker, createCapabilityPolicy } from "../../src/agent-react/host/capability.js";
import { createObservationBridge } from "../../src/agent-react/host/observation-bridge.js";

const BUILD: Digest = "sha256:build";
const DECLARED = { capabilities: ["orders.read", "orders.refresh", "orders.delete"] };

function host(options: { readonly approvals?: readonly string[] } = {}) {
  const policy = createCapabilityPolicy({
    allowedCapabilities: ["orders.read", "orders.refresh"],
    requiresApproval: ["orders.refresh"],
  });
  const broker = createCapabilityBroker({ policy, approvals: options.approvals });
  const observations = createObservationBridge();
  const gateway = createActionGateway({ broker, policy, observations, artifactDigest: "sha256:artifact" });
  return { policy, broker, observations, gateway };
}

describe("CapabilityBroker grants (AR-AC-7)", () => {
  it("grants the intersection of request, policy, and approval", () => {
    const { broker } = host({ approvals: ["orders.refresh"] });

    expect(broker.computeGrant(DECLARED)).toEqual({
      granted: ["orders.read", "orders.refresh"],
      refused: [{ capability: "orders.delete", reason: "not-in-policy" }],
    });
  });

  it("withholds a policy-allowed capability that is awaiting approval", () => {
    const { broker } = host();

    expect(broker.computeGrant(DECLARED)).toEqual({
      granted: ["orders.read"],
      refused: [
        { capability: "orders.delete", reason: "not-in-policy" },
        { capability: "orders.refresh", reason: "awaiting-approval" },
      ],
    });
  });

  it("grants a capability once it is approved and withdraws it again", () => {
    const { broker } = host();

    broker.approve("orders.refresh");
    expect(broker.computeGrant(DECLARED).granted).toEqual(["orders.read", "orders.refresh"]);

    broker.revokeApproval("orders.refresh");
    expect(broker.computeGrant(DECLARED).granted).toEqual(["orders.read"]);
  });

  it("deduplicates repeated requests", () => {
    const { broker } = host();

    expect(broker.computeGrant({ capabilities: ["orders.read", "orders.read"] }).granted).toEqual(["orders.read"]);
  });
});

describe("ActionGateway dispatch (AR-AC-7)", () => {
  it("runs a granted Action once in a live frame", async () => {
    const { broker, gateway } = host();
    const handler = vi.fn(() => "refreshed");
    gateway.register("orders.read", handler);
    const token = broker.issueFrameToken(BUILD, "live", broker.computeGrant(DECLARED));

    const outcome = await gateway.dispatch({ frameToken: token.token, capability: "orders.read", payload: { page: 1 } });

    expect(outcome).toEqual({ status: "completed", result: "refreshed" });
    expect(handler).toHaveBeenCalledExactlyOnceWith({ page: 1 });
  });

  it("records the attempt but never invokes the handler in a dry-run frame", async () => {
    const { broker, gateway, observations } = host();
    const handler = vi.fn();
    gateway.register("orders.read", handler);
    const token = broker.issueFrameToken(BUILD, "dry-run", broker.computeGrant(DECLARED));

    const outcome = await gateway.dispatch({ frameToken: token.token, capability: "orders.read" });

    expect(outcome).toEqual({ status: "dry-run" });
    expect(handler).not.toHaveBeenCalled();
    expect(observations.recorded().map((event) => event.kind)).toEqual(["actionAttempted"]);
  });

  it("denies every Action in a denied frame", async () => {
    const { broker, gateway } = host();
    gateway.register("orders.read", () => "never");
    const token = broker.issueFrameToken(BUILD, "denied", broker.computeGrant(DECLARED));

    const outcome = await gateway.dispatch({ frameToken: token.token, capability: "orders.read" });

    expect(outcome).toEqual({ status: "denied", reason: "Frame is not permitted to run Actions." });
  });

  it("denies an ungranted capability even though the code declared it", async () => {
    const { broker, gateway, observations } = host();
    gateway.register("orders.delete", () => "never");
    const token = broker.issueFrameToken(BUILD, "live", broker.computeGrant(DECLARED));

    const outcome = await gateway.dispatch({ frameToken: token.token, capability: "orders.delete" });

    expect(outcome).toEqual({ status: "denied", reason: "Capability 'orders.delete' is not currently granted to this frame." });
    expect(observations.recorded().map((event) => event.kind)).toEqual(["actionAttempted", "actionDenied"]);
  });

  it("denies an unknown capability", async () => {
    const { broker, gateway } = host();
    const token = broker.issueFrameToken(BUILD, "live", broker.computeGrant(DECLARED));

    const outcome = await gateway.dispatch({ frameToken: token.token, capability: "orders.export" });

    expect(outcome).toEqual({ status: "denied", reason: "Capability 'orders.export' is not currently granted to this frame." });
  });

  it("denies a revoked frame token for a previously granted capability", async () => {
    const { broker, gateway } = host();
    gateway.register("orders.read", () => "ok");
    const token = broker.issueFrameToken(BUILD, "live", broker.computeGrant(DECLARED));
    expect(await gateway.dispatch({ frameToken: token.token, capability: "orders.read" })).toEqual({
      status: "completed",
      result: "ok",
    });

    broker.revokeFrameToken(token.token);
    const outcome = await gateway.dispatch({ frameToken: token.token, capability: "orders.read" });

    expect(outcome).toEqual({ status: "denied", reason: "Frame token is unknown or has been revoked." });
  });

  it("applies approval revocation to tokens that were already issued", async () => {
    const { broker, gateway } = host({ approvals: ["orders.refresh"] });
    gateway.register("orders.refresh", () => "refreshed");
    const token = broker.issueFrameToken(BUILD, "live", broker.computeGrant(DECLARED));

    expect((await gateway.dispatch({ frameToken: token.token, capability: "orders.refresh" })).status).toBe("completed");
    broker.revokeApproval("orders.refresh");

    expect(await gateway.dispatch({ frameToken: token.token, capability: "orders.refresh" })).toEqual({
      status: "denied",
      reason: "Capability 'orders.refresh' is not currently granted to this frame.",
    });
  });

  it("fails closed when a custom token generator collides", () => {
    const policy = createCapabilityPolicy({ allowedCapabilities: ["orders.read"] });
    const broker = createCapabilityBroker({ policy, newToken: () => "duplicate" });
    const grant = broker.computeGrant({ capabilities: ["orders.read"] });
    broker.issueFrameToken(BUILD, "live", grant);

    expect(() => broker.issueFrameToken(BUILD, "live", grant)).toThrow(/duplicate token/);
  });

  it("denies an unknown frame token without recording an attempt", async () => {
    const { gateway, observations } = host();

    const outcome = await gateway.dispatch({ frameToken: "forged", capability: "orders.read" });

    expect(outcome).toEqual({ status: "denied", reason: "Frame token is unknown or has been revoked." });
    expect(observations.recorded().map((event) => event.kind)).toEqual(["actionDenied"]);
  });

  it("re-validates the payload through policy on every call", async () => {
    const policy = createCapabilityPolicy({
      allowedCapabilities: ["orders.read"],
      validate: (_capability, payload) => (typeof payload === "object" ? true : "Payload must be an object."),
    });
    const broker = createCapabilityBroker({ policy });
    const observations = createObservationBridge();
    const gateway = createActionGateway({ broker, policy, observations });
    gateway.register("orders.read", () => "ok");
    const token = broker.issueFrameToken(BUILD, "live", broker.computeGrant({ capabilities: ["orders.read"] }));

    expect(await gateway.dispatch({ frameToken: token.token, capability: "orders.read", payload: {} })).toEqual({
      status: "completed",
      result: "ok",
    });
    expect(await gateway.dispatch({ frameToken: token.token, capability: "orders.read", payload: 7 })).toEqual({
      status: "denied",
      reason: "Payload must be an object.",
    });
  });

  it("denies a granted capability that has no Host handler", async () => {
    const { broker, gateway } = host();
    const token = broker.issueFrameToken(BUILD, "live", broker.computeGrant(DECLARED));

    const outcome = await gateway.dispatch({ frameToken: token.token, capability: "orders.read" });

    expect(outcome).toEqual({ status: "denied", reason: "No Host handler is registered for 'orders.read'." });
  });

  it("reports a throwing handler as a runtime exception without leaking its message", async () => {
    const { broker, gateway, observations } = host();
    gateway.register("orders.read", () => {
      throw new Error("connection string postgres://secret@host");
    });
    const token = broker.issueFrameToken(BUILD, "live", broker.computeGrant(DECLARED));

    const outcome = await gateway.dispatch({ frameToken: token.token, capability: "orders.read" });

    expect(outcome).toEqual({ status: "denied", reason: "Action 'orders.read' failed in the Host." });
    expect(observations.recorded().map((event) => event.kind)).toEqual(["actionAttempted", "runtimeException"]);
  });
});
