#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = "1.0.0";
const DEFAULT_STALE_DAYS = 180;
const DEFAULT_VERSION = "v5";
const DEFAULT_BENCHMARK_ITERATIONS = 80;
const CLASSIFIER_VERSIONS = ["v1", "v2", "v3", "v4", "v5"];

const MANIFEST_BASENAMES = new Set([
  "package.json",
  "go.mod",
  "go.work",
  "pyproject.toml",
  "pipfile",
  "poetry.toml",
  "cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "composer.json",
  "gemfile",
  "requirements.txt",
]);

const LOCKFILE_BASENAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "go.sum",
  "poetry.lock",
  "pipfile.lock",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "gradle.lockfile",
]);

const UPDATE_AUTOMATION_BASENAMES = new Set([
  "dependabot.yml",
  "dependabot.yaml",
  "renovate.json",
  "renovate.json5",
  ".renovaterc",
  ".renovaterc.json",
  ".renovaterc.json5",
]);

const IGNORE_DIRS = new Set([
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
]);

const REQUIREMENTS_RE = /^requirements(?:[-_.][a-z0-9_-]+)?\.txt$/i;
const WORKFLOW_RE = /(^|\/)\.(github\/workflows|gitlab\/ci|circleci)(\/|$)|(^|\/)\.gitlab-ci\.ya?ml$/i;
const FAST_PATH_SIGNAL_RE = /dependabot|renovate|audit|security|\/\.github\/workflows\/|\/\.gitlab\/ci\/|\/\.circleci\/|^\.gitlab-ci\.ya?ml$/i;
const AUDIT_SIGNAL_RE = /\b(?:npm|pnpm|yarn)\s+audit\b|osv-scanner|pip-audit|cargo\s+audit|govulncheck|bundler-audit|snyk\s+(?:test|monitor)|composer\s+audit|safety\s+check|trivy\b/i;
const ALERT_EVIDENCE_RE = /\b(?:CVE-\d{4}-\d+|GHSA-[a-z0-9-]+|dependabot alert|security alert|critical vulnerabilit(?:y|ies)|high vulnerabilit(?:y|ies))\b/i;
const ALERT_PATH_RE = /(^|\/)(?:security|audit|vulnerabilit|dependabot|osv|snyk|advisor|advisory|alerts?)(?:\/|[-_.])/i;

