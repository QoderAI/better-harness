import { createElement, type FunctionComponent, type ReactElement } from "react";
import type {
  BuildSnapshot,
  FrameFactory,
  FrameHandle,
  FrameMountOptions,
  FrameToken,
  FrameVerification,
} from "../../contracts/index.js";
import type { ActionGateway } from "../action-gateway.js";
import type { ObservationBridge } from "../observation-bridge.js";
import type { ArtifactStateStore } from "../state-store.js";
import {
  type ArtifactRuntimeBridge,
  createNodeAddressRegistry,
  type NodeAddressRegistry,
} from "../../runtime/index.js";
import {
  createFrameInitMessage,
  type FrameReport,
  isMatchingInit,
  isReportFor,
  renderCompletedReport,
  renderFailedReport,
} from "./frame-protocol.js";

/**
 * An in-process frame that really executes a Build Snapshot.
 *
 * This is a verification-only transport. It speaks the same init/report message
 * shapes and proves that a linked bundle can load, render synchronously, and
 * return resolvable addresses. It does not provide a separate realm, browser
 * mount/effect semantics, CSP, or origin isolation, and production controllers
 * reject it unless verification-only execution is explicitly enabled.
 */

/** What the linked bundle exposes; see `link/esbuild-linker.ts`. */
export interface ArtifactBundleModule {
  readonly view: { readonly id: string; readonly component: FunctionComponent };
  activateArtifactRuntime(bridge: ArtifactRuntimeBridge): { readonly component: FunctionComponent };
  deactivateArtifactRuntime(): void;
}

export type BundleLoader = (snapshot: BuildSnapshot, signal?: AbortSignal) => Promise<ArtifactBundleModule>;
export type MarkupRenderer = (element: ReactElement) => string;

export interface LocalFrameFactoryOptions {
  readonly loadBundle: BundleLoader;
  readonly state: ArtifactStateStore;
  readonly gateway: ActionGateway;
  readonly observations: ObservationBridge;
  readonly renderToMarkup: MarkupRenderer;
}

export interface LocalFrameHandle extends FrameHandle {
  /** Markup produced by the last verified render, for address resolution. */
  markup(): string | undefined;
  readonly registry: NodeAddressRegistry;
}

export interface LocalFrameFactory extends FrameFactory {
  create(snapshot: BuildSnapshot, options: FrameMountOptions): LocalFrameHandle;
}

export function createLocalFrameFactory(options: LocalFrameFactoryOptions): LocalFrameFactory {
  return {
    isolation: "in-process",
    create(snapshot, mountOptions) {
      return new LocalFrame(snapshot, mountOptions, options);
    },
  };
}

class LocalFrame implements LocalFrameHandle {
  readonly registry: NodeAddressRegistry;
  #token: FrameToken;
  #bundle: ArtifactBundleModule | undefined;
  #markup: string | undefined;
  #render: Promise<FrameReport> | undefined;
  #disposed = false;
  #abort = new AbortController();

  constructor(
    readonly snapshot: BuildSnapshot,
    private readonly mountOptions: FrameMountOptions,
    private readonly factory: LocalFrameFactoryOptions,
  ) {
    this.#token = mountOptions.frameToken;
    this.registry = createNodeAddressRegistry(snapshot.artifactDigest);
  }

  get actionMode(): FrameToken["actionMode"] {
    return this.#token.actionMode;
  }

  get frameToken(): FrameToken {
    return this.#token;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  markup(): string | undefined {
    return this.#markup;
  }

