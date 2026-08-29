import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { decodeSseStream } from "@qoder-ai/harness-ui";
import { canonicalArtifactInteractionJson } from "../src/contracts/artifact.js";
import type {
  ArtifactHostedIntentAdmissionInputV1,
  ArtifactHostedIntentEnvelopeV1,
  ArtifactInteractionRuntimeImplementation,
  ExternalArtifactProvider,
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

describe("hosted Artifact intent admission", () => {
  it("records one Host-owned outcome and canonically replays concurrent duplicates without execution", async () => {
    const fixture = await createFixture();
    const gate = deferred();
    const started = deferred();
    fixture.hooks.admit = async (input) => {
      fixture.calls.admit += 1;
      started.resolve();
      if (input.intent.wait === true) await gate.promise;
      return {
        intentId: input.intentId,
        effect: {
          kind: "steering",
          target: { address: "json-canvas://node/orders", kind: "node", label: "Orders" },
          steering: { kind: "canvas-steering", message: "Focus the order flow" },
        },
      };
    };
    const descriptor = await startFixture(fixture);
    const before = await fixtureSource(fixture);
    const envelope = intentEnvelope(descriptor, "intent:concurrent", { wait: true });

    const first = fetch(`${server!.url}${descriptor.intent!.intentUri}`, post(envelope));
    await started.promise;
    const second = fetch(`${server!.url}${descriptor.intent!.intentUri}`, post(envelope));
    gate.resolve();
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const outcomes = await Promise.all(responses.map(async (response) => await response.json())) as Array<Record<string, any>>;
    const initial = outcomes.find((outcome) => outcome.replayed === false)!;
    const concurrentReplay = outcomes.find((outcome) => outcome.replayed === true)!;
    expect(initial).toMatchObject({
      kind: "HarnessStudioArtifactHostedIntentOutcomeV1",
      protocolVersion: "1",
      artifactId: descriptor.id,
      revision: descriptor.revision.id,
      bindingId: descriptor.renderer.bindingId,
      intentId: envelope.intentId,
      actor: { id: "system:hosted-artifact-surface", kind: "system", label: "Hosted Artifact surface" },
      status: "recorded",
      execution: "not-executed",
      effect: {
        kind: "steering",
        selectionId: expect.stringMatching(/^selection:/u),
        steeringId: expect.stringMatching(/^steering:/u),
        target: { address: "json-canvas://node/orders" },
      },
    });
    expect(Number.isNaN(Date.parse(String(initial.recordedAt)))).toBe(false);
    expect({ ...concurrentReplay, replayed: false }).toEqual(initial);

    const replayResponse = await fetch(`${server!.url}${descriptor.intent!.intentUri}`, post(envelope));
    expect(replayResponse.status).toBe(200);
    const replay = await replayResponse.json() as Record<string, unknown>;
    expect({ ...replay, replayed: false }).toEqual(initial);
    expect(fixture.calls).toEqual({ admit: 1, inspect: 0, prepare: 0, decide: 0 });
    expect(await fixtureSource(fixture)).toBe(before);

    const conflict = await fetch(`${server!.url}${descriptor.intent!.intentUri}`, post({
      ...envelope,
      intent: { wait: false },
    }));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: "INTENT_ID_CONFLICT" });
    expect(fixture.calls.admit).toBe(1);
  });

  it("fails closed on stale identity, Host-owned fields, unsafe JSON, and Provider rejection", async () => {
    const fixture = await createFixture();
    fixture.hooks.admit = async (input) => {
      fixture.calls.admit += 1;
      if (input.intent.reject === true) throw new Error("private provider path /Users/operator/secret");
      if (input.intent.unknown === true) {
        return {
          intentId: input.intentId,
          effect: { kind: "selection", target: { address: " ", kind: "node", label: "Unknown" } },
        };
      }
      return {
        intentId: input.intentId,
        effect: { kind: "selection", target: { address: "json-canvas://node/one", kind: "node", label: "One" } },
      };
    };
    const descriptor = await startFixture(fixture);
    const uri = `${server!.url}${descriptor.intent!.intentUri}`;

    const stale = await fetch(uri, post({
      ...intentEnvelope(descriptor, "intent:stale", {}),
      bindingId: `sha256:${"f".repeat(64)}`,
    }));
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: "INTENT_BINDING_STALE" });

    const hostFields = await fetch(uri, post({
      ...intentEnvelope(descriptor, "intent:forged", {}),
      actor: { id: "agent:forged", kind: "agent", label: "forged" },
      recordedAt: "2000-01-01T00:00:00.000Z",
      selectionId: "selection:forged",
      steeringId: "steering:forged",
    }));
    expect(hostFields.status).toBe(400);
    await expect(hostFields.json()).resolves.toMatchObject({ code: "INTENT_INVALID" });

    const unsafeTemplate = JSON.stringify(intentEnvelope(descriptor, "intent:unsafe", {}));
    const unsafeBody = unsafeTemplate.replace('"intent":{}', '"intent":{"__proto__":{"admin":true}}');
    const unsafe = await fetch(uri, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: unsafeBody,
    });
    expect(unsafe.status).toBe(400);
    await expect(unsafe.json()).resolves.toMatchObject({ code: "INTENT_INVALID" });

    const crossOrigin = await fetch(uri, {
      ...post(intentEnvelope(descriptor, "intent:cross-origin", {})),
      headers: { "Content-Type": "application/json", Origin: "https://untrusted.invalid" },
    });
    expect(crossOrigin.status).toBe(403);

    const unknown = await fetch(uri, post(intentEnvelope(descriptor, "intent:unknown", { unknown: true })));
    expect(unknown.status).toBe(422);
    await expect(unknown.json()).resolves.toMatchObject({ code: "INTENT_PROVIDER_REJECTED" });

    const rejected = await fetch(uri, post(intentEnvelope(descriptor, "intent:rejected", { reject: true })));
    expect(rejected.status).toBe(422);
    const failure = await rejected.json() as { code: string; message: string };
    expect(failure).toEqual({
      kind: "HarnessStudioArtifactHostedIntentErrorV1",
      code: "INTENT_PROVIDER_REJECTED",
      message: "The selected Artifact Provider rejected the intent.",
    });
    expect(JSON.stringify(failure)).not.toContain("/Users/operator/secret");
    expect(fixture.calls).toEqual({ admit: 2, inspect: 0, prepare: 0, decide: 0 });
  });

  it("re-resolves the exact source after async Provider admission before recording", async () => {
    const fixture = await createFixture();
    const gate = deferred();
    const started = deferred();
    fixture.hooks.admit = async (input) => {
      fixture.calls.admit += 1;
      started.resolve();
      await gate.promise;
      return {
        intentId: input.intentId,
        effect: { kind: "selection", target: { address: "json-canvas://node/late", kind: "node", label: "Late" } },
      };
    };
    const descriptor = await startFixture(fixture);
    const request = fetch(`${server!.url}${descriptor.intent!.intentUri}`, post(intentEnvelope(descriptor, "intent:late", {})));
    await started.promise;
    await writeFile(fixture.sourcePath, "changed source after admission started\n", "utf8");
    gate.resolve();

    const response = await request;
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "INTENT_REVISION_STALE" });
    expect(fixture.calls).toEqual({ admit: 1, inspect: 0, prepare: 0, decide: 0 });
  });

  it("normalizes a Provider-owned native target through the exact destination interaction binding", async () => {
    const fixture = await createFixture();
    const descriptor = await startFixture(fixture);
    const catalog = await (await fetch(`${server!.url}/api/artifacts`)).json() as { artifacts: any[] };
    const destination = catalog.artifacts.find((artifact) => artifact.label === "native.target");
    expect(destination).toMatchObject({
      interaction: { workspaceUri: expect.stringMatching(/\/interaction$/u) },
      renderer: { bindingId: expect.stringMatching(/^sha256:/u) },
    });
    fixture.hooks.admit = async (input) => {
      fixture.calls.admit += 1;
      return {
        intentId: input.intentId,
        sourceTarget: { address: "json-canvas://node/plan", kind: "json-render:Card", label: "Plan" },
        destination: { artifactLabel: destination.label, revision: destination.revision.id },
        effect: {
          kind: "steering",
          target: { address: "native://target/runtime", kind: "native-node", label: "Runtime" },
          steering: { kind: "rename", message: "Rename to Adopted Runtime" },
        },
      };
    };

    const response = await fetch(
      `${server!.url}${descriptor.intent!.intentUri}`,
      post(intentEnvelope(descriptor, "intent:native-target", {})),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      sourceTarget: { address: "json-canvas://node/plan", kind: "json-render:Card", label: "Plan" },
      destination: {
        artifactId: destination.id,
        artifactLabel: destination.label,
        revision: destination.revision.id,
        bindingId: destination.renderer.bindingId,
      },
      originRef: {
        kind: "HarnessStudioArtifactHostedIntentOriginRefV1",
        originId: expect.stringMatching(/^origin:/u),
      },
      effect: {
        kind: "steering",
        target: { address: "native://target/runtime", kind: "native-node", label: "Runtime" },
        steering: { kind: "rename", message: "Rename to Adopted Runtime" },
      },
      execution: "not-executed",
    });
    expect(fixture.calls).toEqual({ admit: 1, inspect: 1, prepare: 0, decide: 0 });
  });

  it("binds an explicitly adopted native draft through Provider proposal and decision replay", async () => {
    const fixture = await createFixture();
    enableNativeInteraction(fixture);
    const descriptor = await startFixture(fixture);
    const catalog = await (await fetch(`${server!.url}/api/artifacts`)).json() as { artifacts: any[] };
    const destination = catalog.artifacts.find((artifact) => artifact.label === "native.target");
    fixture.hooks.admit = nativeAdmission(fixture, destination, "Rename to Provenance Runtime");
    const beforeSource = await readFile(fixture.sourcePath, "utf8");
    const beforeDestination = await readFile(fixture.destinationPath, "utf8");

    const admitted = await fetch(
      `${server!.url}${descriptor.intent!.intentUri}`,
      post(intentEnvelope(descriptor, "intent:provenance-direct", {})),
    );
    expect(admitted.status).toBe(201);
    const outcome = await admitted.json() as any;
    const preparedResponse = await fetch(`${server!.url}${destination.interaction.workspaceUri}/proposals`, post({
      targetAddress: "native://target/runtime",
      steering: { kind: "rename", message: "Rename to Provenance Runtime" },
      requestedBy: { id: "human:test", kind: "human", label: "Test user" },
      requestId: "request:provenance-direct",
      originRef: outcome.originRef,
    }));
    expect(preparedResponse.status, await preparedResponse.clone().text()).toBe(201);
    const prepared = await preparedResponse.json() as any;
    expect(prepared).toMatchObject({
      proposal: {
        artifactId: destination.id,
        target: { address: "native://target/runtime" },
        proposedBy: { id: "human:test", kind: "human" },
      },
      provenance: {
        kind: "HarnessStudioArtifactInteractionProvenanceV1",
        protocolVersion: "1",
        originId: outcome.originRef.originId,
        adoptionId: expect.stringMatching(/^adoption:/u),
        source: {
          artifactId: descriptor.id,
          revision: descriptor.revision.id,
          bindingId: descriptor.renderer.bindingId,
          intentId: "intent:provenance-direct",
          target: { address: "json-canvas://node/plan" },
        },
        destination: {
          artifactId: destination.id,
          revision: destination.revision.id,
          bindingId: destination.renderer.bindingId,
        },
        draft: {
          selectionId: outcome.effect.selectionId,
          steeringId: outcome.effect.steeringId,
          target: { address: "native://target/runtime" },
          steering: { kind: "rename", message: "Rename to Provenance Runtime" },
        },
        recordedBy: { id: "system:hosted-artifact-surface", kind: "system" },
        adoptedBy: { id: "human:test", kind: "human" },
        provenanceDigest: expect.stringMatching(/^sha256:/u),
      },
    });
    const { provenanceDigest, ...provenanceContent } = prepared.provenance;
    expect(provenanceDigest).toBe(digestCanonical(provenanceContent));

    const decision = {
      proposalDigest: prepared.proposal.proposalDigest,
      expectedRevision: prepared.proposal.expectedRevision,
      decision: "reject",
      decisionId: "decision:provenance-direct",
      decidedBy: { id: "human:test", kind: "human", label: "Test user" },
    };
    const decisionUri = `${server!.url}${destination.interaction.workspaceUri}/proposals/${encodeURIComponent(prepared.proposal.proposalId)}/decisions`;
    const settled = await fetch(decisionUri, post(decision));
    expect(settled.status).toBe(200);
    const settlement = await settled.json() as any;
    expect(settlement).toEqual({ receipt: expect.objectContaining({ status: "rejected" }), provenance: prepared.provenance, replayed: false });
    const replayed = await (await fetch(decisionUri, post(decision))).json() as any;
    expect(replayed).toEqual({ ...settlement, replayed: true });
    expect(fixture.calls).toEqual({ admit: 1, inspect: 2, prepare: 1, decide: 1 });
    expect(await readFile(fixture.sourcePath, "utf8")).toBe(beforeSource);
    expect(await readFile(fixture.destinationPath, "utf8")).toBe(beforeDestination);
  });

  it("rejects forged, edited, and stale Canvas provenance before native mutation", async () => {
    const fixture = await createFixture();
    enableNativeInteraction(fixture);
    const descriptor = await startFixture(fixture);
    const catalog = await (await fetch(`${server!.url}/api/artifacts`)).json() as { artifacts: any[] };
    const destination = catalog.artifacts.find((artifact) => artifact.label === "native.target");
    fixture.hooks.admit = nativeAdmission(fixture, destination, "Rename to Guarded Runtime");
    const outcome = await (await fetch(
      `${server!.url}${descriptor.intent!.intentUri}`,
      post(intentEnvelope(descriptor, "intent:provenance-stale", {})),
    )).json() as any;
    const proposalUri = `${server!.url}${destination.interaction.workspaceUri}/proposals`;
    const request = {
      targetAddress: "native://target/runtime",
      steering: { kind: "rename", message: "Rename to Guarded Runtime" },
      requestedBy: { id: "human:test", kind: "human", label: "Test user" },
      requestId: "request:provenance-stale",
      originRef: outcome.originRef,
    };

    const forged = await fetch(proposalUri, post({
      ...request,
      requestId: "request:provenance-forged",
      originRef: { ...outcome.originRef, originId: "origin:ffffffff-ffff-4fff-8fff-ffffffffffff" },
    }));
    expect(forged.status).toBe(409);
    await expect(forged.json()).resolves.toMatchObject({ error: expect.stringContaining("no longer retained") });
    const edited = await fetch(proposalUri, post({
      ...request,
      requestId: "request:provenance-edited",
      steering: { ...request.steering, message: "Rename to Edited Runtime" },
    }));
    expect(edited.status).toBe(409);
    await expect(edited.json()).resolves.toMatchObject({ error: expect.stringContaining("draft changed") });
    const changedGrammar = await fetch(proposalUri, post({
      ...request,
      requestId: "request:provenance-grammar",
      steering: { ...request.steering, kind: "other-grammar" },
    }));
    expect(changedGrammar.status).toBe(409);
    await expect(changedGrammar.json()).resolves.toMatchObject({ error: expect.stringContaining("grammar changed") });
    expect(fixture.calls.prepare).toBe(0);

    const preparedResponse = await fetch(proposalUri, post(request));
    expect(preparedResponse.status, await preparedResponse.clone().text()).toBe(201);
    const prepared = await preparedResponse.json() as any;
    await writeFile(fixture.sourcePath, "changed Canvas source after proposal\n", "utf8");
    const settled = await fetch(
      `${server!.url}${destination.interaction.workspaceUri}/proposals/${encodeURIComponent(prepared.proposal.proposalId)}/decisions`,
      post({
        proposalDigest: prepared.proposal.proposalDigest,
        expectedRevision: prepared.proposal.expectedRevision,
        decision: "approve",
        decisionId: "decision:provenance-stale",
        decidedBy: { id: "human:test", kind: "human", label: "Test user" },
      }),
    );
    expect(settled.status).toBe(409);
    await expect(settled.json()).resolves.toMatchObject({ error: expect.stringContaining("Canvas source revision") });
    expect(fixture.calls.prepare).toBe(1);
    expect(fixture.calls.decide).toBe(0);
    expect(await readFile(fixture.destinationPath, "utf8")).toBe("initial native target\n");
  });

  it("carries adopted Canvas provenance through a real ACP plan and retained Agent proposal", async () => {
    const fixture = await createFixture();
    enableNativeInteraction(fixture);
    const descriptor = await startFixture(fixture, { agentArgs: [ACP_AGENT_FIXTURE, "--artifact-plan"] });
    const catalog = await (await fetch(`${server!.url}/api/artifacts`)).json() as { artifacts: any[] };
    const destination = catalog.artifacts.find((artifact) => artifact.label === "native.target");
    fixture.hooks.admit = nativeAdmission(fixture, destination, "Give the adopted target a clearer name.", "instruction");
    const outcome = await (await fetch(
      `${server!.url}${descriptor.intent!.intentUri}`,
      post(intentEnvelope(descriptor, "intent:provenance-agent", {})),
    )).json() as any;

    const response = await fetch(`${server!.url}${destination.interaction.workspaceUri}/agent-runs`, post({
      targetAddress: "native://target/runtime",
      message: "Give the adopted target a clearer name.",
      requestedBy: { id: "human:test", kind: "human", label: "Test user" },
      runId: "artifact-run:provenance-agent",
      originRef: outcome.originRef,
    }));
    expect(response.status).toBe(200);
    const events = decodeSseStream(await response.text());
    const evidence = events.find((event) => event.type === "CUSTOM" && event.name === "artifact.agent.evidence") as any;
    const proposal = events.find((event) => event.type === "CUSTOM" && event.name === "artifact.agent.proposal") as any;
    expect(evidence, JSON.stringify(events)).toMatchObject({
      value: {
        kind: "HarnessStudioArtifactAgentRunEvidenceV1",
        provenance: { originId: outcome.originRef.originId, adoptedBy: { id: "human:test" } },
      },
    });
    expect(proposal).toMatchObject({
      value: {
        proposal: { proposedBy: { kind: "agent" }, steering: { kind: "rename", message: "Rename to Agent planned" } },
        provenance: { originId: outcome.originRef.originId },
      },
    });
    expect(evidence.value.provenance).toEqual(proposal.value.provenance);
    expect(fixture.calls).toEqual({ admit: 1, inspect: 2, prepare: 1, decide: 0 });
    expect(await readFile(fixture.sourcePath, "utf8")).toBe("initial intent canvas\n");
    expect(await readFile(fixture.destinationPath, "utf8")).toBe("initial native target\n");
  });

  it("fails closed when a native target claim drifts from the destination revision or workspace", async () => {
    const fixture = await createFixture();
    const descriptor = await startFixture(fixture);
    const catalog = await (await fetch(`${server!.url}/api/artifacts`)).json() as { artifacts: any[] };
    const destination = catalog.artifacts.find((artifact) => artifact.label === "native.target");
    fixture.hooks.admit = async (input) => {
      fixture.calls.admit += 1;
      return {
        intentId: input.intentId,
        sourceTarget: { address: "json-canvas://node/plan", kind: "json-render:Card", label: "Plan" },
        destination: { artifactLabel: "../native.target", revision: destination.revision.id },
        effect: {
          kind: "steering",
          target: { address: "native://target/runtime", kind: "native-node", label: "Runtime" },
          steering: { kind: "rename", message: "Rename to Escaped Runtime" },
        },
      };
    };
    const escaped = await fetch(
      `${server!.url}${descriptor.intent!.intentUri}`,
      post(intentEnvelope(descriptor, "intent:native-escape", {})),
    );
    expect(escaped.status).toBe(422);
    await expect(escaped.json()).resolves.toMatchObject({ code: "INTENT_PROVIDER_REJECTED" });

    fixture.hooks.admit = async (input) => {
      fixture.calls.admit += 1;
      return {
        intentId: input.intentId,
        sourceTarget: { address: "json-canvas://node/plan", kind: "json-render:Card", label: "Plan" },
        destination: { artifactLabel: destination.label, revision: destination.revision.id },
        effect: {
          kind: "steering",
          target: { address: "native://target/missing", kind: "native-node", label: "Missing" },
          steering: { kind: "rename", message: "Rename to Missing" },
        },
      };
    };
    const missing = await fetch(
      `${server!.url}${descriptor.intent!.intentUri}`,
      post(intentEnvelope(descriptor, "intent:native-missing", {})),
    );
    expect(missing.status).toBe(409);
    await expect(missing.json()).resolves.toMatchObject({ code: "INTENT_DESTINATION_STALE" });

    await writeFile(fixture.destinationPath, "changed native target\n", "utf8");
    fixture.hooks.admit = async (input) => {
      fixture.calls.admit += 1;
      return {
        intentId: input.intentId,
        sourceTarget: { address: "json-canvas://node/plan", kind: "json-render:Card", label: "Plan" },
        destination: { artifactLabel: destination.label, revision: destination.revision.id },
        effect: {
          kind: "steering",
          target: { address: "native://target/runtime", kind: "native-node", label: "Runtime" },
          steering: { kind: "instruction", message: "Keep the domain grammar separate" },
        },
      };
    };
    const staleDestination = await fetch(
      `${server!.url}${descriptor.intent!.intentUri}`,
      post(intentEnvelope(descriptor, "intent:native-revision", {})),
    );
    expect(staleDestination.status).toBe(409);
    await expect(staleDestination.json()).resolves.toMatchObject({ code: "INTENT_DESTINATION_STALE" });
    expect(fixture.calls).toEqual({ admit: 3, inspect: 1, prepare: 0, decide: 0 });
  });

  it("rejects a delayed admission after the live Artifact authority switches to identical bytes", async () => {
    const fixture = await createFixture();
    const gate = deferred();
    const started = deferred();
    fixture.hooks.admit = async (input) => {
      fixture.calls.admit += 1;
      started.resolve();
      await gate.promise;
      return {
        intentId: input.intentId,
        effect: { kind: "selection", target: { address: "json-canvas://node/authority", kind: "node", label: "Authority" } },
      };
    };
    const descriptor = await startFixture(fixture);
    const request = fetch(`${server!.url}${descriptor.intent!.intentUri}`, post(intentEnvelope(descriptor, "intent:authority", {})));
    await started.promise;

    const created = await fetch(`${server!.url}/api/artifact-imports`, { method: "POST" });
    const { sessionId } = await created.json() as { sessionId: string };
    expect(created.status).toBe(201);
    const uploaded = await fetch(`${server!.url}/api/artifact-imports/${sessionId}/files?name=flow.intentcanvas`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: "initial intent canvas\n",
    });
    expect(uploaded.status).toBe(201);
    expect((await fetch(`${server!.url}/api/artifact-imports/${sessionId}/commit`, { method: "POST" })).status).toBe(200);
    gate.resolve();

    const response = await request;
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "INTENT_BINDING_STALE" });
    expect(fixture.calls).toEqual({ admit: 1, inspect: 0, prepare: 0, decide: 0 });
  });

  it("rejects a delayed admission after the Provider intent runtime identity changes", async () => {
    const fixture = await createFixture();
    const gate = deferred();
    const started = deferred();
    fixture.hooks.admit = async (input) => {
      fixture.calls.admit += 1;
      started.resolve();
      await gate.promise;
      return {
        intentId: input.intentId,
        effect: { kind: "selection", target: { address: "json-canvas://node/provider", kind: "node", label: "Provider" } },
      };
    };
    const descriptor = await startFixture(fixture);
    const request = fetch(`${server!.url}${descriptor.intent!.intentUri}`, post(intentEnvelope(descriptor, "intent:provider-change", {})));
    await started.promise;
    const runtime = fixture.provider.contributions[0]!.intent!;
    Object.assign(runtime, { version: "2" });
    gate.resolve();

    const response = await request;
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "INTENT_BINDING_STALE" });
    expect(fixture.calls).toEqual({ admit: 1, inspect: 0, prepare: 0, decide: 0 });
  });

  it("aborts a timed-out Provider and tombstones the canonical retry", async () => {
    const fixture = await createFixture();
    let aborted = 0;
    fixture.hooks.admit = async (input) => await new Promise((_resolve, reject) => {
      fixture.calls.admit += 1;
      input.signal.addEventListener("abort", () => {
        aborted += 1;
        reject(new Error("aborted fixture Provider"));
      }, { once: true });
    });
    const descriptor = await startFixture(fixture);
    const envelope = intentEnvelope(descriptor, "intent:timeout", {});

    const first = await fetch(`${server!.url}${descriptor.intent!.intentUri}`, post(envelope));
    expect(first.status).toBe(504);
    await expect(first.json()).resolves.toMatchObject({ code: "INTENT_PROVIDER_TIMEOUT" });
    expect(aborted).toBe(1);

    const replay = await fetch(`${server!.url}${descriptor.intent!.intentUri}`, post(envelope));
    expect(replay.status).toBe(504);
    await expect(replay.json()).resolves.toMatchObject({ code: "INTENT_PROVIDER_TIMEOUT" });
    expect(fixture.calls).toEqual({ admit: 1, inspect: 0, prepare: 0, decide: 0 });
  });
});

