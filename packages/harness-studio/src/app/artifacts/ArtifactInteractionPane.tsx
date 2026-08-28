import { useEffect, useRef, useState } from "react";
import type {
  ArtifactDescriptor,
  ArtifactInteractionProposalV1,
  ArtifactInteractionTransitionReceiptV1,
  ArtifactInteractionWorkspaceV1,
} from "../../contracts/artifact.js";

interface PreparedProposalResponse {
  proposal: ArtifactInteractionProposalV1;
  preview: { uri: string; mediaType: string; label: string; digest: string };
}

const HUMAN_ACTOR = { id: "human:studio", kind: "human" as const, label: "Studio user" };

export function ArtifactInteractionPane(props: {
  artifact: ArtifactDescriptor;
  onApplied: () => void;
}): React.JSX.Element | null {
  const workspaceUri = props.artifact.interaction?.workspaceUri;
  const [workspace, setWorkspace] = useState<ArtifactInteractionWorkspaceV1>();
  const [selectedAddress, setSelectedAddress] = useState("");
  const [message, setMessage] = useState("");
  const [prepared, setPrepared] = useState<PreparedProposalResponse>();
  const [receipt, setReceipt] = useState<ArtifactInteractionTransitionReceiptV1>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState<"loading" | "preparing" | "deciding">();
  const artifactId = useRef(props.artifact.id);

  useEffect(() => {
    if (workspaceUri === undefined) return;
    const changedArtifact = artifactId.current !== props.artifact.id;
    artifactId.current = props.artifact.id;
    const controller = new AbortController();
    setWorkspace(undefined);
    if (changedArtifact) {
      setPrepared(undefined);
      setReceipt(undefined);
      setMessage("");
    }
    setFailure(undefined);
    setBusy("loading");
    void fetch(workspaceUri, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Cannot inspect this Artifact interaction."));
        const payload = await response.json() as { workspace?: unknown };
        if (!isWorkspace(payload.workspace, props.artifact)) throw new Error("Artifact interaction workspace contract is unsupported.");
        setWorkspace(payload.workspace);
        setSelectedAddress(payload.workspace.targets[0]?.address ?? "");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(undefined); });
    return () => controller.abort();
  }, [props.artifact, workspaceUri]);

  if (workspaceUri === undefined) return null;

  const prepare = async (): Promise<void> => {
    if (workspace === undefined || selectedAddress === "" || message.trim() === "") return;
    setBusy("preparing");
    setFailure(undefined);
    setPrepared(undefined);
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
      if (!response.ok) throw new Error(await responseError(response, "The Provider could not prepare this change."));
      const payload: unknown = await response.json();
      if (!isPreparedResponse(payload, props.artifact)) throw new Error("Artifact proposal contract is unsupported.");
      setPrepared(payload);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
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
      if (!response.ok) throw new Error(await responseError(response, "The Host could not settle this proposal."));
      const payload = await response.json() as { receipt?: unknown };
      if (!isReceipt(payload.receipt, prepared.proposal, decisionId, decision)) throw new Error("Artifact transition receipt contract is unsupported.");
      setReceipt(payload.receipt);
      if (payload.receipt.status === "applied") props.onApplied();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  };

  const selected = workspace?.targets.find((target) => target.address === selectedAddress);
  return <aside className="artifact-collaboration-pane" aria-label="Artifact collaboration">
    <header><div><small>Human + Agent</small><h2>Collaboration</h2></div><span>{workspace === undefined ? "observing" : shortDigest(workspace.revision)}</span></header>
    <div className="artifact-collaboration-scroll">
      {busy === "loading" && <p className="artifact-collaboration-status" role="status">Observing shared Artifact state…</p>}
      {workspace !== undefined && <>
        <section className="artifact-collaboration-section" aria-labelledby="artifact-selection-heading">
          <header><span>1</span><div><h3 id="artifact-selection-heading">Shared selection</h3><p>{workspace.summary}</p></div></header>
          <label>Semantic target<select value={selectedAddress} disabled={busy !== undefined || prepared !== undefined || receipt !== undefined} onChange={(event) => { setSelectedAddress(event.currentTarget.value); setPrepared(undefined); setReceipt(undefined); setFailure(undefined); }}>
            {workspace.targets.map((target) => <option key={target.address} value={target.address}>{target.label} · {target.kind}</option>)}
          </select></label>
          {selected !== undefined && <code title={selected.address}>{selected.address}</code>}
        </section>

        <section className="artifact-collaboration-section" aria-labelledby="artifact-steering-heading">
          <header><span>2</span><div><h3 id="artifact-steering-heading">Human steering</h3><p>Constrain the next change before the Agent prepares it.</p></div></header>
          <label>{workspace.steering.label}<textarea value={message} maxLength={workspace.steering.maxLength} placeholder={workspace.steering.placeholder} disabled={busy !== undefined || prepared !== undefined || receipt !== undefined} onChange={(event) => setMessage(event.currentTarget.value)} /></label>
          {prepared === undefined && receipt === undefined && <button className="primary artifact-collaboration-primary" type="button" disabled={busy !== undefined || selectedAddress === "" || message.trim() === ""} onClick={() => { void prepare(); }}>{busy === "preparing" ? "Preparing…" : "Prepare change"}</button>}
        </section>

        {prepared !== undefined && <section className="artifact-collaboration-section artifact-proposal" aria-labelledby="artifact-proposal-heading">
          <header><span>3</span><div><h3 id="artifact-proposal-heading">Agent proposal</h3><p>{prepared.proposal.summary}</p></div></header>
          <img src={prepared.preview.uri} alt={`${prepared.preview.label}, proposed and not yet applied`} />
          <dl><div><dt>Expected</dt><dd><code>{shortDigest(prepared.proposal.expectedRevision)}</code></dd></div><div><dt>Proposal</dt><dd><code>{shortDigest(prepared.proposal.proposalDigest)}</code></dd></div></dl>
          <ol>{prepared.proposal.actions.map((action, index) => <li key={`${action.kind}-${index}`}><strong>{action.kind}</strong><span>{action.summary}</span></li>)}</ol>
          {receipt === undefined && <div className="artifact-decision-actions"><button className="primary" type="button" disabled={busy !== undefined} onClick={() => { void decide("approve"); }}>{busy === "deciding" ? "Settling…" : "Approve once"}</button><button type="button" disabled={busy !== undefined} onClick={() => { void decide("reject"); }}>Reject</button></div>}
        </section>}

        {receipt !== undefined && <section className={`artifact-collaboration-section artifact-receipt status-${receipt.status}`} aria-labelledby="artifact-receipt-heading">
          <header><span>4</span><div><h3 id="artifact-receipt-heading">Transition receipt</h3><p>{receipt.verification.summary}</p></div></header>
          <dl><div><dt>Status</dt><dd>{receipt.status}</dd></div><div><dt>Revision</dt><dd><code>{shortDigest(receipt.beforeRevision)} → {shortDigest(receipt.afterRevision)}</code></dd></div></dl>
          {receipt.evidence.length > 0 && <ul>{receipt.evidence.map((entry, index) => <li key={`${entry.kind}-${index}`}>{entry.label}</li>)}</ul>}
          <button type="button" onClick={() => { setPrepared(undefined); setReceipt(undefined); setMessage(""); setFailure(undefined); }}>Prepare another change</button>
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
