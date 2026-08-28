import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild-wasm";
import type { ArtifactBuildDiagnostic } from "../../../contracts/artifact.js";
import type { BuildSnapshot, Diagnostic } from "../../../agent-react/contracts/index.js";
import {
  createBuildCoordinator,
  createWorkerOxcCompiler,
  loadAgentReactProject,
  type AgentReactSourceStamp,
} from "../../../agent-react/host/index.js";
import type { TrustedRuntimePackage } from "../../../agent-react/linker/index.js";

const PRODUCTION_RUNTIME_PACKAGES: readonly TrustedRuntimePackage[] = Object.freeze([
  { specifier: "react", external: "react" },
  { specifier: "@studio/agent-react", external: "@studio/agent-react" },
  { specifier: "@studio/agent-react/jsx-dev-runtime", external: "@studio/agent-react/jsx-dev-runtime" },
]);

export interface AgentReactProductionCompileOptions {
  readonly artifactRoot: string;
  readonly entryPath: string;
  readonly viewId: string;
  readonly maxModules: number;
  readonly maxSourceBytes: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
}

export interface AgentReactProductionCompileResult {
  readonly status: "ready" | "failed";
  /** False for deadline failures, which must be retried instead of cached. */
  readonly cacheable: boolean;
  readonly code?: string;
  readonly diagnostics: readonly ArtifactBuildDiagnostic[];
  readonly sources: ReadonlyMap<string, AgentReactSourceStamp>;
  readonly snapshot?: BuildSnapshot;
}

/** Compile, profile, link, and package one explicit AgentReact project. */
export async function compileAgentReactProduction(
  options: AgentReactProductionCompileOptions,
): Promise<AgentReactProductionCompileResult> {
  const compiler = createWorkerOxcCompiler({ timeoutMs: Math.min(options.timeoutMs, 5_000) });
  try {
    return await withinDeadline((async () => {
      const loaded = await loadAgentReactProject({
        root: options.artifactRoot,
        entry: options.entryPath,
        artifactId: options.viewId,
        compiler,
        allowedPackages: PRODUCTION_RUNTIME_PACKAGES.map((entry) => entry.specifier),
        maxModules: options.maxModules,
        maxSourceBytes: options.maxSourceBytes,
      });
      if (loaded.diagnostics.some((diagnostic) => diagnostic.level === "error")) {
        return {
          status: "failed" as const,
          cacheable: !hasCompileDeadline(loaded.diagnostics),
          diagnostics: loaded.diagnostics.map(artifactDiagnostic),
          sources: loaded.sources,
        };
      }
      const snapshot = await createBuildCoordinator({
        compiler,
        runtimePackages: PRODUCTION_RUNTIME_PACKAGES,
        maxModules: options.maxModules,
        maxOutputBytes: options.maxOutputBytes,
      }).build(loaded.revision);
      if (snapshot.status !== "ready") {
        return {
          status: "failed" as const,
          cacheable: !hasCompileDeadline(snapshot.diagnostics),
          diagnostics: snapshot.diagnostics.map(artifactDiagnostic),
          sources: loaded.sources,
          snapshot,
        };
      }
      const code = await packageAgentReactBundle(snapshot, options.maxOutputBytes);
      return {
        status: "ready" as const,
        cacheable: true,
        code,
        diagnostics: snapshot.diagnostics.map(artifactDiagnostic),
        sources: loaded.sources,
        snapshot,
      };
    })(), options.timeoutMs);
  } catch (error) {
    return {
      status: "failed",
      cacheable: !(error instanceof AgentReactBuildDeadlineExceeded),
      diagnostics: [{
        level: "error",
        message: error instanceof AgentReactBuildDeadlineExceeded
          ? `AgentReact build exceeded the ${options.timeoutMs}ms deadline.`
          : error instanceof Error ? error.message : String(error),
      }],
      sources: new Map(),
    };
  } finally {
    await compiler.close();
  }
}

function hasCompileDeadline(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.code === "limit/compile-timeout");
}

