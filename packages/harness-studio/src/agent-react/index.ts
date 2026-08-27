/**
 * AgentReact Artifact Runtime — proof of concept.
 *
 * Pipeline: Agent Source Stream → Artifact Revision → Oxc Semantic Compile →
 * esbuild Link → immutable Build Snapshot → staged frame verification → atomic
 * commit → Observation.
 *
 * Four layers, each a directory, each with one job:
 *
 *   contracts/  layer-crossing types plus the shared addressing algorithm
 *   kernel/     Oxc Semantic Kernel — understands and constrains the source
 *   linker/     esbuild Linker — turns admitted modules into one runnable bundle
 *   runtime/    React Artifact Runtime — renders and makes the result addressable
 *   host/       Artifact Host — owns state, capabilities, versions, and commits
 *
 * Dependencies point one way: `host → {kernel, linker, runtime} → contracts`.
 * The runtime layer additionally stays browser-loadable. Both rules are asserted
 * in `test/agent-react/layering.test.ts` against the real import graph.
 *
 * Spec: docs/specs/2026-08-27-agent-react-artifact-runtime-poc.md
 */

export * from "./contracts/index.js";
export * from "./kernel/index.js";
export * from "./linker/index.js";
export * from "./host/index.js";

export {
  activeArtifactRuntime,
  createNodeAddressRegistry,
  defineArtifactView,
  isArtifactViewDefinition,
  setActiveArtifactRuntime,
  useArtifactAction,
  useArtifactState,
  type ArtifactRuntimeBridge,
  type ArtifactViewDefinition,
  type NodeAddressRegistry,
} from "./runtime/index.js";
