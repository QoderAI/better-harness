#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SECRET_GUARD_PLATFORM,
  renderSecretGuardBlock,
  resolveSecretGuardPlatform,
} from "./platforms.mjs";

export const VERSION = "1.0.0";

const SEVERITY_SCORE = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const DEFAULT_IGNORE_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".gradle",
  ".idea",
  ".vscode",
]);

const DEFAULT_IGNORE_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "poetry.lock",
  "Pipfile.lock",
  "Cargo.lock",
  "Gemfile.lock",
]);

const DEFAULT_SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svgz",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".xz",
  ".7z",
  ".rar",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".woff",
  ".woff2",
  ".ttf",
  ".class",
  ".jar",
  ".war",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
]);

const ALLOWLIST_INLINE = /(?:secret-scan|gitleaks|trufflehog|detect-secrets)\s*:\s*(?:allow|ignore|allowlist)/i;

const RULES = [
  {
    id: "private-key",
    name: "Private key block",
    severity: "critical",
    confidence: "high",
    regex: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]{0,12000}?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
    group: 0,
  },
  {
    id: "aws-access-key-id",
    name: "AWS access key ID",
    severity: "high",
    confidence: "high",
    regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    group: 0,
  },
  {
    id: "aws-secret-access-key",
    name: "AWS secret access key",
    severity: "critical",
    confidence: "medium",
    regex: /\b(?:aws[_-]?)?(?:secret[_-]?access[_-]?key|secret[_-]?key|access[_-]?secret)\b\s*[:=]\s*["'`]?([A-Za-z0-9/+=]{40})["'`]?/gi,
    group: 1,
  },
  {
    id: "github-token-classic",
    name: "GitHub token",
    severity: "critical",
    confidence: "high",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/g,
    group: 0,
  },
  {
    id: "github-token-fine-grained",
    name: "GitHub fine-grained token",
    severity: "critical",
    confidence: "high",
    regex: /\bgithub_pat_[A-Za-z0-9_]{80,255}\b/g,
    group: 0,
  },
  {
    id: "gitlab-token",
    name: "GitLab token",
    severity: "critical",
    confidence: "high",
    regex: /\bgl(?:pat|ptt|cbt|soat|ffct)-[A-Za-z0-9_-]{20,}\b/g,
    group: 0,
  },
  {
    id: "openai-api-key",
    name: "OpenAI API key",
    severity: "critical",
    confidence: "high",
    regex: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g,
    group: 0,
    validator: (secret) => !/^sk_(?:live|test)_/.test(secret),
  },
  {
    id: "anthropic-api-key",
    name: "Anthropic API key",
    severity: "critical",
    confidence: "high",
    regex: /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{40,}\b/g,
    group: 0,
  },
  {
    id: "google-api-key",
    name: "Google API key",
    severity: "high",
    confidence: "high",
    regex: /\bAIza[A-Za-z0-9_-]{35}\b/g,
    group: 0,
  },
  {
    id: "slack-token",
    name: "Slack token",
    severity: "critical",
    confidence: "high",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    group: 0,
  },
  {
    id: "stripe-secret-key",
    name: "Stripe secret/restricted key",
    severity: "critical",
    confidence: "high",
    regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
    group: 0,
  },
  {
    id: "jwt",
    name: "JSON Web Token",
    severity: "medium",
    confidence: "medium",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    group: 0,
    validator: isLikelyJwt,
  },
  {
    id: "authorization-header",
    name: "Authorization header token",
    severity: "high",
    confidence: "medium",
    regex: /\bAuthorization\s*[:=]\s*["'`]?(?:Bearer|Basic)\s+([A-Za-z0-9._~+/=:-]{20,})["'`]?/gi,
    group: 1,
  },
  {
    id: "url-basic-auth",
    name: "Credential in URL",
    severity: "high",
    confidence: "high",
    regex: /\b(?:https?|ftp):\/\/[^\s:@/]+:[^\s:@/]+@[^\s/]+[^\s]*/gi,
    group: 0,
    validator: (secret) => hasLiteralUrlCredential(secret),
  },
  {
    id: "dingtalk-webhook-token",
    name: "DingTalk webhook token",
    severity: "critical",
    confidence: "high",
    regex: /\bhttps:\/\/(?:oapi\.)?dingtalk\.com\/robot\/send\?[^\s"'`]*?\baccess_token=([A-Za-z0-9_-]{20,})/gi,
    group: 1,
  },
  {
    id: "dingtalk-webhook-default",
    name: "Literal DingTalk webhook default",
    severity: "critical",
    confidence: "high",
    regex: /(?:^|\r?\n)[ \t]*dingtalk[-_]webhook\s*:\s*\r?\n(?:[ \t]+(?!default\s*:)[^\r\n]*\r?\n){0,8}[ \t]+default\s*:\s*["'`]?(https:\/\/[^\s"'`]+)["'`]?/gim,
    group: 1,
    validator: (secret) => !hasTemplateExpression(secret),
  },
  {
    id: "generic-secret-assignment",
    name: "Generic secret assignment",
    severity: "medium",
    confidence: "low",
    regex: /\b(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|client[_-]?secret|private[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token)\b[\w\s.'"-]{0,40}\s*[:=]\s*["'`]([A-Za-z0-9_./+=~:$%&?@-]{16,})["'`]/gi,
    group: 1,
    validator: (secret) => shannonEntropy(secret) >= 3.2,
  },
];

const SECRET_READ_PATTERNS = [
  {
    id: "read-env-file",
    regex: /\b(?:cat|less|more|tail|head|sed|awk|grep|rg)\b[^\n;&|]*\s(?:\.env(?:\.[\w.-]+)?|[^ \t\n;&|]*\/\.env(?:\.[\w.-]+)?)\b/i,
  },
  {
    id: "read-private-key",
    regex: /\b(?:cat|less|more|tail|head|sed|awk|grep|rg)\b[^\n;&|]*(?:id_rsa|id_ed25519|\.pem|\.key)\b/i,
  },
  {
    id: "print-environment",
    regex: /\b(?:printenv|env|export\s+-p|set)\b(?:\s|$)/i,
  },
  {
    id: "raw-kubeconfig",
    regex: /\bkubectl\s+config\s+view\b[^\n;&|]*\b--raw\b/i,
  },
];

const PROTECTED_FILE_SEGMENTS = [
  ".env",
  ".env.local",
  ".npmrc",
  ".pypirc",
  ".docker/config.json",
  ".kube/config",
  "id_rsa",
  "id_ed25519",
];

function defaultOptions(options = {}) {
  return {
    cwd: path.resolve(options.cwd ?? process.cwd()),
    containmentRoot: options.containmentRoot ? path.resolve(options.containmentRoot) : null,
    failOn: options.failOn ?? "high",
    entropyThreshold: Number(options.entropyThreshold ?? options.entropy ?? 4.35),
    entropyMinLength: Number(options.entropyMinLength ?? 24),
    maxFileSize: Number(options.maxFileSize ?? 1024 * 1024),
    includeLockfiles: Boolean(options.includeLockfiles),
    includeBinary: Boolean(options.includeBinary),
    redact: options.redact !== false,
    json: Boolean(options.json),
  };
}

export function scanText(text, options = {}) {
  const opts = defaultOptions(options);
  const file = options.file ?? "<stdin>";
  return scanTextRaw(String(text ?? ""), file, opts).map((finding) => publicFinding(finding, opts));
}

function scanTextRaw(text, file, opts) {
  const lineStarts = computeLineStarts(text);
  const findings = [];

  for (const rule of RULES) {
    const regex = cloneGlobal(rule.regex);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const secret = match[rule.group ?? 0];
      if (!secret) continue;

      const offsetInFullMatch = match[0].indexOf(secret);
      const index = match.index + Math.max(0, offsetInFullMatch);
      const loc = positionAt(lineStarts, index);
      const lineText = getLineText(text, loc.line);
      const previousLineText = loc.line > 1 ? getLineText(text, loc.line - 1) : "";

      if (ALLOWLIST_INLINE.test(lineText) || ALLOWLIST_INLINE.test(previousLineText)) continue;
      if (rule.validator && !rule.validator(secret, match, text)) continue;
      if (isLikelyPlaceholder(secret)) continue;

      findings.push(makeFinding({
        rule,
        file,
        secret,
        line: loc.line,
        column: loc.column,
        lineText,
        entropy: shannonEntropy(secret),
        cwd: opts.cwd,
      }));

      if (match[0].length === 0) regex.lastIndex += 1;
    }
  }

  findings.push(...scanEntropy(text, file, lineStarts, opts));
  return dedupeFindings(findings);
}

function scanEntropy(text, file, lineStarts, opts) {
  const findings = [];
  const tokenRegex = /[A-Za-z0-9_+\-/.=]{20,}/g;
  const keywordRegex = /(?:key|token|secret|pass|pwd|auth|credential|bearer|api|client)/i;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    let candidate = trimCandidate(match[0]);
    const assignmentIndex = candidate.lastIndexOf("=");
    if (assignmentIndex >= 0) {
      candidate = trimCandidate(candidate.slice(assignmentIndex + 1));
    }
    if (candidate.length < opts.entropyMinLength) continue;
    if (candidate.length > 512) continue;
    if (isLikelyPlaceholder(candidate)) continue;
    if (looksLikeNonSecret(candidate)) continue;

    const entropy = shannonEntropy(candidate);
    if (entropy < opts.entropyThreshold) continue;

    const loc = positionAt(lineStarts, match.index);
    const lineText = getLineText(text, loc.line);
    const previousLineText = loc.line > 1 ? getLineText(text, loc.line - 1) : "";
    const near = text.slice(Math.max(0, match.index - 80), Math.min(text.length, match.index + candidate.length + 80));
    if (!keywordRegex.test(lineText) && !keywordRegex.test(near)) continue;
    if (ALLOWLIST_INLINE.test(lineText) || ALLOWLIST_INLINE.test(previousLineText)) continue;

    findings.push(makeFinding({
      rule: {
        id: "high-entropy-token",
        name: "High entropy token near secret keyword",
        severity: "medium",
        confidence: "low",
      },
      file,
      secret: candidate,
      line: loc.line,
      column: loc.column,
      lineText,
      entropy,
      cwd: opts.cwd,
    }));
  }
  return findings;
}

export async function scanPaths(pathsToScan = ["."], options = {}) {
  const opts = defaultOptions(options);
  validateFailOn(opts.failOn);

  const stats = {
    scannedFiles: 0,
    skippedFiles: 0,
    skippedLargeFiles: 0,
    skippedBinaryFiles: 0,
    errors: [],
  };
  if (opts.containmentRoot) {
    try {
      opts.containmentRoot = await fs.realpath(opts.containmentRoot);
    } catch (error) {
      stats.errors.push(`${opts.containmentRoot}: ${error.message}`);
      return {
        tool: "secret-scan.mjs",
        version: VERSION,
        summary: summarize([], stats),
        findings: [],
        stats,
      };
    }
  }
  const files = [];
  for (const inputPath of pathsToScan.length > 0 ? pathsToScan : ["."]) {
    await collectFiles(path.resolve(opts.cwd, inputPath), files, opts, stats);
  }

  const findings = [];
  for (const file of files) {
    const text = await readScannableFile(file, opts, stats);
    if (text === null) continue;
    stats.scannedFiles += 1;
    findings.push(...scanTextRaw(text, file, opts));
  }

  const filtered = dedupeFindings(findings).sort(compareFindings);
  return {
    tool: "secret-scan.mjs",
    version: VERSION,
    summary: summarize(filtered, stats),
    findings: filtered.map((finding) => publicFinding(finding, opts)),
    stats,
  };
}

function resolveHookPlatform({ platform, host } = {}) {
  if (platform && host && String(platform).trim().toLowerCase() !== String(host).trim().toLowerCase()) {
    throw new Error(`host (${host}) and platform (${platform}) must match when both are provided`);
  }
  return resolveSecretGuardPlatform(platform ?? host ?? DEFAULT_SECRET_GUARD_PLATFORM);
}

export async function handleHookEvent({ mode, platform, host, event, failOn = "medium" } = {}) {
  const hookMode = mode ?? "user-prompt";
  const hookPlatform = resolveHookPlatform({ platform, host });
  const hookEvent = event && typeof event === "object" ? event : {};

  if (hookMode === "user-prompt") {
    const prompt = String(hookEvent.prompt ?? hookEvent.user_prompt ?? hookEvent.message ?? "");
    const findings = scanTextRaw(prompt, "<prompt>", defaultOptions({ failOn, redact: true }));
    if (findings.some((finding) => shouldFailFinding(finding, failOn))) {
      return blockHook({
        platform: hookPlatform,
        eventName: "UserPromptSubmit",
        reasonCode: "secret-in-user-prompt",
        message: "Secret guard blocked a likely credential before model exposure. Store the value in an environment variable or secret manager, share only the variable name, and rotate the credential if it was real.",
      });
    }
    return allowHook();
  }

  if (hookMode === "pre-tool") {
    const reason = preToolBlockReason(hookEvent, failOn);
    if (reason) {
      return blockHook({
        platform: hookPlatform,
        eventName: "PreToolUse",
        reasonCode: reason.reasonCode,
        message: reason.message,
      });
    }
    return allowHook();
  }

  throw new Error(`unknown hook mode: ${hookMode}`);
}

function preToolBlockReason(event, failOn) {
  const { toolName, toolInput } = normalizePreToolEvent(event);

  if (/^Bash$/i.test(toolName)) {
    const command = String(toolInput.command ?? "");
    for (const pattern of SECRET_READ_PATTERNS) {
      if (pattern.regex.test(command)) {
        return {
          reasonCode: pattern.id,
          message: "Secret guard blocked credential file or environment exposure. Use variable names or ask for explicit approval without revealing values.",
        };
      }
    }
    const findings = scanTextRaw(command, "<command>", defaultOptions({ failOn, redact: true }));
    if (findings.some((finding) => shouldFailFinding(finding, failOn))) {
      return {
        reasonCode: "secret-in-tool-command",
        message: "Secret guard blocked a tool command containing a likely credential. Move the value to a secret manager or environment variable and do not print it.",
      };
    }
  }

  const contentTargets = writeContentTargets(toolName, toolInput);
  for (const target of contentTargets) {
    const findings = scanTextRaw(target.content, target.file, defaultOptions({ failOn, redact: true }));
    if (findings.some((finding) => shouldFailFinding(finding, failOn))) {
      return {
        reasonCode: "secret-in-tool-content",
        message: "Secret guard blocked write content containing a likely credential. Move the value to a secret manager or environment variable and use a redacted fixture instead.",
      };
    }
  }

  const filePath = String(toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.absolute_path ?? toolInput.absolutePath ?? "");
  if (filePath && isProtectedCredentialPath(filePath)) {
    return {
      reasonCode: "protected-credential-path",
      message: "Secret guard blocked direct access to a credential-bearing path. Use variable names or a redacted fixture instead.",
    };
  }

  return null;
}

function normalizePreToolEvent(event) {
  const source = event && typeof event === "object" ? event : {};
  const data = source.data && typeof source.data === "object" && !Array.isArray(source.data)
    ? source.data
    : {};
  const toolName = String(
    source.tool_name
    ?? source.toolName
    ?? data.tool_name
    ?? data.toolName
    ?? source.name
    ?? data.name
    ?? "",
  );
  const input = source.tool_input
    ?? source.toolInput
    ?? data.tool_input
    ?? data.toolInput
    ?? source.input
    ?? source.args
    ?? data.input
    ?? data.args;
  return {
    toolName,
    toolInput: input && typeof input === "object" && !Array.isArray(input)
      ? input
      : (/^apply_patch$/i.test(toolName) && typeof input === "string" ? { patch: input } : {}),
  };
}

function writeContentTargets(toolName, toolInput) {
  if (/^Write$/i.test(toolName)) {
    return stringContentTargets(toolInput.content, "<write-content>");
  }
  if (/^Edit$/i.test(toolName)) {
    return stringContentTargets(toolInput.new_string ?? toolInput.newString, "<edit-new-string>");
  }
  if (/^apply_patch$/i.test(toolName)) {
    return stringContentTargets(toolInput.patch, "<apply-patch>");
  }
  return [];
}

function stringContentTargets(value, file) {
  return typeof value === "string" ? [{ content: value, file }] : [];
}

function blockHook({ platform, eventName, reasonCode, message }) {
  return renderSecretGuardBlock({ platform, eventName, reasonCode, message });
}

function allowHook() {
  return {
    blocked: false,
    exitCode: 0,
    stdout: "",
    stderr: "",
  };
}

function shouldFailFinding(finding, failOn) {
  validateFailOn(failOn);
  return SEVERITY_SCORE[finding.severity] >= SEVERITY_SCORE[failOn];
}

function isProtectedCredentialPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  return PROTECTED_FILE_SEGMENTS.some((segment) => normalized === segment || normalized.endsWith(`/${segment}`) || normalized.includes(`/${segment}/`));
}

