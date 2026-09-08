import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StudioRunProjectBinding } from "./run/stream-run.js";
import { dshWorkspaceStatus, type StudioConfig } from "./studio-shell-model.js";

interface WebState { status: "stopped" | "starting" | "ready" | "error"; url?: string; error?: string }

/** The frame is the official application, including its own composer and Host API. */
export function DshWorkspace({ config, project, visible = true }: {
  config: StudioConfig;
  project?: StudioRunProjectBinding;
  visible?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation("common");
  const [web, setWeb] = useState<WebState>({ status: "stopped" });
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const status = dshWorkspaceStatus(config);
  const id = project?.id;
  const revision = project?.revision;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function request(method: string): Promise<WebState> {
    const response = await fetch("api/dsh/web", { method, headers: {
      "X-Harness-Project-Id": id ?? "", "X-Harness-Project-Revision": String(revision ?? ""),
    }, cache: "no-store" });
    const result = await response.json() as WebState;
    if (!response.ok) throw new Error(result.error ?? t("dsh.failed"));
    return result;
  }
  useEffect(() => {
    if (status !== "ready" || !visible) return;
    let cancelled = false;
    const refresh = async () => {
      if (pending.current) return;
      const version = generation.current;
      try { const result = await request("GET"); if (!cancelled && !pending.current && version === generation.current) setWeb(result); }
      catch (error) { if (!cancelled && !pending.current && version === generation.current) setWeb({ status: "error", error: String(error) }); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [id, revision, status, visible]);
  async function launch(): Promise<void> {
    if (pending.current || status !== "ready") return;
    pending.current = true; generation.current++; setBusy(true);
    setWeb({ status: "starting" });
    try { const result = await request("POST"); if (mounted.current) setWeb(result); }
    catch (error) { if (mounted.current) setWeb({ status: "error", error: String(error) }); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="dsh-workspace" hidden={!visible} aria-label={t("area.dsh")}>
    {web.status === "ready" && web.url ? <iframe className="dsh-native-frame" title={t("dsh.frameTitle")} src={web.url}
      sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
      : <div className="dsh-launch" aria-busy={busy}>
        <button type="button" className="primary" disabled={busy || status !== "ready"} onClick={() => void launch()}>
          {busy ? t("dsh.starting") : t("dsh.open")}
        </button>
        {status !== "ready" && <p>{t(`dsh.${status}Detail`)}</p>}
        {web.error && <p role="alert">{web.error}</p>}
      </div>}
  </section>;
}