function toPosix(filePath) {
  return String(filePath).replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function basenameLower(filePath) {
  const normalized = toPosix(filePath);
  const slash = normalized.lastIndexOf("/");
  return normalized.slice(slash + 1).toLowerCase();
}

function ecosystemFor(filePath) {
  const base = basenameLower(filePath);
  if (base === "package.json" || base.endsWith("lock.json") || base === "pnpm-lock.yaml" || base === "yarn.lock" || base.startsWith("bun.lock")) return "node";
  if (base === "go.mod" || base === "go.work" || base === "go.sum") return "go";
  if (base === "pyproject.toml" || base === "pipfile" || base === "pipfile.lock" || base === "poetry.lock" || base === "poetry.toml" || REQUIREMENTS_RE.test(base)) return "python";
  if (base === "cargo.toml" || base === "cargo.lock") return "rust";
  if (base === "pom.xml" || base.startsWith("build.gradle") || base.startsWith("settings.gradle") || base === "gradle.lockfile") return "java";
  if (base === "composer.json" || base === "composer.lock") return "php";
  if (base === "gemfile" || base === "gemfile.lock") return "ruby";
  return "unknown";
}

function newClassification() {
  return {
    manifests: [],
    lockfiles: [],
    updateAutomation: [],
    auditSignalFiles: [],
    alertEvidenceFiles: [],
    dependencyFiles: [],
    counts: {
      manifests: 0,
      lockfiles: 0,
      updateAutomation: 0,
      auditSignalFiles: 0,
      alertEvidenceFiles: 0,
      dependencyFiles: 0,
    },
  };
}

function pushUnique(target, seen, record) {
  if (seen.has(record.path)) return;
  seen.add(record.path);
  target.push(record);
}

function finalizeClassification(state) {
  const uniqueDependency = new Map();
  for (const record of [...state.manifests, ...state.lockfiles]) {
    uniqueDependency.set(record.path, record);
  }
  state.dependencyFiles = [...uniqueDependency.values()].sort((a, b) => a.path.localeCompare(b.path));
  state.manifests.sort((a, b) => a.path.localeCompare(b.path));
  state.lockfiles.sort((a, b) => a.path.localeCompare(b.path));
  state.updateAutomation.sort((a, b) => a.path.localeCompare(b.path));
  state.auditSignalFiles.sort((a, b) => a.path.localeCompare(b.path));
  state.alertEvidenceFiles.sort((a, b) => a.path.localeCompare(b.path));
  state.counts = {
    manifests: state.manifests.length,
    lockfiles: state.lockfiles.length,
    updateAutomation: state.updateAutomation.length,
    auditSignalFiles: state.auditSignalFiles.length,
    alertEvidenceFiles: state.alertEvidenceFiles.length,
    dependencyFiles: state.dependencyFiles.length,
  };
  return state;
}

function finalizeClassificationPreserveOrder(state) {
  const uniqueDependency = new Map();
  for (const record of state.manifests) uniqueDependency.set(record.path, record);
  for (const record of state.lockfiles) uniqueDependency.set(record.path, record);
  state.dependencyFiles = [...uniqueDependency.values()];
  state.counts = {
    manifests: state.manifests.length,
    lockfiles: state.lockfiles.length,
    updateAutomation: state.updateAutomation.length,
    auditSignalFiles: state.auditSignalFiles.length,
    alertEvidenceFiles: state.alertEvidenceFiles.length,
    dependencyFiles: state.dependencyFiles.length,
  };
  return state;
}

function isManifestBase(base) {
  return MANIFEST_BASENAMES.has(base) || REQUIREMENTS_RE.test(base);
}

function isLockfileBase(base) {
  return LOCKFILE_BASENAMES.has(base);
}

function isUpdateAutomationPath(normalized, base) {
  return UPDATE_AUTOMATION_BASENAMES.has(base)
    || normalized === ".github/dependabot.yml"
    || normalized === ".github/dependabot.yaml"
    || normalized.includes("/renovate.json")
    || normalized.includes("/.renovaterc");
}

function isAuditCandidatePath(normalized, base) {
  return base === "package.json"
    || WORKFLOW_RE.test(normalized)
    || /(^|\/)(?:security|audit|dependency|deps|osv|snyk)[^/]*\.(?:ya?ml|json|toml|md|txt)$/i.test(normalized);
}

function isAlertCandidatePath(normalized) {
  return ALERT_PATH_RE.test(normalized);
}

function record(filePath, role) {
  return {
    path: toPosix(filePath),
    role,
    ecosystem: ecosystemFor(filePath),
  };
}

function classifyPathsV1(paths) {
  const state = newClassification();
  const seen = { manifests: new Set(), lockfiles: new Set(), update: new Set(), audit: new Set(), alert: new Set() };
  for (const filePath of paths) {
    const normalized = String(filePath).replaceAll("\\", "/").replace(/^\.\/+/, "");
    const lower = normalized.toLowerCase();
    const base = lower.split("/").pop() ?? "";
    if ([
      "package.json", "go.mod", "go.work", "pyproject.toml", "pipfile", "poetry.toml",
      "cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle",
      "settings.gradle.kts", "composer.json", "gemfile", "requirements.txt",
    ].includes(base) || /^requirements(?:[-_.][a-z0-9_-]+)?\.txt$/i.test(base)) {
      pushUnique(state.manifests, seen.manifests, record(normalized, "manifest"));
    }
    if ([
      "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
      "bun.lock", "go.sum", "poetry.lock", "pipfile.lock", "cargo.lock", "composer.lock",
      "gemfile.lock", "gradle.lockfile",
    ].includes(base)) {
      pushUnique(state.lockfiles, seen.lockfiles, record(normalized, "lockfile"));
    }
    if (["dependabot.yml", "dependabot.yaml", "renovate.json", "renovate.json5", ".renovaterc", ".renovaterc.json", ".renovaterc.json5"].includes(base)
      || lower.includes("/renovate.json") || lower.includes("/.renovaterc")) {
      pushUnique(state.updateAutomation, seen.update, record(normalized, "update-automation"));
    }
    if (base === "package.json" || /(^|\/)\.(github\/workflows|gitlab\/ci|circleci)(\/|$)|(^|\/)\.gitlab-ci\.ya?ml$/i.test(lower)
      || /(^|\/)(?:security|audit|dependency|deps|osv|snyk)[^/]*\.(?:ya?ml|json|toml|md|txt)$/i.test(lower)) {
      pushUnique(state.auditSignalFiles, seen.audit, record(normalized, "audit-signal-candidate"));
    }
    if (/(^|\/)(?:security|audit|vulnerabilit|dependabot|osv|snyk|advisor|advisory|alerts?)(?:\/|[-_.])/i.test(lower)) {
      pushUnique(state.alertEvidenceFiles, seen.alert, record(normalized, "alert-evidence-candidate"));
    }
  }
  return finalizeClassification(state);
}

function classifyPathsV2(paths) {
  const state = newClassification();
  const seen = { manifests: new Set(), lockfiles: new Set(), update: new Set(), audit: new Set(), alert: new Set() };
  for (const filePath of paths) {
    const normalized = toPosix(filePath);
    const base = basenameLower(normalized);
    if (isManifestBase(base)) pushUnique(state.manifests, seen.manifests, record(normalized, "manifest"));
    if (isLockfileBase(base)) pushUnique(state.lockfiles, seen.lockfiles, record(normalized, "lockfile"));
    if (isUpdateAutomationPath(normalized.toLowerCase(), base)) pushUnique(state.updateAutomation, seen.update, record(normalized, "update-automation"));
    if (isAuditCandidatePath(normalized.toLowerCase(), base)) pushUnique(state.auditSignalFiles, seen.audit, record(normalized, "audit-signal-candidate"));
    if (isAlertCandidatePath(normalized.toLowerCase())) pushUnique(state.alertEvidenceFiles, seen.alert, record(normalized, "alert-evidence-candidate"));
  }
  return finalizeClassificationPreserveOrder(state);
}

function classifyPathsV3(paths) {
  const state = newClassification();
  const seen = { manifests: new Set(), lockfiles: new Set(), update: new Set(), audit: new Set(), alert: new Set() };
  for (const filePath of paths) {
    const normalized = toPosix(filePath);
    const lower = normalized.toLowerCase();
    const slash = lower.lastIndexOf("/");
    const base = lower.slice(slash + 1);
    const rec = (role) => ({ path: normalized, role, ecosystem: ecosystemFor(base) });
    if (isManifestBase(base)) pushUnique(state.manifests, seen.manifests, rec("manifest"));
    if (isLockfileBase(base)) pushUnique(state.lockfiles, seen.lockfiles, rec("lockfile"));
    if (isUpdateAutomationPath(lower, base)) pushUnique(state.updateAutomation, seen.update, rec("update-automation"));
    if (isAuditCandidatePath(lower, base)) pushUnique(state.auditSignalFiles, seen.audit, rec("audit-signal-candidate"));
    if (isAlertCandidatePath(lower)) pushUnique(state.alertEvidenceFiles, seen.alert, rec("alert-evidence-candidate"));
  }
  return finalizeClassification(state);
}

function classifyPathsV4(paths) {
  const state = newClassification();
  const seen = { manifests: new Set(), lockfiles: new Set(), update: new Set(), audit: new Set(), alert: new Set() };
  for (const filePath of paths) {
    const normalized = toPosix(filePath);
    const lower = normalized.toLowerCase();
    const base = lower.slice(lower.lastIndexOf("/") + 1);
    const likelyDependency = base.endsWith(".json")
      || base.endsWith(".toml")
      || base.endsWith(".yaml")
      || base.endsWith(".yml")
      || base.endsWith(".xml")
      || base.endsWith(".lock")
      || base.endsWith(".lockb")
      || base.endsWith(".txt")
      || base === "gemfile"
      || base === "pipfile"
      || base === "go.mod"
      || base === "go.sum"
      || base.startsWith("build.gradle")
      || base.startsWith("settings.gradle");
    if (!likelyDependency && !lower.includes("dependabot") && !lower.includes("renovate") && !lower.includes("audit") && !lower.includes("security")) {
      continue;
    }
    const rec = (role) => ({ path: normalized, role, ecosystem: ecosystemFor(base) });
    if (isManifestBase(base)) pushUnique(state.manifests, seen.manifests, rec("manifest"));
    if (isLockfileBase(base)) pushUnique(state.lockfiles, seen.lockfiles, rec("lockfile"));
    if (isUpdateAutomationPath(lower, base)) pushUnique(state.updateAutomation, seen.update, rec("update-automation"));
    if (isAuditCandidatePath(lower, base)) pushUnique(state.auditSignalFiles, seen.audit, rec("audit-signal-candidate"));
    if (isAlertCandidatePath(lower)) pushUnique(state.alertEvidenceFiles, seen.alert, rec("alert-evidence-candidate"));
  }
  return finalizeClassification(state);
}

function classifyPathsV5(paths) {
  const state = newClassification();
  const seen = { manifests: new Set(), lockfiles: new Set(), update: new Set(), audit: new Set(), alert: new Set() };
  for (let index = 0; index < paths.length; index += 1) {
    const normalized = toPosix(paths[index]);
    const lower = normalized.toLowerCase();
    const base = lower.slice(lower.lastIndexOf("/") + 1);
    const manifestHit = MANIFEST_BASENAMES.has(base) || (base.startsWith("requirements") && REQUIREMENTS_RE.test(base));
    const lockfileHit = LOCKFILE_BASENAMES.has(base);
    const automationByBase = UPDATE_AUTOMATION_BASENAMES.has(base);
    const pathHasDependencySignal = automationByBase || FAST_PATH_SIGNAL_RE.test(lower);
    const workflowYaml = (base.endsWith(".yml") || base.endsWith(".yaml"))
      && (lower.includes("/.github/workflows/") || lower.includes("/.gitlab/ci/") || lower.includes("/.circleci/") || lower === ".gitlab-ci.yml" || lower === ".gitlab-ci.yaml");
    if (!manifestHit && !lockfileHit && !pathHasDependencySignal && !workflowYaml) {
      continue;
    }
    let ecosystem = "";

    if (manifestHit) {
      ecosystem ||= ecosystemFor(base);
      pushUnique(state.manifests, seen.manifests, { path: normalized, role: "manifest", ecosystem });
    } else if (lockfileHit) {
      ecosystem ||= ecosystemFor(base);
      pushUnique(state.lockfiles, seen.lockfiles, { path: normalized, role: "lockfile", ecosystem });
    }

    if ((manifestHit || lockfileHit) && base !== "package.json" && !pathHasDependencySignal && !workflowYaml) {
      continue;
    }

    if (automationByBase
      || lower === ".github/dependabot.yml"
      || lower === ".github/dependabot.yaml"
      || lower.includes("/renovate.json")
      || lower.includes("/.renovaterc")) {
      ecosystem ||= ecosystemFor(base);
      pushUnique(state.updateAutomation, seen.update, { path: normalized, role: "update-automation", ecosystem });
    }

    if (base === "package.json"
      || workflowYaml
      || (pathHasDependencySignal && (base.endsWith(".json") || base.endsWith(".toml") || base.endsWith(".md") || base.endsWith(".txt")))) {
      ecosystem ||= ecosystemFor(base);
      pushUnique(state.auditSignalFiles, seen.audit, { path: normalized, role: "audit-signal-candidate", ecosystem });
    }

    if (pathHasDependencySignal && isAlertCandidatePath(lower)) {
      ecosystem ||= ecosystemFor(base);
      pushUnique(state.alertEvidenceFiles, seen.alert, { path: normalized, role: "alert-evidence-candidate", ecosystem });
    }
  }
  return finalizeClassification(state);
}

export function classifyPathsWithVersion(paths, version = DEFAULT_VERSION) {
  switch (version) {
    case "v1":
      return classifyPathsV1(paths);
    case "v2":
      return classifyPathsV2(paths);
    case "v3":
      return classifyPathsV3(paths);
    case "v4":
      return classifyPathsV4(paths);
    case "v5":
      return classifyPathsV5(paths);
    default:
      throw new Error(`unknown classifier version: ${version}`);
  }
}

function parseArgs(argv = process.argv.slice(2)) {
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

function gitOutput(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return null;
  return result.stdout;
}

function resolveRepoRoot(cwd) {
  const start = path.resolve(cwd ?? process.cwd());
  const output = gitOutput(start, ["rev-parse", "--show-toplevel"]);
  return output ? path.resolve(output.trim()) : start;
}

function listGitTrackedFiles(repoRoot) {
  const output = gitOutput(repoRoot, ["ls-files", "-z"]);
  if (!output) return null;
  return output.split("\0").filter(Boolean).map(toPosix);
}

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name.toLowerCase())) {
          stack.push(path.join(current, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(toPosix(path.relative(root, path.join(current, entry.name))));
    }
  }
  return files.sort();
}

