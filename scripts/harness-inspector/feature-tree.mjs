export const FEATURE_TREE_KIND = "FeatureTreeV1";
export const FEATURE_TREE_SCHEMA_VERSION = 1;

const HEADING_RE = /^(#{1,6})\s+(Feature|Story):\s+(.+?)\s+\{#([a-z0-9][a-z0-9-]{0,63})\}\s*$/u;
const CHECKLIST_PREFIX_RE = /^([ ]*)[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/u;
const EXPLICIT_ID_RE = /^(.*?)\s+\{#([a-z0-9][a-z0-9-]{0,63})\}\s*$/u;
const METADATA_RE = /^\s*-\s+([a-z][a-z-]*):\s*(.*?)\s*$/u;
const MULTI_KEYS = new Set(["spec", "issue", "prompt", "session", "commit"]);
const SINGLE_KEYS = new Set(["status", "stage", "date", "evidence"]);
const SUPPORTED_KEYS = new Set([...MULTI_KEYS, ...SINGLE_KEYS]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SAFE_RELATIVE_PATH_RE = /^(?![A-Za-z]:[\\/])(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$)).+$/u;

export class FeatureTreeParseError extends Error {
  constructor(diagnostics, source = "feature-tree.md") {
    super(`${source} has ${diagnostics.length} feature-tree error${diagnostics.length === 1 ? "" : "s"}`);
    this.name = "FeatureTreeParseError";
    this.code = "INVALID_FEATURE_TREE";
    this.diagnostics = diagnostics;
    this.source = source;
  }
}

function diagnostic(line, message) {
  return { line, message };
}

function validCalendarDate(value) {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateMetadata(key, value) {
  if (!value) return "metadata value must not be empty";
  if ([...value].length > (key === "prompt" ? 500 : 240)) return `${key} metadata is too long`;
  if ((key === "status" || key === "stage") && !TOKEN_RE.test(value)) {
    return `${key} must use lowercase kebab-case`;
  }
  if (key === "evidence" && !["declared", "candidate", "unmapped"].includes(value)) {
    return "evidence must be declared, candidate, or unmapped";
  }
  if (key === "date" && !validCalendarDate(value)) return "date must be a real YYYY-MM-DD value";
  if (key === "spec" && !SAFE_RELATIVE_PATH_RE.test(value)) return "spec must be a repository-relative path";
  return null;
}

function emptyRefs() {
  return { specs: [], issues: [], prompts: [], sessions: [], commits: [] };
}

function refKey(key) {
  return key === "spec" ? "specs"
    : key === "issue" ? "issues"
      : key === "prompt" ? "prompts"
        : key === "session" ? "sessions"
          : "commits";
}

function checklistId(title, line) {
  const id = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64)
    .replace(/-+$/gu, "");
  return id || `item-${line}`;
}

function parseChecklistTree(text, { source }) {
  const diagnostics = [];
  const nodes = [];
  const byId = new Map();
  const stack = [];

  String(text ?? "").split(/\r?\n/u).forEach((lineText, index) => {
    const line = index + 1;
    if (!/^\s*[-*+]\s+\[[^\]]*\]/u.test(lineText)) return;
    const item = lineText.match(CHECKLIST_PREFIX_RE);
    if (!item) {
      diagnostics.push(diagnostic(line, "checklist item must use - [ ] or - [x] followed by a title"));
      return;
    }

    const indent = item[1].length;
    if (indent % 2 !== 0) {
      diagnostics.push(diagnostic(line, "checklist indentation must use two spaces per level"));
      return;
    }
    const explicit = item[3].match(EXPLICIT_ID_RE);
    const title = (explicit?.[1] ?? item[3]).trim();
    const id = explicit?.[2] ?? checklistId(title, line);
    if (!title) {
      diagnostics.push(diagnostic(line, "checklist title must not be empty"));
      return;
    }
    if ([...title].length > 160) diagnostics.push(diagnostic(line, "checklist title is too long"));
    if (byId.has(id)) {
      diagnostics.push(diagnostic(line, `duplicate id: ${id}`));
      return;
    }

    while (stack.length > 0 && stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1) ?? null;
    if (!parent && indent !== 0) {
      diagnostics.push(diagnostic(line, "first-level checklist items must not be indented"));
      return;
    }
    if (parent && indent !== parent.indent + 2) {
      diagnostics.push(diagnostic(line, "checklist indentation must increase by exactly two spaces"));
      return;
    }

    const node = {
      id,
      type: "story",
      title,
      level: (indent / 2) + 1,
      line,
      parentId: parent?.node.id ?? null,
      children: [],
      status: item[2].toLowerCase() === "x" ? "complete" : "todo",
      stage: null,
      date: null,
      evidence: "declared",
      refs: emptyRefs(),
    };
    nodes.push(node);
    byId.set(id, node);
    if (parent) parent.node.children.push(id);
    stack.push({ indent, node });
  });

  for (const node of nodes) {
    if (node.children.length > 0) node.type = "feature";
  }
  for (const node of nodes) {
    if (node.parentId === null && node.type !== "feature") {
      diagnostics.push(diagnostic(node.line, `top-level checklist item must contain children: ${node.id}`));
    }
  }
  if (nodes.length === 0) diagnostics.push(diagnostic(1, "feature tree contains no checklist items"));
  if (diagnostics.length > 0) throw new FeatureTreeParseError(diagnostics, source);

  return {
    kind: FEATURE_TREE_KIND,
    schemaVersion: FEATURE_TREE_SCHEMA_VERSION,
    source,
    roots: nodes.filter((node) => node.type === "feature" && node.parentId === null).map((node) => node.id),
    nodes,
  };
}

export function parseFeatureTreeMarkdown(text, { source = "feature-tree.md" } = {}) {
  if (String(text ?? "").split(/\r?\n/u).some((line) => /^\s*[-*+]\s+\[[^\]]*\]/u.test(line))) {
    return parseChecklistTree(text, { source });
  }
  const diagnostics = [];
  const nodes = [];
  const byId = new Map();
  const featureStack = [];
  let current = null;

  String(text ?? "").split(/\r?\n/u).forEach((lineText, index) => {
    const line = index + 1;
    const heading = lineText.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const type = heading[2].toLowerCase();
      const title = heading[3].trim();
      const id = heading[4];
      if (byId.has(id)) {
        diagnostics.push(diagnostic(line, `duplicate id: ${id}`));
        current = null;
        return;
      }
      if ([...title].length > 160) diagnostics.push(diagnostic(line, "heading title is too long"));

      while (featureStack.length > 0 && featureStack.at(-1).level >= level) featureStack.pop();
      const parentFeature = featureStack.at(-1)?.node ?? null;
      if (type === "story" && !parentFeature) {
        diagnostics.push(diagnostic(line, `orphan story: ${id}`));
      }

      const node = {
        id,
        type,
        title,
        level,
        line,
        parentId: parentFeature?.id ?? null,
        children: [],
        status: null,
        stage: null,
        date: null,
        evidence: null,
        refs: emptyRefs(),
      };
      nodes.push(node);
      byId.set(id, node);
      if (parentFeature) parentFeature.children.push(id);
      if (type === "feature") featureStack.push({ level, node });
      current = node;
      return;
    }

    const metadata = lineText.match(METADATA_RE);
    if (metadata) {
      const [, key, value] = metadata;
      if (!current) {
        diagnostics.push(diagnostic(line, `metadata has no Feature or Story owner: ${key}`));
        return;
      }
      if (!SUPPORTED_KEYS.has(key)) {
        diagnostics.push(diagnostic(line, `unsupported metadata key: ${key}`));
        return;
      }
      const problem = validateMetadata(key, value);
      if (problem) {
        diagnostics.push(diagnostic(line, problem));
        return;
      }
      if (MULTI_KEYS.has(key)) {
        const values = current.refs[refKey(key)];
        if (!values.includes(value)) values.push(value);
      } else if (current[key] !== null) {
        diagnostics.push(diagnostic(line, `duplicate ${key} metadata for ${current.id}`));
      } else {
        current[key] = value;
      }
      return;
    }

    if (/^\s*[-*]\s+/u.test(lineText) && current) {
      diagnostics.push(diagnostic(line, "metadata must use a supported key followed by a colon"));
    }
  });

  if (nodes.length === 0) diagnostics.push(diagnostic(1, "feature tree contains no typed headings"));
  if (diagnostics.length > 0) throw new FeatureTreeParseError(diagnostics, source);
  for (const node of nodes) node.evidence ??= "declared";

  return {
    kind: FEATURE_TREE_KIND,
    schemaVersion: FEATURE_TREE_SCHEMA_VERSION,
    source,
    roots: nodes.filter((node) => node.type === "feature" && node.parentId === null).map((node) => node.id),
    nodes,
  };
}

export function emptyFeatureTree(source = null) {
  return {
    kind: FEATURE_TREE_KIND,
    schemaVersion: FEATURE_TREE_SCHEMA_VERSION,
    source,
    roots: [],
    nodes: [],
  };
}

export function featureTreeDescendantIds(tree, nodeId) {
  const byId = new Map((tree?.nodes ?? []).map((node) => [node.id, node]));
  if (!byId.has(nodeId)) return [];
  const selected = [];
  const queue = [nodeId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (selected.includes(id)) continue;
    selected.push(id);
    queue.push(...(byId.get(id)?.children ?? []));
  }
  return selected;
}
