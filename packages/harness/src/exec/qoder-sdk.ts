import type {
  HarnessIrBundle,
  HarnessMaterializationReceipt,
  HarnessRevision,
} from "../ir/index.js";
import { contentEquals } from "../ir/canonical.js";
import {
  describeAdapter,
  descriptorsEqual,
  type AdapterRealizationDescriptor,
  type AdapterToolExposure,
} from "../resolver/adapter-descriptor.js";
import { QODER_ADAPTER_DESCRIPTOR } from "../resolver/adapter-registry.js";
import { verifyRevisionSourceLocks } from "../resolver/source-lock.js";
import {
  HARNESS_ADAPTER_SPECIFICATION_VERSION,
  HarnessConcurrentTurnError,
  runOnce,
  type HarnessAdapterSession,
  type HarnessAdapterStartOptions,
  type HarnessAdapterTurnOptions,
  type HarnessAdapterV1,
} from "./adapter.js";
import { HarnessRunEmitter, type HarnessRunEventListener } from "./events.js";
import { exposedHostTools, prepareMaterialization } from "./materialization.js";
import { loadSkillDeliveries } from "./skill-delivery.js";
import {
  assertRevisionHost,
  buildRunPreamble,
  preflightRevision,
  type HarnessExecutor,
  type HarnessRunResult,
  type HarnessRuntimeReceipt,
  type HarnessRunTask,
} from "./executor.js";

const QODER_SDK_MODULE = "@qoder-ai/qoder-agent-sdk";
const QODER_ADAPTER_IMPLEMENTATION_VERSION = "0.1.0";

/**
 * Standard DSL tool id → Qoder host tool. This is the adapter's own knowledge:
 * a harness author declares `require tool workspace.write`, and the adapter is
 * the component that knows the host calls that tool `Write` and can expose it.
 */
export const QODER_TOOL_EXPOSURE = QODER_ADAPTER_DESCRIPTOR.toolExposure;

export type QoderRuntimeProfile = "qoder-default-v1" | "qoder-minimal-v1";

const QODER_MINIMAL_TOOLS = ["Read", "Write", "Edit", "Bash"] as const;
const QODER_MINIMAL_DENIED_TOOLS = ["WebFetch", "WebSearch", "Agent", "Task"] as const;
type QoderSettingSource = "user" | "project" | "local";
type QoderSystemPrompt = string | {
  type: "preset";
  preset: "qodercli";
  append?: string;
};

export interface QoderSdkContentBlock {
  type: string;
  text?: string;
  /** `tool_use` block fields. */
  id?: string;
  name?: string;
  input?: unknown;
  /** `tool_result` block fields. */
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface QoderSdkStreamEvent {
  type: string;
  delta?: unknown;
  [key: string]: unknown;
}

/** @deprecated Renamed to {@link QoderSdkContentBlock}. */
export type QoderSdkTextBlock = QoderSdkContentBlock;

export interface QoderSdkMessage {
  [key: string]: unknown;
  type: string;
  subtype?: string;
  is_error?: boolean;
  error?: string;
  errors?: string[];
  result?: unknown;
  message?: { role?: string; content?: QoderSdkContentBlock[] | string };
  event?: QoderSdkStreamEvent;
  parent_tool_use_id?: string | null;
  uuid?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  total_credits?: number;
  usage?: Record<string, unknown>;
  modelUsage?: Record<string, unknown>;
  permission_denials?: unknown[];
  session_id?: string;
  stop_reason?: string | null;
  terminal_reason?: string | null;
}

export type QoderPermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "yolo"
  | "plan"
  | "dontAsk"
  | "auto";

export type QoderToolPermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string; interrupt?: boolean };

export type QoderToolPermissionCallback = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string; [key: string]: unknown },
) => Promise<QoderToolPermissionResult>;

/** One user turn pushed into a live query's message stream. */
export interface QoderSdkUserMessage {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: string | null;
}

export interface QoderSdkQueryOptions {
  auth: unknown;
  cwd?: string;
  allowedTools: string[];
  tools: string[];
  disallowedTools?: string[];
  permissionMode?: QoderPermissionMode;
  canUseTool?: QoderToolPermissionCallback;
  persistSession: boolean;
  maxTurns?: number;
  model?: string;
  enableFileCheckpointing?: boolean;
  abortController?: AbortController;
  settingSources?: QoderSettingSource[];
  skills?: string[] | "all";
  extensions?: string[];
  plugins?: unknown[];
  mcpServers?: Record<string, unknown>;
  strictMcpConfig?: boolean;
  systemPrompt?: QoderSystemPrompt;
  includePartialMessages?: boolean;
  /** Reopens a persisted host session instead of starting a fresh context. */
  resume?: string;
}

