import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { HarnessIrBundle, HarnessRevision } from "../ir/index.js";
import { ACP_ADAPTER_DESCRIPTOR } from "../resolver/adapter-registry.js";
import { verifyRevisionSourceLocks } from "../resolver/source-lock.js";
import { HarnessRunEmitter, type HarnessRunEventListener, type HarnessProtocolEvent } from "./events.js";
import { prepareMaterialization } from "./materialization.js";
import { loadSkillDeliveries } from "./skill-delivery.js";
import {
  buildRunPreamble,
  preflightRevision,
  type HarnessExecutor,
  type HarnessRunResult,
  type HarnessRunTask,
} from "./executor.js";

/**
 * Wire generation understood by this client. The host reports its own stamp from
 * `host.describe`; a mismatch is a deployment error rather than something to
 * negotiate, because the two ship together.
 */
const WIRE_VERSION = 1;
const HOST_PROTOCOL_VERSION = "acp-rust-2.0.0+jsonl-v1";
const RUNTIME_PROFILE = "acp-v1-rust";

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_PENDING = 64;
const MAX_PROTOCOL_EVENTS = 2_000;
const HOST_EXIT_GRACE_MS = 2_000;
const REQUEST_TIMEOUT_MS = 10 * 60_000;

/** A permission request the Agent is blocked on, as the host reports it. */
export interface AcpRustPermissionRequest {
  requestId: string;
  sessionId: string;
  toolCallId: string;
  title: string;
  options: ReadonlyArray<{ optionId: string; name: string; kind: string }>;
}

/** Resolve with a chosen optionId, or `undefined` to cancel the request. */
export type AcpRustPermissionHandler = (
  request: AcpRustPermissionRequest,
  signal: AbortSignal,
) => Promise<string | undefined>;

