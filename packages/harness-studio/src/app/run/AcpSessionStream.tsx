import { AcpConnectionPanel } from "./AcpConnectionPanel.js";
import type { AcpSessionActions } from "./acp-session-actions.js";
import { AcpComposer } from "./AcpComposer.js";
import { AcpContent, AcpTerminalContext } from "./AcpContent.js";
import { AcpSessionSettings } from "./AcpSessionSettings.js";
import { memo, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { timelineItems, type AcpPendingPermission, type HarnessRunState, type TimelineItem } from "./run-store.js";
import { TimelineEntry, ToolCallEntry } from "./TimelineEntry.js";

import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "../components/ai-elements/conversation.js";
import { Message, MessageContent } from "../components/ai-elements/message.js";
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtStep } from "../components/ai-elements/chain-of-thought.js";
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationTitle } from "../components/ai-elements/confirmation.js";
import { AcpConversationPosition } from "./AcpConversationPosition.js";
import { planElementState } from "./ai-elements-adapter.js";

/** A host-independent view: callers own launch, routing and permission authority. */
export function AcpSessionStream({ state, prompt, failure, onPermission, actions, permissionClassName = "", compact = false, showComposer = true }: {
  state: HarnessRunState;
  compact?: boolean;
  showComposer?: boolean;
  actions?: AcpSessionActions;
  prompt: string;
  failure?: string;
  onPermission?: (requestId: string, optionId: string) => Promise<void>;
  permissionClassName?: string;
}): React.JSX.Element {
  const { t } = useTranslation("run");
  const [startError, setStartError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const items = useMemo(() => timelineItems(state), [state.timelineRevision, state.timelineByKey]);
  const session = state.acp;

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
        {prompt && !state.conversation && <Message className="acp-session-prompt" from="user"><strong>{t("live.userRequest")}</strong><MessageContent><p>{prompt}</p></MessageContent></Message>}
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
        {session.commands !== undefined && session.commands.length > 0 && <details className="acp-session-commands"><summary>{t("session.commands", { count: session.commands.length })}</summary><p>{t("session.observedOnly")}</p><dl>{session.commands.map((command) => <div key={command.name}><dt>/{command.name}</dt><dd>{command.description}{command.inputHint && <p className="acp-command-hint">{t("session.commandInput", { hint: command.inputHint })}</p>}</dd></div>)}</dl></details>}
        </details>}
        {session.partial && <p className="acp-session-notice">{t("session.partial")}</p>}
        {!!session.unsupported?.length && <details className="acp-session-notice"><summary>{t("session.unsupported")}</summary><p>{session.unsupported.join(", ")}</p></details>}
        {state.warnings.map((warning, index) => <p className="acp-session-notice" key={index}>{warning}</p>)}
        <ol className="acp-session-events">
          {items.map((item) => <SessionEntry scope={state.runId} key={`${item.kind}:${item.id}`} item={item} tool={session.tools.get(item.id)} />)}
        </ol>
        {!compact && items.length === 0 && <ConversationEmptyState role="status" title={t(session.prepared ? "session.readyToSend" : state.status === "running" ? "live.waiting" : "session.empty")} />}
      </ConversationContent>
      {/* Mount after Content so its scroll ref exists before layout restoration. */}
      <AcpConversationPosition sessionKey={state.runId} turnKey={state.conversation?.turns.at(-1)?.turnId} label={t("session.transcript")} />
      {items.length > 0 && <ConversationScrollButton>{t("session.latest")}</ConversationScrollButton>}
    </Conversation>
    {showComposer && <footer className="acp-conversation-footer">
      {state.conversation && actions && <AcpComposer key={state.runId} state={state} actions={actions} toolbar={<>
        <AcpSessionSettings session={session} runId={state.runId} active={state.status === "running" && state.conversation.status !== "closed"} actions={actions} />
        {session.usage && <small className="ai-prompt-usage" title={t("session.context")}>{Math.round(session.usage.used / Math.max(session.usage.size, 1) * 100)}%</small>}
      </>} />}
      {session.prepared && actions && <button type="button" disabled={starting} onClick={() => { setStarting(true); setStartError(undefined); void actions.execute({ action: "start" }).catch(error => setStartError(String(error))).finally(() => setStarting(false)); }}>{t("session.sendPrompt")}</button>}
      {startError && <p role="alert">{startError}</p>}
    </footer>}
  </div></AcpTerminalContext.Provider>;
}

const SessionEntry = memo(function SessionEntry({ item, tool, scope }: {
  scope?: string;
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
  return <li>{projected.kind === "tool-call" ? <ToolCallEntry persistenceKey={`${scope}:tool:${item.id}`} item={projected} richResult={!!tool?.content?.length && tool.output === undefined}>
    {tool?.kind && <p className="acp-tool-kind">{tool.kind}</p>}
    {!!tool?.locations?.length && <ul className="acp-tool-locations">{tool.locations.map((location, index) => <li key={index}><code>{location.path}{location.line === undefined ? "" : `:${location.line}`}</code></li>)}</ul>}
    {tool?.content?.map((value, index) => <AcpContent value={value} key={index} />)}
  </ToolCallEntry> : <TimelineEntry item={projected} persistenceKey={`${scope}:${item.kind}:${item.id}`} />}</li>;
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
  return <Confirmation className={`acp-permission-gate ${className}`} approval={{ id: permission.requestId }} state={submitted ? "approval-responded" : "approval-requested"} aria-label={t("inspector.acpPermission")}>
    <ConfirmationTitle role="status">{permission.title}</ConfirmationTitle>
    <ConfirmationActions>{permission.options.map((option) => <ConfirmationAction key={option.optionId} data-option-kind={option.kind} disabled={pending || submitted} onClick={() => void decide(option.optionId)}>{option.name}{showKind && <span>{option.kind}</span>}</ConfirmationAction>)}</ConfirmationActions>
    {(pending || submitted) && <p role="status">{t(submitted ? "session.decisionSent" : "session.sending")}</p>}
    {error && <p className="acp-session-error" role="alert">{error}</p>}
  </Confirmation>;
}
