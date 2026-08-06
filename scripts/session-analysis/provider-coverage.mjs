/**
 * Reader-safe provider coverage contract.
 *
 * Provider adapters may know much more about their local storage than a
 * report is allowed to retain.  This module deliberately projects only
 * bounded states, counts, and diagnostic codes.  It is shared by the
 * session runner, the evidence bundle, and the report-source manifest so a
 * transport/source probe cannot be mistaken for verified semantic coverage.
 */

export const PROVIDER_COVERAGE_SCHEMA_VERSION = 1;
export const MAX_UNSUPPORTED_CAPABILITIES = 16;

const COVERAGE_STATUSES = new Set([
  "absent",
  "out-of-window",
  "unobserved",
  "partial",
  "observed",
  "unsupported",
  "unavailable",
]);

const DIAGNOSTIC_FIELDS = new Set([
  "status",
  "expectedVersion",
  "observedVersions",
  "unknownVersionCount",
  "invalidHeaderCount",
  "invalidRecordCount",
  "unknownRecordShapeCount",
  "cwdlessSessionCount",
  "slugCollisionCount",
  "sessionIdConflict",
  "codes",
]);

function nonNegativeInteger(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function codeList(value, limit = 12) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? "").trim())
    .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(item)))]
    .slice(0, limit)
    .sort();
}

function capabilityList(value) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? "")
      .replace(/[\u0000-\u001f\u007f]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 180))
    .filter(Boolean))]
    .slice(0, MAX_UNSUPPORTED_CAPABILITIES)
    .sort();
}

function safeDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const key of DIAGNOSTIC_FIELDS) {
    if (!(key in value)) continue;
    if (key === "status") {
      const status = String(value.status ?? "");
      if (["verified", "partial", "unknown", "unavailable"].includes(status)) result.status = status;
    } else if (key === "expectedVersion") {
      if (typeof value.expectedVersion === "number" && Number.isFinite(value.expectedVersion)) {
        result.expectedVersion = Math.trunc(value.expectedVersion);
      } else if (typeof value.expectedVersion === "string" && value.expectedVersion.length <= 32) {
        result.expectedVersion = value.expectedVersion;
      }
    } else if (key === "observedVersions") {
      result.observedVersions = [...new Set((Array.isArray(value.observedVersions) ? value.observedVersions : [])
        .filter((item) => (typeof item === "number" && Number.isFinite(item)) || (typeof item === "string" && item.length <= 32)))]
        .slice(0, 8);
    } else if (key === "sessionIdConflict") {
      result.sessionIdConflict = value.sessionIdConflict === true;
    } else if (key === "codes") {
      result.codes = codeList(value.codes);
    } else {
      result[key] = nonNegativeInteger(value[key]);
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function safeSourceCoverage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = String(value.status ?? "");
  if (!COVERAGE_STATUSES.has(status)) return null;
  const count = (input) => nonNegativeInteger(input);
  const join = (input = {}) => ({
    sourceAvailable: input.sourceAvailable === true,
    matchedWorkspaceSessions: count(input.matchedWorkspaceSessions),
    matchedRelevantSessions: count(input.matchedRelevantSessions),
  });
  return {
    status,
    transcript: {
      workspaceSessions: count(value.transcript?.workspaceSessions),
      inWindowSessions: count(value.transcript?.inWindowSessions),
      outOfWindowSessions: count(value.transcript?.outOfWindowSessions),
      timeUnobservedSessions: count(value.transcript?.timeUnobservedSessions),
      relevantSessions: count(value.transcript?.relevantSessions),
      withConversation: count(value.transcript?.withConversation),
      withRequest: count(value.transcript?.withRequest),
      terminalOnly: count(value.transcript?.terminalOnly),
      unreadable: count(value.transcript?.unreadable),
    },
    joins: {
      chatMetadata: join(value.joins?.chatMetadata),
      audit: join(value.joins?.audit),
    },
  };
}

function statusFrom({ sourceCoverage, observed, enabled, unsupported, unavailable }) {
  const sourceStatus = String(sourceCoverage?.status ?? "");
  // Preserve a source-level absence/window result, but never let an
  // `unobserved` source mask an explicit unsupported or unavailable adapter.
  // This is what keeps an unknown schema visible when it yields zero admitted
  // sessions.
  if (sourceStatus === "absent" || sourceStatus === "out-of-window") return sourceStatus;
  if (unsupported.length > 0 && !observed) return "unsupported";
  if (unavailable.length > 0 || !enabled) return "unavailable";
  if (COVERAGE_STATUSES.has(sourceStatus)) return sourceStatus;
  return observed ? "observed" : "unobserved";
}

/**
 * Build the public provider coverage envelope.  The boolean state fields are
 * intentionally explicit: configured/enabled is not the same as observed,
 * and observed is not the same as schema-verified.
 */
export function buildProviderCoverage({
  provider = "unknown",
  sourceCoverage = null,
  configured = false,
  enabled = false,
  observed = false,
  verified = false,
  unsupported = [],
  unsupportedCapabilities = [],
  unavailable = [],
  schemaDiagnostics = null,
} = {}) {
  const safeUnsupported = codeList(unsupported);
  const safeUnsupportedCapabilities = capabilityList(unsupportedCapabilities);
  const safeUnavailable = codeList(unavailable);
  const safeSchemaDiagnostics = safeDiagnostic(schemaDiagnostics);
  const status = statusFrom({
    sourceCoverage,
    observed,
    enabled,
    unsupported: safeUnsupported,
    unavailable: safeUnavailable,
  });
  return {
    schemaVersion: PROVIDER_COVERAGE_SCHEMA_VERSION,
    provider: String(provider).toLowerCase(),
    status,
    configured: configured === true,
    enabled: enabled === true,
    observed: observed === true,
    verified: verified === true && safeUnsupported.length === 0 && safeUnavailable.length === 0,
    unsupported: safeUnsupported,
    ...(safeUnsupportedCapabilities.length > 0 ? { unsupportedCapabilities: safeUnsupportedCapabilities } : {}),
    unavailable: safeUnavailable,
    ...(safeSourceCoverage(sourceCoverage) ? { sourceCoverage: safeSourceCoverage(sourceCoverage) } : {}),
    ...(safeSchemaDiagnostics ? { schemaDiagnostics: safeSchemaDiagnostics } : {}),
  };
}

export function sanitizeProviderCoverage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return buildProviderCoverage({
    provider: value.provider,
    sourceCoverage: value.sourceCoverage ?? value,
    configured: value.configured === true,
    enabled: value.enabled === true,
    observed: value.observed === true,
    verified: value.verified === true,
    unsupported: value.unsupported,
    unsupportedCapabilities: value.unsupportedCapabilities,
    unavailable: value.unavailable,
    schemaDiagnostics: value.schemaDiagnostics,
  });
}

export function providerCoverageStates(value) {
  const coverage = sanitizeProviderCoverage(value);
  if (!coverage) return null;
  return {
    configured: coverage.configured,
    enabled: coverage.enabled,
    observed: coverage.observed,
    verified: coverage.verified,
    unsupported: coverage.unsupported,
    ...(coverage.unsupportedCapabilities?.length > 0
      ? { unsupportedCapabilities: coverage.unsupportedCapabilities }
      : {}),
    unavailable: coverage.unavailable,
  };
}

/** Add bounded asset-inventory capability gaps without changing session states. */
export function appendUnsupportedCapabilities(value, capabilities = []) {
  const coverage = sanitizeProviderCoverage(value);
  if (!coverage) return null;
  return buildProviderCoverage({
    ...coverage,
    unsupportedCapabilities: [
      ...(coverage.unsupportedCapabilities ?? []),
      ...capabilityList(capabilities),
    ],
  });
}
