import {
  BETTER_HARNESS_REPOSITORY,
  defineHostProfile,
  defineSurface,
  desktopUi,
  evidence,
  operation,
  shell,
} from "../profile-builders.mjs";

export default defineHostProfile({
  hostId: "codex",
  aliases: [],
  displayName: "Codex",
  provider: "codex",
  inventoryHomeRoutes: [
    { option: "codexHome", relativePath: "", fallbackLabel: "~/.codex" },
    {
      option: "codexAppPath",
      relativePath: "Applications/Codex.app",
      fallbackLabel: "<system-applications>/Codex.app",
    },
  ],
  managed: true,
  executables: ["codex"],
  surfaces: [
    defineSurface({
      surfaceId: "cli",
      displayName: "Codex CLI",
      distributionKind: "marketplace",
      scopes: ["user"],
      defaultScope: "user",
      nativeHomeBinding: {
        kind: "environment",
        variable: "CODEX_HOME",
        contractEvidence: evidence("codex-home-environment", "native-runtime-contract"),
      },
      lifecycle: {
        install: operation("supported", [
          shell(
            ["codex", "plugin", "marketplace", "add", BETTER_HARNESS_REPOSITORY, "--ref", "main"],
            "The Better Harness marketplace snapshot is configured.",
          ),
          shell(
            ["codex", "plugin", "add", "better-harness@better-harness"],
            "The plugin is installed from the configured marketplace.",
          ),
        ], evidence("codex-plugin-add")),
        update: operation("supported", [
          shell(
            ["codex", "plugin", "marketplace", "upgrade", "better-harness"],
            "The configured Better Harness marketplace snapshot is refreshed.",
          ),
        ], evidence("codex-marketplace-upgrade")),
        remove: operation("supported", [
          shell(
            ["codex", "plugin", "remove", "better-harness@better-harness"],
            "The plugin selection and cached install are removed; the marketplace remains configured.",
          ),
        ], evidence("codex-plugin-remove")),
        verify: operation("supported", [
          shell(
            ["codex", "plugin", "list", "--marketplace", "better-harness", "--json"],
            "The marketplace inventory reports Better Harness.",
          ),
        ], evidence("codex-plugin-list")),
      },
    }),
    defineSurface({
      surfaceId: "desktop",
      displayName: "Codex Desktop",
      distributionKind: "marketplace",
      scopes: ["user"],
      defaultScope: "user",
      observation: {
        kind: "desktop-cache",
        discoveryDiagnostic: "appBundleExists",
        evidenceRouteOption: "codexAppPath",
      },
      lifecycle: {
        install: operation("manual", [
          desktopUi(
            "Open Settings > Plugins, add the Better Harness Git marketplace at ref main, then install Better Harness.",
            "Better Harness appears installed in Settings > Plugins.",
          ),
        ], evidence("codex-desktop-install", "curated-native-ui")),
        update: operation("manual", [
          desktopUi(
            "Use Settings > Plugins to refresh the marketplace and update Better Harness.",
            "The installed plugin reports the intended version.",
          ),
        ], evidence("codex-desktop-update", "curated-native-ui")),
        remove: operation("manual", [
          desktopUi(
            "Use Settings > Plugins to remove Better Harness; retain reports and the marketplace unless explicitly desired.",
            "Better Harness no longer appears installed.",
          ),
        ], evidence("codex-desktop-remove", "curated-native-ui")),
        verify: operation("manual", [
          desktopUi(
            "Confirm Better Harness is installed in Settings > Plugins, then start a new task.",
            "The new task can discover the Better Harness Skill.",
          ),
        ], evidence("codex-desktop-verify", "curated-native-ui")),
      },
    }),
  ],
});
