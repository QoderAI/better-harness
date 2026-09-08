import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadStoredProjects, saveStoredProjects } from "../src/server/workspace/project-store.js";
import type { HarnessStudioState, StoredStudioProject } from "../src/server/studio-types.js";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function scratch(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(path);
  return path;
}

function project(id: string, directory: string, lastOpenedAt: string): StoredStudioProject {
  return {
    kind: "local",
    localDirectory: directory,
    descriptor: {
      id,
      label: id,
      kind: "local",
      availability: "ready",
      lastOpenedAt,
      sessionCount: 2,
      inputCount: 1,
      artifactCount: 3,
      gitEnabled: true,
      workspaceWorkbenchEnabled: false,
    },
  };
}

function stateWith(projects: StoredStudioProject[], activeProjectId?: string): HarnessStudioState {
  return {
    projects: new Map(projects.map((entry) => [entry.descriptor.id, entry])),
    ...(activeProjectId === undefined ? {} : { activeProjectId }),
  } as unknown as HarnessStudioState;
}

describe("remembered Project catalog", () => {
  it("round-trips local Projects and the Project that was active", async () => {
    const stateRoot = await scratch("project-store-");
    const first = await scratch("project-a-");
    const second = await scratch("project-b-");
    await saveStoredProjects(stateRoot, stateWith(
      [project("project_a", first, "2026-09-01T00:00:00.000Z"), project("project_b", second, "2026-09-08T00:00:00.000Z")],
      "project_b",
    ));

    const loaded = await loadStoredProjects(stateRoot);
    expect(loaded.activeProjectId).toBe("project_b");
    expect([...loaded.projects.keys()].sort()).toEqual(["project_a", "project_b"]);
    expect(loaded.projects.get("project_a")?.localDirectory).toBe(first);
    expect(loaded.projects.get("project_b")?.descriptor).toMatchObject({
      availability: "ready", sessionCount: 2, artifactCount: 3, gitEnabled: true,
    });
  });

  it("keeps a Project whose directory is gone, marked unavailable rather than dropped", async () => {
    const stateRoot = await scratch("project-store-");
    const missing = join(await scratch("project-gone-"), "removed");
    await saveStoredProjects(stateRoot, stateWith([project("project_a", missing, "2026-09-01T00:00:00.000Z")], "project_a"));

    const loaded = await loadStoredProjects(stateRoot);
    // The reader is told why a Project they remember cannot be opened, instead
    // of finding it silently absent from the switcher.
    expect(loaded.projects.get("project_a")?.descriptor.availability).toBe("unavailable");
    // An unreachable Project is never auto-activated.
    expect(loaded.activeProjectId).toBeUndefined();
  });

  it("never lets an unreadable catalog stop a launch", async () => {
    const stateRoot = await scratch("project-store-");
    // No file at all.
    expect((await loadStoredProjects(stateRoot)).projects.size).toBe(0);

    for (const body of ["not json", "[]", '{"version":99,"projects":[]}', '{"version":1,"projects":"x"}']) {
      await writeFile(join(stateRoot, "projects.json"), body, "utf8");
      const loaded = await loadStoredProjects(stateRoot);
      expect(loaded.projects.size, `catalog ${body} should be discarded`).toBe(0);
      expect(loaded.activeProjectId).toBeUndefined();
    }
  });

  it("discards entries that are missing a field rather than half-restoring them", async () => {
    const stateRoot = await scratch("project-store-");
    const directory = await scratch("project-ok-");
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({
      version: 1,
      projects: [
        { id: "project_ok", label: "ok", kind: "local", localDirectory: directory, lastOpenedAt: "2026-09-01T00:00:00.000Z", sessionCount: 0, inputCount: 0, artifactCount: 0, gitEnabled: false, workspaceWorkbenchEnabled: false },
        { id: "project_bad", label: "bad", kind: "local", localDirectory: directory, lastOpenedAt: "2026-09-02T00:00:00.000Z", sessionCount: -1, inputCount: 0, artifactCount: 0 },
        { id: "project_imported", label: "imported", kind: "imported", localDirectory: directory, lastOpenedAt: "2026-09-03T00:00:00.000Z", sessionCount: 0, inputCount: 0, artifactCount: 0 },
      ],
    }), "utf8");

    const loaded = await loadStoredProjects(stateRoot);
    expect([...loaded.projects.keys()]).toEqual(["project_ok"]);
  });

  it("does not remember an imported workspace, whose materialization is gone by the next run", async () => {
    const stateRoot = await scratch("project-store-");
    const directory = await scratch("project-a-");
    const imported: StoredStudioProject = {
      ...project("project_imported", directory, "2026-09-08T00:00:00.000Z"),
      kind: "imported",
    };
    await saveStoredProjects(stateRoot, stateWith([project("project_a", directory, "2026-09-01T00:00:00.000Z"), imported]));

    const written = JSON.parse(await readFile(join(stateRoot, "projects.json"), "utf8")) as { projects: { id: string }[] };
    expect(written.projects.map((entry) => entry.id)).toEqual(["project_a"]);
  });
});
