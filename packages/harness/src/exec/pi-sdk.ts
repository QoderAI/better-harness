import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  HarnessIrBundle,
  HarnessMaterializationReceipt,
  HarnessRevision,
} from "../ir/index.js";
import {
  descriptorsEqual,
  type AdapterRealizationDescriptor,
} from "../resolver/adapter-descriptor.js";
import { PI_ADAPTER_DESCRIPTOR } from "../resolver/adapter-registry.js";
import { verifyRevisionSourceLocks } from "../resolver/source-lock.js";
import {
  HARNESS_ADAPTER_SPECIFICATION_VERSION,
  HarnessCapabilityUnsupportedError,
  HarnessConcurrentTurnError,
  runOnce,
  type HarnessAdapterSession,
  type HarnessAdapterStartOptions,
  type HarnessAdapterTurnOptions,
  type HarnessAdapterV1,
} from "./adapter.js";
import { HarnessRunEmitter, type HarnessRunEventListener } from "./events.js";
import { prepareMaterialization } from "./materialization.js";
import { loadSkillDeliveries } from "./skill-delivery.js";
import {
  assertRevisionHost,
  buildRunPreamble,
  preflightRevision,
  type HarnessExecutor,
  type HarnessRunResult,
  type HarnessRunTask,
} from "./executor.js";

const PI_SDK_MODULE = "@earendil-works/pi-coding-agent";

/**
 * Structural view of the Pi SDK surface this executor relies on
 * (`createAgentSession`, `SessionManager.inMemory`, and `ModelRuntime.create`).
 * Tests inject a stub through `loadSdk`.
 */
export interface PiSdkLike {
  createAgentSession(config: {
    cwd?: string;
    sessionManager: unknown;
    modelRuntime: unknown;
    model?: unknown;
    noTools?: "all";
  }): Promise<{
    session: {
      prompt(text: string): Promise<void>;
      subscribe?(listener: (event: PiSdkEvent) => void): (() => void) | void;
      dispose?(): void;
    };
  }>;
  SessionManager: { inMemory(): unknown };
  ModelRuntime: { create(): Promise<PiModelRuntimeLike> };
}

export interface PiModelRuntimeLike {
  setRuntimeApiKey?(providerId: string, apiKey: string): Promise<void>;
  getModels?(providerId?: string): readonly unknown[];
}

interface PiSdkEvent {
  type?: string;
  assistantMessageEvent?: { type?: string; delta?: string };
  message?: {
    role?: string;
    stopReason?: string;
    errorMessage?: string;
  };
}

export interface PiSdkExecutorOptions {
  /** Injectable SDK loader; defaults to importing the optional peer dependency. */
  loadSdk?: () => Promise<PiSdkLike>;
  /** In-memory credential/runtime setup; callers must not log credential values. */
  configureModelRuntime?: (runtime: PiModelRuntimeLike) => Promise<void> | void;
  /** Optional explicit model selection after runtime configuration. */
  selectModel?: (runtime: PiModelRuntimeLike) => Promise<unknown> | unknown;
  /** Receives lifecycle-ordered neutral run events while the run is in flight. */
  onRunEvent?: HarnessRunEventListener;
}

/**
 * `harness-adapter-v1` binding for the Pi coding agent SDK.
 *
 * One `createAgentSession` call backs the whole adapter session, so
 * conversation continuity lives in the Pi session itself and the run preamble
 * ships on the first turn only. The Pi SDK exposes no abort surface: a turn
 * requested with an `abortSignal` fails with
 * {@link HarnessCapabilityUnsupportedError} (`turn-abort`) before it starts.
 */
export class PiSdkAdapter implements HarnessAdapterV1 {
  readonly specificationVersion = HARNESS_ADAPTER_SPECIFICATION_VERSION;
  readonly adapterId = "@harness/adapter-pi";
  readonly host = "pi";
  private readonly loadSdk: () => Promise<PiSdkLike>;
  private readonly configureModelRuntime?: PiSdkExecutorOptions["configureModelRuntime"];
  private readonly selectModel?: PiSdkExecutorOptions["selectModel"];
  private readonly onRunEvent?: HarnessRunEventListener;

  constructor(options: PiSdkExecutorOptions = {}) {
    this.loadSdk = () => loadPiSdk(options.loadSdk);
    this.configureModelRuntime = options.configureModelRuntime;
    this.selectModel = options.selectModel;
    this.onRunEvent = options.onRunEvent;
  }

  /**
   * Pi sessions are created with `noTools: "all"`, so this adapter exposes no
   * callable tool and opens no MCP connection. Saying so is what lets the
   * resolver fail a `require tool` closed instead of turning it into a prompt.
   */
  describe(): AdapterRealizationDescriptor {
    return PI_ADAPTER_DESCRIPTOR;
  }

