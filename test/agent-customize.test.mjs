import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectAgentCustomizeInventory,
  filterManageItems,
  groupManageItems,
  tabAvailableForScope,
} from "../scripts/agent-customize/index.mjs";
import { pluginMetadataEvidencePath } from "../scripts/agent-customize/core/items.mjs";
import { collectKimiCustomizeInventory } from "../scripts/agent-customize/providers/kimi.mjs";
import { qoderWorkspaceSlugs } from "../scripts/agent-customize/providers/qoder.mjs";
import { collectProviderInventory as collectPracticeInventory } from "../scripts/coding-agent-practices/inventory.mjs";

async function writeText(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text);
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function workspaceProjectSlug(workspace) {
  return path
    .resolve(workspace)
    .split(path.sep)
    .filter(Boolean)
    .join("-")
    .replace(/[^A-Za-z0-9._-]/gu, "-");
}

function qoderWorkspaceSlug(workspace) {
  return path.resolve(workspace).replace(/:/gu, "-").replace(/[\\/]+/gu, "-");
}

test("Qoder runtime cache slugs cover both Windows drive conventions", () => {
  assert.deepEqual(qoderWorkspaceSlugs("C:\\workspace\\project"), [
    "C--workspace-project",
    "C-workspace-project",
  ]);
});

test("plugin metadata evidence follows candidate precedence and preserves the root fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-plugin-evidence-"));

  try {
    const packageJson = path.join(root, "package.json");
    const manifest = path.join(root, ".sample-plugin", "plugin.json");
    const candidates = [[".sample-plugin", "plugin.json"], ["package.json"]];

    await writeJson(packageJson, { name: "sample" });
    assert.equal(await pluginMetadataEvidencePath(root, candidates), packageJson);

    await writeJson(manifest, { name: "sample" });
    assert.equal(await pluginMetadataEvidencePath(root, candidates), manifest);
    assert.equal(await pluginMetadataEvidencePath(root, [["missing.json"]]), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeCursorFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-"));
  const cursorHome = path.join(root, ".cursor");
  const workspace = path.join(root, "workspace", "codex");

  const hexRoot = path.join(
    cursorHome,
    "plugins",
    "cache",
    "cursor-public",
    "hex",
    "abc123",
  );
  await writeText(path.join(hexRoot, "README.md"), "# Hex\n\nHex plugin.\n");
  await writeJson(path.join(hexRoot, ".cursor-plugin", "plugin.json"), {
    id: "hex-id",
    name: "hex",
    description: "Hex plugin",
  });
  await writeText(
    path.join(hexRoot, "skills", "hex-to-canvas", "SKILL.md"),
    "---\nname: hex-to-canvas\ndescription: Create Hex canvases.\n---\n",
  );
  await writeJson(path.join(hexRoot, "mcp.json"), {
    mcpServers: {
      hex: { command: "npx", args: ["-y", "@hex/mcp"] },
    },
  });
  await writeText(path.join(hexRoot, "rules", "ensure-hex.md"), "# Ensure Hex\n");
  await writeText(path.join(hexRoot, "commands", "hex-report.md"), "Build a Hex report.\n");
  await writeText(
    path.join(hexRoot, "agents", "hex-analyst.md"),
    "---\nname: hex-analyst\n---\nYou analyze Hex notebooks.\n",
  );
  await writeJson(path.join(hexRoot, "hooks.json"), {
    hooks: {
      postToolUse: [{ label: "Hex audit", command: "echo hex" }],
    },
  });

  const paperRoot = path.join(
    cursorHome,
    "plugins",
    "cache",
    "cursor-public",
    "paper-desktop",
    "def456",
  );
  await writeJson(path.join(paperRoot, "manifest.json"), {
    id: "paper-id",
    name: "paper-desktop",
    displayName: "Paper",
    description: "Paper design plugin",
  });

  const metaRoot = path.join(
    cursorHome,
    "plugins",
    "cache",
    "cursor-public",
    "meta-quest-agentic-tools",
    "ghi789",
  );
  await writeJson(path.join(metaRoot, ".cursor-plugin", "plugin.json"), {
    id: "meta-id",
    name: "meta-quest-agentic-tools",
    description: "Meta Quest project plugin",
  });
  await writeText(path.join(metaRoot, "README.md"), "# meta-quest/agentic-tools\n");

  await writeJson(path.join(cursorHome, "mcp.json"), {
    mcpServers: {
      userLinear: { command: "npx", args: ["-y", "@linear/mcp"] },
    },
  });
  await writeJson(path.join(workspace, ".cursor", "mcp.json"), {
    mcpServers: {
      workspaceDocs: { url: "https://example.invalid/mcp" },
    },
  });
  await writeText(path.join(workspace, ".cursor", "rules", "always.md"), "# Always Cursor\n");
  await writeText(path.join(workspace, "AGENTS.md"), "# Project Agent Rules\n");
  await writeText(path.join(workspace, "DESIGN.md"), "# Product Design Contract\n");
  await writeText(
    path.join(workspace, ".codex", "skills", "codex-bug", "SKILL.md"),
    "---\nname: internal-codex-bug\ndescription: Diagnose Codex bugs.\n---\n",
  );
  await writeText(
    path.join(workspace, ".git", "config"),
    "[remote \"origin\"]\n\turl = https://github.com/openai/codex.git\n",
  );
  await writeText(
    path.join(cursorHome, "skills", "sessions-diagnostics", "SKILL.md"),
    "---\nname: sessions-diagnostics\ndescription: Inspect sessions.\n---\n",
  );
  await writeText(
    path.join(cursorHome, "agents", "reviewer.md"),
    "---\nname: reviewer\n---\nReview code.\n",
  );
  await writeText(path.join(cursorHome, "commands", "summarize.md"), "Summarize.\n");
  await writeText(path.join(cursorHome, "rules", "tone.mdc"), "Be concise.\n");
  await writeJson(path.join(cursorHome, "hooks.json"), {
    hooks: {
      userPromptSubmit: [{ label: "Guard prompt", command: "echo guard" }],
    },
  });

  return { root, cursorHome, workspace };
}

async function makeQoderFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bhq-"));
  const qoderHome = path.join(root, "q");
  const sharedClientCacheRoot = path.join(root, "s");
  const workspace = path.join(root, "w");

  const betterHarnessRoot = path.join(
    qoderHome,
    "plugins",
    "cache",
    "local",
    "better-harness-plugin",
    "0.1.0",
  );
  await writeJson(path.join(betterHarnessRoot, ".qoder-plugin", "plugin.json"), {
    name: "better-harness-plugin",
    displayName: "Better Harness",
    version: "0.1.0",
    description: "Build an AI-ready engineering system.",
    author: { name: "Qoder" },
    skills: "./skills/",
    commands: {
      "better-harness-check": {
        source: "./commands/check.md",
        description: "Run a Better Harness check.",
      },
    },
    mcpServers: "./.mcp.json",
    hooks: "./.qoder-plugin/qoder-hooks.json",
  });
  await writeText(
    path.join(betterHarnessRoot, "skills", "better-harness", "SKILL.md"),
    "---\nname: harness\ndescription: Analyze AI readiness.\n---\n",
  );
  await writeText(path.join(betterHarnessRoot, "commands", "check.md"), "# Better Harness Check\n");
  await writeJson(path.join(betterHarnessRoot, ".mcp.json"), {
    mcpServers: {
      "better-harness": { command: "node", args: ["scripts/better-harness.mjs"] },
    },
  });
  await writeJson(path.join(betterHarnessRoot, ".qoder-plugin", "qoder-hooks.json"), {
    hooks: {
      PostToolUse: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "node hooks/better-harness.mjs" }],
        },
      ],
    },
  });

  const designRoot = path.join(
    qoderHome,
    "plugins",
    "cache",
    "qoder-marketplace",
    "design-review",
    "0.1.0",
  );
  await writeJson(path.join(designRoot, ".qoder-plugin", "plugin.json"), {
    name: "design-review",
    displayName: "Design Review",
    version: "0.1.0",
    description: "Review frontend design contracts.",
    interface: { displayName: "Design" },
    skills: "./skills/",
  });
  await writeText(
    path.join(designRoot, "skills", "design-qa", "SKILL.md"),
    "---\nname: design-qa\ndescription: Review design quality.\n---\n",
  );

  const cachedOnlyRoot = path.join(
    qoderHome,
    "plugins",
    "cache",
    "qoder-marketplace",
    "apollo",
    "1.0.0",
  );
  await writeJson(path.join(cachedOnlyRoot, ".qoder-plugin", "plugin.json"), {
    name: "apollo",
    displayName: "Apollo",
  });

  await writeJson(path.join(qoderHome, "plugins", "installed_plugins.json"), {
    plugins: {
      "design-review@qoder-marketplace": {
        installPath: designRoot,
        version: "0.1.0",
        scope: "user",
      },
      "better-harness-plugin@local": {
        installPath: betterHarnessRoot,
        version: "0.1.0",
        scope: "user",
      },
    },
  });
  await writeJson(path.join(qoderHome, "plugins", "installed_plugins_v2.json"), {
    version: 2,
    plugins: {
      "better-harness-plugin@local": [
        {
          scope: "user",
          installPath: betterHarnessRoot,
          version: "0.1.0",
          installedAt: "2026-06-23T07:15:07.153Z",
        },
        {
          scope: "local",
          installPath: betterHarnessRoot,
          version: "0.1.0",
          projectPath: workspace,
          installedAt: "2026-06-23T07:15:19.937Z",
        },
      ],
    },
  });

  await writeJson(path.join(qoderHome, "settings.json"), {
    enabledPlugins: {
      "design-review@qoder-marketplace": true,
      "better-harness-plugin@local": true,
      "apollo@qoder-marketplace": true,
    },
    hooks: {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "bash ~/.qoder/hooks/guard-tool.sh" }],
        },
      ],
    },
  });
  await writeJson(path.join(workspace, ".qoder", "settings.json"), {
    hooks: {
      Stop: [
        {
          hooks: [{
            type: "command",
            command: "node hooks/check-stop.mjs",
            timeout: 1500,
            if: 'env.REVIEW_TOKEN == "private-value"',
            async: true,
          }],
        },
      ],
    },
  });
  await writeText(path.join(workspace, ".qoder", "rules", "always.md"), "# Always\n");
  await writeText(path.join(workspace, "AGENTS.md"), "# Project Agent Rules\n");
  await writeText(path.join(workspace, "DESIGN.md"), "# Product Design Contract\n");
  await writeText(
    path.join(workspace, ".agents", "skills", "release-review", "SKILL.md"),
    "---\nname: release-review\ndescription: Review release readiness.\n---\n",
  );
  await writeJson(path.join(qoderHome, "shared_client", "mcp.json"), {
    mcpServers: {
      legacy: { command: "npx", args: ["legacy-mcp"] },
    },
  });
  await writeJson(path.join(sharedClientCacheRoot, "mcp.json"), {
    mcpServers: {
      chrome: { command: "npx", args: ["chrome-devtools-mcp"] },
      postgres: { command: "npx", args: ["postgres-mcp"] },
    },
  });
  await writeJson(path.join(sharedClientCacheRoot, "extension", "local", "mcp.json"), {
    mcpServers: {
      chrome: { command: "npx", args: ["chrome-devtools-mcp"] },
    },
  });
  await writeJson(path.join(sharedClientCacheRoot, "mcps", "chrome", "SERVER_METADATA.json"), {
    name: "chrome",
    source: "user",
    toolCount: 29,
  });
  await writeJson(path.join(sharedClientCacheRoot, "mcps", "chrome", "tools", "open-page.json"), {
    name: "open_page",
  });
  await writeJson(path.join(workspace, ".qoder", "mcp.json"), {
    mcpServers: {
      schedule: { command: "npx", args: ["schedule-mcp"] },
    },
  });
  await writeJson(
    path.join(
      sharedClientCacheRoot,
      "projects",
      qoderWorkspaceSlug(workspace),
      "mcps",
      "schedule",
      "SERVER_METADATA.json",
    ),
    {
      name: "schedule",
      source: "user",
      toolCount: 1,
    },
  );
  await writeJson(
    path.join(
      sharedClientCacheRoot,
      "projects",
      qoderWorkspaceSlug(workspace),
      "mcps",
      "schedule",
      "tools",
      "list-events.json",
    ),
    { name: "list_events" },
  );

  return { root, qoderHome, sharedClientCacheRoot, workspace };
}

