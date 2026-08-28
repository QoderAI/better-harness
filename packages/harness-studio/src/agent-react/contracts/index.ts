/**
 * Layer-crossing contracts for the AgentReact Artifact Runtime.
 *
 * Every other layer may import this one; this one imports nothing outside itself.
 * It also stays free of Node built-ins and third-party packages, because the
 * sandbox-side runtime layer loads it in a browser.
 *
 * Enforced by `test/agent-react/layering.test.ts`.
 */

export * from "./addressing.js";
export * from "./build.js";
export * from "./compile.js";
export * from "./diagnostics.js";
export * from "./host.js";
export * from "./revision.js";
export * from "./versions.js";
