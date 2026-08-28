import { dirname, resolve } from "node:path/posix";
import {
  AGENT_REACT_JSX_DEV_PACKAGE,
  AGENT_REACT_RUNTIME_PACKAGE,
} from "../contracts/index.js";

/**
 * Which imports may cross the Artifact boundary, and where they land.
 *
 * A trusted package resolves to an *external* specifier rather than being bundled
 * again. Re-bundling React per build would multiply build size and, worse, give
 * each build its own React instance, so two frames could never share Host state
 * or a component identity.
 */

export interface TrustedRuntimePackage {
  /** What artifact code writes, e.g. `react`. */
  readonly specifier: string;
  /** What the linked bundle imports instead: a versioned Bootstrap URL. */
  readonly external: string;
}

export interface AllowedPackageResolver {
  /** Specifiers the Profile validator accepts, sorted. */
  readonly allowedPackages: readonly string[];
  resolveInternal(importer: string, specifier: string): string | undefined;
  resolveRuntimePackage(specifier: string): string | undefined;
  rejectPackage(specifier: string): string;
}

const INTERNAL_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs"] as const;

export const REQUIRED_RUNTIME_SPECIFIERS = Object.freeze([
  "react",
  AGENT_REACT_RUNTIME_PACKAGE,
  AGENT_REACT_JSX_DEV_PACKAGE,
]);

export function createAllowedPackageResolver(options: {
  readonly modulePaths: readonly string[];
  readonly runtimePackages: readonly TrustedRuntimePackage[];
}): AllowedPackageResolver {
  const modules = new Set(options.modulePaths);
  const runtime = new Map(options.runtimePackages.map((entry) => [entry.specifier, entry.external]));
  for (const required of REQUIRED_RUNTIME_SPECIFIERS) {
    if (!runtime.has(required)) {
      throw new Error(`Trusted Bootstrap must provide '${required}' for the AgentReact runtime to link.`);
    }
  }
  return {
    allowedPackages: Object.freeze([...runtime.keys()].sort()),
    resolveInternal(importer, specifier) {
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) return undefined;
      const base = specifier.startsWith("/") ? specifier : resolve(dirname(importer), specifier);
      return internalCandidates(base).find((candidate) => modules.has(candidate));
    },
    resolveRuntimePackage(specifier) {
      return runtime.get(specifier);
    },
    rejectPackage(specifier) {
      return `Package import '${specifier}' is not provided by the AgentReact Trusted Bootstrap.`;
    },
  };
}

/**
 * TypeScript source writes `./panel.js` for a file that is really `./panel.tsx`,
 * so a resolver that only appended extensions would reject the idiomatic import
 * every TS-aware agent produces.
 */
function internalCandidates(base: string): readonly string[] {
  const withoutJsExtension = base.replace(/\.(?:js|mjs)$/, "");
  const roots = withoutJsExtension === base ? [base] : [base, withoutJsExtension];
  return [
    ...roots,
    ...roots.flatMap((root) => INTERNAL_EXTENSIONS.map((extension) => `${root}${extension}`)),
    ...roots.flatMap((root) => INTERNAL_EXTENSIONS.map((extension) => `${root}/index${extension}`)),
  ];
}
