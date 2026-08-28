import { describe, expect, it, vi } from "vitest";
import type {
  BuildSnapshot,
  Digest,
  FrameHandle,
  FrameMountOptions,
  FrameToken,
  FrameVerification,
} from "../../src/agent-react/contracts/index.js";
import { createSandboxFrameController } from "../../src/agent-react/host/frames/frame-controller.js";
import { createActionGateway } from "../../src/agent-react/host/action-gateway.js";
import { createCapabilityBroker, createCapabilityPolicy } from "../../src/agent-react/host/capability.js";
import { createObservationBridge } from "../../src/agent-react/host/observation-bridge.js";
import { createArtifactStateStore } from "../../src/agent-react/host/state-store.js";

type Script = FrameVerification | "attempt-action" | "throw-on-mount" | "never-settle";

/**
 * A scripted frame stands in for a real sandbox so the transaction itself can be
 * driven through outcomes a browser would only produce by accident: a timeout, a
 * post-mount throw, an Action attempt from an untrusted build.
 */
class ScriptedFrame implements FrameHandle {
  disposeCount = 0;
  #token: FrameToken;

  constructor(
    readonly snapshot: BuildSnapshot,
    readonly options: FrameMountOptions,
    private readonly script: Script,
    private readonly onMount: (frame: ScriptedFrame) => void,
  ) {
    this.#token = options.frameToken;
  }

  get actionMode(): FrameToken["actionMode"] {
    return this.#token.actionMode;
  }

  get frameToken(): FrameToken {
    return this.#token;
  }

  get disposed(): boolean {
    return this.disposeCount > 0;
  }

  async mount(): Promise<void> {
    if (this.script === "throw-on-mount") throw new Error("bundle would not start");
    this.onMount(this);
  }

  async waitForRenderCompleted(timeoutMs: number): Promise<FrameVerification> {
    if (this.script === "never-settle") {
      await new Promise((resolve) => setTimeout(resolve, timeoutMs + 5));
      return { status: "timedOut" };
    }
    if (this.script === "attempt-action" || this.script === "throw-on-mount") return { status: "renderCompleted" };
    return this.script;
  }

  activate(token: FrameToken): void {
    this.#token = token;
  }

  dispose(): void {
    this.disposeCount += 1;
  }
}

function snapshotOf(id: string): BuildSnapshot {
  return Object.freeze({
    buildDigest: `sha256:${id}` as Digest,
    artifactDigest: "sha256:artifact" as Digest,
    artifactId: "orders.dashboard",
    buildGeneration: 1,
    compilerVersion: "oxc-test",
    profileVersion: "1",
    runtimeVersion: "1",
    buildPolicyDigest: "sha256:policy" as Digest,
    status: "ready",
    bundle: `// ${id}`,
    sourceMaps: [],
    semanticIndex: [],
    viewDeclaration: {
      id: "orders.dashboard",
      state: [],
      capabilities: ["orders.refresh"],
      componentName: "Panel",
      module: "/view.tsx",
    },
    diagnostics: [],
  });
}

function harness(options: {
  readonly blockOnDeniedAction?: boolean;
  readonly maxRetainedObservations?: number;
} = {}) {
  const observations = createObservationBridge({ maxRetained: options.maxRetainedObservations });
  const policy = createCapabilityPolicy({ allowedCapabilities: ["orders.refresh"] });
  const broker = createCapabilityBroker({ policy });
  const state = createArtifactStateStore({ declarations: [], schemas: [], observations });
  const gateway = createActionGateway({ broker, policy, observations });
  const created: ScriptedFrame[] = [];
  let script: Script = { status: "renderCompleted" };

  const controller = createSandboxFrameController({
    frames: {
      isolation: "in-process",
      create(snapshot, mountOptions) {
        const frame = new ScriptedFrame(snapshot, mountOptions, script, (mounted) => {
          if (script !== "attempt-action") return;
          // The staging build tries to act before it is trusted.
          void gateway.dispatch({ frameToken: mounted.frameToken.token, capability: "orders.refresh" });
        });
        created.push(frame);
        return frame;
      },
    },
    broker,
    observations,
    state,
    allowInProcessVerification: true,
    verificationTimeoutMs: 20,
    ...(options.blockOnDeniedAction === undefined ? {} : { blockOnDeniedAction: options.blockOnDeniedAction }),
  });

  return {
    controller,
    observations,
    broker,
    created,
    setScript(next: Script) {
      script = next;
    },
  };
}