export interface AcpRustExecutorOptions {
  /**
   * Path to the `harness-acp-host` executable.
   *
   * Required and never resolved here: locating a staged binary is packaging
   * knowledge, and this package must not acquire any.
   */
  hostExecutable: string;
  /** The ACP Agent the host should spawn. */
  command: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /**
   * Directories the Agent may reach through `fs/*`.
   *
   * Omitted means none. The host fences every request against the canonical form
   * of these roots, so an omitted value denies access rather than widening it.
   */
  allowRoots?: readonly string[];
  onRunEvent?: HarnessRunEventListener;
  requestPermission?: AcpRustPermissionHandler;
  /** ACP session configuration applied after the session exists and before the prompt. */
  sessionConfig?: Readonly<Record<string, string | boolean>>;
  abortSignal?: AbortSignal;
  spawnHost?: typeof spawn;
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (result: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface HostEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * Execute one resolved prompt-session revision through the persistent Rust ACP host.
 *
 * # Relationship to {@link AcpSdkExecutor}
 *
 * Both report `host: "acp"`, because a revision declares which Harness host it
 * targets and `preflightRevision` requires the executor to match it. Choosing
 * the Rust host is a runtime decision, not a change to the authored revision, so
 * the distinction is recorded in `runtimeReceipt.runtimeProfile` instead of in
 * the DSL. That is what lets an existing ACP revision run here unchanged.
 */
export class AcpRustExecutor implements HarnessExecutor {
  readonly host = "acp";

  constructor(private readonly options: AcpRustExecutorOptions) {
    if (options.hostExecutable.trim().length === 0) {
      throw new Error("The ACP host executable must be a non-empty server-configured path.");
    }
    if (options.command.trim().length === 0) {
      throw new Error("ACP Agent command must be a non-empty server-configured executable.");
    }
  }

  async execute(
    revision: HarnessRevision,
    bundle: HarnessIrBundle,
    task: HarnessRunTask,
  ): Promise<HarnessRunResult> {
    preflightRevision(revision, bundle, this.host, ACP_ADAPTER_DESCRIPTOR);
    await verifyRevisionSourceLocks(
      revision,
      task.sourceRoot === undefined ? undefined : { root: task.sourceRoot },
    );
    const receipt = prepareMaterialization(revision, bundle, ACP_ADAPTER_DESCRIPTOR);
    const deliveries = await loadSkillDeliveries(revision, bundle, {
      ...(task.sourceRoot !== undefined ? { sourceRoot: task.sourceRoot } : {}),
    });
    const { preamble, warnings } = buildRunPreamble(revision, bundle, receipt, deliveries);
    const prompt = preamble.length > 0 ? `${preamble}\n\n${task.prompt}` : task.prompt;
    const emitter = new HarnessRunEmitter(this.options.onRunEvent);
    const trace: HarnessProtocolEvent[] = [];
    const output: string[] = [];
    const abortSignal = task.abortSignal ?? this.options.abortSignal;
    emitter.start({ revisionId: revision.revisionId, host: this.host });
    for (const warning of warnings) emitter.warning(warning);

    const acknowledgedSessionConfig: Record<string, string | boolean> = {};
    let sessionId: string | undefined;
    let stopReason: string | undefined;
    let client: HostClient | undefined;
    try {
      client = new HostClient(this.options, emitter, trace, output);
      const described = await client.call("host.describe", null);
      if (described.protocol !== HOST_PROTOCOL_VERSION) {
        throw new Error(
          `The ACP host speaks '${String(described.protocol)}' but this client speaks ` +
            `'${HOST_PROTOCOL_VERSION}'. Rebuild the host with: ` +
            "npm run build:rust -w @qoder-ai/better-harness-desktop",
        );
      }

      const connectionId = `run-${revision.revisionId}`;
      client.bindPermissions(connectionId, abortSignal);
      await client.call("connection.open", {
        connectionId,
        command: this.options.command,
        ...(this.options.args === undefined ? {} : { args: [...this.options.args] }),
        ...(this.options.env === undefined ? {} : { env: stringEnv(this.options.env) }),
        // Absent stays absent: the host must not be handed a default root.
        ...(this.options.allowRoots === undefined
          ? {}
          : { allowRoots: [...this.options.allowRoots] }),
      });

      const created = await client.call("session.create", {
        connectionId,
        cwd: task.cwd ?? process.cwd(),
      });
      sessionId = typeof created.sessionId === "string" ? created.sessionId : undefined;
      if (sessionId === undefined) {
        throw new Error("The ACP host did not return a session id.");
      }

      for (const [configId, value] of Object.entries(this.options.sessionConfig ?? {}).sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        // The host verifies the Agent acknowledged each option and fails the call
        // when it did not, so a silently ignored model cannot reach the receipt.
        await client.call("session.setConfigOption", {
          connectionId,
          sessionId,
          configId,
          value,
        });
        acknowledgedSessionConfig[configId] = value;
      }

      if (abortSignal?.aborted === true) {
        stopReason = "cancelled";
      } else {
        const cancel = (): void => {
          void client?.call("session.cancel", { connectionId, sessionId }).catch(() => undefined);
        };
        abortSignal?.addEventListener("abort", cancel, { once: true });
        try {
          const finished = await client.call("session.prompt", {
            connectionId,
            sessionId,
            prompt,
          });
          stopReason = typeof finished.stopReason === "string" ? finished.stopReason : undefined;
        } finally {
          abortSignal?.removeEventListener("abort", cancel);
        }
      }

      const exitCode = stopReason === "end_turn" ? 0 : 1;
      const errorOutput = exitCode === 0 ? "" : `ACP Agent stopped with reason '${stopReason}'.`;
      if (exitCode !== 0) emitter.error(errorOutput);
      emitter.finish(exitCode, metricsFor(sessionId, stopReason));
      return {
        host: this.host,
        revisionId: revision.revisionId,
        exitCode,
        output: output.join(""),
        errorOutput,
        warnings,
        trace,
        runtimeReceipt: this.receiptFor(acknowledgedSessionConfig),
        materialization: receipt,
        metrics: metricsFor(sessionId, stopReason),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = client?.decorate(message) ?? message;
      emitter.error(detail);
      emitter.finish(1, metricsFor(sessionId, stopReason));
      return {
        host: this.host,
        revisionId: revision.revisionId,
        exitCode: 1,
        output: output.join(""),
        errorOutput: detail,
        warnings,
        trace,
        runtimeReceipt: this.receiptFor(acknowledgedSessionConfig),
        materialization: receipt,
        metrics: metricsFor(sessionId, stopReason),
      };
    } finally {
      // Closing the host makes it drop its connections, which is what reaps the
      // Agent's process group. A caller that removes the run workspace right
      // after `execute` would otherwise hit EBUSY on Windows.
      await client?.close();
    }
  }

  private receiptFor(sessionConfig: Record<string, string | boolean>): HarnessRunResult["runtimeReceipt"] {
    const fs = (this.options.allowRoots?.length ?? 0) > 0;
    return {
      executor: "harness-acp-host",
      runtimeProfile: RUNTIME_PROFILE,
      // Only capabilities actually granted are listed; the receipt must not
      // advertise reach the host was never given.
      tools: fs ? ["fs/read_text_file", "fs/write_text_file"] : [],
      allowedTools: [],
      disallowedTools: [],
      persistSession: false,
      ...(typeof sessionConfig.model === "string" ? { model: sessionConfig.model } : {}),
      ...(Object.keys(sessionConfig).length > 0 ? { sessionConfig } : {}),
      permissionCallback: this.options.requestPermission === undefined ? "none" : "configured",
    };
  }
}

function metricsFor(sessionId: string | undefined, stopReason: string | undefined) {
  return {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(stopReason !== undefined ? { stopReason } : {}),
  };
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])),
  );
}