function listCandidateFiles(repoRoot) {
  const tracked = listGitTrackedFiles(repoRoot);
  if (tracked) {
    return {
      strategy: "git-ls-files",
      files: tracked,
    };
  }
  return {
    strategy: "filesystem-walk",
    files: walkFiles(repoRoot),
  };
}

function readText(repoRoot, filePath) {
  try {
    return readFileSync(path.join(repoRoot, filePath), "utf8");
  } catch {
    return "";
  }
}

function parsePackageScripts(repoRoot, filePath) {
  try {
    const json = JSON.parse(readText(repoRoot, filePath));
    if (!json?.scripts || typeof json.scripts !== "object") return [];
    return Object.entries(json.scripts)
      .filter(([, command]) => typeof command === "string" && AUDIT_SIGNAL_RE.test(command))
      .map(([name, command]) => ({ path: filePath, source: `package.json:scripts.${name}`, command }));
  } catch {
    return [];
  }
}

function inspectContentSignals(repoRoot, classification) {
  const auditSignals = [];
  const alertEvidence = [];
  const seenAudit = new Set();
  const seenAlert = new Set();

  for (const item of classification.manifests) {
    if (basenameLower(item.path) !== "package.json") continue;
    for (const script of parsePackageScripts(repoRoot, item.path)) {
      const key = `${script.path}:${script.source}`;
      if (!seenAudit.has(key)) {
        seenAudit.add(key);
        auditSignals.push(script);
      }
    }
  }

  for (const item of classification.auditSignalFiles) {
    const text = readText(repoRoot, item.path);
    if (AUDIT_SIGNAL_RE.test(text)) {
      const key = `${item.path}:content`;
      if (!seenAudit.has(key)) {
        seenAudit.add(key);
        auditSignals.push({ path: item.path, source: "content", command: firstMatchingLine(text, AUDIT_SIGNAL_RE) });
      }
    }
  }

  for (const item of classification.alertEvidenceFiles) {
    const text = readText(repoRoot, item.path);
    if (ALERT_EVIDENCE_RE.test(text)) {
      const key = `${item.path}:content`;
      if (!seenAlert.has(key)) {
        seenAlert.add(key);
        alertEvidence.push({ path: item.path, source: "content", evidence: firstMatchingLine(text, ALERT_EVIDENCE_RE) });
      }
    }
  }

  return {
    auditSignals: auditSignals.sort((a, b) => a.path.localeCompare(b.path) || a.source.localeCompare(b.source)),
    alertEvidence: alertEvidence.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function firstMatchingLine(text, regex) {
  const flags = regex.flags.includes("g") ? regex.flags.replace("g", "") : regex.flags;
  const lineRegex = new RegExp(regex.source, flags);
  return text.split(/\r?\n/).find((line) => lineRegex.test(line))?.trim() ?? "";
}

function gitDependencyTouchDates(repoRoot, files) {
  if (files.length === 0) return new Map();
  const output = gitOutput(repoRoot, ["log", "--format=%cI", "--name-only", "--", ...files]);
  if (!output) return new Map();
  const dates = new Map();
  let currentDate = "";
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
      currentDate = line;
      continue;
    }
    const normalized = toPosix(line);
    if (currentDate && !dates.has(normalized)) {
      dates.set(normalized, currentDate);
    }
  }
  return dates;
}

