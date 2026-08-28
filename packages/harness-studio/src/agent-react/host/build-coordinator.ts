import {
  AGENT_REACT_RUNTIME_VERSION,
  type ArtifactRevision,
  BuildGenerationSuperseded,
  type BuildSnapshot,
  type Diagnostic,
  type DigestFn,
  type ObservationInput,
  type OxcCompilerPort,
  type ReactSemanticIndex,
  type SourceMapChainEntry,
} from "../contracts/index.js";
import { digestParts } from "./digest.js";
import { digestArtifactRevision } from "./digest.js";
import { cloneAndFreezePlainData } from "./data-ownership.js";
import { isNormalizedRevisionPath } from "./stream-assembler.js";
import {
  type AllowedPackageResolver,
  createAllowedPackageResolver,
  linkArtifactBundle,
  type TrustedRuntimePackage,
} from "../linker/index.js";

export interface BuildCoordinatorOptions {
  readonly compiler: OxcCompilerPort;
  readonly runtimePackages: readonly TrustedRuntimePackage[];
  readonly runtimeVersion?: string;
  readonly maxModules?: number;
  readonly maxOutputBytes?: number;
  readonly digest?: DigestFn;
  readonly onObservation?: (observation: ObservationInput) => void;
}

export interface AgentReactBuildCoordinator {
  build(revision: ArtifactRevision): Promise<BuildSnapshot>;
  readonly generation: number;
}

const DEFAULT_MAX_MODULES = 64;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Drives one Build Generation from a Revision to a frozen Build Snapshot.
 *
 * A streaming agent commits Revisions faster than a build finishes, so the
 * coordinator is generation-numbered: a superseded generation rejects instead of
 * resolving. Returning its result would let an older bundle win a race and get
 * staged over the newer one, which is exactly the flicker the transactional
 * commit is supposed to remove.
 */
export function createBuildCoordinator(options: BuildCoordinatorOptions): AgentReactBuildCoordinator {
  const digest = options.digest ?? digestParts;
  const runtimeVersion = options.runtimeVersion ?? AGENT_REACT_RUNTIME_VERSION;
  const maxModules = options.maxModules ?? DEFAULT_MAX_MODULES;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const observe = options.onObservation ?? ((): void => {});
  let generation = 0;

  return {
    get generation() {
      return generation;
    },
    async build(revision: ArtifactRevision): Promise<BuildSnapshot> {
      generation += 1;
      const mine = generation;
      const stillCurrent = (): boolean => generation === mine;
      const ownedRevision = cloneAndFreezePlainData(revision, "Artifact Revision");

      const snapshot = await runBuild({
        revision: ownedRevision,
        buildGeneration: mine,
        compiler: options.compiler,
        runtimePackages: options.runtimePackages,
        runtimeVersion,
        maxModules,
        maxOutputBytes,
        digest,
        observe,
      });
      if (!stillCurrent()) throw new BuildGenerationSuperseded(mine);
      return snapshot;
    },
  };
}

interface RunBuildOptions {
  readonly revision: ArtifactRevision;
  readonly buildGeneration: number;
  readonly compiler: OxcCompilerPort;
  readonly runtimePackages: readonly TrustedRuntimePackage[];
  readonly runtimeVersion: string;
  readonly maxModules: number;
  readonly maxOutputBytes: number;
  readonly digest: DigestFn;
  readonly observe: (observation: ObservationInput) => void;
}

