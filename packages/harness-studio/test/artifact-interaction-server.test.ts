import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactAgentStreamEventV1 } from "../src/contracts/artifact-agent-run.js";
import { decodeSseStream } from "./sse-test-utils.js";
import {
  canonicalArtifactInteractionJson,
  isArtifactCatalogResponse,
  type ArtifactDigest,
  type ArtifactInteractionRuntimeImplementation,
  type ExternalArtifactProvider,
} from "../src/contracts/artifact.js";
import { activateArtifactContribution } from "../src/server/artifacts/registry/artifact-provider-activation.js";
import { envelopeSnapshot } from "../src/server/artifacts/registry/artifact-plugin-registry.js";
import { startHarnessStudioServer, type HarnessStudioServerHandle } from "../src/server/server.js";
import { DEFAULT_LOCAL_ACP_HARNESS_SOURCE } from "../src/server/default-local-harness.js";

const temporary: string[] = [];
let server: HarnessStudioServerHandle | undefined;
const ACP_AGENT_FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../harness/test/fixtures/acp-agent.mjs");

afterEach(async () => {
  await server?.close();
  server = undefined;
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Agentic Artifact interaction routes", () => {
  it("keeps prepare read-only and settles reject, approve, replay, conflict, and stale through the Host gate", async () => {
    const root = await temp("artifact-interaction-");
    const appDir = join(root, "app");
    const artifactDirectory = join(root, "artifacts");
    const stateRoot = join(root, "state");
    const sourcePath = join(artifactDirectory, "diagram.fixture");
    await Promise.all([mkdir(appDir), mkdir(artifactDirectory)]);
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>fixture</title>", "utf8");
    await writeFile(sourcePath, "Original", "utf8");
    const fixture = interactionProvider();
    await activateArtifactContribution(fixture.provider, "fixture", "external-fallback", { extensions: ["fixture"] }, { root: stateRoot });
    server = await startHarnessStudioServer({
      appDir,
      artifactDirectory,
      artifactProviderStateRoot: stateRoot,
      artifactProviders: [fixture.provider],
      walnutCacheRoot: join(root, "walnut-cache"),
    });

    const first = await catalogArtifact(server.url);
    expect(first.interaction?.workspaceUri).toMatch(/\/interaction$/u);
    const workspace = await (await fetch(`${server.url}${first.interaction!.workspaceUri}`)).json() as {
      workspace: { revision: string; targets: Array<{ address: string }> };
    };
    expect(workspace.workspace).toMatchObject({ revision: first.revision.id, targets: [{ address: "fixture://root" }] });

    const rejected = await prepare(server.url, first, "Rejected");
    expect(await readFile(sourcePath, "utf8")).toBe("Original");
    expect((await fetch(`${server.url}${rejected.preview.uri}`)).headers.get("content-security-policy")).toContain("sandbox");
    const rejectedDecision = decisionBody(rejected.proposal, "reject", "decision:reject");
    const rejectedResult = await (await fetch(decisionUri(server.url, first, rejected.proposal.proposalId), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rejectedDecision),
    })).json() as { receipt: { status: string; beforeRevision: string; afterRevision: string } };
    expect(rejectedResult.receipt).toMatchObject({ status: "rejected", beforeRevision: first.revision.id, afterRevision: first.revision.id });
    expect(await readFile(sourcePath, "utf8")).toBe("Original");

    const approved = await prepare(server.url, first, "Approved");
    expect(await readFile(sourcePath, "utf8")).toBe("Original");
    const approvedDecision = decisionBody(approved.proposal, "approve", "decision:approve");
    const approvedUri = decisionUri(server.url, first, approved.proposal.proposalId);
    const approvedResponses = await Promise.all([0, 1].map(async () => await fetch(approvedUri, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(approvedDecision),
    })));
    expect(approvedResponses.map((response) => response.status)).toEqual([200, 200]);
    const approvedResults = await Promise.all(approvedResponses.map(async (response) => await response.json() as {
      receipt: { status: string; afterRevision: string; evidence: unknown[] };
      replayed: boolean;
    }));
    expect(approvedResults.map((result) => result.replayed).sort()).toEqual([false, true]);
    const approvedResult = approvedResults[0]!;
    expect(approvedResult).toMatchObject({ receipt: { status: "applied", evidence: [expect.anything()] } });
    expect(approvedResult.receipt.afterRevision).not.toBe(first.revision.id);
    expect(await readFile(sourcePath, "utf8")).toBe("Approved");
    expect(fixture.decisions()).toBe(2);

    const replay = await (await fetch(approvedUri, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(approvedDecision),
    })).json() as { replayed: boolean };
    expect(replay.replayed).toBe(true);
    expect(fixture.decisions()).toBe(2);
    const conflict = await fetch(approvedUri, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...approvedDecision, decisionId: "decision:conflict", decision: "reject" }),
    });
    expect(conflict.status).toBe(409);

    const second = await catalogArtifact(server.url);
    const stale = await prepare(server.url, second, "Should not win");
    await writeFile(sourcePath, "External", "utf8");
    const staleResult = await (await fetch(decisionUri(server.url, second, stale.proposal.proposalId), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decisionBody(stale.proposal, "approve", "decision:stale")),
    })).json() as { receipt: { status: string } };
    expect(staleResult.receipt.status).toBe("stale");
    expect(await readFile(sourcePath, "utf8")).toBe("External");

    const crossOrigin = await fetch(`${server.url}${second.interaction!.workspaceUri}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://untrusted.invalid" },
      body: "{}",
    });
    expect(crossOrigin.status).toBe(403);
  });

  it("runs a real ACP planning turn before retaining the Provider proposal", async () => {
    const fixture = await startInteractionFixture({ agentArgs: [ACP_AGENT_FIXTURE, "--artifact-plan"] });
    server = fixture.server;
    const artifact = await catalogArtifact(server.url);

    const response = await fetch(agentRunUri(server.url, artifact), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetAddress: "fixture://root",
        message: "Give the selected target a clearer name.",
        requestedBy: { id: "human:test", kind: "human", label: "Test user" },
        runId: "artifact-run:success",
      }),
    });
    expect(response.status).toBe(200);
    const events = decodeSseStream<ArtifactAgentStreamEventV1>(await response.text());
    expect(events[0]).toMatchObject({ type: "run-started", runId: "artifact-run:success" });
    expect(events.find((event) => event.type === "plan")).toMatchObject({
      type: "plan",
      plan: {
        kind: "HarnessStudioArtifactAgentPlanV1",
        providerSteering: { kind: "rename", message: "Rename to Agent planned" },
      },
    });
    expect(events.find((event) => event.type === "evidence")).toMatchObject({
      type: "evidence",
      evidence: {
        kind: "HarnessStudioArtifactAgentRunEvidenceV1",
        executor: "acp",
        sessionId: "fixture-session",
        permissionRequestsCancelled: 1,
      },
    });
    const proposalEvent = events.find((event) => event.type === "proposal");
    expect(proposalEvent).toMatchObject({
      type: "proposal",
      proposal: { proposal: { proposedBy: { kind: "agent" }, steering: { message: "Rename to Agent planned" } } },
    });
    expect(events.at(-1)).toMatchObject({ type: "run-finished" });
    expect(await readFile(fixture.sourcePath, "utf8")).toBe("Original");
  });

  it("fails closed for unavailable, malformed, and interrupted Agent planning", async () => {
    const unavailable = await startInteractionFixture();
    server = unavailable.server;
    const artifact = await catalogArtifact(server.url);
    const unavailableResponse = await fetch(agentRunUri(server.url, artifact), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agentRunBody("artifact-run:unavailable")),
    });
    expect(unavailableResponse.status).toBe(404);
    await server.close();
    server = undefined;

    const malformed = await startInteractionFixture({ agentArgs: [ACP_AGENT_FIXTURE, "--malformed-artifact-plan"] });
    server = malformed.server;
    const malformedArtifact = await catalogArtifact(server.url);
    const malformedEvents = decodeSseStream(await (await fetch(agentRunUri(server.url, malformedArtifact), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agentRunBody("artifact-run:malformed")),
    })).text());
    expect(malformedEvents.at(-1)).toMatchObject({ type: "run-error", message: expect.stringContaining("strict Artifact plan JSON") });
    expect(malformedEvents.some((event) => event.type === "proposal")).toBe(false);
    expect(await readFile(malformed.sourcePath, "utf8")).toBe("Original");
    await server.close();
    server = undefined;

    const internalError = await startInteractionFixture({ agentArgs: [ACP_AGENT_FIXTURE, "--artifact-internal-error"] });
    server = internalError.server;
    const internalErrorArtifact = await catalogArtifact(server.url);
    const internalErrorEvents = decodeSseStream(await (await fetch(agentRunUri(server.url, internalErrorArtifact), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agentRunBody("artifact-run:internal-error")),
    })).text());
    expect(internalErrorEvents.at(-1)).toMatchObject({
      type: "run-error",
      message: "The configured ACP Agent failed before producing a valid Artifact plan.",
    });
    expect(JSON.stringify(internalErrorEvents)).not.toContain("fixture-secret-context");
    expect(JSON.stringify(internalErrorEvents)).not.toContain("fixture-internal-error");
    expect(internalErrorEvents.some((event) => event.type === "proposal")).toBe(false);
    expect(await readFile(internalError.sourcePath, "utf8")).toBe("Original");
    await server.close();
    server = undefined;

    const waiting = await startInteractionFixture({ agentArgs: [ACP_AGENT_FIXTURE, "--artifact-plan", "--wait-for-cancel"] });
    server = waiting.server;
    const waitingArtifact = await catalogArtifact(server.url);
    const running = await fetch(agentRunUri(server.url, waitingArtifact), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agentRunBody("artifact-run:cancel")),
    });
    expect(running.status).toBe(200);
    const cancelled = await fetch(`${agentRunUri(server.url, waitingArtifact)}/${encodeURIComponent("artifact-run:cancel")}/cancel`, { method: "POST" });
    expect(cancelled.status).toBe(202);
    const cancelledEvents = decodeSseStream(await running.text());
    expect(cancelledEvents.at(-1)).toMatchObject({ type: "run-error", message: expect.stringContaining("interrupted") });
    expect(cancelledEvents.some((event) => event.type === "proposal")).toBe(false);
    expect(await readFile(waiting.sourcePath, "utf8")).toBe("Original");
  });

  it("bounds concurrent Agent runs and aborts a disconnected stream", async () => {
    const waiting = await startInteractionFixture({ agentArgs: [ACP_AGENT_FIXTURE, "--artifact-plan", "--wait-for-cancel"] });
    server = waiting.server;
    const artifact = await catalogArtifact(server.url);
    const runIds = [0, 1, 2, 3, 4].map((index) => `artifact-run:bounded-${String(index)}`);
    const running = await Promise.all(runIds.map(async (runId) => await fetch(agentRunUri(server!.url, artifact), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agentRunBody(runId)),
    })));
    expect(running.map((response) => response.status).sort()).toEqual([200, 200, 200, 200, 429]);
    const accepted = runIds.filter((_runId, index) => running[index]?.status === 200);
    const cancellations = await Promise.all(accepted.map(async (runId) => await fetch(`${agentRunUri(server!.url, artifact)}/${encodeURIComponent(runId)}/cancel`, { method: "POST" })));
    expect(cancellations.map((response) => response.status)).toEqual([202, 202, 202, 202]);
    await Promise.all(running.map(async (response) => response.text()));

    const disconnected = await fetch(agentRunUri(server.url, artifact), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agentRunBody("artifact-run:disconnect")),
    });
    expect(disconnected.status).toBe(200);
    const reader = disconnected.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await readFile(waiting.sourcePath, "utf8")).toBe("Original");
  });
});

function interactionProvider(): { provider: ExternalArtifactProvider; decisions: () => number } {
  let decisionCount = 0;
  const interaction: ArtifactInteractionRuntimeImplementation = {
    id: "fixture.interaction",
    version: "1",
    protocolVersion: "1",
    async inspect(context) {
      return {
        kind: "HarnessStudioArtifactInteractionWorkspaceV1",
        protocolVersion: "1",
        artifactId: context.descriptor.id,
        revision: context.descriptor.revision.id,
        summary: "One shared fixture target.",
        targets: [{ address: "fixture://root", kind: "fixture-node", label: "Root" }],
        steering: { kind: "rename", label: "Rename target", placeholder: "Rename to Approved", maxLength: 80 },
      };
    },
    async prepare(context, input) {
      const next = input.steering.message.replace(/^Rename to\s+/iu, "").trim();
      if (input.targetAddress !== "fixture://root" || input.steering.kind !== "rename" || next === "") throw new Error("Unsupported fixture steering.");
      const target = { address: "fixture://root", kind: "fixture-node", label: "Root" };
      const content = {
        kind: "HarnessStudioArtifactInteractionProposalV1" as const,
        proposalId: `proposal:${input.requestId.replace(/^request:/u, "")}`,
        artifactId: context.descriptor.id,
        expectedRevision: context.descriptor.revision.id,
        target,
        steering: input.steering,
        summary: `Rename Root to ${next}.`,
        actions: [{ kind: "set-label", summary: `Set the selected label to ${next}.`, target }],
        verificationClaims: ["Authoritative readback matches the proposed label."],
        proposedBy: { id: "agent:fixture", kind: "agent" as const, label: "Fixture Agent" },
        preparedAt: new Date().toISOString(),
      };
      const preview = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><text>${escapeXml(next)}</text></svg>`, "utf8");
      return {
        proposal: { ...content, proposalDigest: digestJson(content) },
        preview: { bytes: preview, mediaType: "image/svg+xml", label: `${next} preview`, digest: digestBytes(preview) },
        continuation: { next },
      };
    },
    async decide(context, input) {
      decisionCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const current = await readFile(context.entry.path, "utf8");
      const currentRevision = digestBytes(Buffer.from(current));
      const common = {
        kind: "HarnessStudioArtifactInteractionTransitionReceiptV1" as const,
        transitionId: `transition:${input.decisionId}`,
        proposalId: input.prepared.proposal.proposalId,
        proposalDigest: input.prepared.proposal.proposalDigest,
        decisionId: input.decisionId,
        decision: input.decision,
        beforeRevision: input.prepared.proposal.expectedRevision,
        affectedTargets: [input.prepared.proposal.target],
        settledAt: new Date().toISOString(),
      };
      if (currentRevision !== input.prepared.proposal.expectedRevision) {
        return { ...common, status: "stale", afterRevision: currentRevision, verification: { status: "not-run", summary: "Source changed before approval." }, evidence: [], diagnostics: [] };
      }
      if (input.decision === "reject") {
        return { ...common, status: "rejected", afterRevision: currentRevision, verification: { status: "not-run", summary: "Rejected without mutation." }, evidence: [], diagnostics: [] };
      }
      const next = (input.prepared.continuation as { next: string }).next;
      await writeFile(context.entry.path, next, "utf8");
      const readback = await readFile(context.entry.path);
      const afterRevision = digestBytes(readback);
      return {
        ...common,
        status: "applied",
        afterRevision,
        verification: { status: "passed", summary: "Authoritative readback matched." },
        evidence: [{ kind: "fixture-readback", label: "Fixture source readback", digest: afterRevision, revision: afterRevision }],
        diagnostics: [],
      };
    },
  };
  const receipt: ExternalArtifactProvider["receipt"] = {
    kind: "HarnessStudioExternalArtifactProviderReceiptV1",
    providerId: "fixture.interaction-provider",
    providerVersion: "1",
    providerDescriptorDigest: `sha256:${"e".repeat(64)}`,
    assets: [],
    driverVersions: { fixture: "1" },
  };
  const provider: ExternalArtifactProvider = {
    id: receipt.providerId,
    label: "Fixture interaction Provider",
    version: receipt.providerVersion,
    acquisition: "operator-provisioned",
    fingerprint: digestReceipt(receipt),
    receipt,
    contributions: [{
      id: "fixture",
      label: "Fixture interaction",
      matcher: { extensions: ["fixture"] },
      adapter: { id: "fixture.adapter", version: "1", schemaId: "fixture/v1", adapt: async (context) => await envelopeSnapshot(context, { kind: "fixture/v1" }) },
      renderer: { id: "fixture.renderer", label: "Fixture", provider: "fixture", type: "external-hosted", status: "ready" },
      surface: {
        kind: "external-hosted", rendererId: "fixture.renderer", runtimeId: "fixture.renderer.runtime", securityProfileId: "opaque-web-v1",
        runtime: { id: "fixture.renderer.runtime", version: "1", prepareDocument: async () => "<!doctype html><p>Fixture</p>", readModule: async () => "export {};", readResource: async () => undefined },
      },
      capabilities: ["navigate", "select"],
      interaction,
      support: "experimental-local",
      adapterExecutionProfile: "trusted-local-process",
    }],
  };
  return { provider, decisions: () => decisionCount };
}

