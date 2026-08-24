import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexArtifactDirectory } from "../src/server/artifact-catalog.js";
import { startHarnessStudioServer, type HarnessStudioServerHandle } from "../src/server/server.js";

const temporary: string[] = [];
let started: HarnessStudioServerHandle | undefined;

afterEach(async () => {
  await started?.close();
  started = undefined;
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

async function startWithArtifacts(artifactDirectory: string): Promise<HarnessStudioServerHandle> {
  const appDir = await temporaryDirectory("studio-app-");
  const artifactProviderStateRoot = await temporaryDirectory("studio-provider-state-");
  const walnutCacheRoot = await temporaryDirectory("studio-walnut-cache-");
  await writeFile(join(appDir, "index.html"), "<!doctype html><title>studio fixture</title>\n", "utf8");
  started = await startHarnessStudioServer({ appDir, artifactDirectory, artifactProviderStateRoot, walnutCacheRoot });
  return started;
}

describe("artifact read boundary", () => {
  it("answers artifact reads for Studio itself and refuses another origin", async () => {
    const artifactDirectory = await temporaryDirectory("studio-artifacts-");
    await writeFile(join(artifactDirectory, "notes.txt"), "run output\n", "utf8");
    const server = await startWithArtifacts(artifactDirectory);

    const catalogResponse = await fetch(`${server.url}/api/artifacts`);
    expect(catalogResponse.status).toBe(200);
    const catalog = await catalogResponse.json() as { artifacts: Array<{ revision: { content: { uri: string } } }> };
    const contentUri = catalog.artifacts[0]!.revision.content.uri;

    const content = await fetch(`${server.url}${contentUri}`);
    expect(content.status).toBe(200);
    // A permissive CORS header would hand a run's outputs to any page the
    // operator happens to have open, loopback binding notwithstanding.
    expect(content.headers.get("access-control-allow-origin")).toBeNull();
    expect(await content.text()).toBe("run output\n");

    const hostile = { origin: "https://attacker.invalid" };
    expect((await fetch(`${server.url}/api/artifacts`, { headers: hostile })).status).toBe(403);
    expect((await fetch(`${server.url}${contentUri}`, { headers: hostile })).status).toBe(403);
    expect((await fetch(`${server.url}/api/artifacts/events`, { headers: hostile })).status).toBe(403);
    expect((await fetch(`${server.url}/api/artifact-providers`, { headers: hostile })).status).toBe(403);

    const providers = await (await fetch(`${server.url}/api/artifact-providers`)).json() as { kind: string; providers: unknown[] };
    expect(providers.kind).toBe("HarnessStudioArtifactProviderStatusV1");
    expect(providers.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "chatgpt-walnut", status: "unavailable", contributions: [] }),
    ]));
    expect(JSON.stringify(providers)).not.toContain("studio-provider-state-");
    expect(JSON.stringify(providers)).not.toContain("studio-walnut-cache-");
  });

  it("keeps a code artifact's own subdirectory out of the declined list", async () => {
    const artifactDirectory = await temporaryDirectory("studio-artifacts-");
    await mkdir(join(artifactDirectory, "parts"), { recursive: true });
    await writeFile(join(artifactDirectory, "parts", "label.tsx"), "export const Label = () => <span>part</span>;\n", "utf8");
    await writeFile(join(artifactDirectory, "card.tsx"), 'import { Label } from "./parts/label.tsx";\nexport default () => <Label />;\n', "utf8");

    const index = await indexArtifactDirectory(artifactDirectory, { includeDigests: true });
    expect(index.entries.map((entry) => entry.label)).toEqual(["card.tsx"]);
    expect(index.omitted).toEqual([]);
  });
});
