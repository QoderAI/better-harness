import os from "node:os";

export const COMMAND_CONTRACT_VERSION = "1";

export class LifecycleCliError extends Error {
  constructor(code, message, { hint, kind = "operational", retryable = false } = {}) {
    super(message);
    this.name = "LifecycleCliError";
    this.code = code;
    this.hint = hint;
    this.kind = kind;
    this.retryable = retryable;
  }
}

export function diagnostic(code, severity, message, hint) {
  return {
    code,
    severity,
    message,
    ...(hint ? { hint } : {}),
  };
}

function redactDiagnosticText(value) {
  const home = os.homedir();
  if (!home || home === "/") return String(value);
  return String(value).replaceAll(home, "~");
}

export async function withTimeout(task, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new LifecycleCliError(
          "COMMAND_TIMEOUT",
          `Read-only inspection exceeded the ${timeoutMs} millisecond timeout.`,
          { retryable: true },
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function commandEnvelope({ command, status, data = null, diagnostics = [], durationMs = 0 }) {
  return {
    schemaVersion: COMMAND_CONTRACT_VERSION,
    command,
    status,
    data,
    artifacts: [],
    diagnostics,
    meta: {
      durationMs,
      sideEffects: "read-only",
    },
  };
}

export function exitCodeFor(status, { usage = false } = {}) {
  if (usage) return 64;
  if (status === "ok") return 0;
  if (status === "partial") return 2;
  return 1;
}

export function cliErrorEnvelope(command, error, durationMs = 0) {
  const usage = error instanceof LifecycleCliError && error.kind === "usage";
  const code = error instanceof LifecycleCliError ? error.code : "PLUGIN_LIFECYCLE_FAILED";
  const message = error instanceof LifecycleCliError
    ? redactDiagnosticText(error.message)
    : "The read-only lifecycle operation failed.";
  const hint = error instanceof LifecycleCliError && error.hint
    ? redactDiagnosticText(error.hint)
    : undefined;
  return {
    envelope: commandEnvelope({
      command,
      status: "failed",
      data: null,
      diagnostics: [diagnostic(code, "error", message, hint)],
      durationMs,
    }),
    exitCode: exitCodeFor("failed", { usage }),
  };
}
