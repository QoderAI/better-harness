import { resolve } from "node:path";
import type { AcpConnectionControl, AcpSessionRecovery } from "@qoder-ai/harness/exec";

/** Selection is limited to this connection's project-filtered discovery results. */
export class AcpConnectionPreparation {
  private sessions = new Set<string>();
  private cursors = new Set<string>();
  private release?: (recovery: AcpSessionRecovery | undefined) => void;
  private reject?: (error: Error) => void;
  constructor(readonly connection: AcpConnectionControl, private cwd: string, private signal: AbortSignal) {}
  async wait(): Promise<AcpSessionRecovery | undefined> {
    const abort = () => this.reject?.(new Error("ACP connection preparation cancelled."));
    const timeout = setTimeout(() => this.reject?.(new Error("ACP connection preparation expired. Connect again.")), 5 * 60_000);
    try {
      return await new Promise((resolve, reject) => {
        this.release = resolve; this.reject = reject;
        if (this.signal.aborted) abort(); else this.signal.addEventListener("abort", abort, { once: true });
      });
    } finally {
      clearTimeout(timeout); this.signal.removeEventListener("abort", abort);
      this.release = undefined; this.reject = undefined;
    }
  }
  async act(body: Record<string, unknown>): Promise<unknown> {
    if (!this.release || this.signal.aborted) throw new Error("This ACP connection is no longer available.");
    if (body.action === "connection-list") {
      if (body.cursor !== undefined && (typeof body.cursor !== "string" || !this.cursors.has(body.cursor))) throw new Error("Select a cursor returned by this Agent.");
      const result = await this.connection.listSessions({ cwd: this.cwd, ...(typeof body.cursor === "string" ? { cursor: body.cursor } : {}) });
      if (body.cursor === undefined) { this.sessions.clear(); this.cursors.clear(); }
      const sessions = result.sessions.filter(session => resolve(session.cwd) === resolve(this.cwd)).slice(0, Math.max(0, 500 - this.sessions.size));
      for (const session of sessions) this.sessions.add(session.sessionId);
      const nextCursor = this.sessions.size < 500 && this.cursors.size < 100 && typeof result.nextCursor === "string" && result.nextCursor !== body.cursor && !this.cursors.has(result.nextCursor) ? result.nextCursor : undefined;
      if (nextCursor) this.cursors.add(nextCursor);
      return { sessions, ...(nextCursor ? { nextCursor } : {}) };
    }
    if (body.action === "connection-authenticate" && typeof body.methodId === "string") {
      await this.connection.authenticate(body.methodId);
      return { authenticated: true };
    }
    if (body.action === "connection-select") {
      let recovery: AcpSessionRecovery | undefined;
      if (body.sessionId !== undefined) {
        if (typeof body.sessionId !== "string" || !this.sessions.has(body.sessionId) || !this.connection.recovery) throw new Error("Select a restorable session returned for this Project.");
        recovery = { sessionId: body.sessionId, method: this.connection.recovery };
      }
      this.release(recovery); this.release = undefined;
      return { selected: true };
    }
    throw new Error("Unsupported ACP connection action.");
  }
}
