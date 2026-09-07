/** Public host adapter; importing this surface never loads OXC native bindings. */
export { createRustOxcCompiler, RUST_OXC_COMPILER_VERSION, type RustOxcCompiler, type RustOxcCompilerOptions } from "./agent-react/host/rust-oxc-compiler.js";
export type { ManagedOxcCompiler, OxcCompilerFactory } from "./agent-react/host/compiler-factory.js";
