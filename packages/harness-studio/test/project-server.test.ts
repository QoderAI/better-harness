import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startHarnessStudioServer, type StartedHarnessStudioServer } from "../src/server/server.js";
import type { StudioProjectCatalog, StudioProjectDescriptor } from "../src/contracts/studio-project.js";

let started: StartedHarnessStudioServer | undefined;
const directories: string[] = [];

afterEach(async () => {
  await started?.close();
  started = undefined;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function directory(prefix: string): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), prefix));
  directories.push(value);
  return value;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  expect(response.ok).toBe(true);
  return await response.json() as T;
}

describe("Studio Project catalog", () => {
  it("registers, refreshes, switches, rolls back failed discovery, and removes opaque Projects", async () => {
    const appDir = await directory("studio-project-app-");
    await writeFile(join(appDir, "index.html"), "<!doctype html><title>Project fixture</title>", "utf8");
    const projectA = await directory("studio-project-a-");
    const projectB = await directory("studio-project-b-");
    const selections = [projectA, projectB];
    const discoveries: string[] = [];
    let failProjectB = false;
    let blockProjectB = false;
    let releaseProjectB: (() => void) | undefined;
    const projectBRelease = new Promise<void>((resolveRelease) => { releaseProjectB = resolveRelease; });
    started = await startHarnessStudioServer({
      appDir,
      workspaceDirectoryPicker: async () => selections.shift(),
      workspaceSessionProvider: {
        discover: async (selected) => {
          discoveries.push(selected);
          if (failProjectB && basename(selected) === basename(projectB)) throw new Error("fixture discovery failure");
          if (blockProjectB && basename(selected) === basename(projectB)) await projectBRelease;
          return {
            label: basename(selected) === basename(projectB)
              ? `C:\\Users\\private\\${basename(projectB)}`
              : selected,
            sessions: [],
          };
        },
      },
    });

    const initialCatalog = await fetch(`${started.url}/api/projects`);
    expect(initialCatalog.headers.get("cache-control")).toBe("no-store");
    expect(await initialCatalog.json()).toMatchObject({ revision: 0, projects: [], stage: "idle" });
    const openedA = await json<{ project: StudioProjectDescriptor; revision: number }>(`${started.url}/api/projects/open`, { method: "POST" });
    const openedB = await json<{ project: StudioProjectDescriptor; revision: number }>(`${started.url}/api/projects/open`, { method: "POST" });
    expect(openedA.project.id).toMatch(/^project_[a-f0-9]{32}$/u);
    expect(openedB.project.id).not.toBe(openedA.project.id);
    expect(openedB.project.label).toBe(basename(projectB));
    expect(openedB.revision).toBeGreaterThan(openedA.revision);

    const catalog = await json<StudioProjectCatalog>(`${started.url}/api/projects`);
    expect(catalog).toMatchObject({ activeProjectId: openedB.project.id, revision: openedB.revision });
    expect(catalog.projects).toHaveLength(2);
    expect(JSON.stringify(catalog)).not.toContain(projectA);
    expect(JSON.stringify(catalog)).not.toContain(projectB);

    const activatedA = await json<{ revision: number }>(`${started.url}/api/projects/${openedA.project.id}/activate`, { method: "POST" });
    expect(activatedA.revision).toBeGreaterThan(openedB.revision);
    expect(await json<{ label: string }>(`${started.url}/api/workspace`)).toMatchObject({ label: basename(projectA) });

    const refreshedA = await json<{ revision: number }>(`${started.url}/api/projects/${openedA.project.id}/refresh`, { method: "POST" });
    expect(refreshedA.revision).toBeGreaterThan(activatedA.revision);
    expect(discoveries.filter((path) => basename(path) === basename(projectA))).toHaveLength(3);

    failProjectB = true;
    const failed = await fetch(`${started.url}/api/projects/${openedB.project.id}/activate`, { method: "POST" });
    expect(failed.status).toBe(422);
    expect(await failed.json()).toEqual({ error: "Studio could not refresh the requested Project. The previous Project remains active." });
    expect((await json<StudioProjectCatalog>(`${started.url}/api/projects`)).projects.find((project) => project.id === openedB.project.id)).toMatchObject({ availability: "unavailable" });
    expect(await json<{ id: string; revision: number; label: string }>(`${started.url}/api/workspace`)).toMatchObject({
      id: openedA.project.id,
      revision: refreshedA.revision,
      label: basename(projectA),
    });

    const hostile = await fetch(`${started.url}/api/projects/${openedA.project.id}/refresh`, { method: "POST", headers: { Origin: "https://hostile.example" } });
    expect(hostile.status).toBe(403);
    failProjectB = false;
    blockProjectB = true;
    const pendingActivation = fetch(`${started.url}/api/projects/${openedB.project.id}/activate`, { method: "POST" });
    await waitForStage(started.url, "discovering");
    const concurrentRemoval = await fetch(`${started.url}/api/projects/${openedB.project.id}`, { method: "DELETE" });
    expect(concurrentRemoval.status).toBe(409);
    releaseProjectB?.();
    expect((await pendingActivation).status).toBe(200);
    expect((await json<StudioProjectCatalog>(`${started.url}/api/projects`)).projects.find((project) => project.id === openedB.project.id)).toMatchObject({ availability: "ready" });

    await rm(projectA, { recursive: true, force: true });
    const missingDirectory = await fetch(`${started.url}/api/projects/${openedA.project.id}/activate`, { method: "POST" });
    expect(missingDirectory.status).toBe(422);
    expect((await json<StudioProjectCatalog>(`${started.url}/api/projects`))).toMatchObject({ activeProjectId: openedB.project.id });
    expect((await json<StudioProjectCatalog>(`${started.url}/api/projects`)).projects.find((project) => project.id === openedA.project.id)).toMatchObject({ availability: "unavailable" });

    await json(`${started.url}/api/projects/${openedA.project.id}`, { method: "DELETE" });
    expect((await json<StudioProjectCatalog>(`${started.url}/api/projects`)).projects.map((project) => project.id)).toEqual([openedB.project.id]);
    await json(`${started.url}/api/projects/${openedB.project.id}`, { method: "DELETE" });
    expect(await json<StudioProjectCatalog>(`${started.url}/api/projects`)).toMatchObject({ projects: [] });
    expect(await json<{ connected: boolean }>(`${started.url}/api/workspace`)).toMatchObject({ connected: false });
  });
});

async function waitForStage(serverUrl: string, stage: "discovering"): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const catalog = await json<StudioProjectCatalog>(`${serverUrl}/api/projects`);
    if (catalog.stage === stage) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`Project catalog did not reach ${stage}.`);
}
