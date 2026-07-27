import { lstat, open } from "node:fs/promises";
import path from "node:path";

const MAX_SCRIPT_CHARS = 64_000;
const HIGH_FREQUENCY_EVENTS = new Set([
  "pretooluse", "posttooluse", "posttoolusefailure", "beforeshellexecution",
  "aftershellexecution", "beforemcpexecution", "aftermcpexecution", "beforereadfile", "afterfileedit",
]);
const NON_BLOCKABLE_EVENTS = new Set([
  "posttooluse", "posttoolusefailure", "posttoolbatch", "sessionend", "stopfailure",
  "notification", "messagedisplay", "instructionsloaded", "filechanged", "worktreeremove",
  "afterfileedit", "aftershellexecution", "aftermcpexecution", "afteragentresponse", "afteragentthought",
]);
const BLOCKING_DECISION = /(?:\bexit\s+2\b|\b(?:process\.|sys\.)?exit\s*\(\s*2\s*\)|permissionDecision["'\s:]+deny|["']decision["']\s*:\s*["']block["']|["']continue["']\s*:\s*false)/iu;
const EVENT_INPUT = /(?:tool_input|toolInput|hook_event_name|\/dev\/stdin|process\.stdin|sys\.stdin|stdin|\$\(\s*cat\s*\))/u;
const SIDE_EFFECT = /(?:osascript|notify-send|desktop notification|telemetry|analytics|audit(?:ing)?\b|webhook|syslog|logger\b|appendFile|writeFile|>>[^\n]*(?:\.log|\.jsonl|hook))/iu;
const PLATFORM_COMMAND = /(?:\bosascript\b|\bnotify-send\b|\bpbcopy\b|\bxclip\b|\bxdg-open\b)/u;
const PLATFORM_GUARD = /(?:process\.platform|sys\.platform|\buname\b|\bOSTYPE\b|\$IsWindows|Get-Command)/u;

function normalizeEvent(value) {
  return String(value ?? "").replace(/[\s_-]+/gu, "").toLowerCase();
}

function broadMatcher(value) {
  const matcher = String(value ?? "").replace(/\s+/gu, "").toLowerCase();
  return matcher === "" || matcher === "*" || matcher === ".*" || matcher === "^.*$";
}

function workspaceScriptPath(scriptPath, workspace) {
  if (typeof scriptPath !== "string" || !scriptPath.trim()) return null;
  const root = path.resolve(workspace);
  const target = path.resolve(scriptPath);
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return { target, relative: relative.split(path.sep).join("/") };
}

async function readProjectScript(item, workspace) {
  if (item?.scope !== "project") return null;
  const resolved = workspaceScriptPath(item?.scriptPath, workspace);
  if (!resolved) return null;
  const metadata = await lstat(resolved.target).catch(() => null);
  if (!metadata?.isFile()) return null;
  const handle = await open(resolved.target, "r").catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(MAX_SCRIPT_CHARS);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { ...resolved, content: buffer.subarray(0, bytesRead).toString("utf8") };
  } finally {
    await handle.close();
  }
}

function unquotedExpansion(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "$" && /[A-Za-z_{]/u.test(line[index + 1] ?? "")) return true;
  }
  return false;
}

