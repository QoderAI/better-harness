import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  componentTemplateLanguageId,
  isComponentFile,
  isMarkdownFile,
  isNotebookFile,
  languageForFence,
  languageForNameOrId,
  languageForPath,
  languageName,
  syntaxForLanguage,
  toPosix,
} from "./languages.generated.mjs";
import { countBufferBySyntax, countNoComment } from "./scanners.mjs";

const LOCK_FILE_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "yarn.lock",
]);
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

function maxFileBytes(options = {}) {
  const configured = Number(options.maxFileBytes);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_FILE_BYTES;
}

function readBoundedFile(descriptor, limit) {
  const chunks = [];
  let total = 0;
  while (total <= limit) {
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, limit - total + 1));
    const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
    if (bytesRead === 0) {
      return Buffer.concat(chunks, total);
    }
    total += bytesRead;
    if (total > limit) {
      return null;
    }
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return null;
}

function emptyTotals() {
  return {
    files: 0,
    lines: 0,
    blank: 0,
    comment: 0,
    code: 0,
    bytes: 0,
  };
}

function addLineCounts(target, source) {
  target.lines += source.lines;
  target.blank += source.blank;
  target.comment += source.comment;
  target.code += source.code;
}

function countTextForLanguage(text, languageId) {
  const buffer = Buffer.from(text);
  const counts = countBufferBySyntax(buffer, syntaxForLanguage(languageId));
  return counts ? { ...counts, bytes: buffer.length } : null;
}

function makeRecord(filePath, languageId, counts, segment = "") {
  return {
    path: toPosix(filePath),
    segment,
    languageId,
    language: languageName(languageId),
    blank: counts.blank,
    comment: counts.comment,
    code: counts.code,
    lines: counts.lines,
    bytes: counts.bytes,
  };
}

