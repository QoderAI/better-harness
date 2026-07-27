export const SEMANTIC_FACET_SCHEMA_VERSION = 1;

export const SEMANTIC_FACET_KINDS = Object.freeze([
  "goal-workflow",
  "friction-taxonomy",
  "rework-correction",
  "candidate-attribution",
  "redacted-summary",
]);

const RAW_FIELD_RE = /(?:^|_)(?:raw_?)?(?:prompt|command|content|transcript|user_?text|assistant_?text)$/i;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasRawField(value, location = "semanticFacet") {
  if (Array.isArray(value)) return value.flatMap((item, index) => hasRawField(item, `${location}[${index}]`));
  if (!isObject(value)) return [];
  const errors = [];
  for (const [key, child] of Object.entries(value)) {
    if (RAW_FIELD_RE.test(key) && typeof child === "string" && child.trim()) {
      errors.push(`${location}.${key} must not contain raw transcript or command content`);
    }
    errors.push(...hasRawField(child, `${location}.${key}`));
  }
  return errors;
}

export function validateSemanticFacet(facet, location = "semanticFacet") {
  if (!isObject(facet)) return [`${location} must be an object`];
  const errors = [];
  const allowed = new Set(["id", "schemaVersion", "kind", "episodeRef", "status", "labels", "summary", "evidenceRefs", "modelVersion"]);
  for (const field of Object.keys(facet)) {
    if (!allowed.has(field)) errors.push(`${location} has unsupported field: ${field}`);
  }
  for (const field of ["id", "schemaVersion", "kind", "status", "labels", "evidenceRefs"]) {
    if (facet[field] === undefined || facet[field] === null || facet[field] === "") errors.push(`${location} missing ${field}`);
  }
  if (facet.schemaVersion !== SEMANTIC_FACET_SCHEMA_VERSION) errors.push(`${location} schemaVersion must be ${SEMANTIC_FACET_SCHEMA_VERSION}`);
  if (!SEMANTIC_FACET_KINDS.includes(facet.kind)) errors.push(`${location} has unsupported kind: ${facet.kind}`);
  if (!new Set(["candidate", "observed", "unobserved"]).has(facet.status)) errors.push(`${location} has unsupported status: ${facet.status}`);
  if (!Array.isArray(facet.labels) || facet.labels.some((label) => typeof label !== "string" || !label.trim())) errors.push(`${location}.labels must be a string array`);
  if (!Array.isArray(facet.evidenceRefs)) errors.push(`${location}.evidenceRefs must be an array`);
  if (facet.summary !== undefined && typeof facet.summary !== "string") errors.push(`${location}.summary must be a string when supplied`);
  errors.push(...hasRawField(facet, location));
  return errors;
}

export function validateSemanticFacets(facets = []) {
  if (!Array.isArray(facets)) return ["semanticFacets must be an array"];
  return facets.flatMap((facet, index) => validateSemanticFacet(facet, `semanticFacets[${index}]`));
}

export function projectSemanticFacets(facets = []) {
  const errors = validateSemanticFacets(facets);
  if (errors.length > 0) throw Object.assign(new Error(errors.join("; ")), { code: "INVALID_SEMANTIC_FACETS", errors });
  return {
    schemaVersion: SEMANTIC_FACET_SCHEMA_VERSION,
    status: facets.length > 0 ? "supplementary" : "not-supplied",
    entries: facets.map((facet) => ({
      id: facet.id,
      kind: facet.kind,
      episodeRef: facet.episodeRef ?? null,
      status: facet.status,
      labels: [...facet.labels],
      ...(facet.summary ? { summary: facet.summary } : {}),
      evidenceRefs: facet.evidenceRefs,
      ...(facet.modelVersion ? { modelVersion: facet.modelVersion } : {}),
    })),
  };
}