function statTouchDates(repoRoot, files) {
  const dates = new Map();
  for (const filePath of files) {
    try {
      dates.set(filePath, statSync(path.join(repoRoot, filePath)).mtime.toISOString());
    } catch {
      // Ignore unreadable files and leave age unknown.
    }
  }
  return dates;
}

function daysBetween(nowMs, thenIso) {
  if (!thenIso) return null;
  const thenMs = Date.parse(thenIso);
  if (!Number.isFinite(thenMs)) return null;
  return Math.max(0, Math.floor((nowMs - thenMs) / 86_400_000));
}

function enrichDependencyFiles(repoRoot, dependencyFiles, now, staleDays) {
  const paths = dependencyFiles.map((item) => item.path);
  const gitDates = gitDependencyTouchDates(repoRoot, paths);
  const statDates = gitDates.size === paths.length ? new Map() : statTouchDates(repoRoot, paths);
  const nowMs = Date.parse(now);
  return dependencyFiles.map((item) => {
    const lastTouchedAt = gitDates.get(item.path) ?? statDates.get(item.path) ?? null;
    const lastTouchedAgeDays = daysBetween(nowMs, lastTouchedAt);
    return {
      ...item,
      lastTouchedAt,
      lastTouchedAgeDays,
      stale: lastTouchedAgeDays !== null ? lastTouchedAgeDays > staleDays : false,
    };
  });
}