/**
 * The live query object the SDK returns: an async iterable of messages plus
 * turn/session control. `interrupt` and `close` are optional so a minimal test
 * double can still satisfy the surface, but the adapter uses them whenever the
 * host provides them.
 */
export interface QoderQueryLike extends AsyncIterable<QoderSdkMessage> {
  interrupt?(): Promise<unknown>;
  close?(): Promise<void>;
}

export interface QoderSdkLike {
  query(params: {
    /** A string is one ephemeral turn; an async iterable is a live session. */
    prompt: string | AsyncIterable<QoderSdkUserMessage>;
    options: QoderSdkQueryOptions;
  }): QoderQueryLike;
  qodercliAuth(): unknown;
}

export type QoderAuthFactory = (sdk: QoderSdkLike) => unknown;

export interface QoderSdkExecutorOptions {
  /** Injectable SDK loader for deterministic tests. */
  loadSdk?: () => Promise<QoderSdkLike>;
  /** Defaults to the locally signed-in qodercli session. */
  auth?: QoderAuthFactory;
  /** Explicit SDK tool allowlist. v0.1 defaults to no pre-authorized tools. */
  allowedTools?: string[];
  /** Tools visible to the session. v0.1 defaults to none. */
  tools?: string[];
  /** Tools removed from the session even when the runtime would normally expose them. */
  disallowedTools?: string[];
  /**
   * Extra DSL tool id → host tool and exact portable contract exposures.
   * Exposure is an adapter fact: it decides whether a `require tool` can be
   * materialized at all.
   */
  toolExposure?: Readonly<Record<string, AdapterToolExposure>>;
  permissionMode?: QoderPermissionMode;
  canUseTool?: QoderToolPermissionCallback;
  /** Persist the host transcript so a closed session can be resumed by id. */
  persistSession?: boolean;
  /** Bounds the whole query, so a multi-turn session needs more than one. */
  maxTurns?: number;
  model?: string;
  enableFileCheckpointing?: boolean;
  abortController?: AbortController;
  /** Receives each redacted SDK event as it arrives, including before a timeout. */
  onTraceEvent?: (event: unknown) => void;
  /** Receives lifecycle-ordered neutral run events while the run is in flight. */
  onRunEvent?: HarnessRunEventListener;
  /** A frozen executor-owned runtime contract. Defaults to the SDK-compatible v1 behavior. */
  profile?: QoderRuntimeProfile;
}

/**
 * `harness-adapter-v1` binding for the official Qoder Agent SDK.
 *
 * A session is one `query()` whose prompt is a live async iterable of user
 * messages: the CLI keeps the conversation, each prompt turn pushes one message
 * and drains the stream to that turn's `result`. `persistSession` therefore only
 * controls whether the transcript survives the query (and can be resumed by id),
 * not whether turn 2 remembers turn 1.
 *
 * Tool requirements are materialized, not narrated: the adapter exposes the host
 * tools its revision's tool capabilities map to, and records them in the run
 * receipt. Capabilities it cannot expose fail resolution instead of becoming a
 * prompt line.
 */
export class QoderSdkAdapter implements HarnessAdapterV1 {
  readonly specificationVersion = HARNESS_ADAPTER_SPECIFICATION_VERSION;
  readonly adapterId = "@harness/adapter-qoder";
  readonly host = "qoder";
  private readonly loadSdk: () => Promise<QoderSdkLike>;
  private readonly auth: QoderAuthFactory;
  private readonly allowedTools: string[];
  private readonly tools: string[];
  private readonly disallowedTools: string[];
  private readonly toolExposure: Readonly<Record<string, AdapterToolExposure>>;
  private readonly permissionMode?: QoderPermissionMode;
  private readonly canUseTool?: QoderToolPermissionCallback;
  private readonly persistSession: boolean;
  private readonly maxTurns?: number;
  private readonly model?: string;
  private readonly enableFileCheckpointing: boolean;
  private readonly abortController?: AbortController;
  private readonly onTraceEvent?: (event: unknown) => void;
  private readonly onRunEvent?: HarnessRunEventListener;
  private readonly profile: QoderRuntimeProfile;
  private readonly settingSources?: QoderSettingSource[];
  private readonly skills?: string[] | "all";
  private readonly extensions?: string[];
  private readonly plugins?: unknown[];
  private readonly mcpServers?: Record<string, unknown>;
  private readonly strictMcpConfig?: boolean;

