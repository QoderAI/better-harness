import { useStickToBottomContext } from "use-stick-to-bottom";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { Wrench } from "@phosphor-icons/react/Wrench";
import { useSessionOwnedState } from "./session-view-store.js";
import { activitySummary, conversationBlocks } from "./conversation-activity.js";
import { projectAcpTool, observedToolPaths } from "./acp-tool-projection.js";
import { AcpConnectionPanel } from "./AcpConnectionPanel.js";
import type { AcpSessionActions } from "./acp-session-actions.js";
import { AcpComposer } from "./AcpComposer.js";
import { AcpContent, AcpTerminalContext } from "./AcpContent.js";
import { AcpSessionSettings } from "./AcpSessionSettings.js";
import { memo, useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { timelineItems, type AcpPendingPermission, type HarnessRunState, type TimelineItem } from "./run-store.js";
import { TimelineEntry, ToolCallEntry } from "./TimelineEntry.js";

import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "../components/ai-elements/conversation.js";
import { Message, MessageContent } from "../components/ai-elements/message.js";
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtStep } from "../components/ai-elements/chain-of-thought.js";
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationTitle } from "../components/ai-elements/confirmation.js";
import { AcpConversationPosition } from "./AcpConversationPosition.js";
import { planElementState } from "./ai-elements-adapter.js";
import { defaultAcpConfigValue, loadAcpAgentPreferences, saveAcpAgentPreferences } from "./acp-session-preferences.js";

