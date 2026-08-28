import type { Diagnostic } from "./diagnostics.js";
import type { ModuleSource } from "./revision.js";

/**
 * What the Oxc Semantic Kernel promises the rest of the system.
 *
 * Everything here is data. Business code never receives an Oxc AST, which is what
 * lets the kernel move behind a Wasm Worker later: shipping a full AST across that
 * boundary would dominate compile cost.
 */

// ---------------------------------------------------------------------------
// Artifact View ABI
// ---------------------------------------------------------------------------

export interface ArtifactStateDeclaration {
  readonly path: string;
  readonly schema: string;
  readonly version: number;
}

export interface ArtifactViewDeclaration {
  readonly id: string;
  /** Sorted by `path`, so two extractions of the same source compare equal. */
  readonly state: readonly ArtifactStateDeclaration[];
  /** Sorted, duplicate-free capability requests. */
  readonly capabilities: readonly string[];
  readonly componentName: string;
  readonly module: string;
}

// ---------------------------------------------------------------------------
// Semantic index
// ---------------------------------------------------------------------------

export interface SemanticComponentEntry {
  readonly name: string;
  readonly exported: boolean;
  readonly line: number;
}

export interface SemanticJsxNodeEntry {
  /** Computed by `contracts/addressing.ts`, so the runtime derives the same id. */
  readonly sourceNodeId: string;
  readonly elementType: string;
  readonly intrinsic: boolean;
  readonly line: number;
  readonly column: number;
  /** JSX ancestry inside the module, outermost first. */
  readonly structurePath: readonly string[];
  readonly staticAttributes: readonly string[];
}

export interface ReactSemanticIndex {
  readonly module: string;
  readonly components: readonly SemanticComponentEntry[];
  readonly imports: readonly string[];
  readonly exports: readonly string[];
  readonly jsxNodes: readonly SemanticJsxNodeEntry[];
  readonly stateReferences: readonly string[];
  readonly actionReferences: readonly string[];
}

// ---------------------------------------------------------------------------
// Compiler port
// ---------------------------------------------------------------------------

export interface CompileModuleInput {
  readonly module: ModuleSource;
  /** Extract the Artifact View ABI from this module only. */
  readonly entry: boolean;
  readonly allowedPackages: readonly string[];
}

export interface CompileModuleOutput {
  readonly module: string;
  readonly code?: string;
  readonly sourceMap?: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly semanticIndex?: ReactSemanticIndex;
  readonly viewDeclaration?: ArtifactViewDeclaration;
}

/** The single seam business code may depend on. */
export interface OxcCompilerPort {
  readonly compilerVersion: string;
  readonly profileVersion: string;
  /** Stable identity of effective compile limits and other admission policy. */
  readonly policyFingerprint: string;
  compileModule(input: CompileModuleInput): Promise<CompileModuleOutput>;
}
