import {
  defineHostProfile,
  defineSurface,
  evidence,
  operation,
  shell,
} from "../profile-builders.mjs";

export default defineHostProfile({
  hostId: "qwen",
  aliases: ["qwen-code"],
  displayName: "Qwen Code",
  provider: "qwen",
  inventoryHomeRoutes: [
    { option: "qwenHome", relativePath: "", fallbackLabel: "~/.qwen" },
  ],
  managed: true,
  executables: ["qwen"],
  surfaces: [defineSurface({
    surfaceId: "cli",
    displayName: "Qwen Code CLI",
    distributionKind: "extension",
    scopes: ["user", "project"],
    defaultScope: "user",
    scopeValues: { user: "user", project: "project" },
    scopeArtifactPolicy: "shared",
    scopeArtifactEvidence: evidence("qwen-shared-extension-artifact", "native-runtime-contract"),
    nativeHomeBinding: {
      kind: "environment",
      variable: "QWEN_HOME",
      contractEvidence: evidence("qwen-home-environment", "native-runtime-contract"),
    },
    lifecycle: {
      install: operation("supported", [
        shell(
          ["qwen", "extensions", "install", "QoderAI/better-harness", "--scope", "{scopeValue}"],
          "The Better Harness extension is installed at the selected scope.",
        ),
      ], evidence("qwen-extensions-install")),
      update: operation("unavailable", [], evidence("qwen-extensions-update")),
      remove: operation("unavailable", [], evidence("qwen-extensions-uninstall")),
      verify: operation("supported", [
        shell(
          ["qwen", "extensions", "list"],
          "The extension inventory reports Better Harness.",
        ),
      ], evidence("qwen-extensions-list")),
    },
  })],
});
