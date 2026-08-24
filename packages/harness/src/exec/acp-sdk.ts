import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type {
  AnyMessage,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
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
import { redactTraceValue } from "./qoder-sdk.js";

const ACP_SDK_MODULE = "@agentclientprotocol/sdk";
const MAX_PROTOCOL_EVENTS = 2_000;
const MAX_PROTOCOL_PAYLOAD_BYTES = 65_536;
const AGENT_EXIT_GRACE_MS = 2_000;

type AcpSdk = typeof import("@agentclientprotocol/sdk");

export type AcpPermissionHandler = (
  requestId: string,
  request: RequestPermissionRequest,
  signal: AbortSignal,
) => Promise<RequestPermissionResponse>;

export interface AcpSdkExecutorOptions {
  command: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  onRunEvent?: HarnessRunEventListener;
  requestPermission?: AcpPermissionHandler;
  abortSignal?: AbortSignal;
  loadSdk?: () => Promise<AcpSdk>;
  spawnAgent?: typeof spawn;
}

/** Execute one resolved prompt-session revision through a local ACP v1 Agent. */
export class AcpSdkExecutor implements HarnessExecutor {
  readonly host = "acp";

  constructor(private readonly options: AcpSdkExecutorOptions) {
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
    const tools = new Map<string, { resultEmitted: boolean }>();
    const abortSignal = task.abortSignal ?? this.options.abortSignal;
    emitter.start({ revisionId: revision.revisionId, host: this.host });
    for (const warning of warnings) emitter.warning(warning);

    let child: ChildProcessWithoutNullStreams | undefined;
    let stopReason: string | undefined;
    let sessionId: string | undefined;
    let stderr = "";
    try {
      const sdk = await (this.options.loadSdk?.() ?? loadAcpSdk());
      child = (this.options.spawnAgent ?? spawn)(
        this.options.command,
        [...(this.options.args ?? [])],
        {
          cwd: task.cwd,
          env: this.options.env ?? process.env,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      ) as ChildProcessWithoutNullStreams;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr = retainText(stderr + chunk, MAX_PROTOCOL_PAYLOAD_BYTES);
      });
      const childFailure = new Promise<never>((_resolve, reject) => {
        child!.once("error", reject);
      });

      const pendingMethods = new Map<string, string>();
      const retainWireMessage = (
        direction: HarnessProtocolEvent["direction"],
        message: AnyMessage,
      ): void => {
        const record = message as unknown as Record<string, unknown>;
        const rpcId = record.id === undefined ? undefined : String(record.id);
        if (typeof record.method === "string" && rpcId !== undefined) {
          const responseDirection = direction === "Client → Agent" ? "Agent → Client" : "Client → Agent";
          pendingMethods.set(`${responseDirection}:${rpcId}`, record.method);
        }
        const method = typeof record.method === "string"
          ? record.method
          : rpcId === undefined
            ? "response"
            : `${pendingMethods.get(`${direction}:${rpcId}`) ?? "response"}:response`;
        const payload = boundedProtocolPayload(record);
        const event: HarnessProtocolEvent = {
          protocol: "acp",
          direction,
          method,
          ...(rpcId !== undefined ? { rpcId } : {}),
          ...(sessionId !== undefined ? { sessionId } : {}),
          payload,
        };
        if (trace.length < MAX_PROTOCOL_EVENTS) trace.push(event);
        emitter.protocol(event);
      };

      const outbound = tapNdjsonStream("Client → Agent", retainWireMessage);
      const inbound = tapNdjsonStream("Agent → Client", retainWireMessage);
      const stdinPipe = outbound.readable.pipeTo(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      ).catch(() => undefined);
      const stdoutPipe = (Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)
        .pipeTo(inbound.writable)
        .catch(() => undefined);
      const stream = sdk.ndJsonStream(outbound.writable, inbound.readable);
      const client = sdk.client({ name: "Better Harness Studio" })
        .onRequest(sdk.methods.client.session.requestPermission, async (context) => {
          const requestId = String(context.requestId);
          if (abortSignal?.aborted === true || this.options.requestPermission === undefined) {
            return { outcome: { outcome: "cancelled" } };
          }
          return this.options.requestPermission(requestId, context.params, context.signal);
        })
        .onNotification(sdk.methods.client.session.update, (context) => {
          applyAcpSessionUpdate(emitter, context.params, output, tools);
        });

      const connection = client.connectWith(stream, async (agent) => {
        await requestWithAbort(() => agent.request(sdk.methods.agent.initialize, {
          protocolVersion: sdk.PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "Better Harness Studio", version: "0.1.1" },
        }, abortSignal === undefined ? undefined : { cancellationSignal: abortSignal }), abortSignal, "initialize");
        const created = await requestWithAbort(() => agent.request(sdk.methods.agent.session.new, {
          cwd: task.cwd ?? process.cwd(),
          mcpServers: [],
        }, abortSignal === undefined ? undefined : { cancellationSignal: abortSignal }), abortSignal, "session/new");
        sessionId = created.sessionId;
        const cancel = async (): Promise<void> => {
          await agent.notify(sdk.methods.agent.session.cancel, { sessionId: created.sessionId });
        };
        if (abortSignal?.aborted === true) {
          await cancel();
          return { stopReason: "cancelled" as const };
        }
        const notifyCancel = (): void => { void cancel(); };
        abortSignal?.addEventListener("abort", notifyCancel, { once: true });
        try {
          return await requestWithAbort(() => agent.request(sdk.methods.agent.session.prompt, {
            sessionId: created.sessionId,
            prompt: [{ type: "text", text: prompt }],
          }, abortSignal === undefined ? undefined : { cancellationSignal: abortSignal }), abortSignal, "session/prompt");
        } finally {
          abortSignal?.removeEventListener("abort", notifyCancel);
        }
      });
      const result = await Promise.race([connection, childFailure]);
      stopReason = result.stopReason;
      // The ACP turn is complete once the prompt response arrives. Long-lived
      // Agents are not required to close stdio after one session, so do not
      // wait for transport EOF before returning this single-run executor.
      void stdinPipe;
      void stdoutPipe;

      const exitCode = stopReason === "end_turn" ? 0 : 1;
      if (exitCode !== 0) {
        emitter.error(`ACP Agent stopped with reason '${stopReason}'.`);
      }
      emitter.finish(exitCode, {
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(stopReason !== undefined ? { stopReason } : {}),
      });
      return {
        host: this.host,
        revisionId: revision.revisionId,
        exitCode,
        output: output.join(""),
        errorOutput: exitCode === 0 ? "" : `ACP Agent stopped with reason '${stopReason}'.`,
        warnings,
        trace,
        runtimeReceipt: {
          executor: ACP_SDK_MODULE,
          runtimeProfile: "acp-v1-stdio",
          tools: [],
          allowedTools: [],
          disallowedTools: [],
          persistSession: false,
          permissionCallback: this.options.requestPermission === undefined ? "none" : "configured",
        },
        materialization: receipt,
        metrics: {
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(stopReason !== undefined ? { stopReason } : {}),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = stderr.trim().length > 0 ? `${message}\n${stderr.trim()}` : message;
      emitter.error(detail);
      emitter.finish(1, {
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(stopReason !== undefined ? { stopReason } : {}),
      });
      return {
        host: this.host,
        revisionId: revision.revisionId,
        exitCode: 1,
        output: output.join(""),
        errorOutput: detail,
        warnings,
        trace,
        runtimeReceipt: {
          executor: ACP_SDK_MODULE,
          runtimeProfile: "acp-v1-stdio",
          tools: [],
          allowedTools: [],
          disallowedTools: [],
          persistSession: false,
          permissionCallback: this.options.requestPermission === undefined ? "none" : "configured",
        },
        materialization: receipt,
        metrics: {
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(stopReason !== undefined ? { stopReason } : {}),
        },
      };
    } finally {
      await reapAgent(child);
    }
  }
}

/**
 * Terminate the Agent and wait for its exit before the run resolves. A live
 * child holds an open handle on its cwd, so a caller that removes the run
 * workspace right after `execute` fails with EBUSY on Windows.
 */
async function reapAgent(child: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolvePromise) => {
    child.once("exit", () => resolvePromise());
    child.once("error", () => resolvePromise());
  });
  child.kill();
  await Promise.race([exited, delay(AGENT_EXIT_GRACE_MS)]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await Promise.race([exited, delay(AGENT_EXIT_GRACE_MS)]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms).unref();
  });
}

