import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { expandHome } from "../../session-analysis/index.mjs";

export const CHECKUP_KIND = "harness-customization-checkup";
export const CHECKUP_SCHEMA_VERSION = 1;
export const CHECKUP_REPORT_EVIDENCE_VERSION = 1;
export const DEFAULT_WINDOW_DAYS = 30;
export const DEFAULT_SESSION_LIMIT = 40;
export const DEFAULT_MINIMUM_SESSIONS = 5;
export const DEFAULT_NEW_INSTALL_GRACE_DAYS = 7;
export const DEFAULT_SELECTION = "stratified";

const FINDING_STATUSES = new Set([
  "observed",
  "configured-only",
  "unobserved",
  "candidate",
  "healthy",
  "unavailable",
]);

export function shortHash(value, length = 12) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function ordered(value) {
  if (Array.isArray(value)) {
    return value.map(ordered);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered(value[key])]),
    );
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(ordered(value));
}

export function digest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function booleanOption(value) {
  if (typeof value === "string") {
    return !["0", "false", "no", "off", ""].includes(value.toLowerCase());
  }
  return Boolean(value);
}

export function normalizeCheckupOptions(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  if (Number.isNaN(now.getTime())) {
    throw new Error("--now must be an ISO date or timestamp");
  }
  const windowDays = positiveInteger(options.windowDays ?? options["window-days"], DEFAULT_WINDOW_DAYS);
  const since = options.since
    ? new Date(options.since)
    : new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const until = options.until ? new Date(options.until) : now;
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    throw new Error("--since and --until must be valid ISO dates");
  }
  if (since.getTime() > until.getTime()) {
    throw new Error("--since must not be later than --until");
  }

  const workspace = path.resolve(options.workspace ?? process.cwd());
  return {
    provider: String(options.provider ?? "qoder").toLowerCase(),
    locale: String(options.locale ?? "en").toLowerCase().startsWith("zh") ? "zh-CN" : "en",
    workspace,
    workspaceLabel: String(options.workspaceLabel ?? options["workspace-label"] ?? path.basename(workspace)),
    since: since.toISOString(),
    until: until.toISOString(),
    sessionLimit: positiveInteger(options.sessionLimit ?? options.limit, DEFAULT_SESSION_LIMIT),
    selection: String(options.selection ?? DEFAULT_SELECTION),
    minimumSessions: positiveInteger(
      options.minimumSessions ?? options["minimum-sessions"],
      DEFAULT_MINIMUM_SESSIONS,
    ),
    newInstallGraceDays: positiveInteger(
      options.newInstallGraceDays ?? options["new-install-grace-days"],
      DEFAULT_NEW_INSTALL_GRACE_DAYS,
    ),
    includeGlobalCapabilities: booleanOption(
      options.includeGlobalCapabilities ?? options["include-global-capabilities"],
    ),
    qoderHome: options.qoderHome ?? options["qoder-home"],
    qoderSharedClientCacheRoot:
      options.qoderSharedClientCacheRoot ??
      options["qoder-shared-client-cache-root"] ??
      options["shared-client-cache-root"],
    codexHome: options.codexHome ?? options["codex-home"],
    claudeHome: options.claudeHome ?? options["claude-home"],
    claudeStatePath: options.claudeStatePath ?? options["claude-state"],
    cursorHome: options.cursorHome ?? options["cursor-home"],
    frictionSignals: String(options.frictionSignals ?? options.friction ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    frictionStrength: options.frictionStrength ?? options["friction-strength"],
    frictionObservationCount: positiveInteger(
      options.frictionObservationCount ?? options["friction-observations"],
      0,
    ),
    frictionSource: options.frictionSource ?? options["friction-source"],
    skillOwnerSelected: booleanOption(options.skillOwnerSelected ?? options["skill-owner-selected"]),
  };
}

export function assertFindingStatus(status) {
  if (!FINDING_STATUSES.has(status)) {
    throw new Error(`Unsupported checkup finding status: ${status}`);
  }
  return status;
}

export function publicSource(source = {}) {
  return {
    id: `source-${shortHash(source.id ?? `${source.kind}:${source.role}:${source.workspaceScoped}`)}`,
    kind: String(source.kind ?? "unknown"),
    role: String(source.role ?? "unknown"),
    exists: Boolean(source.exists),
    enabled: source.enabled !== false,
    workspaceScoped: Boolean(source.workspaceScoped),
  };
}

export function safeLabel(value, fallback = "unknown") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (path.isAbsolute(text) || /^[A-Za-z]:[\\/]/u.test(text)) {
    return text.split(/[\\/]/u).filter(Boolean).at(-1) ?? fallback;
  }
  return text.slice(0, 160);
}

