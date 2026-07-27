#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = 1;
export const DEFAULT_MAX_COMMITS = 300;

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".cxx",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".ts",
  ".tsx",
]);

const TEST_PATH_RE = /(^|\/)(__tests__|tests?|testdata|fixtures?)(\/|$)|[._-](test|spec)\.[^.\/]+$/i;
const SPEC_PATH_RE = /(^|\/)(docs\/specs|specs?|\.qoder\/specs|\.codex\/specs)(\/|$)/i;
const GENERATED_OR_DEPENDENCY_RE = /(^|\/)(\.git|\.next|\.turbo|build|coverage|dist|node_modules|out|target|vendor)(\/|$)/i;

const EXPLICIT_SIGNATURE_PATTERNS = [
  {
    id: "claude-code-generated-footer",
    label: "Generated with Claude Code",
    pattern: /generated with\s+\[?claude code\]?/i,
  },
  {
    id: "claude-coauthored-footer",
    label: "Co-authored-by Claude",
    pattern: /^co-authored-by:\s*(?:claude|[^<\n]*(?:anthropic|claude))/gim,
  },
  {
    id: "ai-code-coauthored-footer",
    label: "Co-authored-by AI agent",
    pattern: /^co-authored-by:\s*[^<\n]*(?:copilot|codex|openai|aider|devin|cursor|gemini)/gim,
  },
  {
    id: "ai-code-codeveloped-footer",
    label: "Co-developed-by AI agent",
    pattern: /^co-developed-by:\s*[^<\n]*(?:aone copilot|copilot|claude|codex|openai|aider|devin|cursor|gemini)/gim,
  },
  {
    id: "explicit-ai-footer",
    label: "AI footer",
    pattern: /^ai:\s*\S+/gim,
  },
];

const AGENT_AUTHOR_PATTERNS = [
  {
    id: "qoder-fixer-author",
    label: "qoder-fixer author",
    pattern: /(^|[ <])qoder-fixer([ >]|$)/i,
  },
  {
    id: "better-harness-author",
    label: "Better Harness author",
    pattern: /better harness|better-harness/i,
  },
  {
    id: "qoder-agent-author",
    label: "Qoder agent author",
    pattern: /qoder[-_ ]?(?:bot|mini|agent)/i,
  },
  {
    id: "copilot-swe-author",
    label: "Copilot SWE agent author",
    pattern: /copilot-swe-agent|copilot.*noreply\.github\.com/i,
  },
  {
    id: "known-ai-agent-author",
    label: "known AI agent author",
    pattern: /(?:claude|codex|openai|aider|devin|cursor-agent|gemini).*(?:bot|agent|noreply)/i,
  },
];

const WORKFLOW_PATTERNS = [
  {
    id: "ai-native-automation",
    label: "AI Native automated issue fix",
    pattern: /AI Native 自动化修复issues/i,
    codeCandidate: true,
  },
  {
    id: "better-harness-workflow",
    label: "Better Harness workflow",
    pattern: /Work-Item:\s*https?:\/\/harness\.|Harness 工作项|better-harness/i,
    codeCandidate: true,
  },
  {
    id: "codeflow-conflict-resolution",
    label: "CodeFlow conflict automation",
    pattern: /auto committed by CodeFlow/i,
    codeCandidate: false,
  },
  {
    id: "scm-auto-merge",
    label: "scm-auto merge or sync",
    pattern: /(^|\n)\s*scm-auto:\s*(?:merge|sync)|^scm-auto:\s*(?:merge|sync)/i,
    codeCandidate: false,
  },
];

