import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AcpSessionControl } from "./acp-session-control.js";

export type AcpPromptContent = ContentBlock[];
export type AcpOptionalAction = "retry" | "rewind" | "checkpoint" | "resume" | "load" | "list" | "authenticate" | "elicitation" | "steer";
export interface AcpConversationCapabilities {
  recovery?: "load" | "resume";
  image: boolean;
  audio: boolean;
  embeddedContext: boolean;
  actions: AcpOptionalAction[];
}
export interface AcpConversationDriver extends AcpSessionControl {
  capabilities: AcpConversationCapabilities;
  prompt(content: AcpPromptContent): Promise<{ stopReason: string }>;
  cancel(): Promise<void>;
  close?(): Promise<void>;
  optional?: Partial<Record<AcpOptionalAction, (input: unknown) => Promise<unknown>>>;
}
export interface AcpQueuedPrompt { id: string; content: AcpPromptContent }
export interface AcpConversationTurn extends AcpQueuedPrompt {
  turnId: string;
  startedAt: string;
  finishedAt?: string;
  stopReason?: string;
  error?: string;
}
export interface AcpConversationSnapshot {
  sessionId: string;
  status: "connecting" | "generating" | "cancelling" | "idle" | "closed";
  capabilities: AcpConversationCapabilities;
  queue: AcpQueuedPrompt[];
  queuePaused: boolean;
  turns: AcpConversationTurn[];
  revision: number;
}
export interface AcpConversationHooks {
  onChange(snapshot: AcpConversationSnapshot): void;
  onPrompt?(prompt: AcpQueuedPrompt, first: boolean): void;
  onTurnComplete?(turn: AcpConversationTurn): Promise<void> | void;
  onTurnBoundary?(): void;
  turnOffset?: number;
  idleTimeoutMs?: number;
  cancellationTimeoutMs?: number;
}
const EMPTY_CAPABILITIES: AcpConversationCapabilities = { image: false, audio: false, embeddedContext: false, actions: [] };

/** One session owns the queue; view mounts and individual prompt results do not own it. */
export class AcpConversation {
  private driver?: AcpConversationDriver;
  private queue: AcpQueuedPrompt[] = [];
  private turns: AcpConversationTurn[] = [];
  private accepted = new Map<string, string>();
  private acceptedBytes = 0;
  private paused = false;
  private closed = false;
  private status: AcpConversationSnapshot["status"] = "connecting";
  private revision = 0;
  private wake?: () => void;
  private active?: Promise<{ stopReason: string }>;
  private forceClose?: () => void;
  constructor(private readonly hooks: AcpConversationHooks) {}