function summarizeFindings({ enrichedFiles, updateAutomation, alertEvidence, staleDays }) {
  const findings = [];
  const staleFiles = enrichedFiles.filter((item) => item.stale);
  if (alertEvidence.length > 0) {
    findings.push({
      id: "confirmed-dependency-alert",
      severity: "High",
      evidenceStrength: "Confirmed local alert evidence",
      title: "Dependency alert evidence is present",
      passCheck: "Open the alert source, triage severity, and validate the resolved dependency set.",
    });
  }
  if (staleFiles.length > 0) {
    findings.push({
      id: "dependency-files-stale",
      severity: updateAutomation.length > 0 ? "Medium" : "High",
      evidenceStrength: "Static git file-age evidence",
      title: `Dependency files older than ${staleDays} days`,
      files: staleFiles.slice(0, 12).map((item) => ({
        path: item.path,
        lastTouchedAt: item.lastTouchedAt,
        lastTouchedAgeDays: item.lastTouchedAgeDays,
      })),
      passCheck: "Confirm the dependency update policy or run the project-approved dependency review/audit workflow.",
    });
  }
  if (updateAutomation.length === 0 && enrichedFiles.length > 0) {
    findings.push({
      id: "dependency-update-automation-missing",
      severity: "Medium",
      evidenceStrength: "Static configuration evidence",
      title: "No dependency update automation config found",
      passCheck: "Add or cite Dependabot, Renovate, Snyk, or an equivalent host-native dependency update workflow.",
    });
  }
  return findings;
}