const WEAK_MENTION_PATTERNS = [
  {
    id: "claude-code-mention",
    label: "Claude Code mention",
    pattern: /claude code/i,
  },
  {
    id: "codex-mention",
    label: "Codex mention",
    pattern: /\bcodex\b/i,
  },
  {
    id: "copilot-mention",
    label: "Copilot mention",
    pattern: /\bcopilot\b/i,
  },
  {
    id: "gemini-mention",
    label: "Gemini mention",
    pattern: /\bgemini\b/i,
  },
];

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }

    const body = arg.slice(2);
    const equalIndex = body.indexOf("=");
    if (equalIndex !== -1) {
      args[body.slice(0, equalIndex)] = body.slice(equalIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[body] = next;
      index += 1;
    } else {
      args[body] = true;
    }
  }
  return args;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toPosix(value) {
  return String(value ?? "").replaceAll("\\", "/").replaceAll(path.sep, "/");
}

function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    if (options.allowFailure) {
      return "";
    }
    throw new Error(`git ${args.join(" ")} failed in ${cwd}\n${result.stderr}`);
  }

  return result.stdout.trimEnd();
}

function resolveRepoRoot(cwd) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  return root ? path.resolve(root) : null;
}

function matchesAny(patterns, text) {
  const matches = [];
  for (const signal of patterns) {
    signal.pattern.lastIndex = 0;
    if (signal.pattern.test(text)) {
      matches.push({
        id: signal.id,
        label: signal.label,
        codeCandidate: signal.codeCandidate,
      });
    }
  }
  return matches;
}

function parseNumstat(output) {
  const files = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }
    const [addedRaw, deletedRaw, ...pathParts] = parts;
    const filePath = normalizeGitPath(pathParts.join("\t"));
    files.push({
      path: filePath,
      added: addedRaw === "-" ? null : Number(addedRaw),
      deleted: deletedRaw === "-" ? null : Number(deletedRaw),
      role: pathRole(filePath),
    });
  }
  return files;
}

