import type { AcpSessionRecovery } from "./acp-session-control.js";
import { isAbsolute } from "node:path";
import type { ListSessionsRequest, ListSessionsResponse } from "@agentclientprotocol/sdk";

export interface AcpAuthenticationMethod { id: string; name: string; description?: string; type?: string }
export interface AcpConnectionControl {
  readonly canListSessions: boolean;
  readonly recovery?: "load" | "resume";
  readonly authMethods: readonly AcpAuthenticationMethod[];
  listSessions(params?: Pick<ListSessionsRequest, "cwd" | "cursor">): Promise<ListSessionsResponse>;
  authenticate(methodId: string): Promise<unknown>;
}
export type AcpConnectionReadyHandler = (control: AcpConnectionControl | undefined, context?: { error: string }) => AcpSessionRecovery | null | void | Promise<AcpSessionRecovery | null | void>;

/** A connection handle precedes session creation and expires with its executor. */
export function createAcpConnectionControl(
  initialized: { agentCapabilities?: unknown; authMethods?: unknown },
  transport: { list(params: Pick<ListSessionsRequest, "cwd" | "cursor">): Promise<ListSessionsResponse>; authenticate(methodId: string): Promise<unknown> },
): { control: AcpConnectionControl; dispose(): void } {
  const caps = initialized.agentCapabilities as { loadSession?: boolean; sessionCapabilities?: { list?: unknown; resume?: unknown } } | undefined;
  const canListSessions = caps?.sessionCapabilities?.list != null && typeof caps.sessionCapabilities.list === "object";
  const methods: AcpAuthenticationMethod[] = Array.isArray(initialized.authMethods)
    ? initialized.authMethods.filter((m): m is AcpAuthenticationMethod => m !== null && typeof m === "object" && typeof m.id === "string" && typeof m.name === "string").map(m => ({ ...m })) : [];
  let live = true;
  const assertLive = () => { if (!live) throw new Error("This ACP connection is closed."); };
  return { dispose: () => { live = false; }, control: {
    canListSessions,
    recovery: caps?.loadSession === true ? "load" : caps?.sessionCapabilities?.resume != null ? "resume" : undefined,
    authMethods: Object.freeze(methods.map(m => Object.freeze(m))),
    async listSessions(params = {}) {
      assertLive();
      if (!canListSessions) throw new Error("This Agent does not support session/list.");
      if (params.cwd != null && (typeof params.cwd !== "string" || !isAbsolute(params.cwd))) throw new Error("Session cwd must be an absolute path.");
      if (params.cursor != null && typeof params.cursor !== "string") throw new Error("Session cursor must be a string.");
      return transport.list({ ...(params.cwd != null ? { cwd: params.cwd } : {}), ...(params.cursor != null ? { cursor: params.cursor } : {}) });
    },
    async authenticate(methodId) {
      assertLive();
      const method = methods.find(m => m.id === methodId);
      if (!method || (method.type !== undefined && method.type !== "agent")) throw new Error("This authentication method is not supported by this connection.");
      return transport.authenticate(methodId);
    },
  } };
}

/** Setup errors return to the host picker; only an explicit selection retries. */
export async function prepareAcpSession<T>(control: AcpConnectionControl, handler: AcpConnectionReadyHandler | undefined,
  recovery: AcpSessionRecovery | undefined, create: (recovery: AcpSessionRecovery | undefined) => Promise<T>,
): Promise<{ value: T; recovery: AcpSessionRecovery | undefined }> {
  const selected = await handler?.(control);
  if (selected !== undefined) recovery = selected ?? undefined;
  while (true) {
    try { return { value: await create(recovery), recovery }; }
    catch (cause) {
      if (!handler) throw cause;
      const retry = await handler(control, { error: cause instanceof Error ? cause.message : String(cause) });
      if (retry === undefined) throw cause;
      recovery = retry ?? undefined;
    }
  }
}
