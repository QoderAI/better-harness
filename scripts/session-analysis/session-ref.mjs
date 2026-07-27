import { createHash } from "node:crypto";
import path from "node:path";

export const SESSION_REF_VERSION = 1;

const SESSION_REF_RE = /^qsr1-[a-f0-9]{24}$/u;

export function sessionAnalysisRef({ sessionId, platform = "unknown", workspace = "" } = {}) {
  const id = String(sessionId ?? "").trim();
  if (!id) return null;
  const scope = [
    `better-harness-session-ref-v${SESSION_REF_VERSION}`,
    String(platform ?? "unknown").trim().toLowerCase() || "unknown",
    workspace ? path.resolve(String(workspace)) : "<unscoped-workspace>",
    id,
  ].join("\0");
  return `qsr1-${createHash("sha256").update(scope).digest("hex").slice(0, 24)}`;
}

export function isSessionAnalysisRef(value) {
  return SESSION_REF_RE.test(String(value ?? "").trim());
}
