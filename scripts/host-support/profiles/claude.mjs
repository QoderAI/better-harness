import {
  defineHostProfile,
  defineSurface,
  evidence,
  hostCommand,
  operation,
  shell,
} from "../profile-builders.mjs";

export default defineHostProfile({
  hostId: "claude",
  aliases: ["claude-code"],
  displayName: "Claude Code",
  provider: "claude",
  inventoryHomeRoutes: [
    { option: "claudeHome", relativePath: "", fallbackLabel: "~/.claude" },
    { option: "claudeStatePath", relativePath: ".claude.json", fallbackLabel: "~/.claude.json" },
  ],
  managed: true,
  executables: ["claude"],
  surfaces: [defineSurface({
    surfaceId: "cli",
    displayName: "Claude Code CLI",
    distributionKind: "marketplace",
    scopes: ["user", "project", "local"],
    defaultScope: "user",
    nativeHomeBinding: {
      kind: "environment",
      variable: "CLAUDE_CONFIG_DIR",
      contractEvidence: evidence("claude-config-dir-environment", "native-runtime-contract"),
    },
    lifecycle: {
      install: operation("supported", [
        hostCommand(
          "/plugin marketplace add QoderAI/better-harness",
          "The Better Harness marketplace is registered.",
        ),
        shell(
          ["claude", "plugin", "install", "better-harness@better-harness", "--scope", "{scope}"],
          "The plugin is installed at the selected scope.",
        ),
      ], evidence("claude-plugin-install")),
      update: operation("supported", [
        shell(
          ["claude", "plugin", "update", "better-harness@better-harness", "--scope", "{scope}"],
          "The plugin is updated; a new session is required.",
        ),
      ], evidence("claude-plugin-update")),
      remove: operation("supported", [
        shell(
          ["claude", "plugin", "uninstall", "better-harness@better-harness", "--scope", "{scope}"],
          "Only the selected Better Harness installation is removed.",
        ),
      ], evidence("claude-plugin-uninstall")),
      verify: operation("supported", [
        shell(
          ["claude", "plugin", "details", "better-harness@better-harness"],
          "Plugin details include the better-harness Skill.",
        ),
      ], evidence("claude-plugin-details")),
    },
  })],
});