async function makeCodexFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-codex-"));
  const codexHome = path.join(root, ".codex");
  const codexAppPath = path.join(root, "Applications", "Codex.app");
  const workspace = path.join(root, "workspace", "better-harness");

  const dataPluginName = "data-analytics";
  const dataPluginParent = path.join(codexHome, "plugins", "cache", "openai-curated-remote", dataPluginName);
  const dataPluginRoot = path.join(dataPluginParent, "0.1.0");
  await writeJson(path.join(dataPluginParent, ".codex-remote-plugin-install.json"), {
    schema_version: 1,
    remote_plugin_id: "plugin_data_123",
  });
  await writeJson(path.join(dataPluginRoot, ".codex-plugin", "plugin.json"), {
    name: dataPluginName,
    version: "0.1.0",
    description: "Analyze data.",
    author: { name: "OpenAI" },
    interface: {
      displayName: "Data Analytics",
      shortDescription: "Analyze data with Codex.",
      developerName: "OpenAI",
    },
    skills: "./skills/",
    commands: {
      "build-report": {
        source: "./commands/build-report.md",
        description: "Build a report.",
      },
    },
    mcpServers: "./.mcp.json",
  });
  await writeText(
    path.join(dataPluginRoot, "skills", "build-dashboard", "SKILL.md"),
    "---\nname: build-dashboard\ndescription: Build dashboards.\n---\n",
  );
  await writeText(path.join(dataPluginRoot, "commands", "build-report.md"), "# Build Report\n");
  await writeJson(path.join(dataPluginRoot, ".mcp.json"), {
    mcpServers: {
      dataAnalytics: { command: "node", args: ["mcp/server.cjs"] },
    },
  });
  await writeJson(path.join(dataPluginRoot, "hooks.json"), {
    hooks: {
      PostToolUse: [
        {
          matcher: "Write",
          hooks: [{ type: "command", command: "node hooks/audit-data.mjs" }],
        },
      ],
    },
  });

  const browserPluginRoot = path.join(
    codexHome,
    "plugins",
    "cache",
    "openai-bundled",
    "browser",
    "26.1.0",
  );
  await writeJson(path.join(browserPluginRoot, ".codex-plugin", "plugin.json"), {
    name: "browser",
    version: "26.1.0",
    description: "Control the in-app browser.",
    author: { name: "OpenAI" },
    interface: {
      displayName: "Browser",
      shortDescription: "Control Browser.",
    },
    skills: "./skills/",
  });
  await writeText(
    path.join(browserPluginRoot, "skills", "control-in-app-browser", "SKILL.md"),
    "---\nname: control-in-app-browser\ndescription: Control browser.\n---\n",
  );

  const cacheOnlyRoot = path.join(
    codexHome,
    "plugins",
    "cache",
    "openai-curated-remote",
    "apollo",
    "1.0.0",
  );
  await writeJson(path.join(cacheOnlyRoot, ".codex-plugin", "plugin.json"), {
    name: "apollo",
    interface: { displayName: "Apollo" },
  });

  const staleCuratedRoot = path.join(
    codexHome,
    "plugins",
    "cache",
    "openai-curated",
    dataPluginName,
    "3c06cb2e",
  );
  await writeJson(path.join(staleCuratedRoot, ".codex-plugin", "plugin.json"), {
    name: dataPluginName,
    version: "3c06cb2e",
    interface: { displayName: "Data Analytics" },
  });

  await writeText(
    path.join(codexHome, "skills", "local-review", "SKILL.md"),
    "---\nname: local-review\ndescription: Review locally.\n---\n",
  );
  await writeJson(path.join(codexHome, "mcp.json"), {
    mcpServers: {
      localMcp: { command: "node", args: ["server.mjs"] },
    },
  });
  await writeJson(path.join(codexHome, "hooks.json"), {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [{ type: "command", command: "~/.codex/hooks/guard-prompt.sh" }],
        },
      ],
    },
  });

  await writeText(
    path.join(workspace, ".codex", "skills", "codex-workflow", "SKILL.md"),
    "---\nname: codex-workflow\ndescription: Codex workflow.\n---\n",
  );
  await writeText(
    path.join(workspace, ".agents", "skills", "agent-workflow", "SKILL.md"),
    "---\nname: agent-workflow\ndescription: Agent workflow.\n---\n",
  );
  await writeText(path.join(workspace, ".codex", "rules", "always.md"), "# Always Codex\n");
  await writeText(path.join(workspace, "AGENTS.md"), "# Project Agent Rules\n");
  await writeText(path.join(workspace, "DESIGN.md"), "# Product Design Contract\n");
  await writeJson(path.join(workspace, ".codex", "hooks.json"), {
    hooks: {
      Stop: [
        {
          hooks: [{ type: "command", command: "node hooks/check-stop.mjs" }],
        },
      ],
    },
  });
  await writeText(
    path.join(workspace, ".git", "config"),
    "[remote \"origin\"]\n\turl = https://github.com/example/better-harness.git\n",
  );
  await mkdir(codexAppPath, { recursive: true });

  return { root, codexHome, codexAppPath, workspace };
}

async function makeClaudeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-claude-"));
  const claudeHome = path.join(root, ".claude");
  const claudeStatePath = path.join(root, ".claude.json");
  const workspace = path.join(root, "workspace", "better-harness");
  const enabledPluginId = "delivery@fixture-marketplace";
  const disabledPluginId = "disabled@fixture-marketplace";
  const enabledPluginRoot = path.join(claudeHome, "plugins", "cache", "fixture-marketplace", "delivery", "1.0.0");
  const disabledPluginRoot = path.join(claudeHome, "plugins", "cache", "fixture-marketplace", "disabled", "1.0.0");

  await writeText(
    path.join(claudeHome, "skills", "user-review", "SKILL.md"),
    "---\nname: user-review\ndescription: Review a user-scoped change.\n---\n",
  );
  await writeText(path.join(claudeHome, "agents", "user-reviewer.md"), "---\nname: user-reviewer\ndescription: Review code.\ntools: Read\n---\n");
  await writeText(path.join(claudeHome, "commands", "user-check.md"), "# User Check\n");
  await writeText(path.join(claudeHome, "CLAUDE.md"), "# Claude User Instructions\n");
  await writeText(path.join(claudeHome, "rules", "user-rule.md"), "# User Rule\n");
  await writeJson(path.join(claudeHome, "settings.json"), {
    enabledPlugins: {
      [disabledPluginId]: false,
    },
    hooks: {
      PreToolUse: [{
        matcher: "Write",
        hooks: [{
          type: "command",
          command: "bash \"$CLAUDE_PROJECT_DIR/hooks/user-audit.sh\" --token fixture-hook-secret",
          timeout: 3,
          async: true,
        }],
      }],
    },
  });

  await writeText(
    path.join(workspace, ".claude", "skills", "project-review", "SKILL.md"),
    "---\nname: project-review\ndescription: Review the selected project.\n---\n",
  );
  await writeText(path.join(workspace, ".claude", "agents", "project-reviewer.md"), "---\nname: project-reviewer\ndescription: Review this project.\ntools: Read\n---\n");
  await writeText(path.join(workspace, ".claude", "commands", "project-check.md"), "# Project Check\n");
  await writeText(path.join(workspace, "CLAUDE.md"), "# Claude Project Instructions\n");
  await writeText(path.join(workspace, ".claude", "CLAUDE.md"), "# Alternate Claude Project Instructions\n");
  await writeText(path.join(workspace, "CLAUDE.local.md"), "# Claude Local Instructions\n");
  await writeText(path.join(workspace, ".claude", "rules", "security.md"), "# Security Rule\n");
  await writeText(path.join(workspace, "AGENTS.md"), "# Not A Native Claude Instruction\n");
  await writeText(path.join(workspace, "hooks", "user-audit.sh"), "#!/bin/sh\nexit 0\n");
  await writeJson(path.join(workspace, ".claude", "settings.json"), {
    enabledPlugins: { [enabledPluginId]: true },
    hooks: {
      SessionStart: [{ hooks: [{ type: "prompt", prompt: "fixture-prompt-secret", timeout: 2 }] }],
    },
  });
  await writeJson(path.join(workspace, ".claude", "settings.local.json"), {
    hooks: {
      Stop: [{ hooks: [{ type: "agent", prompt: "fixture-agent-secret", timeout: 5 }] }],
    },
  });
  await writeJson(path.join(workspace, ".mcp.json"), {
    mcpServers: {
      projectRemote: {
        type: "http",
        url: "https://project-user:project-password@example.invalid/project?token=fixture-project-secret",
        env: { PROJECT_API_TOKEN: "fixture-project-secret" },
      },
    },
  });

  await writeJson(path.join(enabledPluginRoot, ".claude-plugin", "plugin.json"), {
    name: "delivery",
    displayName: "Delivery",
    version: "1.0.0",
    description: "Delivery workflow plugin.",
    skills: ["./extra-skills"],
    commands: ["./custom/commands"],
    agents: "./custom/agents",
    hooks: {
      PostToolUse: [{
        matcher: "Write",
        hooks: [{ type: "command", command: "node $CLAUDE_PLUGIN_ROOT/hooks/plugin-audit.mjs", timeout: 4 }],
      }],
    },
    mcpServers: {
      pluginRemote: { type: "http", url: "https://example.invalid/plugin?token=fixture-plugin-secret" },
    },
  });
  await writeText(
    path.join(enabledPluginRoot, "skills", "default-delivery", "SKILL.md"),
    "---\nname: default-delivery\ndescription: Run the default delivery workflow.\n---\n",
  );
  await writeText(
    path.join(enabledPluginRoot, "extra-skills", "release-delivery", "SKILL.md"),
    "---\nname: release-delivery\ndescription: Run a release delivery workflow.\n---\n",
  );
  await writeText(path.join(enabledPluginRoot, "commands", "ignored-default.md"), "# Ignored Default\n");
  await writeText(path.join(enabledPluginRoot, "custom", "commands", "ship.md"), "# Ship\n");
  await writeText(path.join(enabledPluginRoot, "custom", "agents", "release-reviewer.md"), "---\nname: release-reviewer\ndescription: Review a release.\ntools: Read\n---\n");
  await writeText(path.join(enabledPluginRoot, "hooks", "plugin-audit.mjs"), "process.exit(0);\n");

  await writeJson(path.join(disabledPluginRoot, ".claude-plugin", "plugin.json"), {
    name: "disabled",
    displayName: "Disabled Plugin",
  });
  await writeText(
    path.join(disabledPluginRoot, "skills", "disabled-skill", "SKILL.md"),
    "---\nname: disabled-skill\ndescription: This disabled Skill must not enter public surfaces.\n---\n",
  );

  await writeJson(path.join(claudeHome, "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      [enabledPluginId]: [{
        scope: "project",
        projectPath: workspace,
        installPath: enabledPluginRoot,
        version: "1.0.0",
      }],
      [disabledPluginId]: [{
        scope: "user",
        installPath: disabledPluginRoot,
        version: "1.0.0",
      }],
    },
  });
  await writeJson(claudeStatePath, {
    oauthAccount: { accessToken: "fixture-oauth-secret" },
    mcpServers: {
      userNode: {
        command: "node",
        args: ["server.mjs", "--token", "fixture-user-mcp-secret"],
        env: { API_TOKEN: "fixture-user-mcp-secret" },
      },
    },
    projects: {
      [workspace]: {
        mcpServers: {
          localDocs: { type: "http", url: "https://example.invalid/local?key=fixture-local-secret" },
        },
      },
      [path.join(root, "other-workspace")]: {
        mcpServers: { unrelated: { command: "fixture-unrelated-secret" } },
      },
    },
  });

  return { root, claudeHome, claudeStatePath, workspace, enabledPluginId, disabledPluginId };
}

async function makeQwenFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-qwen-"));
  const qwenHome = path.join(root, ".qwen");
  const workspace = path.join(root, "workspace", "better-harness");

  const deliveryPluginName = "delivery";
  const deliveryPluginSource = path.join(qwenHome, "extension-store", deliveryPluginName);
  await writeJson(path.join(qwenHome, "extensions", deliveryPluginName, ".qwen-extension-install.json"), {
    source: deliveryPluginSource,
    type: "link",
    originSource: "QwenCode",
  });
  await writeJson(path.join(deliveryPluginSource, "qwen-extension.json"), {
    name: deliveryPluginName,
    version: "1.0.0",
    displayName: "Delivery",
    description: "Delivery workflow plugin.",
    skills: "./skills/",
  });
  await writeText(
    path.join(deliveryPluginSource, "skills", "ship-release", "SKILL.md"),
    "---\nname: ship-release\ndescription: Ship a release.\n---\n",
  );
  await writeJson(path.join(deliveryPluginSource, ".mcp.json"), {
    mcpServers: {
      deliveryMcp: { command: "node", args: ["mcp/server.cjs"] },
    },
  });
  await writeJson(path.join(deliveryPluginSource, "hooks.json"), {
    hooks: {
      PostToolUse: [
        {
          matcher: "Write",
          hooks: [{ type: "command", command: "node hooks/audit-delivery.mjs" }],
        },
      ],
    },
  });

  const disabledPluginName = "disabled-ext";
  const disabledPluginSource = path.join(qwenHome, "extension-store", disabledPluginName);
  await writeJson(path.join(qwenHome, "extensions", disabledPluginName, ".qwen-extension-install.json"), {
    source: disabledPluginSource,
    type: "link",
    originSource: "QwenCode",
  });
  await writeJson(path.join(disabledPluginSource, "qwen-extension.json"), {
    name: disabledPluginName,
    version: "0.1.0",
    displayName: "Disabled Extension",
    description: "Disabled extension.",
  });
  await writeText(
    path.join(disabledPluginSource, "skills", "disabled-skill", "SKILL.md"),
    "---\nname: disabled-skill\ndescription: This disabled Skill must not enter public surfaces.\n---\n",
  );

  await writeJson(path.join(qwenHome, "extensions", "extension-enablement.json"), {
    [disabledPluginName]: { overrides: ["!/*"] },
  });

  await writeText(
    path.join(qwenHome, "skills", "local-review", "SKILL.md"),
    "---\nname: local-review\ndescription: Review locally.\n---\n",
  );
  await writeText(path.join(qwenHome, "agents", "user-reviewer.md"), "---\nname: user-reviewer\ndescription: Review code.\ntools: Read\n---\n");
  await writeText(path.join(qwenHome, "commands", "user-check.md"), "# User Check\n");
  await writeText(path.join(qwenHome, "rules", "user-rule.md"), "# User Rule\n");
  await writeJson(path.join(qwenHome, "hooks.json"), {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [{ type: "command", command: "~/.qwen/hooks/guard-prompt.sh" }],
        },
      ],
    },
  });
  await writeJson(path.join(qwenHome, "settings.json"), {
    mcpServers: {
      localMcp: { command: "node", args: ["server.mjs"] },
    },
    hooks: {
      PreToolUse: [
        {
          matcher: "^Bash$",
          hooks: [{ type: "command", command: "~/.qwen/hooks/guard-bash.sh" }],
        },
      ],
    },
  });

  await writeText(
    path.join(workspace, ".qwen", "skills", "qwen-workflow", "SKILL.md"),
    "---\nname: qwen-workflow\ndescription: Qwen workflow.\n---\n",
  );
  await writeText(path.join(workspace, ".qwen", "rules", "always.md"), "# Always Qwen\n");
  await writeText(path.join(workspace, "QWEN.md"), "# Qwen Project Instructions\n");
  await writeText(path.join(workspace, "AGENTS.md"), "# Project Agent Rules\n");
  await writeText(path.join(workspace, "DESIGN.md"), "# Product Design Contract\n");
  await writeJson(path.join(workspace, ".qwen", "hooks.json"), {
    hooks: {
      Stop: [
        {
          hooks: [{ type: "command", command: "node hooks/check-stop.mjs" }],
        },
      ],
    },
  });
  await writeText(
    path.join(workspace, ".git", "config"),
    "[remote \"origin\"]\n\turl = https://github.com/example/better-harness.git\n",
  );

  return { root, qwenHome, workspace };
}

