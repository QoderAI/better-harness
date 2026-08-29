import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AguiEvent } from "@qoder-ai/harness-ui";
import type {
  ArtifactDescriptor,
  ArtifactHostedIntentOutcomeV1,
  ArtifactInteractionProposalV1,
  ArtifactInteractionTransitionReceiptV1,
  ArtifactInteractionWorkspaceV1,
} from "../../contracts/artifact.js";
import {
  ARTIFACT_AGENT_EVIDENCE_KIND,
  ARTIFACT_AGENT_PLAN_KIND,
  type ArtifactAgentPlanV1,
  type ArtifactAgentRunEvidenceV1,
  type ArtifactAgentRunPhaseV1,
} from "../../contracts/artifact-agent-run.js";
import { createSseParser } from "../sse-client.js";

interface PreparedProposalResponse {
  proposal: ArtifactInteractionProposalV1;
  preview: { uri: string; mediaType: string; label: string; digest: string };
}

const HUMAN_ACTOR = { id: "human:studio", kind: "human" as const, label: "Studio user" };

export function ArtifactInteractionPane(props: {
  artifact: ArtifactDescriptor;
  agentRunsEnabled: boolean;
  agentLabel?: string;
  surfaceSelectedAddress?: string;
  surfaceIntentOutcome?: ArtifactHostedIntentOutcomeV1;
  surfaceIntentFailure?: string;
  onSelectedAddressChange: (address: string) => void;
  onApplied: () => void;
}): React.JSX.Element | null {
  const { t } = useTranslation("artifacts");
  const tRef = useRef(t);
  tRef.current = t;
  const workspaceUri = props.artifact.interaction?.workspaceUri;
  const [workspace, setWorkspace] = useState<ArtifactInteractionWorkspaceV1>();
  const [selectedAddress, setSelectedAddress] = useState("");
  const [message, setMessage] = useState("");
  const [prepared, setPrepared] = useState<PreparedProposalResponse>();
  const [agentPlan, setAgentPlan] = useState<ArtifactAgentPlanV1>();
  const [agentEvidence, setAgentEvidence] = useState<ArtifactAgentRunEvidenceV1>();
  const [agentPhase, setAgentPhase] = useState<{ phase: ArtifactAgentRunPhaseV1; summary: string }>();
  const [receipt, setReceipt] = useState<ArtifactInteractionTransitionReceiptV1>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState<"loading" | "preparing" | "running" | "interrupting" | "deciding">();
  const artifactIdentity = useRef(intentArtifactIdentity(props.artifact));
  const activeRun = useRef<{ runId: string; controller: AbortController } | undefined>(undefined);
  const appliedSteeringDraft = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (workspaceUri === undefined) return;
    const nextIdentity = intentArtifactIdentity(props.artifact);
    const changedArtifact = artifactIdentity.current !== nextIdentity;
    artifactIdentity.current = nextIdentity;
    const controller = new AbortController();
    setWorkspace(undefined);
    if (changedArtifact) {
      activeRun.current?.controller.abort();
      activeRun.current = undefined;
      setPrepared(undefined);
      setAgentPlan(undefined);
      setAgentEvidence(undefined);
      setAgentPhase(undefined);
      setReceipt(undefined);
      setMessage("");
      appliedSteeringDraft.current = undefined;
    }
    setFailure(undefined);
    setBusy("loading");
    void fetch(workspaceUri, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, tRef.current("collaboration.errors.inspect")));
        const payload = await response.json() as { workspace?: unknown };
        const nextWorkspace = payload.workspace;
        if (!isWorkspace(nextWorkspace, props.artifact)) throw new Error(tRef.current("collaboration.errors.workspaceContract"));
        setWorkspace(nextWorkspace);
        setSelectedAddress((current) => {
          return nextWorkspace.targets.some((target) => target.address === current)
            ? current
            : nextWorkspace.targets[0]?.address ?? "";
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(undefined); });
    return () => controller.abort();
  }, [props.artifact, workspaceUri]);

  useEffect(() => {
    if (workspace === undefined || props.surfaceSelectedAddress === undefined || prepared !== undefined || receipt !== undefined) return;
    if (workspace.targets.some((target) => target.address === props.surfaceSelectedAddress)) {
      setSelectedAddress(props.surfaceSelectedAddress);
    }
  }, [prepared, props.surfaceSelectedAddress, receipt, workspace]);

  useEffect(() => {
    const outcome = props.surfaceIntentOutcome;
    if (workspace === undefined || outcome?.effect.kind !== "steering" || prepared !== undefined || receipt !== undefined
      || busy !== undefined || appliedSteeringDraft.current === outcome.effect.steeringId
      || !workspace.targets.some((target) => target.address === outcome.effect.target.address)
      || outcome.effect.steering.kind !== workspace.steering.kind) return;
    appliedSteeringDraft.current = outcome.effect.steeringId;
    if (outcome.effect.steering.message.length > workspace.steering.maxLength) {
      setFailure("The recorded steering draft exceeds this interaction workspace's input limit and was not prefilled.");
      return;
    }
    setSelectedAddress(outcome.effect.target.address);
    setMessage(outcome.effect.steering.message);
    setFailure(undefined);
  }, [busy, prepared, props.surfaceIntentOutcome, receipt, workspace]);

  if (workspaceUri === undefined) return null;

  const prepareProviderChange = async (): Promise<void> => {
    if (workspace === undefined || selectedAddress === "" || message.trim() === "") return;
    setBusy("preparing");
    setFailure(undefined);
    setPrepared(undefined);
    setAgentPlan(undefined);
    setAgentEvidence(undefined);
    setAgentPhase(undefined);
    setReceipt(undefined);
    try {
      const response = await fetch(`${workspaceUri}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAddress: selectedAddress,
          steering: { kind: workspace.steering.kind, message: message.trim() },
          requestedBy: HUMAN_ACTOR,
          requestId: `request:${crypto.randomUUID()}`,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, t("collaboration.errors.prepare")));
      const payload: unknown = await response.json();
      if (!isPreparedResponse(payload, props.artifact)) throw new Error(t("collaboration.errors.proposalContract"));
      setPrepared(payload);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  };

  const runAgent = async (): Promise<void> => {
    if (workspace === undefined || selectedAddress === "" || message.trim() === "") return;
    const runId = `artifact-run:${crypto.randomUUID()}`;
    const controller = new AbortController();
    activeRun.current = { runId, controller };
    setBusy("running");
    setFailure(undefined);
    setPrepared(undefined);
    setAgentPlan(undefined);
    setAgentEvidence(undefined);
    setAgentPhase({ phase: "observing", summary: t("collaboration.bindingState") });
    setReceipt(undefined);
    let receivedProposal = false;
    let terminalError: string | undefined;
    try {
      const response = await fetch(`${workspaceUri}/agent-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ targetAddress: selectedAddress, message: message.trim(), requestedBy: HUMAN_ACTOR, runId }),
      });
      if (!response.ok || response.body === null) {
        throw new Error(await responseError(response, t("collaboration.errors.startAgent")));
      }
      const parser = createSseParser<AguiEvent>((event) => {
        if (event.type === "CUSTOM" && event.name === "artifact.agent.phase" && isAgentPhase(event.value)) {
          setAgentPhase(event.value);
        } else if (event.type === "CUSTOM" && event.name === "artifact.agent.plan" && isAgentPlan(event.value, workspace)) {
          setAgentPlan(event.value);
        } else if (event.type === "CUSTOM" && event.name === "artifact.agent.evidence" && isAgentEvidence(event.value, props.artifact, runId, selectedAddress)) {
          setAgentEvidence(event.value);
        } else if (event.type === "CUSTOM" && event.name === "artifact.agent.proposal") {
          if (!isPreparedResponse(event.value, props.artifact)) throw new Error(t("collaboration.errors.agentProposalContract"));
          receivedProposal = true;
          setPrepared(event.value);
        } else if (event.type === "RUN_ERROR") {
          terminalError = event.message;
        }
      });
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        parser.push(decoder.decode(chunk.value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.end();
      if (terminalError !== undefined) throw new Error(terminalError);
      if (!receivedProposal) throw new Error(t("collaboration.errors.noProposal"));
    } catch (error) {
      if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      if (activeRun.current?.runId === runId) activeRun.current = undefined;
      if (!controller.signal.aborted) setBusy(undefined);
    }
  };

  const interruptAgent = async (): Promise<void> => {
    const run = activeRun.current;
    if (run === undefined) return;
    setBusy("interrupting");
    try {
      const response = await fetch(`${workspaceUri}/agent-runs/${encodeURIComponent(run.runId)}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error(await responseError(response, t("collaboration.errors.interrupt")));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setBusy("running");
    }
  };

  const decide = async (decision: "approve" | "reject"): Promise<void> => {
    if (prepared === undefined) return;
    setBusy("deciding");
    setFailure(undefined);
    try {
      const decisionId = `decision:${crypto.randomUUID()}`;
      const response = await fetch(`${workspaceUri}/proposals/${encodeURIComponent(prepared.proposal.proposalId)}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalDigest: prepared.proposal.proposalDigest,
          expectedRevision: prepared.proposal.expectedRevision,
          decision,
          decisionId,
          decidedBy: HUMAN_ACTOR,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, t("collaboration.errors.settle")));
      const payload = await response.json() as { receipt?: unknown };
      if (!isReceipt(payload.receipt, prepared.proposal, decisionId, decision)) throw new Error(t("collaboration.errors.receiptContract"));
      setReceipt(payload.receipt);
      if (payload.receipt.status === "applied") props.onApplied();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  };

  const selected = workspace?.targets.find((target) => target.address === selectedAddress);
  return <aside className="artifact-collaboration-pane" aria-label={t("collaboration.aria")}>
    <header><div><small>{props.agentRunsEnabled ? t("collaboration.humanAgent") : t("collaboration.humanProvider")}</small><h2>{t("collaboration.title")}</h2></div><span>{workspace === undefined ? t("collaboration.observing") : shortDigest(workspace.revision)}</span></header>
    <div className="artifact-collaboration-scroll">
      {busy === "loading" && <p className="artifact-collaboration-status" role="status">{t("collaboration.observingState")}</p>}
      {workspace !== undefined && <>
        {props.surfaceIntentOutcome?.effect.kind === "steering" && <p className="artifact-intent-draft-status" role="status"><strong>Steering draft</strong><span>Recorded, not executed</span></p>}
        {props.surfaceIntentFailure !== undefined && <p className="artifact-collaboration-error" role="alert">{props.surfaceIntentFailure}</p>}
        <section className="artifact-collaboration-section" aria-labelledby="artifact-selection-heading">
          <header><span>1</span><div><h3 id="artifact-selection-heading">{t("collaboration.selection.title")}</h3><p>{workspace.summary}</p></div></header>
          <label>{t("collaboration.selection.target")}<select value={selectedAddress} disabled={busy !== undefined || prepared !== undefined || receipt !== undefined} onChange={(event) => { setSelectedAddress(event.currentTarget.value); props.onSelectedAddressChange(event.currentTarget.value); setPrepared(undefined); setAgentPlan(undefined); setAgentEvidence(undefined); setAgentPhase(undefined); setReceipt(undefined); setFailure(undefined); }}>
            {workspace.targets.map((target) => <option key={target.address} value={target.address}>{target.label} · {target.kind}</option>)}
          </select></label>
          {selected !== undefined && <code title={selected.address}>{selected.address}</code>}
        </section>

        <section className="artifact-collaboration-section" aria-labelledby="artifact-steering-heading">
          <header><span>2</span><div><h3 id="artifact-steering-heading">{t("collaboration.steering.title")}</h3><p>{props.agentRunsEnabled ? t("collaboration.steering.agentDetail") : t("collaboration.steering.providerDetail")}</p></div></header>
          <label>{props.agentRunsEnabled ? t("collaboration.steering.prompt") : workspace.steering.label}<textarea value={message} maxLength={workspace.steering.maxLength} placeholder={props.agentRunsEnabled ? t("collaboration.steering.placeholder") : workspace.steering.placeholder} disabled={busy !== undefined || prepared !== undefined || receipt !== undefined} onChange={(event) => setMessage(event.currentTarget.value)} /></label>
          {prepared === undefined && receipt === undefined && busy !== "running" && busy !== "interrupting" && <button className="primary artifact-collaboration-primary" type="button" disabled={busy !== undefined || selectedAddress === "" || message.trim() === ""} onClick={() => { void (props.agentRunsEnabled ? runAgent() : prepareProviderChange()); }}>{busy === "preparing" ? t("collaboration.preparing") : props.agentRunsEnabled ? t("collaboration.runAgent", { agent: props.agentLabel ?? t("collaboration.agent") }) : t("collaboration.prepareProvider")}</button>}
        </section>

        {props.agentRunsEnabled && agentPhase !== undefined && <section className="artifact-collaboration-section artifact-agent-run" aria-labelledby="artifact-agent-run-heading" aria-live="polite">
          <header><span>3</span><div><h3 id="artifact-agent-run-heading">{t("collaboration.agentRun.title")}</h3><p>{agentPhase.summary}</p></div></header>
          <div className="artifact-agent-phase"><span className={`status-dot status-${busy === "running" || busy === "interrupting" ? "running" : prepared === undefined ? "error" : "finished"}`} aria-hidden="true" /><strong>{agentPhase.phase}</strong><span>{props.agentLabel ?? t("collaboration.agentRun.acpAgent")}</span></div>
          {agentPlan !== undefined && <><p className="artifact-agent-summary">{agentPlan.summary}</p><ol className="artifact-agent-plan">{agentPlan.plan.map((item, index) => <li key={`${index}:${item}`}><span>{index + 1}</span><p>{item}</p></li>)}</ol></>}
          {agentEvidence !== undefined && <dl><div><dt>{t("collaboration.agentRun.executor")}</dt><dd>{agentEvidence.executor}</dd></div><div><dt>{t("collaboration.agentRun.session")}</dt><dd><code>{agentEvidence.sessionId ?? t("collaboration.notObserved")}</code></dd></div><div><dt>{t("collaboration.agentRun.model")}</dt><dd>{agentEvidence.model ?? t("collaboration.notObserved")}</dd></div><div><dt>{t("collaboration.agentRun.permissions")}</dt><dd>{t("collaboration.agentRun.cancelled", { count: agentEvidence.permissionRequestsCancelled })}</dd></div></dl>}
          {(busy === "running" || busy === "interrupting") && <button type="button" className="artifact-interrupt" disabled={busy === "interrupting"} onClick={() => { void interruptAgent(); }}>{busy === "interrupting" ? t("collaboration.agentRun.interrupting") : t("collaboration.agentRun.interrupt")}</button>}
        </section>}

        {prepared !== undefined && <section className="artifact-collaboration-section artifact-proposal" aria-labelledby="artifact-proposal-heading">
          <header><span>{props.agentRunsEnabled ? 4 : 3}</span><div><h3 id="artifact-proposal-heading">{agentPlan === undefined ? t("collaboration.proposal.provider") : t("collaboration.proposal.agent")}</h3><p>{prepared.proposal.summary}</p></div></header>
          <img src={prepared.preview.uri} alt={t("collaboration.proposal.previewAlt", { label: prepared.preview.label })} />
          <dl><div><dt>{t("collaboration.proposal.expected")}</dt><dd><code>{shortDigest(prepared.proposal.expectedRevision)}</code></dd></div><div><dt>{t("collaboration.proposal.proposal")}</dt><dd><code>{shortDigest(prepared.proposal.proposalDigest)}</code></dd></div></dl>
          <ol>{prepared.proposal.actions.map((action, index) => <li key={`${action.kind}-${index}`}><strong>{action.kind}</strong><span>{action.summary}</span></li>)}</ol>
          {receipt === undefined && <div className="artifact-decision-actions"><button className="primary" type="button" disabled={busy !== undefined} onClick={() => { void decide("approve"); }}>{busy === "deciding" ? t("collaboration.proposal.settling") : t("collaboration.proposal.approve")}</button><button type="button" disabled={busy !== undefined} onClick={() => { void decide("reject"); }}>{t("collaboration.proposal.reject")}</button></div>}
        </section>}

        {receipt !== undefined && <section className={`artifact-collaboration-section artifact-receipt status-${receipt.status}`} aria-labelledby="artifact-receipt-heading">
          <header><span>{props.agentRunsEnabled ? 5 : 4}</span><div><h3 id="artifact-receipt-heading">{t("collaboration.receipt.title")}</h3><p>{receipt.verification.summary}</p></div></header>
          <dl><div><dt>{t("collaboration.receipt.status")}</dt><dd>{receipt.status}</dd></div><div><dt>{t("collaboration.receipt.revision")}</dt><dd><code>{shortDigest(receipt.beforeRevision)} → {shortDigest(receipt.afterRevision)}</code></dd></div></dl>
          {receipt.evidence.length > 0 && <ul>{receipt.evidence.map((entry, index) => <li key={`${entry.kind}-${index}`}>{entry.label}</li>)}</ul>}
          <button type="button" onClick={() => { setPrepared(undefined); setAgentPlan(undefined); setAgentEvidence(undefined); setAgentPhase(undefined); setReceipt(undefined); setMessage(""); setFailure(undefined); }}>{t("collaboration.receipt.another")}</button>
        </section>}
      </>}
      {failure !== undefined && <p className="artifact-collaboration-error" role="alert">{failure}</p>}
    </div>
  </aside>;
}

