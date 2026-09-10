import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { DebuggerEvent } from "../../contracts/debugger-session.js";

/**
 * The retained conversation, rendered the same way wherever it is read.
 *
 * Timing and dialogue are two projections of one Session, so this list is the
 * single place either surface renders it. A call the reader selected elsewhere
 * is addressed by the invocation id both projections recorded, which is why a
 * timing interval and the message that produced it line up exactly instead of
 * being matched by position or by a clock.
 */
export function SessionTranscript(props: {
  events: DebuggerEvent[];
  /** Recorded invocation id to reveal; scrolled into view when it changes. */
  activeToolCallId?: string;
  onSelectToolCall?: (toolCallId: string) => void;
  /** Invocation ids this reader can follow back to a timing interval. */
  linkedToolCallIds?: ReadonlySet<string>;
}): React.JSX.Element {
  const { t } = useTranslation("sessions");
  const active = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (props.activeToolCallId === undefined) return;
    active.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [props.activeToolCallId]);
  return <ol className="session-event-rows">{props.events.map((event) => {
    const calls = event.toolCalls ?? [];
    const matched = calls.some((call) => toolCallIds(call).includes(props.activeToolCallId ?? ""));
    return <li key={event.id} ref={matched ? active : undefined} aria-current={matched ? "true" : undefined} className={matched ? "matched" : undefined}>
      <time>{event.timestamp}</time>
      <span><strong>{event.phase} · {event.title}</strong><small>{event.summary}</small></span>
      {calls.length > 0 && <em className="session-event-calls">{calls.map((call) => {
        const ids = toolCallIds(call);
        const linked = props.onSelectToolCall !== undefined && ids.some((id) => props.linkedToolCallIds?.has(id) ?? false);
        const current = ids.includes(props.activeToolCallId ?? "");
        return linked
          ? <button
            key={call.id}
            type="button"
            className="session-event-call"
            aria-pressed={current}
            aria-label={t("transcript.revealTiming", { name: call.name })}
            onClick={() => props.onSelectToolCall?.(ids.find((id) => props.linkedToolCallIds?.has(id)) ?? call.id)}
          >{call.name}</button>
          : <span key={call.id} className="session-event-call">{call.name}</span>;
      })}</em>}
    </li>;
  })}</ol>;
}

/** A projection may keep the recorded id, a per-resource copy of it, or both. */
export function toolCallIds(call: { id: string; sourceCallId?: string }): string[] {
  return call.sourceCallId === undefined || call.sourceCallId === call.id
    ? [call.id]
    : [call.sourceCallId, call.id];
}
