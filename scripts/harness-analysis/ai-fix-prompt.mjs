const SYNTHETIC_EVIDENCE_ALIAS_RE = /\b[ES]\d+\b/iu;

export function hasSyntheticEvidenceAlias(value) {
  return SYNTHETIC_EVIDENCE_ALIAS_RE.test(String(value ?? ""));
}