function isWorkspace(value: unknown, artifact: ArtifactDescriptor): value is ArtifactInteractionWorkspaceV1 {
  if (!isRecord(value) || value.kind !== "HarnessStudioArtifactInteractionWorkspaceV1" || value.protocolVersion !== "1"
    || value.artifactId !== artifact.id || value.revision !== artifact.revision.id || !Array.isArray(value.targets)
    || !isRecord(value.steering)) return false;
  return typeof value.summary === "string" && typeof value.steering.kind === "string"
    && typeof value.steering.label === "string" && typeof value.steering.placeholder === "string"
    && typeof value.steering.maxLength === "number" && value.targets.every((target) => isRecord(target)
      && typeof target.address === "string" && typeof target.kind === "string" && typeof target.label === "string");
}

function isPreparedResponse(value: unknown, artifact: ArtifactDescriptor): value is PreparedProposalResponse {
  if (!isRecord(value) || !isRecord(value.proposal) || !isRecord(value.preview)) return false;
  return value.proposal.kind === "HarnessStudioArtifactInteractionProposalV1"
    && value.proposal.artifactId === artifact.id && value.proposal.expectedRevision === artifact.revision.id
    && typeof value.proposal.proposalId === "string" && typeof value.proposal.proposalDigest === "string"
    && typeof value.proposal.summary === "string" && Array.isArray(value.proposal.actions)
    && typeof value.preview.uri === "string" && value.preview.uri.startsWith("/api/artifacts/")
    && typeof value.preview.mediaType === "string" && typeof value.preview.label === "string" && typeof value.preview.digest === "string";
}

