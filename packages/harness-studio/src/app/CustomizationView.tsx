import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { House } from "@phosphor-icons/react/House";
import { Plug } from "@phosphor-icons/react/Plug";
import { HardDrives } from "@phosphor-icons/react/HardDrives";
import { Lightbulb } from "@phosphor-icons/react/Lightbulb";
import { BookOpen } from "@phosphor-icons/react/BookOpen";
import { Robot } from "@phosphor-icons/react/Robot";
import { Lightning } from "@phosphor-icons/react/Lightning";
import { Wrench } from "@phosphor-icons/react/Wrench";
import { Terminal } from "@phosphor-icons/react/Terminal";
import { X } from "@phosphor-icons/react/X";
import type { CustomizationAnalysisResponseV1 } from "@qoder-ai/harness/customization";
import { studioApiError } from "./studio-api.js";
import { CUSTOMIZATION_CATEGORIES, customizationLibraryRows, filterCustomizationRows, type CustomizationCategory } from "./customization-library.js";

const ICONS = { overview: House, plugins: Plug, mcp: HardDrives, skills: Lightbulb, instructions: BookOpen, agents: Robot, hooks: Lightning, tools: Wrench, commands: Terminal };

export function CustomizationView(props: {
  analyzed: boolean;
  enabled: boolean;
  openRequest: number;
  onOpenHandled: () => void;
  onAnalyzed: (definitionCount: number) => void;
}): React.JSX.Element {
  const { t } = useTranslation("customize");
  const [analysis, setAnalysis] = useState<CustomizationAnalysisResponseV1>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(props.enabled);
  const [failure, setFailure] = useState<string>();
  const [expanded, setExpanded] = useState(true);
  const [category, setCategory] = useState<CustomizationCategory | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (props.openRequest > 0) { setCategory("overview"); props.onOpenHandled(); } }, [props.openRequest]);
  // One initial load per project-mounted library, including effect replay.
  const initialLoad = useRef<Promise<CustomizationAnalysisResponseV1> | undefined>(undefined);
  const onAnalyzed = useRef(props.onAnalyzed);
  onAnalyzed.current = props.onAnalyzed;
  useEffect(() => {
    if (!props.enabled) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    initialLoad.current ??= (async () => {
      let response = await fetch(props.analyzed ? "api/customizations" : "api/customizations/analyze", props.analyzed ? undefined : { method: "POST" });
      if (props.analyzed && response.status === 404) response = await fetch("api/customizations/analyze", { method: "POST" });
      if (!response.ok) throw new Error(await studioApiError(response));
      return await response.json() as CustomizationAnalysisResponseV1;
    })();
    void initialLoad.current.then((value) => {
      if (!cancelled) { setAnalysis(value); setFailure(undefined); onAnalyzed.current(value.summary.definitionCount); }
    }).catch((error: unknown) => {
      if (!cancelled) setFailure(String(error));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [props.enabled]);

  async function analyze(): Promise<void> {
    setBusy(true); setFailure(undefined);
    try {
      const response = await fetch("api/customizations/analyze", { method: "POST" });
      if (!response.ok) throw new Error(await studioApiError(response));
      const value = await response.json() as CustomizationAnalysisResponseV1;
      if (!alive.current) return;
      setAnalysis(value); props.onAnalyzed(value.summary.definitionCount);
    } catch (error) { if (alive.current) setFailure(String(error)); }
    finally { if (alive.current) setBusy(false); }
  }
  const rows = useMemo(() => analysis === undefined ? [] : customizationLibraryRows(analysis.catalog), [analysis]);
  return <section className="customization-library" aria-label={t("library.title")} aria-busy={loading || busy}>
    <button className="customization-library-toggle" aria-expanded={expanded} aria-controls="customization-library-entries" onClick={() => setExpanded(!expanded)}>
      <strong>{t("library.title")}</strong><CaretDown size={14} aria-hidden="true" />
    </button>
    {(loading || busy) && <p className="customization-library-status" role="status">{t("loadingCatalog")}</p>}
    {failure && <p className="customization-library-status" role="alert">{t("library.loadFailed")}</p>}
    {expanded && <div id="customization-library-entries" className="customization-library-entries">
      {CUSTOMIZATION_CATEGORIES.map((key) => {
        const Icon = ICONS[key];
        const count = key === "overview" || analysis === undefined ? undefined : filterCustomizationRows(rows, key, "all").length;
        return <button type="button" key={key} aria-haspopup="dialog" aria-expanded={category === key} onClick={() => setCategory(key)}>
          <Icon size={17} aria-hidden="true" /><span>{t(`library.categories.${key}`)}</span>
          {count !== undefined && <small>{count}</small>}
        </button>;
      })}
    </div>}
    {category !== null && createPortal(<CustomizationDialog category={category} onCategory={setCategory} onClose={() => setCategory(null)} analysis={analysis} rows={rows} loading={loading || busy} failure={failure} enabled={props.enabled} onAnalyze={() => void analyze()} />, document.body)}
  </section>;
}

function CustomizationDialog(props: {
  category: CustomizationCategory;
  onCategory: (category: CustomizationCategory) => void;
  onClose: () => void;
  analysis: CustomizationAnalysisResponseV1 | undefined;
  rows: ReturnType<typeof customizationLibraryRows>;
  loading: boolean;
  failure: string | undefined;
  enabled: boolean;
  onAnalyze: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("customize");
  const dialog = useRef<HTMLDialogElement>(null);
  const [host, setHost] = useState("all");
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    element.showModal();
    return () => { element.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  const rows = filterCustomizationRows(props.rows, props.category, host);
  const hosts = props.analysis?.catalog.hosts ?? [];
  const hostLabel = (id: string): string => hosts.find((item) => item.id === id)?.label ?? id;
  const hostIds = [...new Set([...hosts.map((item) => item.id), ...props.rows.flatMap((row) => row.hosts)])];
  return <dialog ref={dialog} className="customization-dialog" aria-labelledby="customization-dialog-title"
    onCancel={(event) => { event.preventDefault(); props.onClose(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.onClose(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), [tabindex="0"]'));
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const b = event.currentTarget.getBoundingClientRect();
      if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) props.onClose();
    }}>
    <header className="customization-dialog-header"><div><h2 id="customization-dialog-title">{t("library.title")}</h2><span>{props.analysis?.catalog.workspace.label}</span></div><button type="button" aria-label={t("library.close")} title={t("library.close")} onClick={props.onClose}><X size={18} aria-hidden="true" /></button></header>
    <div className="customization-dialog-filters">
      <label>{t("library.category")}<select aria-label={t("library.category")} value={props.category} onChange={(event) => props.onCategory(event.target.value as CustomizationCategory)}>{CUSTOMIZATION_CATEGORIES.map((key) => <option key={key} value={key}>{t(`library.categories.${key}`)}</option>)}</select></label>
      <label>{t("library.agent")}<select aria-label={t("library.agent")} value={host} onChange={(event) => setHost(event.target.value)}><option value="all">{t("library.allAgents")}</option>{hostIds.map((id) => <option key={id} value={id}>{hostLabel(id)}</option>)}{props.rows.some((row) => row.hosts.length === 0) && <option value="unassigned">{t("library.unassigned")}</option>}</select></label>
      {props.enabled && <button type="button" disabled={props.loading} onClick={props.onAnalyze}><ArrowClockwise size={15} aria-hidden="true" />{props.loading ? t("loadingCatalog") : props.failure ? t("library.retry") : t("library.refresh")}</button>}
    </div>
    <div className="customization-dialog-content" tabIndex={0} aria-busy={props.loading}>
      {props.failure && <p role="alert">{props.failure}</p>}
      {props.loading && <p role="status">{t("loadingCatalog")}</p>}
      {!props.enabled ? <p>{t("empty.detailConnected")}</p> : props.analysis === undefined ? <section className="customization-library-empty"><p>{props.loading ? t("collecting") : t("library.loadFailed")}</p></section> : <>
        {props.category === "overview" && <section className="customization-agent-overview" aria-label={t("library.agent")}>
          {hosts.filter((item) => host === "all" || item.id === host).map((item) => <div key={item.id}><strong>{item.label}</strong><span>{t("library.entryCount", { count: filterCustomizationRows(props.rows, "overview", item.id).length })}</span><small>{item.status === "ok" ? t("hosts.collected") : t(`hosts.status.${item.status}`)}</small></div>)}
        </section>}
        {props.analysis.catalog.runtimeObservations.map((item) => item.kind === "host-collection" && item.message && (host === "all" || host === item.hostId) ? <p key={item.id} role={item.status === "error" ? "alert" : "status"}>{hostLabel(item.hostId)}: {item.message}</p> : null)}
        <div className="customization-list-heading"><h3>{t(`library.categories.${props.category}`)}</h3><span>{t("library.entryCount", { count: rows.length })}</span></div>
        {props.category === "tools" && <p>{t("library.toolsBoundary")}</p>}
        {rows.length === 0 ? <p>{t("library.noEntries")}</p> : <ul className="customization-entry-list">{rows.map((row) => <li key={`${row.category}:${row.id}`}>
          <div className="customization-entry-name"><strong>{row.name}</strong><span className="customization-entry-agents">{row.hosts.length === 0 ? t("library.unassigned") : row.hosts.map(hostLabel).join(", ")}</span></div>
          {row.description && <p>{row.description}</p>}
          <div className="customization-entry-meta"><span>{t(`library.categories.${row.category}`)}</span><span>{t(`library.scopes.${row.scope}`)}</span><span>{t(`library.evidence.${row.evidence}`)}</span></div>
          <code>{row.source ?? t("results.opaqueSource")}</code>
        </li>)}</ul>}
      </>}
    </div>
  </dialog>;
}
