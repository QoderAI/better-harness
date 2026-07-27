import path from "node:path";

const DEFAULT_TOP_LIMIT = 20;
const FAILURE_WINDOW_MS = 2 * 60 * 1000;
const CORRECTION_WINDOW_MS = 10 * 60 * 1000;
const ALTERNATE_WINDOW_MS = 5 * 60 * 1000;
const READ_AFTER_WRITE_WINDOW_MS = 5 * 60 * 1000;

const READ_TOOL_NAMES = new Set([
  "read",
  "readfile",
  "read_file",
  "open",
  "view",
]);

const EDIT_TOOL_NAMES = new Set([
  "edit",
  "multiedit",
  "notebookedit",
  "write",
]);

const READ_COMMANDS = new Set([
  "bat",
  "cat",
  "gc",
  "get-content",
  "head",
  "less",
  "more",
  "nl",
  "sed",
  "tail",
  "type",
]);

const SEARCH_COMMANDS = new Set(["grep", "rg"]);

const OPTION_ARGS = new Set([
  "-A",
  "-B",
  "-C",
  "-c",
  "-e",
  "-f",
  "-m",
  "-n",
  "--after-context",
  "--before-context",
  "--context",
  "--encoding",
  "--glob",
  "--max-count",
  "--type",
  "--type-add",
]);

