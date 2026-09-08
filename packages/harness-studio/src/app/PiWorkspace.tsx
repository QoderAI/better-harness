import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Terminal } from "@xterm/xterm";
import type { StudioRunProjectBinding } from "./run/stream-run.js";
import { piWorkspaceStatus, type StudioConfig } from "./studio-shell-model.js";
import "@xterm/xterm/css/xterm.css";

interface State { status: "stopped" | "ready" | "error"; id?: string; data?: string; cursor?: number; error?: string }
export function PiWorkspace({ config, project, visible }: { config: StudioConfig; project?: StudioRunProjectBinding; visible: boolean }): React.JSX.Element {
  const { t } = useTranslation("common");
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | undefined>(undefined);
  const sessionId = useRef<string | undefined>(undefined);
  const cursor = useRef(0), pending = useRef(false), mounted = useRef(true);
  const generation = useRef(0), queuedBytes = useRef(0);
  const queue = useRef(Promise.resolve());
  const [state, setState] = useState<State>({ status: "stopped" });
  const [busy, setBusy] = useState(false);
  const status = piWorkspaceStatus(config);
  async function request(method: string, body?: unknown): Promise<State> {
    const response = await fetch(`api/pi/terminal${method === "GET" ? `?cursor=${cursor.current}` : ""}`, { method, cache: "no-store",
      headers: { "X-Harness-Project-Id": project?.id ?? "", "X-Harness-Project-Revision": String(project?.revision ?? ""), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json() as State;
    if (!response.ok) throw new Error(result.error ?? t("pi.failed"));
    return result;
  }
  function control(input: { data?: string; cols?: number; rows?: number }) {
    const id = sessionId.current;
    if (!id) return;
    const bytes = input.data?.length ?? 0;
    if (queuedBytes.current + bytes > 65536) { setState(previous => ({ ...previous, error: t("pi.inputBusy") })); return; }
    queuedBytes.current += bytes;
    queue.current = queue.current.then(async () => {
      if (!mounted.current || sessionId.current !== id) return;
      await request("PATCH", { id, ...input });
    }).catch(error => { if (mounted.current) setState(previous => ({ ...previous, error: String(error) })); }).finally(() => { queuedBytes.current -= bytes; });
  }
  function apply(result: State) {
    if (!mounted.current) return;
    if (result.id !== sessionId.current) { sessionId.current = result.id; cursor.current = 0; terminal.current?.reset(); }
    // Output is fetched after the terminal is mounted, never dropped during launch.
    setState(result);
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sessionId.current = undefined; }; }, []);
  useEffect(() => {
    if (!state.id || !container.current) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]).then(([{ Terminal }, { FitAddon }]) => {
      if (cancelled) return;
      const style = getComputedStyle(container.current!);
      const color = (name: string) => style.getPropertyValue(`--color-${name}`).trim();
      const term = new Terminal({ fontFamily: style.getPropertyValue("--font-code").trim(), fontSize: parseFloat(style.fontSize), scrollback: 2000, screenReaderMode: true,
        theme: { background: color("workspace"), foreground: color("text"), cursor: color("focus"),
          red: color("danger"), brightRed: color("danger"), green: color("success"), brightGreen: color("success"),
          yellow: color("warning"), brightYellow: color("warning"), blue: color("primary"), brightBlue: color("primary"),
          magenta: color("candidate"), brightMagenta: color("candidate"), cyan: color("categorical-1"), brightCyan: color("categorical-1") } });
      const fit = new FitAddon(); term.loadAddon(fit); term.open(container.current!); terminal.current = term;
      cursor.current = 0;
      const data = term.onData(value => { for (let offset = 0; offset < value.length; offset += 8192) control({ data: value.slice(offset, offset + 8192) }); });
      const resize = new ResizeObserver(() => { if (container.current?.clientWidth) { fit.fit(); control({ cols: Math.min(500, Math.max(2, term.cols)), rows: Math.min(200, Math.max(2, term.rows)) }); } });
      resize.observe(container.current!); term.focus();
      dispose = () => { resize.disconnect(); data.dispose(); term.dispose(); terminal.current = undefined; };
    }).catch(() => { if (!cancelled) setState(previous => ({ ...previous, error: t("pi.failed") })); });
    return () => { cancelled = true; dispose?.(); };
  }, [state.id]);
  useEffect(() => {
    if (!visible || status !== "ready") return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (!pending.current) {
          const version = generation.current;
          const result = await request("GET");
          if (!cancelled && !pending.current && generation.current === version) {
            const changed = result.id !== sessionId.current;
            apply(result);
            if (!changed && terminal.current && result.id === sessionId.current) {
              if (result.data) await new Promise<void>(done => terminal.current!.write(result.data!, done));
              cursor.current = result.cursor ?? 0;
            }
          }
        }
      } catch (error) { if (!cancelled) setState(previous => ({ ...previous, error: String(error) })); }
      if (!cancelled) timer = setTimeout(() => void poll(), sessionId.current ? 100 : 2000);
    }
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [visible, status]);
  async function launch() {
    if (pending.current) return;
    pending.current = true; generation.current++; setBusy(true);
    try { apply(await request("POST", { appearance: document.documentElement.dataset.theme })); }
    catch (error) { if (mounted.current) setState({ status: "error", error: String(error) }); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="pi-workspace" hidden={!visible} aria-label={t("area.pi")} onKeyDownCapture={event => {
    // Capture before xterm's native protocol and screen-reader handlers.
    if (event.ctrlKey && event.shiftKey && event.key === "F6") {
      event.preventDefault(); event.stopPropagation(); terminal.current?.blur();
      Array.from(document.querySelectorAll<HTMLButtonElement>(".studio-nav-toggle, .studio-project-sidebar button")).find(button => button.offsetWidth > 0)?.focus();
    }
  }}>
    {state.status !== "ready" && <div className="dsh-launch" aria-busy={busy}>
      <button className="primary" type="button" disabled={busy || status !== "ready"} onClick={() => void launch()}>{busy ? t("pi.starting") : t("pi.open")}</button>
      {status !== "ready" && <p>{t(`pi.${status}Detail`)}</p>}
    </div>}
    {state.error && <p className="pi-terminal-error" role="alert">{state.error}</p>}
    {state.id && <div ref={container} className="pi-terminal" aria-label={t("pi.terminal")} title={t("pi.keyboardHint")} />}
  </section>;
}
