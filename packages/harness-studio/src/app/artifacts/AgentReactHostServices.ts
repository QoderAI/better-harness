import type { AgentReactBuildMetadata } from "../../contracts/artifact.js";

export const AGENT_REACT_SHOW_SOURCE_ACTION = "studio.show-source";
export const AGENT_REACT_ALLOWED_ACTIONS = Object.freeze([AGENT_REACT_SHOW_SOURCE_ACTION]);

export interface AgentReactStateSlot {
  readonly schema: string;
  readonly version: number;
  readonly value: unknown;
}

export interface AgentReactStagedState {
  readonly values: Readonly<Record<string, unknown>>;
  readonly slots: ReadonlyMap<string, AgentReactStateSlot>;
}

export function stageAgentReactState(
  declarations: AgentReactBuildMetadata["view"]["state"],
  current: ReadonlyMap<string, AgentReactStateSlot>,
): AgentReactStagedState {
  const slots = new Map<string, AgentReactStateSlot>();
  for (const declaration of declarations) {
    const retained = current.get(declaration.path);
    const value = retained?.schema === declaration.schema && retained.version === declaration.version
      ? retained.value
      : initialState(declaration.schema, declaration.version);
    slots.set(declaration.path, {
      schema: declaration.schema,
      version: declaration.version,
      value: cloneAgentReactValue(value),
    });
  }
  return {
    slots,
    values: Object.freeze(Object.fromEntries([...slots].map(([path, slot]) => [path, slot.value]))),
  };
}

export function validateAgentReactStateValue(
  schema: string,
  version: number,
  value: unknown,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string } {
  if (version !== 1 || !["json", "list", "record"].includes(schema)) {
    return { ok: false, reason: `State schema '${schema}@${version}' is not provided by this Studio Host.` };
  }
  let owned: unknown;
  try {
    owned = cloneAgentReactValue(value);
  } catch {
    return { ok: false, reason: "Artifact state must be structured-cloneable JSON data." };
  }
  if (!isJsonValue(owned)) return { ok: false, reason: "Artifact state must contain only finite JSON values." };
  if (schema === "list" && !Array.isArray(owned)) return { ok: false, reason: "State schema 'list@1' requires an array." };
  if (schema === "record" && !isPlainRecord(owned)) return { ok: false, reason: "State schema 'record@1' requires an object." };
  return { ok: true, value: owned };
}

export function grantedAgentReactCapabilities(requested: readonly string[]): readonly string[] {
  return [...new Set(requested)].filter((capability) => AGENT_REACT_ALLOWED_ACTIONS.includes(capability)).sort();
}

export function isAgentReactFrameRequest(value: unknown): value is Record<string, unknown> & {
  type: "state.set" | "action.request";
  buildDigest: string;
  frameToken: string;
  requestId: number;
} {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return (message.type === "state.set" || message.type === "action.request")
    && typeof message.buildDigest === "string"
    && typeof message.frameToken === "string"
    && Number.isSafeInteger(message.requestId)
    && Number(message.requestId) > 0;
}

function initialState(schema: string, version: number): unknown {
  if (version !== 1) return null;
  if (schema === "list") return [];
  if (schema === "record") return {};
  return null;
}

function cloneAgentReactValue<T>(value: T): T {
  return structuredClone(value);
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isPlainRecord(value) && Object.values(value).every(isJsonValue);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
