import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild-wasm";
import { describe, expect, it, vi } from "vitest";

import { createInspectorWorkspaceSessionProvider } from "../scripts/inspector-workspace-provider.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("Inspector workspace provider", () => {
  /**
   * The desktop shell reaches Session discovery through an esbuild bundle of
   * this provider, not through these source files. A host-adapter registry that
   * loads its analyzers with a computed specifier survives a source run and
   * fails only once bundled, because the bundler cannot follow the edge and the
   * output resolves `./platforms/<host>.mjs` against its own directory — which
   * reported every provider as `error` and left the workbench with no Sessions.
   *
   * So this bundles the registry the way the shipped runtime does and loads the
   * result, rather than asserting anything about how the source is written.
   */
  it("loads every supported host adapter from a bundled copy of the registry", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "harness-adapter-bundle-"));
    const outfile = join(outputDir, "registry.mjs");
    try {
      await build({
        stdin: {
          contents: "export { SUPPORTED_SESSION_PROVIDERS, createAnalyzer } from \"./scripts/session-analysis/analyzer.mjs\";\n",
          resolveDir: repositoryRoot,
          sourcefile: "adapter-registry-probe.mjs",
        },
        outfile,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node22",
        logLevel: "silent",
        banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
      });

      const bundled = await import(pathToFileURL(outfile).href);
      const loaded = await Promise.all(bundled.SUPPORTED_SESSION_PROVIDERS
        .map(async (platform) => [platform, await bundled.createAnalyzer(platform)]));

      expect(loaded.length).toBeGreaterThan(1);
      for (const [platform, analyzer] of loaded) {
        expect(analyzer, `bundled ${platform} adapter`).toBeTypeOf("object");
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps Session discovery available for a Project without Git history", async () => {
    const collect = vi.fn(async () => ({ providers: [], sessions: [] }));
    const collectCommits = vi.fn();
    const collectCheckpoints = vi.fn();
    const provider = createInspectorWorkspaceSessionProvider({
      collect,
      collectCommits,
      collectCheckpoints,
      repoRootFor: () => { throw new Error("not a Git repository"); },
      platforms: ["codex"],
    });

    const result = await provider.discover("/private/plain-project");

    expect(collect).toHaveBeenCalledWith(expect.objectContaining({
      workspace: "/private/plain-project",
      repoRoot: "/private/plain-project",
    }));
    expect(collectCommits).not.toHaveBeenCalled();
    expect(collectCheckpoints).not.toHaveBeenCalled();
    expect(result).toMatchObject({ label: "plain-project", sessions: [] });
    expect(result.inspectorReport.diagnostics).toContain("Git history is unavailable for this Project; Session evidence remains available.");
  });

  it("keeps Git history when Entire checkpoint discovery fails", async () => {
    const collect = vi.fn(async () => ({ providers: [], sessions: [] }));
    const provider = createInspectorWorkspaceSessionProvider({
      collect,
      collectCommits: vi.fn(() => ({
        repoRoot: "/private/repository",
        commits: [{
          hash: "0123456789abcdef",
          shortHash: "0123456",
          subject: "retain history",
          authorName: "Developer",
          authoredAt: "2026-08-20T09:06:00.000Z",
          committedAt: "2026-08-20T09:06:00.000Z",
          files: [],
          sessionTrailers: [],
          sessionLinks: [],
        }],
      })),
      collectCheckpoints: vi.fn(() => { throw new Error("checkpoint unavailable"); }),
      repoRootFor: () => "/private/repository",
      platforms: ["codex"],
    });

    const result = await provider.discover("/private/repository");

    expect(result.inspectorReport.commits).toEqual([
      expect.objectContaining({ shortHash: "0123456", subject: "retain history" }),
    ]);
    expect(result.inspectorReport.diagnostics).toContain("Entire checkpoint evidence is unavailable; Git history remains available.");
    expect(result.inspectorReport.diagnostics).not.toContain("Git history is unavailable for this Project; Session evidence remains available.");
  });

  it("reuses the injected multi-provider collector and projects privacy-safe Session evidence", async () => {
    const collect = vi.fn(async () => ({
      providers: [
        { platform: "qoder", status: "ok", discovered: 1, included: 1 },
        { platform: "codex", status: "no-evidence", discovered: 0, included: 0 },
      ],
      sessions: [{
        sessionId: "session-123",
        platform: "qoder",
        firstSeen: "2026-08-20T09:00:00.000Z",
        lastSeen: "2026-08-20T09:05:00.000Z",
        prompts: [{ text: "Review the workspace", timestamp: "2026-08-20T09:00:00.000Z" }],
        models: ["fixture-model"],
        tokenUsage: { inputTokens: 100, outputTokens: 0 },
        promptCount: 1,
        assistantMessageCount: 1,
        toolCallCount: 2,
        toolActivity: {
          calls: [
            { id: "A1", family: "inspect", actionLabel: "Read files", toolName: "Read", status: "observed", filePath: "README.md" },
            { id: "A2", family: "deliver", actionLabel: "Deliver outputs", toolName: "Write", status: "observed", filePaths: ["outputs/report.md", "outputs/diagram.svg"], detail: '{"command":"run","api_key":"confidential"}' , output: "Wrote two files", durationMs: 15 },
          ],
        },
        dialogue: { turns: [{ response: "Workspace reviewed." }] },
      }],
    }));
    const provider = createInspectorWorkspaceSessionProvider({
      collect,
      collectCommits: vi.fn(() => ({
        repoRoot: "/private/repository",
        commits: [{
          hash: "0123456789abcdef",
          shortHash: "0123456",
          subject: "fix parser",
          authorName: "Developer",
          authoredAt: "2026-08-20T09:06:00.000Z",
          committedAt: "2026-08-20T09:06:00.000Z",
          files: [{ path: "src/parser.ts", added: 4, removed: 1 }],
          sessionTrailers: [],
          sessionLinks: [],
        }],
      })),
      collectCheckpoints: vi.fn(() => ({ checkpoints: [], unresolved: [] })),
      repoRootFor: () => "/private/repository",
      platforms: ["qoder", "codex"],
    });

    const result = await provider.discover("/private/repository/packages/app");

    expect(collect).toHaveBeenCalledWith(expect.objectContaining({
      workspace: "/private/repository/packages/app",
      repoRoot: "/private/repository",
      platforms: ["qoder", "codex"],
      includeToolTrace: true,
      includeDialogue: true,
    }));
    expect(result).toMatchObject({
      label: "repository",
      inspectorReport: {
        kind: "HarnessInspectorReportV1",
        workspace: { name: "repository" },
        providers: [
          { platform: "qoder", sessionCount: 1 },
          { platform: "codex", sessionCount: 0 },
        ],
        sessions: [{ sessionId: "session-123", platform: "qoder" }],
        commits: [{ shortHash: "0123456", subject: "fix parser" }],
        days: [{ date: "2026-08-20", sessionIds: ["session-123"] }],
      },
      providers: [{ provider: "qoder", status: "ok" }, { provider: "codex", status: "no-evidence" }],
      sessions: [{
        summary: { id: "qoder:session-123", prompt: "Review the workspace", provider: "qoder", status: "observed", toolCallCount: 2 },
        debugger: { agent: "qoder", protocol: "Inspector normalized local evidence" },
      }],
    });
    expect(result.sessions[0].debugger.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "prompt", summary: "Review the workspace" }),
      expect.objectContaining({ kind: "explore", toolCalls: [expect.objectContaining({ name: "Read", resource: "README.md" })] }),
      expect.objectContaining({ kind: "change", toolCalls: [
        expect.objectContaining({ name: "Write", sourceCallId: "A2", resource: "outputs/report.md", duration: "15 ms", output: "Wrote two files" }),
        expect.objectContaining({ name: "Write", resource: "outputs/diagram.svg" }),
      ] }),
      expect.objectContaining({ kind: "response", summary: "Workspace reviewed." }),
    ]));
    expect(result.sessions[0].debugger.models).toEqual(["fixture-model"]);
    expect(result.sessions[0].debugger.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 0 });
    expect(JSON.stringify(result)).not.toContain("confidential");
    expect(JSON.stringify(result)).not.toContain("/private/repository");
  });
});
