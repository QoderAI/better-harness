import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { SECURITY_REMOVAL_RE } from "./config.mjs";
import { countLines } from "./utils.mjs";

export class GitFailureError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "GitFailureError";
    this.code = details.code ?? "GIT_COMMAND_FAILED";
    this.command = details.command;
    this.status = details.status;
    this.signal = details.signal;
    this.stdout = details.stdout;
    this.stderr = details.stderr;
    this.ref = details.ref;
  }
}

export function isGitFailureError(error) {
  return error instanceof GitFailureError;
}

function trimOutput(output) {
  return String(output ?? "").trim().slice(0, 600);
}

function runGit(repoRoot, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 10_000,
  });

  if (result.status !== 0) {
    if (options.allowFailure) {
      return "";
    }
    throw new GitFailureError(
      options.message ?? `git ${args.join(" ")} failed`,
      {
        code: options.code,
        command: ["git", ...args],
        status: result.status,
        signal: result.signal,
        stdout: trimOutput(result.stdout),
        stderr: trimOutput(result.stderr),
        ref: options.ref,
      },
    );
  }

  return result.stdout;
}

function verifyBaseRef(repoRoot, baseRef) {
  const ref = String(baseRef ?? "");
  if (!ref.trim()) {
    throw new GitFailureError("Blast radius git base ref is empty or unavailable", {
      code: "GIT_BASE_REF_UNAVAILABLE",
      command: ["git", "rev-parse", "--verify", "<empty>^{commit}"],
      status: 1,
      signal: null,
      stdout: "",
      stderr: "",
      ref,
    });
  }

  return runGit(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`], {
    code: "GIT_BASE_REF_UNAVAILABLE",
    message: `Blast radius git base ref is unavailable: ${ref}`,
    ref,
  }).trim();
}

export function parseUnifiedDiff(diffText) {
  return parseUnifiedDiffDetails(diffText).ranges;
}

export function parseUnifiedDiffDetails(diffText) {
  const ranges = {};
  const securityRemovals = [];
  let currentFile = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("--- ")) {
      continue;
    }

    if (line.startsWith("+++ ")) {
      const file = line.slice(4).trim();
      currentFile = file === "/dev/null" ? null : file.replace(/^b\//, "");
      continue;
    }

    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match) {
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      if (!currentFile) {
        continue;
      }

      const start = Number(match[2]);
      const count = match[3] ? Number(match[3]) : 1;
      const end = count === 0 ? start : start + count - 1;
      ranges[currentFile] ??= [];
      ranges[currentFile].push([start, end]);
      continue;
    }

    if (!currentFile || line.startsWith("diff --git") || line.startsWith("index ")) {
      continue;
    }

    if (line.startsWith("-")) {
      const text = line.slice(1);
      if (SECURITY_REMOVAL_RE.test(text)) {
        securityRemovals.push({
          filePath: currentFile,
          line: oldLine,
          text: text.trim().slice(0, 160),
        });
      }
      oldLine += 1;
    } else if (line.startsWith("+")) {
      newLine += 1;
    } else {
      oldLine += 1;
      newLine += 1;
    }
  }

  return { ranges, securityRemovals };
}

function parseNumstat(numstatText) {
  const files = new Map();

  for (const line of numstatText.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
    const filePath = pathParts.join("\t");
    if (!filePath) {
      continue;
    }
    const added = addedRaw === "-" ? 0 : Number(addedRaw);
    const deleted = deletedRaw === "-" ? 0 : Number(deletedRaw);
    const normalized = filePath.includes(" => ")
      ? filePath.split(" => ").at(-1).replace(/[{}]/g, "")
      : filePath;

    files.set(normalized, {
      filePath: normalized,
      added: Number.isFinite(added) ? added : 0,
      deleted: Number.isFinite(deleted) ? deleted : 0,
      status: "modified",
    });
  }

  return files;
}

export async function collectGitChanges(repoRoot, config) {
  const baseRef = process.env.BETTER_HARNESS_BLAST_RADIUS_BASE ?? config.baseRef ?? "HEAD";
  const baseCommit = verifyBaseRef(repoRoot, baseRef);

  const diffText = runGit(
    repoRoot,
    ["diff", "--unified=0", "--no-ext-diff", "--find-renames", baseCommit, "--"],
    { code: "GIT_DIFF_FAILED", ref: baseRef },
  );
  const numstat = runGit(
    repoRoot,
    ["diff", "--numstat", "--no-ext-diff", "--find-renames", baseCommit, "--"],
    { code: "GIT_DIFF_FAILED", ref: baseRef },
  );

  const files = parseNumstat(numstat);
  const diffDetails = parseUnifiedDiffDetails(diffText);
  const ranges = diffDetails.ranges;
  const untracked = runGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"], {
    code: "GIT_UNTRACKED_FAILED",
  })
    .split("\0")
    .filter(Boolean);

  for (const filePath of untracked) {
    const absolute = path.join(repoRoot, filePath);
    if (!existsSync(absolute)) {
      continue;
    }
    const content = await readFile(absolute, "utf8").catch(() => "");
    const lines = countLines(content);
    files.set(filePath, {
      filePath,
      added: lines,
      deleted: 0,
      status: "untracked",
    });
    ranges[filePath] = lines > 0 ? [[1, lines]] : [];
  }

  return {
    files: [...files.values()],
    ranges,
    securityRemovals: diffDetails.securityRemovals,
  };
}

export async function listTrackedFiles(repoRoot) {
  const output = runGit(repoRoot, ["ls-files", "-z"], { allowFailure: true });
  return output.split("\0").filter(Boolean);
}