  async doStart(start: HarnessAdapterStartOptions): Promise<HarnessAdapterSession> {
    const descriptor = this.describe();
    if (!descriptorsEqual(descriptor, PI_ADAPTER_DESCRIPTOR)) {
      throw new Error(`Adapter descriptor drift for '${this.adapterId}'; update the pure-data registry.`);
    }
    preflightRevision(start.revision, start.bundle, this.host, descriptor);
    await verifyRevisionSourceLocks(
      start.revision,
      start.sourceRoot === undefined ? undefined : { root: start.sourceRoot },
    );
    const receipt = prepareMaterialization(start.revision, start.bundle, descriptor);
    const deliveries = await loadSkillDeliveries(start.revision, start.bundle, {
      ...(start.sourceRoot !== undefined ? { sourceRoot: start.sourceRoot } : {}),
    });
    const sdk = await this.loadSdk();
    const modelRuntime = await sdk.ModelRuntime.create();
    await this.configureModelRuntime?.(modelRuntime);
    const model = await this.selectModel?.(modelRuntime);
    const { session } = await sdk.createAgentSession({
      cwd: start.workDir,
      sessionManager: sdk.SessionManager.inMemory(),
      modelRuntime,
      ...(model !== undefined ? { model } : {}),
      noTools: "all",
    });
    const { preamble, warnings } = buildRunPreamble(
      start.revision,
      start.bundle,
      receipt,
      deliveries,
    );
    const adapter = this;
    let turnCount = 0;
    let inFlight = false;
    let ended = false;
    const end = (): void => {
      if (!ended) {
        ended = true;
        session.dispose?.();
      }
    };
    return {
      adapterId: this.adapterId,
      revisionId: start.revision.revisionId,
      async doPromptTurn(turn: HarnessAdapterTurnOptions): Promise<HarnessRunResult> {
        if (ended) {
          throw new Error(`Pi adapter session for '${start.revision.revisionId}' has ended.`);
        }
        if (inFlight) {
          throw new HarnessConcurrentTurnError(adapter.adapterId, start.revision.revisionId);
        }
        assertRevisionHost(start.revision, adapter.host);
        if (turn.abortSignal !== undefined) {
          throw new HarnessCapabilityUnsupportedError(
            adapter.adapterId,
            "turn-abort",
            "The Pi SDK session exposes no abort surface for an in-flight turn.",
          );
        }
        const firstTurn = turnCount === 0;
        turnCount += 1;
        inFlight = true;
        try {
          return await adapter.runTurn({ session, start, turn, preamble, warnings, firstTurn, receipt });
        } finally {
          inFlight = false;
        }
      },
      async doStop(): Promise<void> {
        end();
      },
      async doDestroy(): Promise<void> {
        end();
      },
    };
  }

  private async runTurn(context: {
    session: Awaited<ReturnType<PiSdkLike["createAgentSession"]>>["session"];
    start: HarnessAdapterStartOptions;
    turn: HarnessAdapterTurnOptions;
    preamble: string;
    warnings: string[];
    firstTurn: boolean;
    receipt: HarnessMaterializationReceipt;
  }): Promise<HarnessRunResult> {
    const { session, start, turn, preamble, warnings, firstTurn, receipt } = context;
    const revision = start.revision;
    const emitter = new HarnessRunEmitter(turn.onRunEvent ?? start.onRunEvent ?? this.onRunEvent);
    emitter.start({ revisionId: revision.revisionId, host: this.host });
    for (const warning of warnings) {
      emitter.warning(warning);
    }
    const prompt = firstTurn && preamble.length > 0
      ? `${preamble}\n\n${turn.prompt}`
      : turn.prompt;
    let streamedOutput = "";
    let errorOutput = "";
    const unsubscribe = session.subscribe?.((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta" &&
        typeof event.assistantMessageEvent.delta === "string"
      ) {
        streamedOutput += event.assistantMessageEvent.delta;
        emitter.text(event.assistantMessageEvent.delta);
      }
      if (
        event.type === "message_end" &&
        event.message?.role === "assistant" &&
        (event.message.stopReason === "error" || event.message.stopReason === "aborted")
      ) {
        errorOutput =
          event.message.errorMessage ?? `Pi SDK stopped with '${event.message.stopReason}'.`;
      }
    });
    try {
      await session.prompt(prompt);
    } catch (error) {
      emitter.error(error instanceof Error ? error.message : String(error));
      emitter.finish(1);
      throw error;
    } finally {
      unsubscribe?.();
    }
    if (errorOutput) {
      emitter.error(errorOutput);
    }
    emitter.finish(errorOutput ? 1 : 0);
    return {
      host: this.host,
      revisionId: revision.revisionId,
      exitCode: errorOutput ? 1 : 0,
      output: streamedOutput,
      errorOutput,
      warnings: [...warnings],
      materialization: receipt,
    };
  }
}

/**
 * Executes a resolved revision through the Pi coding agent SDK
 * (`@earendil-works/pi-coding-agent`, an optional peer dependency).
 */
export class PiSdkExecutor implements HarnessExecutor {
  readonly host = "pi";
  private readonly adapter: PiSdkAdapter;
  private readonly onRunEvent?: HarnessRunEventListener;

