import {
  defineHostProfile,
  defineSurface,
  evidence,
  manual,
  operation,
} from "../profile-builders.mjs";

export default defineHostProfile({
  hostId: "cursor",
  aliases: ["cursor-agent"],
  displayName: "Cursor",
  provider: "cursor",
  inventoryHomeRoutes: [
    { option: "cursorHome", relativePath: "", fallbackLabel: "~/.cursor" },
    {
      option: "stateDbPath",
      relativePath: "state.vscdb",
      fallbackLabel: "<platform-config>/Cursor/User/globalStorage/state.vscdb",
    },
  ],
  managed: true,
  executables: ["cursor-agent"],
  surfaces: [defineSurface({
    surfaceId: "agent",
    displayName: "Cursor Agent",
    distributionKind: "source-local",
    scopes: ["session"],
    defaultScope: "session",
    lifecycle: {
      install: operation("unavailable", [], evidence("cursor-plugin-dir-help-drift", "contract-drift")),
      update: operation("unavailable", [], evidence("cursor-plugin-dir-help-drift", "contract-drift")),
      remove: operation("not-applicable"),
      verify: operation("manual", [
        manual(
          "Verify the source-local plugin in the same Cursor Agent session that loaded it.",
          "The session discovers the better-harness Skill.",
        ),
      ], evidence("cursor-session-plugin", "curated-native-session")),
    },
  })],
});