function riskLevel(findings) {
  if (findings.some((item) => item.severity === "High")) return "high";
  if (findings.some((item) => item.severity === "Medium")) return "medium";
  if (findings.length > 0) return "low";
  return "none";
}

export async function analyzeDependencyGovernance(options = {}) {
  const started = process.hrtime.bigint();
  const repoRoot = resolveRepoRoot(options.cwd ?? process.cwd());
  const version = options.version ?? DEFAULT_VERSION;
  const staleDays = Number.isFinite(Number(options.staleDays)) ? Number(options.staleDays) : DEFAULT_STALE_DAYS;
  const now = options.now ?? new Date().toISOString();
  const listed = listCandidateFiles(repoRoot);
  const classification = classifyPathsWithVersion(listed.files, version);
  const contentSignals = inspectContentSignals(repoRoot, classification);
  const enrichedFiles = enrichDependencyFiles(repoRoot, classification.dependencyFiles, now, staleDays);
  const staleDependencyFiles = enrichedFiles.filter((item) => item.stale);
  const findings = summarizeFindings({
    enrichedFiles,
    updateAutomation: classification.updateAutomation,
    alertEvidence: contentSignals.alertEvidence,
    staleDays,
  });
  const ecosystems = [...new Set(enrichedFiles.map((item) => item.ecosystem).filter((item) => item && item !== "unknown"))].sort();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "dependency-governance",
    status: "ok",
    repoRoot,
    analyzerVersion: version,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    source: {
      fileListStrategy: listed.strategy,
      fileCount: listed.files.length,
      staleDays,
      now,
    },
    summary: {
      ecosystemCount: ecosystems.length,
      ecosystems,
      manifestCount: classification.manifests.length,
      lockfileCount: classification.lockfiles.length,
      dependencyFileCount: enrichedFiles.length,
      staleDependencyFiles,
      updateAutomation: {
        count: classification.updateAutomation.length,
        files: classification.updateAutomation,
      },
      auditSignals: {
        count: contentSignals.auditSignals.length,
        files: contentSignals.auditSignals,
      },
      alertEvidence: {
        status: contentSignals.alertEvidence.length > 0 ? "confirmed-local-evidence" : "unverified",
        count: contentSignals.alertEvidence.length,
        files: contentSignals.alertEvidence,
      },
      findings,
      riskLevel: riskLevel(findings),
    },
    files: {
      manifests: classification.manifests,
      lockfiles: classification.lockfiles,
      dependency: enrichedFiles,
    },
    availableVersions: CLASSIFIER_VERSIONS,
  };
}

