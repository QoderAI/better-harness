// Copyright 2023 Vercel, Inc. SPDX-License-Identifier: Apache-2.0
// Adapted from AI Elements Prompt Input and PR #448. ACP owns files and drafts.
import { type ComponentProps, type KeyboardEvent, type Ref, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp } from "@phosphor-icons/react/ArrowUp";
import { At } from "@phosphor-icons/react/At";
import { Check } from "@phosphor-icons/react/Check";
import { ListPlus } from "@phosphor-icons/react/ListPlus";
import { SpinnerGap } from "@phosphor-icons/react/SpinnerGap";
import { Terminal } from "@phosphor-icons/react/Terminal";
import { findPromptMatch, replacePromptMatch, type PromptSuggestion } from "./prompt-input-model.js";

export const PromptInput = ({ className = "", ...props }: ComponentProps<"form">) => <form className={`ai-prompt-input ${className}`} {...props} />;
export const PromptInputHeader = ({ className = "", ...props }: ComponentProps<"div">) => <div className={`ai-prompt-header ${className}`} {...props} />;
export const PromptInputFooter = ({ className = "", ...props }: ComponentProps<"div">) => <div className={`ai-prompt-footer ${className}`} {...props} />;
export const PromptInputTools = ({ className = "", ...props }: ComponentProps<"div">) => <div className={`ai-prompt-tools ${className}`} {...props} />;
export const PromptInputButton = ({ className = "", type = "button", ...props }: ComponentProps<"button">) => <button type={type} className={`ai-prompt-button ${className}`} {...props} />;

export function PromptInputSubmit({ label, state = "send", pending, className = "", ...props }: Omit<ComponentProps<"button">, "children"> & { label: string; state?: "send" | "queue" | "save"; pending?: boolean }) {
  const Icon = pending ? SpinnerGap : state === "queue" ? ListPlus : state === "save" ? Check : ArrowUp;
  return <button type="submit" className={`primary ai-prompt-submit ${className}`} title={label} aria-label={label} aria-busy={pending || undefined} {...props}><Icon size={18} aria-hidden="true" className={pending ? "ai-prompt-spinner" : undefined} /></button>;
}

type TextareaProps = Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  onSend?: (immediately: boolean) => void;
  suggestions?: readonly PromptSuggestion[];
  suggestionLabels?: { commands: string; mentions: string; empty: string; keyboard: string };
};

function assignRef(ref: Ref<HTMLTextAreaElement> | undefined, node: HTMLTextAreaElement | null) {
  if (typeof ref === "function") ref(node); else if (ref) ref.current = node;
}

/** Native textarea retains copy/paste and IME; completions only replace a range. */
export function PromptInputTextarea({ value, onValueChange, onSend, suggestions = [], suggestionLabels, className = "", ref, onKeyDown, onSelect, onFocus, onBlur, onCompositionStart, onCompositionEnd, ...props }: TextareaProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const pendingCaret = useRef<number | undefined>(undefined);
  const [selection, setSelection] = useState({ start: value.length, end: value.length });
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const match = findPromptMatch(value, selection.start, selection.end);
  const items = match ? suggestions.filter(item => item.trigger === match.trigger && `${item.label} ${item.description ?? ""}`.toLocaleLowerCase().includes(match.query.toLocaleLowerCase())).slice(0, 8) : [];
  const open = focused && !dismissed && !composing.current && !props.disabled && !!match && !!suggestionLabels;
  const index = Math.min(active, Math.max(0, items.length - 1));

  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    // Toolbar insertions and browser selection APIs also move the caret without
    // an input event. React's onSelect waits for a keyboard/pointer event.
    const sync = () => setSelection({ start: node.selectionStart, end: node.selectionEnd });
    node.addEventListener("select", sync);
    return () => node.removeEventListener("select", sync);
  }, []);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    const resize = () => { node.style.height = "0px"; node.style.height = `${node.scrollHeight}px`; };
    resize();
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => { if (node.clientWidth !== width) { width = node.clientWidth; resize(); } });
    observer.observe(node);
    return () => observer.disconnect();
  }, [value]);
  useLayoutEffect(() => {
    if (pendingCaret.current === undefined) return;
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    setSelection({ start: pendingCaret.current, end: pendingCaret.current });
    pendingCaret.current = undefined;
  }, [value]);
  useLayoutEffect(() => { if (open) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [index, open]);

  function select(item: PromptSuggestion) {
    if (!match) return;
    const replacement = replacePromptMatch(value, match, item.value);
    pendingCaret.current = replacement.caret;
    onValueChange(replacement.value); setDismissed(true); input.current?.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(true); return; }
    if (open && items.length && plain) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); select(items[index]!); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (onSend) onSend(event.altKey || event.metaKey || event.ctrlKey);
      else {
        const submit = event.currentTarget.form?.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (!submit?.disabled) event.currentTarget.form?.requestSubmit();
      }
    }
  }
  return <div className="ai-prompt-body">
    {open && <div className="ai-prompt-suggestions">
      <div className="ai-prompt-suggestions-heading">{match?.trigger === "/" ? suggestionLabels!.commands : suggestionLabels!.mentions}<span>{suggestionLabels!.keyboard}</span></div>
      <div ref={list} id={id} role="listbox" aria-label={match?.trigger === "/" ? suggestionLabels!.commands : suggestionLabels!.mentions}>
        {items.map((item, position) => <div id={`${id}-${position}`} key={item.id} role="option" aria-selected={position === index} className="ai-prompt-option" onMouseDown={event => event.preventDefault()} onMouseMove={() => setActive(position)} onClick={() => select(item)}>
          {item.trigger === "/" ? <Terminal size={16} aria-hidden="true" /> : <At size={16} aria-hidden="true" />}<div><strong>{item.label}</strong>{item.description && <span>{item.description}</span>}</div>
        </div>)}
      </div>
      {!items.length && <p className="ai-prompt-suggestion-empty" role="status">{suggestionLabels!.empty}</p>}
    </div>}
    <textarea {...props} ref={node => { input.current = node; assignRef(ref, node); }} className={`ai-prompt-textarea ${className}`} value={value}
      role={suggestionLabels ? "combobox" : undefined} aria-autocomplete={suggestionLabels ? "list" : undefined} aria-haspopup={suggestionLabels ? "listbox" : undefined} aria-expanded={suggestionLabels ? open : undefined} aria-controls={open ? id : undefined} aria-activedescendant={open && items.length ? `${id}-${index}` : undefined}
      onChange={event => { onValueChange(event.target.value); setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd }); setActive(0); setDismissed(false); }}
      onSelect={event => { const node = event.currentTarget; setSelection({ start: node.selectionStart, end: node.selectionEnd }); onSelect?.(event); }}
      onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); setDismissed(false); onBlur?.(event); }}
      onCompositionStart={event => { composing.current = true; setDismissed(true); onCompositionStart?.(event); }}
      onCompositionEnd={event => { composing.current = false; onCompositionEnd?.(event); }} onKeyDown={keyDown} />
  </div>;
}
