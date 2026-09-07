import { AGENT_REACT_RUNTIME_PACKAGE } from "../contracts/index.js";
import { createSemanticOxcCompiler } from "./semantic-compiler.js";
import { OXC_COMPILER_VERSION, type OxcCompileLimits } from "./compiler-policy.js";
export { OXC_COMPILER_VERSION, DEFAULT_OXC_COMPILE_LIMITS, type OxcCompileLimits } from "./compiler-policy.js";

/** Browser/CLI native backend. Desktop injects the Rust backend instead. */
export function createOxcCompiler(limits: Partial<OxcCompileLimits> = {}) {
  return createSemanticOxcCompiler({
    async parse(filename, source) {
      const { parseSync } = await import("oxc-parser");
      return parseSync(filename, source, { lang: "tsx", sourceType: "module" });
    },
    async transform(filename, source) {
      const { transformSync } = await import("oxc-transform");
      return transformSync(filename, source, {
        lang: "tsx", sourceType: "module", sourcemap: true,
        jsx: { runtime: "automatic", development: true, importSource: AGENT_REACT_RUNTIME_PACKAGE, refresh: false },
      });
    },
  }, OXC_COMPILER_VERSION, limits);
}