function normalizeGitPath(filePath) {
  const normalized = toPosix(filePath);
  const arrowIndex = normalized.indexOf(" => ");
  if (arrowIndex === -1) {
    return normalized;
  }
  const afterArrow = normalized.slice(arrowIndex + 4).replace(/[{}]/g, "");
  const prefixMatch = normalized.slice(0, arrowIndex).match(/^(.*)\{[^{}]*$/);
  return prefixMatch ? `${prefixMatch[1]}${afterArrow}` : afterArrow;
}

function pathRole(filePath) {
  const normalized = toPosix(filePath);
  if (GENERATED_OR_DEPENDENCY_RE.test(normalized)) {
    return "generated-or-dependency";
  }
  if (SPEC_PATH_RE.test(normalized)) {
    return "spec";
  }
  if (TEST_PATH_RE.test(normalized)) {
    return "test";
  }
  if (SOURCE_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) {
    return "source";
  }
  return "supporting";
}

function classifyCommit(commit) {
  const identityText = `${commit.author.name} <${commit.author.email}> ${commit.committer.name} <${commit.committer.email}>`;
  const messageText = `${commit.subject}\n${commit.body}`;
  const explicitSignatures = matchesAny(EXPLICIT_SIGNATURE_PATTERNS, messageText);
  const agentAuthors = matchesAny(AGENT_AUTHOR_PATTERNS, identityText);
  const workflowMarkers = matchesAny(WORKFLOW_PATTERNS, messageText);
  const weakMentions = matchesAny(WEAK_MENTION_PATTERNS, messageText)
    .filter((mention) => !explicitSignatures.some((signal) => signal.id.includes(mention.id.split("-")[0])));
  const mergeOrSync = isAutomationMergeOrSync(commit, workflowMarkers);

  const signals = [
    ...explicitSignatures.map((signal) => ({ ...signal, strength: "explicit-signature" })),
    ...agentAuthors.map((signal) => ({ ...signal, strength: "agent-author" })),
    ...workflowMarkers.map((signal) => ({
      ...signal,
      strength: signal.codeCandidate ? "automation-workflow" : "automation-merge",
    })),
    ...weakMentions.map((signal) => ({ ...signal, strength: "weak-mention" })),
  ];

  const hasExplicitCodeSignal = explicitSignatures.length > 0
    || agentAuthors.length > 0
    || workflowMarkers.some((signal) => signal.codeCandidate);
  const weakOnly = !hasExplicitCodeSignal && weakMentions.length > 0;
  const hasAiEvidence = hasExplicitCodeSignal || weakOnly || workflowMarkers.length > 0;

  const confidence = explicitSignatures.length > 0 || agentAuthors.length > 0
    ? "high"
    : workflowMarkers.some((signal) => signal.codeCandidate)
      ? "medium"
      : weakOnly
        ? "low"
        : workflowMarkers.length > 0
          ? "low"
          : "none";

  return {
    hasAiEvidence,
    hasExplicitCodeSignal,
    weakOnly,
    automationMergeOrSync: mergeOrSync,
    confidence,
    signals,
  };
}

function isAutomationMergeOrSync(commit, workflowMarkers) {
  const subject = commit.subject ?? "";
  if (workflowMarkers.some((signal) => signal.codeCandidate === false)) {
    return true;
  }
  if (/^scm-auto:\s*(merge|sync)/i.test(subject)) {
    return true;
  }
  if (/resolve conflict, auto committed by codeflow/i.test(subject)) {
    return true;
  }
  if (isMergeOrSyncIntegrationSubject(subject)) {
    return true;
  }
  return commit.parents.length > 1 && /^(merge|sync|feat:\s*resolve conflict)/i.test(subject);
}

function isMergeOrSyncIntegrationSubject(subject) {
  return /^(?:merge\s+(?:branch|remote-tracking branch|pull request)\b|merge\s+\S.*\sinto\s|sync\b)/i.test(subject);
}

function traceabilityFor(commit) {
  const messageText = `${commit.subject}\n${commit.body}`;
  const specFiles = commit.files.filter((file) => file.role === "spec").map((file) => file.path);
  const testFiles = commit.files.filter((file) => file.role === "test").map((file) => file.path);
  const specMessageEvidence = messageText.match(/^spec:\s*\S+|docs\/specs\/\S+|\.qoder\/specs\/\S+|\.codex\/specs\/\S+/gim) ?? [];
  const testCommandEvidence = messageText.match(/^tests?:\s*.+$|(?:npm|pnpm|yarn)\s+test|node\s+--test|go\s+test|pytest|cargo\s+test|mvn\s+test|gradle\s+test/gim) ?? [];

  const specEvidence = [
    ...specFiles.map((item) => ({ kind: "changed-spec-file", value: item })),
    ...specMessageEvidence.map((item) => ({ kind: "commit-message-spec", value: item.trim() })),
  ];
  const testEvidence = [
    ...testFiles.map((item) => ({ kind: "changed-test-file", value: item })),
    ...testCommandEvidence.map((item) => ({ kind: "commit-message-test", value: item.trim() })),
  ];

  return {
    hasSpecEvidence: specEvidence.length > 0,
    hasTestEvidence: testEvidence.length > 0,
    hasChangedTestFile: testFiles.length > 0,
    specEvidence,
    testEvidence,
    missing: [
      ...(specEvidence.length === 0 ? ["spec"] : []),
      ...(testEvidence.length === 0 ? ["test"] : []),
    ],
  };
}

function scopeFor(files) {
  const sourceFiles = files.filter((file) => file.role === "source");
  const codeFiles = files.filter((file) => file.role === "source" || file.role === "test");
  return {
    filesChanged: files.length,
    hasCodeChanges: codeFiles.length > 0,
    hasSourceChanges: sourceFiles.length > 0,
    sourceFiles: sourceFiles.map((file) => file.path),
    codeFiles: codeFiles.map((file) => file.path),
    roles: countBy(files, (file) => file.role),
  };
}

function countBy(items, keyFor) {
  const counts = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function summarize(commits) {
  const aiEvidenceCommits = commits.filter((commit) => commit.ai.hasAiEvidence);
  const aiCodeCandidates = commits.filter((commit) => commit.aiCodeContributionCandidate);
  const missingSpec = aiCodeCandidates.filter((commit) => !commit.traceability.hasSpecEvidence);
  const missingTest = aiCodeCandidates.filter((commit) => !commit.traceability.hasTestEvidence);
  const missingBoth = aiCodeCandidates.filter(
    (commit) => !commit.traceability.hasSpecEvidence && !commit.traceability.hasTestEvidence,
  );

  return {
    analyzedCommits: commits.length,
    aiEvidenceCommits: aiEvidenceCommits.length,
    aiCodeContributionCandidates: aiCodeCandidates.length,
    automationMergeOrSync: commits.filter((commit) => commit.ai.automationMergeOrSync).length,
    weakMentionsOnly: commits.filter((commit) => commit.ai.weakOnly).length,
    missingSpecEvidence: missingSpec.length,
    missingTestEvidence: missingTest.length,
    missingSpecAndTestEvidence: missingBoth.length,
    byConfidence: countBy(aiEvidenceCommits, (commit) => commit.ai.confidence),
    byPrimarySignal: countBy(aiEvidenceCommits, (commit) => commit.ai.signals[0]?.id ?? "unknown"),
    recommendation:
      aiCodeCandidates.length === 0
        ? "No AI code contribution candidates were found in the scanned window."
        : `${aiCodeCandidates.length} AI code contribution candidate(s) found; ${missingBoth.length} lack both spec and test evidence in local commit metadata.`,
  };
}

export function analyzeAiContributionCensus(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot) {
    return {
      schemaVersion: SCHEMA_VERSION,
      status: "no-git-repository",
      scope: { cwd },
      summary: {
        analyzedCommits: 0,
        aiEvidenceCommits: 0,
        aiCodeContributionCandidates: 0,
        missingSpecEvidence: 0,
        missingTestEvidence: 0,
        missingSpecAndTestEvidence: 0,
        recommendation: "No Git repository was readable, so AI contribution census evidence is unavailable.",
      },
      commits: [],
    };
  }

  const maxCommits = positiveInt(options.maxCommits, DEFAULT_MAX_COMMITS);
  const logArgs = [
    "log",
    `--max-count=${maxCommits}`,
    "--numstat",
    "--format=%x1e%H%x1f%P%x1f%ct%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%s%x1f%B%x1d",
  ];
  if (options.all) {
    logArgs.push("--all");
  }
  if (options.firstParent) {
    logArgs.push("--first-parent");
  }
  if (options.since) {
    logArgs.push(`--since=${options.since}`);
  }
  if (options.range) {
    logArgs.push(options.range);
  }

  const commits = readCommits(repoRoot, logArgs)
    .map((commit) => {
      const ai = classifyCommit(commit);
      const scope = scopeFor(commit.files);
      const traceability = traceabilityFor(commit);
      const aiCodeContributionCandidate = ai.hasExplicitCodeSignal
        && !ai.automationMergeOrSync
        && scope.hasCodeChanges;
      return {
        sha: commit.sha,
        shortSha: commit.sha.slice(0, 8),
        timestamp: commit.timestamp,
        date: Number.isFinite(commit.timestamp) ? new Date(commit.timestamp * 1000).toISOString() : null,
        author: commit.author,
        committer: commit.committer,
        subject: commit.subject,
        parents: commit.parents,
        ai,
        aiCodeContributionCandidate,
        scope,
        traceability,
        files: commit.files,
      };
    });

  return {
    schemaVersion: SCHEMA_VERSION,
    status: "ok",
    scope: {
      cwd,
      repoRoot,
      maxCommits,
      since: options.since ?? null,
      range: options.range ?? null,
      allRefs: Boolean(options.all),
      firstParent: Boolean(options.firstParent),
    },
    summary: summarize(commits),
    commits: commits.filter((commit) => commit.ai.hasAiEvidence),
  };
}

function readCommits(repoRoot, logArgs) {
  const output = git(repoRoot, logArgs);
  if (!output.trim()) {
    return [];
  }
  return output
    .split("\x1e")
    .map((record) => record.trimStart())
    .filter(Boolean)
    .map(parseCommitRecord);
}

function parseCommitRecord(record) {
  const separatorIndex = record.indexOf("\x1d");
  const metadata = separatorIndex === -1 ? record : record.slice(0, separatorIndex);
  const numstat = separatorIndex === -1 ? "" : record.slice(separatorIndex + 1);
  const fields = metadata.split("\x1f");
  const [sha, parents, timestamp, authorName, authorEmail, committerName, committerEmail, subject, ...bodyParts] = fields;
  return {
    sha,
    parents: parents ? parents.split(/\s+/).filter(Boolean) : [],
    timestamp: Number(timestamp),
    author: {
      name: authorName,
      email: authorEmail,
    },
    committer: {
      name: committerName,
      email: committerEmail,
    },
    subject,
    body: bodyParts.join("\x1f").trim(),
    files: parseNumstat(numstat),
  };
}

export function renderMarkdown(result) {
  const lines = [
    "# AI Contribution Census",
    "",
    `- Status: ${result.status}`,
    `- Analyzed commits: ${result.summary.analyzedCommits}`,
    `- AI evidence commits: ${result.summary.aiEvidenceCommits}`,
    `- AI code contribution candidates: ${result.summary.aiCodeContributionCandidates}`,
    `- Missing spec evidence: ${result.summary.missingSpecEvidence}`,
    `- Missing test evidence: ${result.summary.missingTestEvidence}`,
    `- Missing both spec and test evidence: ${result.summary.missingSpecAndTestEvidence}`,
    "",
    result.summary.recommendation,
  ];

  const candidates = result.commits.filter((commit) => commit.aiCodeContributionCandidate);
  if (candidates.length > 0) {
    lines.push("", "## AI Code Contribution Candidates", "");
    lines.push("| Commit | Confidence | Spec | Test | Subject |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const commit of candidates.slice(0, 20)) {
      lines.push([
        commit.shortSha,
        commit.ai.confidence,
        commit.traceability.hasSpecEvidence ? "present" : "missing",
        commit.traceability.hasTestEvidence ? "present" : "missing",
        escapeMarkdownCell(commit.subject),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    }
  }

  const nonCandidates = result.commits.filter((commit) => commit.ai.hasAiEvidence && !commit.aiCodeContributionCandidate);
  if (nonCandidates.length > 0) {
    lines.push("", "## Separated Evidence", "");
    for (const commit of nonCandidates.slice(0, 10)) {
      const reason = commit.ai.automationMergeOrSync
        ? "merge/sync integration"
        : commit.ai.weakOnly
          ? "weak mention only"
          : "no code changes";
      lines.push(`- ${commit.shortSha}: ${reason} - ${commit.subject}`);
    }
  }

  lines.push("", "Evidence boundary: local Git metadata only; no external tracker, CI, review, or runtime state was opened.");
  return `${lines.join("\n")}\n`;
}

function escapeMarkdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function helpText() {
  return `Usage: node scripts/ai-contribution-census/cli.mjs [options]

Options:
  --cwd <path>             Target Git repository (default: current directory)
  --max-commits <n>        Bounded commit count (default: ${DEFAULT_MAX_COMMITS})
  --since <date>           Pass through to git log --since
  --range <revset>         Optional git revset, such as main..HEAD
  --all                   Scan all refs instead of current HEAD
  --first-parent           Follow first-parent history
  --json                   Emit parser-safe JSON
  --format <json|markdown> Explicit output format
  --help                   Show this help
`;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(helpText());
    return 0;
  }

  const result = analyzeAiContributionCensus({
    cwd: args.cwd,
    maxCommits: args["max-commits"],
    since: args.since,
    range: args.range,
    all: Boolean(args.all),
    firstParent: Boolean(args["first-parent"]),
  });
  const format = args.json ? "json" : String(args.format ?? "markdown").toLowerCase();
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (format === "markdown") {
    process.stdout.write(renderMarkdown(result));
    return 0;
  }

  process.stderr.write(`Unsupported format: ${format}\n`);
  return 2;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  process.exitCode = main();
}
