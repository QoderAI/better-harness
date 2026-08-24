import type { HarnessRunMetrics } from "./executor.js";

export const MAX_RETAINED_TOOL_RESULT_BYTES = 65_536;

export interface HarnessToolResultOptions {
  messageId?: string;
  isError?: boolean;
}

export interface HarnessProtocolEvent {
  protocol: "acp";
  direction: "Client → Agent" | "Agent → Client";
  method: string;
  rpcId?: string;
  sessionId?: string;
  payload: unknown;
}

/**
 * Host-neutral streaming run events.
 *
 * Executors emit these while a run is in flight so protocol adapters
 * (AG-UI, TUIs, dashboards) can render live progress without depending on a
 * host SDK's message shape. Payloads are redacted before mapping; events must
 * never carry credential-shaped fields.
 *
 * Lifecycle invariants (enforced by {@link HarnessRunEmitter}):
 *
 * 1. A run emits exactly one `run-started` first and exactly one
 *    `run-finished` last; events after `run-finished` are dropped.
 * 2. Text is always framed: `message-started`, one or more `text-delta`,
 *    `message-finished`. Frames never interleave with tool calls.
 * 3. Tool calls are emitted as a `tool-call-started` / `tool-call-finished`
 *    argument pair; any open message is closed before the pair begins. A later
 *    `tool-call-result` carries retained execution output when the host exposes
 *    it.
 * 4. `run-error` only occurs between `run-started` and `run-finished`, after
 *    any open message is closed. It reports failure; `run-finished` still
 *    terminates the stream with the exit code.
 */
export type HarnessRunEvent =
  | { type: "run-started"; revisionId: string; host: string }
  | { type: "run-warning"; message: string }
  | { type: "message-started"; messageId: string }
  | { type: "text-delta"; messageId: string; text: string }
  | { type: "message-finished"; messageId: string }
  | { type: "tool-call-started"; toolCallId: string; toolName: string; input?: unknown }
  | { type: "tool-call-finished"; toolCallId: string }
  | {
      type: "tool-call-result";
      toolCallId: string;
      messageId?: string;
      content: string;
      isError?: boolean;
      truncated?: boolean;
      originalBytes?: number;
    }
  | ({ type: "protocol-event" } & HarnessProtocolEvent)
  | { type: "run-error"; message: string }
  | { type: "run-finished"; exitCode: number; metrics?: HarnessRunMetrics };

export type HarnessRunEventListener = (event: HarnessRunEvent) => void;

export type HarnessRunPhase = "idle" | "running" | "finished";

/**
 * The lifecycle guard between an executor and its observers.
 *
 * Executors call intent-level methods (`text`, `toolCall`, `finish`); the
 * emitter turns them into a well-formed event sequence. Out-of-phase calls
 * are ignored rather than thrown, and listener failures are swallowed, so an
 * observer can never abort or corrupt an execution.
 */
export class HarnessRunEmitter {
  private currentPhase: HarnessRunPhase = "idle";
  private openMessageId: string | undefined;
  private messageCount = 0;
  private toolCallCount = 0;

  constructor(private readonly listener?: HarnessRunEventListener) {}

  get phase(): HarnessRunPhase {
    return this.currentPhase;
  }

  start(run: { revisionId: string; host: string }): void {
    if (this.currentPhase !== "idle") {
      return;
    }
    this.currentPhase = "running";
    this.deliver({ type: "run-started", revisionId: run.revisionId, host: run.host });
  }

  warning(message: string): void {
    if (this.currentPhase !== "running") {
      return;
    }
    this.deliver({ type: "run-warning", message });
  }

  /** Append assistant text, opening a message frame when none is open. */
  text(text: string): void {
    if (this.currentPhase !== "running" || text.length === 0) {
      return;
    }
    if (this.openMessageId === undefined) {
      this.messageCount += 1;
      this.openMessageId = `msg_${this.messageCount}`;
      this.deliver({ type: "message-started", messageId: this.openMessageId });
    }
    this.deliver({ type: "text-delta", messageId: this.openMessageId, text });
  }

  /** Record one complete tool invocation, closing any open message frame first. */
  toolCall(toolName: string, options: { toolUseId?: string; input?: unknown } = {}): string | undefined {
    if (this.currentPhase !== "running") {
      return undefined;
    }
    this.closeOpenMessage();
    const toolCallId = options.toolUseId ?? `call_${(this.toolCallCount += 1)}`;
    this.deliver({
      type: "tool-call-started",
      toolCallId,
      toolName,
      ...(options.input !== undefined ? { input: options.input } : {}),
    });
    this.deliver({ type: "tool-call-finished", toolCallId });
    return toolCallId;
  }

  /** Attach retained host output to an earlier tool invocation. */
  toolResult(toolCallId: string, content: string, options: HarnessToolResultOptions = {}): void {
    if (this.currentPhase !== "running") {
      return;
    }
    this.closeOpenMessage();
    const retained = retainToolResult(content);
    this.deliver({
      type: "tool-call-result",
      toolCallId,
      content: retained.content,
      ...(options.messageId !== undefined ? { messageId: options.messageId } : {}),
      ...(options.isError === true ? { isError: true } : {}),
      ...(retained.truncated ? { truncated: true, originalBytes: retained.originalBytes } : {}),
    });
  }

  /** Retain one bounded, already-redacted host protocol envelope. */
  protocol(event: HarnessProtocolEvent): void {
    if (this.currentPhase !== "running") {
      return;
    }
    this.deliver({ type: "protocol-event", ...event });
  }

  error(message: string): void {
    if (this.currentPhase !== "running") {
      return;
    }
    this.closeOpenMessage();
    this.deliver({ type: "run-error", message });
  }

  /** Seal the run. Later calls on this emitter become no-ops. */
  finish(exitCode: number, metrics?: HarnessRunMetrics): void {
    if (this.currentPhase !== "running") {
      return;
    }
    this.closeOpenMessage();
    this.currentPhase = "finished";
    this.deliver({
      type: "run-finished",
      exitCode,
      ...(metrics !== undefined ? { metrics } : {}),
    });
  }

  private closeOpenMessage(): void {
    if (this.openMessageId === undefined) {
      return;
    }
    const messageId = this.openMessageId;
    this.openMessageId = undefined;
    this.deliver({ type: "message-finished", messageId });
  }

  private deliver(event: HarnessRunEvent): void {
    try {
      this.listener?.(event);
    } catch {
      // Observers must not be able to abort or corrupt an execution.
    }
  }
}

function retainToolResult(content: string): { content: string; truncated: boolean; originalBytes: number } {
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength <= MAX_RETAINED_TOOL_RESULT_BYTES) {
    return { content, truncated: false, originalBytes: bytes.byteLength };
  }
  return {
    content: new TextDecoder().decode(bytes.subarray(0, MAX_RETAINED_TOOL_RESULT_BYTES)),
    truncated: true,
    originalBytes: bytes.byteLength,
  };
}