async function collectFiles(absPath, out, opts, stats) {
  let stat;
  try {
    stat = await fs.lstat(absPath);
  } catch (error) {
    stats.errors.push(`${absPath}: ${error.message}`);
    return;
  }

  if (stat.isSymbolicLink()) {
    stats.skippedFiles += 1;
    return;
  }
  if (opts.containmentRoot) {
    try {
      const canonical = await fs.realpath(absPath);
      if (!isWithinRoot(opts.containmentRoot, canonical)) {
        stats.skippedFiles += 1;
        return;
      }
    } catch (error) {
      stats.errors.push(`${absPath}: ${error.message}`);
      return;
    }
  }

  if (stat.isFile()) {
    if (!shouldSkipFile(absPath, stat, opts, stats)) out.push(absPath);
    return;
  }

  if (!stat.isDirectory()) return;
  if (DEFAULT_IGNORE_DIRS.has(path.basename(absPath))) return;

  let entries;
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true });
  } catch (error) {
    stats.errors.push(`${absPath}: ${error.message}`);
    return;
  }

  for (const entry of entries) {
    const child = path.join(absPath, entry.name);
    if (entry.isDirectory()) {
      if (!DEFAULT_IGNORE_DIRS.has(entry.name)) await collectFiles(child, out, opts, stats);
    } else if (entry.isFile()) {
      let childStat;
      try {
        childStat = await fs.stat(child);
      } catch (error) {
        stats.errors.push(`${child}: ${error.message}`);
        continue;
      }
      if (!shouldSkipFile(child, childStat, opts, stats)) out.push(child);
    }
  }
}