describe("SandboxFrameController transactions (AR-AC-9)", () => {
  it("stages a verified build as dry-run with a frozen state snapshot", async () => {
    const { controller, created } = harness();

    const staged = await controller.stage(snapshotOf("one"));

    expect(staged.status).toBe("staged");
    expect(controller.staging?.actionMode).toBe("dry-run");
    expect(controller.current).toBeUndefined();
    expect(Object.isFrozen(created[0]?.options.state)).toBe(true);
    expect(staged.status === "staged" && staged.grant.granted).toEqual(["orders.refresh"]);
  });

  it("promotes the staged frame to live and leaves no staging frame behind", async () => {
    const { controller, broker } = harness();
    const staged = await controller.stage(snapshotOf("one"));
    const stagingToken = staged.status === "staged" ? staged.frame.frameToken.token : "";

    const promoted = controller.activate();

    expect(controller.current).toBe(promoted);
    expect(controller.staging).toBeUndefined();
    expect(promoted.actionMode).toBe("live");
    expect(promoted.disposed).toBe(false);
    expect(broker.resolveFrameToken(stagingToken)).toBeUndefined();
    expect(broker.resolveFrameToken(promoted.frameToken.token)?.actionMode).toBe("live");
  });

  it("disposes the outgoing Current exactly once on commit", async () => {
    const { controller, created } = harness();
    await controller.stage(snapshotOf("one"));
    controller.activate();
    await controller.stage(snapshotOf("two"));
    controller.activate();

    expect(created).toHaveLength(2);
    expect(created[0]?.disposeCount).toBe(1);
    expect(created[1]?.disposed).toBe(false);
    expect(controller.current?.snapshot.buildDigest).toBe("sha256:two");
  });

  it("keeps Current mounted when the new build reports renderFailed", async () => {
    const { controller, created, setScript, observations } = harness();
    await controller.stage(snapshotOf("one"));
    const original = controller.activate();

    setScript({ status: "renderFailed", message: "component threw" });
    const staged = await controller.stage(snapshotOf("broken"));

    expect(staged).toEqual({
      status: "rejected",
      reason: "component threw",
      verification: { status: "renderFailed", message: "component threw" },
    });
    expect(controller.current).toBe(original);
    expect(original.disposed).toBe(false);
    expect(created[1]?.disposeCount).toBe(1);
    expect(observations.recorded().some((event) => event.kind === "renderFailed")).toBe(true);
  });

  it("keeps Current mounted when staging verification times out", async () => {
    const { controller, setScript } = harness();
    await controller.stage(snapshotOf("one"));
    const original = controller.activate();

    setScript("never-settle");
    const staged = await controller.stage(snapshotOf("slow"));

    expect(staged.status).toBe("rejected");
    expect(staged.status === "rejected" && staged.verification).toEqual({ status: "timedOut" });
    expect(controller.current).toBe(original);
    expect(controller.staging).toBeUndefined();
  });

  it("treats a mount throw as a staging failure", async () => {
    const { controller, setScript } = harness();
    setScript("throw-on-mount");

    const staged = await controller.stage(snapshotOf("one"));

    expect(staged).toMatchObject({ status: "rejected", reason: "bundle would not start" });
    expect(controller.current).toBeUndefined();
  });

  it("blocks the commit when a staging build attempts an Action and the policy says so", async () => {
    const { controller, setScript, observations } = harness({ blockOnDeniedAction: true });
    await controller.stage(snapshotOf("one"));
    const original = controller.activate();

    setScript("attempt-action");
    const staged = await controller.stage(snapshotOf("eager"));

    expect(staged).toMatchObject({
      status: "rejected",
      reason: "Build attempted an Action during staging verification.",
    });
    expect(controller.current).toBe(original);
    expect(observations.recorded().some((event) => event.kind === "actionAttempted")).toBe(true);
  });

  it("blocks an attempted Action even when the observation retention buffer is empty", async () => {
    const { controller, setScript, observations } = harness({
      blockOnDeniedAction: true,
      maxRetainedObservations: 0,
    });
    setScript("attempt-action");

    const staged = await controller.stage(snapshotOf("eager"));

    expect(staged).toMatchObject({
      status: "rejected",
      reason: "Build attempted an Action during staging verification.",
    });
    expect(observations.recorded()).toEqual([]);
  });

  it("allows the commit when an Action attempt is informational only", async () => {
    const { controller, setScript } = harness();
    setScript("attempt-action");

    const staged = await controller.stage(snapshotOf("eager"));

    expect(staged.status).toBe("staged");
    expect(controller.activate().snapshot.buildDigest).toBe("sha256:eager");
  });

  it("rejects a snapshot that is not runnable or carries no declaration", async () => {
    const { controller } = harness();
    const failed = { ...snapshotOf("one"), status: "failed" as const };
    const undeclared = { ...snapshotOf("one"), viewDeclaration: undefined };

    expect(await controller.stage(failed)).toEqual({ status: "rejected", reason: "Build Snapshot is not runnable." });
    expect(await controller.stage(undeclared)).toEqual({
      status: "rejected",
      reason: "Build Snapshot carries no Artifact View declaration.",
    });
  });

  it("restores the previous snapshot on rollback", async () => {
    const { controller } = harness();
    await controller.stage(snapshotOf("one"));
    controller.activate();
    await controller.stage(snapshotOf("two"));
    controller.activate();
    expect(controller.current?.snapshot.buildDigest).toBe("sha256:two");

    const rolled = await controller.rollback();

    expect(rolled.status).toBe("staged");
    expect(controller.current?.snapshot.buildDigest).toBe("sha256:one");
    expect(controller.current?.actionMode).toBe("live");
  });

  it("refuses rollback before any commit has been superseded", async () => {
    const { controller } = harness();
    await controller.stage(snapshotOf("one"));
    controller.activate();

    expect(await controller.rollback()).toEqual({
      status: "rejected",
      reason: "No previous Build Snapshot is retained to roll back to.",
    });
  });

  it("refuses to activate without a verified staging frame", async () => {
    const { controller } = harness();

    expect(() => controller.activate()).toThrow(/No verified staging frame/);
  });

  it("discards a staged frame and revokes its token", async () => {
    const { controller, broker } = harness();
    const staged = await controller.stage(snapshotOf("one"));
    const token = staged.status === "staged" ? staged.frame.frameToken.token : "";

    controller.discard();

    expect(controller.staging).toBeUndefined();
    expect(broker.resolveFrameToken(token)).toBeUndefined();
  });

  it("replaces an earlier staging frame when a newer build is staged", async () => {
    const { controller, created } = harness();
    await controller.stage(snapshotOf("one"));
    await controller.stage(snapshotOf("two"));

    expect(created[0]?.disposeCount).toBe(1);
    expect(controller.staging?.snapshot.buildDigest).toBe("sha256:two");
  });

  it("does not let an older overlapping stage dispose or replace the newer frame", async () => {
    const observations = createObservationBridge();
    const policy = createCapabilityPolicy({ allowedCapabilities: ["orders.refresh"] });
    const broker = createCapabilityBroker({ policy });
    const state = createArtifactStateStore({ declarations: [], schemas: [], observations });
    const completions = new Map<string, (verification: FrameVerification) => void>();
    const frames: ScriptedFrame[] = [];
    const controller = createSandboxFrameController({
      frames: {
        isolation: "in-process",
        create(snapshot, mountOptions) {
          const frame = new ScriptedFrame(snapshot, mountOptions, { status: "renderCompleted" }, () => {});
          frame.waitForRenderCompleted = () => new Promise((resolve) => completions.set(snapshot.buildDigest, resolve));
          frames.push(frame);
          return frame;
        },
      },
      broker,
      observations,
      state,
      allowInProcessVerification: true,
    });

    const older = controller.stage(snapshotOf("one"));
    await vi.waitFor(() => expect(completions.has("sha256:one")).toBe(true));
    const newer = controller.stage(snapshotOf("two"));
    await vi.waitFor(() => expect(completions.has("sha256:two")).toBe(true));

    completions.get("sha256:one")!({ status: "renderFailed", message: "late failure" });
    await expect(older).resolves.toEqual({
      status: "rejected",
      reason: "Staging build was superseded by a newer generation.",
    });
    expect(controller.staging?.snapshot.buildDigest).toBe("sha256:two");
    expect(frames[1]?.disposed).toBe(false);

    completions.get("sha256:two")!({ status: "renderCompleted" });
    await expect(newer).resolves.toMatchObject({ status: "staged" });
  });

  it("rejects in-process execution unless verification-only mode is explicit", () => {
    const observations = createObservationBridge();
    const policy = createCapabilityPolicy({ allowedCapabilities: [] });
    const broker = createCapabilityBroker({ policy });
    const state = createArtifactStateStore({ declarations: [], schemas: [] });

    expect(() => createSandboxFrameController({
      frames: {
        isolation: "in-process",
        create() {
          throw new Error("must not create a frame");
        },
      },
      broker,
      observations,
      state,
    })).toThrow(/verification-only/);
  });
});