test("collectAgentCustomizeInventory returns Cursor-style manage tabs and scoped sources", async () => {
  const fixture = await makeCursorFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [
        { id: "hex-id", sources: ["user"] },
        { id: "paper-id", sources: ["user"] },
      ],
    });

    assert.deepEqual(
      inventory.tabs.map((tab) => tab.id),
      ["plugins", "mcps", "skills", "agents", "rules", "commands", "hooks"],
    );

    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      ["Hex", "Paper"],
    );
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.cursorPluginId),
      ["hex-id", "paper-id"],
    );
    const hex = inventory.plugins.find((plugin) => plugin.name === "hex");
    const paper = inventory.plugins.find((plugin) => plugin.name === "paper-desktop");
    assert.ok(hex);
    assert.ok(paper);
    assert.equal(hex.evidence.path, path.join(hex.rootPath, ".cursor-plugin", "plugin.json"));
    assert.equal(paper.evidence.path, path.join(paper.rootPath, "manifest.json"));
    assert.equal(inventory.plugins[0].skills[0].name, "hex-to-canvas");
    assert.equal(inventory.plugins[0].mcpServers[0].name, "hex");
    assert.equal(inventory.plugins[0].hooks[0].label, "Hex audit");

    assert.deepEqual(
      inventory.manage.mcps.map((server) => `${server.scope}:${server.name}`).sort(),
      ["plugin:hex", "project:workspaceDocs", "user:userLinear"],
    );
    assert.equal(
      inventory.manage.skills.some(
        (skill) => skill.scope === "user" && skill.name === "sessions-diagnostics",
      ),
      true,
    );
    assert.equal(
      inventory.manage.skills.some(
        (skill) =>
          skill.scope === "project" && skill.name === "codex-bug" && skill.sourceLabel === "openai/codex",
      ),
      true,
    );
    assert.equal(
      inventory.manage.rules.some((rule) => rule.scope === "plugin" && rule.name === "ensure-hex"),
      true,
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "rules", scopeKind: "project" }).map(
        (item) => `${item.name}:${item.sourceKind ?? "native"}`,
      ),
      ["always:native", "AGENTS.md:agents-md-compat", "DESIGN.md:design-md-contract"],
    );

    await rm(path.join(fixture.workspace, "DESIGN.md"));
    await writeText(path.join(fixture.workspace, "design.md"), "# Architecture Design\n");
    const lowercaseInventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [
        { id: "hex-id", sources: ["user"] },
        { id: "paper-id", sources: ["user"] },
      ],
    });
    assert.equal(
      filterManageItems(lowercaseInventory, { tab: "rules", scopeKind: "project" })
        .some((item) => item.sourceKind === "design-md-contract"),
      false,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("filterManageItems follows Cursor manage tab search rules", async () => {
  const fixture = await makeCursorFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [
        { id: "hex-id", sources: ["user"] },
        { id: "paper-id", sources: ["user"] },
      ],
    });

    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", query: "pap" }).map(
        (item) => item.displayName,
      ),
      ["Paper"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "mcps", query: "docs" }).map((item) => item.name),
      ["workspaceDocs"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "hooks", query: "prompt" }).map((item) => item.label),
      ["Guard prompt"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("filterManageItems scopes plugin installs like Cursor Manage scope", async () => {
  const fixture = await makeCursorFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [
        { id: "hex-id", sources: ["user"] },
        { id: "paper-id", sources: ["user"] },
        { id: "meta-id", sources: ["project"] },
      ],
    });

    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "user" }).map(
        (item) => item.displayName,
      ),
      ["Hex", "Paper"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "project" }).map(
        (item) => item.displayName,
      ),
      ["meta-quest/agentic-tools"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("direct plugin ids preserve Cursor install order", async () => {
  const fixture = await makeCursorFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [
        { id: "paper-id", sources: ["user"] },
        { id: "hex-id", sources: ["user"] },
        { id: "meta-id", sources: ["project"] },
      ],
    });

    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      ["Paper", "Hex", "meta-quest/agentic-tools"],
    );
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.installMatch),
      ["id", "id", "id"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "project" }).map(
        (item) => item.displayName,
      ),
      ["meta-quest/agentic-tools"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("project MCP tool snapshots map numeric plugin ids when local evidence exists", async () => {
  const fixture = await makeCursorFixture();

  try {
    const projectMcpRoot = path.join(
      fixture.cursorHome,
      "projects",
      workspaceProjectSlug(fixture.workspace),
      "mcps",
      "plugin-meta-quest-agentic-tools-hzdb",
    );
    await writeJson(path.join(projectMcpRoot, "tools", "search.json"), {
      name: "search",
      pluginId: "1293",
    });

    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [{ id: "1293", sources: ["project"] }],
    });

    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      ["meta-quest/agentic-tools"],
    );
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.installMatch),
      ["project-mcp"],
    );
    assert.deepEqual(inventory.diagnostics.unmatchedInstalledPluginIds, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("unproven numeric plugin ids remain unmatched with diagnostics", async () => {
  const fixture = await makeCursorFixture();

  try {
    const futureRoot = path.join(
      fixture.cursorHome,
      "plugins",
      "cache",
      "cursor-public",
      "future-tool",
      "jkl012",
    );
    await writeJson(path.join(futureRoot, ".cursor-plugin", "plugin.json"), {
      name: "future-tool",
      description: "Future tool plugin",
    });

    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [{ id: "9001", sources: ["user"] }],
    });

    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      [],
    );
    assert.equal(inventory.diagnostics.installedPluginFallbackCount, 0);
    assert.deepEqual(inventory.diagnostics.unmatchedInstalledPluginIds, ["9001"]);
    assert.match(inventory.diagnostics.installedPluginMatching, /remained unmatched/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("unknown Cursor plugin ids are invariant to cache candidate order", async () => {
  const fixture = await makeCursorFixture();

  try {
    const cacheRoot = path.join(fixture.cursorHome, "plugins", "cache", "cursor-public");
    const candidates = [
      ["alpha-without-id", "aaa111"],
      ["zulu-without-id", "zzz999"],
    ];
    for (const [pluginName, revision] of candidates) {
      await writeJson(path.join(cacheRoot, pluginName, revision, ".cursor-plugin", "plugin.json"), {
        name: pluginName,
        displayName: pluginName,
        description: `${pluginName} plugin`,
      });
    }

    const records = [
      { id: "9001", sources: ["user"] },
      { id: "opaque-install-record", sources: ["project"] },
    ];
    const first = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: records,
    });

    for (const [index, [pluginName, revision]] of candidates.entries()) {
      await writeJson(path.join(cacheRoot, pluginName, revision, ".cursor-plugin", "plugin.json"), {
        name: pluginName,
        displayName: candidates.at(-(index + 1))[0],
        description: `${pluginName} plugin`,
      });
    }
    const reordered = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: records,
    });

    assert.deepEqual(first.plugins, []);
    assert.deepEqual(reordered.plugins, []);
    assert.deepEqual(first.diagnostics.unmatchedInstalledPluginIds, [
      "9001",
      "opaque-install-record",
    ]);
    assert.deepEqual(reordered.diagnostics.unmatchedInstalledPluginIds, [
      "9001",
      "opaque-install-record",
    ]);
    assert.equal(first.diagnostics.installedPluginFallbackCount, 0);
    assert.equal(reordered.diagnostics.installedPluginFallbackCount, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("project skills include .codex skills and group by workspace source", async () => {
  const fixture = await makeCursorFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [],
    });
    const items = filterManageItems(inventory, { tab: "skills", scopeKind: "project" });
    const groups = groupManageItems(items, { tab: "skills" });

    assert.deepEqual(
      items.map((item) => item.name),
      ["codex-bug"],
    );
    assert.deepEqual(
      groups.map((group) => `${group.title}:${group.items.length}`),
      ["openai/codex:1"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("runtime plugin MCP snapshots appear in user-scope MCPs", async () => {
  const fixture = await makeCursorFixture();

  try {
    const runtimeRoot = path.join(fixture.cursorHome, "projects", "Users-example-codex", "mcps");
    const hzdbRoot = path.join(runtimeRoot, "plugin-meta-quest-agentic-tools-hzdb");
    await writeJson(path.join(hzdbRoot, "SERVER_METADATA.json"), {
      serverIdentifier: "plugin-meta-quest-agentic-tools-hzdb",
      serverName: "hzdb",
    });
    await writeJson(path.join(hzdbRoot, "tools", "take_screenshot.json"), { name: "take_screenshot" });
    const atlassianRoot = path.join(runtimeRoot, "plugin-atlassian-atlassian");
    await writeJson(path.join(atlassianRoot, "SERVER_METADATA.json"), {
      serverIdentifier: "plugin-atlassian-atlassian",
      serverName: "atlassian",
    });
    await writeText(
      path.join(atlassianRoot, "STATUS.md"),
      "The MCP server needs authentication.",
    );

    const inventory = await collectAgentCustomizeInventory({
      cursorHome: fixture.cursorHome,
      workspace: fixture.workspace,
      installedPluginRecords: [],
    });
    const items = filterManageItems(inventory, { tab: "mcps", scopeKind: "user" });
    const groups = groupManageItems(items, { tab: "mcps" });

    assert.deepEqual(
      items.map((item) => item.name),
      ["atlassian", "hzdb", "userLinear"],
    );
    assert.deepEqual(
      groups.map((group) => `${group.title}:${group.items.map((item) => item.name).join(",")}`),
      ["Needs Attention:atlassian", "Connected:hzdb", "Installed:userLinear"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("collectAgentCustomizeInventory returns Qoder installed plugins and scoped sources", async () => {
  const fixture = await makeQoderFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "qoder",
      qoderHome: fixture.qoderHome,
      qoderSharedClientCacheRoot: fixture.sharedClientCacheRoot,
      workspace: fixture.workspace,
    });

    assert.equal(inventory.provider, "qoder");
    assert.equal(inventory.qoderHome, fixture.qoderHome);
    assert.equal(inventory.sharedClientCacheRoot, fixture.sharedClientCacheRoot);
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      ["Better Harness", "Design"],
    );
    assert.equal(
      inventory.plugins.some((plugin) => plugin.displayName === "Apollo"),
      false,
    );

    const betterHarness = inventory.plugins.find((plugin) => plugin.name === "better-harness-plugin");
    assert.ok(betterHarness);
    assert.deepEqual(betterHarness.installSources, ["user", "project"]);
    assert.equal(betterHarness.installMatch, "qoder-installed-index");
    assert.equal(betterHarness.installedAt, "2026-06-23T07:15:07.153Z");
    assert.equal(betterHarness.enabled, true);
    assert.equal(betterHarness.skills[0].name, "better-harness");
    assert.equal(betterHarness.commands[0].name, "better-harness-check");
    assert.equal(betterHarness.mcpServers[0].name, "better-harness");
    assert.equal(betterHarness.hooks[0].command, "node hooks/better-harness.mjs");
    assert.equal(
      betterHarness.evidence.path,
      path.join(betterHarness.rootPath, ".qoder-plugin", "plugin.json"),
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "rules", scopeKind: "project" }).map(
        (item) => `${item.name}:${item.sourceKind}`,
      ),
      ["always:qoder-rules", "AGENTS.md:agents-md-compat", "DESIGN.md:design-md-contract"],
    );
    assert.equal(
      filterManageItems(inventory, { tab: "rules", scopeKind: "project" })
        .find((item) => item.name === "AGENTS.md")
        ?.precedence,
      "after-qoder-rules",
    );
    assert.equal(
      filterManageItems(inventory, { tab: "rules", scopeKind: "project" })
        .find((item) => item.name === "DESIGN.md")
        ?.precedence,
      "after-agents-md",
    );

    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "user" }).map(
        (item) => item.displayName,
      ),
      ["Better Harness", "Design"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "project" }).map(
        (item) => item.displayName,
      ),
      ["Better Harness"],
    );
    assert.deepEqual(inventory.diagnostics.installedPluginRecordCount, 2);
    assert.equal(inventory.diagnostics.enabledInstalledPluginCount, 2);
    assert.equal(inventory.diagnostics.disabledInstalledPluginCount, 0);
    assert.equal(inventory.diagnostics.unspecifiedInstalledPluginCount, 0);
    assert.equal(inventory.diagnostics.configuredPluginStateCount, 3);
    assert.equal(inventory.diagnostics.unmatchedEnabledPluginSettingCount, 1);
    assert.deepEqual(inventory.diagnostics.installedPluginIndexFiles.map((file) => path.basename(file)), [
      "installed_plugins.json",
      "installed_plugins_v2.json",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qoder provider collects configured MCPs and uses runtime metadata only as enrichment", async () => {
  const fixture = await makeQoderFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "qoder",
      qoderHome: fixture.qoderHome,
      qoderSharedClientCacheRoot: fixture.sharedClientCacheRoot,
      workspace: fixture.workspace,
    });

    assert.deepEqual(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "user" }).map((item) => item.name),
      ["better-harness", "chrome", "postgres"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "project" }).map((item) => item.name),
      ["schedule"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "project" })[0].toolNames,
      ["list_events"],
    );
    assert.deepEqual(
      groupManageItems(filterManageItems(inventory, { tab: "mcps", scopeKind: "user" }), {
        tab: "mcps",
      }).map((group) => `${group.title}:${group.items.map((item) => item.name).join(",")}`),
      ["Connected:chrome", "Installed:better-harness,postgres"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "hooks", scopeKind: "user" })
        .map((item) => item.command)
        .sort(),
      ["bash ~/.qoder/hooks/guard-tool.sh", "node hooks/better-harness.mjs"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "hooks", scopeKind: "project" }).map((item) => item.command),
      ["node hooks/check-stop.mjs"],
    );
    const projectHook = filterManageItems(inventory, { tab: "hooks", scopeKind: "project" })[0];
    assert.equal(projectHook.handlerType, "command");
    assert.equal(projectHook.commandDisplay, "node hooks/check-stop.mjs");
    assert.equal(projectHook.scriptPath, path.join(fixture.workspace, "hooks", "check-stop.mjs"));
    assert.equal(projectHook.timeoutMs, 1500);
    assert.equal(projectHook.condition, "env.REVIEW_TOKEN == <value>");
    assert.equal(projectHook.async, true);
    assert.equal(projectHook.registrationIndex, 0);
    assert.equal(projectHook.hookIndex, 0);
    assert.equal(inventory.diagnostics.runtimeOnlyProjectMcpCount, 0);
    assert.equal(inventory.manage.mcps.some((item) => item.name === "legacy"), false);
    assert.deepEqual(
      filterManageItems(inventory, { tab: "skills", scopeKind: "project" }).map((item) => item.name),
      ["release-review"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("collectAgentCustomizeInventory returns Codex installed plugins from install evidence", async () => {
  const fixture = await makeCodexFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "codex",
      codexHome: fixture.codexHome,
      codexAppPath: fixture.codexAppPath,
      workspace: fixture.workspace,
    });

    assert.equal(inventory.provider, "codex");
    assert.equal(inventory.codexHome, fixture.codexHome);
    assert.equal(inventory.codexAppPath, fixture.codexAppPath);
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      ["Browser", "Data Analytics"],
    );
    assert.equal(
      inventory.plugins.some((plugin) => plugin.displayName === "Apollo"),
      false,
    );

    const dataAnalytics = inventory.plugins.find((plugin) => plugin.name === "data-analytics");
    assert.ok(dataAnalytics);
    assert.equal(dataAnalytics.installMatch, "codex-remote-plugin-install");
    assert.equal(dataAnalytics.remotePluginId, "plugin_data_123");
    assert.equal(dataAnalytics.skills[0].name, "build-dashboard");
    assert.equal(dataAnalytics.commands[0].name, "build-report");
    assert.equal(dataAnalytics.mcpServers[0].name, "dataAnalytics");
    assert.equal(dataAnalytics.hooks[0].command, "node hooks/audit-data.mjs");
    assert.equal(
      dataAnalytics.evidence.path,
      path.join(dataAnalytics.rootPath, ".codex-plugin", "plugin.json"),
    );

    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "user" }).map(
        (item) => item.displayName,
      ),
      ["Browser", "Data Analytics"],
    );
    assert.equal(inventory.diagnostics.installedPluginState, "codex-plugin-cache");
    assert.equal(inventory.diagnostics.remotePluginInstallMarkersRequired, true);
    assert.equal(inventory.diagnostics.appBundleExists, true);
    assert.deepEqual(inventory.diagnostics.installedPluginRecordFiles.map((file) => path.basename(file)), [
      ".codex-remote-plugin-install.json",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Codex provider collects user and project MCPs, skills, and hooks", async () => {
  const fixture = await makeCodexFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "codex",
      codexHome: fixture.codexHome,
      codexAppPath: fixture.codexAppPath,
      workspace: fixture.workspace,
    });

    assert.deepEqual(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "user" }).map((item) => item.name),
      ["dataAnalytics", "localMcp"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "skills", scopeKind: "project" }).map((item) => item.name),
      ["agent-workflow", "codex-workflow"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "hooks", scopeKind: "user" })
        .map((item) => item.command)
        .sort(),
      ["node hooks/audit-data.mjs", "~/.codex/hooks/guard-prompt.sh"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "hooks", scopeKind: "project" }).map((item) => item.command),
      ["node hooks/check-stop.mjs"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "rules", scopeKind: "project" }).map(
        (item) => `${item.name}:${item.sourceKind ?? "native"}`,
      ),
      ["always:native", "AGENTS.md:agents-md-compat", "DESIGN.md:design-md-contract"],
    );
    assert.deepEqual(
      groupManageItems(filterManageItems(inventory, { tab: "mcps", scopeKind: "user" }), {
        tab: "mcps",
      }).map((group) => `${group.title}:${group.items.map((item) => item.name).join(",")}`),
      ["Installed:dataAnalytics,localMcp"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Claude provider collects native scoped assets from settings, state, and installed Plugin evidence", async () => {
  const fixture = await makeClaudeFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "claude",
      claudeHome: fixture.claudeHome,
      claudeStatePath: fixture.claudeStatePath,
      workspace: fixture.workspace,
      includeUserHome: true,
    });

    assert.equal(inventory.provider, "claude");
    assert.equal(inventory.claudeHome, fixture.claudeHome);
    assert.equal(inventory.claudeStatePath, fixture.claudeStatePath);
    assert.deepEqual(inventory.plugins.map((plugin) => `${plugin.claudePluginId}:${plugin.enabled}`), [
      `${fixture.enabledPluginId}:true`,
      `${fixture.disabledPluginId}:false`,
    ]);
    const delivery = inventory.plugins.find((plugin) => plugin.claudePluginId === fixture.enabledPluginId);
    assert.ok(delivery);
    assert.equal(delivery.installSource, "project");
    assert.equal(delivery.enabledSettingScope, "project");
    assert.deepEqual(delivery.skills.map((skill) => skill.name), ["default-delivery", "release-delivery"]);
    assert.deepEqual(delivery.commands.map((command) => command.name), ["ship"]);
    assert.deepEqual(delivery.subagents.map((agent) => agent.name), ["release-reviewer"]);
    assert.deepEqual(delivery.rules, []);
    assert.equal(delivery.hooks[0].handlerType, "command");
    assert.equal(delivery.hooks[0].command, undefined);
    assert.equal(delivery.hooks[0].commandDisplay, "node plugin-audit.mjs");
    assert.equal(delivery.hooks[0].timeoutMs, 4000);
    assert.equal(delivery.mcpServers[0].url, "https://example.invalid/plugin");

    assert.deepEqual(
      inventory.manage.skills.filter((item) => item.scope === "user").map((item) => item.name),
      ["user-review"],
    );
    assert.deepEqual(
      inventory.manage.skills.filter((item) => item.scope === "project").map((item) => item.name),
      ["project-review"],
    );
    assert.deepEqual(
      inventory.manage.rules.filter((item) => item.scope === "project").map((item) => item.name),
      [".claude/CLAUDE.md", "CLAUDE.local.md", "CLAUDE.md", "security"],
    );
    assert.equal(inventory.manage.rules.some((item) => item.name === "AGENTS.md"), false);

    const userHook = inventory.manage.hooks.find((hook) => hook.scope === "user");
    assert.ok(userHook);
    assert.equal(userHook.command, undefined);
    assert.equal(userHook.commandDisplay, "bash user-audit.sh");
    assert.equal(userHook.timeoutMs, 3000);
    assert.equal(userHook.async, true);
    assert.equal(userHook.scriptPath, path.join(fixture.workspace, "hooks", "user-audit.sh"));
    assert.deepEqual(
      inventory.manage.hooks.filter((hook) => hook.scope === "project").map((hook) => `${hook.step}:${hook.handlerType}:${hook.timeoutMs}`),
      ["SessionStart:prompt:2000", "Stop:agent:5000"],
    );

    assert.deepEqual(
      inventory.manage.mcps.map((server) => `${server.scope}:${server.name}`).sort(),
      ["plugin:pluginRemote", "project:localDocs", "project:projectRemote", "user:userNode"],
    );
    const userMcp = inventory.manage.mcps.find((server) => server.name === "userNode");
    assert.deepEqual(userMcp.args, ["server.mjs", "<redacted>", "<redacted>"]);
    assert.deepEqual(userMcp.directSecretEnvKeys, ["API_TOKEN"]);
    const projectMcp = inventory.manage.mcps.find((server) => server.name === "projectRemote");
    assert.equal(projectMcp.url, "https://example.invalid/project");
    assert.deepEqual(projectMcp.directSecretEnvKeys, ["PROJECT_API_TOKEN"]);
    assert.equal(inventory.manage.mcps.some((server) => server.name === "unrelated"), false);
    assert.equal(inventory.diagnostics.installedPluginState, "claude-installed-index");
    assert.equal(inventory.diagnostics.installedPluginRecordCount, 2);
    assert.equal(inventory.diagnostics.effectivePluginCount, 1);
    assert.equal(inventory.diagnostics.runtimeMcpProbeExecuted, false);

    const serialized = JSON.stringify(inventory);
    assert.doesNotMatch(serialized, /fixture-(?:hook|prompt|agent|oauth|user-mcp|project|plugin|local|unrelated)-secret/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Claude provider recognizes a symlink alias of the designated config workspace", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-claude-alias-"));
  const claudeHome = path.join(root, ".claude");
  const workspaceAlias = path.join(root, "claude-workspace");
  const pluginId = "aliased@fixture-marketplace";
  const escapingPluginId = "escaping@fixture-marketplace";
  const pluginRoot = path.join(claudeHome, "plugins", "cache", "fixture-marketplace", "aliased", "1.0.0");
  const escapingPluginRoot = path.join(claudeHome, "plugins", "escaping-link");
  const outsidePluginRoot = path.join(root, "outside-plugin");
  try {
    await writeText(
      path.join(claudeHome, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review the aliased Claude config workspace.\n---\n",
    );
    await writeJson(path.join(claudeHome, "settings.json"), {
      enabledPlugins: { [pluginId]: true, [escapingPluginId]: true },
    });
    await writeJson(path.join(pluginRoot, ".claude-plugin", "plugin.json"), {
      name: "aliased",
      version: "1.0.0",
    });
    await writeJson(path.join(outsidePluginRoot, ".claude-plugin", "plugin.json"), {
      name: "escaping",
      version: "1.0.0",
    });
    await writeJson(path.join(claudeHome, "plugins", "installed_plugins.json"), {
      version: 2,
      plugins: {
        [pluginId]: [{ scope: "user", installPath: pluginRoot, version: "1.0.0" }],
        [escapingPluginId]: [{ scope: "user", installPath: escapingPluginRoot, version: "1.0.0" }],
      },
    });
    try {
      await symlink(outsidePluginRoot, escapingPluginRoot, process.platform === "win32" ? "junction" : "dir");
      await symlink(claudeHome, workspaceAlias, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`symlink unavailable: ${error.message}`);
      return;
    }

    const inventory = await collectAgentCustomizeInventory({
      provider: "claude",
      workspace: workspaceAlias,
      claudeHome,
      claudeStatePath: path.join(root, ".claude.json"),
      includeUserHome: false,
    });

    assert.equal(inventory.diagnostics.designatedClaudeHomeWorkspace, true);
    assert.deepEqual(
      inventory.manage.skills.map((item) => `${item.scope}:${item.name}`),
      ["project:review"],
    );
    assert.deepEqual(
      inventory.plugins.map((plugin) => `${plugin.name}:${plugin.workspaceScoped}`),
      ["aliased:true"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude public configured-asset surfaces exclude disabled Plugin children", async () => {
  const fixture = await makeClaudeFixture();

  try {
    const inventory = await collectPracticeInventory({
      platform: "claude",
      workspace: fixture.workspace,
      claudeHome: fixture.claudeHome,
      claudeStatePath: fixture.claudeStatePath,
      includeUserHome: true,
    });
    const pluginSurface = inventory.surfaces.find((surface) => surface.type === "plugins");
    const pluginSkillSurface = inventory.surfaces.find(
      (surface) => surface.type === "skills" && surface.group === "Plugin/marketplace assets",
    );

    assert.deepEqual(pluginSurface.items.map((item) => item.name), ["Delivery"]);
    assert.deepEqual(pluginSkillSurface.items.map((item) => item.name), ["default-delivery", "release-delivery"]);
    assert.equal(JSON.stringify(inventory).includes("disabled-skill"), false);
    assert.equal(inventory.scope.claudeHome, fixture.claudeHome);
    assert.equal(inventory.scope.claudeStatePath, fixture.claudeStatePath);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("collectKimiCustomizeInventory collects scoped skills, rules, and MCPs with includeUserHome control", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-kimi-"));
  const kimiHome = path.join(root, ".kimi-code");
  const workspace = path.join(root, "workspace", "kimi-project");

  try {
    await writeText(
      path.join(kimiHome, "skills", "user-skill", "SKILL.md"),
      "---\nname: user-skill\ndescription: User-scoped Kimi skill.\n---\n",
    );
    await writeJson(path.join(kimiHome, "mcp.json"), {
      mcpServers: { userMcp: { command: "npx", args: ["-y", "@user/mcp"] } },
    });
    await writeText(
      path.join(workspace, ".kimi", "skills", "project-kimi-skill", "SKILL.md"),
      "---\nname: project-kimi-skill\ndescription: Project skill from .kimi.\n---\n",
    );
    await writeText(
      path.join(workspace, ".kimi-code", "skills", "project-kimi-code-skill", "SKILL.md"),
      "---\nname: project-kimi-code-skill\ndescription: Project skill from .kimi-code.\n---\n",
    );
    await writeText(path.join(workspace, "AGENTS.md"), "# Project Agent Rules\n");

    const inventory = await collectKimiCustomizeInventory({ kimiHome, workspace });

    assert.equal(inventory.provider, "kimi");
    assert.equal(inventory.kimiHome, path.resolve(kimiHome));
    assert.equal(inventory.workspace, path.resolve(workspace));
    assert.deepEqual(inventory.plugins, []);

    assert.deepEqual(
      inventory.manage.skills
        .filter((item) => item.scope === "user")
        .map((item) => `${item.name}:${item.sourceLabel}`),
      ["user-skill:User"],
    );
    assert.deepEqual(
      inventory.manage.skills
        .filter((item) => item.scope === "project")
        .map((item) => `${item.name}:${item.sourceLabel}`),
      ["project-kimi-code-skill:kimi-project", "project-kimi-skill:kimi-project"],
    );
    assert.deepEqual(
      inventory.manage.rules.map((item) => `${item.scope}:${item.name}:${item.sourceKind}`),
      ["project:AGENTS.md:agents-md-compat"],
    );
    assert.deepEqual(
      inventory.manage.mcps.map((item) => `${item.scope}:${item.name}`),
      ["user:userMcp"],
    );
    assert.deepEqual(inventory.diagnostics.projectSkillRootsProbed, [
      path.join(workspace, ".kimi-code", "skills"),
      path.join(workspace, ".kimi", "skills"),
    ]);
    assert.ok(inventory.unsupported.length > 0);
    assert.ok(inventory.unsupported.some((entry) => /memory/iu.test(entry)));
    assert.equal(inventory.unsupported.some((entry) => /^plugins\b/iu.test(entry)), false);
    assert.equal(inventory.unsupported.some((entry) => /^hooks\b/iu.test(entry)), false);

    const projectOnly = await collectKimiCustomizeInventory({
      kimiHome,
      workspace,
      includeUserHome: false,
    });
    assert.equal(projectOnly.manage.skills.some((item) => item.scope === "user"), false);
    assert.deepEqual(projectOnly.manage.mcps, []);
    assert.deepEqual(projectOnly.plugins, []);
    assert.equal(projectOnly.diagnostics.pluginCollectionSkipped, "include-user-home-disabled");
    assert.deepEqual(
      projectOnly.manage.skills.filter((item) => item.scope === "project").map((item) => item.name),
      ["project-kimi-code-skill", "project-kimi-skill"],
    );
    assert.deepEqual(
      projectOnly.manage.rules.map((item) => `${item.scope}:${item.name}`),
      ["project:AGENTS.md"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("collectKimiCustomizeInventory inventories enabled plugin assets and skips disabled ones", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-kimi-plugins-"));
  const kimiHome = path.join(root, ".kimi-code");
  const workspace = path.join(root, "workspace", "kimi-project");
  const managed = path.join(kimiHome, "plugins", "managed");
  const alphaRoot = path.join(managed, "alpha");
  const betaRoot = path.join(managed, "beta");
  const gammaRoot = path.join(managed, "gamma");

  try {
    await mkdir(workspace, { recursive: true });
    await writeJson(path.join(kimiHome, "plugins", "installed.json"), {
      version: 1,
      plugins: [
        {
          id: "alpha",
          root: alphaRoot,
          source: "local-path",
          enabled: true,
          installedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          originalSource: "/srv/alpha",
        },
        { id: "beta", root: betaRoot, source: "local-path", enabled: false },
        { id: "gamma", root: gammaRoot, source: "local-path", enabled: true },
      ],
    });
    // alpha: full manifest, plus a shadow fallback manifest that must not win.
    await writeJson(path.join(alphaRoot, "kimi.plugin.json"), {
      name: "alpha",
      version: "1.2.3",
      description: "Alpha plugin.",
      skills: ["./skills/", "../outside"],
      agents: "./agents/",
      commands: ["./commands/", "./solo.md"],
      hooks: [
        { event: "PreToolUse", matcher: "Bash", command: "node ${KIMI_PLUGIN_ROOT}/hooks/check.mjs", timeout: 30 },
        { event: "SessionStart", command: "echo alpha-ready" },
      ],
      mcpServers: {
        "alpha-stdio": { command: "npx", args: ["-y", "@alpha/mcp-server"], env: { ALPHA_TOKEN: "fixture-alpha-secret" } },
        "alpha-http": { url: "https://mcp.example.com/alpha?key=fixture-alpha-secret" },
      },
      systemPrompt: "Always answer as alpha.",
      sessionStart: { skill: "alpha-skill" },
      interface: { displayName: "Alpha Plugin" },
    });
    await writeJson(path.join(alphaRoot, ".kimi-plugin", "plugin.json"), { name: "alpha", description: "shadow" });
    await writeText(
      path.join(alphaRoot, "skills", "alpha-skill", "SKILL.md"),
      "---\nname: alpha-skill\ndescription: Alpha skill.\n---\n",
    );
    await writeText(
      path.join(managed, "outside", "outside-skill", "SKILL.md"),
      "---\nname: outside-skill\ndescription: Escapes the plugin root.\n---\n",
    );
    await writeText(
      path.join(alphaRoot, "agents", "reviewer.md"),
      "---\nname: alpha-reviewer\ndescription: Reviews code.\n---\n",
    );
    await writeText(
      path.join(alphaRoot, "commands", "run.md"),
      "---\nname: run-alpha\ndescription: Runs alpha.\n---\n",
    );
    await writeText(path.join(alphaRoot, "commands", "review", "deep.md"), "# Deep review\n");
    await writeText(path.join(alphaRoot, "solo.md"), "# Solo\n");
    // beta: installed but disabled; its assets must stay out of component collections.
    await writeJson(path.join(betaRoot, "kimi.plugin.json"), {
      name: "beta",
      description: "Beta plugin.",
      skills: "./skills/",
      commands: "./commands/",
    });
    await writeText(path.join(betaRoot, "skills", "beta-skill", "SKILL.md"), "---\nname: beta-skill\n---\n");
    await writeText(path.join(betaRoot, "commands", "beta-cmd.md"), "---\nname: beta-cmd\n---\n");
    // gamma: fallback manifest location, root SKILL.md as single skill root, auto-picked agents/.
    await writeJson(path.join(gammaRoot, ".kimi-plugin", "plugin.json"), {
      name: "gamma",
      description: "Gamma plugin.",
    });
    await writeText(path.join(gammaRoot, "SKILL.md"), "---\nname: gamma\ndescription: Gamma root skill.\n---\n");
    await writeText(path.join(gammaRoot, "agents", "helper.md"), "---\nname: gamma-helper\n---\n");

    const inventory = await collectKimiCustomizeInventory({ kimiHome, workspace });

    assert.deepEqual(
      inventory.manage.plugins.map((plugin) => `${plugin.kind}:${plugin.id}:${plugin.enabled}`),
      ["plugin:alpha:true", "plugin:beta:false", "plugin:gamma:true"],
    );
    const alpha = inventory.plugins.find((plugin) => plugin.id === "alpha");
    assert.equal(alpha.displayName, "Alpha Plugin");
    assert.equal(alpha.description, "Alpha plugin.");
    assert.equal(alpha.version, "1.2.3");
    assert.equal(alpha.installSource, "user");
    assert.equal(alpha.source, "local-path");
    assert.equal(alpha.systemPrompt, "Always answer as alpha.");
    assert.equal(alpha.sessionStartSkill, "alpha-skill");
    // systemPrompt stays plugin metadata and is never merged into rules.
    assert.deepEqual(inventory.manage.rules.filter((item) => item.scope === "plugin"), []);

    assert.deepEqual(
      inventory.manage.skills.filter((item) => item.scope === "plugin").map((item) => `${item.name}:${item.pluginId}`),
      ["alpha-skill:alpha", "gamma:gamma"],
    );
    // Declared paths escaping the plugin root are skipped.
    assert.equal(inventory.manage.skills.some((item) => item.name === "outside-skill"), false);
    assert.deepEqual(
      inventory.manage.subagents.filter((item) => item.scope === "plugin").map((item) => `${item.name}:${item.pluginId}`),
      ["alpha-reviewer:alpha", "gamma-helper:gamma"],
    );
    const pluginCommands = inventory.manage.commands.filter((item) => item.scope === "plugin");
    assert.deepEqual(pluginCommands.map((item) => item.name), ["review/deep", "run-alpha", "solo"]);
    assert.equal(pluginCommands.every((item) => item.pluginId === "alpha"), true);

    const pluginHooks = inventory.manage.hooks.filter((item) => item.scope === "plugin");
    assert.deepEqual(pluginHooks.map((item) => item.step).sort(), ["PreToolUse", "SessionStart"]);
    const preHook = pluginHooks.find((item) => item.step === "PreToolUse");
    assert.equal(preHook.pluginId, "alpha");
    assert.equal(preHook.matcher, "Bash");
    assert.equal(preHook.timeoutMs, 30000);
    assert.equal(preHook.commandDisplay, "node check.mjs");

    const pluginMcps = inventory.manage.mcps.filter((item) => item.scope === "plugin");
    assert.deepEqual(pluginMcps.map((item) => item.name), ["alpha-http", "alpha-stdio"]);
    assert.equal(pluginMcps.find((item) => item.name === "alpha-http").url, "https://mcp.example.com/alpha");

    // Disabled plugins stay listed but contribute no component assets.
    const beta = inventory.plugins.find((plugin) => plugin.id === "beta");
    assert.equal(beta.enabled, false);
    assert.deepEqual(beta.skills, []);
    assert.equal(inventory.manage.skills.some((item) => item.pluginId === "beta"), false);
    assert.equal(inventory.manage.commands.some((item) => item.pluginId === "beta"), false);

    assert.equal(inventory.diagnostics.installedPluginIndexExists, true);
    assert.equal(inventory.diagnostics.installedPluginIndexParseFailed, false);
    assert.equal(inventory.diagnostics.installedPluginRecordCount, 3);
    assert.equal(inventory.diagnostics.enabledPluginCount, 2);
    assert.equal(JSON.stringify(inventory).includes("fixture-alpha-secret"), false);

    // A missing installed.json yields an empty plugin list without throwing.
    const noIndex = await collectKimiCustomizeInventory({
      kimiHome: path.join(root, "empty-home"),
      workspace,
    });
    assert.deepEqual(noIndex.plugins, []);
    assert.equal(noIndex.diagnostics.installedPluginIndexExists, false);
    assert.equal(noIndex.diagnostics.installedPluginRecordCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("collectKimiCustomizeInventory drops plugin assets whose realpath escapes the plugin root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-kimi-symlink-"));
  const kimiHome = path.join(root, ".kimi-code");
  const workspace = path.join(root, "workspace", "kimi-project");
  const pluginRoot = path.join(kimiHome, "plugins", "managed", "escapee");
  const external = path.join(root, "outside-plugin-root", "external-skill");

  try {
    await mkdir(workspace, { recursive: true });
    await writeJson(path.join(kimiHome, "plugins", "installed.json"), {
      version: 1,
      plugins: [{ id: "escapee", root: pluginRoot, source: "local-path", enabled: true }],
    });
    await writeJson(path.join(pluginRoot, "kimi.plugin.json"), {
      name: "escapee",
      skills: "./skills/",
      agents: "./agents/",
      commands: "./commands/",
    });
    // A legitimate in-root skill stays inventoried.
    await writeText(
      path.join(pluginRoot, "skills", "inside-skill", "SKILL.md"),
      "---\nname: inside-skill\ndescription: Lives inside the plugin root.\n---\n",
    );
    // A symlink inside the plugin root points at a directory outside it.
    await writeText(
      path.join(external, "SKILL.md"),
      "---\nname: external-skill\ndescription: Lives outside the plugin root.\n---\n",
    );
    await symlink(external, path.join(pluginRoot, "skills", "linked-outside"), process.platform === "win32" ? "junction" : "dir");
    // Agent and command files reached only through the escaping symlink are
    // dropped as well.
    await writeText(path.join(root, "outside-plugin-root", "agent.md"), "---\nname: external-agent\n---\n");
    await writeText(path.join(root, "outside-plugin-root", "command.md"), "---\nname: external-command\n---\n");
    await mkdir(path.join(pluginRoot, "agents"), { recursive: true });
    await symlink(root, path.join(pluginRoot, "agents", "linked-outside"), process.platform === "win32" ? "junction" : "dir");
    await writeText(path.join(pluginRoot, "commands", "inside.md"), "---\nname: inside-command\n---\n");

    const inventory = await collectKimiCustomizeInventory({ kimiHome, workspace });

    const pluginSkills = inventory.manage.skills.filter((item) => item.pluginId === "escapee");
    assert.deepEqual(pluginSkills.map((item) => item.name), ["inside-skill"]);
    assert.equal(pluginSkills.some((item) => item.name === "external-skill"), false);
    assert.equal(inventory.manage.subagents.some((item) => item.name === "external-agent"), false);
    const pluginCommands = inventory.manage.commands.filter((item) => item.pluginId === "escapee");
    assert.deepEqual(pluginCommands.map((item) => item.name), ["inside-command"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tab availability matches Cursor Customize manage scope rules", () => {
  assert.equal(tabAvailableForScope("plugins", "team"), true);
  assert.equal(tabAvailableForScope("mcps", "team"), true);
  assert.equal(tabAvailableForScope("rules", "team"), true);
  assert.equal(tabAvailableForScope("commands", "team"), true);
  assert.equal(tabAvailableForScope("skills", "team"), false);
  assert.equal(tabAvailableForScope("agents", "team"), false);
  assert.equal(tabAvailableForScope("hooks", "team"), false);
  assert.equal(tabAvailableForScope("skills", "workspace"), true);
  assert.equal(tabAvailableForScope("hooks", "user"), true);
});

const agentCustomizeCliPath = path.join(process.cwd(), "scripts", "agent-customize", "cli.mjs");
const betterHarnessCliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");

function runAgentCustomizeCli(args, entry = agentCustomizeCliPath) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

test("agent-customize --help returns before reading provider inventory sources", () => {
  // An unsupported provider fails in the collector, so exit 0 with --help
  // proves the help-only path returned before any inventory access.
  for (const args of [
    ["--help"],
    ["-h"],
    ["help"],
    ["--provider", "does-not-exist", "--help"],
    ["inventory", "--provider", "does-not-exist", "--help"],
  ]) {
    const result = runAgentCustomizeCli(args);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stdout, /Usage: better-harness agent-customize/u);
  }

  const failing = runAgentCustomizeCli(["--provider", "does-not-exist"]);
  assert.equal(failing.status, 1);
  assert.match(failing.stderr, /Unsupported agent-customize provider/u);
});

test("agent-customize --help stays help-only through the root facade", () => {
  const result = runAgentCustomizeCli(["agent-customize", "--help"], betterHarnessCliPath);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: better-harness agent-customize/u);
});

test("collectAgentCustomizeInventory returns Qwen installed plugins from extension evidence", async () => {
  const fixture = await makeQwenFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "qwen",
      qwenHome: fixture.qwenHome,
      workspace: fixture.workspace,
    });

    assert.equal(inventory.provider, "qwen");
    assert.equal(inventory.qwenHome, fixture.qwenHome);
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.displayName),
      ["Delivery", "Disabled Extension"],
    );

    const delivery = inventory.plugins.find((plugin) => plugin.name === "delivery");
    assert.ok(delivery);
    assert.equal(delivery.installMatch, "qwen-extension-install");
    assert.equal(delivery.skills[0].name, "ship-release");
    assert.equal(delivery.mcpServers[0].name, "deliveryMcp");
    assert.equal(delivery.hooks[0].command, "node hooks/audit-delivery.mjs");
    assert.equal(
      delivery.evidence.path,
      path.join(delivery.rootPath, "qwen-extension.json"),
    );
    assert.equal(delivery.enabled, true);

    const disabled = inventory.plugins.find((plugin) => plugin.name === "disabled-ext");
    assert.ok(disabled);
    assert.equal(disabled.enabled, false);
    assert.deepEqual(
      filterManageItems(inventory, { tab: "plugins", scopeKind: "user" }).map(
        (item) => item.displayName,
      ),
      ["Delivery", "Disabled Extension"],
    );
    assert.equal(inventory.diagnostics.installedPluginState, "qwen-extensions");
    assert.equal(inventory.diagnostics.remotePluginInstallMarkersRequired, true);
    assert.deepEqual(inventory.diagnostics.installedPluginRecordFiles.map((file) => path.basename(file)), [
      ".qwen-extension-install.json",
      ".qwen-extension-install.json",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Qwen provider collects user and project MCPs, skills, hooks, and rules", async () => {
  const fixture = await makeQwenFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "qwen",
      qwenHome: fixture.qwenHome,
      workspace: fixture.workspace,
    });

    assert.deepEqual(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "user" }).map((item) => item.name).sort(),
      ["deliveryMcp", "localMcp"],
    );
    assert.ok(
      filterManageItems(inventory, { tab: "skills", scopeKind: "user" })
        .some((item) => item.name === "local-review" && item.scope === "user"),
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "skills", scopeKind: "project" }).map((item) => item.name),
      ["qwen-workflow"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "hooks", scopeKind: "user" })
        .map((item) => item.command)
        .sort(),
      ["node hooks/audit-delivery.mjs", "~/.qwen/hooks/guard-bash.sh", "~/.qwen/hooks/guard-prompt.sh"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "hooks", scopeKind: "project" }).map((item) => item.command),
      ["node hooks/check-stop.mjs"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "rules", scopeKind: "project" }).map(
        (item) => `${item.name}:${item.sourceKind ?? "native"}`,
      ).sort(),
      ["AGENTS.md:agents-md-compat", "DESIGN.md:design-md-contract", "QWEN.md:qwen-md-context", "always:native"].sort(),
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "commands", scopeKind: "user" }).map((item) => item.name),
      ["user-check"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "agents", scopeKind: "user" }).map((item) => item.name),
      ["user-reviewer"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function makeCopilotFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-copilot-"));
  const copilotHome = path.join(root, ".copilot");
  const workspace = path.join(root, "workspace", "better-harness");

  const pluginRoot = path.join(copilotHome, "installed-plugins", "acme", "delivery");
  await writeJson(path.join(pluginRoot, ".github", "plugin", "plugin.json"), {
    name: "delivery",
    version: "1.0.0",
    displayName: "Delivery",
    description: "Delivery workflow plugin.",
    skills: "./skills/",
  });
  await writeText(
    path.join(pluginRoot, "skills", "ship-release", "SKILL.md"),
    "---\nname: ship-release\ndescription: Ship a release.\n---\n",
  );
  await writeJson(path.join(pluginRoot, ".mcp.json"), {
    mcpServers: { deliveryMcp: { command: "node", args: ["mcp/server.cjs"] } },
  });

  await writeJson(path.join(copilotHome, "config.json"), {
    installedPlugins: [
      {
        name: "delivery",
        marketplace: "acme",
        version: "1.0.0",
        enabled: true,
        installed_at: "2026-07-20T00:00:00.000Z",
        cache_path: pluginRoot,
      },
      {
        name: "missing-plugin",
        marketplace: "acme",
        version: "0.1.0",
        enabled: true,
        cache_path: path.join(copilotHome, "installed-plugins", "acme", "missing-plugin"),
      },
    ],
  });

  await writeText(path.join(copilotHome, "copilot-instructions.md"), "# User Copilot Guide\n\nPersonal defaults.\n");
  await writeText(
    path.join(copilotHome, "skills", "user-skill", "SKILL.md"),
    "---\nname: user-skill\ndescription: A personal skill.\n---\n",
  );
  await writeJson(path.join(copilotHome, "mcp-config.json"), {
    mcpServers: { userMcp: { command: "node", args: ["user.cjs"] } },
  });

  await writeText(path.join(workspace, "AGENTS.md"), "# Agents\n\nProject guidance.\n");
  await writeText(path.join(workspace, ".github", "copilot-instructions.md"), "# Copilot\n\nProject Copilot guidance.\n");
  await writeText(
    path.join(workspace, ".github", "instructions", "tests.instructions.md"),
    "---\napplyTo: \"**/*.test.mjs\"\ndescription: Test guidance.\n---\n",
  );
  await writeText(
    path.join(workspace, ".github", "skills", "review-change", "SKILL.md"),
    "---\nname: review-change\ndescription: Review a change.\n---\n",
  );
  await writeText(
    path.join(workspace, ".github", "agents", "reviewer.agent.md"),
    "---\nname: reviewer\ndescription: Review code.\n---\n",
  );
  await writeJson(path.join(workspace, ".github", "hooks", "guard.json"), {
    hooks: { Stop: [{ hooks: [{ type: "command", command: "node scripts/review-trigger/cli.mjs" }] }] },
  });
  await writeJson(path.join(workspace, ".github", "mcp.json"), {
    mcpServers: { projectMcp: { command: "node", args: ["project.cjs"] } },
  });

  return { root, copilotHome, workspace };
}

