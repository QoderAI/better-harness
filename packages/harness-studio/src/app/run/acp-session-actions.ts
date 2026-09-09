import type { AcpPromptContent, AcpOptionalAction } from "@qoder-ai/harness/exec";
import { recordValue } from "../../contracts/acp-session-config.js";
export type AcpSessionAction =
  | { action: "connection-list"; cursor?: string }
  | { action: "connection-authenticate"; methodId: string }
  | { action: "connection-select"; sessionId?: string }
  | { action: "config"; configId: string; value: string | boolean }
  | { action: "mode"; modeId: string }
  | { action: "start"; prompt?: string }
  | { action: "stop" | "close" | "queue-resume" }
  | { action: "send"; id: string; content: AcpPromptContent; immediately?: boolean }
  | { action: "queue-edit"; id: string; content: AcpPromptContent }
  | { action: "queue-remove"; id: string }
  | { action: "optional"; name: AcpOptionalAction; input: unknown };
export interface AcpSessionActions { execute(action: AcpSessionAction): Promise<Record<string, unknown>> }
/** HTTP belongs to the Studio host adapter, not reusable view components. */
export function createAcpSessionActions(runId: string): AcpSessionActions {
  return { execute: action => postAcpSessionAction(runId, action) };
}
export async function postAcpSessionAction(runId: string, action: AcpSessionAction): Promise<Record<string, unknown>> {
  const response = await fetch(`api/acp/runs/${encodeURIComponent(runId)}/session`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
  });
  const result = recordValue(await response.json().catch(() => undefined));
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : `ACP session (${response.status})`);
  return result ?? {};
}