async function startInteractionFixture(input: { agentArgs?: string[] } = {}): Promise<{
  server: HarnessStudioServerHandle;
  sourcePath: string;
}> {
  const root = await temp("artifact-agent-run-");
  const appDir = join(root, "app");
  const artifactDirectory = join(root, "artifacts");
  const stateRoot = join(root, "state");
  const sourcePath = join(artifactDirectory, "diagram.fixture");
  await Promise.all([mkdir(appDir), mkdir(artifactDirectory)]);
  await writeFile(join(appDir, "index.html"), "<!doctype html><title>fixture</title>", "utf8");
  await writeFile(sourcePath, "Original", "utf8");
  const fixture = interactionProvider();
  await activateArtifactContribution(fixture.provider, "fixture", "external-fallback", { extensions: ["fixture"] }, { root: stateRoot });
  const handle = await startHarnessStudioServer({
    appDir,
    artifactDirectory,
    artifactProviderStateRoot: stateRoot,
    artifactProviders: [fixture.provider],
    walnutCacheRoot: join(root, "walnut-cache"),
    ...(input.agentArgs === undefined ? {} : {
      acpAgent: {
        command: process.execPath,
        args: input.agentArgs,
        label: "Fixture Artifact Agent",
        harnessSource: DEFAULT_LOCAL_ACP_HARNESS_SOURCE,
      },
    }),
  });
  return { server: handle, sourcePath };
}