  snapshot(): AcpConversationSnapshot {
    return structuredClone({ sessionId: this.driver?.sessionId ?? "", status: this.status,
      capabilities: this.driver?.capabilities ?? EMPTY_CAPABILITIES,
      queue: this.queue, queuePaused: this.paused, turns: this.turns, revision: this.revision });
  }
  private publish(): void { this.revision++; try { this.hooks.onChange(this.snapshot()); } catch { /* Observers must not terminate the Agent. */ } }
  private ready(): AcpConversationDriver {
    if (!this.driver || this.closed) throw new Error("This session is not available.");
    return this.driver;
  }
  private validate(prompt: AcpQueuedPrompt): void {
    const driver = this.ready();
    if (typeof prompt.id !== "string" || !prompt.id || prompt.id.length > 200 || !Array.isArray(prompt.content) || !prompt.content.length) throw new Error("A message id and content are required.");
    if (JSON.stringify(prompt.content).length > 4 * 1024 * 1024) throw new Error("Message exceeds the 4 MB limit.");
    if (!prompt.content.some(block => block && (block.type !== "text" || (typeof block.text === "string" && block.text.trim())))) throw new Error("Message content is empty.");
    for (const block of prompt.content) {
      if (!block || typeof block !== "object") throw new Error("Invalid message content.");
      if (block.type === "text" && typeof block.text === "string") continue;
      if (block.type === "image" && driver.capabilities.image && typeof block.data === "string" && typeof block.mimeType === "string") continue;
      if (block.type === "audio" && driver.capabilities.audio && typeof block.data === "string" && typeof block.mimeType === "string") continue;
      if (block.type === "resource" && driver.capabilities.embeddedContext && block.resource && typeof block.resource === "object" && typeof block.resource.uri === "string" && (("text" in block.resource && typeof block.resource.text === "string") || ("blob" in block.resource && typeof block.resource.blob === "string"))) continue;
      if (block.type === "resource_link" && typeof block.uri === "string" && typeof block.name === "string") continue;
      throw new Error(`This Agent does not support this ${block.type} content.`);
    }
  }
  async submit(prompt: AcpQueuedPrompt, immediately = false): Promise<void> {
    this.validate(prompt);
    const signature = JSON.stringify(prompt.content);
    const previous = this.accepted.get(prompt.id);
    if (previous !== undefined) {
      if (previous !== signature) throw new Error("This message id was already used with different content.");
      return;
    }
    if (this.accepted.size >= 1000) throw new Error("This session has reached its 1000 message limit. Start a new conversation.");
    if (this.queue.length >= 50) throw new Error("The message queue is full.");
    if (this.acceptedBytes + signature.length > 16 * 1024 * 1024) throw new Error("This conversation has reached its retained input limit. Start a new conversation.");
    this.acceptedBytes += signature.length;
    this.accepted.set(prompt.id, signature);
    if (immediately) this.queue.unshift(structuredClone(prompt));
    else this.queue.push(structuredClone(prompt));
    this.publish();
    if (immediately && this.active) await this.stop();
    this.paused = false;
    this.publish(); this.wake?.();
  }
  editQueued(prompt: AcpQueuedPrompt): void {
    this.validate(prompt);
    const index = this.queue.findIndex(item => item.id === prompt.id);
    if (index < 0) throw new Error("This queued message has already been sent or removed.");
    const signature = JSON.stringify(prompt.content);
    const bytes = this.acceptedBytes - (this.accepted.get(prompt.id)?.length ?? 0) + signature.length;
    if (bytes > 16 * 1024 * 1024) throw new Error("This conversation has reached its retained input limit.");
    this.acceptedBytes = bytes; this.accepted.set(prompt.id, signature);
    this.queue[index] = structuredClone(prompt);
    this.publish();
  }
  removeQueued(id: string): void {
    if (!this.queue.some(item => item.id === id)) throw new Error("Queued message not found.");
    this.queue = this.queue.filter(item => item.id !== id); this.publish();
  }
  resumeQueue(): void { this.ready(); this.paused = false; this.publish(); this.wake?.(); }
  async stop(): Promise<void> {
    const driver = this.ready();
    this.paused = true;
    if (!this.active) { this.publish(); return; }
    this.status = "cancelling"; this.publish();
    const active = this.active;
    await boundedCancellation(async () => { await driver.cancel(); await active.catch(() => undefined); }, this.hooks.cancellationTimeoutMs);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.queue = []; this.paused = true;
    this.wake?.();
    if (this.active) {
      try { await boundedCancellation(async () => { await this.driver?.cancel(); await this.active?.catch(() => undefined); }, this.hooks.cancellationTimeoutMs); }
      catch { this.forceClose?.(); await this.active?.catch(() => undefined); }
    }
    this.status = "closed"; this.publish();
  }
  async perform(action: AcpOptionalAction, input: unknown): Promise<unknown> {
    const driver = this.ready();
    const handler = Object.prototype.hasOwnProperty.call(driver.optional ?? {}, action) ? driver.optional?.[action] : undefined;
    if (!driver.capabilities.actions.includes(action) || !handler) throw new Error(`This Agent does not support ${action}.`);
    return handler(input);
  }
  async run(driver: AcpConversationDriver, initial: AcpQueuedPrompt, initialWireContent: AcpPromptContent): Promise<{ stopReason: string }> {
    if (this.driver) throw new Error("A conversation can only be bound once.");
    this.driver = driver;
    this.validate(initial);
    const initialSignature = JSON.stringify(initial.content);
    this.accepted.set(initial.id, initialSignature); this.acceptedBytes = initialSignature.length;
    this.queue.push(structuredClone(initial));
    let first = true;
    let last = { stopReason: "end_turn" };
    try {
      while (!this.closed) {
        if (this.paused || !this.queue.length) {
          this.status = "idle"; this.publish();
          await new Promise<void>(resolve => {
            const timer = setTimeout(() => { this.closed = true; resolve(); }, this.hooks.idleTimeoutMs ?? 30 * 60_000);
            timer.unref?.();
            this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
          });
          continue;
        }
        const prompt = this.queue.shift()!;
        const turn: AcpConversationTurn = { ...prompt, turnId: `${driver.sessionId}:${(this.hooks.turnOffset ?? 0) + this.turns.length + 1}`, startedAt: new Date().toISOString() };
        this.turns.push(turn); this.status = "generating";
        this.hooks.onPrompt?.(prompt, first); this.publish();
        const wire = first ? initialWireContent : prompt.content; first = false;
        try {
          const closed = new Promise<never>((_resolve, reject) => { this.forceClose = () => reject(new Error("Session closed before the Agent acknowledged cancellation.")); });
          this.active = Promise.race([driver.prompt(wire), closed]);
          last = await this.active;
          turn.stopReason = last.stopReason;
          if (last.stopReason !== "end_turn") this.paused = true;
        } catch (error) {
          turn.error = error instanceof Error ? error.message : String(error);
          turn.stopReason = "error"; this.paused = true;
        } finally {
          this.active = undefined; this.forceClose = undefined; this.status = this.closed ? "closed" : "idle"; turn.finishedAt = new Date().toISOString();
          this.hooks.onTurnBoundary?.();
          await this.hooks.onTurnComplete?.(structuredClone(turn));
          this.publish();
        }
      }
      return last;
    } finally { this.closed = true; this.status = "closed"; this.publish(); await boundedCancellation(async () => { await driver.close?.(); }, this.hooks.cancellationTimeoutMs).catch(() => undefined); }
  }
}

