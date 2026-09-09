import type { AcpConfigOption } from "../../contracts/acp-session-config.js";

const STORAGE_KEY = "acp-agent-preferences";

export interface AcpAgentPreferences {
  mode?: string;
  values: Record<string, string | boolean>;
}

function key(agentId: string | undefined): string | undefined {
  if (!agentId) return undefined;
  return `${STORAGE_KEY}:${agentId}`;
}

export function loadAcpAgentPreferences(agentId: string | undefined): AcpAgentPreferences | undefined {
  const storageKey = key(agentId);
  if (!storageKey) return undefined;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const values: Record<string, string | boolean> = {};
    for (const [id, value] of Object.entries(record.values ?? {})) {
      if (typeof value === "string" || typeof value === "boolean") values[id] = value;
    }
    return { values, ...(typeof record.mode === "string" ? { mode: record.mode } : {}) };
  } catch {
    return undefined;
  }
}

export function saveAcpAgentPreferences(agentId: string | undefined, config: AcpConfigOption[], mode?: string): void {
  const storageKey = key(agentId);
  if (!storageKey) return;
  const values: Record<string, string | boolean> = {};
  for (const option of config) values[option.id] = option.value;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ values, ...(mode !== undefined ? { mode } : {}) }));
  } catch {
    // Storage is optional.
  }
}

export function defaultAcpConfigValue(option: AcpConfigOption): string | boolean | undefined {
  if (option.type === "boolean") return option.value;
  return option.choices[0]?.value ?? option.value;
}
