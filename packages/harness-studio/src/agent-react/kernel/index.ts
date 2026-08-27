/**
 * Layer 1 — Oxc Semantic Kernel.
 *
 * Parses TSX, admits or rejects it against the AgentReact Profile, extracts the
 * Artifact View ABI, builds the semantic index, and erases types. It is the only
 * layer allowed to import `oxc-parser` / `oxc-transform`, and the only one that
 * knows what an AST node looks like — callers receive data, never an AST.
 */

export { DEFINE_ARTIFACT_VIEW, extractArtifactViewDeclaration, type AbiExtraction } from "./abi.js";
export {
  createOxcCompiler,
  DEFAULT_OXC_COMPILE_LIMITS,
  OXC_COMPILER_VERSION,
  type OxcCompileLimits,
} from "./compiler.js";
export { validateAgentReactProfile, type ProfileValidationInput } from "./profile.js";
export { buildSemanticIndex } from "./semantic-index.js";