async function requestWithAbort<T>(
  request: () => Promise<T>,
  signal: AbortSignal | undefined,
  method: string,
): Promise<T> {
  if (signal === undefined) return request();
  if (signal.aborted) throw new Error(`ACP ${method} cancelled.`);
  let timeout: NodeJS.Timeout | undefined;
  let rejectCancellation: ((error: Error) => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const abort = (): void => {
    timeout = setTimeout(() => rejectCancellation?.(new Error(`ACP ${method} cancelled.`)), 1_500);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([request(), cancellation]);
  } finally {
    signal.removeEventListener("abort", abort);
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function applyAcpSessionUpdate(
  emitter: HarnessRunEmitter,
  notification: SessionNotification,
  output: string[],
  tools: Map<string, { resultEmitted: boolean }>,
): void {
  const update = notification.update;
  if (update.sessionUpdate === "agent_message_chunk") {
    if (update.content.type === "text") {
      output.push(update.content.text);
      emitter.text(update.content.text);
    }
    return;
  }
  if (update.sessionUpdate === "tool_call") {
    ensureToolCall(emitter, update, tools);
    emitToolResult(emitter, update, tools);
    return;
  }
  if (update.sessionUpdate === "tool_call_update") {
    ensureToolCall(emitter, update, tools);
    emitToolResult(emitter, update, tools);
  }
}

function ensureToolCall(
  emitter: HarnessRunEmitter,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>,
  tools: Map<string, { resultEmitted: boolean }>,
): void {
  if (tools.has(update.toolCallId)) return;
  emitter.toolCall(toolName(update), {
    toolUseId: update.toolCallId,
    ...(update.rawInput !== undefined ? { input: update.rawInput } : {}),
  });
  tools.set(update.toolCallId, { resultEmitted: false });
}

function emitToolResult(
  emitter: HarnessRunEmitter,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>,
  tools: Map<string, { resultEmitted: boolean }>,
): void {
  const state = tools.get(update.toolCallId);
  if (state === undefined || state.resultEmitted || (update.status !== "completed" && update.status !== "failed")) return;
  const content = update.rawOutput === undefined
    ? update.content === undefined || update.content === null ? "" : JSON.stringify(update.content)
    : stringifyProtocolValue(update.rawOutput);
  emitter.toolResult(update.toolCallId, content, { isError: update.status === "failed" });
  state.resultEmitted = true;
}

function toolName(update: Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>): string {
  const experimentalName = "name" in update && typeof update.name === "string" ? update.name : undefined;
  return experimentalName ?? update.title ?? update.kind ?? "Tool";
}

function tapNdjsonStream(
  direction: HarnessProtocolEvent["direction"],
  onMessage: (direction: HarnessProtocolEvent["direction"], message: AnyMessage) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffered = "";
  const inspect = (text: string): void => {
    buffered += text;
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline < 0) break;
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line.length === 0) continue;
      try {
        onMessage(direction, JSON.parse(line) as AnyMessage);
      } catch {
        // The official SDK owns validation. Malformed input will fail there;
        // the evidence tap never mutates or repairs the wire bytes.
      }
    }
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      inspect(decoder.decode(chunk, { stream: true }));
      controller.enqueue(chunk);
    },
    flush() {
      inspect(decoder.decode());
    },
  });
}

function boundedProtocolPayload(value: unknown): unknown {
  const redacted = redactTraceValue(value);
  const serialized = stringifyProtocolValue(redacted);
  const bytes = new TextEncoder().encode(serialized);
  if (bytes.byteLength <= MAX_PROTOCOL_PAYLOAD_BYTES) return redacted;
  return {
    truncated: true,
    originalBytes: bytes.byteLength,
    preview: new TextDecoder().decode(bytes.subarray(0, MAX_PROTOCOL_PAYLOAD_BYTES)),
  };
}

function stringifyProtocolValue(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function retainText(value: string, max: number): string {
  const bytes = new TextEncoder().encode(value);
  return bytes.byteLength <= max
    ? value
    : new TextDecoder().decode(bytes.subarray(bytes.byteLength - max));
}

async function loadAcpSdk(): Promise<AcpSdk> {
  try {
    const moduleName = ACP_SDK_MODULE;
    return await import(moduleName);
  } catch (error) {
    throw new Error(
      `The ACP executor needs '${ACP_SDK_MODULE}'. Install workspace dependencies with: npm install`,
      { cause: error },
    );
  }
}