function pushRecord(records, filePath, languageId, text, segment = "") {
  if (!text) {
    return;
  }
  const counts = countTextForLanguage(text, languageId);
  if (counts && counts.lines > 0) {
    records.push(makeRecord(filePath, languageId, counts, segment));
  }
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function isCountablePath(filePath) {
  const base = path.posix.basename(toPosix(filePath)).toLowerCase();
  if (LOCK_FILE_NAMES.has(base)) {
    return false;
  }
  return isComponentFile(filePath)
    || isNotebookFile(filePath)
    || isMarkdownFile(filePath)
    || Boolean(languageForPath(filePath));
}

function scriptLanguageId(attributes = "") {
  const match = /\blang\s*=\s*["']?([^"'\s>]+)/i.exec(attributes);
  if (match) {
    const languageId = languageForFence(match[1]);
    if (languageId) {
      return languageId;
    }
  }
  return "javascript";
}

function styleLanguageId(attributes = "") {
  const match = /\blang\s*=\s*["']?([^"'\s>]+)/i.exec(attributes);
  return languageForFence(match?.[1] ?? "css") ?? "css";
}

function parseAstroFrontmatter(text) {
  if (!text.startsWith("---")) {
    return { script: "", template: text };
  }
  const closeMatch = /\n---\s*(?:\r?\n|$)/.exec(text.slice(3));
  if (!closeMatch) {
    return { script: "", template: text };
  }
  const closeStart = closeMatch.index + 3;
  const closeEnd = closeStart + closeMatch[0].length;
  return {
    script: text.slice(3, closeStart),
    template: text.slice(closeEnd),
  };
}

export function countComponentFile(buffer, filePath) {
  const text = buffer.toString("utf8");
  const records = [];
  const templateLanguageId = componentTemplateLanguageId(filePath);
  const blockPattern = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let templateParts = [];
  let cursor = 0;
  let sourceText = text;

  if (path.posix.extname(toPosix(filePath)).toLowerCase() === ".astro") {
    const astro = parseAstroFrontmatter(text);
    sourceText = astro.template;
    pushRecord(records, filePath, "javascript", astro.script, "frontmatter");
  }

  for (const match of sourceText.matchAll(blockPattern)) {
    templateParts.push(sourceText.slice(cursor, match.index));
    const kind = match[1].toLowerCase();
    const attributes = match[2] ?? "";
    const body = match[3] ?? "";
    pushRecord(
      records,
      filePath,
      kind === "script" ? scriptLanguageId(attributes) : styleLanguageId(attributes),
      body,
      kind,
    );
    cursor = match.index + match[0].length;
  }
  templateParts.push(sourceText.slice(cursor));

  pushRecord(records, filePath, templateLanguageId, templateParts.join(""), "template");
  return records;
}

function notebookSourceToText(source) {
  if (Array.isArray(source)) {
    return source.join("");
  }
  return typeof source === "string" ? source : "";
}

export function countNotebookFile(buffer, filePath) {
  let notebook;
  try {
    notebook = JSON.parse(buffer.toString("utf8"));
  } catch {
    return [];
  }
  const languageId = languageForNameOrId(notebook?.metadata?.language_info?.name) ?? "python";
  const codeText = (notebook?.cells ?? [])
    .filter((cell) => cell?.cell_type === "code")
    .map((cell) => notebookSourceToText(cell.source))
    .join("\n");
  const records = [];
  pushRecord(records, filePath, languageId, codeText, "code-cells");
  return records;
}

export function countMarkdownFile(buffer, filePath, options = {}) {
  if (!options.markdownCode) {
    const counts = { ...countNoComment(buffer), bytes: buffer.length };
    return [makeRecord(filePath, "markdown", counts)];
  }

  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  const markdownLines = [];
  const records = [];
  let fence = null;
  let fenceLanguageId = null;
  let fenceLines = [];

  for (const line of lines) {
    const startMatch = /^(```+|~~~+)\s*([A-Za-z0-9_+.#-]*)/.exec(line.trim());
    if (!fence && startMatch) {
      fence = startMatch[1][0];
      fenceLanguageId = languageForFence(startMatch[2]);
      fenceLines = [];
      continue;
    }

    const endPattern = fence === "`" ? /^```+/ : /^~~~+/;
    if (fence && endPattern.test(line.trim())) {
      if (fenceLanguageId) {
        pushRecord(records, filePath, fenceLanguageId, fenceLines.join("\n"), `fence:${fenceLanguageId}`);
      } else {
        markdownLines.push(...fenceLines);
      }
      fence = null;
      fenceLanguageId = null;
      fenceLines = [];
      continue;
    }

    if (fence) {
      fenceLines.push(line);
    } else {
      markdownLines.push(line);
    }
  }

  if (fence) {
    markdownLines.push(...fenceLines);
  }
  pushRecord(records, filePath, "markdown", markdownLines.join("\n"), "markdown");
  return records;
}

export function countKnownFileBuffer(buffer, filePath, options = {}) {
  if (!isCountablePath(filePath)) {
    return [];
  }
  if (isComponentFile(filePath)) {
    return countComponentFile(buffer, filePath);
  }
  if (isNotebookFile(filePath)) {
    return countNotebookFile(buffer, filePath);
  }
  if (isMarkdownFile(filePath)) {
    return countMarkdownFile(buffer, filePath, options);
  }

  const languageId = languageForPath(filePath);
  if (!languageId) {
    return [];
  }
  const counts = countBufferBySyntax(buffer, syntaxForLanguage(languageId));
  return counts ? [makeRecord(filePath, languageId, { ...counts, bytes: buffer.length })] : [];
}

export function countFile(repoRoot, filePath, options = {}) {
  const normalized = toPosix(filePath);
  const fileSizeLimit = maxFileBytes(options);
  if (!isCountablePath(normalized)) {
    return { path: normalized, skipped: true, reason: "unsupported" };
  }

  const root = path.resolve(repoRoot);
  const absolutePath = path.resolve(root, normalized);
  if (!isPathInside(root, absolutePath)) {
    return { path: normalized, skipped: true, reason: "outside-repo" };
  }

  let stat;
  try {
    stat = lstatSync(absolutePath);
  } catch {
    return { path: normalized, skipped: true, reason: "missing" };
  }
  if (!stat.isFile()) {
    return { path: normalized, skipped: true, reason: "non-regular" };
  }
  if (stat.size > fileSizeLimit) {
    return { path: normalized, skipped: true, reason: "too-large" };
  }

  try {
    const realRoot = realpathSync(root);
    const realPath = realpathSync(absolutePath);
    if (!isPathInside(realRoot, realPath)) {
      return { path: normalized, skipped: true, reason: "outside-repo" };
    }
  } catch {
    return { path: normalized, skipped: true, reason: "unreadable" };
  }

  let descriptor;
  let buffer;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    descriptor = openSync(absolutePath, fsConstants.O_RDONLY | noFollow);
    const openedStat = fstatSync(descriptor);
    if (!openedStat.isFile()) {
      return { path: normalized, skipped: true, reason: "non-regular" };
    }
    if (openedStat.size > fileSizeLimit) {
      return { path: normalized, skipped: true, reason: "too-large" };
    }
    buffer = readBoundedFile(descriptor, fileSizeLimit);
    if (buffer === null) {
      return { path: normalized, skipped: true, reason: "too-large" };
    }
  } catch {
    return { path: normalized, skipped: true, reason: "unreadable" };
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The read result already captures the useful failure boundary.
      }
    }
  }

  const records = countKnownFileBuffer(buffer, normalized, options);
  if (records.length === 0) {
    return { path: normalized, bytes: buffer.length, skipped: true, reason: "unsupported" };
  }
  return {
    path: normalized,
    bytes: buffer.length,
    skipped: false,
    records,
  };
}

export function countFiles(repoRoot, files, options = {}) {
  return files.map((filePath) => countFile(repoRoot, filePath, options));
}

function addSkippedFile(summary, result) {
  summary.skipped += 1;
  if (summary.skippedFiles.length < 50) {
    summary.skippedFiles.push({ path: result.path, reason: result.reason });
  }
}

export function addCountResultToSummary(summary, result) {
  if (result.skipped) {
    addSkippedFile(summary, result);
    return summary;
  }

  summary.totals.files += 1;
  summary.totals.bytes += result.bytes ?? 0;
  const seenLanguageIds = new Set();

  for (const record of result.records) {
    addLineCounts(summary.totals, record);
    const stats = summary.languageStats[record.languageId] ?? {
      languageId: record.languageId,
      language: record.language,
      files: 0,
      lines: 0,
      blank: 0,
      comment: 0,
      code: 0,
      bytes: 0,
    };

    if (!seenLanguageIds.has(record.languageId)) {
      stats.files += 1;
      seenLanguageIds.add(record.languageId);
    }
    addLineCounts(stats, record);
    stats.bytes += record.bytes ?? 0;
    summary.languageStats[record.languageId] = stats;
  }

  return summary;
}

export function emptyCountSummary() {
  return {
    totals: emptyTotals(),
    languageStats: {},
    skipped: 0,
    skippedFiles: [],
  };
}

export function countFilesSummary(repoRoot, files, options = {}) {
  const summary = emptyCountSummary();
  for (const filePath of files) {
    addCountResultToSummary(summary, countFile(repoRoot, filePath, options));
  }
  return summary;
}

export function mergeCountSummaries(summaries) {
  const merged = emptyCountSummary();
  for (const summary of summaries) {
    merged.totals.files += summary.totals.files;
    merged.totals.lines += summary.totals.lines;
    merged.totals.blank += summary.totals.blank;
    merged.totals.comment += summary.totals.comment;
    merged.totals.code += summary.totals.code;
    merged.totals.bytes += summary.totals.bytes;
    merged.skipped += summary.skipped;
    for (const skippedFile of summary.skippedFiles) {
      if (merged.skippedFiles.length < 50) {
        merged.skippedFiles.push(skippedFile);
      }
    }
    for (const stats of Object.values(summary.languageStats)) {
      const target = merged.languageStats[stats.languageId] ?? {
        languageId: stats.languageId,
        language: stats.language,
        files: 0,
        lines: 0,
        blank: 0,
        comment: 0,
        code: 0,
        bytes: 0,
      };
      target.files += stats.files;
      target.lines += stats.lines;
      target.blank += stats.blank;
      target.comment += stats.comment;
      target.code += stats.code;
      target.bytes += stats.bytes;
      merged.languageStats[stats.languageId] = target;
    }
  }
  return merged;
}

export function languageRowsFromSummary(summary) {
  return Object.values(summary.languageStats)
    .map((item) => ({
      language: item.language,
      files: item.files,
      lines: item.lines,
      blank: item.blank,
      comment: item.comment,
      code: item.code,
      bytes: item.bytes,
    }))
    .sort((a, b) => b.code - a.code || b.comment - a.comment || a.language.localeCompare(b.language));
}