async function runBuild(options: RunBuildOptions): Promise<BuildSnapshot> {
  const { revision, compiler, digest, observe } = options;
  const diagnostics: Diagnostic[] = [];
  const semanticIndex: ReactSemanticIndex[] = [];
  const sourceMaps: SourceMapChainEntry[] = [];
  const compiledModules = new Map<string, string>();
  let viewDeclaration: BuildSnapshot["viewDeclaration"];

  const failed = (extra: readonly Diagnostic[]): BuildSnapshot =>
    freezeSnapshot({
      ...options,
      status: "failed",
      bundle: "",
      diagnostics: [...diagnostics, ...extra],
      semanticIndex,
      sourceMaps,
      viewDeclaration,
    });

  if (!isNormalizedRevisionPath(revision.descriptor.entry)) {
    return failed([{
      level: "error",
      code: "revision/path-invalid",
      message: `Revision entry '${revision.descriptor.entry}' is not a normalized POSIX module path.`,
      module: revision.descriptor.entry,
    }]);
  }

  const modulePaths = new Set<string>();
  for (const module of revision.modules) {
    if (!isNormalizedRevisionPath(module.path)) {
      return failed([{
        level: "error",
        code: "revision/path-invalid",
        message: `Revision module '${module.path}' is not a normalized POSIX path.`,
        module: module.path,
      }]);
    }
    if (modulePaths.has(module.path)) {
      return failed([{
        level: "error",
        code: "revision/duplicate-module",
        message: `Revision contains module '${module.path}' more than once.`,
        module: module.path,
      }]);
    }
    modulePaths.add(module.path);
  }

  const computedRevisionDigest = digestArtifactRevision(revision.descriptor, revision.modules);
  if (computedRevisionDigest !== revision.digest) {
    return failed([{
      level: "error",
      code: "revision/digest-mismatch",
      message: "Artifact Revision digest does not match its descriptor and module bytes.",
    }]);
  }

  if (revision.modules.length > options.maxModules) {
    return failed([{
      level: "error",
      code: "limit/module-count",
      message: `Revision has ${revision.modules.length} modules, over the ${options.maxModules}-module limit.`,
    }]);
  }

  const resolver: AllowedPackageResolver = createAllowedPackageResolver({
    modulePaths: revision.modules.map((module) => module.path),
    runtimePackages: options.runtimePackages,
  });

  for (const module of revision.modules) {
    const output = await compiler.compileModule({
      module,
      entry: module.path === revision.descriptor.entry,
      allowedPackages: resolver.allowedPackages,
    });
    diagnostics.push(...output.diagnostics);
    for (const diagnostic of output.diagnostics) {
      observe({
        kind: diagnostic.code.startsWith("profile/") ? "profileViolation" : "compileDiagnostic",
        artifactDigest: revision.digest,
        detail: { ...diagnostic },
      });
    }
    if (output.semanticIndex !== undefined) semanticIndex.push(output.semanticIndex);
    if (output.sourceMap !== undefined) sourceMaps.push({ module: module.path, map: output.sourceMap });
    if (output.viewDeclaration !== undefined) viewDeclaration = output.viewDeclaration;
    if (output.code !== undefined) compiledModules.set(module.path, output.code);
  }

  if (diagnostics.some((diagnostic) => diagnostic.level === "error")) return failed([]);
  if (viewDeclaration === undefined) {
    return failed([{
      level: "error",
      code: "abi/missing-view",
      message: `Entry module '${revision.descriptor.entry}' produced no Artifact View declaration.`,
      module: revision.descriptor.entry,
    }]);
  }
  if (viewDeclaration.id !== revision.descriptor.id) {
    return failed([{
      level: "error",
      code: "abi/view-id-mismatch",
      message: `Artifact View id '${viewDeclaration.id}' does not match descriptor id '${revision.descriptor.id}'.`,
      module: revision.descriptor.entry,
    }]);
  }

  const linked = await linkArtifactBundle({
    compiledModules,
    entryModule: revision.descriptor.entry,
    resolver,
    maxOutputBytes: options.maxOutputBytes,
  });
  if (linked.status === "failed") {
    for (const diagnostic of linked.diagnostics) {
      observe({ kind: "compileDiagnostic", artifactDigest: revision.digest, detail: { ...diagnostic } });
    }
    return failed(linked.diagnostics);
  }

  const snapshot = freezeSnapshot({
    ...options,
    status: "ready",
    bundle: linked.bundle,
    diagnostics: [...diagnostics, ...linked.diagnostics],
    semanticIndex,
    sourceMaps,
    viewDeclaration,
  });
  return snapshot;
}

interface SnapshotParts {
  readonly revision: ArtifactRevision;
  readonly buildGeneration: number;
  readonly compiler: OxcCompilerPort;
  readonly runtimeVersion: string;
  readonly runtimePackages: readonly TrustedRuntimePackage[];
  readonly maxModules: number;
  readonly maxOutputBytes: number;
  readonly digest: DigestFn;
  readonly status: BuildSnapshot["status"];
  readonly bundle: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly semanticIndex: readonly ReactSemanticIndex[];
  readonly sourceMaps: readonly SourceMapChainEntry[];
  readonly viewDeclaration: BuildSnapshot["viewDeclaration"];
}

function freezeSnapshot(parts: SnapshotParts): BuildSnapshot {
  const sourceMaps = cloneAndFreezePlainData(parts.sourceMaps, "Build Snapshot source maps");
  const semanticIndex = cloneAndFreezePlainData(parts.semanticIndex, "Build Snapshot semantic index");
  const diagnostics = cloneAndFreezePlainData(parts.diagnostics, "Build Snapshot diagnostics");
  const viewDeclaration = parts.viewDeclaration === undefined
    ? undefined
    : cloneAndFreezePlainData(parts.viewDeclaration, "Build Snapshot view declaration");
  const runtimePackages = [...parts.runtimePackages]
    .map((entry) => [entry.specifier, entry.external] as const)
    .sort(([leftSpecifier, leftExternal], [rightSpecifier, rightExternal]) => {
      const left = `${leftSpecifier}\u0000${leftExternal}`;
      const right = `${rightSpecifier}\u0000${rightExternal}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  const buildPolicyDigest = parts.digest([
    parts.compiler.policyFingerprint,
    parts.maxModules,
    parts.maxOutputBytes,
    runtimePackages,
  ]);
  /**
   * The digest covers the Revision *and* the three versions that decide how it
   * was translated. Omitting them would let a compiler upgrade silently reuse a
   * cached snapshot built by the previous rules, so a replay would no longer
   * prove anything about the code that is running.
   */
  const buildDigest = parts.digest([
    parts.revision.digest,
    parts.compiler.compilerVersion,
    parts.compiler.profileVersion,
    parts.runtimeVersion,
    buildPolicyDigest,
    parts.status,
    parts.bundle,
    diagnostics,
  ]);
  return Object.freeze({
    buildDigest,
    artifactDigest: parts.revision.digest,
    artifactId: parts.revision.descriptor.id,
    buildGeneration: parts.buildGeneration,
    compilerVersion: parts.compiler.compilerVersion,
    profileVersion: parts.compiler.profileVersion,
    runtimeVersion: parts.runtimeVersion,
    buildPolicyDigest,
    status: parts.status,
    bundle: parts.bundle,
    sourceMaps,
    semanticIndex,
    ...(viewDeclaration === undefined ? {} : { viewDeclaration }),
    diagnostics,
  });
}
