import type { ActionMode, ActionOutcome } from "../contracts/index.js";
import { createNodeAddressRegistry } from "./address-registry.js";
import type { ArtifactRuntimeBridge } from "./bridge.js";

export interface BrowserArtifactRuntimeContext {
  readonly artifactDigest: string;
  readonly buildDigest: string;
  readonly frameToken: string;
  readonly actionMode: ActionMode;
  readonly state: Readonly<Record<string, unknown>>;
}

export interface BrowserArtifactRuntimeSession {
  readonly bridge: ArtifactRuntimeBridge;
  dispose(): void;
}

/** MessagePort-backed runtime installed inside the opaque AgentReact frame. */
export function createBrowserArtifactRuntimeSession(
  context: BrowserArtifactRuntimeContext,
  port: MessagePort,
): BrowserArtifactRuntimeSession {
  let actionMode = context.actionMode;
  const values = new Map(Object.entries(context.state));
  const listeners = new Map<string, Set<() => void>>();
  const pendingActions = new Map<number, (outcome: ActionOutcome) => void>();
  let requestId = 0;
  let disposed = false;

  const matches = (message: Record<string, unknown>): boolean => message.buildDigest === context.buildDigest
    && message.frameToken === context.frameToken;
  const notify = (path: string): void => {
    for (const listener of listeners.get(path) ?? []) listener();
  };
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (typeof event.data !== "object" || event.data === null) return;
    const message = event.data as Record<string, unknown>;
    if (!matches(message)) return;
    if (message.type === "runtime.promote") {
      actionMode = "live";
      return;
    }
    if (message.type === "state.result" && typeof message.path === "string" && message.ok === true) {
      values.set(message.path, message.value);
      notify(message.path);
      return;
    }
    if (message.type === "state.changed" && typeof message.path === "string") {
      values.set(message.path, message.value);
      notify(message.path);
      return;
    }
    if (message.type === "action.result" && Number.isSafeInteger(message.requestId)) {
      const settle = pendingActions.get(Number(message.requestId));
      if (settle === undefined) return;
      pendingActions.delete(Number(message.requestId));
      settle(actionOutcome(message.outcome));
    }
  };
  port.addEventListener("message", onMessage);
  port.start();

  const bridge: ArtifactRuntimeBridge = {
    artifactDigest: context.artifactDigest,
    buildDigest: context.buildDigest,
    get actionMode() {
      return actionMode;
    },
    registry: createNodeAddressRegistry(context.artifactDigest),
    getState(path) {
      return values.get(path);
    },
    setState(path, value) {
      if (disposed) return;
      requestId += 1;
      port.postMessage({
        type: "state.set",
        buildDigest: context.buildDigest,
        frameToken: context.frameToken,
        requestId,
        path,
        value,
      });
    },
    subscribe(path, listener) {
      const subscribers = listeners.get(path) ?? new Set();
      subscribers.add(listener);
      listeners.set(path, subscribers);
      return () => subscribers.delete(listener);
    },
    dispatchAction(capability, payload) {
      if (disposed) return Promise.resolve({ status: "denied", reason: "Artifact frame is disposed." });
      requestId += 1;
      const current = requestId;
      return new Promise<ActionOutcome>((resolve) => {
        pendingActions.set(current, resolve);
        port.postMessage({
          type: "action.request",
          buildDigest: context.buildDigest,
          frameToken: context.frameToken,
          requestId: current,
          capability,
          payload,
        });
      });
    },
  };

  return {
    bridge,
    dispose() {
      if (disposed) return;
      disposed = true;
      port.removeEventListener("message", onMessage);
      bridge.registry.clear();
      for (const settle of pendingActions.values()) {
        settle({ status: "denied", reason: "Artifact frame is disposed." });
      }
      pendingActions.clear();
      listeners.clear();
    },
  };
}

function actionOutcome(value: unknown): ActionOutcome {
  if (typeof value === "object" && value !== null) {
    const outcome = value as Record<string, unknown>;
    if (outcome.status === "dry-run") return { status: "dry-run" };
    if (outcome.status === "completed") return { status: "completed", result: outcome.result };
    if (outcome.status === "denied" && typeof outcome.reason === "string") {
      return { status: "denied", reason: outcome.reason };
    }
  }
  return { status: "denied", reason: "Host returned an invalid Action result." };
}