async function packageAgentReactBundle(snapshot: BuildSnapshot, maxOutputBytes: number): Promise<string> {
  const result = await build({
    entryPoints: ["agent-react:production-entry"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    outfile: "agent-react-preview.js",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [productionBundlePlugin(snapshot)],
  });
  const output = result.outputFiles.find((file) => file.path.endsWith(".js"));
  if (output === undefined) throw new Error("AgentReact production packager emitted no JavaScript.");
  if (output.contents.byteLength > maxOutputBytes) {
    throw new Error(`AgentReact production bundle exceeds the ${maxOutputBytes}-byte output limit.`);
  }
  return output.text;
}

function productionBundlePlugin(snapshot: BuildSnapshot): Plugin {
  return {
    name: "studio-agent-react-production",
    setup(api) {
      api.onResolve({ filter: /^agent-react:production-entry$/ }, () => ({ path: "production-entry", namespace: "studio-agent-react" }));
      api.onResolve({ filter: /^agent-react:validated-bundle$/ }, () => ({ path: "validated-bundle", namespace: "studio-agent-react" }));
      api.onLoad({ filter: /^production-entry$/, namespace: "studio-agent-react" }, () => ({
        loader: "js",
        contents: productionEntrySource(),
      }));
      api.onLoad({ filter: /^validated-bundle$/, namespace: "studio-agent-react" }, () => ({
        loader: "js",
        contents: snapshot.bundle,
        resolveDir: "/",
      }));
      api.onResolve({ filter: /^@studio\/agent-react$/ }, async () => ({ path: await runtimeModule("index") }));
      api.onResolve({ filter: /^@studio\/agent-react\/jsx-dev-runtime$/ }, async () => ({ path: await runtimeModule("jsx-dev-runtime") }));
      api.onResolve({ filter: /^(?:react|react-dom)(?:\/.*)?$/ }, (args) => ({ path: fileURLToPath(import.meta.resolve(args.path)) }));
    },
  };
}

function productionEntrySource(): string {
  return [
    'import React from "react";',
    'import {createRoot} from "react-dom/client";',
    'import {createBrowserArtifactRuntimeSession} from "@studio/agent-react";',
    'import * as ValidatedBundle from "agent-react:validated-bundle";',
    "let activeSession;let activeRoot;",
    "globalThis.__HARNESS_ARTIFACT_MOUNT__=(root,context)=>new Promise((settle)=>{",
    "if(!(context.port instanceof MessagePort))throw new Error('AgentReact requires a transferred MessagePort.');",
    "activeSession?.dispose();activeRoot?.unmount();",
    "activeSession=createBrowserArtifactRuntimeSession({artifactDigest:context.agentReact.artifactDigest,buildDigest:context.agentReact.buildDigest,frameToken:context.frameToken,actionMode:context.actionMode,state:context.state},context.port);",
    "const view=ValidatedBundle.activateArtifactRuntime(activeSession.bridge);",
    "const Committed=()=>{React.useEffect(()=>settle(),[]);return React.createElement(view.component);};",
    "activeRoot=createRoot(root,{onUncaughtError:(error)=>{globalThis.__HARNESS_ARTIFACT_FAIL__(error);settle();}});",
    "activeRoot.render(React.createElement(Committed));",
    "});",
    "addEventListener('beforeunload',()=>{activeSession?.dispose();ValidatedBundle.deactivateArtifactRuntime();activeRoot?.unmount();},{once:true});",
  ].join("\n");
}

async function runtimeModule(name: "index" | "jsx-dev-runtime"): Promise<string> {
  const emitted = new URL(`../../../agent-react/runtime/${name}.js`, import.meta.url);
  try {
    await access(fileURLToPath(emitted));
    return fileURLToPath(emitted);
  } catch {
    return fileURLToPath(new URL(`../../../agent-react/runtime/${name}.ts`, import.meta.url));
  }
}

function artifactDiagnostic(diagnostic: Diagnostic): ArtifactBuildDiagnostic {
  return {
    level: diagnostic.level,
    message: `[${diagnostic.code}] ${diagnostic.message}`,
    ...(diagnostic.module === undefined ? {} : { source: diagnostic.module.replace(/^\//u, "") }),
    ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
    ...(diagnostic.column === undefined ? {} : { column: diagnostic.column }),
  };
}

class AgentReactBuildDeadlineExceeded extends Error {}

async function withinDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AgentReactBuildDeadlineExceeded()), timeoutMs);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
