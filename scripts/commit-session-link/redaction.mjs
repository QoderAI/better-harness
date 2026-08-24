const DEFAULT_TEXT_LIMIT = 6_000;

// Shared privacy boundary for local transcript-derived views. Preserve useful
// Markdown and repository paths while removing credential-shaped values before
// a renderer receives them.
export function redactTranscriptText(value, { limit = DEFAULT_TEXT_LIMIT } = {}) {
  if (!value) return null;
  const text = String(value)
    .replace(/\b(?:authorization\s*:\s*)?bearer\s+[A-Za-z0-9._~+\/-]{8,}\b/giu, "Bearer <redacted>")
    .replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/giu, "$1=<redacted>")
    .replace(/\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}\b/giu, "<secret>")
    .replace(/\bglpat-[A-Za-z0-9_-]{20,}\b/giu, "<secret>")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/giu, "$1<redacted>@")
    .replace(/\bAKIA[0-9A-Z]{12,}\b/gu, "<secret>")
    .trim();
  if (!text) return null;
  return [...text].length <= limit ? text : `${[...text].slice(0, limit).join("")}…`;
}