test("Copilot inventory separates plugin, user, and project assets", async () => {
  const fixture = await makeCopilotFixture();
  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "copilot",
      workspace: fixture.workspace,
      copilotHome: fixture.copilotHome,
      includeUserHome: true,
    });

    assert.equal(inventory.provider, "copilot");
    assert.equal(inventory.copilotHome, fixture.copilotHome);
    assert.equal(inventory.diagnostics.installedPluginState, "copilot-config");

    // The record whose cache path is absent must not become an installed plugin.
    assert.equal(inventory.plugins.length, 1);
    assert.equal(inventory.plugins[0].id, "acme/delivery");
    assert.equal(inventory.plugins[0].installMatch, "copilot-marketplace");
    assert.equal(inventory.plugins[0].skills.length, 1);

    const skillNames = inventory.manage.skills.map((skill) => skill.name).sort();
    assert.deepEqual(skillNames, ["review-change", "ship-release", "user-skill"]);

    const scopesByName = new Map(inventory.manage.skills.map((skill) => [skill.name, skill.scope]));
    assert.equal(scopesByName.get("review-change"), "project");
    assert.equal(scopesByName.get("user-skill"), "user");
    assert.equal(scopesByName.get("ship-release"), "plugin");

    const ruleNames = inventory.manage.rules.map((rule) => rule.name);
    assert.ok(ruleNames.includes("AGENTS.md"));
    assert.ok(ruleNames.includes("copilot-instructions.md"));

    const mcpNames = inventory.manage.mcps.map((mcp) => mcp.name).sort();
    assert.deepEqual(mcpNames, ["deliveryMcp", "projectMcp", "userMcp"]);

    assert.equal(inventory.manage.subagents.some((agent) => agent.name === "reviewer"), true);
    assert.equal(inventory.manage.hooks.length > 0, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Copilot inventory without user-home authority keeps project scope only", async () => {
  const fixture = await makeCopilotFixture();
  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "copilot",
      workspace: fixture.workspace,
      copilotHome: fixture.copilotHome,
      includeUserHome: false,
    });

    assert.equal(inventory.plugins.length, 0);
    assert.equal(inventory.diagnostics.installedPluginState, "not-authorized");
    assert.deepEqual(inventory.manage.skills.map((skill) => skill.name), ["review-change"]);
    assert.deepEqual(inventory.manage.mcps.map((mcp) => mcp.name), ["projectMcp"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("agent-customize CLI honours --copilot-home instead of the real user home", async () => {
  // Regression: the CLI advertised --copilot-home but never forwarded it, so an
  // isolated home still resolved ~/.copilot and scanned the caller's real assets.
  const fixture = await makeCopilotFixture();
  try {
    const result = runAgentCustomizeCli([
      "inventory",
      "--provider",
      "copilot",
      "--workspace",
      fixture.workspace,
      "--copilot-home",
      fixture.copilotHome,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const inventory = JSON.parse(result.stdout);

    // The resolved home must be the override, never the caller's real ~/.copilot.
    assert.equal(inventory.copilotHome, fixture.copilotHome);
    assert.notEqual(inventory.copilotHome, path.join(os.homedir(), ".copilot"));

    // The inventory itself must also come from the override.
    assert.equal(inventory.diagnostics.installedPluginState, "copilot-config");
    assert.deepEqual(inventory.plugins.map((plugin) => plugin.id), ["acme/delivery"]);
    assert.deepEqual(
      inventory.manage.skills.map((skill) => skill.name).sort(),
      ["review-change", "ship-release", "user-skill"],
    );
    for (const item of [...inventory.manage.skills, ...inventory.manage.mcps]) {
      assert.ok(
        !item.evidence?.path || !item.evidence.path.startsWith(path.join(os.homedir(), ".copilot")),
        `inventory item escaped the override home: ${item.evidence?.path}`,
      );
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function makePiFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-pi-"));
  const piHome = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace");

  const npmPackageRoot = path.join(piHome, "npm", "node_modules", "@scope", "delivery-pack");
  await writeJson(path.join(npmPackageRoot, "package.json"), {
    name: "@scope/delivery-pack",
    version: "1.2.0",
    description: "Delivery workflows for pi.",
    pi: { skills: ["./skills"], prompts: ["./prompts"] },
  });
  await writeText(
    path.join(npmPackageRoot, "skills", "delivery-review", "SKILL.md"),
    "---\nname: delivery-review\ndescription: Review delivery gates.\n---\n",
  );
  await writeText(path.join(npmPackageRoot, "prompts", "ship-check.md"), "# Ship Check\n");

  const gitPackageRoot = path.join(piHome, "git", "github.com", "acme", "pi-toolkit");
  await writeJson(path.join(gitPackageRoot, "package.json"), {
    name: "pi-toolkit",
    version: "0.9.0",
  });
  await writeText(
    path.join(gitPackageRoot, "skills", "toolkit-audit", "SKILL.md"),
    "---\nname: toolkit-audit\ndescription: Audit toolkit output.\n---\n",
  );

  await writeJson(path.join(piHome, "settings.json"), {
    packages: [
      "npm:@scope/delivery-pack@1.2.0",
      { source: "git:github.com/acme/pi-toolkit@v0.9.0" },
    ],
  });
  await writeText(
    path.join(piHome, "skills", "local-review", "SKILL.md"),
    "---\nname: local-review\ndescription: Review code locally.\n---\n",
  );
  await writeText(path.join(piHome, "prompts", "user-check.md"), "# User Check\n");
  await writeText(path.join(piHome, "AGENTS.md"), "# Global Pi Guidance\n");
  await writeText(
    path.join(piHome, "extensions", "guardrail-extension", "package.json"),
    `${JSON.stringify({ name: "guardrail-extension", version: "0.1.0" }, null, 2)}\n`,
  );

  await writeText(
    path.join(workspace, ".pi", "skills", "pi-workflow", "SKILL.md"),
    "---\nname: pi-workflow\ndescription: Pi workflow.\n---\n",
  );
  await writeText(path.join(workspace, ".pi", "prompts", "release-notes.md"), "# Release Notes\n");
  await writeText(
    path.join(workspace, ".agents", "skills", "shared-standard", "SKILL.md"),
    "---\nname: shared-standard\ndescription: Shared Agent Skills standard workflow.\n---\n",
  );
  await writeText(path.join(workspace, "AGENTS.md"), "# Pi Project Instructions\n");

  return { root, piHome, workspace };
}

test("collectAgentCustomizeInventory returns Pi packages and extensions as plugins", async () => {
  const fixture = await makePiFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "pi",
      piHome: fixture.piHome,
      workspace: fixture.workspace,
    });

    assert.equal(inventory.provider, "pi");
    assert.equal(inventory.piHome, fixture.piHome);
    assert.equal(inventory.plugins.length, 3);

    const delivery = inventory.plugins.find((plugin) => plugin.name === "@scope/delivery-pack");
    assert.ok(delivery);
    assert.equal(delivery.installMatch, "pi-settings-npm");
    assert.equal(delivery.version, "1.2.0");
    assert.deepEqual(delivery.skills.map((skill) => skill.name), ["delivery-review"]);
    assert.deepEqual(delivery.commands.map((command) => command.name), ["ship-check"]);

    const toolkit = inventory.plugins.find((plugin) => plugin.name === "pi-toolkit");
    assert.ok(toolkit);
    assert.equal(toolkit.installMatch, "pi-settings-git");
    assert.deepEqual(toolkit.skills.map((skill) => skill.name), ["toolkit-audit"]);

    const extension = inventory.plugins.find((plugin) => plugin.name === "guardrail-extension");
    assert.ok(extension);
    assert.equal(extension.installMatch, "pi-extensions-dir");

    assert.equal(inventory.diagnostics.installedPluginState, "pi-settings-packages");
    assert.deepEqual(
      inventory.diagnostics.installedPluginRecordFiles,
      [path.join(fixture.piHome, "settings.json")],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Pi provider collects user and project skills, prompt commands, and context rules", async () => {
  const fixture = await makePiFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "pi",
      piHome: fixture.piHome,
      workspace: fixture.workspace,
    });

    assert.ok(
      filterManageItems(inventory, { tab: "skills", scopeKind: "user" })
        .some((item) => item.name === "local-review" && item.scope === "user"),
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "skills", scopeKind: "project" }).map((item) => item.name).sort(),
      ["pi-workflow", "shared-standard"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "commands", scopeKind: "user" }).map((item) => item.name).sort(),
      ["ship-check", "user-check"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "commands", scopeKind: "project" }).map((item) => item.name),
      ["release-notes"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "rules", scopeKind: "user" }).map(
        (item) => `${item.name}:${item.sourceKind ?? "native"}`,
      ),
      ["AGENTS.md:pi-global-context"],
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "rules", scopeKind: "project" }).map(
        (item) => `${item.name}:${item.sourceKind ?? "native"}`,
      ).sort(),
      ["AGENTS.md:agents-md-compat"].sort(),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Pi fails closed on autoload:false and honors package resource filters", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-pi-filters-"));
  const piHome = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace");
  try {
    const disabledRoot = path.join(piHome, "npm", "node_modules", "disabled-pack");
    await writeJson(path.join(disabledRoot, "package.json"), { name: "disabled-pack", version: "1.0.0" });
    await writeText(path.join(disabledRoot, "skills", "hidden", "SKILL.md"), "---\nname: hidden\ndescription: Hidden skill.\n---\n");
    await writeText(path.join(disabledRoot, "prompts", "hidden.md"), "# Hidden\n");

    const filteredRoot = path.join(piHome, "npm", "node_modules", "filtered-pack");
    await writeJson(path.join(filteredRoot, "package.json"), { name: "filtered-pack", version: "1.0.0" });
    await writeText(path.join(filteredRoot, "skills", "keep", "SKILL.md"), "---\nname: keep\ndescription: Keep this skill.\n---\n");
    await writeText(path.join(filteredRoot, "skills", "drop", "SKILL.md"), "---\nname: drop\ndescription: Drop this skill.\n---\n");
    await writeText(path.join(filteredRoot, "prompts", "run.md"), "# Run\n");

    await writeJson(path.join(piHome, "settings.json"), {
      packages: [
        { source: "npm:disabled-pack", autoload: false, skills: [], prompts: [] },
        { source: "npm:filtered-pack", skills: ["skills/keep/SKILL.md"], prompts: [] },
      ],
    });

    const inventory = await collectAgentCustomizeInventory({ provider: "pi", piHome, workspace });
    const disabled = inventory.plugins.find((plugin) => plugin.name === "disabled-pack");
    assert.ok(disabled);
    assert.equal(disabled.enabled, false);
    assert.deepEqual(disabled.skills, []);
    assert.deepEqual(disabled.commands, []);

    const filtered = inventory.plugins.find((plugin) => plugin.name === "filtered-pack");
    assert.ok(filtered);
    assert.deepEqual(filtered.skills.map((skill) => skill.name), ["keep"]);
    assert.deepEqual(filtered.commands, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi applies project autoload deltas over normalized user package identities", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-pi-delta-"));
  const piHome = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace");
  try {
    const packageRoot = path.join(piHome, "npm", "node_modules", "shared-pack");
    await writeJson(path.join(packageRoot, "package.json"), { name: "shared-pack", version: "1.0.0" });
    await writeText(path.join(packageRoot, "skills", "base", "SKILL.md"), "---\nname: base\ndescription: Base skill.\n---\n");
    await writeText(path.join(packageRoot, "skills", "enabled", "SKILL.md"), "---\nname: enabled\ndescription: Enabled skill.\n---\n");
    await writeText(path.join(packageRoot, "prompts", "base.md"), "# Base prompt\n");
    await writeJson(path.join(piHome, "settings.json"), { packages: ["npm:shared-pack@1.0.0"] });
    await writeJson(path.join(workspace, ".pi", "settings.json"), {
      packages: [{
        source: "npm:shared-pack@2.0.0",
        autoload: false,
        skills: ["skills/enabled/SKILL.md", "-skills/base/SKILL.md"],
        prompts: [],
      }],
    });

    const inventory = await collectAgentCustomizeInventory({ provider: "pi", piHome, workspace });
    const packages = inventory.plugins.filter((plugin) => plugin.name === "shared-pack");
    assert.equal(packages.length, 1, "npm identity should ignore the configured version");
    assert.deepEqual(packages[0].installSources, ["project", "user"]);
    assert.equal(packages[0].resourceState, "selective-autoload");
    assert.deepEqual(packages[0].skills.map((skill) => skill.name), ["enabled"]);
    assert.deepEqual(packages[0].commands.map((command) => command.name), ["base"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi package inventory covers flat skills, direct manifest files, and sanitized git identities", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-pi-resources-"));
  const piHome = path.join(root, ".pi", "agent");
  const workspace = path.join(root, "workspace");
  try {
    const flatRoot = path.join(piHome, "npm", "node_modules", "flat-pack");
    await writeJson(path.join(flatRoot, "package.json"), {
      name: "flat-pack",
      version: "1.0.0",
      pi: {
        skills: ["./skills", "./single-skill.md", "-./skills/drop.md"],
        prompts: ["./single-prompt.md"],
      },
    });
    await writeText(path.join(flatRoot, "skills", "flat.md"), "---\nname: flat\ndescription: Flat skill.\n---\n");
    await writeText(path.join(flatRoot, "skills", "drop.md"), "---\nname: drop\ndescription: Excluded skill.\n---\n");
    await writeText(path.join(flatRoot, "skills", "nested", "SKILL.md"), "---\nname: nested\ndescription: Nested skill.\n---\n");
    await writeText(path.join(flatRoot, "single-skill.md"), "---\nname: single-skill\ndescription: Direct skill.\n---\n");
    await writeText(path.join(flatRoot, "single-prompt.md"), "# Single Prompt\n");

    const gitRoot = path.join(piHome, "git", "github.com", "acme", "private-pack");
    await writeJson(path.join(gitRoot, "package.json"), { name: "private-pack", version: "1.0.0" });
    await writeText(path.join(gitRoot, "skills", "private", "SKILL.md"), "---\nname: private\ndescription: Private skill.\n---\n");
    await writeJson(path.join(piHome, "settings.json"), {
      packages: [
        "npm:flat-pack",
        "git:https://oauth2:secret-token@github.com/acme/private-pack.git@v1.0.0",
      ],
    });

    const inventory = await collectAgentCustomizeInventory({ provider: "pi", piHome, workspace });
    const flat = inventory.plugins.find((plugin) => plugin.name === "flat-pack");
    assert.ok(flat);
    assert.deepEqual(flat.skills.map((skill) => skill.name).sort(), ["flat", "nested", "single-skill"]);
    assert.deepEqual(flat.commands.map((command) => command.name), ["single-prompt"]);
    assert.ok(inventory.plugins.some((plugin) => plugin.name === "private-pack"));
    assert.doesNotMatch(JSON.stringify(inventory), /secret-token/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi discovers ~/.agents/skills from the real user home under a relocated agent dir", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-pi-home-"));
  const userHome = path.join(root, "home");
  const piHome = path.join(root, "custom-agent-dir", "agent");
  const workspace = path.join(root, "workspace");
  try {
    await mkdir(piHome, { recursive: true });
    await writeText(
      path.join(userHome, ".agents", "skills", "global-standard", "SKILL.md"),
      "---\nname: global-standard\ndescription: Global Agent Skills standard workflow.\n---\n",
    );
    await writeText(
      path.join(piHome, "skills", "agent-dir-skill", "SKILL.md"),
      "---\nname: agent-dir-skill\ndescription: Skill under the relocated agent dir.\n---\n",
    );
    await mkdir(workspace, { recursive: true });

    const inventory = await collectAgentCustomizeInventory({ provider: "pi", piHome, piUserHome: userHome, workspace });
    const userSkills = filterManageItems(inventory, { tab: "skills", scopeKind: "user" }).map((item) => item.name);
    assert.ok(userSkills.includes("global-standard"), `expected ~/.agents/skills discovery, got ${userSkills.join(", ")}`);
    assert.ok(userSkills.includes("agent-dir-skill"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function makeWorkbuddyFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-workbuddy-"));
  const workbuddyHome = path.join(root, ".workbuddy");
  const workspace = path.join(root, "workspace");

  const marketplacePluginRoot = path.join(
    workbuddyHome, "plugins", "marketplaces", "codebuddy-plugins-official", "plugins", "find-skills",
  );
  await writeJson(path.join(marketplacePluginRoot, ".codebuddy-plugin", "plugin.json"), {
    name: "find-skills",
    description: "Discover and install agent skills.",
    version: "1.0.0",
  });
  await writeText(
    path.join(marketplacePluginRoot, "skills", "find-skills", "SKILL.md"),
    "---\nname: find-skills\ndescription: Discover and install agent skills.\n---\n",
  );
  await writeJson(path.join(marketplacePluginRoot, ".mcp.json"), {
    mcpServers: {
      "plugin-search": { command: "npx", args: ["-y", "plugin-search-mcp"] },
    },
  });

  const disabledPluginRoot = path.join(
    workbuddyHome, "plugins", "marketplaces", "cb_teams_marketplace", "plugins", "finance-data",
  );
  await writeJson(path.join(disabledPluginRoot, ".codebuddy-plugin", "plugin.json"), {
    name: "finance-data",
    description: "Finance data workflows.",
    version: "2.0.0",
  });

  await writeJson(path.join(workbuddyHome, "settings.json"), {
    enabledPlugins: {
      "find-skills@codebuddy-plugins-official": true,
      "finance-data@cb_teams_marketplace": false,
    },
  });
  await writeJson(path.join(workbuddyHome, ".mcp.json"), {
    mcpServers: {
      "docs-server": { command: "npx", args: ["-y", "docs-mcp"] },
    },
  });
  await writeText(
    path.join(workbuddyHome, "skills", "frontend-slides", "SKILL.md"),
    "---\nname: frontend-slides\ndescription: Build HTML slide decks.\n---\n",
  );
  await writeText(path.join(workbuddyHome, "AGENTS.md"), "# Global WorkBuddy Guidance\n");
  await writeText(path.join(workbuddyHome, "SOUL.md"), "# SOUL\n\nBe genuinely helpful.\n");
  await writeText(path.join(workbuddyHome, "USER.md"), "# USER\n\nPrefers concise answers.\n");

  await writeText(
    path.join(workspace, ".workbuddy", "skills", "wb-workflow", "SKILL.md"),
    "---\nname: wb-workflow\ndescription: WorkBuddy workflow.\n---\n",
  );
  await writeText(
    path.join(workspace, ".agents", "skills", "shared-standard", "SKILL.md"),
    "---\nname: shared-standard\ndescription: Shared Agent Skills standard workflow.\n---\n",
  );
  await writeText(path.join(workspace, "AGENTS.md"), "# WorkBuddy Project Instructions\n");

  return { root, workbuddyHome, workspace };
}

test("collectAgentCustomizeInventory returns WorkBuddy marketplace plugins with enabled state", async () => {
  const fixture = await makeWorkbuddyFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "workbuddy",
      workbuddyHome: fixture.workbuddyHome,
      workspace: fixture.workspace,
    });

    assert.equal(inventory.provider, "workbuddy");
    assert.equal(inventory.workbuddyHome, fixture.workbuddyHome);
    assert.equal(inventory.plugins.length, 2);

    const findSkills = inventory.plugins.find((plugin) => plugin.name === "find-skills");
    assert.ok(findSkills);
    assert.equal(findSkills.installMatch, "workbuddy-marketplace-dir");
    assert.equal(findSkills.enabled, true);
    assert.equal(findSkills.version, "1.0.0");
    assert.deepEqual(findSkills.skills.map((skill) => skill.name), ["find-skills"]);
    assert.deepEqual(findSkills.mcpServers.map((server) => server.name), ["plugin-search"]);

    const finance = inventory.plugins.find((plugin) => plugin.name === "finance-data");
    assert.ok(finance);
    assert.equal(finance.enabled, false);

    assert.equal(inventory.diagnostics.installedPluginState, "workbuddy-marketplace-dirs");
    assert.deepEqual(
      inventory.diagnostics.installedPluginRecordFiles,
      [path.join(fixture.workbuddyHome, "settings.json")],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("agent-customize CLI honours --workbuddy-home instead of the real user home", async () => {
  const fixture = await makeWorkbuddyFixture();
  try {
    const result = runAgentCustomizeCli([
      "inventory",
      "--provider",
      "workbuddy",
      "--workspace",
      fixture.workspace,
      "--workbuddy-home",
      fixture.workbuddyHome,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const inventory = JSON.parse(result.stdout);
    assert.equal(inventory.workbuddyHome, fixture.workbuddyHome);
    assert.notEqual(inventory.workbuddyHome, path.join(os.homedir(), ".workbuddy"));
    assert.ok(inventory.manage.mcps.some((item) => item.name === "docs-server"));
    assert.ok(inventory.manage.mcps.some((item) => item.name === "plugin-search"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("WorkBuddy provider collects user and project skills, MCP servers, and context rules", async () => {
  const fixture = await makeWorkbuddyFixture();

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "workbuddy",
      workbuddyHome: fixture.workbuddyHome,
      workspace: fixture.workspace,
    });

    assert.ok(
      filterManageItems(inventory, { tab: "skills", scopeKind: "user" })
        .some((item) => item.name === "frontend-slides" && item.scope === "user"),
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "skills", scopeKind: "project" }).map((item) => item.name).sort(),
      ["shared-standard", "wb-workflow"],
    );
    assert.ok(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "user" })
        .some((item) => item.name === "docs-server"),
    );
    assert.ok(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "plugin" })
        .some((item) => item.name === "plugin-search" && item.sourceLabel === "Find Skills"),
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "rules", scopeKind: "user" }).map(
        (item) => `${item.name}:${item.sourceKind ?? "native"}`,
      ).sort(),
      ["AGENTS.md:workbuddy-global-context", "SOUL.md:workbuddy-global-context", "USER.md:workbuddy-global-context"].sort(),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function makeGrokFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-agent-customize-grok-"));
  const grokHome = path.join(root, ".grok");
  const workspace = path.join(root, "workspace");

  await writeText(
    path.join(grokHome, "config.toml"),
    [
      '[mcp_servers.docs]',
      'command = "npx"',
      'args = ["-y", "docs-mcp"]',
      "",
      '[mcp_servers.disabled_search]',
      "enabled = false",
      'url = "https://example.invalid/mcp"',
      "",
    ].join("\n"),
  );
  await writeText(
    path.join(grokHome, "skills", "frontend-slides", "SKILL.md"),
    "---\nname: frontend-slides\ndescription: Build HTML slide decks.\n---\n",
  );
  await writeText(
    path.join(grokHome, "bundled", "skills", "help", "SKILL.md"),
    "---\nname: help\ndescription: Grok help skill.\n---\n",
  );
  await writeJson(path.join(grokHome, "hooks", "git-gh-only.json"), {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: "echo start" },
          ],
        },
      ],
    },
  });

  // Prefer native ~/.grok/plugins discovery path (also still accept installed-plugins).
  const pluginRoot = path.join(grokHome, "plugins", "sample-plugin");
  await writeJson(path.join(pluginRoot, "plugin.json"), {
    name: "sample-plugin",
    displayName: "Sample Plugin",
    description: "A sample Grok plugin.",
  });
  await writeText(
    path.join(pluginRoot, "skills", "sample-skill", "SKILL.md"),
    "---\nname: sample-skill\ndescription: Sample plugin skill.\n---\n",
  );

  await writeText(
    path.join(workspace, ".grok", "skills", "project-flow", "SKILL.md"),
    "---\nname: project-flow\ndescription: Project Grok workflow.\n---\n",
  );
  await writeText(
    path.join(workspace, ".grok", "config.toml"),
    [
      '[mcp_servers.project_docs]',
      'command = "npx"',
      "",
    ].join("\n"),
  );
  await writeText(
    path.join(workspace, ".agents", "skills", "shared-standard", "SKILL.md"),
    "---\nname: shared-standard\ndescription: Shared Agent Skills standard workflow.\n---\n",
  );
  await writeText(path.join(workspace, "AGENTS.md"), "# Grok Project Instructions\n");

  return { root, grokHome, workspace };
}

