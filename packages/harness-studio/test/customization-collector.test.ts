import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentCustomizationCollector } from "../src/server/customization-collector.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; workspace: string; skill: string; pluginManifest: string; mcpConfig: string }> {
  const root = await mkdtemp(join(tmpdir(), "studio-customization-"));
  tempDirs.push(root);
  const workspace = join(root, "workspace");
  const skill = join(workspace, ".agents", "skills", "review", "SKILL.md");
  const pluginManifest = join(root, "host", "plugins", "review", ".codex-plugin", "plugin.json");
  const mcpConfig = join(root, "host", "mcp.json");
  await mkdir(join(skill, ".."), { recursive: true });
  await mkdir(join(pluginManifest, ".."), { recursive: true });
  await writeFile(skill, "---\nname: review\ndescription: Review changes.\n---\n", "utf8");
  await writeFile(pluginManifest, "{}\n", "utf8");
  await writeFile(mcpConfig, "{}\n", "utf8");
  return { root, workspace, skill, pluginManifest, mcpConfig };
}

describe("Studio customization collector", () => {
  it("does no work until Analyze and keeps partial Host results", async () => {
    const files = await fixture();
    const calls: string[] = [];
    const collector = createAgentCustomizationCollector({
      now: () => new Date("2026-08-22T09:00:00.000Z"),
      collectInventory: async ({ provider }) => {
        calls.push(provider);
        if (provider === "claude") throw new Error(`private failure at ${files.root}`);
        const sharedSkill = {
          id: `${provider}:project:review`,
          kind: "skill",
          scope: "project",
          name: "review",
          description: "Review changes.",
          filePath: files.skill,
          sourceLabel: "fixture/repository",
          evidence: { path: files.skill },
        };
        if (provider === "codex") {
          return {
            provider,
            plugins: [{
              id: "review-plugin",
              name: "review-plugin",
              displayName: "Review Plugin",
              version: "1.0.0",
              installSource: "user",
              enabled: true,
              rootPath: join(files.pluginManifest, "..", ".."),
              evidence: { path: files.pluginManifest },
            }],
            manage: {
              skills: [sharedSkill], rules: [], commands: [], subagents: [], hooks: [], mcps: [],
            },
          };
        }
        return {
          provider,
          plugins: [],
          manage: {
            skills: [sharedSkill],
            rules: [],
            commands: [],
            subagents: [],
            hooks: [{
              id: "project:hook:private",
              kind: "hook",
              scope: "project",
              name: "Guard tool",
              step: "PreToolUse",
              handlerType: "command",
              command: "node /private/hooks/guard.mjs --token fixture-secret",
              commandDisplay: "node guard.mjs",
              configurationDigest: "sha256:safe",
              filePath: join(files.workspace, ".qoder", "settings.json"),
              evidence: { path: join(files.workspace, ".qoder", "settings.json") },
            }],
            mcps: [{
              id: "project:mcp:schedule",
              kind: "mcp",
              scope: "project",
              name: "schedule",
              command: "npx",
              args: ["schedule-mcp", "--token", "fixture-secret"],
              envKeys: ["API_TOKEN"],
              directSecretEnvKeys: ["API_TOKEN"],
              enabled: true,
              toolCount: 1,
              toolNames: ["list_events"],
              resourceCount: 0,
              statusGroup: "connected",
              filePath: files.mcpConfig,
              evidence: { path: files.mcpConfig },
              runtimeEvidence: { path: join(files.root, "cache", "SERVER_METADATA.json") },
            }],
          },
        };
      },
    });

    expect(calls).toEqual([]);
    const result = await collector.analyze(files.workspace);

    expect(calls).toEqual(["codex", "claude", "qoder"]);
    expect(result.catalog.hosts).toEqual([
      { id: "claude", label: "Claude", status: "error" },
      { id: "codex", label: "Codex", status: "ok" },
      { id: "qoder", label: "Qoder", status: "ok" },
    ]);
    const skills = result.catalog.definitions.filter((definition) => definition.kind === "agent-skill");
    expect(skills).toHaveLength(1);
    expect(result.catalog.exposures.filter((exposure) => exposure.definitionId === skills[0]!.id).map(({ hostId }) => hostId).sort())
      .toEqual(["codex", "qoder"]);
    expect(result.catalog.packages).toHaveLength(1);
    expect(result.catalog.installations).toHaveLength(1);
    expect(result.catalog.registrations).toHaveLength(1);
    expect(result.catalog.registrations[0]).toMatchObject({ alias: "schedule", enablement: "enabled" });
    expect(result.catalog.runtimeObservations.find((item) => item.kind === "mcp-server-discovery")).toMatchObject({
      evidenceSource: "host-cache",
      freshness: "unknown",
      status: "partial",
      catalog: [{ kind: "mcp-tool", name: "list_events" }],
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(files.root);
    expect(serialized).not.toContain("fixture-secret");
    expect(serialized).not.toContain("/private/hooks");
    expect(serialized).not.toContain("schedule-mcp");
    expect(result.catalog).not.toHaveProperty("relationships");
    expect(result.catalog.definitions.every((definition) => [
      "instruction",
      "agent-skill",
      "prompt-command",
      "agent-definition",
      "hook",
      "mcp-server-definition",
    ].includes(definition.kind))).toBe(true);
    expect(result.catalog.runtimeObservations.every((observation) =>
      observation.kind === "host-collection" || observation.kind === "mcp-server-discovery")).toBe(true);
    expect(serialized).toContain("Workspace/.agents/skills/review/SKILL.md");
    expect(serialized).toContain("Claude customization collection failed");
    expect(serialized).toContain("collector runtime failed unexpectedly");
    expect(serialized).toContain("Analyze again to retry");
    expect(serialized).not.toContain("private failure");
  });
});