/** Inventory/options field names for each checkup host's configuration root. */
export const PROVIDER_HOME_FIELDS = Object.freeze({
  qoder: "qoderHome",
  codex: "codexHome",
  cursor: "cursorHome",
  claude: "claudeHome",
  qwen: "qwenHome",
  copilot: "copilotHome",
  pi: "piHome",
  workbuddy: "workbuddyHome",
});

export function providerHomeField(provider) {
  return PROVIDER_HOME_FIELDS[String(provider ?? "").toLowerCase()] ?? null;
}

/**
 * Resolve the configuration-home root for an explicit provider.
 * Prefer inventory/options values, then well-known env defaults for that host.
 * Never falls back across providers (for example Codex must not use Qoder home).
 */
export function resolveProviderHome(provider, source = {}) {
  const normalized = String(provider ?? "").toLowerCase();
  const field = providerHomeField(normalized);
  if (!field) {
    throw new Error(`unsupported provider for provider-home binding: ${provider ?? "missing"}`);
  }
  const kebab = field.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
  const explicit = source[field] ?? source[kebab];
  if (explicit) {
    return path.resolve(expandHome(String(explicit)));
  }

  const env = process.env ?? {};
  const userHome = os.homedir();
  const defaults = {
    qoder: env.QODER_HOME ?? path.join(userHome, ".qoder"),
    codex: env.CODEX_HOME ?? path.join(userHome, ".codex"),
    cursor: env.CURSOR_HOME ?? path.join(userHome, ".cursor"),
    claude: env.CLAUDE_CONFIG_DIR ?? env.CLAUDE_HOME ?? path.join(userHome, ".claude"),
    qwen: env.QWEN_HOME ?? path.join(userHome, ".qwen"),
    copilot: env.COPILOT_HOME ?? path.join(userHome, ".copilot"),
    pi: env.PI_CODING_AGENT_DIR ?? path.join(userHome, ".pi", "agent"),
    workbuddy: env.WORKBUDDY_DIR ?? path.join(userHome, ".workbuddy"),
  };
  return path.resolve(expandHome(defaults[normalized]));
}

/**
 * Read the provider-owned home from an inventory object without inventing a
 * foreign-host fallback. Returns null when the inventory does not expose that
 * host's home field.
 */
export function inventoryProviderHome(provider, inventory = {}) {
  const field = providerHomeField(provider);
  if (!field || !inventory?.[field]) return null;
  return path.resolve(String(inventory[field]));
}

export function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item?.[key] ?? "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function reportText(value, fallback = "unknown", limit = 320) {
  const text = String(value ?? "")
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|tmp|var)\/)[^\s,;)}\]]+/gu, "[path omitted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
  return text || fallback;
}

function scanDigestCandidates(scan) {
  const core = {
    observationWindow: scan.observationWindow,
    coverage: scan.coverage,
    publicAssets: scan.configuredInventory?.assets,
    findings: scan.findings,
    summary: scan.summary,
  };
  return new Set([
    digest(core),
    digest({
      ...core,
      sourceFingerprints: scan.configuredInventory?.sourceFingerprints ?? {},
    }),
  ]);
}

function reportableCheckupFinding(finding) {
  if (finding?.status === "candidate" || finding?.capabilityRecommendation) return true;
  if (finding?.kind !== "hook") return false;
  const codes = new Set((finding.evidence ?? []).map((item) => item?.code));
  return codes.has("hook-group-p95-over-budget")
    || codes.has("hook-count-over-recommended-limit")
    || codes.has("static-hook-review");
}

function publicCapabilityRecommendation(value) {
  if (!value || typeof value !== "object") return undefined;
  return {
    lifecycle: (value.lifecycle ?? []).map((item) => reportText(item, "workflow", 80)).slice(0, 8),
    discipline: (value.discipline ?? []).map((item) => reportText(item, "workflow", 80)).slice(0, 8),
    evidenceState: reportText(value.evidenceState, "needs-more-evidence", 80),
    nextStep: reportText(value.nextStep, "needs-more-evidence", 80),
    handoff: value.handoff ? reportText(value.handoff, "", 320) : null,
  };
}

function publicCheckupFinding(finding) {
  return {
    id: reportText(finding.id, "checkup-finding", 120),
    kind: reportText(finding.kind, "unknown", 40),
    status: reportText(finding.status, "unavailable", 40),
    scope: reportText(finding.scope, "other", 40),
    title: reportText(finding.title, "Customization Checkup follow-up"),
    evidence: (finding.evidence ?? []).map((item) => ({
      code: reportText(item?.code, "unknown", 120),
      state: reportText(item?.state, "unknown", 160),
    })).slice(0, 12),
    coverage: {
      analyzedSessions: Number(finding.coverage?.analyzedSessions ?? 0),
      minimumSessions: Number(finding.coverage?.minimumSessions ?? 0),
      sufficient: Boolean(finding.coverage?.sufficient),
      ...(typeof finding.coverage?.cleanupEligible === "boolean"
        ? { cleanupEligible: finding.coverage.cleanupEligible }
        : {}),
    },
    whyThisMatters: reportText(finding.whyThisMatters, "Review the bounded Checkup evidence before changing configuration."),
    ...(finding.capabilityRecommendation
      ? { capabilityRecommendation: publicCapabilityRecommendation(finding.capabilityRecommendation) }
      : {}),
  };
}

