const PROGRAM = "better-harness harness experience-trace";

function freezeRows(rows) {
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

export const EXPERIENCE_TRACE_COMMAND_MANIFEST = Object.freeze({
  capability: "experience-trace.v1",
  name: "experience-trace",
  entryScript: "experience-trace/cli.mjs",
  audience: "maintainer",
  effects: "read-only",
  summary: "Create and validate task-scoped, privacy-safe Experience Trace JSONL.",
  description: "Project a validated Qoder report source into a bounded, caller-bound Experience Trace stream, or validate a captured stream without reading any workspace or host state.",
  usage: Object.freeze({
    create: `${PROGRAM} create --source <report.source.json> --task-key <opaque> --workspace-key <opaque> --run-key <opaque> (--episode-ref episode:<opaque> | --no-session-evidence) --jsonl`,
    validate: `${PROGRAM} validate --trace <trace.jsonl>`,
  }),
  phases: freezeRows([
    { name: "create", stdout: "jsonl", reads: "explicit-source" },
    { name: "validate", stdout: "json", reads: "explicit-trace" },
  ]),
  options: freezeRows([
    { name: "--source", phase: "create", value: "report.source.json" },
    { name: "--task-key", phase: "create", value: "opaque" },
    { name: "--workspace-key", phase: "create", value: "opaque" },
    { name: "--run-key", phase: "create", value: "opaque" },
    { name: "--episode-ref", phase: "create", value: "episode:<opaque>" },
    { name: "--no-session-evidence", phase: "create", value: "none" },
    { name: "--jsonl", phase: "create", value: "none" },
    { name: "--trace", phase: "validate", value: "trace.jsonl" },
  ]),
  examples: freezeRows([
    { phase: "create", argv: `${PROGRAM} create --source report.source.json --task-key <opaque> --workspace-key <opaque> --run-key <opaque> --no-session-evidence --jsonl` },
    { phase: "validate", argv: `${PROGRAM} validate --trace trace.jsonl` },
  ]),
  diagnostics: freezeRows([
    { code: "INVALID_USAGE", exitCode: 64 },
    { code: "MISSING_EPISODE_SELECTION", exitCode: 64 },
    { code: "INVALID_TRACE_BINDING", exitCode: 1 },
    { code: "SOURCE_READ_FAILED", exitCode: 1 },
    { code: "TRACE_READ_FAILED", exitCode: 1 },
    { code: "TRACE_BOUNDS_EXCEEDED", exitCode: 1 },
    { code: "INVALID_REPORT_SOURCE", exitCode: 1 },
    { code: "UNSUPPORTED_TRACE_SOURCE_VERSION", exitCode: 1 },
    { code: "UNSUPPORTED_TRACE_PLATFORM", exitCode: 1 },
    { code: "UNKNOWN_EPISODE_REF", exitCode: 1 },
    { code: "INVALID_EXPERIENCE_TRACE", exitCode: 1 },
  ]),
});