function shouldSkipFile(file, stat, opts, stats) {
  const base = path.basename(file);
  const ext = path.extname(base).toLowerCase();
  if (stat.size > opts.maxFileSize) {
    stats.skippedFiles += 1;
    stats.skippedLargeFiles += 1;
    return true;
  }
  if (!opts.includeLockfiles && DEFAULT_IGNORE_FILES.has(base)) {
    stats.skippedFiles += 1;
    return true;
  }
  if (!opts.includeBinary && DEFAULT_SKIP_EXTENSIONS.has(ext)) {
    stats.skippedFiles += 1;
    stats.skippedBinaryFiles += 1;
    return true;
  }
  return false;
}

async function readScannableFile(file, opts, stats) {
  let beforeOpen;
  let canonical;
  let handle;
  try {
    beforeOpen = await fs.lstat(file);
    if (beforeOpen.isSymbolicLink() || !beforeOpen.isFile()) {
      stats.skippedFiles += 1;
      return null;
    }
    canonical = await fs.realpath(file);
    if (opts.containmentRoot && !isWithinRoot(opts.containmentRoot, canonical)) {
      stats.skippedFiles += 1;
      return null;
    }
    handle = await openReadOnlyNoFollow(file);
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileIdentity(beforeOpen, opened)) {
      stats.skippedFiles += 1;
      return null;
    }
    const buffer = await handle.readFile();
    if (!opts.includeBinary && isBinary(buffer)) {
      stats.skippedFiles += 1;
      stats.skippedBinaryFiles += 1;
      return null;
    }
    return buffer.toString("utf8");
  } catch (error) {
    stats.errors.push(`${file}: ${error.message}`);
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function openReadOnlyNoFollow(file) {
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  if (noFollow === 0) return fs.open(file, fsConstants.O_RDONLY);
  try {
    return await fs.open(file, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP"].includes(error?.code)) throw error;
    return fs.open(file, fsConstants.O_RDONLY);
  }
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sameFileIdentity(beforeOpen, opened) {
  const beforeIno = Number(beforeOpen?.ino ?? 0);
  const openedIno = Number(opened?.ino ?? 0);
  const beforeDev = Number(beforeOpen?.dev ?? 0);
  const openedDev = Number(opened?.dev ?? 0);
  if (beforeIno !== 0 || openedIno !== 0 || beforeDev !== 0 || openedDev !== 0) {
    return beforeIno === openedIno && beforeDev === openedDev;
  }
  return beforeOpen?.size === opened?.size
    && beforeOpen?.mtimeMs === opened?.mtimeMs
    && beforeOpen?.birthtimeMs === opened?.birthtimeMs;
}

function makeFinding({ rule, file, secret, line, column, lineText, entropy, cwd }) {
  const secretHash = sha256(secret).slice(0, 16);
  return {
    ruleId: rule.id,
    name: rule.name,
    severity: rule.severity,
    confidence: rule.confidence,
    file: path.relative(cwd ?? process.cwd(), path.resolve(file)) || file,
    absoluteFile: path.resolve(file),
    line,
    column,
    secret,
    secretHash,
    entropy: Number(entropy.toFixed(2)),
    context: lineText.trim().slice(0, 500),
    fingerprint: sha256(`${rule.id}\0${path.resolve(file)}\0${secretHash}`).slice(0, 24),
  };
}

function publicFinding(finding, opts) {
  return {
    ruleId: finding.ruleId,
    name: finding.name,
    severity: finding.severity,
    confidence: finding.confidence,
    file: finding.file,
    line: finding.line,
    column: finding.column,
    secret: opts.redact ? redact(finding.secret) : finding.secret,
    secretHash: finding.secretHash,
    entropy: finding.entropy,
    context: opts.redact ? redactLine(finding.context, finding.secret) : finding.context,
    fingerprint: finding.fingerprint,
  };
}

function dedupeFindings(findings) {
  const best = new Map();
  for (const finding of findings) {
    const key = `${finding.absoluteFile}:${finding.line}:${finding.secretHash}`;
    const previous = best.get(key);
    if (!previous || scoreFinding(finding) > scoreFinding(previous)) best.set(key, finding);
  }
  return [...best.values()];
}

function scoreFinding(finding) {
  const confidenceScore = { low: 0, medium: 1, high: 2 };
  return (SEVERITY_SCORE[finding.severity] * 10) + (confidenceScore[finding.confidence] ?? 0);
}

function compareFindings(left, right) {
  const severity = SEVERITY_SCORE[right.severity] - SEVERITY_SCORE[left.severity];
  if (severity !== 0) return severity;
  return `${left.file}:${left.line}:${left.column}`.localeCompare(`${right.file}:${right.line}:${right.column}`);
}

function summarize(findings, stats) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byRule = {};
  for (const finding of findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
  }
  return {
    totalFindings: findings.length,
    bySeverity,
    byRule,
    scannedFiles: stats.scannedFiles,
    skippedFiles: stats.skippedFiles,
  };
}

function printHuman(report, opts) {
  const lines = [
    `secret-scan.mjs v${VERSION}`,
    `Scanned ${report.summary.scannedFiles} files, skipped ${report.summary.skippedFiles}. Findings: ${report.summary.totalFindings}.`,
    `Severity: critical=${report.summary.bySeverity.critical}, high=${report.summary.bySeverity.high}, medium=${report.summary.bySeverity.medium}, low=${report.summary.bySeverity.low}`,
  ];
  if (report.stats.errors.length > 0) {
    lines.push("", "Warnings:");
    for (const error of report.stats.errors.slice(0, 20)) lines.push(`  - ${error}`);
    if (report.stats.errors.length > 20) lines.push(`  ... ${report.stats.errors.length - 20} more`);
  }
  if (report.findings.length === 0) {
    lines.push("", "No secrets found.");
  } else {
    lines.push("", "Findings:");
    for (const finding of report.findings) {
      lines.push(
        "",
        `[${finding.severity.toUpperCase()}] ${finding.name} (${finding.ruleId}, ${finding.confidence})`,
        `  ${finding.file}:${finding.line}:${finding.column}`,
        `  secret: ${finding.secret}`,
      );
      if (finding.entropy) lines.push(`  entropy: ${finding.entropy}`);
      if (finding.context) lines.push(`  context: ${finding.context}`);
      lines.push(`  fingerprint: ${finding.fingerprint}`);
    }
    lines.push("", `Exit threshold: --fail-on ${opts.failOn}`);
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return `secret-scan.mjs v${VERSION}

Usage:
  node secret-scan.mjs [paths...] [options]
  node secret-scan.mjs --mode=user-prompt --platform=codex
  node secret-scan.mjs --mode=pre-tool --platform=qoder

Options:
  --json
  --mode <scan|user-prompt|pre-tool>
  --platform <qoder|codex>
  --host <qoder|codex>  Compatibility alias for --platform.
  --fail-on <low|medium|high|critical>
  --entropy <number>
  --entropy-min-length <number>
  --max-file-size <bytes>
  --include-lockfiles
  --include-binary
  --no-redact
  --help
`;
}

function parseCliArgs(argv) {
  const options = {
    paths: [],
    mode: "scan",
    json: false,
    failOn: "high",
    redact: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = (name) => {
      const next = argv[index + 1];
      if (!next) throw new Error(`${name} requires a value`);
      index += 1;
      return next;
    };
    const assignMaybeEquals = (name) => arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : value(name);

    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--no-redact") options.redact = false;
    else if (arg === "--include-lockfiles") options.includeLockfiles = true;
    else if (arg === "--include-binary") options.includeBinary = true;
    else if (arg === "--mode" || arg.startsWith("--mode=")) options.mode = assignMaybeEquals("--mode");
    else if (arg === "--platform" || arg.startsWith("--platform=")) options.platform = assignMaybeEquals("--platform");
    else if (arg === "--host" || arg.startsWith("--host=")) options.host = assignMaybeEquals("--host");
    else if (arg === "--fail-on" || arg.startsWith("--fail-on=")) options.failOn = assignMaybeEquals("--fail-on");
    else if (arg === "--entropy" || arg.startsWith("--entropy=")) options.entropyThreshold = Number(assignMaybeEquals("--entropy"));
    else if (arg === "--entropy-min-length" || arg.startsWith("--entropy-min-length=")) options.entropyMinLength = Number(assignMaybeEquals("--entropy-min-length"));
    else if (arg === "--max-file-size" || arg.startsWith("--max-file-size=")) options.maxFileSize = Number(assignMaybeEquals("--max-file-size"));
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else options.paths.push(arg);
  }

  validateFailOn(options.failOn);
  return options;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }

  if (options.mode === "user-prompt" || options.mode === "pre-tool") {
    const input = await readStdin();
    const event = input.trim() ? JSON.parse(input) : {};
    const result = await handleHookEvent({
      mode: options.mode,
      platform: options.platform,
      host: options.host,
      failOn: options.failOn === "high" ? "medium" : options.failOn,
      event,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.exitCode;
  }

  if (options.mode !== "scan") {
    throw new Error(`unknown mode: ${options.mode}`);
  }

  const report = await scanPaths(options.paths.length > 0 ? options.paths : ["."], options);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(printHuman(report, options));

  return report.findings.some((finding) => shouldFailFinding(finding, options.failOn)) ? 2 : 0;
}

function validateFailOn(failOn) {
  if (!Object.hasOwn(SEVERITY_SCORE, failOn)) {
    throw new Error("--fail-on must be one of: low, medium, high, critical");
  }
}

function cloneGlobal(regex) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  return new RegExp(regex.source, flags);
}

function computeLineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function positionAt(lineStarts, index) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid] <= index) low = mid + 1;
    else high = mid - 1;
  }
  const lineIndex = Math.max(0, high);
  return { line: lineIndex + 1, column: index - lineStarts[lineIndex] + 1 };
}