  constructor(options: QoderSdkExecutorOptions = {}) {
    this.profile = options.profile ?? "qoder-default-v1";
    assertSupportedProfile(this.profile);
    if (this.profile === "qoder-minimal-v1") {
      assertMinimalProfileOptions(options);
    }
    this.loadSdk = () => loadQoderSdk(options.loadSdk);
    this.auth = options.auth ?? ((sdk) => sdk.qodercliAuth());
    this.allowedTools = this.profile === "qoder-minimal-v1" ? [] : [...(options.allowedTools ?? [])];
    this.tools = this.profile === "qoder-minimal-v1"
      ? [...QODER_MINIMAL_TOOLS]
      : [...(options.tools ?? [])];
    this.disallowedTools = this.profile === "qoder-minimal-v1"
      ? unique([...QODER_MINIMAL_DENIED_TOOLS, ...(options.disallowedTools ?? [])])
      : [...(options.disallowedTools ?? [])];
    this.toolExposure = buildQoderToolExposure({
      extra: options.toolExposure,
      // A pinned visible tool set is a ceiling: the adapter may only expose what
      // the caller already allowed into the session.
      visible: this.tools.length > 0 ? this.tools : undefined,
      denied: this.disallowedTools,
      ...(this.profile === "qoder-minimal-v1" ? { allowed: [...QODER_MINIMAL_TOOLS] } : {}),
    });
    this.permissionMode = this.profile === "qoder-minimal-v1" ? "default" : options.permissionMode;
    this.canUseTool = options.canUseTool;
    this.persistSession = this.profile === "qoder-minimal-v1" ? false : (options.persistSession ?? false);
    this.maxTurns = options.maxTurns;
    this.model = options.model;
    this.enableFileCheckpointing = options.enableFileCheckpointing ?? false;
    this.abortController = options.abortController;
    this.onTraceEvent = options.onTraceEvent;
    this.onRunEvent = options.onRunEvent;
    if (this.profile === "qoder-minimal-v1") {
      this.settingSources = [];
      this.skills = [];
      this.extensions = [];
      this.plugins = [];
      this.mcpServers = {};
      this.strictMcpConfig = true;
    }
  }

  /** The realization facts this adapter can back with real host behaviour. */
  describe(): AdapterRealizationDescriptor {
    const descriptor = describeAdapter({
      adapterId: this.adapterId,
      specificationVersion: HARNESS_ADAPTER_SPECIFICATION_VERSION,
      implementationVersion: QODER_ADAPTER_IMPLEMENTATION_VERSION,
      skillDelivery: { mechanism: "prompt-preamble" },
      toolExposure: this.toolExposure,
      // The adapter opens no MCP connection, so it claims none.
      mcpSupport: null,
      workflowModes: ["session"],
      programmaticLanguages: [],
    });
    return descriptorsEqual(descriptor, QODER_ADAPTER_DESCRIPTOR)
      ? QODER_ADAPTER_DESCRIPTOR
      : descriptor;
  }

  async doStart(start: HarnessAdapterStartOptions): Promise<HarnessAdapterSession> {
    const descriptor = this.describe();
    assertRegistryDescriptorCompatible(QODER_ADAPTER_DESCRIPTOR, descriptor);
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
    const { preamble, warnings } = buildRunPreamble(
      start.revision,
      start.bundle,
      receipt,
      deliveries,
    );
    return new QoderQuerySession({
      adapter: this,
      sdk,
      start,
      receipt,
      preamble,
      warnings,
      tools: unique([...this.tools, ...exposedHostTools(receipt)]),
    });
  }

  /** Query options for one session; `resume` reopens a persisted host session. */
  buildQueryOptions(context: {
    sdk: QoderSdkLike;
    workDir?: string;
    tools: string[];
    abortController: AbortController;
    resume?: string;
  }): QoderSdkQueryOptions {
    const systemPrompt = this.profile === "qoder-minimal-v1"
      ? buildQoderMinimalSystemPrompt(context.workDir)
      : undefined;
    return {
      auth: this.auth(context.sdk),
      ...(context.workDir !== undefined ? { cwd: context.workDir } : {}),
      allowedTools: [...this.allowedTools],
      tools: [...context.tools],
      disallowedTools: [...this.disallowedTools],
      persistSession: this.persistSession,
      ...(this.maxTurns !== undefined ? { maxTurns: this.maxTurns } : {}),
      enableFileCheckpointing: this.enableFileCheckpointing,
      includePartialMessages: true,
      ...(this.permissionMode !== undefined ? { permissionMode: this.permissionMode } : {}),
      ...(this.canUseTool !== undefined ? { canUseTool: this.canUseTool } : {}),
      ...(this.model !== undefined ? { model: this.model } : {}),
      abortController: context.abortController,
      ...(this.settingSources !== undefined ? { settingSources: [...this.settingSources] } : {}),
      ...(this.skills !== undefined ? { skills: Array.isArray(this.skills) ? [...this.skills] : this.skills } : {}),
      ...(this.extensions !== undefined ? { extensions: [...this.extensions] } : {}),
      ...(this.plugins !== undefined ? { plugins: [...this.plugins] } : {}),
      ...(this.mcpServers !== undefined ? { mcpServers: { ...this.mcpServers } } : {}),
      ...(this.strictMcpConfig !== undefined ? { strictMcpConfig: this.strictMcpConfig } : {}),
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(context.resume !== undefined ? { resume: context.resume } : {}),
    };
  }