interface FixtureHooks {
  admit: (input: ArtifactHostedIntentAdmissionInputV1) => Promise<any>;
  prepare?: ArtifactInteractionRuntimeImplementation["prepare"];
  decide?: ArtifactInteractionRuntimeImplementation["decide"];
}

interface Fixture {
  root: string;
  appDir: string;
  artifactDirectory: string;
  sourcePath: string;
  destinationPath: string;
  stateRoot: string;
  provider: ExternalArtifactProvider;
  hooks: FixtureHooks;
  calls: { admit: number; inspect: number; prepare: number; decide: number };
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "artifact-intent-server-"));
  temporary.push(root);
  const appDir = join(root, "app");
  const artifactDirectory = join(root, "artifacts");
  const sourcePath = join(artifactDirectory, "flow.intentcanvas");
  const stateRoot = join(root, "state");
  await Promise.all([mkdir(appDir), mkdir(artifactDirectory)]);
  await writeFile(join(appDir, "index.html"), "<!doctype html><title>fixture</title>", "utf8");
  const destinationPath = join(artifactDirectory, "native.target");
  await Promise.all([
    writeFile(sourcePath, "initial intent canvas\n", "utf8"),
    writeFile(destinationPath, "initial native target\n", "utf8"),
  ]);
  const calls = { admit: 0, inspect: 0, prepare: 0, decide: 0 };
  const hooks: FixtureHooks = {
    admit: async (input) => ({
      intentId: input.intentId,
      effect: { kind: "selection", target: { address: "json-canvas://root", kind: "root", label: "Root" } },
    }),
  };
  const provider = intentProvider(hooks, calls);
  return { root, appDir, artifactDirectory, sourcePath, destinationPath, stateRoot, provider, hooks, calls };
}

