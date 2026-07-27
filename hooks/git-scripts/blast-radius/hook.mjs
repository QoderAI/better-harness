import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { analyzeRepository } from "./analysis.mjs";

const WRITE_MARKER = path.join(".better-harness", "state", "blast-radius", "last-write.json");
const WRITE_MARKER_TTL_MS = 15 * 60 * 1000;

function isStopEvent(eventName) {
  return eventName === "Stop" || eventName === "stop";
}

function isPostToolEvent(eventName) {
  return eventName === "PostToolUse" || eventName === "post-tool";
}

function markerPath(cwd) {
  return path.join(cwd, WRITE_MARKER);
}

async function recordWriteMarker(cwd, input = {}) {
  const filePath = markerPath(cwd);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        toolName: input.tool_name ?? input.toolName ?? null,
        filePath: input.tool_input?.file_path ?? input.toolInput?.filePath ?? null,
      },
      null,
      2,
    )}\n`,
  );
}

async function hasRecentWriteMarker(cwd) {
  const raw = await readFile(markerPath(cwd), "utf8").catch(() => "");
  if (!raw) {
    return false;
  }
  const parsed = JSON.parse(raw);
  const updatedAt = Date.parse(parsed.updatedAt);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= WRITE_MARKER_TTL_MS;
}

async function clearWriteMarker(cwd) {
  await rm(markerPath(cwd), { force: true });
}
export function formatReviewMessage(report) {
  const lines = [
    "Better Harness blast radius check recommends AI review before finishing.",
    `Risk: ${report.severity} (${report.score}/100). Changed ${report.metrics.changedFiles} file(s), ${report.metrics.changedLines} line(s), ${report.metrics.changedSymbols} symbol(s).`,
  ];

  if (report.reasons.length > 0) {
    lines.push("Reasons:");
    for (const reason of report.reasons.slice(0, 6)) {
      lines.push(`- ${reason}`);
    }
  }

  const topSymbols = report.changedSymbols
    .filter((symbol) => symbol.callerCount > 0)
    .sort((a, b) => b.callerCount - a.callerCount)
    .slice(0, 5);

  if (topSymbols.length > 0) {
    lines.push("Direct callers:");
    for (const symbol of topSymbols) {
      lines.push(
        `- ${symbol.name} (${symbol.filePath}:${symbol.startLine}) has ${symbol.callerCount} caller(s)`,
      );
    }
  }

  if (report.affectedSymbols.length > 0) {
    lines.push("Blast radius:");
    for (const symbol of report.affectedSymbols.slice(0, 8)) {
      lines.push(
        `- depth ${symbol.depth}: ${symbol.name} (${symbol.filePath}:${symbol.startLine}) via ${symbol.via}`,
      );
    }
  }

  lines.push(
    "Suggested next step: run an AI review/code-review pass, split unrelated changes, or add targeted tests for the changed core path before marking the task done.",
  );
  return lines.join("\n");
}

function jsonHookOutput(eventName, payload) {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      ...payload,
    },
  })}\n`;
}

export async function runHook(input = {}, options = {}) {
  const cwd = path.resolve(
    options.cwd ?? input.cwd ?? process.env.QODER_CWD ?? process.cwd(),
  );
  const eventName = options.mode
    ? options.mode
    : input.hook_event_name ?? input.hookEventName ?? "";

  if (isStopEvent(eventName) && input.stop_hook_active) {
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  if (isStopEvent(eventName)) {
    const writeObserved =
      input.better_harness_write_observed === true ||
      input.betterHarnessWriteObserved === true ||
      (await hasRecentWriteMarker(cwd));
    if (!writeObserved) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    await clearWriteMarker(cwd);
  }

  if (isPostToolEvent(eventName) && input.stop_hook_active) {
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  const report = await analyzeRepository(cwd, options);
  if (!report.shouldReview) {
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  const message = formatReviewMessage(report);

  if (isPostToolEvent(eventName)) {
    await recordWriteMarker(cwd, input);
    return {
      exitCode: 0,
      stdout: jsonHookOutput("PostToolUse", { feedback: message }),
      stderr: "",
    };
  }

  if (isStopEvent(eventName)) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `${message}\n`,
    };
  }

  return {
    exitCode: 0,
    stdout: `${message}\n`,
    stderr: "",
  };
}

function parseArgs(argv) {
  const args = {
    json: false,
    mode: "",
    cwd: "",
    configPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
    } else if (arg === "--mode") {
      args.mode = argv[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--mode=")) {
      args.mode = arg.slice("--mode=".length);
    } else if (arg === "--cwd") {
      args.cwd = argv[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--cwd=")) {
      args.cwd = arg.slice("--cwd=".length);
    } else if (arg === "--config") {
      args.configPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--config=")) {
      args.configPath = arg.slice("--config=".length);
    }
  }

  return args;
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
}

export async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.json) {
    const cwd = path.resolve(args.cwd || process.env.QODER_CWD || process.cwd());
    const report = await analyzeRepository(cwd, { configPath: args.configPath || undefined });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const rawInput = await readStdin();
  const input = rawInput.trim() ? JSON.parse(rawInput) : {};
  const result = await runHook(input, {
    mode: args.mode || undefined,
    cwd: args.cwd ? path.resolve(args.cwd) : undefined,
    configPath: args.configPath || undefined,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}