  /** Non-secret record of what the executor actually asked the host for. */
  buildRuntimeReceipt(tools: string[], systemPromptConfigured: boolean): HarnessRuntimeReceipt {
    return {
      executor: "@qoder-ai/qoder-agent-sdk",
      runtimeProfile: this.profile,
      tools: [...tools],
      allowedTools: [...this.allowedTools],
      disallowedTools: [...this.disallowedTools],
      ...(this.permissionMode !== undefined ? { permissionMode: this.permissionMode } : {}),
      ...(this.maxTurns !== undefined ? { maxTurns: this.maxTurns } : {}),
      persistSession: this.persistSession,
      ...(this.model !== undefined ? { model: this.model } : {}),
      fileCheckpointing: this.enableFileCheckpointing,
      partialMessages: true,
      permissionCallback: this.canUseTool ? "configured" : "none",
      systemPromptSource: systemPromptConfigured ? "executor-profile" : "runtime-default",
      settingSources: this.settingSources === undefined ? "runtime-default" : [...this.settingSources],
      skills: this.skills === undefined
        ? "runtime-default"
        : Array.isArray(this.skills) ? [...this.skills] : this.skills,
      ...(this.extensions !== undefined ? { extensionCount: this.extensions.length } : {}),
      ...(this.plugins !== undefined ? { pluginCount: this.plugins.length } : {}),
      ...(this.mcpServers !== undefined ? { mcpServerNames: Object.keys(this.mcpServers).sort() } : {}),
      ...(this.strictMcpConfig !== undefined ? { strictMcpConfig: this.strictMcpConfig } : {}),
    };
  }

  get runtimeProfile(): QoderRuntimeProfile {
    return this.profile;
  }

  get traceListener(): ((event: unknown) => void) | undefined {
    return this.onTraceEvent;
  }

  get defaultRunEventListener(): HarnessRunEventListener | undefined {
    return this.onRunEvent;
  }

  get sharedAbortController(): AbortController | undefined {
    return this.abortController;
  }
}

/**
 * Guard the pure-data registry against drift in the adapter's own facts.
 *
 * The registry is the resolver-side mirror of what this adapter can do, so the
 * two must not disagree about the *standard* surface. Caller-supplied
 * exposures are a different thing: `toolExposure` is a documented extension
 * point for hosts that expose more than the standard map, and an extension the
 * registry has never heard of is not drift. Only a standard capability whose
 * host tool changed underneath the registry is.
 */
function assertRegistryDescriptorCompatible(
  registered: AdapterRealizationDescriptor,
  live: AdapterRealizationDescriptor,
): void {
  const withoutExposure = (
    descriptor: AdapterRealizationDescriptor,
  ): Omit<AdapterRealizationDescriptor, "toolExposure"> => {
    const { toolExposure: _toolExposure, ...facts } = descriptor;
    return facts;
  };
  if (!contentEquals(withoutExposure(registered), withoutExposure(live))) {
    throw new Error(`Adapter descriptor drift for '${live.adapterId}'; update the pure-data registry.`);
  }
  for (const [capability, exposure] of Object.entries(live.toolExposure)) {
    const standard = QODER_TOOL_EXPOSURE[capability];
    if (standard !== undefined && !contentEquals(standard, exposure)) {
      throw new Error(
        `Adapter descriptor drift for '${live.adapterId}' capability '${capability}': the standard ` +
          `map exposes '${standard.hostTool}' with contract '${standard.contract}' but this adapter ` +
          `reports '${exposure.hostTool}' with contract '${exposure.contract}'; update the pure-data registry.`,
      );
    }
  }
}

/**
 * One live Qoder query for the whole session.
 *
 * The official SDK models a multi-turn conversation as a single `query()` whose
 * prompt is an async iterable of user messages: the CLI keeps the context, the
 * host pushes turns, and `close()` / `interrupt()` end them. Calling `query()`
 * again per turn would start a new context, so `persistSession` alone never
 * proved turn 2 saw turn 1.
 */
class QoderQuerySession implements HarnessAdapterSession {
  readonly adapterId: string;
  readonly revisionId: string;
  private readonly adapter: QoderSdkAdapter;
  private readonly sdk: QoderSdkLike;
  private readonly start: HarnessAdapterStartOptions;
  private readonly receipt: HarnessMaterializationReceipt;
  private readonly preamble: string;
  private readonly warnings: string[];
  private readonly tools: string[];
  private readonly abortController: AbortController;
  private queue?: QoderTurnQueue;
  private query?: QoderQueryLike;
  private messages?: AsyncIterator<QoderSdkMessage>;
  private preambleSent = false;
  private turnInFlight = false;
  private ended = false;
  private hostSessionId?: string;

