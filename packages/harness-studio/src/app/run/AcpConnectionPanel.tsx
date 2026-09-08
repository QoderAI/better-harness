import { useEffect, useRef, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionOwnedState } from "./session-view-store.js";
import type { HarnessRunState } from "./run-store.js";
import type { AcpSessionActions } from "./acp-session-actions.js";

interface Session { sessionId: string; title?: string; updatedAt?: string }
export function AcpConnectionPanel({ connection, actions, runId }: {
  connection: NonNullable<HarnessRunState["connection"]>; actions: AcpSessionActions; runId: string;
}): React.JSX.Element {
  const { t } = useTranslation("run");
  const label = useId();
  const heading = useRef<HTMLElement>(null);
  const [listing, setListing] = useSessionOwnedState<{ sessions: Session[]; nextCursor?: string; loaded: boolean }>(`connection:${runId}`, { sessions: [], loaded: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [authenticated, setAuthenticated] = useState(false);
  useEffect(() => { heading.current?.focus(); if (connection.error) setListing({ sessions: [], loaded: false }); }, [connection.error]);
  async function perform(work: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true); setError(undefined);
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function list(cursor?: string): Promise<void> {
    const result = await actions.execute({ action: "connection-list", ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(result.sessions)) throw new Error(t("connection.invalidList"));
    const sessions = result.sessions.filter((value): value is Session => value && typeof value.sessionId === "string").map(value => ({ sessionId: value.sessionId, ...(typeof value.title === "string" ? { title: value.title } : {}), ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}) }));
    const all = cursor ? [...listing.sessions, ...sessions] : sessions;
    setListing({ loaded: true, sessions: [...new Map(all.map(item => [item.sessionId, item])).values()], ...(typeof result.nextCursor === "string" ? { nextCursor: result.nextCursor } : {}) });
  }
  return <section className="acp-connection-panel" aria-labelledby={label} aria-busy={busy}>
    <header ref={heading} tabIndex={-1}><strong id={label}>{t("connection.title")}</strong><button type="button" onClick={() => { void actions.execute({ action: "close" }).catch(cause => setError(String(cause))); }}>{t("conversation.close")}</button></header>
    <p>{t("connection.projectHistory")}</p>
    {(error ?? (!authenticated && connection.error)) && <p role="alert">{error ?? connection.error}</p>}
    {connection.authMethods.length > 0 && <details className="acp-connection-auth" open={connection.error ? true : undefined}><summary>{t("connection.authentication")}</summary>
      <p>{t("connection.authHint")}</p>
      {connection.authMethods.map(method => <div key={method.id}><button type="button" disabled={busy || (method.type !== undefined && method.type !== "agent")}
        onClick={() => void perform(async () => { await actions.execute({ action: "connection-authenticate", methodId: method.id }); setAuthenticated(true); })}>{method.name}</button>
        {method.description && <span>{method.description}</span>}{method.type && method.type !== "agent" && <span>{t("connection.authUnsupported")}</span>}</div>)}
      {authenticated && <p role="status">{t("connection.authenticated")}</p>}
    </details>}
    <div className="acp-connection-toolbar">
      <button type="button" disabled={busy} onClick={() => void perform(async () => { await actions.execute({ action: "connection-select" }); })}>{t("connection.newSession")}</button>
      {connection.canListSessions && <button type="button" disabled={busy} onClick={() => void perform(() => list())}>{t(listing.loaded ? "connection.refresh" : "connection.list")}</button>}
    </div>
    {!connection.canListSessions && <p>{t("connection.listUnsupported")}</p>}
    {busy && <p role="status">{t("connection.working")}</p>}
    {listing.loaded && listing.sessions.length === 0 && <p role="status">{t("connection.empty")}</p>}
    <ul className="acp-agent-sessions">{listing.sessions.map(session => <li key={session.sessionId}>
      <button type="button" disabled={busy || !connection.recovery} title={session.sessionId} onClick={() => void perform(async () => { await actions.execute({ action: "connection-select", sessionId: session.sessionId }); })}>
        <span>{session.title || session.sessionId}</span>{session.updatedAt && <time dateTime={session.updatedAt}>{session.updatedAt}</time>}
      </button>
    </li>)}</ul>
    {listing.sessions.length > 0 && !connection.recovery && <p>{t("connection.restoreUnsupported")}</p>}
    {listing.nextCursor && <button type="button" disabled={busy} onClick={() => void perform(() => list(listing.nextCursor))}>{t("connection.more")}</button>}
  </section>;
}
