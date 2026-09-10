import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { DebuggerEvent } from "../../contracts/debugger-session.js";

/**
 * The retained conversation, rendered the same way wherever it is read.
 *
 * Timing and dialogue are two projections of one Session, so this list is the
 * single place either surface renders it. A call the reader selected elsewhere
 * is addressed by the instant the evidence recorded for it: invocation ids are
 * reduced to a step index before a Session is projected, while both readings
 * take the start instant from the same record, so it lines a call up with its
 * interval exactly rather than by position or by tool name.
 */
export function SessionTranscript(props: {
  events: DebuggerEvent[];
  /** Recorded start instant to reveal; scrolled into view when it changes. */
  activeCallStartMs?: number;
  onSelectCall?: (startedAtMs: number) => void;
  /** Start instants this reader can follow back to a timing interval. */
  linkedCallStartMs?: ReadonlySet<number>;
}): React.JSX.Element {
  const { t } = useTranslation("sessions");
  const active = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (props.activeCallStartMs === undefined) return;
    active.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [props.activeCallStartMs]);
  return <ol className="session-event-rows">{props.events.map((event) => {
    const calls = event.toolCalls ?? [];
    const matched = calls.some((call) => call.startedAtMs !== undefined && call.startedAtMs === props.activeCallStartMs);
    return <li key={event.id} ref={matched ? active : undefined} aria-current={matched ? "true" : undefined}>
      <time>{event.timestamp}</time>
      <span><strong>{event.phase} · {event.title}</strong><small>{event.summary}</small></span>
      {calls.length > 0 && <em className="session-event-calls">{calls.map((call) => {
        const at = call.startedAtMs;
        const linked = props.onSelectCall !== undefined && at !== undefined && (props.linkedCallStartMs?.has(at) ?? false);
        return linked
          ? <button
            key={call.id}
            type="button"
            className="session-event-call"
            aria-pressed={at === props.activeCallStartMs}
            aria-label={t("transcript.revealTiming", { name: call.name })}
            onClick={() => props.onSelectCall?.(at)}
          >{call.name}</button>
          : <span key={call.id} className="session-event-call">{call.name}</span>;
      })}</em>}
    </li>;
  })}</ol>;
}
