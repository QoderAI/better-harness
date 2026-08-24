export const NORMALIZED_TOOL_ACTIVITY_KIND = "NormalizedToolActivityV1";
export const NORMALIZED_TOOL_ACTIVITY_SCHEMA_VERSION = 1;

const FAMILY_ORDER = Object.freeze(["inspect", "change", "execute", "verify", "coordinate", "deliver", "other"]);
const PRIVATE_PATH_RE = /(^|[^\p{L}\p{N}_])\/(?:Users|home|var|private|tmp|opt)\/[^\s"'`<>]+/gmu;
const WINDOWS_PRIVATE_PATH_RE = /[A-Za-z]:\\(?:Users\\)?[^\s"'`<>]+/gu;

function actionFor(toolName, transientCommandText = "") {
  const tool = String(toolName ?? "").toLowerCase();
  const command = String(transientCommandText ?? "").toLowerCase();
  if (/(?:apply[_ /-]?patch|\bedit\b|\bwrite\b|\bcreate_file\b|\breplace\b)/u.test(tool)) return { operation: "edit-files", actionLabel: "Edit files", family: "change" };
  if (/git[^\n]{0,80}\bcommit\b/u.test(command)) return { operation: "create-commit", actionLabel: "Create commit", family: "deliver" };
  if (/git[^\n]{0,80}\bpush\b/u.test(command)) return { operation: "push-branch", actionLabel: "Push branch", family: "deliver" };
  if (/gh\s+pr\s+create/u.test(command)) return { operation: "create-pull-request", actionLabel: "Create pull request", family: "deliver" };
  if (/npm\s+publish/u.test(command)) return { operation: "publish-package", actionLabel: "Publish package", family: "deliver" };
  if (/(?:npm\s+(?:run\s+)?test|node\s+--test|\b(?:pytest|cargo\s+test|go\s+test|mvn\s+test|gradle\s+test)\b)/u.test(command)
    || /(?:^|[_/-])test(?:$|[_/-])/u.test(tool)) return { operation: "run-tests", actionLabel: "Run tests", family: "verify" };
  if (/(?:npm\s+run\s+(?:check|pack:verify|lint)|git\s+diff\s+--check|\blint\b|\bvalidate\b)/u.test(command)
    || /(?:validate|lint)/u.test(tool)) return { operation: "verify-project", actionLabel: "Verify project", family: "verify" };
  if (/(?:npm\s+run\s+build|\b(?:cargo|go|mvn|gradle)\s+build\b)/u.test(command)) return { operation: "build-project", actionLabel: "Build project", family: "verify" };
  if (/(?:\/health\b|canvas-module\.js|\bcurl\b|\bwget\b)/u.test(command)) return { operation: "check-runtime", actionLabel: "Check runtime", family: "verify" };
  if (/(?:browser|playwright|screenshot)/u.test(tool)) return { operation: "inspect-browser", actionLabel: "Inspect browser", family: "verify" };
  if (/(?:view_image|imagegen|image_gen)/u.test(tool)) return { operation: "inspect-image", actionLabel: "Inspect image", family: "verify" };
  if (/(?:update_plan|request_user|goal|thread|send_message|spawn_agent|followup_task)/u.test(tool)) return { operation: "coordinate-work", actionLabel: "Coordinate work", family: "coordinate" };
  if (/(?:write_stdin)/u.test(tool)) return { operation: "continue-process", actionLabel: "Continue process", family: "coordinate" };
  if (/(?:\bwait\b|wait_agent)/u.test(tool)) return { operation: "wait-process", actionLabel: "Wait for process", family: "coordinate" };
  if (/(?:tool_search)/u.test(tool)) return { operation: "find-tool", actionLabel: "Find tool", family: "inspect" };
  if (/(?:\bweb\b|web\/run)/u.test(tool)) return { operation: "research-web", actionLabel: "Research web", family: "inspect" };
  if (/git\s+(?:status|log|show|diff|branch|rev-parse)\b/u.test(command)) return { operation: "inspect-git", actionLabel: "Inspect Git", family: "inspect" };
  if (/(?:\brg\b|\bgrep\b|\bfind\b|\bfd\b)/u.test(command)
    || /(?:\bfind\b|\bsearch\b|\bglob\b|\blist\b)/u.test(tool)) return { operation: "search-repository", actionLabel: "Search repository", family: "inspect" };
  if (/(?:\bsed\b|\bcat\b|\bhead\b|\btail\b)/u.test(command)
    || /(?:^|[_/-])(?:read|view|open)(?:$|[_/-])/u.test(tool)) return { operation: "read-files", actionLabel: "Read files", family: "inspect" };
  if (/(?:exec|bash|shell|command|node_repl)/u.test(tool)) return { operation: "run-command", actionLabel: "Run command", family: "execute" };
  return { operation: "use-tool", actionLabel: "Use tool", family: "other" };
}

function decodeCommandLiteral(literal) {
  if (literal.startsWith('"')) {
    try {
      return JSON.parse(literal);
    } catch {
      // Fall through to the bounded non-evaluating decoder below.
    }
  }
  const quote = literal[0];
  const body = literal.slice(1, -1);
  return body.replace(/\\([\\'"`nrt])/gu, (_match, escaped) => ({
    n: "\n",
    r: "\r",
    t: "\t",
  })[escaped] ?? escaped).replaceAll(`\\${quote}`, quote);
}

function commandCandidate(value) {
  const source = String(value ?? "");
  const match = source.match(/(?:^|[{,(]\s*)(?:["']?(?:cmd|command)["']?)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/u);
  return match ? decodeCommandLiteral(match[1]) : source;
}

function safeToolDetail(toolName, transientCommandText, action) {
  const tool = String(toolName ?? "");
  if (!transientCommandText || action.operation === "edit-files") return null;
  let detail = commandCandidate(transientCommandText)
    .replaceAll(/\\n|\r?\n/gu, " ↵ ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (!detail || /^(?:const|let|var)\s|\bawait\s+tools\./u.test(detail)) return null;
  detail = detail
    .replace(/\b(?:authorization\s*:\s*)?bearer\s+[A-Za-z0-9._~+\/-]{8,}\b/giu, "Bearer <redacted>")
    .replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/giu, "$1=<redacted>")
    .replace(/\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}\b/giu, "<secret>")
    .replace(PRIVATE_PATH_RE, "$1<absolute-path>")
    .replace(WINDOWS_PRIVATE_PATH_RE, "<absolute-path>");
  const bounded = [...detail].slice(0, 180).join("");
  return bounded ? `${bounded}${[...detail].length > 180 ? "…" : ""}` : `${tool} detail unavailable`;
}

function safeRelativePath(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll("\\", "/").normalize("NFC").trim();
  if (!normalized
    || normalized.length > 500
    || normalized.startsWith("/")
    || /^[A-Za-z]:\//u.test(normalized)
    || normalized.split("/").some((part) => part === "..")
    || /[\u0000-\u001f\u007f]/u.test(normalized)) return null;
  return normalized;
}

function safeToolName(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (!normalized || normalized.length > 64 || !/^[\p{L}\p{N}_.:/ -]+$/u.test(normalized)) return null;
  return normalized;
}

function buildSegments(calls) {
  const segments = [];
  for (const call of calls) {
    const current = segments.at(-1);
    if (!current || current.family !== call.family) {
      segments.push({
        id: `S${segments.length + 1}`,
        family: call.family,
        startStep: call.step,
        endStep: call.step,
        callCount: 1,
        failedCount: call.status === "failed" ? 1 : 0,
        fileCount: call.filePaths?.length ?? (call.filePath ? 1 : 0),
        tools: [call.toolName],
      });
      continue;
    }
    current.endStep = call.step;
    current.callCount += 1;
    if (call.status === "failed") current.failedCount += 1;
    current.fileCount += call.filePaths?.length ?? (call.filePath ? 1 : 0);
    if (!current.tools.includes(call.toolName)) current.tools.push(call.toolName);
  }
  return segments;
}

function buildFiles(calls) {
  const files = new Map();
  for (const call of calls) {
    for (const filePath of call.filePaths ?? (call.filePath ? [call.filePath] : [])) {
      const item = files.get(filePath) ?? { path: filePath, callCount: 0, callIds: [], families: [] };
      item.callCount += 1;
      item.callIds.push(call.id);
      if (!item.families.includes(call.family)) item.families.push(call.family);
      files.set(filePath, item);
    }
  }
  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function normalizeToolActivity(traceCalls = [], requestFacts = []) {
  const factsByStep = new Map(requestFacts.map((fact) => [Number(fact.step), fact]));
  const factsByInvocation = new Map(requestFacts
    .filter((fact) => fact.transientInvocationKey)
    .map((fact) => [String(fact.transientInvocationKey), fact]));
  const calls = traceCalls.map((call, index) => {
    const step = Number.isInteger(Number(call?.step)) && Number(call.step) > 0 ? Number(call.step) : index + 1;
    const fact = call?.transientInvocationKey
      ? (factsByInvocation.get(String(call.transientInvocationKey)) ?? {})
      : (factsByStep.get(step) ?? {});
    const filePaths = [...new Set((fact.filePaths ?? [fact.filePath]).map(safeRelativePath).filter(Boolean))];
    const filePath = filePaths[0] ?? null;
    // ToolCallTraceV2 may collapse low-frequency names to "Other tools" for
    // its legacy lane budget. The checkpoint model keeps the sanitized request
    // identity so host-tool detail is not destroyed by a rendering concern.
    const toolName = safeToolName(fact.toolName) ?? safeToolName(call?.toolName) ?? "Unknown tool";
    const transientDetailInput = commandCandidate(fact.transientCommandText);
    const action = actionFor(toolName, transientDetailInput);
    const detail = safeToolDetail(toolName, transientDetailInput, action);
    return {
      id: `A${step}`,
      step,
      toolName,
      operation: action.operation,
      actionLabel: action.actionLabel,
      family: action.family,
      ...(detail ? { detail, detailKind: "redacted-input-summary" } : {}),
      status: call?.status === "failed" ? "failed" : "observed",
      durationStatus: call?.durationStatus === "observed" ? "observed" : "unobserved",
      ...(Number.isFinite(call?.startedAt) ? { startedAt: Math.round(call.startedAt) } : {}),
      ...(call?.durationStatus === "observed" && Number.isFinite(call.durationMs) ? { durationMs: Math.round(call.durationMs) } : {}),
      ...(filePath ? { filePath } : {}),
      ...(filePaths.length > 0 ? { filePaths } : {}),
    };
  }).sort((left, right) => left.step - right.step);
  const familyCounts = Object.fromEntries(FAMILY_ORDER.map((family) => [family, 0]));
  for (const call of calls) familyCounts[call.family] += 1;
  return {
    kind: NORMALIZED_TOOL_ACTIVITY_KIND,
    schemaVersion: NORMALIZED_TOOL_ACTIVITY_SCHEMA_VERSION,
    totalCalls: calls.length,
    failedCalls: calls.filter((call) => call.status === "failed").length,
    familyCounts,
    segments: buildSegments(calls),
    files: buildFiles(calls),
    calls,
  };
}