async function startFixture(fixture: Fixture, input: { agentArgs?: string[] } = {}): Promise<any> {
  await activateArtifactContribution(
    fixture.provider,
    "intent-canvas",
    "external-override",
    { extensions: ["intentcanvas"] },
    { root: fixture.stateRoot },
  );
  await activateArtifactContribution(
    fixture.provider,
    "native-target",
    "external-override",
    { extensions: ["target"] },
    { root: fixture.stateRoot },
  );
  server = await startHarnessStudioServer({
    appDir: fixture.appDir,
    artifactDirectory: fixture.artifactDirectory,
    artifactProviderStateRoot: fixture.stateRoot,
    artifactProviders: [fixture.provider],
    walnutCacheRoot: join(fixture.root, "missing-walnut"),
    ...(input.agentArgs === undefined ? {} : {
      acpAgent: {
        command: process.execPath,
        args: input.agentArgs,
        label: "Fixture Artifact Agent",
        harnessSource: DEFAULT_LOCAL_ACP_HARNESS_SOURCE,
      },
    }),
  });
  const catalog = await (await fetch(`${server.url}/api/artifacts`)).json() as { artifacts: any[] };
  const descriptor = catalog.artifacts.find((artifact) => artifact.label === "flow.intentcanvas");
  expect(descriptor).toMatchObject({
    intent: { intentUri: expect.stringMatching(/\/intents$/u) },
    renderer: { status: "ready", bindingId: expect.stringMatching(/^sha256:/u) },
    capabilities: expect.arrayContaining(["select", "steer"]),
  });
  return descriptor;
}