/**
 * One host process and the framed conversation with it.
 *
 * Requests and unsolicited events share stdout; a frame carrying an `id` is a
 * reply and one without is an event. That single rule is the whole
 * demultiplexing contract, which is why events need no correlation field.
 */
class HostClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = "";
  private sequence = 0;
  private stderr = "";
  private failure: Error | undefined;
  private connectionId: string | undefined;
  private abortSignal: AbortSignal | undefined;
  private readonly exited: Promise<void>;

  constructor(
    private readonly options: AcpRustExecutorOptions,
    private readonly emitter: HarnessRunEmitter,
    private readonly trace: HarnessProtocolEvent[],
    private readonly output: string[],
  ) {
    const launch = options.spawnHost ?? spawn;
    this.child = launch(options.hostExecutable, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.exited = new Promise((resolvePromise) => {
      this.child.once("exit", () => resolvePromise());
      this.child.once("error", () => resolvePromise());
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = retainTail(this.stderr + chunk, 64 * 1024);
    });
    this.child.once("error", () =>
      this.fail(new Error(`The ACP host at '${options.hostExecutable}' could not start.`)),
    );
    this.child.once("exit", () => this.fail(new Error("The ACP host exited during the run.")));
    this.child.stdin.on("error", () => this.fail(new Error("The ACP host closed its input.")));
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.ingest(chunk));
  }

  /** Route permission requests for one connection to the configured handler. */
  bindPermissions(connectionId: string, abortSignal: AbortSignal | undefined): void {
    this.connectionId = connectionId;
    this.abortSignal = abortSignal;
  }

  /** Append retained host stderr, which usually names the real cause. */
  decorate(message: string): string {
    const detail = this.stderr.trim();
    return detail.length > 0 ? `${message}\n${detail}` : message;
  }

  async call(method: string, params: unknown): Promise<Record<string, unknown>> {
    if (this.failure !== undefined) throw this.failure;
    if (this.pending.size >= MAX_PENDING) throw new Error("The ACP host request queue is full.");
    const id = ++this.sequence;
    const frame = `${JSON.stringify({ version: WIRE_VERSION, id, method, params })}\n`;
    if (Buffer.byteLength(frame) > MAX_REQUEST_BYTES) {
      throw new Error(`An ACP host '${method}' request exceeds its frame limit.`);
    }
    return await new Promise<Record<string, unknown>>((resolvePromise, reject) => {
      const timer = setTimeout(
        () => this.settle(id, undefined, new Error(`The ACP host '${method}' request timed out.`)),
        REQUEST_TIMEOUT_MS,
      );
      timer.unref?.();
      this.pending.set(id, { method, resolve: resolvePromise, reject, timer });
      this.child.stdin.write(frame, (error) => {
        if (error) this.fail(new Error(`Writing to the ACP host failed: ${error.message}`));
      });
    });
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    // Ask first so the host drops its connections in order; kill only if it
    // ignores the request.
    await this.call("shutdown", null).catch(() => undefined);
    this.child.stdin.end();
    await Promise.race([this.exited, delay(HOST_EXIT_GRACE_MS)]);
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGKILL");
      await Promise.race([this.exited, delay(HOST_EXIT_GRACE_MS)]);
    }
    this.fail(new Error("The ACP host is closed."));
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_FRAME_BYTES) {
      this.fail(new Error("An ACP host frame exceeds its size limit."));
      return;
    }
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(line) as Record<string, unknown>;
      } catch {
        this.fail(new Error("The ACP host emitted a malformed frame."));
        return;
      }
      if (frame.version !== WIRE_VERSION) {
        this.fail(new Error("The ACP host emitted a frame from another envelope generation."));
        return;
      }
      if (frame.id === undefined) {
        this.apply(frame.event as HostEvent | undefined);
        continue;
      }
      const id = Number(frame.id);
      const error = frame.error as { code?: unknown; message?: unknown } | undefined;
      this.settle(
        id,
        frame.result as Record<string, unknown> | undefined,
        error === undefined
          ? undefined
          : new Error(`${String(error.code)}: ${String(error.message)}`),
      );
    }
  }

  private settle(
    id: number,
    result: Record<string, unknown> | undefined,
    error: Error | undefined,
  ): void {
    const request = this.pending.get(id);
    if (request === undefined) return;
    clearTimeout(request.timer);
    this.pending.delete(id);
    if (error !== undefined) request.reject(error);
    else request.resolve(result ?? {});
  }

  /** Fail every outstanding request once, so no caller waits on a dead host. */
  private fail(error: Error): void {
    if (this.failure !== undefined) return;
    this.failure = error;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(this.stderr.trim().length > 0 ? new Error(this.decorate(error.message)) : error);
    }
    this.pending.clear();
  }

  private apply(event: HostEvent | undefined): void {
    if (event === undefined || typeof event.type !== "string") return;
    switch (event.type) {
      case "entry-appended":
      case "entry-updated": {
        this.applyEntry(event);
        return;
      }
      case "permission-requested": {
        void this.decide(event);
        return;
      }
      case "protocol-frame": {
        const direction = event.direction;
        if (direction !== "Client → Agent" && direction !== "Agent → Client") return;
        const retained: HarnessProtocolEvent = {
          protocol: "acp",
          direction,
          method: String(event.method ?? "response"),
          ...(typeof event.rpcId === "string" ? { rpcId: event.rpcId } : {}),
          ...(typeof event.sessionId === "string" ? { sessionId: event.sessionId } : {}),
          payload: event.payload,
        };
        if (this.trace.length < MAX_PROTOCOL_EVENTS) this.trace.push(retained);
        this.emitter.protocol(retained);
        return;
      }
      case "connection-lost": {
        this.fail(
          new Error(
            typeof event.detail === "string"
              ? `The ACP Agent exited: ${event.detail}`
              : "The ACP Agent exited.",
          ),
        );
        return;
      }
      default:
        // Status, usage, and permission-resolved notices carry no transcript
        // change; ignoring an unrecognised event keeps a newer host usable.
        return;
    }
  }

  /**
   * Project one transcript entry onto the neutral run event stream.
   *
   * The host reports the whole entry each time, so text is diffed against what
   * was already emitted and only the new suffix becomes a delta. Without that,
   * every chunk would re-send the paragraph it grew.
   */
  private applyEntry(event: HostEvent): void {
    const entry = event.entry as Record<string, unknown> | undefined;
    if (entry === undefined || typeof event.index !== "number") return;
    if (entry.kind === "assistant-message") {
      const chunks = Array.isArray(entry.chunks) ? entry.chunks : [];
      const text = chunks
        .flatMap((chunk) => {
          const record = chunk as Record<string, unknown>;
          return record.kind === "message" && typeof record.text === "string" ? [record.text] : [];
        })
        .join("");
      const already = this.emittedText.get(event.index) ?? "";
      if (text === already) return;
      // A pure extension is a delta; anything else means the host replaced the
      // entry, and re-emitting the whole text is the only honest option.
      const suffix = text.startsWith(already) ? text.slice(already.length) : text;
      this.emittedText.set(event.index, text);
      this.output.push(suffix);
      this.emitter.text(suffix);
      return;
    }
    if (entry.kind === "tool-call" && typeof entry.toolCallId === "string") {
      const toolCallId = entry.toolCallId;
      if (!this.emittedTools.has(toolCallId)) {
        this.emittedTools.add(toolCallId);
        this.emitter.toolCall(typeof entry.title === "string" ? entry.title : "Tool", {
          toolUseId: toolCallId,
          ...(entry.rawInput === undefined ? {} : { input: entry.rawInput }),
        });
      }
      const status = entry.status;
      if ((status === "completed" || status === "failed") && !this.settledTools.has(toolCallId)) {
        this.settledTools.add(toolCallId);
        this.emitter.toolResult(
          toolCallId,
          entry.rawOutput === undefined ? "" : stringify(entry.rawOutput),
          { isError: status === "failed" },
        );
      }
    }
  }

  private readonly emittedText = new Map<number, string>();
  private readonly emittedTools = new Set<string>();
  private readonly settledTools = new Set<string>();

  private async decide(event: HostEvent): Promise<void> {
    const requestId = typeof event.requestId === "string" ? event.requestId : undefined;
    if (requestId === undefined) return;
    const handler = this.options.requestPermission;
    const options = (Array.isArray(event.options) ? event.options : []).flatMap((value) => {
      const option = value as Record<string, unknown>;
      return typeof option.optionId === "string" &&
        typeof option.name === "string" &&
        typeof option.kind === "string"
        ? [{ optionId: option.optionId, name: option.name, kind: option.kind }]
        : [];
    });
    let optionId: string | undefined;
    if (handler !== undefined && this.abortSignal?.aborted !== true) {
      optionId = await handler(
        {
          requestId,
          sessionId: typeof event.sessionId === "string" ? event.sessionId : "",
          toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : "",
          title: typeof event.title === "string" ? event.title : "Agent action",
          options,
        },
        this.abortSignal ?? new AbortController().signal,
      ).catch(() => undefined);
    }
    // No configured handler, an aborted run, or a handler that declined all
    // cancel the request; the Agent must never be left waiting.
    await this.call("permission.decide", {
      requestId,
      ...(optionId === undefined ? {} : { optionId }),
    }).catch(() => undefined);
  }
}

function stringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function retainTail(value: string, max: number): string {
  return value.length <= max ? value : value.slice(value.length - max);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms).unref?.();
  });
}