  constructor(context: {
    adapter: QoderSdkAdapter;
    sdk: QoderSdkLike;
    start: HarnessAdapterStartOptions;
    receipt: HarnessMaterializationReceipt;
    preamble: string;
    warnings: string[];
    tools: string[];
  }) {
    this.adapter = context.adapter;
    this.adapterId = context.adapter.adapterId;
    this.revisionId = context.start.revision.revisionId;
    this.sdk = context.sdk;
    this.start = context.start;
    this.receipt = context.receipt;
    this.preamble = context.preamble;
    this.warnings = context.warnings;
    this.tools = context.tools;
    this.abortController = context.adapter.sharedAbortController ?? new AbortController();
  }

  get sessionId(): string | undefined {
    return this.hostSessionId;
  }

  async doPromptTurn(turn: HarnessAdapterTurnOptions): Promise<HarnessRunResult> {
    if (this.ended) {
      throw new Error(`Qoder adapter session for '${this.revisionId}' has ended.`);
    }
    if (this.turnInFlight) {
      throw new HarnessConcurrentTurnError(this.adapterId, this.revisionId);
    }
    assertRevisionHost(this.start.revision, this.adapter.host);
    this.turnInFlight = true;
    const detachAbort = this.attachAbort(turn.abortSignal);
    try {
      return await this.runTurn(turn);
    } finally {
      detachAbort?.();
      this.turnInFlight = false;
    }
  }

  async doStop(): Promise<void> {
    this.ended = true;
    this.queue?.end();
    await this.closeQuery();
  }

  async doDestroy(): Promise<void> {
    this.ended = true;
    try {
      await this.query?.interrupt?.();
    } catch {
      // A torn-down session must not fail on an unacknowledged interrupt.
    }
    this.queue?.end();
    await this.closeQuery();
  }

  private async closeQuery(): Promise<void> {
    const query = this.query;
    this.query = undefined;
    this.messages = undefined;
    this.queue = undefined;
    try {
      await query?.close?.();
    } catch {
      // Closing is best effort: the run outcome is already decided.
    }
  }

  /**
   * Open the query once, or reopen it against the persisted host session when a
   * previous query already terminated (the CLI closes a query after its final
   * result when the caller does not keep streaming).
   */
  private ensureQuery(): AsyncIterator<QoderSdkMessage> {
    if (this.messages !== undefined) {
      return this.messages;
    }
    const queue = new QoderTurnQueue();
    this.queue = queue;
    const options = this.adapter.buildQueryOptions({
      sdk: this.sdk,
      ...(this.start.workDir !== undefined ? { workDir: this.start.workDir } : {}),
      tools: this.tools,
      abortController: this.abortController,
      ...(this.hostSessionId !== undefined ? { resume: this.hostSessionId } : {}),
    });
    const query = this.sdk.query({ prompt: queue, options });
    this.query = query;
    this.messages = query[Symbol.asyncIterator]();
    return this.messages;
  }

  private attachAbort(abortSignal?: AbortSignal): (() => void) | undefined {
    if (abortSignal === undefined) {
      return undefined;
    }
    const onAbort = (): void => {
      void this.interruptTurn();
    };
    if (abortSignal.aborted) {
      onAbort();
      return undefined;
    }
    abortSignal.addEventListener("abort", onAbort, { once: true });
    return () => abortSignal.removeEventListener("abort", onAbort);
  }

  /**
   * Turn abort is `interrupt()` when the host advertises it; otherwise the only
   * honest lever is aborting the session controller, which ends the query.
   */
  private async interruptTurn(): Promise<void> {
    try {
      if (typeof this.query?.interrupt === "function") {
        await this.query.interrupt();
        return;
      }
    } catch {
      // Fall through to the harder stop below.
    }
    this.abortController.abort();
    this.queue?.end();
  }

