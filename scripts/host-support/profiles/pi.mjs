import {
  defineHostProfile,
  defineSurface,
  evidence,
  manual,
  operation,
} from "../profile-builders.mjs";

export default defineHostProfile({
  hostId: "pi",
  aliases: [],
  displayName: "Pi",
  provider: "pi",
  inventoryHomeRoutes: [
    { option: "piHome", relativePath: "", fallbackLabel: "~/.pi/agent" },
    { option: "piUserHome", relativePath: "", fallbackLabel: "~" },
  ],
  managed: true,
  executables: ["pi"],
  surfaces: [
    defineSurface({
      surfaceId: "cli",
      displayName: "Pi CLI",
      distributionKind: "package",
      scopes: ["user", "project"],
      defaultScope: "user",
      observation: { kind: "inventory" },
      lifecycle: {
        install: operation("manual", [
          manual(
            "Use `pi install https://github.com/QoderAI/better-harness` for user scope, or add the package to the workspace `.pi/settings.json` package list for project scope.",
            "Pi persists the package at the selected scope and discovers the better-harness Skill and prompt template.",
          ),
        ], evidence("pi-persistent-package-settings-source", "installed-package-source")),
        update: operation("unavailable"),
        remove: operation("unavailable"),
        verify: operation("manual", [
          manual(
            "Inspect the Pi user or project package settings and start a new session to confirm the better-harness Skill.",
            "The package settings and enabled resources include Better Harness at the selected persistent scope.",
          ),
        ], evidence("pi-persistent-package-settings-source", "installed-package-source")),
      },
    }),
    defineSurface({
      surfaceId: "cli-session",
      displayName: "Pi CLI session",
      distributionKind: "package",
      scopes: ["session"],
      defaultScope: "session",
      observation: { kind: "session-only" },
      lifecycle: {
        install: operation("manual", [
          manual(
            "Start Pi with `pi -e git:github.com/QoderAI/better-harness`.",
            "That Pi session discovers the better-harness Skill and prompt template without persisting a package setting.",
          ),
        ], evidence("pi-temporary-extension-source", "installed-package-source")),
        update: operation("not-applicable"),
        remove: operation("not-applicable"),
        verify: operation("manual", [
          manual(
            "In the same Pi session started with `pi -e git:github.com/QoderAI/better-harness`, confirm that the better-harness Skill and prompt template are available.",
            "The current Pi session exposes Better Harness; persistent package settings remain unchanged.",
          ),
        ], evidence("pi-temporary-extension-source", "installed-package-source")),
      },
    }),
  ],
});