async function catalogArtifact(base: string) {
  const value: unknown = await (await fetch(`${base}/api/artifacts`)).json();
  if (!isArtifactCatalogResponse(value) || value.artifacts[0] === undefined) throw new Error("expected Artifact catalog");
  return value.artifacts[0];
}

async function prepare(base: string, artifact: Awaited<ReturnType<typeof catalogArtifact>>, label: string) {
  const response = await fetch(`${base}${artifact.interaction!.workspaceUri}/proposals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetAddress: "fixture://root",
      steering: { kind: "rename", message: `Rename to ${label}` },
      requestedBy: { id: "human:test", kind: "human", label: "Test user" },
      requestId: `request:${label.toLowerCase().replaceAll(" ", "-")}`,
    }),
  });
  expect(response.status).toBe(201);
  return await response.json() as { proposal: { proposalId: string; proposalDigest: string; expectedRevision: string }; preview: { uri: string } };
}

function decisionBody(proposal: { proposalDigest: string; expectedRevision: string }, decision: "approve" | "reject", decisionId: string) {
  return { proposalDigest: proposal.proposalDigest, expectedRevision: proposal.expectedRevision, decision, decisionId, decidedBy: { id: "human:test", kind: "human", label: "Test user" } };
}

function decisionUri(base: string, artifact: Awaited<ReturnType<typeof catalogArtifact>>, proposalId: string): string {
  return `${base}${artifact.interaction!.workspaceUri}/proposals/${encodeURIComponent(proposalId)}/decisions`;
}

function agentRunUri(base: string, artifact: Awaited<ReturnType<typeof catalogArtifact>>): string {
  return `${base}${artifact.interaction!.workspaceUri}/agent-runs`;
}

function agentRunBody(runId: string): unknown {
  return {
    targetAddress: "fixture://root",
    message: "Give the selected target a clearer name.",
    requestedBy: { id: "human:test", kind: "human", label: "Test user" },
    runId,
  };
}

function digestJson(value: unknown): ArtifactDigest {
  return `sha256:${createHash("sha256").update(canonicalArtifactInteractionJson(value)).digest("hex")}`;
}

function digestReceipt(value: unknown): ArtifactDigest {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function digestBytes(value: Uint8Array): ArtifactDigest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function temp(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(path);
  return path;
}