function intentProvider(
  hooks: FixtureHooks,
  calls: Fixture["calls"],
): ExternalArtifactProvider {
  const receipt: ExternalArtifactProvider["receipt"] = {
    kind: "HarnessStudioExternalArtifactProviderReceiptV1",
    providerId: "fixture.intent-canvas",
    providerVersion: "1",
    providerDescriptorDigest: `sha256:${"a".repeat(64)}`,
    assets: [],
    driverVersions: { fixture: "1" },
  };
  return {
    id: receipt.providerId,
    label: "Intent Canvas fixture",
    version: receipt.providerVersion,
    acquisition: "operator-provisioned",
    fingerprint: digestJson(receipt),
    receipt,
    contributions: [{
      id: "intent-canvas",
      label: "Intent Canvas",
      matcher: { extensions: ["intentcanvas"] },
      adapter: {
        id: "fixture.intent-canvas.adapter",
        version: "1",
        schemaId: "fixture/intent-canvas-v1",
        adapt: async (context) => await envelopeSnapshot(context, { kind: "fixture/intent-canvas-v1" }),
      },
      renderer: { id: "fixture.intent-canvas", label: "Intent Canvas", provider: "fixture", type: "external-hosted", status: "ready" },
      surface: {
        kind: "external-hosted",
        rendererId: "fixture.intent-canvas",
        runtimeId: "fixture.intent-canvas.hosted",
        securityProfileId: "opaque-web-v1",
        runtime: {
          id: "fixture.intent-canvas.hosted",
          version: "1",
          prepareDocument: async () => "<!doctype html><title>intent canvas</title>",
          readModule: async () => "export {};",
          readResource: async () => undefined,
        },
      },
      capabilities: ["navigate", "select", "steer"],
      intent: {
        id: "fixture.intent-canvas.intent",
        version: "1",
        protocolVersion: "1",
        admit: async (_context, input) => await hooks.admit(input),
      },
      interaction: {
        id: "fixture.intent-canvas.interaction",
        version: "1",
        protocolVersion: "1",
        inspect: async () => { calls.inspect += 1; throw new Error("inspect must not run"); },
        prepare: async () => { calls.prepare += 1; throw new Error("prepare must not run"); },
        decide: async () => { calls.decide += 1; throw new Error("decide must not run"); },
      },
      support: "experimental-local",
      adapterExecutionProfile: "trusted-local-process",
    }, {
      id: "native-target",
      label: "Native target",
      matcher: { extensions: ["target"] },
      adapter: {
        id: "fixture.native-target.adapter",
        version: "1",
        schemaId: "fixture/native-target-v1",
        adapt: async (context) => await envelopeSnapshot(context, { kind: "fixture/native-target-v1" }),
      },
      renderer: { id: "fixture.native-target", label: "Native target", provider: "fixture", type: "external-hosted", status: "ready" },
      surface: {
        kind: "external-hosted",
        rendererId: "fixture.native-target",
        runtimeId: "fixture.native-target.hosted",
        securityProfileId: "opaque-web-v1",
        runtime: {
          id: "fixture.native-target.hosted",
          version: "1",
          prepareDocument: async () => "<!doctype html><title>native target</title>",
          readModule: async () => "export {};",
          readResource: async () => undefined,
        },
      },
      capabilities: ["select", "steer"],
      interaction: {
        id: "fixture.native-target.interaction",
        version: "1",
        protocolVersion: "1",
        inspect: async (context) => {
          calls.inspect += 1;
          return {
            kind: "HarnessStudioArtifactInteractionWorkspaceV1",
            protocolVersion: "1",
            artifactId: context.descriptor.id,
            revision: context.descriptor.revision.id,
            summary: "Native target workspace",
            targets: [{ address: "native://target/runtime", kind: "native-node", label: "Runtime" }],
            steering: { kind: "rename", label: "Rename", placeholder: "Rename to <label>", maxLength: 256 },
          };
        },
        prepare: async (context, input) => {
          calls.prepare += 1;
          if (hooks.prepare === undefined) throw new Error("prepare must not run");
          return await hooks.prepare(context, input);
        },
        decide: async (context, input) => {
          calls.decide += 1;
          if (hooks.decide === undefined) throw new Error("decide must not run");
          return await hooks.decide(context, input);
        },
      },
      support: "experimental-local",
      adapterExecutionProfile: "trusted-local-process",
    }],
  };
}

