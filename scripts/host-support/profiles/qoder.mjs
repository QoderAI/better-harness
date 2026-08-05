import {
  defineHostProfile,
  defineSurface,
  evidence,
  manual,
  operation,
  shell,
} from "../profile-builders.mjs";

export default defineHostProfile({
  hostId: "qoder",
  aliases: [],
  displayName: "Qoder",
  provider: "qoder",
  inventoryHomeRoutes: [
    { option: "qoderHome", relativePath: "", fallbackLabel: "~/.qoder" },
    {
      option: "qoderSharedClientCacheRoot",
      relativePath: "SharedClientCache",
      fallbackLabel: "<platform-config>/Qoder/SharedClientCache",
    },
  ],
  managed: true,
  executables: ["qodercli"],
  surfaces: [
    defineSurface({
      surfaceId: "desktop",
      displayName: "Qoder Desktop",
      distributionKind: "bundled",
      scopes: ["bundled"],
      defaultScope: "bundled",
      observation: { kind: "bundled", discoverySource: "unobserved" },
      lifecycle: {
        install: operation("not-applicable"),
        update: operation("manual", [
          manual(
            "Update Qoder Desktop through its supported application update route.",
            "A new Qoder session exposes the bundled Better Harness version.",
          ),
        ], evidence("qoder-desktop-bundle", "curated-native-ui")),
        remove: operation("not-applicable"),
        verify: operation("manual", [
          manual(
            "Start a new Qoder session or open Better Harness (Beta) in Quest on Qoder 1.18.0 or newer.",
            "The bundled Better Harness entrypoint is visible.",
          ),
        ], evidence("qoder-desktop-bundle", "curated-native-ui")),
      },
    }),
    defineSurface({
      surfaceId: "cli",
      displayName: "Qoder CLI",
      distributionKind: "marketplace",
      scopes: ["user", "project", "local"],
      defaultScope: "user",
      lifecycle: {
        install: operation("manual", [
          manual(
            "Use the current Qoder marketplace flow, then install better-harness@better-harness at the selected scope.",
            "qodercli plugin list --json reports Better Harness.",
          ),
        ], evidence("qoder-marketplace-command-drift", "contract-drift")),
        update: operation("unavailable"),
        remove: operation("supported", [
          shell(
            ["qodercli", "plugin", "uninstall", "better-harness", "--scope", "{scope}"],
            "The selected Better Harness plugin installation is removed.",
          ),
        ], evidence("qoder-plugin-uninstall")),
        verify: operation("supported", [
          shell(
            ["qodercli", "plugin", "list", "--json"],
            "The installed plugin inventory reports Better Harness.",
          ),
        ], evidence("qoder-plugin-list")),
      },
    }),
  ],
});