function isAgentPhase(value: unknown): value is { phase: ArtifactAgentRunPhaseV1; summary: string } {
  return isRecord(value) && ["observing", "planning", "validating", "proposal"].includes(String(value.phase))
    && typeof value.summary === "string";
}

function isAgentPlan(value: unknown, workspace: ArtifactInteractionWorkspaceV1): value is ArtifactAgentPlanV1 {
  return isRecord(value) && value.kind === ARTIFACT_AGENT_PLAN_KIND && typeof value.summary === "string"
    && Array.isArray(value.plan) && value.plan.length > 0 && value.plan.every((entry) => typeof entry === "string")
    && isRecord(value.providerSteering) && value.providerSteering.kind === workspace.steering.kind
    && typeof value.providerSteering.message === "string";
}

function isAgentEvidence(
  value: unknown,
  artifact: ArtifactDescriptor,
  runId: string,
  targetAddress: string,
): value is ArtifactAgentRunEvidenceV1 {
  return isRecord(value) && value.kind === ARTIFACT_AGENT_EVIDENCE_KIND && value.runId === runId
    && value.artifactId === artifact.id && value.revision === artifact.revision.id
    && value.targetAddress === targetAddress && value.executor === "acp"
    && isRecord(value.agent) && typeof value.agent.id === "string" && typeof value.agent.label === "string"
    && typeof value.harnessRevisionId === "string" && typeof value.permissionRequestsCancelled === "number";
}

function isReceipt(value: unknown, proposal: ArtifactInteractionProposalV1, decisionId: string, decision: "approve" | "reject"): value is ArtifactInteractionTransitionReceiptV1 {
  return isRecord(value) && value.kind === "HarnessStudioArtifactInteractionTransitionReceiptV1"
    && value.proposalId === proposal.proposalId && value.proposalDigest === proposal.proposalDigest
    && value.decisionId === decisionId && value.decision === decision
    && typeof value.status === "string" && typeof value.beforeRevision === "string" && typeof value.afterRevision === "string"
    && isRecord(value.verification) && typeof value.verification.summary === "string"
    && Array.isArray(value.affectedTargets) && Array.isArray(value.evidence) && Array.isArray(value.diagnostics);
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown };
    return typeof payload.error === "string" && payload.error !== "" ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

function shortDigest(value: string): string {
  return value.startsWith("sha256:") ? `${value.slice(7, 15)}…${value.slice(-6)}` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function intentArtifactIdentity(artifact: ArtifactDescriptor): string {
  return [artifact.id, artifact.revision.id, artifact.renderer.bindingId ?? "unbound"].join(":");
}
