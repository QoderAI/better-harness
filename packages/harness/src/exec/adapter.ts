import type { HarnessIrBundle, HarnessRevision } from "../ir/index.js";
import type { AdapterRealizationDescriptor } from "../resolver/adapter-descriptor.js";
import { HarnessRunEmitter, type HarnessRunEventListener } from "./events.js";
import {
  HarnessHostMismatchError,
  type HarnessRunResult,
  type HarnessRunTask,
} from "./executor.js";

/**
 * Version tag every v1 adapter carries as a literal, so DSL/IR evolution and
 * adapter evolution can move independently. Modelled after the versioned
 * adapter specs in the AI SDK harness layer (`specificationVersion`).
 */
export const HARNESS_ADAPTER_SPECIFICATION_VERSION = "harness-adapter-v1";

/**
 * Thrown by adapters when a requested behavior is unavailable at run time
 * (turn abort on a runtime without an abort surface, graceful stop on a
 * runtime that can only be torn down, …). Callers that can degrade — such as
 * {@link runOnce} — map this to a warning instead of failing the run, feeding
 * the same degradation model the resolver applies at resolve time.
 */
export class HarnessCapabilityUnsupportedError extends Error {
  constructor(
    readonly adapterId: string,
    readonly capability: string,
    message?: string,
  ) {
    super(message ?? `Adapter '${adapterId}' does not support capability '${capability}'.`);
    this.name = "HarnessCapabilityUnsupportedError";
  }
}

/**
 * Thrown when a second turn is started while one is still in flight. The
 * session contract has always said turns are sequential; this makes the claim
 * enforceable instead of a comment a caller can violate silently.
 */
export class HarnessConcurrentTurnError extends Error {
  constructor(
    readonly adapterId: string,
    readonly revisionId: string,
  ) {
    super(
      `Adapter '${adapterId}' session for '${revisionId}' already has a turn in flight; ` +
        "prompt turns are sequential.",
    );
    this.name = "HarnessConcurrentTurnError";
  }
}

export interface HarnessAdapterStartOptions {
  /** Resolved revision this session executes; fixed for the session lifetime. */
  revision: HarnessRevision;
  bundle: HarnessIrBundle;
  /**
   * Framework-owned working directory the host runtime operates in. The
   * adapter uses it as provided and never derives its own path; when omitted
   * the host runtime falls back to its own default (the process cwd).
   */
  workDir?: string;
  /** Root used to create source locks. Required when the revision contains locks. */
  sourceRoot?: string;
  /** Session-level default listener for per-turn run events. */
  onRunEvent?: HarnessRunEventListener;
}

export interface HarnessAdapterTurnOptions {
  /** Fresh input for this turn; conversation history is owned by the host. */
  prompt: string;
  /**
   * Aborts the in-flight turn. Adapters whose runtime exposes no abort
   * surface throw {@link HarnessCapabilityUnsupportedError} (capability
   * `turn-abort`) before the turn starts instead of ignoring the signal.
   */
  abortSignal?: AbortSignal;
  /** Overrides the session-level run event listener for this turn. */
  onRunEvent?: HarnessRunEventListener;
}

/**
 * One live host session: the unit of conversation-state continuity across
 * prompt turns. Each turn emits a complete {@link HarnessRunEmitter} event
 * sequence (one `run-started` first, one `run-finished` last) and resolves to
 * the same result shape as a batch execution.
 */
export interface HarnessAdapterSession {
  readonly adapterId: string;
  readonly revisionId: string;
  /**
   * Host session id once the runtime reports one, so a caller can resume the
   * same conversation later instead of replaying a fresh context.
   */
  readonly sessionId?: string;
  /** Run one prompt turn to completion. Turns are sequential, not concurrent. */
  doPromptTurn(options: HarnessAdapterTurnOptions): Promise<HarnessRunResult>;
  /** Gracefully end the session. No further methods may be called after it. */
  doStop(): Promise<void>;
  /** Tear the session down without grace. Safe to call after a failed turn. */
  doDestroy(): Promise<void>;
}

/**
 * Versioned contract for one host runtime adapter. `doStart` binds a resolved
 * revision to a live host session; the batch surface ({@link runOnce} and the
 * `HarnessExecutor` classes built on it) is a one-turn convenience on top.
 *
 * `describe()` is the adapter's own statement of what it can realize. The
 * resolver consumes it so a harness is measured against runtime facts instead
 * of author-declared optimism.
 */
export interface HarnessAdapterV1 {
  readonly specificationVersion: typeof HARNESS_ADAPTER_SPECIFICATION_VERSION;
  /** Stable adapter package id, e.g. `@harness/adapter-qoder`. */
  readonly adapterId: string;
  /** Host runtime id checked against `revision.target.runtime`. */
  readonly host: string;
  describe(): AdapterRealizationDescriptor;
  doStart(options: HarnessAdapterStartOptions): Promise<HarnessAdapterSession>;
}

export interface RunOnceOptions {
  onRunEvent?: HarnessRunEventListener;
}

/**
 * The batch surface: start a session, run one prompt turn, stop.
 *
 * Behavioural parity with the pre-session executors is part of the contract:
 *
 * - A host mismatch rejects before the host SDK loads and emits no events.
 * - Any other start failure (missing SDK, auth) emits the legacy
 *   `run-started` / `run-error` / `run-finished` sequence before rethrowing.
 * - A turn failure destroys the session best-effort and rethrows.
 * - A failed stop always destroys the session best-effort; an adapter that
 *   cannot stop gracefully degrades to a result warning instead of failing.
 */
export async function runOnce(
  adapter: HarnessAdapterV1,
  revision: HarnessRevision,
  bundle: HarnessIrBundle,
  task: HarnessRunTask,
  options: RunOnceOptions = {},
): Promise<HarnessRunResult> {
  let session: HarnessAdapterSession;
  try {
    session = await adapter.doStart({
      revision,
      bundle,
      workDir: task.cwd,
      sourceRoot: task.sourceRoot,
      onRunEvent: options.onRunEvent,
    });
  } catch (error) {
    if (!(error instanceof HarnessHostMismatchError)) {
      const emitter = new HarnessRunEmitter(options.onRunEvent);
      emitter.start({ revisionId: revision.revisionId, host: adapter.host });
      emitter.error(error instanceof Error ? error.message : String(error));
      emitter.finish(1);
    }
    throw error;
  }
  let result: HarnessRunResult;
  try {
    result = await session.doPromptTurn({
      prompt: task.prompt,
      ...(task.abortSignal !== undefined ? { abortSignal: task.abortSignal } : {}),
    });
  } catch (error) {
    await destroyQuietly(session);
    throw error;
  }
  try {
    await session.doStop();
  } catch (error) {
    // Any failed stop leaves a live host session behind, so tear it down before
    // reporting: a graceful-stop gap degrades to a warning, anything else fails.
    await destroyQuietly(session);
    if (!(error instanceof HarnessCapabilityUnsupportedError)) {
      throw error;
    }
    return {
      ...result,
      warnings: [
        ...result.warnings,
        `Adapter '${adapter.adapterId}' cannot stop gracefully: ${error.message}`,
      ],
    };
  }
  return result;
}

async function destroyQuietly(session: HarnessAdapterSession): Promise<void> {
  try {
    await session.doDestroy();
  } catch {
    // Cleanup failures must not mask the primary outcome.
  }
}
