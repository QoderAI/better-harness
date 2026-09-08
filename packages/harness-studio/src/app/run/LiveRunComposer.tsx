import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { LiveAgentChoice } from "./live-agent-choices.js";

/** Owns dialog layout and focus; RunView continues to own the draft and launch. */
export function LiveRunComposer(props: {
  projectLabel?: string;
  agents: readonly LiveAgentChoice[];
  selectedAgent?: LiveAgentChoice;
  prompt: string;
  running: boolean;
  onAgent: (value: string) => void;
  onPrompt: (value: string) => void;
  onClose: () => void;
  onRun: () => void;
  onChooseSession?: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("run");
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const canRun = !props.running && props.prompt.trim().length > 0 && props.selectedAgent !== undefined;
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    element.showModal();
    input.current?.focus();
    return () => { element.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={dialog} className="live-composer" aria-labelledby="live-composer-title"
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("select, textarea, button:not(:disabled)"));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onCancel={(event) => { event.preventDefault(); props.onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) props.onClose();
    }}>
    <form onSubmit={(event) => { event.preventDefault(); if (canRun) props.onRun(); }}>
      <header><h2 id="live-composer-title">{t("composer.title")}</h2>{props.projectLabel && <span title={props.projectLabel}>{props.projectLabel}</span>}</header>
      <label className="live-composer-agent"><span>{t("composer.agent")}</span>
        <select value={props.selectedAgent?.value ?? ""} onChange={(event) => props.onAgent(event.target.value)}>
          {props.agents.map((choice) => <option key={choice.value} value={choice.value} disabled={!choice.available} title={choice.detail}>{choice.available ? choice.label : t("composer.agentUnavailable", { agent: choice.label })}</option>)}
        </select>
      </label>
      <textarea ref={input} value={props.prompt} aria-label={t("composer.promptLabel")} placeholder={t("composer.promptPlaceholder")} onChange={(event) => props.onPrompt(event.target.value)} rows={4} />
      <footer>{props.onChooseSession && <button type="button" disabled={!canRun} onClick={props.onChooseSession}>{t("connection.title")}</button>}<button type="button" onClick={props.onClose}>{t("composer.cancel")}</button><button type="submit" className="primary" disabled={!canRun}>{t("composer.run")}</button></footer>
    </form>
  </dialog>;
}