const CORRECTION_PATTERNS = [
  /\b(?:wrong|incorrect|mistaken)\s+(?:file|path)\b/i,
  /\b(?:not|isn't|isnt)\s+(?:that|this|the)\s+(?:file|path)\b/i,
  /\bread\s+the\s+wrong\s+(?:file|path)\b/i,
  /\bmisread\b/i,
  /读错|看错|误读|不是这个(?:文件|路径)|读的不是|看的不是|应该(?:读|看)|别看这个/u,
];

const ROOT_REFERENCE_DOC_GROUPS = [
  "agent-customize",
  "detector",
  "loop-engineering",
  "project-harness",
  "session-evidence",
  "tool-runtimes",
].join("|");

const WRONG_RELATIVE_DOC_PATH_RULES = [
  {
    id: "harness-skill-models-relative-path",
    pattern: /(?:^|.*\/)skills\/better-harness\/models\/.+\.md$/u,
  },
  {
    id: "harness-skill-templates-relative-path",
    pattern: /(?:^|.*\/)skills\/better-harness\/templates\/.+\.md$/u,
  },
  {
    id: "harness-skill-references-relative-path",
    pattern: new RegExp(`(?:^|.*/)skills/better-harness/references/(?:${ROOT_REFERENCE_DOC_GROUPS})/.+\\.md$`, "u"),
  },
  {
    id: "harness-report-style-relative-path",
    pattern: /(?:^|.*\/)templates\/harness-report\/style\/.+\.md$/u,
  },
];

function eventTime(event) {
  const value = event?.timestamp ? new Date(event.timestamp).getTime() : null;
  return Number.isFinite(value) ? value : null;
}

function cleanToken(token) {
  return String(token ?? "")
    .trim()
    .replace(/^[<([{]+/, "")
    .replace(/[>),;]+$/, "")
    .replace(/:\d+(?::\d+)?$/, "");
}

function isUrlToken(token) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(token));
}

function commandBase(token) {
  return path.win32.basename(String(token ?? "").toLowerCase()).replace(/\.exe$/, "");
}

function isSeparatorToken(token) {
  return ["&&", "||", ";", "|"].includes(token);
}

function isLikelyFilePath(token) {
  const value = cleanToken(token);
  if (!value || value.startsWith("-") || isUrlToken(value) || /^[<>|&]+$/.test(value)) {
    return false;
  }
  if (/^\d+(?:,\d+)?[a-z]?$/i.test(value)) {
    return false;
  }
  if (/[*?{}]/.test(value)) {
    return false;
  }
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("/") ||
    value.includes("/") ||
    value.includes("\\") ||
    /\.[A-Za-z0-9][A-Za-z0-9_-]{0,12}$/.test(value) ||
    ["Dockerfile", "Makefile", "Gemfile", "Rakefile"].includes(value)
  );
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  const chars = [...String(command)];

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const next = chars[index + 1];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === '"' && next) {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if ((char === "&" && next === "&") || (char === "|" && next === "|")) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      tokens.push(`${char}${next}`);
      index += 1;
      continue;
    }
    if (char === ";" || char === "|") {
      if (current) {
        tokens.push(current);
        current = "";
      }
      tokens.push(char);
      continue;
    }
    if (char === "\\" && next && (/\s/.test(next) || next === "'" || next === '"' || next === "\\")) {
      current += next;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function splitSegments(tokens) {
  const segments = [];
  let current = [];
  for (const token of tokens) {
    if (isSeparatorToken(token)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push(token);
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}

function fileArgs(tokens, options = {}) {
  const results = [];
  let skipNext = false;
  let skippedSearchPattern = false;
  for (const token of tokens) {
    const value = cleanToken(token);
    if (!value) {
      continue;
    }
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (OPTION_ARGS.has(value) || OPTION_ARGS.has(value.split("=")[0])) {
      skipNext = !value.includes("=");
      continue;
    }
    if (value.startsWith("-") || /^[0-9]+[a-z]?$/.test(value) || /^2?>/.test(value)) {
      continue;
    }
    if (options.skipFirstPattern && !skippedSearchPattern && !isLikelyFilePath(value)) {
      skippedSearchPattern = true;
      continue;
    }
    if (options.skipFirstScript && !skippedSearchPattern && !isLikelyFilePath(value)) {
      skippedSearchPattern = true;
      continue;
    }
    if (isLikelyFilePath(value)) {
      results.push(value);
    }
  }
  return results;
}

function commandTargetsFromTokens(tokens, depth = 0) {
  if (tokens.length === 0 || depth > 2) {
    return [];
  }

  const base = commandBase(tokens[0]);
  if (["bash", "sh", "zsh", "fish", "cmd", "powershell", "pwsh"].includes(base)) {
    const inlineIndex = tokens.findIndex((token) => /^-.*c$|^\/c$/i.test(token) || /^-command$/i.test(token));
    if (inlineIndex !== -1 && tokens[inlineIndex + 1]) {
      return parseCommandFileTargets(tokens.slice(inlineIndex + 1).join(" "), depth + 1);
    }
  }

  if (READ_COMMANDS.has(base)) {
    const skipFirstScript = base === "sed";
    return fileArgs(tokens.slice(1), { skipFirstScript });
  }
  if (SEARCH_COMMANDS.has(base) && !tokens.includes("--files")) {
    return fileArgs(tokens.slice(1), { skipFirstPattern: true });
  }
  return [];
}

function parseCommandFileTargets(command, depth = 0) {
  const tokens = tokenizeCommand(command);
  return splitSegments(tokens).flatMap((segment) => commandTargetsFromTokens(segment, depth));
}

function canonicalToolName(name) {
  return String(name ?? "").replace(/[^A-Za-z0-9_]/g, "").toLowerCase();
}

function operationForTool(toolName) {
  const canonical = canonicalToolName(toolName);
  if (READ_TOOL_NAMES.has(canonical)) {
    return "read";
  }
  if (EDIT_TOOL_NAMES.has(canonical)) {
    return "edit";
  }
  return "file";
}

function normalizePathForDisplay(value, scope = {}, event = {}) {
  const cleaned = cleanToken(value);
  if (!cleaned) {
    return null;
  }

  const workspace = scope.workspace ? path.resolve(scope.workspace) : null;
  const cwd = event.cwd ? path.resolve(event.cwd) : workspace;
  const isWinAbsolute = /^[A-Za-z]:[\\/]/.test(cleaned);
  const absolute = path.isAbsolute(cleaned) || isWinAbsolute
    ? path.normalize(cleaned)
    : cwd
      ? path.resolve(cwd, cleaned)
      : path.normalize(cleaned);

  if (workspace && !isWinAbsolute) {
    const relative = path.relative(workspace, absolute);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join("/");
    }
    if (relative === "") {
      return ".";
    }
  }

  return absolute.split(path.sep).join("/");
}

function addReason(access, reason, evidenceRef) {
  access.reasonSet.add(reason);
  if (evidenceRef && access.relatedEvidenceRefs.length < 8) {
    access.relatedEvidenceRefs.push(evidenceRef);
  }
}

function extractAccesses(events, scope) {
  const accesses = [];
  for (const [index, event] of events.entries()) {
    const candidates = [];
    if (event.filePath) {
      candidates.push({
        path: event.filePath,
        operation: operationForTool(event.toolName),
        source: "tool-path",
      });
    }
    if (event.commandText) {
      for (const target of parseCommandFileTargets(event.commandText)) {
        candidates.push({
          path: target,
          operation: "read",
          source: "command",
        });
      }
    }

    const seen = new Set();
    for (const candidate of candidates) {
      const displayPath = normalizePathForDisplay(candidate.path, scope, event);
      if (!displayPath || seen.has(`${candidate.operation}:${displayPath}`)) {
        continue;
      }
      seen.add(`${candidate.operation}:${displayPath}`);
      accesses.push({
        index,
        sessionId: event.sessionId ?? "(unknown)",
        timestamp: event.timestamp ?? null,
        time: eventTime(event),
        path: displayPath,
        operation: candidate.operation,
        source: candidate.source,
        toolName: event.toolName ?? null,
        evidenceRef: event.evidenceRef,
        reasonSet: new Set(),
        wrongRelativePathRuleSet: new Set(),
        relatedEvidenceRefs: [],
      });
    }
  }
  return accesses;
}

function isFailureEvent(event) {
  return event?.success === false || event?.hasError || event?.level === "error";
}

function isCorrectionEvent(event) {
  if (!event?.userText || !(event.type === "user" || event.type === "last-prompt" || event.type === "response_item")) {
    return false;
  }
  return CORRECTION_PATTERNS.some((pattern) => pattern.test(event.userText));
}

function latestAccessBefore(accesses, event, windowMs) {
  const eventMs = eventTime(event);
  let found = null;
  for (const access of accesses) {
    if (access.sessionId !== (event.sessionId ?? "(unknown)") || access.index >= event.index) {
      continue;
    }
    if (eventMs !== null && access.time !== null && eventMs - access.time > windowMs) {
      continue;
    }
    if (!found || access.index > found.index) {
      found = access;
    }
  }
  return found;
}

function basenameParts(filePath) {
  const normalized = String(filePath).replace(/\\/g, "/");
  const parsed = path.posix.parse(normalized);
  return {
    dir: parsed.dir,
    base: parsed.name.toLowerCase(),
    ext: parsed.ext.toLowerCase(),
  };
}

function levenshteinDistance(left, right) {
  const a = [...left];
  const b = [...right];
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let index = 0; index <= a.length; index += 1) {
    dp[index][0] = index;
  }
  for (let index = 0; index <= b.length; index += 1) {
    dp[0][index] = index;
  }
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      dp[row][column] = Math.min(
        dp[row - 1][column] + 1,
        dp[row][column - 1] + 1,
        dp[row - 1][column - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

function looksLikeAlternateRead(left, right) {
  if (left.path === right.path || left.operation !== "read" || right.operation !== "read") {
    return false;
  }
  const a = basenameParts(left.path);
  const b = basenameParts(right.path);
  if (!a.ext || a.ext !== b.ext) {
    return false;
  }
  const closeName =
    levenshteinDistance(a.base, b.base) <= 2 ||
    (Math.abs(a.base.length - b.base.length) <= 4 && (a.base.includes(b.base) || b.base.includes(a.base)));
  return closeName && (a.dir === b.dir || a.base.length >= 5);
}

function hasReadFailureReason(access) {
  return access.reasonSet.has("failed-read") || access.reasonSet.has("failure-after-read");
}

function annotateReadAfterWriteFailures(accesses) {
  for (let leftIndex = 0; leftIndex < accesses.length; leftIndex += 1) {
    const write = accesses[leftIndex];
    if (write.operation !== "edit") {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < accesses.length; rightIndex += 1) {
      const read = accesses[rightIndex];
      if (write.sessionId !== read.sessionId) {
        continue;
      }
      if (write.time !== null && read.time !== null && read.time - write.time > READ_AFTER_WRITE_WINDOW_MS) {
        break;
      }
      if (read.operation === "read" && read.path === write.path && hasReadFailureReason(read)) {
        addReason(read, "read-after-write-failure", write.evidenceRef);
        break;
      }
    }
  }
}

function wrongRelativeDocPathRuleIds(filePath) {
  const normalized = String(filePath ?? "").replace(/\\/g, "/");
  if (!/\.md$/iu.test(normalized)) {
    return [];
  }
  return WRONG_RELATIVE_DOC_PATH_RULES.filter((rule) => rule.pattern.test(normalized)).map((rule) => rule.id);
}

function annotateWrongRelativeDocPaths(accesses) {
  for (const access of accesses) {
    if (access.operation !== "read") {
      continue;
    }
    const ruleIds = wrongRelativeDocPathRuleIds(access.path);
    if (ruleIds.length === 0) {
      continue;
    }
    addReason(access, "wrong-relative-doc-path", access.evidenceRef);
    for (const ruleId of ruleIds) {
      access.wrongRelativePathRuleSet.add(ruleId);
    }
  }
}

function annotateAccesses(accesses, events) {
  const indexedEvents = events.map((event, index) => ({ ...event, index }));
  for (const access of accesses) {
    if (access.operation === "read" && isFailureEvent(indexedEvents[access.index])) {
      addReason(access, "failed-read", access.evidenceRef);
    }
  }

  for (const event of indexedEvents) {
    if (isFailureEvent(event)) {
      const access = latestAccessBefore(accesses, event, FAILURE_WINDOW_MS);
      if (access) {
        addReason(access, "failure-after-read", event.evidenceRef);
      }
    }
    if (isCorrectionEvent(event)) {
      const access = latestAccessBefore(accesses, event, CORRECTION_WINDOW_MS);
      if (access) {
        addReason(access, "user-correction-after-read", event.evidenceRef);
      }
    }
  }

  for (let leftIndex = 0; leftIndex < accesses.length; leftIndex += 1) {
    const left = accesses[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < accesses.length; rightIndex += 1) {
      const right = accesses[rightIndex];
      if (left.sessionId !== right.sessionId) {
        continue;
      }
      if (left.time !== null && right.time !== null && right.time - left.time > ALTERNATE_WINDOW_MS) {
        break;
      }
      if (looksLikeAlternateRead(left, right)) {
        addReason(left, "similar-alternate-read", right.evidenceRef);
        break;
      }
    }
  }

  annotateReadAfterWriteFailures(accesses);
  annotateWrongRelativeDocPaths(accesses);
}

function aggregateAccesses(accesses) {
  const files = new Map();
  for (const access of accesses) {
    const file = files.get(access.path) ?? {
      path: access.path,
      accessCount: 0,
      readCount: 0,
      editCount: 0,
      failureCount: 0,
      correctionCount: 0,
      alternateReadCount: 0,
      readAfterWriteFailureCount: 0,
      wrongRelativePathCount: 0,
      issueScore: 0,
      sessions: new Set(),
      reasons: new Set(),
      wrongRelativePathRules: new Set(),
      evidenceRefs: [],
    };

    file.accessCount += 1;
    if (access.operation === "read") {
      file.readCount += 1;
    } else if (access.operation === "edit") {
      file.editCount += 1;
    }
    file.sessions.add(access.sessionId);
    if (access.evidenceRef && file.evidenceRefs.length < 8) {
      file.evidenceRefs.push(access.evidenceRef);
    }
    for (const ref of access.relatedEvidenceRefs) {
      if (file.evidenceRefs.length < 8) {
        file.evidenceRefs.push(ref);
      }
    }
    for (const reason of access.reasonSet) {
      file.reasons.add(reason);
      if (reason === "failed-read" || reason === "failure-after-read") {
        file.failureCount += 1;
        file.issueScore += 4;
      } else if (reason === "user-correction-after-read") {
        file.correctionCount += 1;
        file.issueScore += 3;
      } else if (reason === "similar-alternate-read") {
        file.alternateReadCount += 1;
        file.issueScore += 1;
      } else if (reason === "read-after-write-failure") {
        file.readAfterWriteFailureCount += 1;
        file.issueScore += 5;
      } else if (reason === "wrong-relative-doc-path") {
        file.wrongRelativePathCount += 1;
        file.issueScore += 3;
      }
    }
    for (const ruleId of access.wrongRelativePathRuleSet) {
      file.wrongRelativePathRules.add(ruleId);
    }
    files.set(access.path, file);
  }

  return [...files.values()].map((file) => ({
    path: file.path,
    accessCount: file.accessCount,
    readCount: file.readCount,
    editCount: file.editCount,
    sessionCount: file.sessions.size,
    issueScore: file.issueScore,
    failureCount: file.failureCount,
    correctionCount: file.correctionCount,
    alternateReadCount: file.alternateReadCount,
    readAfterWriteFailureCount: file.readAfterWriteFailureCount,
    wrongRelativePathCount: file.wrongRelativePathCount,
    reasons: [...file.reasons].sort(),
    wrongRelativePathRules: [...file.wrongRelativePathRules].sort(),
    evidenceRefs: file.evidenceRefs,
  }));
}

function sortTopFiles(left, right) {
  return (
    right.accessCount - left.accessCount ||
    right.readCount - left.readCount ||
    right.issueScore - left.issueScore ||
    left.path.localeCompare(right.path)
  );
}

function sortIssueCandidates(left, right) {
  return (
    right.issueScore - left.issueScore ||
    right.failureCount - left.failureCount ||
    right.correctionCount - left.correctionCount ||
    right.alternateReadCount - left.alternateReadCount ||
    left.path.localeCompare(right.path)
  );
}

function sortReadAfterWriteFailures(left, right) {
  return (
    right.readAfterWriteFailureCount - left.readAfterWriteFailureCount ||
    right.issueScore - left.issueScore ||
    right.failureCount - left.failureCount ||
    left.path.localeCompare(right.path)
  );
}

function sortWrongRelativePathCandidates(left, right) {
  return (
    right.wrongRelativePathCount - left.wrongRelativePathCount ||
    right.issueScore - left.issueScore ||
    right.failureCount - left.failureCount ||
    left.path.localeCompare(right.path)
  );
}

function diagnosticsSummary(files) {
  return {
    issueCandidateCount: files.filter((file) => file.issueScore > 0).length,
    readAfterWriteFailureCount: files.reduce((total, file) => total + file.readAfterWriteFailureCount, 0),
    wrongRelativePathCount: files.reduce((total, file) => total + file.wrongRelativePathCount, 0),
  };
}

function sampleSummary(indexedSessions, detailedSessions, accesses) {
  const timeRange = { firstSeen: null, lastSeen: null };
  for (const session of detailedSessions) {
    if (session.firstSeen && (!timeRange.firstSeen || new Date(session.firstSeen) < new Date(timeRange.firstSeen))) {
      timeRange.firstSeen = session.firstSeen;
    }
    if (session.lastSeen && (!timeRange.lastSeen || new Date(session.lastSeen) > new Date(timeRange.lastSeen))) {
      timeRange.lastSeen = session.lastSeen;
    }
  }
  return {
    sessionCount: indexedSessions.length,
    analyzedSessionCount: detailedSessions.length,
    fileAccessCount: accesses.length,
    sampled: indexedSessions.length > detailedSessions.length,
    timeRange,
  };
}

export function buildFileReadDiagnostics(input = {}) {
  const scope = input.scope ?? {};
  const events = input.events ?? [];
  const sessions = input.sessions ?? [];
  const indexedSessions = input.indexedSessions ?? sessions;
  const warnings = input.warnings ?? [];

  const accesses = extractAccesses(events, scope);
  annotateAccesses(accesses, events);
  const files = aggregateAccesses(accesses);
  const topFiles = files.sort(sortTopFiles).slice(0, Number(input.topLimit ?? DEFAULT_TOP_LIMIT));
  const issueCandidates = files
    .filter((file) => file.issueScore > 0)
    .sort(sortIssueCandidates)
    .slice(0, Number(input.issueLimit ?? DEFAULT_TOP_LIMIT));
  const readAfterWriteFailures = files
    .filter((file) => file.readAfterWriteFailureCount > 0)
    .sort(sortReadAfterWriteFailures)
    .slice(0, Number(input.issueLimit ?? DEFAULT_TOP_LIMIT));
  const wrongRelativePathCandidates = files
    .filter((file) => file.wrongRelativePathCount > 0)
    .sort(sortWrongRelativePathCandidates)
    .slice(0, Number(input.issueLimit ?? DEFAULT_TOP_LIMIT));

  return {
    schemaVersion: 1,
    scope,
    sample: sampleSummary(indexedSessions, sessions, accesses),
    diagnostics: diagnosticsSummary(files),
    topFiles,
    issueCandidates,
    readAfterWriteFailures,
    wrongRelativePathCandidates,
    warnings,
  };
}
