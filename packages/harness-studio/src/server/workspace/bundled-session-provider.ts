import type { StudioWorkspaceDiscovery, StudioWorkspaceSessionProvider } from "../studio-types.js";

interface BundledWorkspaceRuntime {
  createInspectorWorkspaceSessionProvider(): {
    discover(workspacePath: string): Promise<StudioWorkspaceDiscovery>;
  };
}

/**
 * Published CLI adapter for repository-owned Inspector discovery. The bundled
 * runtime is loaded only after the user chooses a Project directory.
 */
export function createBundledInspectorWorkspaceSessionProvider(): StudioWorkspaceSessionProvider {
  let runtime: Promise<BundledWorkspaceRuntime> | undefined;
  return {
    async discover(workspacePath) {
      runtime ??= import(new URL("../runtime/inspector-workspace-runtime.mjs", import.meta.url).href) as Promise<BundledWorkspaceRuntime>;
      const provider = (await runtime).createInspectorWorkspaceSessionProvider();
      return await provider.discover(workspacePath);
    },
  };
}
