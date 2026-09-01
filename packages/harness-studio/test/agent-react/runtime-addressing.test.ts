import { rm } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createBuildCoordinator } from "../../src/agent-react/host/build-coordinator.js";
import type { ArtifactRevision, BuildSnapshot } from "../../src/agent-react/contracts/index.js";
import { AgentStreamAssembler } from "../../src/agent-react/host/stream-assembler.js";
import { createSandboxFrameController } from "../../src/agent-react/host/frames/frame-controller.js";
import {
  createLocalFrameFactory,
  type ArtifactBundleModule,
  type LocalFrameHandle,
} from "../../src/agent-react/host/frames/local-frame-factory.js";
import { createActionGateway } from "../../src/agent-react/host/action-gateway.js";
import { createCapabilityBroker, createCapabilityPolicy } from "../../src/agent-react/host/capability.js";
import { createObservationBridge } from "../../src/agent-react/host/observation-bridge.js";
import { createArtifactStateStore } from "../../src/agent-react/host/state-store.js";
import { createOxcCompiler } from "../../src/agent-react/kernel/compiler.js";
import { ARTIFACT_NODE_ATTRIBUTE, instanceAddress } from "../../src/agent-react/contracts/addressing.js";
import { activeArtifactRuntime } from "../../src/agent-react/runtime/index.js";
import {
  BUNDLE_DIRECTORY,
  loadBundle,
  ORDERS_STATE_SCHEMA,
  ORDERS_VIEW_MODULE,
  revisionOf,
  STAT_ROW_MODULE,
  TEST_RUNTIME_PACKAGES,
} from "./pipeline-fixture.js";

afterAll(async () => {
  await rm(BUNDLE_DIRECTORY, { recursive: true, force: true });
});

async function buildOrders(revision: ArtifactRevision): Promise<BuildSnapshot> {
  const snapshot = await createBuildCoordinator({
    compiler: createOxcCompiler(),
    runtimePackages: TEST_RUNTIME_PACKAGES,
  }).build(revision);
  expect(snapshot.status).toBe("ready");
  return snapshot;
}

/** Verification Host wiring: the synchronous render proves linked address agreement. */
async function mountOrders(revision: ArtifactRevision, seedOrders?: readonly unknown[]) {
  const snapshot = await buildOrders(revision);
  const observations = createObservationBridge();
  const policy = createCapabilityPolicy({ allowedCapabilities: ["orders.read", "orders.refresh"] });
  const broker = createCapabilityBroker({ policy });
  const state = createArtifactStateStore({
    declarations: snapshot.viewDeclaration!.state,
    schemas: [ORDERS_STATE_SCHEMA],
    observations,
  });
  if (seedOrders !== undefined) expect(state.set("/orders", seedOrders)).toEqual({ ok: true });
  const gateway = createActionGateway({ broker, policy, observations, artifactDigest: snapshot.artifactDigest });
  const controller = createSandboxFrameController({
    frames: createLocalFrameFactory({ loadBundle, state, gateway, observations, renderToMarkup: renderToStaticMarkup }),
    broker,
    observations,
    state,
    allowInProcessVerification: true,
  });

  const staged = await controller.stage(snapshot);
  if (staged.status !== "staged") throw new Error(`staging failed: ${staged.reason}`);
  return { snapshot, controller, frame: staged.frame as LocalFrameHandle, observations, gateway, state, broker };
}

function addressesIn(markup: string): readonly string[] {
  return [...markup.matchAll(new RegExp(`${ARTIFACT_NODE_ATTRIBUTE}="([0-9a-f]+)"`, "g"))].map((match) => match[1]!);
}

const ordersRevision = () => revisionOf("orders.dashboard", "/view.tsx", [ORDERS_VIEW_MODULE, STAT_ROW_MODULE]);

function streamedOrdersRevision(viewText: string): ArtifactRevision {
  const assembler = new AgentStreamAssembler({ id: "orders.dashboard", entry: "/view.tsx" });
  for (const module of [{ ...ORDERS_VIEW_MODULE, text: viewText }, STAT_ROW_MODULE]) {
    for (let offset = 0; offset < module.text.length; offset += 97) {
      assembler.applyModulePatch({ path: module.path, text: module.text.slice(offset, offset + 97) });
    }
    assembler.sealModule(module.path);
  }
  return assembler.commitArtifactRevision();
}

