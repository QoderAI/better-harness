import {
  compileHarness,
  describeBuiltInAdapter,
  resolveHarness,
  type AdapterRealizationDescriptor,
} from "@qoder-ai/harness";
import { lockCapabilitySources } from "@qoder-ai/harness/lock";
import type {
  HarnessExecutor,
  HarnessRunEventListener,
  HarnessRunResult,
} from "@qoder-ai/harness/exec";
import type { AguiEvent } from "./protocol.js";
import { createAguiTranslator } from "./translate.js";

export interface HarnessUiExecutorContext {
  runtimeId: string;
  threadId: string;
  runId: string;
  onRunEvent: HarnessRunEventListener;
}

/**
 * Produces the executor that runs the resolved revision. The default picks
 * the v0.3 executor matching the revision's runtime; tests and embedders can
 * inject a scripted executor instead.
 */
export type HarnessUiExecutorFactory = (context: HarnessUiExecutorContext) => HarnessExecutor;

export interface HarnessAguiRunOptions {
  /** `.harness` source text. */
  source: string;
  /** Defaults to the bundle's only harness. */
  harnessId?: string;
  /** Narrows the harness to one explicitly declared deployment runtime. */
  runtimeId?: string;
  prompt: string;
  cwd?: string;
  /**
   * Root a `source`-backed skill's path is locked and delivered against.
   * Without it, a harness whose skills carry only an inline `description`
   * still resolves and runs; a harness with a `source` skill fails resolution
   * with a clear "run lockCapabilitySources()" error instead of silently
   * dropping the skill's guidance from the run.
   */
  sourceRoot?: string;
  threadId: string;
  runId: string;
  onEvent: (event: AguiEvent) => void;
  abortSignal?: AbortSignal;
  executorFactory: HarnessUiExecutorFactory;
  /**
   * Realization facts for the runtime that resolves. Defaults to the adapters
   * this package ships; an injected executor that reaches a different host must
   * describe that host instead of inheriting Qoder's or Pi's abilities.
   */
  adapterDescriptor?: (runtimeId: string) => AdapterRealizationDescriptor | undefined;
}

export interface HarnessAguiRunSummary {
  ok: boolean;
  result?: HarnessRunResult;
}

/**
 * Compile, resolve, and execute one harness run, delivering AG-UI events.
 *
 * Failures before execution (compile or resolution errors) still produce a
 * protocol-complete stream: `RUN_STARTED` followed by a terminal `RUN_ERROR`.
 */
export async function runHarnessAgui(options: HarnessAguiRunOptions): Promise<HarnessAguiRunSummary> {
  const translator = createAguiTranslator({ threadId: options.threadId, runId: options.runId });
  const deliver = (events: AguiEvent[]): void => {
    for (const event of events) {
      options.onEvent(event);
    }
  };
  const fail = (message: string): HarnessAguiRunSummary => {
    deliver(translator.translate({ type: "run-started", revisionId: "unresolved", host: "harness-ui" }));
    deliver(translator.translate({ type: "run-error", message }));
    return { ok: false };
  };

  let compiled: Awaited<ReturnType<typeof compileHarness>>;
  try {
    compiled = await compileHarness(options.source);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
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
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
  // Resolve against the facts of the adapter that will actually run the
  // revision, so a requirement this host cannot back fails here instead of
  // becoming a prompt line at run time.
  const { revision, report } = resolveHarness(compiled.bundle, harnessId, options.runtimeId, {
    adapter: options.adapterDescriptor ?? describeBuiltInAdapter,
    ...(sourceLocks !== undefined ? { sourceLocks } : {}),
  });
  if (!revision) {
    return fail(report.errors.join("\n") || "Resolution failed.");
  }

  deliver(translator.translate({
    type: "run-started",
    revisionId: revision.revisionId,
    host: revision.target.runtime,
  }));
  try {
    const executor = options.executorFactory({
      runtimeId: revision.target.runtime,
      threadId: options.threadId,
      runId: options.runId,
      onRunEvent: (event) => deliver(translator.translate(event)),
    });
    const result = await executor.execute(revision, compiled.bundle, {
      prompt: options.prompt,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.sourceRoot !== undefined ? { sourceRoot: options.sourceRoot } : {}),
      ...(options.abortSignal !== undefined ? { abortSignal: options.abortSignal } : {}),
    });
    if (!translator.terminated) {
      if (result.exitCode === 0) {
        deliver(translator.translate({
          type: "run-finished",
          exitCode: result.exitCode,
          ...(result.metrics !== undefined ? { metrics: result.metrics } : {}),
        }));
      } else {
        deliver(translator.translate({
          type: "run-error",
          message: result.errorOutput || `Harness run failed with exit code ${result.exitCode}.`,
        }));
      }
    }
    return { ok: result.exitCode === 0, result };
  } catch (error) {
    // The run layer owns the outer AG-UI lifecycle even when an injected
    // executor fails during construction or before it emits a terminal event.
    if (!translator.terminated) {
      deliver(translator.translate({
        type: "run-error",
        message: error instanceof Error ? error.message : String(error),
      }));
    }
    return { ok: false };
  }
}