test("collectAgentCustomizeInventory returns Grok skills, MCP, hooks, and installed plugins", async () => {
  const fixture = await makeGrokFixture();
  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "grok",
      grokHome: fixture.grokHome,
      workspace: fixture.workspace,
    });

    assert.equal(inventory.provider, "grok");
    assert.equal(inventory.grokHome, fixture.grokHome);
    assert.equal(inventory.plugins.length, 1);
    assert.equal(inventory.plugins[0].name, "sample-plugin");
    assert.equal(inventory.plugins[0].installMatch, "grok-plugins-dir");
    assert.deepEqual(inventory.plugins[0].skills.map((skill) => skill.name), ["sample-skill"]);
    assert.equal(inventory.diagnostics.installedPluginState, "grok-plugins-dirs");

    assert.ok(
      filterManageItems(inventory, { tab: "skills", scopeKind: "user" })
        .some((item) => item.name === "frontend-slides"),
    );
    assert.ok(
      filterManageItems(inventory, { tab: "skills", scopeKind: "user" })
        .some((item) => item.name === "help"),
    );
    assert.deepEqual(
      filterManageItems(inventory, { tab: "skills", scopeKind: "project" }).map((item) => item.name).sort(),
      ["project-flow", "shared-standard"],
    );
    assert.ok(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "user" })
        .some((item) => item.name === "docs" && item.enabled !== false),
    );
    assert.ok(
      filterManageItems(inventory, { tab: "mcps", scopeKind: "project" })
        .some((item) => item.name === "project_docs"),
    );
    const disabled = filterManageItems(inventory, { tab: "mcps", scopeKind: "user" })
      .find((item) => item.name === "disabled_search");
    assert.ok(disabled);
    assert.equal(disabled.enabled, false);
    assert.ok(
      filterManageItems(inventory, { tab: "hooks", scopeKind: "user" })
        .some((item) => (item.label ?? item.name ?? "").includes("PreToolUse")
          || item.evidence?.path?.includes("git-gh-only")),
    );
    assert.equal(inventory.diagnostics.configPath, path.join(fixture.grokHome, "config.toml"));
    // Inventory may mention secret *policy* labels; values themselves must stay absent.
    assert.doesNotMatch(JSON.stringify(inventory), /sk-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]+/u);
    assert.ok(inventory.unsupported.some((item) => /auth\.json/u.test(item)));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("agent-customize CLI honours --grok-home instead of the real user home", async () => {
  const fixture = await makeGrokFixture();
  try {
    const result = runAgentCustomizeCli([
      "inventory",
      "--provider",
      "grok",
      "--workspace",
      fixture.workspace,
      "--grok-home",
      fixture.grokHome,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const inventory = JSON.parse(result.stdout);
    assert.equal(inventory.grokHome, fixture.grokHome);
    assert.notEqual(inventory.grokHome, path.join(os.homedir(), ".grok"));
    assert.ok(inventory.manage.mcps.some((item) => item.name === "docs"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Grok plugin inventory dedupes one physical plugin reached through multiple roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-grok-plugin-dedupe-"));
  const grokHome = path.join(root, ".grok");
  const workspace = path.join(root, "workspace");
  const pluginDir = path.join(grokHome, "plugins", "sample-plugin");
  await writeJson(path.join(pluginDir, "plugin.json"), {
    name: "sample-plugin",
    displayName: "Sample Plugin",
  });
  // Alias the same physical plugin directory via config paths and project tree.
  const pluginsRoot = path.join(grokHome, "plugins");
  await writeText(
    path.join(grokHome, "config.toml"),
    [
      "[plugins]",
      `paths = ["${pluginsRoot.replaceAll("\\", "/")}"]`,
      "",
    ].join("\n"),
  );
  await mkdir(path.join(workspace, ".grok"), { recursive: true });
  try {
    await symlink(path.join(grokHome, "plugins"), path.join(workspace, ".grok", "plugins"));
  } catch {
    // Windows without symlink privilege: copy path alias only via config.
  }

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "grok",
      grokHome,
      workspace,
    });
    assert.equal(inventory.plugins.length, 1);
    assert.equal(inventory.plugins[0].name, "sample-plugin");
    assert.ok(inventory.plugins[0].installSources.includes("grok-plugins-dir"));
    assert.ok(inventory.plugins[0].installSources.includes("grok-plugins-path-config"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Grok plugin inventory keeps distinct roots that share a plugin directory name", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-grok-plugin-name-clash-"));
  const grokHome = path.join(root, "home", ".grok");
  const workspace = path.join(root, "workspace");
  await writeJson(path.join(grokHome, "plugins", "flow", "plugin.json"), { name: "flow" });
  await writeJson(path.join(workspace, ".grok", "plugins", "flow", "plugin.json"), { name: "flow" });

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "grok",
      grokHome,
      workspace,
    });
    assert.equal(inventory.plugins.length, 2);
    // Same directory name, different physical roots: ids must stay distinguishable
    // so downstream collision diagnostics are not silently collapsed.
    assert.equal(new Set(inventory.plugins.map((plugin) => plugin.id)).size, 2);
    assert.deepEqual(
      inventory.plugins.map((plugin) => plugin.installMatch).sort(),
      ["grok-plugins-dir", "grok-project-plugins-dir"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Grok plugin paths from the user and project config are unioned, not replaced", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-grok-plugin-paths-"));
  const grokHome = path.join(root, "home", ".grok");
  const workspace = path.join(root, "workspace");
  const userExtraRoot = path.join(root, "user-extra-plugins");
  const projectExtraRoot = path.join(root, "project-extra-plugins");
  await writeJson(path.join(userExtraRoot, "alpha", "plugin.json"), { name: "alpha" });
  await writeJson(path.join(projectExtraRoot, "beta", "plugin.json"), { name: "beta" });
  await writeText(
    path.join(grokHome, "config.toml"),
    ["[plugins]", `paths = ["${userExtraRoot.replaceAll("\\", "/")}"]`, ""].join("\n"),
  );
  await writeText(
    path.join(workspace, ".grok", "config.toml"),
    ["[plugins]", `paths = ["${projectExtraRoot.replaceAll("\\", "/")}"]`, ""].join("\n"),
  );

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "grok",
      grokHome,
      workspace,
    });
    assert.deepEqual(inventory.plugins.map((plugin) => plugin.name).sort(), ["alpha", "beta"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Grok inventory reports no user config path when the user home is out of scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-grok-project-scope-"));
  const grokHome = path.join(root, "home", ".grok");
  const workspace = path.join(root, "workspace");
  await writeJson(path.join(grokHome, "plugins", "user-only", "plugin.json"), { name: "user-only" });
  await writeText(path.join(workspace, ".grok", "config.toml"), "[plugins]\n");

  try {
    const inventory = await collectAgentCustomizeInventory({
      provider: "grok",
      grokHome,
      workspace,
      includeUserHome: false,
    });
    assert.equal(inventory.plugins.length, 0);
    assert.deepEqual(inventory.diagnostics.installedPluginRecordFiles, []);
    assert.equal(inventory.diagnostics.configPath, null);
    assert.equal(
      inventory.diagnostics.projectConfigPath,
      path.join(workspace, ".grok", "config.toml"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Grok project skills dedupe when .grok/skills symlinks to .agents/skills", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-grok-skill-symlink-"));
  const grokHome = path.join(root, "home", ".grok");
  const workspace = path.join(root, "workspace");
  try {
    await mkdir(path.join(grokHome), { recursive: true });
    await writeText(
      path.join(workspace, ".agents", "skills", "shared-flow", "SKILL.md"),
      "---\nname: shared-flow\ndescription: Shared SoT skill.\n---\n",
    );
    await mkdir(path.join(workspace, ".grok"), { recursive: true });
    await symlink(
      path.join(workspace, ".agents", "skills"),
      path.join(workspace, ".grok", "skills"),
      "dir",
    );

    const inventory = await collectAgentCustomizeInventory({
      provider: "grok",
      grokHome,
      workspace,
      includeUserHome: false,
    });
    const projectSkills = filterManageItems(inventory, {
      tab: "skills",
      scopeKind: "project",
    });
    assert.deepEqual(
      projectSkills.map((item) => item.name).sort(),
      ["shared-flow"],
    );
    assert.equal(projectSkills.length, 1);
    const evidencePath = projectSkills[0]?.evidence?.path ?? projectSkills[0]?.filePath ?? "";
    assert.match(evidencePath.replace(/\\/gu, "/"), /\.agents\/skills\/shared-flow\/SKILL\.md$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
