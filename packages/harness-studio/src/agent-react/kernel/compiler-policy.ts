/** Oxc version reported in every Build Snapshot so a build stays replayable. */
export const OXC_COMPILER_VERSION = "oxc-node-0.147.0";

export interface OxcCompileLimits {
  readonly maxModuleBytes: number;
  readonly maxOutputBytes: number;
}

export const DEFAULT_OXC_COMPILE_LIMITS: Readonly<OxcCompileLimits> = Object.freeze({
  maxModuleBytes: 512 * 1024,
  maxOutputBytes: 1024 * 1024,
});