function publicCapabilityUse(rows = []) {
  return rows.map((row) => ({
    kind: reportText(row?.kind, "unknown", 40),
    configured: Number(row?.configured ?? 0),
    observed: Number(row?.observed ?? 0),
    unobserved: Number(row?.unobserved ?? 0),
    configuredOnly: Number(row?.configuredOnly ?? 0),
    unavailable: Number(row?.unavailable ?? 0),
    candidate: Number(row?.candidate ?? 0),
    blockers: Object.fromEntries(Object.entries(row?.blockers ?? {}).map(([key, value]) => [
      reportText(key, "unknown", 120),
      Number(value ?? 0),
    ])),
  })).slice(0, 3);
}

export function projectCheckupReportEvidence(scan) {
  if (scan?.kind !== CHECKUP_KIND || scan?.schemaVersion !== CHECKUP_SCHEMA_VERSION || scan?.phase !== "scan") {
    throw new Error("--checkup-scan requires a phase=scan Harness Customization Checkup payload");
  }
  if (!Array.isArray(scan.findings) || !Array.isArray(scan.configuredInventory?.assets)) {
    throw new Error("--checkup-scan is missing configured assets or findings");
  }
  const scanDigest = String(scan.diagnostics?.scanDigest ?? "");
  if (!scanDigest || !scanDigestCandidates(scan).has(scanDigest)) {
    throw new Error("--checkup-scan digest does not match the supplied evidence");
  }
  const evidence = {
    kind: CHECKUP_KIND,
    schemaVersion: CHECKUP_REPORT_EVIDENCE_VERSION,
    phase: "report-evidence",
    provider: reportText(scan.provider, "qoder", 40),
    workspace: reportText(scan.workspace, "workspace", 120),
    observationWindow: {
      since: reportText(scan.observationWindow?.since, "unknown", 80),
      until: reportText(scan.observationWindow?.until, "unknown", 80),
      selection: reportText(scan.observationWindow?.selection, "unknown", 40),
      includeGlobalCapabilities: Boolean(scan.observationWindow?.includeGlobalCapabilities),
    },
    coverage: {
      eligibleSessions: Number(scan.coverage?.eligibleSessions ?? 0),
      analyzedSessions: Number(scan.coverage?.analyzedSessions ?? 0),
      minimumSessions: Number(scan.coverage?.minimumSessions ?? 0),
      sufficient: Boolean(scan.coverage?.sufficient),
      cleanupEligible: Boolean(scan.coverage?.cleanupEligible),
      cleanupReason: reportText(scan.coverage?.cleanupReason, "unavailable", 120),
      userGlobal: reportText(scan.coverage?.userGlobal, "not-included", 80),
    },
    summary: {
      cleanup: {
        eligible: Boolean(scan.summary?.cleanup?.eligible),
        reason: reportText(scan.summary?.cleanup?.reason, "unavailable", 120),
      },
      capabilityUse: publicCapabilityUse(scan.summary?.capabilityUse),
    },
    findings: scan.findings.filter(reportableCheckupFinding).map(publicCheckupFinding),
    diagnostics: { scanDigest },
  };
  const errors = validateCheckupReportEvidence(evidence);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return evidence;
}

export function validateCheckupReportEvidence(value, prefix = "report source repositoryEvidence.customizationCheckup") {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [`${prefix} must be an object`];
  const errors = [];
  if (value.kind !== CHECKUP_KIND) errors.push(`${prefix}.kind must be ${CHECKUP_KIND}`);
  if (value.schemaVersion !== CHECKUP_REPORT_EVIDENCE_VERSION) {
    errors.push(`${prefix}.schemaVersion must be ${CHECKUP_REPORT_EVIDENCE_VERSION}`);
  }
  if (value.phase !== "report-evidence") errors.push(`${prefix}.phase must be report-evidence`);
  if (!Array.isArray(value.findings)) errors.push(`${prefix}.findings must be an array`);
  if (!Array.isArray(value.summary?.capabilityUse)) errors.push(`${prefix}.summary.capabilityUse must be an array`);
  if (typeof value.coverage?.cleanupEligible !== "boolean") {
    errors.push(`${prefix}.coverage.cleanupEligible must be a boolean`);
  }
  if (!String(value.diagnostics?.scanDigest ?? "").match(/^[a-f0-9]{64}$/u)) {
    errors.push(`${prefix}.diagnostics.scanDigest must be a sha256 digest`);
  }
  return errors;
}
