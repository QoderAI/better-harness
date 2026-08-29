import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ArtifactHostedIntentAdmissionInputV1,
  ArtifactHostedIntentEnvelopeV1,
  ExternalArtifactProvider,
} from "../src/contracts/artifact.js";
import { activateArtifactContribution } from "../src/server/artifacts/registry/artifact-provider-activation.js";
import { envelopeSnapshot } from "../src/server/artifacts/registry/artifact-plugin-registry.js";
import { startHarnessStudioServer, type HarnessStudioServerHandle } from "../src/server/server.js";

const temporary: string[] = [];
let server: HarnessStudioServerHandle | undefined;

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
}

interface Fixture {
  root: string;
  appDir: string;
  artifactDirectory: string;
  sourcePath: string;
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
  await writeFile(sourcePath, "initial intent canvas\n", "utf8");
  const calls = { admit: 0, inspect: 0, prepare: 0, decide: 0 };
  const hooks: FixtureHooks = {
    admit: async (input) => ({
      intentId: input.intentId,
      effect: { kind: "selection", target: { address: "json-canvas://root", kind: "root", label: "Root" } },
    }),
  };
  const provider = intentProvider(hooks, calls);
  return { root, appDir, artifactDirectory, sourcePath, stateRoot, provider, hooks, calls };
}

async function startFixture(fixture: Fixture): Promise<any> {
  await activateArtifactContribution(
    fixture.provider,
    "intent-canvas",
    "external-override",
    { extensions: ["intentcanvas"] },
    { root: fixture.stateRoot },
  );
  server = await startHarnessStudioServer({
    appDir: fixture.appDir,
    artifactDirectory: fixture.artifactDirectory,
    artifactProviderStateRoot: fixture.stateRoot,
    artifactProviders: [fixture.provider],
    walnutCacheRoot: join(fixture.root, "missing-walnut"),
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
    }],
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
