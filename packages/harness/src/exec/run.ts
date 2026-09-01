import { compileHarness } from "../compiler/compile.js";
import { lockCapabilitySources } from "../lock.js";
import type { AdapterRealizationDescriptor } from "../resolver/adapter-descriptor.js";
import { describeBuiltInAdapter } from "../resolver/adapter-registry.js";
import { resolveHarness } from "../resolver/resolve.js";
import type { HarnessExecutor, HarnessRunResult } from "./executor.js";
import type { HarnessRunEvent, HarnessRunEventListener } from "./events.js";

export interface HarnessExecutorContext {
  runtimeId: string;
  threadId: string;
  runId: string;
  onRunEvent: HarnessRunEventListener;
}

export type HarnessExecutorFactory = (context: HarnessExecutorContext) => HarnessExecutor;

export interface RunHarnessOptions {
  source: string;
  harnessId?: string;
  runtimeId?: string;
  prompt: string;
  cwd?: string;
  sourceRoot?: string;
  threadId: string;
  runId: string;
  onRunEvent: HarnessRunEventListener;
  abortSignal?: AbortSignal;
  executorFactory: HarnessExecutorFactory;
  adapterDescriptor?: (runtimeId: string) => AdapterRealizationDescriptor | undefined;
}

export interface RunHarnessSummary {
  ok: boolean;
  result?: HarnessRunResult;
}

/**
 * Compile, resolve, and execute one Harness while emitting its neutral event
 * lifecycle. Protocol adapters and applications consume the same seam instead
 * of owning competing compile/resolve/execute orchestration.
 */
export async function runHarness(options: RunHarnessOptions): Promise<RunHarnessSummary> {
  let boundary = createRunEventBoundary(options.onRunEvent, {
    revisionId: "unresolved",
    host: "harness",
  });
  const fail = (message: string): RunHarnessSummary => {
    boundary.ensureStarted();
    boundary.emit({ type: "run-error", message });
    boundary.ensureFinished(1);
    return { ok: false };
  };

  let compiled: Awaited<ReturnType<typeof compileHarness>>;
  try {
    compiled = await compileHarness(options.source);
  } catch (error) {
    return fail(errorMessage(error));
  }
  if (!compiled.bundle) {
    return fail(compiled.diagnostics.map((item) => item.message).join("\n") || "Compilation failed.");
  }
  const harnessId = options.harnessId ?? compiled.bundle.harnesses[0]?.id;
  if (harnessId === undefined) {
    return fail("The source declares no harness.");
  }

  let sourceLocks: Awaited<ReturnType<typeof lockCapabilitySources>> | undefined;
  if (options.sourceRoot !== undefined) {
    try {
      sourceLocks = await lockCapabilitySources(compiled.bundle, { root: options.sourceRoot });
    } catch (error) {
      return fail(errorMessage(error));
    }
  }

  const { revision, report } = resolveHarness(compiled.bundle, harnessId, options.runtimeId, {
    adapter: options.adapterDescriptor ?? describeBuiltInAdapter,
    ...(sourceLocks !== undefined ? { sourceLocks } : {}),
  });
  if (!revision) {
    return fail(report.errors.join("\n") || "Resolution failed.");
  }

  boundary = createRunEventBoundary(options.onRunEvent, {
    revisionId: revision.revisionId,
    host: revision.target.runtime,
  });
  try {
    const executor = options.executorFactory({
      runtimeId: revision.target.runtime,
      threadId: options.threadId,
      runId: options.runId,
      onRunEvent: boundary.emit,
    });
    const result = await executor.execute(revision, compiled.bundle, {
      prompt: options.prompt,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.sourceRoot !== undefined ? { sourceRoot: options.sourceRoot } : {}),
      ...(options.abortSignal !== undefined ? { abortSignal: options.abortSignal } : {}),
    });
    boundary.ensureStarted();
    if (result.exitCode !== 0 && !boundary.errored) {
      boundary.emit({
        type: "run-error",
        message: result.errorOutput || `Harness run failed with exit code ${result.exitCode}.`,
      });
    }
    boundary.ensureFinished(result.exitCode, result.metrics);
    return { ok: result.exitCode === 0 && !boundary.errored, result };
  } catch (error) {
    boundary.ensureStarted();
    boundary.emit({ type: "run-error", message: errorMessage(error) });
    boundary.ensureFinished(1);
    return { ok: false };
  }
}

interface RunEventBoundary {
  readonly errored: boolean;
  emit(event: HarnessRunEvent): void;
  ensureStarted(): void;
  ensureFinished(exitCode: number, metrics?: HarnessRunResult["metrics"]): void;
}

function createRunEventBoundary(
  listener: HarnessRunEventListener,
  fallbackStart: { revisionId: string; host: string },
): RunEventBoundary {
  let started = false;
  let finished = false;
  let errored = false;
  const deliver = (event: HarnessRunEvent): void => {
    try {
      listener(event);
    } catch {
      // A presentation or transport observer must not abort execution.
    }
  };
  const ensureStarted = (): void => {
    if (started || finished) return;
    started = true;
    deliver({ type: "run-started", ...fallbackStart });
  };
  const emit = (event: HarnessRunEvent): void => {
    if (finished) return;
    if (event.type === "run-started") {
      if (started) return;
      started = true;
      deliver(event);
      return;
    }
    ensureStarted();
    if (event.type === "run-error") errored = true;
    if (event.type === "run-finished") finished = true;
    deliver(event);
  };
  return {
    get errored() {
      return errored;
    },
    emit,
    ensureStarted,
    ensureFinished(exitCode, metrics) {
      if (finished) return;
      emit({
        type: "run-finished",
        exitCode,
        ...(metrics !== undefined ? { metrics } : {}),
      });
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