function unsafeInputHandling(content, extension) {
  if (!EVENT_INPUT.test(content)) return false;
  if ([".sh", ".bash", ".zsh"].includes(extension)) {
    if (/\b(?:eval|bash\s+-c|sh\s+-c)\b[^\n]*\$/u.test(content)) return true;
    if (/<<[-]?\s*[A-Za-z_]+[\s\S]{0,2000}\{[\s\S]{0,2000}\$[A-Za-z_{]/u.test(content)) return true;
    return content.split(/\r?\n/u).some((line) =>
      /\b(?:rm|cp|mv|chmod|curl|wget)\b/u.test(line) && unquotedExpansion(line));
  }
  if ([".js", ".mjs", ".cjs", ".ts"].includes(extension)) {
    return /\b(?:exec|execSync)\s*\([^\n)]*(?:tool[_A-Z]?input|input|command)/iu.test(content)
      || /\bspawn\s*\([^\n)]*\{[^\n}]*shell\s*:\s*true/iu.test(content);
  }
  if (extension === ".py") {
    return /subprocess\.(?:run|call|Popen|check_output)\s*\([^\n)]*(?:tool_input|input|command)[^\n)]*shell\s*=\s*True/iu.test(content)
      || /\bos\.system\s*\([^\n)]*(?:tool_input|input|command)/iu.test(content);
  }
  return false;
}

function portabilityProblem(item, script) {
  const extension = path.extname(script.target).toLowerCase();
  const command = String(item?.commandDisplay ?? "").toLowerCase();
  const nonPortableShell = [".sh", ".bash", ".zsh"].includes(extension)
    || [".ps1", ".cmd", ".bat"].includes(extension)
    || /^(?:bash|sh|zsh|powershell|pwsh|cmd)\b/u.test(command)
    || /^#![^\n]*(?:bash|zsh|\/sh)\b/mu.test(script.content);
  const platformSpecific = PLATFORM_COMMAND.test(script.content) && !PLATFORM_GUARD.test(script.content);
  const unguardedJq = /\bjq\b/u.test(script.content)
    && !/(?:command\s+-v\s+jq|which\s+jq|Get-Command\s+jq)/u.test(script.content);
  return nonPortableShell || platformSpecific || unguardedJq;
}

function hookFinding(item, id, severity, evidence, remediation, file) {
  return {
    id,
    severity,
    evidence,
    remediation,
    file,
    assetKind: "hook",
    assetName: (item?.label ?? item?.name ?? normalizeEvent(item?.step)) || "Hook",
    scope: item?.scope ?? "project",
    sourceLabel: item?.sourceLabel,
    rubricRef: "Hook Safety And Performance",
  };
}

export async function reviewHookAssets(hooks, workspace) {
  const findings = [];
  for (const item of hooks) {
    const event = normalizeEvent(item?.step);
    const configFile = item?.evidence?.relativePath ?? item?.filePath;
    if (item?.enabled !== false && item?.async !== true && HIGH_FREQUENCY_EVENTS.has(event) && broadMatcher(item?.matcher)) {
      findings.push(hookFinding(
        item,
        "hook-broad-high-frequency-matcher",
        "warning",
        `${item?.label ?? item?.step ?? "Hook"} is synchronous on ${item?.step ?? "a tool event"} with a match-all matcher.`,
        "Narrow the matcher or condition so the handler does not spawn for every tool call.",
        configFile,
      ));
    }

    const script = await readProjectScript(item, workspace);
    if (!script) continue;
    const extension = path.extname(script.target).toLowerCase();
    const blocking = BLOCKING_DECISION.test(script.content);
    if (unsafeInputHandling(script.content, extension)) {
      findings.push(hookFinding(
        item,
        "hook-unsafe-input-handling",
        "error",
        `${script.relative} directly executes or constructs structured output from unescaped Hook input.`,
        "Parse the event input, validate allowed values and paths, quote variables, and build JSON with a structured encoder.",
        script.relative,
      ));
    }
    if (blocking && (item?.async === true || NON_BLOCKABLE_EVENTS.has(event))) {
      findings.push(hookFinding(
        item,
        "hook-blocking-contract-mismatch",
        "error",
        `${script.relative} returns a blocking decision from ${item?.async === true ? "an async handler" : `non-blockable ${item?.step ?? "event"}`}.`,
        "Keep policy gates synchronous on a blockable event, or remove the ineffective blocking decision.",
        script.relative,
      ));
    }
    if (!blocking && item?.async !== true && SIDE_EFFECT.test(script.content)) {
      findings.push(hookFinding(
        item,
        "hook-sync-side-effect",
        "warning",
        `${script.relative} performs notification, logging, telemetry, or another non-blocking side effect synchronously.`,
        "Run non-blocking side effects asynchronously when the host supports it and bound their timeout/output.",
        script.relative,
      ));
    }
    if (portabilityProblem(item, script)) {
      findings.push(hookFinding(
        item,
        "hook-portability-or-missing-dependency",
        "warning",
        `${script.relative} depends on a platform-specific shell/command or an unguarded external parser.`,
        "Use a cross-platform runtime or add an explicit platform and dependency guard with a documented fallback.",
        script.relative,
      ));
    }
  }
  return findings;
}