function nativeAdmission(fixture: Fixture, destination: any, message: string, kind = "rename"): FixtureHooks["admit"] {
  return async (input) => {
    fixture.calls.admit += 1;
    return {
      intentId: input.intentId,
      sourceTarget: { address: "json-canvas://node/plan", kind: "json-render:Card", label: "Plan" },
      destination: { artifactLabel: destination.label, revision: destination.revision.id },
      effect: {
        kind: "steering",
        target: { address: "native://target/runtime", kind: "native-node", label: "Runtime" },
        steering: { kind, message },
      },
    };
  };
}

function enableNativeInteraction(fixture: Fixture): void {
  fixture.hooks.prepare = async (context, input) => {
    if (input.targetAddress !== "native://target/runtime" || input.steering.kind !== "rename") {
      throw new Error("Unsupported native target steering.");
    }
    const target = { address: "native://target/runtime", kind: "native-node", label: "Runtime" };
    const content = {
      kind: "HarnessStudioArtifactInteractionProposalV1" as const,
      proposalId: `proposal:${input.requestId.replace(/^request:/u, "")}`,
      artifactId: context.descriptor.id,
      expectedRevision: context.descriptor.revision.id,
      target,
      steering: input.steering,
      summary: input.steering.message,
      actions: [{ kind: "rename", summary: input.steering.message, target }],
      verificationClaims: ["Native readback must match."],
      proposedBy: input.requestedBy,
      preparedAt: new Date().toISOString(),
    };
    const bytes = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"><text>Native proposal</text></svg>", "utf8");
    return {
      proposal: { ...content, proposalDigest: digestCanonical(content) },
      preview: { bytes, mediaType: "image/svg+xml", label: "Native proposal", digest: digestBytes(bytes) },
      continuation: null,
    };
  };
  fixture.hooks.decide = async (_context, input) => {
    return {
      kind: "HarnessStudioArtifactInteractionTransitionReceiptV1",
      transitionId: `transition:${input.decisionId}`,
      proposalId: input.prepared.proposal.proposalId,
      proposalDigest: input.prepared.proposal.proposalDigest,
      decisionId: input.decisionId,
      decision: input.decision,
      status: "rejected",
      beforeRevision: input.prepared.proposal.expectedRevision,
      afterRevision: input.prepared.proposal.expectedRevision,
      verification: { status: "not-run", summary: "Rejected without native mutation." },
      affectedTargets: [input.prepared.proposal.target],
      evidence: [],
      diagnostics: [],
      settledAt: new Date().toISOString(),
    };
  };
}

function intentEnvelope(descriptor: any, intentId: string, intent: Record<string, unknown>): ArtifactHostedIntentEnvelopeV1 {
  return {
    kind: "HarnessStudioArtifactHostedIntentV1",
    protocolVersion: "1",
    artifactId: descriptor.id,
    revision: descriptor.revision.id,
    bindingId: descriptor.renderer.bindingId,
    intentId,
    intent: intent as ArtifactHostedIntentEnvelopeV1["intent"],
  };
}

function post(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function fixtureSource(fixture: Fixture): Promise<string> {
  return await import("node:fs/promises").then(async ({ readFile }) => await readFile(fixture.sourcePath, "utf8"));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function digestJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function digestCanonical(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalArtifactInteractionJson(value)).digest("hex")}`;
}

function digestBytes(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