describe("AgentReact end-to-end addressing (AR-AC-5)", () => {
  it("executes the linked bundle and renders the declared component", async () => {
    const { snapshot, frame } = await mountOrders(ordersRevision());
    const markup = frame.markup()!;

    expect(snapshot.viewDeclaration?.id).toBe("orders.dashboard");
    expect(markup).toContain("<h1");
    expect(markup).toContain("Orders");
    expect(markup).toContain("Refresh");
  });

  it("resolves every stamped DOM address back to its source span", async () => {
    const { frame } = await mountOrders(ordersRevision());
    const spans = addressesIn(frame.markup()!).map((address) => frame.registry.resolveSourceSpan(address));

    expect(spans.every((span) => span !== undefined)).toBe(true);
    expect(spans.map((span) => span!.elementType)).toEqual(
      expect.arrayContaining(["section", "h1", "button", "div", "span", "strong"]),
    );
    for (const span of spans) {
      expect(["/view.tsx", "/stat-row.tsx"]).toContain(span!.modulePath);
      expect(span!.line).toBeGreaterThan(0);
      expect(span!.column).toBeGreaterThan(0);
    }
  });

  it("addresses the outer section at the span the compiler indexed", async () => {
    const { snapshot, frame } = await mountOrders(ordersRevision());
    const viewIndex = snapshot.semanticIndex.find((index) => index.module === "/view.tsx")!;
    const section = viewIndex.jsxNodes.find((node) => node.elementType === "section")!;

    const expected = instanceAddress({
      artifactDigest: snapshot.artifactDigest,
      sourceNodeId: section.sourceNodeId,
      key: null,
    });

    expect(addressesIn(frame.markup()!)).toContain(expected);
    expect(frame.registry.resolveSourceSpan(expected)).toEqual({
      modulePath: "/view.tsx",
      line: section.line,
      column: section.column,
      elementType: "section",
    });
  });

  it("finds the addressed element in a DOM subtree and misses an unknown address", async () => {
    const { frame } = await mountOrders(ordersRevision());
    const [first] = addressesIn(frame.markup()!);
    const queried: string[] = [];
    const root = {
      querySelector(selectors: string) {
        queried.push(selectors);
        return { selectors };
      },
    };

    expect(frame.registry.resolveDomNode(root, first!)).toEqual({
      selectors: `[${ARTIFACT_NODE_ATTRIBUTE}="${first}"]`,
    });
    expect(frame.registry.resolveDomNode(root, "deadbeefdeadbeef")).toBeNull();
    expect(queried).toHaveLength(1);
  });

  it("keeps source node ids stable when the same Revision is rebuilt", async () => {
    const revision = ordersRevision();
    const first = await mountOrders(revision);
    const second = await mountOrders(revision);

    expect(addressesIn(second.frame.markup()!)).toEqual(addressesIn(first.frame.markup()!));
  });

  it("moves the addresses of a component whose source shifts", async () => {
    const original = await mountOrders(ordersRevision());
    const shifted = await mountOrders(revisionOf("orders.dashboard", "/view.tsx", [
      { ...ORDERS_VIEW_MODULE, text: `// a new leading comment\n${ORDERS_VIEW_MODULE.text}` },
      STAT_ROW_MODULE,
    ]));

    const before = new Set(addressesIn(original.frame.markup()!));
    const after = addressesIn(shifted.frame.markup()!);
    const viewAddresses = after.filter((address) => {
      const span = shifted.frame.registry.resolveSourceSpan(address);
      return span?.modulePath === "/view.tsx";
    });

    expect(viewAddresses.length).toBeGreaterThan(0);
    expect(viewAddresses.every((address) => !before.has(address))).toBe(true);
  });

  it("does not pass the reserved node prop to a component that has not opted in", async () => {
    const { frame } = await mountOrders(ordersRevision());

    expect(frame.markup()).not.toContain("artifactNode");
  });

  it("reads staged Artifact state through the runtime hook", async () => {
    const empty = await mountOrders(ordersRevision());
    const seeded = await mountOrders(ordersRevision(), [{ id: "a" }, { id: "b" }]);

    // The StatRow renders `orders.length` from the frozen snapshot the staging
    // frame was handed, so the count follows Host state and not a local default.
    expect(empty.frame.markup()).toMatch(/<strong[^>]*>0<\/strong>/);
    expect(seeded.frame.markup()).toMatch(/<strong[^>]*>2<\/strong>/);
    expect(seeded.state.get("/orders")).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("records a staging renderCompleted observation for the committed build", async () => {
    const { snapshot, observations } = await mountOrders(ordersRevision());
    const completed = observations.recorded().filter((event) => event.kind === "renderCompleted");

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      buildDigest: snapshot.buildDigest,
      artifactDigest: snapshot.artifactDigest,
      detail: { phase: "staging" },
    });
  });

  it("does not let an outgoing bundle clear a newer bundle's runtime bridge", async () => {
    const first = await mountOrders(ordersRevision());
    const shifted = await mountOrders(revisionOf("orders.dashboard", "/view.tsx", [
      { ...ORDERS_VIEW_MODULE, text: `// shifted build\n${ORDERS_VIEW_MODULE.text}` },
      STAT_ROW_MODULE,
    ]));
    expect(activeArtifactRuntime()?.buildDigest).toBe(shifted.snapshot.buildDigest);

    first.frame.dispose();

    expect(activeArtifactRuntime()?.buildDigest).toBe(shifted.snapshot.buildDigest);
    shifted.frame.dispose();
    expect(activeArtifactRuntime()).toBeUndefined();
  });

  it("aborts a timed-out loader before a late bundle can activate", async () => {
    const snapshot = await buildOrders(ordersRevision());
    const observations = createObservationBridge();
    const policy = createCapabilityPolicy({ allowedCapabilities: ["orders.read", "orders.refresh"] });
    const broker = createCapabilityBroker({ policy });
    const state = createArtifactStateStore({
      declarations: snapshot.viewDeclaration!.state,
      schemas: [ORDERS_STATE_SCHEMA],
      observations,
    });
    const gateway = createActionGateway({ broker, policy, observations });
    let resolveBundle!: (bundle: ArtifactBundleModule) => void;
    let loaderSignal: AbortSignal | undefined;
    let activations = 0;
    const factory = createLocalFrameFactory({
      loadBundle: (_build, signal) => {
        loaderSignal = signal;
        return new Promise((resolve) => {
          resolveBundle = resolve;
        });
      },
      state,
      gateway,
      observations,
      renderToMarkup: renderToStaticMarkup,
    });
    const grant = broker.computeGrant(snapshot.viewDeclaration!);
    const token = broker.issueFrameToken(snapshot.buildDigest, "dry-run", grant);
    const frame = factory.create(snapshot, {
      actionMode: "dry-run",
      frameToken: token,
      state: state.snapshot(),
    });
    await frame.mount();

    expect(await frame.waitForRenderCompleted(1)).toEqual({ status: "timedOut" });
    frame.dispose();
    expect(loaderSignal?.aborted).toBe(true);
    resolveBundle({
      view: { id: "late", component: () => null },
      activateArtifactRuntime() {
        activations += 1;
        return { component: () => null };
      },
      deactivateArtifactRuntime() {},
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(activations).toBe(0);
    expect(frame.markup()).toBeUndefined();
  });
});

describe("AgentReact original POC end-to-end flow (AR-AC-1, AR-AC-4, AR-AC-5, AR-AC-7..10)", () => {
  it("streams, builds, commits, acts, preserves Current on failure, and rolls back", async () => {
    const observations = createObservationBridge();
    const coordinator = createBuildCoordinator({
      compiler: createOxcCompiler(),
      runtimePackages: TEST_RUNTIME_PACKAGES,
      onObservation: (observation) => observations.record(observation),
    });
    const firstSnapshot = await coordinator.build(streamedOrdersRevision(ORDERS_VIEW_MODULE.text));
    expect(firstSnapshot).toMatchObject({ status: "ready", artifactId: "orders.dashboard" });
    expect(firstSnapshot.bundle.length).toBeGreaterThan(0);

    const policy = createCapabilityPolicy({
      allowedCapabilities: ["orders.read", "orders.refresh"],
      requiresApproval: ["orders.refresh"],
    });
    const broker = createCapabilityBroker({ policy, approvals: ["orders.refresh"] });
    const state = createArtifactStateStore({
      declarations: firstSnapshot.viewDeclaration!.state,
      schemas: [ORDERS_STATE_SCHEMA],
      observations,
    });
    const refresh = vi.fn(async (payload: unknown) => ({ accepted: payload }));
    const gateway = createActionGateway({
      broker,
      policy,
      observations,
      artifactDigest: firstSnapshot.artifactDigest,
      handlers: { "orders.refresh": refresh },
    });
    const controller = createSandboxFrameController({
      frames: createLocalFrameFactory({ loadBundle, state, gateway, observations, renderToMarkup: renderToStaticMarkup }),
      broker,
      observations,
      state,
      allowInProcessVerification: true,
    });

    const firstStage = await controller.stage(firstSnapshot);
    expect(firstStage.status).toBe("staged");
    if (firstStage.status !== "staged") throw new Error(firstStage.reason);
    const firstFrame = firstStage.frame as LocalFrameHandle;
    expect(firstFrame.markup()).toMatch(/Orders[\s\S]*<strong[^>]*>0<\/strong>/);
    expect(activeArtifactRuntime()?.actionMode).toBe("dry-run");
    await expect(activeArtifactRuntime()!.dispatchAction("orders.refresh", { phase: "staging" }))
      .resolves.toEqual({ status: "dry-run" });
    expect(refresh).not.toHaveBeenCalled();

    controller.activate();
    const liveRuntime = activeArtifactRuntime();
    expect(liveRuntime?.actionMode).toBe("live");
    liveRuntime!.setState("/orders", [{ id: "a" }, { id: "b" }]);
    expect(state.get("/orders")).toEqual([{ id: "a" }, { id: "b" }]);
    await expect(liveRuntime!.dispatchAction("orders.refresh", { phase: "live" })).resolves.toEqual({
      status: "completed",
      result: { accepted: { phase: "live" } },
    });
    expect(refresh).toHaveBeenCalledOnce();

    const brokenText = ORDERS_VIEW_MODULE.text.replace(
      "function OrderDashboard() {",
      'function OrderDashboard() {\n  throw new Error("e2e render failure");',
    );
    const brokenSnapshot = await coordinator.build(streamedOrdersRevision(brokenText));
    expect(brokenSnapshot.status).toBe("ready");
    const rejected = await controller.stage(brokenSnapshot);
    expect(rejected).toMatchObject({ status: "rejected", reason: "e2e render failure" });
    expect(controller.current).toBe(firstFrame);
    expect(firstFrame.disposed).toBe(false);

    const secondText = ORDERS_VIEW_MODULE.text.replace("<h1>Orders</h1>", "<h1>Orders v2</h1>");
    const secondSnapshot = await coordinator.build(streamedOrdersRevision(secondText));
    const secondStage = await controller.stage(secondSnapshot);
    expect(secondStage.status).toBe("staged");
    if (secondStage.status !== "staged") throw new Error(secondStage.reason);
    expect((secondStage.frame as LocalFrameHandle).markup()).toContain("Orders v2");
    controller.activate();
    expect(controller.current?.snapshot.buildDigest).toBe(secondSnapshot.buildDigest);
    expect(firstFrame.disposed).toBe(true);

    const rolledBack = await controller.rollback();
    expect(rolledBack.status).toBe("staged");
    expect(controller.current?.snapshot.buildDigest).toBe(firstSnapshot.buildDigest);
    expect((controller.current as LocalFrameHandle).markup()).toContain("Orders</h1>");

    const events = observations.recorded();
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "actionAttempted", detail: expect.objectContaining({ actionMode: "dry-run" }) }),
      expect.objectContaining({ kind: "actionAttempted", detail: expect.objectContaining({ actionMode: "live" }) }),
      expect.objectContaining({ kind: "runtimeException", buildDigest: brokenSnapshot.buildDigest }),
      expect.objectContaining({ kind: "renderFailed", buildDigest: brokenSnapshot.buildDigest }),
      expect.objectContaining({ kind: "renderCompleted", detail: expect.objectContaining({ phase: "rolled-back" }) }),
    ]));
    expect(observations.drainEnvelopes()).toEqual(events.map((event) => expect.objectContaining({
      type: "harness.artifact-observation",
      payload: expect.objectContaining({ kind: event.kind, sequence: event.sequence }),
    })));

    broker.revokeFrameToken(controller.current!.frameToken.token);
    controller.current!.dispose();
    expect(activeArtifactRuntime()).toBeUndefined();
  });
});
