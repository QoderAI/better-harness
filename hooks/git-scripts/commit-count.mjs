#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_STATE_PATH = ".qoder/better-harness/state/commit-count.json";
const DEFAULT_THRESHOLD = 1;

export function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });

  if (result.status !== 0) {
    if (allowFailure) {
      return "";
    }
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }

  return result.stdout.trim();
}

export function gitOk(cwd, args) {
  return spawnSync("git", args, {
    cwd,
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 10_000,
  }).status === 0;
}

export function parseArgs(argv) {
  const args = { json: false, markScanned: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.startsWith("--") ? arg.slice(2).split("=", 2) : [];
    if (!key) {
      continue;
    }
    if (key === "json") {
      args.json = true;
    } else if (key === "mark-scanned") {
      args.markScanned = true;
    } else {
      args[key] = inlineValue ?? argv[++index] ?? "";
    }
  }
  return args;
}

export function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function statePathFor(repoRoot, option) {
  const configured = option || process.env.BETTER_HARNESS_COMMIT_COUNT_STATE || DEFAULT_STATE_PATH;
  return path.isAbsolute(configured) ? configured : path.join(repoRoot, configured);
}

export async function readState(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

export async function writeState(filePath, state) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function identityFor(repoRoot) {
  return {
    name: git(repoRoot, ["config", "user.name"], { allowFailure: true }),
    email: git(repoRoot, ["config", "user.email"], { allowFailure: true }),
  };
}

export function isAncestor(repoRoot, ancestor, descendant) {
  return gitOk(repoRoot, ["merge-base", "--is-ancestor", ancestor, descendant]);
}

export function rangeFor(repoRoot, state, head) {
  const last = state.lastScannedSha;
  if (
    last &&
    gitOk(repoRoot, ["rev-parse", "--verify", `${last}^{commit}`]) &&
    isAncestor(repoRoot, last, head)
  ) {
    return { from: last, to: head, expression: `${last}..HEAD`, source: "state" };
  }

  const parent = git(repoRoot, ["rev-parse", "HEAD^"], { allowFailure: true });
  if (parent) {
    return { from: parent, to: head, expression: `${parent}..HEAD`, source: "head-parent" };
  }

  return { from: null, to: head, expression: "HEAD", source: "initial-head" };
}

export function parseLog(output) {
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, authorName, authorEmail, ...subject] = record.split("\x1f");
      return {
        sha,
        shortSha: sha.slice(0, 7),
        authorName,
        authorEmail,
        subject: subject.join("\x1f"),
      };
    });
}

export function commitsIn(repoRoot, expression) {
  return parseLog(
    git(
      repoRoot,
      ["log", "--reverse", "--format=%H%x1f%an%x1f%ae%x1f%s%x1e", expression, "--"],
      { allowFailure: true },
    ),
  );
}

export function matchesIdentity(commit, identity) {
  if (identity.email) {
    return commit.authorEmail.toLowerCase() === identity.email.toLowerCase();
  }
  return Boolean(identity.name) && commit.authorName === identity.name;
}

export async function analyzeCommitCount(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.env.QODER_CWD ?? process.cwd());
  const repoRoot = git(cwd, ["rev-parse", "--show-toplevel"]);
  const head = git(repoRoot, ["rev-parse", "HEAD"], { allowFailure: true });
  const threshold = positiveInt(
    options.threshold ?? process.env.BETTER_HARNESS_COMMIT_COUNT_THRESHOLD,
    DEFAULT_THRESHOLD,
  );
  const statePath = statePathFor(repoRoot, options.statePath);
  const identity = identityFor(repoRoot);

  if (!head) {
    return {
      status: "ok",
      shouldScan: false,
      threshold,
      repoRoot,
      statePath,
      identity,
      range: null,
      metrics: { totalCommits: 0, userCommits: 0 },
      commits: [],
      reasons: [],
      warnings: ["repository has no commits"],
    };
  }

  const state = await readState(statePath);
  const range = rangeFor(repoRoot, state, head);
  const commits = commitsIn(repoRoot, range.expression);
  const userCommits = commits.filter((commit) => matchesIdentity(commit, identity));
  const shouldScan = userCommits.length >= threshold;

  return {
    status: shouldScan ? "scan-recommended" : "ok",
    shouldScan,
    threshold,
    repoRoot,
    statePath,
    identity,
    range,
    metrics: {
      totalCommits: commits.length,
      userCommits: userCommits.length,
    },
    commits: userCommits,
    reasons: shouldScan
      ? [`${userCommits.length} current-user commit(s) since ${range.source}`]
      : [],
    warnings: identity.email || identity.name ? [] : ["git user identity is not configured"],
  };
}

export async function markScanned(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.env.QODER_CWD ?? process.cwd());
  const repoRoot = git(cwd, ["rev-parse", "--show-toplevel"]);
  const statePath = statePathFor(repoRoot, options.statePath);
  const state = {
    lastScannedSha: git(repoRoot, ["rev-parse", "HEAD"]),
    lastScannedAt: new Date().toISOString(),
  };
  await writeState(statePath, state);
  return { status: "marked", repoRoot, statePath, ...state };
}

export function message(report) {
  return [
    "Better Harness commit-count recommends an incremental scan.",
    `Range: ${report.range.expression}`,
    `Current-user commits: ${report.metrics.userCommits}/${report.metrics.totalCommits}`,
    ...report.commits.slice(0, 5).map((commit) => `- ${commit.shortSha} ${commit.subject}`),
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const options = {
    cwd: args.cwd,
    statePath: args.state,
    threshold: args.threshold,
  };

  if (args.markScanned) {
    const result = await markScanned(options);
    process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${result.lastScannedSha}\n`);
    return;
  }

  const report = await analyzeCommitCount(options);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  if (report.shouldScan) {
    const output = `${message(report)}\n`;
    if (args.mode === "stop") {
      process.stderr.write(output);
      process.exitCode = 2;
    } else {
      process.stdout.write(output);
    }
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`commit-count failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
