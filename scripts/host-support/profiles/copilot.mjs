import {
  defineHostProfile,
  defineSurface,
  evidence,
  operation,
  shell,
} from "../profile-builders.mjs";

export default defineHostProfile({
  hostId: "copilot",
  aliases: ["github-copilot"],
  displayName: "GitHub Copilot",
  provider: "copilot",
  inventoryHomeRoutes: [
    { option: "copilotHome", relativePath: "", fallbackLabel: "~/.copilot" },
    { option: "copilotUserHome", relativePath: "", fallbackLabel: "~" },
  ],
  managed: true,
  executables: ["copilot"],
  surfaces: [defineSurface({
    surfaceId: "cli",
    displayName: "GitHub Copilot CLI",
    distributionKind: "marketplace",
    scopes: ["user"],
    defaultScope: "user",
    lifecycle: {
      install: operation("supported", [
        shell(
          ["copilot", "plugin", "marketplace", "add", "QoderAI/better-harness"],
          "The Better Harness marketplace is registered.",
        ),
        shell(
          ["copilot", "plugin", "install", "better-harness@better-harness"],
          "The Better Harness plugin is installed.",
        ),
      ], evidence("copilot-plugin-install")),
      update: operation("supported", [
        shell(
          ["copilot", "plugin", "update", "better-harness@better-harness"],
          "The Better Harness plugin is updated.",
        ),
      ], evidence("copilot-plugin-update")),
      remove: operation("supported", [
        shell(
          ["copilot", "plugin", "uninstall", "better-harness@better-harness"],
          "The Better Harness plugin is uninstalled.",
        ),
      ], evidence("copilot-plugin-uninstall")),
      verify: operation("supported", [
        shell(["copilot", "plugin", "list"], "The plugin inventory reports Better Harness."),
        shell(["copilot", "skill", "list", "--json"], "The Skill inventory reports better-harness."),
      ], evidence("copilot-plugin-list")),
    },
  })],
});
