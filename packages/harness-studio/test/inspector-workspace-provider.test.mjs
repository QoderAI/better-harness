import { describe, expect, it, vi } from "vitest";

import { createInspectorWorkspaceSessionProvider } from "../scripts/inspector-workspace-provider.mjs";

describe("Inspector workspace provider", () => {
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
        promptCount: 1,
        assistantMessageCount: 1,
        toolCallCount: 2,
        toolActivity: {
          calls: [
            { id: "A1", family: "inspect", actionLabel: "Read files", toolName: "Read", status: "observed", filePath: "README.md" },
            { id: "A2", family: "deliver", actionLabel: "Deliver outputs", toolName: "Write", status: "observed", filePaths: ["outputs/report.md", "outputs/diagram.svg"] },
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
        expect.objectContaining({ name: "Write", resource: "outputs/report.md" }),
        expect.objectContaining({ name: "Write", resource: "outputs/diagram.svg" }),
      ] }),
      expect.objectContaining({ kind: "response", summary: "Workspace reviewed." }),
    ]));
    expect(JSON.stringify(result)).not.toContain("/private/repository");
  });
});
