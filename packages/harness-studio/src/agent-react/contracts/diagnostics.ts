/**
 * Diagnostics are the pipeline's only channel back to the agent, so their codes
 * are a stable enumeration rather than free text: an agent that must fix its own
 * output needs to branch on the reason, not parse a sentence.
 */

export const PROFILE_DIAGNOSTIC_CODES = [
  "profile/commonjs",
  "profile/node-builtin",
  "profile/dynamic-import",
  "profile/package-not-allowed",
  "profile/react-dom-root",
  "profile/dynamic-eval",
  "profile/worker",
  "profile/network",
  "profile/class-component",
  "profile/top-level-effect",
] as const;

export type ProfileDiagnosticCode = (typeof PROFILE_DIAGNOSTIC_CODES)[number];

export type DiagnosticCode =
  | ProfileDiagnosticCode
  | "syntax/parse-failed"
  | "abi/missing-view"
  | "abi/not-static"
  | "abi/duplicate-state-path"
  | "abi/view-id-mismatch"
  | "revision/digest-mismatch"
  | "revision/duplicate-module"
  | "revision/path-invalid"
  | "limit/module-count"
  | "limit/module-bytes"
  | "limit/output-bytes"
  | "limit/compile-timeout"
  | "link/failed"
  | "link/package-not-allowed";

export interface Diagnostic {
  readonly level: "error" | "warning";
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly module?: string;
  readonly line?: number;
  readonly column?: number;
}