  private async runTurn(turn: HarnessAdapterTurnOptions): Promise<HarnessRunResult> {
    const revision = this.start.revision;
    const emitter = new HarnessRunEmitter(
      turn.onRunEvent ?? this.start.onRunEvent ?? this.adapter.defaultRunEventListener,
    );
    emitter.start({ revisionId: revision.revisionId, host: this.adapter.host });
    for (const warning of this.warnings) {
      emitter.warning(warning);
    }
    try {
      const includePreamble = !this.preambleSent && this.preamble.length > 0;
      this.preambleSent = true;
      const text = includePreamble ? `${this.preamble}\n\n${turn.prompt}` : turn.prompt;
      let drained = await this.deliverTurn(text, emitter);
      if (drained.deliveredNothing) {
        // The host ended the previous query before this turn reached it, and no
        // message came back, so nothing ran: reopen the query — resuming the
        // persisted transcript when the host gave us an id — and deliver once
        // more instead of reporting a turn the host never saw.
        drained = await this.deliverTurn(text, emitter);
      }
      if (drained.deliveredNothing) {
        // Reopening did not help: report a failed turn rather than an empty
        // success nobody ran.
        drained = {
          ...drained,
          exitCode: 1,
          errors: [...drained.errors, "Qoder SDK query terminated before the turn was delivered."],
        };
      }
      const errorOutput = drained.errors.filter(Boolean).join("\n");
      if (errorOutput.length > 0) {
        emitter.error(errorOutput);
      }
      emitter.finish(drained.exitCode, drained.metrics);
      return {
        host: this.adapter.host,
        revisionId: revision.revisionId,
        exitCode: drained.exitCode,
        output: drained.output,
        errorOutput,
        warnings: [...this.warnings],
        trace: drained.trace,
        runtimeReceipt: this.adapter.buildRuntimeReceipt(
          this.tools,
          this.adapter.runtimeProfile === "qoder-minimal-v1",
        ),
        materialization: this.receipt,
        ...(drained.metrics !== undefined ? { metrics: drained.metrics } : {}),
      };
    } catch (error) {
      emitter.error(error instanceof Error ? error.message : String(error));
      emitter.finish(1);
      throw error;
    }
  }

  /** Push one user message into the live query and drain that turn's messages. */
  private async deliverTurn(text: string, emitter: HarnessRunEmitter): Promise<DrainedTurn> {
    const messages = this.ensureQuery();
    this.queue?.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
    return this.drainTurn(messages, emitter);
  }

  /** Consume the shared message stream up to this turn's `result` message. */
  private async drainTurn(
    messages: AsyncIterator<QoderSdkMessage>,
    emitter: HarnessRunEmitter,
  ): Promise<DrainedTurn> {
    const output: string[] = [];
    const errors: string[] = [];
    const trace: unknown[] = [];
    const eventMappingState = createQoderSdkMessageMappingState();
    let metrics: HarnessRunResult["metrics"];
    let exitCode = 0;
    let sawResult = false;
    let received = 0;
    let streamEnded = false;
    for (;;) {
      const next = await messages.next();
      if (next.done === true) {
        // The query terminated: a later turn must reopen it (with `resume` when
        // the host persisted the transcript) rather than reuse a dead stream.
        streamEnded = true;
        this.messages = undefined;
        this.query = undefined;
        this.queue = undefined;
        break;
      }
      received += 1;
      const message = next.value;
      const traceEvent = redactTraceValue(message);
      trace.push(traceEvent);
      this.adapter.traceListener?.(traceEvent);
      applyQoderSdkMessage(emitter, traceEvent as QoderSdkMessage, eventMappingState);
      if (typeof message.session_id === "string") {
        this.hostSessionId = message.session_id;
      }
      if (message.type === "assistant") {
        for (const block of contentBlocks(message)) {
          if (block.type === "text" && typeof block.text === "string") {
            output.push(block.text);
          }
        }
      }
      if (message.type === "result") {
        sawResult = true;
        metrics = {
          ...(message.duration_ms !== undefined ? { durationMs: message.duration_ms } : {}),
          ...(message.duration_api_ms !== undefined ? { durationApiMs: message.duration_api_ms } : {}),
          ...(message.num_turns !== undefined ? { turns: message.num_turns } : {}),
          ...(message.total_cost_usd !== undefined ? { costUsd: message.total_cost_usd } : {}),
          ...(message.total_credits !== undefined ? { credits: message.total_credits } : {}),
          ...(message.usage !== undefined ? { usage: redactTraceValue(message.usage) as Record<string, unknown> } : {}),
          ...(message.modelUsage !== undefined
            ? { modelUsage: redactTraceValue(message.modelUsage) as Record<string, unknown> }
            : {}),
          ...(message.permission_denials !== undefined
            ? { permissionDenials: redactTraceValue(message.permission_denials) as unknown[] }
            : {}),
          ...(message.session_id !== undefined ? { sessionId: message.session_id } : {}),
          ...(message.stop_reason ? { stopReason: message.stop_reason } : {}),
          ...(message.terminal_reason ? { terminalReason: message.terminal_reason } : {}),
        };
        if (message.is_error === true || message.subtype !== "success") {
          exitCode = 1;
          errors.push(...(message.errors ?? [message.error ?? stringifyResult(message.result)]));
        }
        break;
      }
    }
    const deliveredNothing = streamEnded && received === 0;
    if (!sawResult && !deliveredNothing) {
      exitCode = 1;
      errors.push("Qoder SDK query ended without a result message.");
    }
    return {
      output: output.join(""),
      errors,
      trace,
      exitCode,
      deliveredNothing,
      ...(metrics !== undefined ? { metrics } : {}),
    };
  }
}

