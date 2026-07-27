#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_REVIEWERS = ["claude", "qodercli", "agent"];

function parseArgs(argv) {
  const args = {
    reviewers: DEFAULT_REVIEWERS,
    timeoutMs: 240000,
    maxOutputTokens: "3000",
    cwd: process.cwd(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    if (arg === "--target") args.target = next();
    else if (arg === "--cwd") args.cwd = next();
    else if (arg === "--reviewers") args.reviewers = next().split(",").map((v) => v.trim()).filter(Boolean);
    else if (arg === "--out") args.out = next();
    else if (arg === "--timeout-ms") args.timeoutMs = Number(next());
    else if (arg === "--max-output-tokens") args.maxOutputTokens = next();
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function usage() {
  return `Usage:
  run-triad-review.mjs --target <spec-path> [--cwd <repo>] [--reviewers claude,qodercli,agent] [--out <file>]

Runs read-only AI reviewer commands with a shared prompt and emits normalized JSON.`;
}

function buildPrompt({ target, reviewer }) {
  return `You are reviewing ${target} as a read-only architecture reviewer.

Context: The target is a spec, ADR, plugin architecture proposal, agent workflow contract, or directory structure proposal. Assess whether it is clear enough for humans and AI agents to evolve safely.

Please assess from exactly these dimensions:
1. complexity: is the structure understandable and not over-factored?
2. convenience: can a new contributor or AI agent know where to add or change behavior?
3. evolution: can this grow across platforms and community contributions without migration traps?

Return JSON only with this shape:
{
  "reviewer": "${reviewer}",
  "verdict": "pass" | "fail",
  "p1_p2_clear": true | false,
  "summary": "...",
  "findings": [
    {"severity":"P1|P2|P3", "dimension":"complexity|convenience|evolution", "issue":"...", "evidence":"...", "recommendation":"..."}
  ]
}

Use P1 for blocking architectural ambiguity, P2 for likely contributor or agent confusion or migration risk, P3 for polish. If there are no P1/P2 issues, set p1_p2_clear true.`;
}

function commandForReviewer(reviewer, prompt, args) {
  if (reviewer === "claude") {
    return {
      command: "claude",
      args: [
        "-p",
        "--permission-mode",
        "dontAsk",
        "--max-budget-usd",
        "0.50",
        "--tools",
        "Read,Glob,Grep,LS",
      ],
      stdin: prompt,
    };
  }

  if (reviewer === "qodercli") {
    return {
      command: "qodercli",
      args: [
        "--cwd",
        args.cwd,
        "--setting-sources",
        "user,project,local",
        "--permission-mode",
        "dont_ask",
        "--max-output-tokens",
        args.maxOutputTokens,
        "-p",
        prompt,
      ],
    };
  }

  if (reviewer === "agent") {
    return {
      command: "agent",
      args: ["-p", "--mode", "ask", "--trust", "--workspace", args.cwd, prompt],
    };
  }

  if (reviewer === "codex") {
    return {
      command: "codex",
      args: ["-p", prompt],
    };
  }

  throw new Error(`Unsupported reviewer: ${reviewer}`);
}

function stripCodeFence(raw) {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1].trim() : trimmed;
}

function parseJsonFromOutput(raw) {
  const text = stripCodeFence(raw);
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("No parseable JSON object found in reviewer output");
  }
}

function runProcess(spec, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr, error: error.message, timedOut });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });

    if (spec.stdin) {
      child.stdin.end(spec.stdin);
    } else {
      child.stdin.end();
    }
  });
}

async function runReviewer(reviewer, args) {
  const prompt = buildPrompt({ target: args.target, reviewer });
  const spec = commandForReviewer(reviewer, prompt, args);
  const result = await runProcess(spec, args.cwd, args.timeoutMs);
  const record = {
    reviewer,
    command: [spec.command, ...spec.args.filter((arg) => arg !== prompt)],
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stderr: result.stderr.trim(),
    raw: result.stdout.trim(),
  };

  if (result.error) {
    record.error = result.error;
    return record;
  }

  try {
    record.parsed = parseJsonFromOutput(result.stdout);
  } catch (error) {
    record.error = error.message;
  }

  return record;
}

function summarize(records) {
  const findings = [];
  let p1p2Clear = true;

  for (const record of records) {
    const parsed = record.parsed;
    if (!parsed) {
      p1p2Clear = false;
      continue;
    }
    for (const finding of parsed.findings || []) {
      findings.push({ reviewer: record.reviewer, ...finding });
      if (finding.severity === "P1" || finding.severity === "P2") {
        p1p2Clear = false;
      }
    }
    if (parsed.p1_p2_clear === false) p1p2Clear = false;
  }

  return {
    p1_p2_clear: p1p2Clear,
    counts: findings.reduce(
      (acc, finding) => {
        acc[finding.severity] = (acc[finding.severity] || 0) + 1;
        return acc;
      },
      { P1: 0, P2: 0, P3: 0 },
    ),
    findings,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.target) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  args.cwd = path.resolve(args.cwd);
  args.target = path.resolve(args.cwd, args.target);

  const records = await Promise.all(args.reviewers.map((reviewer) => runReviewer(reviewer, args)));
  const output = {
    target: args.target,
    cwd: args.cwd,
    reviewers: args.reviewers,
    summary: summarize(records),
    records,
  };

  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (args.out) {
    const outPath = path.resolve(args.cwd, args.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, json);
  }
  process.stdout.write(json);

  process.exit(output.summary.p1_p2_clear ? 0 : 2);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
