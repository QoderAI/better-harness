import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseAcpConfig, type AcpConfigOption } from "../../contracts/acp-session-config.js";
import type { AcpSessionState } from "./acp-session-state.js";
import type { AcpSessionActions, AcpSessionAction } from "./acp-session-actions.js";
import { saveAcpAgentPreferences } from "./acp-session-preferences.js";
export { postAcpSessionAction } from "./acp-session-actions.js";

/** Compact current-value controls, with less common options in one disclosure. */
export function AcpSessionSettings({ session, runId, active, actions, agentId, compact = true }: { session: AcpSessionState; runId?: string; active: boolean; actions?: AcpSessionActions; agentId?: string; compact?: boolean }): React.JSX.Element | null {
  const { t } = useTranslation("run");
  const id = useId();
  const [config, setConfig] = useState(session.config);
  const [mode, setMode] = useState(session.mode);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const busy = useRef(false);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const observedConfig = useRef(session.config);
  observedConfig.current = session.config;
  useEffect(() => { setConfig(session.config); }, [session.config]);
  useEffect(() => { setMode(session.mode); }, [session.mode]);
  useEffect(() => { setError(undefined); }, [runId]);
  const editable = active && session.controllable && actions !== undefined;
  async function apply(key: string, action: AcpSessionAction): Promise<void> {
    if (!editable || busy.current) return;
    const before = observedConfig.current;
    busy.current = true; setPending(key); setError(undefined);
    try {
      const result = await actions!.execute(action);
      // A newer protocol notification is authoritative over a delayed HTTP ack.
      const nextConfig = result.configOptions !== undefined ? parseAcpConfig(result.configOptions) : undefined;
      const nextMode = typeof result.modeId === "string" ? result.modeId : session.mode;
      if (nextConfig !== undefined && observedConfig.current === before) setConfig(nextConfig);
      if (typeof result.modeId === "string") setMode(result.modeId);
      saveAcpAgentPreferences(agentId, nextConfig ?? config ?? [], nextMode);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busy.current = false; setPending(undefined); }
  }
  const legacy = config === undefined && session.modes?.length;
  if (!config?.length && !legacy) return null;
  const core = (config ?? []).filter(option => ["model", "thought_level", "mode"].includes(option.category ?? option.id));
  const extra = (config ?? []).filter(option => !core.includes(option));
  function field(option: AcpConfigOption, compact = false): React.JSX.Element {
    const choices = query && !compact ? option.choices.filter(choice => choice.value === option.value || `${choice.name} ${choice.group ?? ""} ${choice.description ?? ""}`.toLowerCase().includes(query.toLowerCase())) : option.choices;
    return <div className={`acp-setting${compact ? " acp-setting-compact" : ""}`} key={option.id}>
      <label htmlFor={`${id}-${compact ? "core" : "more"}-${option.id}`}>{option.name}</label>
      {option.type === "boolean" ? <input id={`${id}-${compact ? "core" : "more"}-${option.id}`} type="checkbox" checked={option.value === true} disabled={!editable || pending !== undefined} onChange={event => void apply(option.id, { action: "config", configId: option.id, value: event.target.checked })} />
        : option.type === "select" ? <select id={`${id}-${compact ? "core" : "more"}-${option.id}`} title={`${option.name}${option.description ? `: ${option.description}` : ""}`} value={String(option.value)} disabled={!editable || pending !== undefined} onChange={event => void apply(option.id, { action: "config", configId: option.id, value: event.target.value })}>
          {!choices.some(choice => choice.value === option.value) && <option value={String(option.value)} disabled>{String(option.value)}</option>}
          {[...new Set(choices.map(choice => choice.group))].map(group => {
            const items = choices.filter(choice => choice.group === group).map(choice => <option key={choice.value} value={choice.value} title={choice.description}>{choice.name}</option>);
            return group === undefined ? items : <optgroup key={group} label={group}>{items}</optgroup>;
          })}
        </select> : <output>{String(option.value)} · {t("session.unsupportedSetting")}</output>}
      {!compact && option.description && <p className="acp-setting-description">{option.description}</p>}
    </div>;
  }
  return <div className="acp-config-toolbar">
    {core.map(option => field(option, compact))}
    {!!legacy && <select aria-label={t("session.mode")} value={mode ?? ""} disabled={!editable || pending !== undefined} onChange={event => void apply("mode", { action: "mode", modeId: event.target.value })}>{session.modes!.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
    {extra.length > 0 && <details className="acp-session-settings" ref={disclosure} onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "search") event.preventDefault(); if (event.key === "Escape") { event.preventDefault(); disclosure.current!.open = false; disclosure.current?.querySelector("summary")?.focus(); } }}>
      <summary title={t("session.settings")} aria-label={t("session.settings")}>···</summary>
      <div className="acp-settings-fields">
        <input type="search" aria-label={t("conversation.searchSettings")} placeholder={t("conversation.searchSettings")} value={query} onChange={event => setQuery(event.target.value)} />
        {extra.map(option => field({ ...option, id: `${option.id}` }))}
      </div>
    </details>}
    {pending && <span role="status">{t("session.saving")}</span>}
    {error && <p role="alert" className="acp-setting-error">{error}</p>}
  </div>;
}
