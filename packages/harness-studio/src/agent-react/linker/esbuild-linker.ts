import { build, type Message, type Plugin } from "esbuild-wasm";
import type { Diagnostic } from "../contracts/index.js";
import type { AllowedPackageResolver } from "./allowed-packages.js";

/**
 * The esbuild Linker.
 *
 * Oxc already produced plain ESM, so esbuild is not asked to transform anything:
 * it resolves the module graph, applies the allowlist a second time, and emits one
 * file. Letting esbuild re-parse TSX here would put a second, unvalidated compiler
 * on the hot path and the Profile would no longer describe what actually shipped.
 */

export const LINK_ENTRY = "agent-react:bundle-entry";
const VIRTUAL_NAMESPACE = "agent-react";
const ENTRY_NAMESPACE = "agent-react-entry";

export interface LinkInput {
  /** Compiled ESM per Revision-relative module path. */
  readonly compiledModules: ReadonlyMap<string, string>;
  readonly entryModule: string;
  readonly resolver: AllowedPackageResolver;
  readonly maxOutputBytes: number;
}

export type LinkResult =
  | { readonly status: "ready"; readonly bundle: string; readonly diagnostics: readonly Diagnostic[] }
  | { readonly status: "failed"; readonly diagnostics: readonly Diagnostic[] };

/**
 * The bundle's public surface.
 *
 * `activateArtifactRuntime` exists so the Host installs the bridge into the very
 * runtime instance this bundle linked against. Reaching for a shared global
 * instead would silently break the moment two builds, or a staging and a current
 * frame, are alive at once.
 */
function entryModuleSource(entryModule: string): string {
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

export async function linkArtifactBundle(input: LinkInput): Promise<LinkResult> {
  const rejectedPackages: string[] = [];
  let result;
  try {
    result = await build({
      entryPoints: [LINK_ENTRY],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      sourcemap: false,
      legalComments: "none",
      logLevel: "silent",
      outfile: "artifact-bundle.js",
      plugins: [linkPlugin(input, rejectedPackages)],
    });
  } catch (error) {
    return { status: "failed", diagnostics: linkDiagnostics(error, rejectedPackages) };
  }

  const output = result.outputFiles.find((file) => file.path.endsWith(".js"));
  if (output === undefined) {
    return {
      status: "failed",
      diagnostics: [{ level: "error", code: "link/failed", message: "Linker produced no JavaScript output." }],
    };
  }
  if (output.contents.byteLength > input.maxOutputBytes) {
    return {
      status: "failed",
      diagnostics: [{
        level: "error",
        code: "limit/output-bytes",
        message: `Linked bundle is ${output.contents.byteLength} bytes, over the ${input.maxOutputBytes}-byte limit.`,
      }],
    };
  }
  return {
    status: "ready",
    bundle: output.text,
    diagnostics: result.warnings.map((message) => messageDiagnostic(message, "warning", "link/failed")),
  };
}

function linkPlugin(input: LinkInput, rejectedPackages: string[]): Plugin {
  const { compiledModules, entryModule, resolver } = input;
  return {
    name: "agent-react-linker",
    setup(api) {
      api.onResolve({ filter: new RegExp(`^${LINK_ENTRY}$`) }, () => ({ path: LINK_ENTRY, namespace: ENTRY_NAMESPACE }));
      api.onLoad({ filter: /.*/, namespace: ENTRY_NAMESPACE }, () => ({
        loader: "js",
        contents: entryModuleSource(entryModule),
      }));

      api.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return undefined;
        const external = resolver.resolveRuntimePackage(args.path);
        if (external !== undefined) return { path: external, external: true };
        if (!args.path.startsWith(".") && !args.path.startsWith("/")) {
          rejectedPackages.push(args.path);
          return { errors: [{ text: resolver.rejectPackage(args.path) }] };
        }
        // `args.namespace` names the importer's namespace, so the generated entry
        // resolves relative to the Revision's entry module rather than to itself.
        const importer = args.namespace === ENTRY_NAMESPACE ? entryModule : args.importer;
        const resolved = resolver.resolveInternal(importer, args.path);
        if (resolved === undefined) {
          return { errors: [{ text: `Artifact import '${args.path}' is not part of this Artifact Revision.` }] };
        }
        return { path: resolved, namespace: VIRTUAL_NAMESPACE };
      });

      api.onLoad({ filter: /.*/, namespace: VIRTUAL_NAMESPACE }, (args) => {
        const contents = compiledModules.get(args.path);
        if (contents === undefined) {
          return { errors: [{ text: `Artifact module '${args.path}' has no compiled output.` }] };
        }
        return { loader: "js", contents };
      });
    },
  };
}

/**
 * A refused package is classified from what the resolver actually rejected, not
 * from esbuild's message text: matching on prose would silently reclassify every
 * diagnostic the day the wording changes.
 */
function linkDiagnostics(error: unknown, rejectedPackages: readonly string[]): Diagnostic[] {
  const code = rejectedPackages.length > 0 ? "link/package-not-allowed" : "link/failed";
  const messages = (error as { errors?: Message[] }).errors;
  if (Array.isArray(messages) && messages.length > 0) {
    return messages.map((message) => messageDiagnostic(message, "error", code));
  }
  return [{
    level: "error",
    code,
    message: error instanceof Error ? error.message : String(error),
  }];
}

function messageDiagnostic(
  message: Message,
  level: "error" | "warning",
  code: "link/failed" | "link/package-not-allowed",
): Diagnostic {
  return {
    level,
    code,
    message: message.text,
    ...(message.location?.file === undefined ? {} : { module: message.location.file }),
    ...(message.location?.line === undefined ? {} : { line: message.location.line }),
    ...(message.location?.column === undefined ? {} : { column: message.location.column }),
  };
}