export function conversationCapabilities(value: unknown): AcpConversationCapabilities {
  const record = value as { loadSession?: boolean; sessionCapabilities?: { resume?: unknown }; promptCapabilities?: { image?: unknown; audio?: unknown; embeddedContext?: unknown } } | undefined;
  const prompt = record?.promptCapabilities;
  return { ...(record?.loadSession === true ? { recovery: "load" as const } : record?.sessionCapabilities?.resume != null ? { recovery: "resume" as const } : {}), image: prompt?.image === true, audio: prompt?.audio === true, embeddedContext: prompt?.embeddedContext === true, actions: [] };
}
export function parseAcpConversationSnapshot(value: unknown): AcpConversationSnapshot {
  if (value === null || typeof value !== "object") throw new Error("Invalid conversation snapshot.");
  const state = value as AcpConversationSnapshot;
  if (typeof state.sessionId !== "string" || !["connecting", "generating", "cancelling", "idle", "closed"].includes(state.status)
    || !Number.isSafeInteger(state.revision) || !Array.isArray(state.queue) || !Array.isArray(state.turns)
    || typeof state.queuePaused !== "boolean" || !state.capabilities || !Array.isArray(state.capabilities.actions)) throw new Error("Invalid conversation snapshot.");
  if ((state.capabilities.recovery !== undefined && !["load", "resume"].includes(state.capabilities.recovery)) || state.revision < 0 || state.queue.length > 50 || state.turns.length > 1000
    || [state.capabilities.image, state.capabilities.audio, state.capabilities.embeddedContext].some(value => typeof value !== "boolean")
    || state.capabilities.actions.some(action => !["retry", "rewind", "checkpoint", "resume", "load", "list", "authenticate", "elicitation", "steer"].includes(action))) throw new Error("Invalid conversation capabilities.");
  for (const prompt of [...state.queue, ...state.turns]) {
    if (!prompt || typeof prompt.id !== "string" || !Array.isArray(prompt.content) || !prompt.content.length
      || prompt.content.some(block => !block || typeof block !== "object" || typeof block.type !== "string")) throw new Error("Invalid conversation message.");
  }
  for (const turn of state.turns) {
    if (typeof turn.turnId !== "string" || !Number.isFinite(Date.parse(turn.startedAt))
      || (turn.finishedAt !== undefined && !Number.isFinite(Date.parse(turn.finishedAt)))
      || (turn.error !== undefined && typeof turn.error !== "string")
      || (turn.stopReason !== undefined && typeof turn.stopReason !== "string")) throw new Error("Invalid conversation turn.");
  }
  return state;
}

async function boundedCancellation(operation: () => Promise<void>, timeoutMs = 5000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([operation(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("The Agent did not acknowledge Stop. Retry or close this session.")), timeoutMs); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
