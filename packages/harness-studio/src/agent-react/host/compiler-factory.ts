import type { OxcCompilerPort } from "../contracts/index.js";

export interface ManagedOxcCompiler extends OxcCompilerPort {
  close(): Promise<void>;
}

/** A fresh compiler belongs to one build; close cancels that build's native work. */
export type OxcCompilerFactory = (options: { readonly timeoutMs: number }) => ManagedOxcCompiler;