/** A host-independent view: callers own launch, routing and permission authority. */
export function AcpSessionStream({ state, prompt, failure, onPermission, actions, permissionClassName = "", compact = false, showComposer = true, revealTool, contextEvidence, agentId }: {
  revealTool?: { id: string; token: number };
  contextEvidence?: React.ReactNode;
  state: HarnessRunState;
  compact?: boolean;
  showComposer?: boolean;
  actions?: AcpSessionActions;
  prompt: string;
  failure?: string;
  onPermission?: (requestId: string, optionId: string) => Promise<void>;
  permissionClassName?: string;
  /** Optional stable agent identifier used to remember config choices across runs. */
  agentId?: string;
}): React.JSX.Element {
  const { t } = useTranslation("run");
  const [startError, setStartError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [autoConfigured, setAutoConfigured] = useState(false);
  const items = useMemo(() => timelineItems(state), [state.timelineRevision, state.timelineByKey]);
  const blocks = useMemo(() => conversationBlocks(items), [items]);
  const session = state.acp;

  useEffect(() => {
    if (!session.prepared || state.conversation || !actions || autoConfigured) return;
    const needsConfig = (session.config?.length ?? 0) > 0 || (session.modes?.length ?? 0) > 0;
    if (!needsConfig) {
      setAutoConfigured(true);
      void actions.execute({ action: "start" }).catch(error => setStartError(String(error)));
      return;
    }
    setAutoConfigured(true);
    void (async () => {
      const preferences = loadAcpAgentPreferences(agentId);
      for (const option of session.config ?? []) {
        const target = preferences?.values[option.id] ?? defaultAcpConfigValue(option);
        if (target !== undefined && target !== option.value) {
          try {
            await actions.execute({ action: "config", configId: option.id, value: target });
          } catch {
            // Leave manual configuration available if an automatic choice fails.
            return;
          }
        }
      }
      if (session.mode === undefined && session.modes?.length) {
        const modeId = preferences?.mode ?? session.modes[0]!.id;
        try { await actions.execute({ action: "mode", modeId }); } catch { return; }
      }
      saveAcpAgentPreferences(agentId, session.config ?? [], session.mode);
      try { await actions.execute({ action: "start" }); } catch (error) { setStartError(String(error)); }
    })();
  }, [session.prepared, state.conversation, actions, session.config, session.modes, session.mode, agentId, autoConfigured]);

  if (state.connection && state.status === "running" && actions && state.runId) return <AcpConnectionPanel key={state.runId} runId={state.runId} connection={state.connection} actions={actions} />;

  return <AcpTerminalContext.Provider value={session.terminals}><div className="acp-session-stream">
    {onPermission !== undefined && <div className="acp-permission-list">{state.pendingPermissions.map(permission => <AcpPermissionGate
      key={permission.requestId}
      permission={permission}
      onPermission={onPermission}
      className={permissionClassName}
    />)}</div>}
    {(failure ?? state.error) && <p className="acp-session-error" role="alert">{failure ?? state.error}</p>}
    <Conversation key={state.runId ?? "empty"} initial={false} aria-label={t("session.transcript")}>
      <ConversationContent className="acp-session-content" scrollClassName="acp-session-scroll">
        {contextEvidence}
        {prompt && !state.conversation && <Message className="acp-session-prompt" from="user" aria-label={t("live.userRequest")}><MessageContent><p>{prompt}</p></MessageContent></Message>}
        {!compact && <details className="acp-session-metadata"><summary>{t("session.details")}</summary>
        {(session.title || session.updatedAt) && <details className="acp-session-info"><summary>{t("session.title")}<span>{session.title}</span></summary><dl>
          {session.title && <div><dt>{t("session.title")}</dt><dd>{session.title}</dd></div>}
          {session.updatedAt && <div><dt>{t("session.updatedAt")}</dt><dd><time dateTime={session.updatedAt}>{session.updatedAt}</time></dd></div>}
        </dl></details>}
        {((session.config === undefined && !session.modes?.length && session.mode) || session.usage) && <dl className="acp-session-facts">
          {session.config === undefined && !session.modes?.length && session.mode && <div><dt>{t("session.mode")}</dt><dd>{session.mode}</dd></div>}

          {session.usage && <div><dt>{t("session.context")}</dt><dd>{session.usage.used.toLocaleString()} / {session.usage.size.toLocaleString()}</dd></div>}
          {session.usage?.cost && <div><dt>{t("session.cost")}</dt><dd>{session.usage.cost.amount} {session.usage.cost.currency}</dd></div>}
        </dl>}

        {session.plan !== undefined && session.plan.length > 0 && <ChainOfThought className="acp-session-plan">
          <ChainOfThoughtHeader>{t("session.plan", { completed: session.plan.filter((entry) => entry.status === "completed").length, total: session.plan.length })}</ChainOfThoughtHeader>
          <ChainOfThoughtContent>{session.plan.map((entry, index) => <ChainOfThoughtStep key={index} status={planElementState(entry.status)} label={entry.content} description={`${t(`session.planStatus.${entry.status}`)} · ${t(`session.planPriority.${entry.priority}`)}`} />)}</ChainOfThoughtContent>
        </ChainOfThought>}
        </details>}
        {session.partial && <p className="acp-session-notice">{t("session.partial")}</p>}
        {!!session.unsupported?.length && <details className="acp-session-notice"><summary>{t("session.unsupported")}</summary><p>{session.unsupported.join(", ")}</p></details>}
        {state.warnings.map((warning, index) => <p className="acp-session-notice" key={index}>{warning}</p>)}
        <ol className="acp-session-events">
          {blocks.map(block => block.kind === "message"
            ? <SessionEntry scope={state.runId} key={block.key} item={block.item} />
            : <SessionActivity key={block.key} groupKey={block.key} items={block.items} state={state} revealTool={revealTool} />)}
        </ol>
        {!compact && items.length === 0 && <ConversationEmptyState role="status" title={t(session.prepared ? "session.readyToSend" : state.status === "running" ? "live.waiting" : "session.empty")} />}
      </ConversationContent>
      {/* Mount after Content so its scroll ref exists before layout restoration. */}
      <AcpConversationPosition sessionKey={state.runId} turnKey={state.conversation?.turns.at(-1)?.turnId} label={t("session.transcript")} />
      {items.length > 0 && <ConversationScrollButton>{t("session.latest")}</ConversationScrollButton>}
    </Conversation>
    {showComposer && <footer className="acp-conversation-footer">
      {state.conversation && actions && <AcpComposer key={state.runId} state={state} actions={actions} agentId={agentId} toolbar={<>
        <AcpSessionSettings session={session} runId={state.runId} active={state.status === "running" && state.conversation.status !== "closed"} actions={actions} agentId={agentId} />
        {session.usage && <small className="ai-prompt-usage" title={t("session.context")}>{Math.round(session.usage.used / Math.max(session.usage.size, 1) * 100)}%</small>}
      </>} />}
      {session.prepared && !state.conversation && actions && <AcpSessionSettings session={session} runId={state.runId} active={state.status === "running"} actions={actions} agentId={agentId} />}
      {session.prepared && actions && <button type="button" disabled={starting} onClick={() => { setStarting(true); setStartError(undefined); void actions.execute({ action: "start" }).catch(error => setStartError(String(error))).finally(() => setStarting(false)); }}>{t("session.sendPrompt")}</button>}
      {startError && <p role="alert">{startError}</p>}
    </footer>}
  </div></AcpTerminalContext.Provider>;
}

const SessionActivity = memo(function SessionActivity({ groupKey, items, state, revealTool }: {
  groupKey: string; items: TimelineItem[]; state: HarnessRunState; revealTool?: { id: string; token: number };
}): React.JSX.Element {
  const { t } = useTranslation("run");
  const [open, setOpen] = useSessionOwnedState(`${state.runId}:activity:${groupKey}`, false);
  const revealToken = items.some(item => item.kind === "tool-call" && item.id === revealTool?.id) ? revealTool?.token : undefined;
  const { stopScroll } = useStickToBottomContext();
  useLayoutEffect(() => {
    if (revealToken !== undefined) { stopScroll(); setOpen(true); }
  }, [revealToken, setOpen, stopScroll]);
  const summary = activitySummary(items, state.acp.tools);
  const label = Object.entries(summary.counts).filter(([, count]) => count > 0)
    .map(([kind, count]) => t(`session.activity.${kind}`, { count })).join(" · ");
  return <li className="acp-activity-row"><Collapsible.Root className="acp-activity" open={open} onOpenChange={next => { stopScroll(); setOpen(next); }}>
    <Collapsible.Trigger className="acp-activity-header">
      <Wrench size={15} aria-hidden="true" />
      <span className="acp-activity-label">{label}</span>
      {summary.paths.length > 0 && <code className="acp-activity-path" title={summary.paths.join("\n")}>{summary.paths[0]}{summary.paths.length > 1 && ` +${summary.paths.length - 1}`}</code>}
      <span className="acp-activity-status" role="status">{Object.entries(summary.statuses).filter(([, count]) => count > 0).map(([status, count]) => <span key={status} data-status={status}>{t(`session.activity.${status}`, { count })}</span>)}</span>
      <CaretRight className="acp-activity-chevron" size={14} aria-hidden="true" />
    </Collapsible.Trigger>
    <Collapsible.Content className="acp-activity-content"><ol>{items.map(item => <SessionEntry key={`${item.kind}:${item.id}`} flatThought scope={state.runId} item={item} tool={state.acp.tools.get(item.id)} revealToken={revealTool?.id === item.id ? revealTool.token : undefined} />)}</ol></Collapsible.Content>
  </Collapsible.Root></li>;
});

const SessionEntry = memo(function SessionEntry({ item, tool, scope, revealToken, flatThought }: {
  flatThought?: boolean;
  revealToken?: number;
  scope?: string;
  item: TimelineItem;
  tool?: HarnessRunState["acp"]["tools"] extends ReadonlyMap<string, infer Value> ? Value : never;
}): React.JSX.Element {
  const { stopScroll } = useStickToBottomContext();
  useLayoutEffect(() => { if (revealToken !== undefined) stopScroll(); }, [revealToken, stopScroll]);
  const projected = projectAcpTool(item, tool);
  return <li>{projected.kind === "tool-call" ? <ToolCallEntry revealToken={revealToken} persistenceKey={`${scope}:tool:${item.id}`} item={projected} filePaths={observedToolPaths(tool)} richResult={!!tool?.content?.length && tool.output === undefined}>
    {tool?.kind && <p className="acp-tool-kind">{tool.kind}</p>}
    {!!tool?.locations?.length && <ul className="acp-tool-locations">{tool.locations.map((location, index) => <li key={index}><code>{location.path}{location.line === undefined ? "" : `:${location.line}`}</code></li>)}</ul>}
    {tool?.content?.map((value, index) => <AcpContent value={value} key={index} />)}
  </ToolCallEntry> : <TimelineEntry item={projected} flatThought={flatThought} persistenceKey={`${scope}:${item.kind}:${item.id}`} />}</li>;
});

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
  return <Confirmation className={`acp-permission-gate ${className}`} approval={{ id: permission.requestId }} state={submitted ? "approval-responded" : "approval-requested"} aria-label={t("inspector.acpPermission")}>
    <ConfirmationTitle role="status">{permission.title}</ConfirmationTitle>
    <ConfirmationActions>{permission.options.map((option) => <ConfirmationAction key={option.optionId} data-option-kind={option.kind} disabled={pending || submitted} onClick={() => void decide(option.optionId)}>{option.name}{showKind && <span>{option.kind}</span>}</ConfirmationAction>)}</ConfirmationActions>
    {(pending || submitted) && <p role="status">{t(submitted ? "session.decisionSent" : "session.sending")}</p>}
    {error && <p className="acp-session-error" role="alert">{error}</p>}
  </Confirmation>;
}
