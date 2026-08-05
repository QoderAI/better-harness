import {
  defineHostProfile,
  defineSurface,
  operation,
} from "../profile-builders.mjs";

export default defineHostProfile({
  hostId: "workbuddy",
  aliases: [],
  displayName: "WorkBuddy",
  provider: "workbuddy",
  inventoryHomeRoutes: [
    { option: "workbuddyHome", relativePath: "", fallbackLabel: "~/.workbuddy" },
    { option: "workbuddyUserHome", relativePath: "", fallbackLabel: "~" },
  ],
  managed: false,
  executables: [],
  surfaces: [defineSurface({
    surfaceId: "skills",
    displayName: "WorkBuddy Skills",
    distributionKind: "source-local",
    scopes: ["user"],
    defaultScope: "user",
    docsPath: "docs/docs/hosts/adapter-matrix.md",
    lifecycle: {
      install: operation("unavailable"),
      update: operation("unavailable"),
      remove: operation("unavailable"),
      verify: operation("unavailable"),
    },
  })],
});