  async mount(): Promise<void> {
    if (this.#disposed) throw new Error("Cannot mount a disposed frame.");
    const init = createFrameInitMessage({
      snapshot: this.snapshot,
      actionMode: this.mountOptions.actionMode,
      frameToken: this.#token.token,
      state: this.mountOptions.state,
    });
    if (!isMatchingInit(init, {
      buildDigest: this.snapshot.buildDigest,
      artifactDigest: this.snapshot.artifactDigest,
      frameToken: this.#token.token,
      actionMode: this.#token.actionMode,
    })) {
      throw new Error("Frame init message does not match this build.");
    }
    this.#render = this.#runRender(init.state);
  }

  async waitForRenderCompleted(timeoutMs: number): Promise<FrameVerification> {
    if (this.#render === undefined) return { status: "renderFailed", message: "Frame was never mounted." };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = await Promise.race([
      this.#render,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
    if (report === undefined) {
      this.#abort.abort();
      return { status: "timedOut" };
    }
    // A report that names another build is not evidence about this one, so it is
    // treated as a failure rather than quietly accepted.
    if (!isReportFor(report, this.snapshot.buildDigest)) {
      return { status: "renderFailed", message: "Frame reported a result for another build." };
    }
    return report.type === "renderCompleted"
      ? { status: "renderCompleted" }
      : { status: "renderFailed", message: report.message };
  }

  activate(token: FrameToken): void {
    if (this.#disposed) throw new Error("Cannot activate a disposed frame.");
    if (token.buildDigest !== this.snapshot.buildDigest) {
      throw new Error("Cannot activate a frame with a token issued for a different build.");
    }
    if (token.actionMode !== "live") throw new Error("Frame activation requires a live token.");
    this.#token = token;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#abort.abort();
    this.#bundle?.deactivateArtifactRuntime();
    this.registry.clear();
  }

  async #runRender(stagedState: Readonly<Record<string, unknown>>): Promise<FrameReport> {
    try {
      const bundle = await this.factory.loadBundle(this.snapshot, this.#abort.signal);
      if (this.#disposed || this.#abort.signal.aborted) {
        return renderFailedReport(this.snapshot.buildDigest, "Frame was disposed before its bundle loaded.");
      }
      this.#bundle = bundle;
      const view = bundle.activateArtifactRuntime(this.#createBridge(stagedState));
      if (this.#disposed || this.#abort.signal.aborted) {
        bundle.deactivateArtifactRuntime();
        return renderFailedReport(this.snapshot.buildDigest, "Frame was disposed before render started.");
      }
      this.#markup = this.factory.renderToMarkup(createElement(view.component));
      // Two ticks stand in for the browser's double `requestAnimationFrame`: a
      // render that throws on its first effect must be observed before the frame
      // may claim success.
      await tick();
      if (this.#disposed || this.#abort.signal.aborted) {
        return renderFailedReport(this.snapshot.buildDigest, "Frame was disposed during render verification.");
      }
      await tick();
      if (this.#disposed || this.#abort.signal.aborted) {
        return renderFailedReport(this.snapshot.buildDigest, "Frame was disposed during render verification.");
      }
      return renderCompletedReport(this.snapshot.buildDigest);
    } catch (error) {
      if (this.#disposed || this.#abort.signal.aborted) {
        return renderFailedReport(this.snapshot.buildDigest, "Frame was disposed during render verification.");
      }
      const message = error instanceof Error ? error.message : String(error);
      this.factory.observations.record({
        kind: "runtimeException",
        artifactDigest: this.snapshot.artifactDigest,
        buildDigest: this.snapshot.buildDigest,
        detail: { message },
      });
      return renderFailedReport(this.snapshot.buildDigest, message);
    }
  }

  #createBridge(stagedState: Readonly<Record<string, unknown>>): ArtifactRuntimeBridge {
    const frame = this;
    return {
      artifactDigest: this.snapshot.artifactDigest,
      buildDigest: this.snapshot.buildDigest,
      get actionMode() {
        return frame.actionMode;
      },
      registry: this.registry,
      getState(path) {
        // A staging frame reads the frozen snapshot it was handed; only a promoted
        // frame follows live Host state.
        return frame.actionMode === "live" ? frame.factory.state.get(path) : stagedState[path];
      },
      setState(path, value) {
        if (frame.actionMode !== "live") {
          frame.factory.observations.record({
            kind: "stateValidationFailed",
            artifactDigest: frame.snapshot.artifactDigest,
            buildDigest: frame.snapshot.buildDigest,
            detail: { path, reason: "A staging frame cannot write Artifact state." },
          });
          return;
        }
        frame.factory.state.set(path, value);
      },
      subscribe(path, listener) {
        return frame.actionMode === "live" ? frame.factory.state.subscribe(path, listener) : () => {};
      },
      dispatchAction(capability, payload) {
        return frame.factory.gateway.dispatch({ frameToken: frame.#token.token, capability, payload });
      },
    };
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
