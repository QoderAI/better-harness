// Public behavioral import surface for the experience-trace capability.
// Cross-capability consumers must import from this file instead of reaching
// into the contract or Qoder report-source projection internals.

export {
  CAPABILITY_ORDER,
  EXPERIENCE_TRACE_BOUNDS,
  EXPERIENCE_TRACE_SCHEMA_VERSION,
  ExperienceTraceError,
  FIXED_GAP_REASON_BY_CAPABILITY,
  assertIterativeJsonStructure,
  bindingRefFromKey,
  canonicalJson,
  compareCodeUnits,
  createTraceFromProjection,
  experienceTraceValidationDocument,
  failExperienceTrace,
  parseAndValidateExperienceTraceJsonl,
  serializeExperienceTrace,
  sha256Hex,
  sourceProjectionDigestFor,
  traceDigestFor,
  traceIdFor,
  validateExperienceTraceRecords,
} from "./contract.mjs";

export {
  createExperienceTrace,
  ExperienceTraceSourceError,
  projectQoderReportSource,
} from "./project-source.mjs";