export function generateSyntheticDependencyPaths(options = {}) {
  const packageCount = Number.isFinite(Number(options.packageCount)) ? Number(options.packageCount) : 200;
  const fillerCount = Number.isFinite(Number(options.fillerCount)) ? Number(options.fillerCount) : 4000;
  const paths = [
    ".github/dependabot.yml",
    ".github/workflows/security.yml",
    "renovate.json",
  ];
  const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "go.sum", "poetry.lock", "Cargo.lock"];
  const manifests = ["package.json", "go.mod", "pyproject.toml", "Cargo.toml", "pom.xml", "requirements.txt"];
  for (let index = 0; index < packageCount; index += 1) {
    const root = `packages/pkg-${String(index).padStart(5, "0")}`;
    paths.push(`${root}/${manifests[index % manifests.length]}`);
    paths.push(`${root}/${lockfiles[index % lockfiles.length]}`);
  }
  for (let index = 0; index < fillerCount; index += 1) {
    const root = index % 5 === 0 ? "src" : index % 5 === 1 ? "docs" : index % 5 === 2 ? "test" : index % 5 === 3 ? "examples" : "templates";
    const ext = index % 4 === 0 ? "ts" : index % 4 === 1 ? "md" : index % 4 === 2 ? "json" : "tsx";
    paths.push(`${root}/module-${String(index).padStart(6, "0")}/file-${index}.${ext}`);
  }
  return paths;
}

export function benchmarkClassifierVersions(options = {}) {
  const paths = options.paths ?? generateSyntheticDependencyPaths(options);
  const iterations = Number.isFinite(Number(options.iterations)) ? Number(options.iterations) : DEFAULT_BENCHMARK_ITERATIONS;
  const versions = [];
  for (const version of CLASSIFIER_VERSIONS) {
    classifyPathsWithVersion(paths, version);
    const start = process.hrtime.bigint();
    let checksum = 0;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const result = classifyPathsWithVersion(paths, version);
      checksum += result.counts.dependencyFiles + result.counts.updateAutomation + result.counts.auditSignalFiles;
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    versions.push({
      version,
      elapsedMs: Number(elapsedMs.toFixed(3)),
      paths: paths.length,
      iterations,
      checksum,
    });
  }
  versions.sort((a, b) => a.elapsedMs - b.elapsedMs || a.version.localeCompare(b.version));
  return {
    kind: "dependency-governance-benchmark",
    best: versions[0],
    versions,
  };
}

function printTextReport(report) {
  const lines = [
    "Dependency Governance",
    "",
    `Repo: ${report.repoRoot}`,
    `Version: ${report.analyzerVersion}`,
    `Files: ${report.source.fileCount} (${report.source.fileListStrategy})`,
    `Ecosystems: ${report.summary.ecosystems.join(", ") || "none"}`,
    `Manifests: ${report.summary.manifestCount}`,
    `Lockfiles: ${report.summary.lockfileCount}`,
    `Update automation: ${report.summary.updateAutomation.count}`,
    `Audit signals: ${report.summary.auditSignals.count}`,
    `Alert evidence: ${report.summary.alertEvidence.status}`,
    `Risk: ${report.summary.riskLevel}`,
  ];
  if (report.summary.findings.length > 0) {
    lines.push("", "Findings:");
    for (const finding of report.summary.findings) {
      lines.push(`- ${finding.severity}: ${finding.title} (${finding.id})`);
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printBenchmark(benchmark) {
  const lines = [
    "Dependency Governance Benchmark",
    "",
    `Best: ${benchmark.best.version} (${benchmark.best.elapsedMs}ms)`,
    "",
    ...benchmark.versions.map((item) => `${item.version}: ${item.elapsedMs}ms over ${item.iterations} iterations / ${item.paths} paths`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const version = args.version ?? DEFAULT_VERSION;
  if (!CLASSIFIER_VERSIONS.includes(version)) {
    throw new Error(`--version must be one of ${CLASSIFIER_VERSIONS.join(", ")}`);
  }

  if (args.benchmark) {
    const benchmark = benchmarkClassifierVersions({
      packageCount: args["synthetic-packages"],
      fillerCount: args["synthetic-fillers"],
      iterations: args.iterations,
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(benchmark, null, 2)}\n`);
      return;
    }
    printBenchmark(benchmark);
    return;
  }

  const report = await analyzeDependencyGovernance({
    cwd: args.cwd,
    version,
    now: args.now,
    staleDays: args["stale-days"],
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  printTextReport(report);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    process.stderr.write(`dependency-governance failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
