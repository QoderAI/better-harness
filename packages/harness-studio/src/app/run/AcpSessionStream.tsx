import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { timelineItems, type AcpPendingPermission, type HarnessRunState, type TimelineItem } from "./run-store.js";
import { TimelineEntry } from "./TimelineEntry.js";

/** A host-independent view: callers own launch, routing and permission authority. */
export function AcpSessionStream({ state, prompt, failure, onPermission, permissionClassName = "" }: {
  state: HarnessRunState;
  prompt: string;
  failure?: string;
  onPermission?: (requestId: string, optionId: string) => Promise<void>;
  permissionClassName?: string;
}): React.JSX.Element {
  const { t } = useTranslation("run");
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastScrollTop = useRef(0);
  const [paused, setPaused] = useState(false);
  const items = useMemo(() => timelineItems(state), [state.timelineRevision, state.timelineByKey]);
  const session = state.acp;
  const follow = (): void => {
    if (following.current && scroll.current !== null) {
      const list = scroll.current;
      // ResizeObserver can run before the scroll event for a reader's upward
      // movement. Check that position before writing or we would undo it.
      if (list.scrollTop < lastScrollTop.current && list.scrollHeight - list.scrollTop - list.clientHeight > 24) {
        following.current = false;
        lastScrollTop.current = list.scrollTop;
        setPaused(true);
        return;
      }
      list.scrollTop = list.scrollHeight;
      lastScrollTop.current = list.scrollTop;
    }
  };
  useLayoutEffect(follow, [state.timelineRevision]);
  useEffect(() => {
    following.current = true;
    setPaused(false);
    follow();
  }, [state.runId]);
  // Text reveal and expanded payloads can grow without a parent render. Observe
  // the content, not only the incoming chunk count, to keep the bottom anchored.
  useEffect(() => {
    if (content.current === null || scroll.current === null) return;
    const observer = new ResizeObserver(follow);
    observer.observe(content.current);
    observer.observe(scroll.current);
    return () => observer.disconnect();
  }, []);

  return <div className="acp-session-stream">
    {onPermission !== undefined && state.pendingPermission !== undefined && <AcpPermissionGate
      key={state.pendingPermission.requestId}
      permission={state.pendingPermission}
      onPermission={onPermission}
      className={permissionClassName}
    />}
    {(failure ?? state.error) && <p className="acp-session-error" role="alert">{failure ?? state.error}</p>}
    <div className="acp-session-scroll" ref={scroll} tabIndex={0} aria-label={t("session.transcript")}
      onScroll={(event) => {
        const list = event.currentTarget;
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= 24;
        // A scroll event queued by our own last write can arrive after another
        // text reveal increased scrollHeight. Only upward movement means the
        // reader stopped following; distance alone mistakes growth for intent.
        if (atBottom) following.current = true;
        else if (list.scrollTop < lastScrollTop.current) following.current = false;
        lastScrollTop.current = list.scrollTop;
        setPaused(!following.current);
      }}>
      <div className="acp-session-content" ref={content}>
        {prompt && <section className="acp-session-prompt"><strong>{t("live.userRequest")}</strong><p>{prompt}</p></section>}
        {(session.title || session.mode || session.config?.length || session.usage) && <dl className="acp-session-facts">
          {session.title && <div><dt>{t("session.title")}</dt><dd>{session.title}</dd></div>}
          {session.mode && <div><dt>{t("session.mode")}</dt><dd>{session.mode}</dd></div>}
          {session.config?.map((option) => <div key={option.id}><dt>{option.name}</dt><dd>{String(option.value)}</dd></div>)}
          {session.usage && <div><dt>{t("session.context")}</dt><dd>{session.usage.used.toLocaleString()} / {session.usage.size.toLocaleString()}</dd></div>}
          {session.usage?.cost && <div><dt>{t("session.cost")}</dt><dd>{session.usage.cost.amount} {session.usage.cost.currency}</dd></div>}
        </dl>}
        {session.plan !== undefined && session.plan.length > 0 && <details className="acp-session-plan" open>
          <summary>{t("session.plan", { completed: session.plan.filter((entry) => entry.status === "completed").length, total: session.plan.length })}</summary>
          <ol>{session.plan.map((entry, index) => <li key={index} data-status={entry.status}><span>{t(`session.planStatus.${entry.status}`)}</span><p>{entry.content}</p></li>)}</ol>
        </details>}
        {session.commands !== undefined && session.commands.length > 0 && <details className="acp-session-commands"><summary>{t("session.commands", { count: session.commands.length })}</summary><p>{t("session.observedOnly")}</p><dl>{session.commands.map((command) => <div key={command.name}><dt>/{command.name}</dt><dd>{command.description}</dd></div>)}</dl></details>}
        {session.partial && <p className="acp-session-notice">{t("session.partial")}</p>}
        {!!session.unsupported?.length && <details className="acp-session-notice"><summary>{t("session.unsupported")}</summary><p>{session.unsupported.join(", ")}</p></details>}
        {state.warnings.map((warning, index) => <p className="acp-session-notice" key={index}>{warning}</p>)}
        <ol className="acp-session-events">
          {items.map((item) => <SessionEntry key={`${item.kind}:${item.id}`} item={item} tool={session.tools.get(item.id)} />)}
        </ol>
        {items.length === 0 && <p className="acp-session-notice" role="status">{t(state.status === "running" ? "live.waiting" : "session.empty")}</p>}
      </div>
    </div>
    {paused && <button className="acp-session-latest" type="button" onClick={() => {
      following.current = true;
      lastScrollTop.current = scroll.current?.scrollTop ?? 0;
      setPaused(false);
      follow();
      scroll.current?.focus({ preventScroll: true });
    }}>{t("session.latest")}</button>}
  </div>;
}

const SessionEntry = memo(function SessionEntry({ item, tool }: {
  item: TimelineItem;
  tool?: HarnessRunState["acp"]["tools"] extends ReadonlyMap<string, infer Value> ? Value : never;
}): React.JSX.Element {
  let projected = item;
  if (item.kind === "tool-call" && tool !== undefined) {
    projected = { ...item,
      ...(tool.title === undefined ? {} : { name: tool.title }),
      ...(tool.input === undefined ? {} : { argsText: stringify(tool.input) }),
      ...(tool.output === undefined ? {} : { resultText: stringify(tool.output) }),
      ...(tool.status === "failed" ? { status: "failed" }
        : tool.status === "completed" ? { status: "completed" } : {}),
    };
  }
  return <li><TimelineEntry item={projected} /></li>;
});

function stringify(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value); }

export function AcpPermissionGate({ permission, onPermission, className = "", showKind = false }: {
  permission: AcpPendingPermission;
  onPermission: (requestId: string, optionId: string) => Promise<void>;
  className?: string;
  showKind?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation("run");
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [submitted, setSubmitted] = useState(false);
  async function decide(optionId: string): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      await onPermission(permission.requestId, optionId);
      setSubmitted(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      busy.current = false;
    } finally { setPending(false); }
  }
  return <section className={`acp-permission-gate ${className}`} aria-label={t("inspector.acpPermission")}>
    <strong role="status">{permission.title}</strong>
    <div>{permission.options.map((option) => <button key={option.optionId} type="button" disabled={pending || submitted} onClick={() => void decide(option.optionId)}>{option.name}{showKind && <span>{option.kind}</span>}</button>)}</div>
    {(pending || submitted) && <p role="status">{t(submitted ? "session.decisionSent" : "session.sending")}</p>}
    {error && <p className="acp-session-error" role="alert">{error}</p>}
  </section>;
}
