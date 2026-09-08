import { parseAcpConfig, recordValue, type AcpConfigOption } from "../../contracts/acp-session-config.js";
export { recordValue } from "../../contracts/acp-session-config.js";
import type { HarnessProtocolEvent } from "@qoder-ai/harness/exec";

export interface AcpPlanEntry {
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

export interface AcpSessionState {
  terminals?: ReadonlyMap<string, { output?: string; truncated?: boolean; exitCode?: number; signal?: string; released?: boolean }>;
  terminalRequests?: ReadonlyMap<string, { method: string; terminalId?: string }>;
  sessionId?: string;
  title?: string;
  updatedAt?: string;
  mode?: string;
  modes?: Array<{ id: string; name: string; description?: string }>;
  controllable?: boolean;
  prepared?: boolean;
  plan?: AcpPlanEntry[];
  usage?: { used: number; size: number; cost?: { amount: number; currency: string } };
  commands?: Array<{ name: string; description: string; inputHint?: string }>;
  config?: AcpConfigOption[];
  partial?: boolean;
  unsupported?: string[];
  tools: ReadonlyMap<string, { title?: string; kind?: string; input?: unknown; output?: unknown; status?: string; content?: unknown[]; locations?: Array<{ path: string; line?: number }> }>;
}

export function initialAcpSessionState(): AcpSessionState { return { tools: new Map() }; }

export function acpSessionUpdate(event: HarnessProtocolEvent): Record<string, unknown> | undefined {
  if (event.direction !== "Agent → Client" || event.method !== "session/update") return undefined;
  return recordValue(recordValue(recordValue(event.payload)?.params)?.update);
}

/** Observations only: this never authorizes a capability or sends a command. */
export function projectAcpSession(state: AcpSessionState, event: HarnessProtocolEvent): AcpSessionState {
  state = projectTerminal(state, event);
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
    if (Array.isArray(modes?.availableModes)) next.modes = modes.availableModes.flatMap((raw) => {
      const mode = recordValue(raw);
      return typeof mode?.id === "string" && typeof mode.name === "string" ? [{ id: mode.id, name: mode.name, ...(typeof mode.description === "string" ? { description: mode.description } : {}) }] : [];
    });
    if (typeof modes?.currentModeId === "string") next.mode = modes.currentModeId;
    if (result.configOptions !== undefined) next = withConfig(next, result.configOptions);
    return next;
  }
  if (result?.configOptions !== undefined) return withConfig(state, result.configOptions);
  const update = acpSessionUpdate(event);
  if (update === undefined) return state;
  if (state.sessionId !== undefined && typeof params?.sessionId === "string" && params.sessionId !== state.sessionId) return state;
  let next: AcpSessionState = {
    ...state,
    ...(typeof params?.sessionId === "string" ? { sessionId: params.sessionId } : {}),
  };
  switch (update.sessionUpdate) {
    case "user_message_chunk":
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      const block = recordValue(update.content);
      const valid = block?.type === "text" ? typeof block.text === "string"
        : block?.type === "image" || block?.type === "audio" ? typeof block.data === "string" && typeof block.mimeType === "string"
        : block?.type === "resource_link" ? typeof block.uri === "string"
        : block?.type === "resource" && recordValue(block.resource) !== undefined;
      return valid ? next : { ...next, partial: true };
    }
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
          ? [{ name: command.name, description: command.description, ...(typeof recordValue(command.input)?.hint === "string" ? { inputHint: recordValue(command.input)!.hint as string } : {}) }] : [];
      });
      return { ...next, commands, ...(commands.length !== update.availableCommands.length ? { partial: true } : {}) };
    }
    case "current_mode_update":
      return typeof update.currentModeId === "string" ? { ...next, mode: update.currentModeId } : { ...next, partial: true };
    case "config_option_update": return withConfig(next, update.configOptions);
    case "session_info_update":
      return { ...next,
        ...(typeof update.title === "string" || update.title === null ? { title: update.title ?? undefined } : {}),
        ...(typeof update.updatedAt === "string" || update.updatedAt === null ? { updatedAt: update.updatedAt ?? undefined } : {}),
      };
    case "tool_call":
    case "tool_call_update": {
      if (typeof update.toolCallId !== "string") return { ...next, partial: true };
      const tools = new Map(next.tools);
      tools.set(update.toolCallId, {
        ...tools.get(update.toolCallId),
        ...(typeof update.kind === "string" ? { kind: update.kind } : {}),
        ...(Array.isArray(update.content) ? { content: update.content } : {}),
        ...(Array.isArray(update.locations) ? { locations: update.locations.flatMap((value) => {
          const location = recordValue(value);
          return typeof location?.path === "string" ? [{ path: location.path, ...(nonnegativeInteger(location.line) ? { line: location.line } : {}) }] : [];
        }) } : {}),
        ...(typeof update.title === "string" ? { title: update.title } : {}),
        ...(update.rawInput != null ? { input: update.rawInput } : {}),
        ...(update.rawOutput != null ? { output: update.rawOutput } : {}),
        ...(typeof update.status === "string" ? { status: update.status } : {}),
      });
      return { ...next, tools };
    }
    default:
      return { ...next, unsupported: [...new Set([...(next.unsupported ?? []), String(update.sessionUpdate)])].slice(-20) };
  }
}

function withConfig(state: AcpSessionState, value: unknown): AcpSessionState {
  const config = parseAcpConfig(value);
  return config === undefined ? { ...state, partial: true }
    : { ...state, config, ...(Array.isArray(value) && config.length !== value.length ? { partial: true } : {}) };
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function projectTerminal(state: AcpSessionState, event: HarnessProtocolEvent): AcpSessionState {
  if (event.rpcId === undefined) return state;
  const payload = recordValue(event.payload);
  const requests = new Map(state.terminalRequests);
  if (event.direction === "Agent → Client" && event.method.startsWith("terminal/") && !event.method.endsWith(":response")) {
    const params = recordValue(payload?.params);
    if (state.sessionId && params?.sessionId !== state.sessionId) return state;
    requests.set(event.rpcId, { method: event.method, ...(typeof params?.terminalId === "string" ? { terminalId: params.terminalId } : {}) });
    if (requests.size > 100) requests.delete(requests.keys().next().value!);
    return { ...state, terminalRequests: requests };
  }
  const request = event.direction === "Client → Agent" ? requests.get(event.rpcId) : undefined;
  if (!request) return state;
  requests.delete(event.rpcId);
  const result = recordValue(payload?.result);
  const id = request.terminalId ?? (typeof result?.terminalId === "string" ? result.terminalId : undefined);
  if (!result || !id) return { ...state, terminalRequests: requests };
  const terminals = new Map(state.terminals);
  const exit = recordValue(result.exitStatus) ?? result;
  terminals.set(id, { ...terminals.get(id),
    ...(typeof result.output === "string" ? { output: result.output, truncated: result.truncated === true } : {}),
    ...(typeof exit.exitCode === "number" ? { exitCode: exit.exitCode } : {}),
    ...(typeof exit.signal === "string" ? { signal: exit.signal } : {}),
    ...(request.method === "terminal/release" ? { released: true } : {}),
  });
  return { ...state, terminalRequests: requests, terminals };
}