interface DrainedTurn {
  output: string;
  errors: string[];
  trace: unknown[];
  exitCode: number;
  /**
   * The query was already terminated when this turn was pushed, so the host
   * never saw it. The caller may safely deliver the same turn again.
   */
  deliveredNothing: boolean;
  metrics?: HarnessRunResult["metrics"];
}

/**
 * Push-based user message stream for one query.
 *
 * The SDK owns the pull side (`for await` inside `query`), the adapter owns the
 * push side (one message per prompt turn), and `end()` closes the input so the
 * host can finish the session.
 */
class QoderTurnQueue implements AsyncIterable<QoderSdkUserMessage> {
  private readonly pending: QoderSdkUserMessage[] = [];
  private waiting?: (result: IteratorResult<QoderSdkUserMessage>) => void;
  private closed = false;

  push(message: QoderSdkUserMessage): void {
    if (this.closed) {
      return;
    }
    const waiting = this.waiting;
    if (waiting !== undefined) {
      this.waiting = undefined;
      waiting({ value: message, done: false });
      return;
    }
    this.pending.push(message);
  }

  end(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const waiting = this.waiting;
    if (waiting !== undefined) {
      this.waiting = undefined;
      waiting({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<QoderSdkUserMessage> {
    return {
      next: (): Promise<IteratorResult<QoderSdkUserMessage>> => {
        const queued = this.pending.shift();
        if (queued !== undefined) {
          return Promise.resolve({ value: queued, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
      return: (): Promise<IteratorResult<QoderSdkUserMessage>> => {
        this.end();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

/** Execute one resolved revision through the official Qoder Agent SDK. */
export class QoderSdkExecutor implements HarnessExecutor {
  readonly host = "qoder";
  private readonly adapter: QoderSdkAdapter;
  private readonly onRunEvent?: HarnessRunEventListener;

  constructor(options: QoderSdkExecutorOptions = {}) {
    this.adapter = new QoderSdkAdapter(options);
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

function assertSupportedProfile(profile: QoderRuntimeProfile): void {
  if (profile !== "qoder-default-v1" && profile !== "qoder-minimal-v1") {
    throw new Error(`Unsupported Qoder runtime profile '${String(profile)}'.`);
  }
}

function assertMinimalProfileOptions(options: QoderSdkExecutorOptions): void {
  if (options.tools !== undefined && !sameToolSet(options.tools, QODER_MINIMAL_TOOLS)) {
    throw new Error(`qoder-minimal-v1 fixes the visible tools to: ${QODER_MINIMAL_TOOLS.join(", ")}.`);
  }
  if ((options.allowedTools?.length ?? 0) > 0) {
    throw new Error("qoder-minimal-v1 does not permit auto-approved tools; use canUseTool for bounded decisions.");
  }
  const minimalTools = new Set<string>(QODER_MINIMAL_TOOLS);
  const deniedRequired = options.disallowedTools?.filter((tool) => minimalTools.has(tool)) ?? [];
  if (deniedRequired.length > 0) {
    throw new Error(`qoder-minimal-v1 cannot disallow required tools: ${deniedRequired.join(", ")}.`);
  }
  if (options.permissionMode !== undefined && options.permissionMode !== "default") {
    throw new Error("qoder-minimal-v1 fixes permissionMode to 'default'.");
  }
  if (options.persistSession === true) {
    throw new Error("qoder-minimal-v1 requires an ephemeral session.");
  }
  if (options.canUseTool === undefined) {
    throw new Error("qoder-minimal-v1 requires canUseTool so every tool call has a host-owned decision.");
  }
}

function sameToolSet(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((tool) => actual.includes(tool));
}

/**
 * Narrow the standard exposure map to what this configuration can really back.
 *
 * A denied tool is never exposed, a frozen profile only exposes its fixed set,
 * and a caller-pinned visible list is a ceiling rather than a suggestion.
 */
function buildQoderToolExposure(limits: {
  extra?: Readonly<Record<string, AdapterToolExposure>>;
  visible?: readonly string[];
  denied: readonly string[];
  allowed?: readonly string[];
}): Readonly<Record<string, AdapterToolExposure>> {
  const exposure: Record<string, AdapterToolExposure> = {};
  for (const [capabilityId, entry] of Object.entries({ ...QODER_TOOL_EXPOSURE, ...limits.extra })) {
    if (limits.denied.includes(entry.hostTool)) continue;
    if (limits.allowed !== undefined && !limits.allowed.includes(entry.hostTool)) continue;
    if (limits.visible !== undefined && !limits.visible.includes(entry.hostTool)) continue;
    exposure[capabilityId] = Object.freeze({ ...entry });
  }
  return Object.freeze(exposure);
}

/**
 * Map one redacted SDK message onto the neutral run-event emitter.
 *
 * Only assistant content blocks produce activity events; lifecycle events
 * (`run-started`, `run-error`, `run-finished`) stay owned by the executor so
 * the emitter's invariants hold for every run.
 */
export interface QoderSdkMessageMappingState {
  /** Parent streams whose text has already been emitted from partial events. */
  partialTextParents: Set<string>;
}

export function createQoderSdkMessageMappingState(): QoderSdkMessageMappingState {
  return { partialTextParents: new Set<string>() };
}

const implicitMappingStates = new WeakMap<HarnessRunEmitter, QoderSdkMessageMappingState>();

export function applyQoderSdkMessage(
  emitter: HarnessRunEmitter,
  message: QoderSdkMessage,
  state = implicitStateFor(emitter),
): void {
  const parentKey = message.parent_tool_use_id ?? "root";
  if (message.type === "stream_event") {
    const delta = asRecord(message.event?.delta);
    if (
      message.event?.type === "content_block_delta" &&
      delta?.type === "text_delta" &&
      typeof delta.text === "string"
    ) {
      emitter.text(delta.text);
      state.partialTextParents.add(parentKey);
    }
    return;
  }
  if (message.type === "user") {
    for (const block of contentBlocks(message)) {
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        emitter.toolResult(
          block.tool_use_id,
          stringifyToolResult(block.content),
          {
            ...(typeof message.uuid === "string" ? { messageId: message.uuid } : {}),
            ...(block.is_error === true ? { isError: true } : {}),
          },
        );
      }
    }
    return;
  }
  if (message.type !== "assistant") {
    return;
  }
  const emittedPartialText = state.partialTextParents.delete(parentKey);
  for (const block of contentBlocks(message)) {
    if (block.type === "text" && typeof block.text === "string" && !emittedPartialText) {
      emitter.text(block.text);
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      emitter.toolCall(block.name, {
        ...(typeof block.id === "string" ? { toolUseId: block.id } : {}),
        ...(block.input !== undefined ? { input: block.input } : {}),
      });
    }
  }
}

function contentBlocks(message: QoderSdkMessage): QoderSdkContentBlock[] {
  return Array.isArray(message.message?.content) ? message.message.content : [];
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === undefined) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function implicitStateFor(emitter: HarnessRunEmitter): QoderSdkMessageMappingState {
  const existing = implicitMappingStates.get(emitter);
  if (existing !== undefined) {
    return existing;
  }
  const created = createQoderSdkMessageMappingState();
  implicitMappingStates.set(emitter, created);
  return created;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function buildQoderMinimalSystemPrompt(cwd?: string): string {
  const workingDirectory = cwd ?? process.cwd();
  return [
    "You are a focused coding agent operating inside the host-supplied working directory.",
    `The working directory is ${JSON.stringify(workingDirectory)}. Use relative paths such as package.json; do not guess other absolute roots.`,
    "Use only the Read, Write, Edit, and Bash tools exposed by the host.",
    "Inspect repository evidence before editing, keep changes inside the requested scope, and verify the result.",
    "Use Bash only for validation commands explicitly allowed by the task or host policy.",
    "Do not access the network, invent repository facts, or report success without concrete validation evidence.",
  ].join("\n");
}

const SECRET_FIELD = /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?account[_-]?key|secret|credential)/i;

/**
 * Recursively remove credential-shaped fields before persisting SDK events.
 *
 * Only the current ancestor chain is tracked, so a value referenced twice in
 * sibling positions is still recorded instead of being reported as a cycle.
 */
export function redactTraceValue(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (ancestors.has(value)) {
    return "[Circular]";
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactTraceValue(item, ancestors));
    }
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = SECRET_FIELD.test(key) ? "[REDACTED]" : redactTraceValue(item, ancestors);
    }
    return redacted;
  } finally {
    ancestors.delete(value);
  }
}

async function loadQoderSdk(loader?: () => Promise<QoderSdkLike>): Promise<QoderSdkLike> {
  try {
    if (loader) {
      return await loader();
    }
    const moduleName = QODER_SDK_MODULE;
    const sdk = await import(moduleName);
    return { query: sdk.query, qodercliAuth: sdk.qodercliAuth } as QoderSdkLike;
  } catch (error) {
    throw new Error(
      `The Qoder executor needs '${QODER_SDK_MODULE}'. Install workspace dependencies with: npm install`,
      { cause: error },
    );
  }
}

function stringifyResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  return result === undefined ? "Qoder SDK query failed." : JSON.stringify(result);
}
