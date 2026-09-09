/**
 * The bundle's public surface.
 *
 * `activateArtifactRuntime` exists so the Host installs the bridge into the very
 * runtime instance this bundle linked against. Reaching for a shared global
 * instead would silently break the moment two builds, or a staging and a current
 * frame, are alive at once.
 */
export function entryModuleSource(entryModule: string): string {
  return [
    'import { clearActiveArtifactRuntime, setActiveArtifactRuntime } from "@studio/agent-react";',
    `import artifactView from ${JSON.stringify(entryModule)};`,
    "export const view = artifactView;",
    "let activeBridge;",
    "export function activateArtifactRuntime(bridge) {",
    "  activeBridge = bridge;",
    "  setActiveArtifactRuntime(bridge);",
    "  return artifactView;",
    "}",
    "export function deactivateArtifactRuntime() {",
    "  if (activeBridge !== undefined) clearActiveArtifactRuntime(activeBridge);",
    "  activeBridge = undefined;",
    "}",
  ].join("\n");
}
