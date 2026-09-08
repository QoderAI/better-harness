import type { HarnessProtocolEvent } from "@qoder-ai/harness/exec";

export interface AcpPlanEntry {
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

export interface AcpSessionState {
  sessionId?: string;
  title?: string;
  mode?: string;
  plan?: AcpPlanEntry[];
  usage?: { used: number; size: number; cost?: { amount: number; currency: string } };
  commands?: Array<{ name: string; description: string }>;
  config?: Array<{ id: string; name: string; value: string | boolean }>;
  partial?: boolean;
  unsupported?: string[];
  tools: ReadonlyMap<string, { title?: string; input?: unknown; output?: unknown; status?: string }>;
}

export function initialAcpSessionState(): AcpSessionState { return { tools: new Map() }; }

export function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export function acpSessionUpdate(event: HarnessProtocolEvent): Record<string, unknown> | undefined {
  if (event.direction !== "Agent → Client" || event.method !== "session/update") return undefined;
  return recordValue(recordValue(recordValue(event.payload)?.params)?.update);
}

/** Observations only: this never authorizes a capability or sends a command. */
export function projectAcpSession(state: AcpSessionState, event: HarnessProtocolEvent): AcpSessionState {
  if (event.direction !== "Agent → Client") return state;
  const payload = recordValue(event.payload);
  if (payload?.truncated === true) return { ...state, partial: true };
  const params = recordValue(payload?.params);
  const result = recordValue(payload?.result);
  // Rust names responses generically; session/new responses still identify
  // themselves by their sessionId. Never read an arbitrary result as metadata.
  if (typeof result?.sessionId === "string") {
    let next: AcpSessionState = { ...state, sessionId: result.sessionId };
    const modes = recordValue(result.modes);
    if (typeof modes?.currentModeId === "string") next.mode = modes.currentModeId;
    if (result.configOptions !== undefined) next = withConfig(next, result.configOptions);
    return next;
  }
  const update = acpSessionUpdate(event);
  if (update === undefined) return state;
  if (state.sessionId !== undefined && typeof params?.sessionId === "string" && params.sessionId !== state.sessionId) return state;
  let next: AcpSessionState = {
    ...state,
    ...(typeof params?.sessionId === "string" ? { sessionId: params.sessionId } : {}),
  };
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return recordValue(update.content)?.type === "text" ? next : { ...next, partial: true };
    case "plan": {
      if (!Array.isArray(update.entries)) return { ...next, partial: true };
      const plan: AcpPlanEntry[] = [];
      for (const value of update.entries) {
        const entry = recordValue(value);
        if (typeof entry?.content !== "string"
          || !["pending", "in_progress", "completed"].includes(String(entry.status))
          || !["high", "medium", "low"].includes(String(entry.priority))) return { ...next, partial: true };
        plan.push({ content: entry.content, status: entry.status as AcpPlanEntry["status"], priority: entry.priority as AcpPlanEntry["priority"] });
      }
      return { ...next, plan };
    }
    case "usage_update": {
      if (!nonnegativeInteger(update.used) || !nonnegativeInteger(update.size)) return { ...next, partial: true };
      const cost = recordValue(update.cost);
      return { ...next, usage: { used: update.used, size: update.size,
        ...(typeof cost?.amount === "number" && Number.isFinite(cost.amount) && cost.amount >= 0 && typeof cost.currency === "string"
          ? { cost: { amount: cost.amount, currency: cost.currency } } : {}) } };
    }
    case "available_commands_update": {
      if (!Array.isArray(update.availableCommands)) return { ...next, partial: true };
      const commands = update.availableCommands.flatMap((value) => {
        const command = recordValue(value);
        return typeof command?.name === "string" && typeof command.description === "string"
          ? [{ name: command.name, description: command.description }] : [];
      });
      return { ...next, commands, ...(commands.length !== update.availableCommands.length ? { partial: true } : {}) };
    }
    case "current_mode_update":
      return typeof update.currentModeId === "string" ? { ...next, mode: update.currentModeId } : { ...next, partial: true };
    case "config_option_update": return withConfig(next, update.configOptions);
    case "session_info_update":
      return typeof update.title === "string" || update.title === null ? { ...next, title: update.title ?? undefined } : next;
    case "tool_call":
    case "tool_call_update": {
      if (typeof update.toolCallId !== "string") return { ...next, partial: true };
      const tools = new Map(next.tools);
      tools.set(update.toolCallId, {
        ...tools.get(update.toolCallId),
        ...(typeof update.title === "string" ? { title: update.title } : {}),
        ...(update.rawInput != null ? { input: update.rawInput } : {}),
        ...(update.rawOutput != null ? { output: update.rawOutput }
          : Array.isArray(update.content) ? { output: update.content } : {}),
        ...(typeof update.status === "string" ? { status: update.status } : {}),
      });
      return { ...next, tools };
    }
    default:
      return { ...next, unsupported: [...new Set([...(next.unsupported ?? []), String(update.sessionUpdate)])].slice(-20) };
  }
}

function withConfig(state: AcpSessionState, value: unknown): AcpSessionState {
  if (!Array.isArray(value)) return { ...state, partial: true };
  const config = value.flatMap((raw) => {
    const option = recordValue(raw);
    return typeof option?.id === "string" && typeof option.name === "string"
      && (typeof option.currentValue === "string" || typeof option.currentValue === "boolean")
      ? [{ id: option.id, name: option.name, value: option.currentValue }] : [];
  });
  return { ...state, config, ...(config.length !== value.length ? { partial: true } : {}) };
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