  constructor(options: PiSdkExecutorOptions = {}) {
    this.adapter = new PiSdkAdapter(options);
    this.onRunEvent = options.onRunEvent;
  }

  /** The realization facts a caller passes to `resolveHarness` for this host. */
  describe(): AdapterRealizationDescriptor {
    return this.adapter.describe();
  }

  async execute(
    revision: HarnessRevision,
    bundle: HarnessIrBundle,
    task: HarnessRunTask,
  ): Promise<HarnessRunResult> {
    return runOnce(this.adapter, revision, bundle, task, {
      ...(this.onRunEvent !== undefined ? { onRunEvent: this.onRunEvent } : {}),
    });
  }
}

export interface MaterializePiPackageOptions {
  /** Root used to create revision source locks. Required when locks are present. */
  sourceRoot?: string;
}

async function loadPiSdk(loader?: () => Promise<PiSdkLike>): Promise<PiSdkLike> {
  try {
    if (loader) {
      return await loader();
    }
    const moduleName = PI_SDK_MODULE;
    const sdk = await import(moduleName);
    return {
      createAgentSession: sdk.createAgentSession,
      SessionManager: sdk.SessionManager,
      ModelRuntime: sdk.ModelRuntime,
    } as PiSdkLike;
  } catch (error) {
    throw new Error(
      `The Pi executor needs the optional peer dependency '${PI_SDK_MODULE}'. ` +
        `Install it with: npm install ${PI_SDK_MODULE}`,
      { cause: error },
    );
  }
}

/**
 * Materialize a revision as an installable Pi package directory:
 * a `package.json` with the `pi.skills` contribution plus one
 * `skills/<skill>/SKILL.md` per delivered skill capability.
 * Returns the relative paths that were written.
 */
export async function materializePiPackage(
  revision: HarnessRevision,
  bundle: HarnessIrBundle,
  directory: string,
  options: MaterializePiPackageOptions = {},
): Promise<string[]> {
  preflightRevision(revision, bundle, "pi", new PiSdkAdapter().describe());
  await verifyRevisionSourceLocks(
    revision,
    options.sourceRoot === undefined ? undefined : { root: options.sourceRoot },
  );
  const deliveries = await loadSkillDeliveries(revision, bundle, {
    ...(options.sourceRoot !== undefined ? { sourceRoot: options.sourceRoot } : {}),
  });
  const written: string[] = [];
  const manifest = {
    name: `harness-revision-${revision.revisionId.slice(3, 15)}`,
    version: "0.0.0",
    private: true,
    description: `Materialized harness revision ${revision.revisionId} for runtime '${revision.target.runtime}'.`,
    pi: { skills: ["./skills"] },
  };
  await mkdir(directory, { recursive: true });
  const existingEntries = await readdir(directory);
  if (existingEntries.length > 0) {
    throw new Error(
      `Pi package destination must be empty: '${directory}' contains ${existingEntries.length} ` +
        `existing ${existingEntries.length === 1 ? "entry" : "entries"}.`,
    );
  }
  await writeFile(join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  written.push("package.json");

  // Realizations are per (agent, capability): the same skill used by several
  // agent roles materializes once.
  const writtenSkillIds = new Set<string>();
  for (const realization of revision.realization) {
    if (
      realization.state !== "satisfied" ||
      realization.capabilityKind !== "skill" ||
      writtenSkillIds.has(realization.capabilityId)
    ) {
      continue;
    }
    const skill = bundle.skills.find((candidate) => candidate.id === realization.capabilityId);
    if (!skill) {
      continue;
    }
    writtenSkillIds.add(skill.id);
    const skillDir = join(directory, "skills", skill.id);
    await mkdir(skillDir, { recursive: true });
    const provenance =
      `Provenance: harness revision ${revision.revisionId}, capability hash ` +
      `${revision.resolved.capabilities.find((entry) => entry.id === skill.id)?.contentHash ?? "unknown"}.`;
    const delivery = deliveries.get(skill.id);
    if (delivery !== undefined) {
      // A source-backed skill is materialized from its real bytes, references
      // included. Writing a generated stub that only names the source path would
      // ship a package whose skills teach nothing.
      if (delivery.directory) {
        await cp(delivery.absolutePath, skillDir, { recursive: true });
        for (const reference of delivery.references) {
          written.push(join("skills", skill.id, ...reference.split("/")));
        }
      }
      await writeFile(
        join(skillDir, "SKILL.md"),
        `${delivery.body.trimEnd()}\n\n${provenance}\n`,
        "utf8",
      );
      written.push(join("skills", skill.id, "SKILL.md"));
      continue;
    }
    const description = skill.description ?? `Harness skill '${skill.id}'.`;
    const body = [
      "---",
      `name: ${skill.id}`,
      `description: ${JSON.stringify(description)}`,
      "---",
      "",
      description,
      "",
      provenance,
      "",
    ].join("\n");
    await writeFile(join(skillDir, "SKILL.md"), body, "utf8");
    written.push(join("skills", skill.id, "SKILL.md"));
  }
  return written.sort();
}
