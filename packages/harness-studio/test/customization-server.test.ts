import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CUSTOMIZATION_CATALOG_KIND,
  CUSTOMIZATION_SCHEMA_VERSION,
  summarizeCustomizationCatalog,
  type CustomizationAnalysisResponseV1,
  type CustomizationCatalogV1,
} from "@qoder-ai/harness/customization";
import { startHarnessStudioServer, type StartedHarnessStudioServer } from "../src/server/server.js";

let started: StartedHarnessStudioServer | undefined;
const tempDirs: string[] = [];

afterEach(async () => {
  await started?.close();
  started = undefined;
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(path);
  return path;
}

function emptyAnalysis(): CustomizationAnalysisResponseV1 {
  const catalog: CustomizationCatalogV1 = {
    kind: CUSTOMIZATION_CATALOG_KIND,
    schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
    generatedAt: "2026-08-22T09:00:00.000Z",
    workspace: { label: "fixture", evidenceId: "workspace:fixture" },
    hosts: [{ id: "codex", label: "Codex", status: "ok" }],
    packages: [], definitions: [], installations: [], exposures: [], registrations: [], runtimeObservations: [],
  };
  return { catalog, summary: summarizeCustomizationCatalog(catalog) };
}

describe("Studio customization analysis routes", () => {
  it("collects only on request, rejects overlap, and clears results with the workspace", async () => {
    const appDir = await tempDirectory("customization-app-");
    const workspace = await tempDirectory("customization-workspace-");
    const canonicalWorkspace = await realpath(workspace);
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>fixture</title>", "utf8");
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    started = await startHarnessStudioServer({
      appDir,
      workspaceDirectoryPicker: async () => workspace,
      workspaceSessionProvider: { discover: async () => ({ label: "fixture", sessions: [] }) },
      customizationCollector: {
        analyze: async (selected) => {
          calls += 1;
          expect(selected).toBe(canonicalWorkspace);
          await gate;
          return emptyAnalysis();
        },
      },
    });

    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({
      customizationAnalysisEnabled: true,
      customizationAnalyzed: false,
      customizationDefinitionCount: 0,
    });
    expect(calls).toBe(0);
    await fetch(`${started.url}/api/workspace/open`, { method: "POST" });
    expect(calls).toBe(0);
    expect((await fetch(`${started.url}/api/customizations`)).status).toBe(404);

    const first = fetch(`${started.url}/api/customizations/analyze`, { method: "POST" });
    await viWaitFor(() => calls === 1);
    const overlapping = await fetch(`${started.url}/api/customizations/analyze`, { method: "POST" });
    expect(overlapping.status).toBe(409);
    release?.();
    expect((await first).status).toBe(200);
    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({ customizationAnalyzed: true });
    expect((await fetch(`${started.url}/api/customizations`)).status).toBe(200);

    await fetch(`${started.url}/api/workspace`, { method: "DELETE" });
    expect((await fetch(`${started.url}/api/customizations`)).status).toBe(404);
  });

  it("requires same-origin requests and can analyze the explicit launch workspace", async () => {
    const appDir = await tempDirectory("customization-app-");
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>fixture</title>", "utf8");
    const launchWorkspace = await tempDirectory("customization-launch-workspace-");
    let selected: string | undefined;
    started = await startHarnessStudioServer({
      appDir,
      cwd: launchWorkspace,
      customizationCollector: { analyze: async (workspace) => { selected = workspace; return emptyAnalysis(); } },
    });

    const crossOrigin = await fetch(`${started.url}/api/customizations/analyze`, {
      method: "POST",
      headers: { Origin: "https://example.invalid" },
    });
    expect(crossOrigin.status).toBe(403);
    expect((await fetch(`${started.url}/api/customizations/analyze`, { method: "POST" })).status).toBe(200);
    expect(selected).toBe(launchWorkspace);
  });

  it("rejects private fields returned by an injected collector", async () => {
    const appDir = await tempDirectory("customization-app-");
    const launchWorkspace = await tempDirectory("customization-private-workspace-");
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>fixture</title>", "utf8");
    started = await startHarnessStudioServer({
      appDir,
      cwd: launchWorkspace,
      customizationCollector: {
        analyze: async () => {
          const analysis = emptyAnalysis();
          Object.assign(analysis.catalog, {
            command: "node private-hook.mjs --token fixture-secret",
            privatePath: launchWorkspace,
          });
          return analysis;
        },
      },
    });

    const response = await fetch(`${started.url}/api/customizations/analyze`, { method: "POST" });
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).not.toContain("fixture-secret");
    expect(body).not.toContain(launchWorkspace);
    expect((await fetch(`${started.url}/api/customizations`)).status).toBe(404);
  });
});

async function viWaitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the collector call.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