function getLineText(text, oneBasedLine) {
  let line = 1;
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text.charCodeAt(index) === 10) {
      if (line === oneBasedLine) return text.slice(start, index).replace(/\r$/, "");
      line += 1;
      start = index + 1;
    }
  }
  return "";
}

function trimCandidate(value) {
  return value.replace(/^["'`([{<]+/, "").replace(/["'`\])}>.,;:]+$/, "");
}

function shannonEntropy(value) {
  if (!value) return 0;
  const counts = new Map();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function redact(secret) {
  if (secret.length <= 8) return "*".repeat(secret.length);
  const head = secret.slice(0, Math.min(6, Math.floor(secret.length / 3)));
  const tail = secret.slice(-4);
  return `${head}${"*".repeat(Math.min(24, Math.max(6, secret.length - head.length - tail.length)))}${tail}`;
}

function redactLine(line, secret) {
  return line.split(secret).join(redact(secret));
}

function isLikelyPlaceholder(value) {
  const lower = value.toLowerCase();
  if (/^(x+|\*+|0+|1+|a+|z+|_+|-+|\.+)$/.test(lower)) return true;
  if (/(example|sample|dummy|fake|placeholder|changeme|change-me|replace|redacted|masked|your[_-]?|insert[_-]?|todo|null|undefined|none|not[_-]?set|test[_-]?key)/i.test(lower)) return true;
  if (/^\$\{?[a-z0-9_]+\}?$/i.test(value)) return true;
  if (/^<[^>]+>$/.test(value)) return true;
  return false;
}

function hasLiteralUrlCredential(value) {
  const credentials = String(value ?? "").match(/^[a-z]+:\/\/([^:@/]+):([^@/]+)@/iu);
  if (!credentials) return false;
  return !isTemplateReference(credentials[2]);
}

function isTemplateReference(value) {
  const candidate = String(value ?? "").trim();
  return /^\$\{\{[^{}]+\}\}$/u.test(candidate)
    || /^\$\{[^{}]+\}$/u.test(candidate)
    || /^\$[A-Za-z_][A-Za-z0-9_]*$/u.test(candidate)
    || /^\{\{[^{}]+\}\}$/u.test(candidate)
    || /^<[^<>]+>$/u.test(candidate)
    || /^%\{[^{}]+\}$/u.test(candidate);
}

function hasTemplateExpression(value) {
  return /\$\{(?:\{[^{}]+\}|[^{}]+)\}|\{\{[^{}]+\}\}|<[^<>]+>|%\{[^{}]+\}/u.test(String(value ?? ""));
}

function looksLikeNonSecret(value) {
  if (/^https?:\/\//i.test(value)) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (/^(?:\.\.\/|\.\/|\/)[\w./-]+$/.test(value)) return true;
  if (/^[a-f0-9]{40}$/i.test(value)) return true;
  if (/^[a-f0-9]{64}$/i.test(value)) return true;
  if (/^sha256-[A-Za-z0-9+/=]{20,}$/.test(value)) return true;
  if (/^[A-Za-z0-9_-]+\.(?:js|mjs|cjs|css|map|png|jpg|jpeg|svg|json)$/i.test(value)) return true;
  return new Set(value).size <= 4 && value.length > 16;
}

function isLikelyJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return typeof header === "object" && header !== null && typeof payload === "object" && payload !== null;
  } catch {
    return false;
  }
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function isBinary(buffer) {
  const length = Math.min(buffer.length, 8000);
  if (length === 0) return false;
  let suspicious = 0;
  for (let index = 0; index < length; index += 1) {
    const char = buffer[index];
    if (char === 0) return true;
    if (char < 7 || (char > 14 && char < 32)) suspicious += 1;
  }
  return suspicious / length > 0.3;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`secret-scan.mjs error: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
