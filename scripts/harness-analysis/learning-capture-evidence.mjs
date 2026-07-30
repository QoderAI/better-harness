import { spawnSync } from "node:child_process";
import path from "node:path";

import {
  isPathInAnalysisScope,
  resolveAnalysisScopeForOptions,
  scopePathspecArgs,
} from "../core-change-watch/common.mjs";

const PROJECT_SKILL_RE = /(^|\/)(?:(?:\.qoder|\.agents|\.codex|\.cursor|\.claude|\.github|\.qoder-plugin|\.codex-plugin)\/skills\/|skills\/)[^/]+\/SKILL\.md$/iu;
const SPEC_PATH_RE = /(^|\/)(?:(?:docs|\.qoder|\.agents|\.codex|\.cursor)\/(?:specs?|adrs?|rfcs?)\/|(?:specs?|adrs?|rfcs?)\/)[^/]+\.md$/iu;
const DESIGN_RECORD_RE = /(^|\/)docs\/[^/]*(?:design|decision)[^/]*\.md$/iu;
const TEST_PATH_RE = /(^|\/)(?:__tests__|tests?|spec)(?:\/|$)|[._-](?:test|spec)\.[^/]+$/iu;
const SOURCE_PATH_RE = /\.(?:[cm]?[jt]sx?|go|rs|py|rb|php|java|kt|kts|cs|cpp|cc|c|h|hpp|swift|scala|vue|svelte)$/iu;
const DEFECT_SUBJECT_RE = /(?:^|\b)(?:fix|fixed|fixes|bug|regress(?:ion)?|repair|correct|prevent|hotfix)(?:\b|:)/iu;
const PATH_REF_RE = /(?:^|[\s`("'])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.@-]+)+\.(?:md|mjs|cjs|js|jsx|ts|tsx|go|rs|py|rb|php|java|kt|kts|json|ya?ml|toml|sh|ps1))(?:$|[\s`),"'])/gimu;
const STATUS_VALUES = ["Draft", "Proposed", "Accepted", "Approved", "Implemented", "Adopted", "Superseded", "Deprecated"];
const EVIDENCE_STATES = new Set(["Missing", "Unobserved", "Not applicable", "Present", "Wired", "Exercised", "Outcome-supported"]);
const SKILL_CAPABILITY_HEADING_RE = /^(?:(?:when to use|triggers?|trigger conditions?|capabilit(?:y|ies)|use cases?|purpose)\b|(?:何时使用|触发条件|能力|适用场景|用途)(?=$|[\s:：]))/iu;
const DIRECT_SKILL_TRIGGER_RE = /^(?:[-*]\s*)?(?:use (?:this )?(?:skill )?when|when to use|triggers?|何时使用|触发条件)\s*:?\s*(.+)$/iu;
const WORKFLOW_INTENT_RULES = [
  {
    id: "spec-review",
    family: "specification-planning",
    pattern: /(?:\b(?:spec(?:ification)?|requirements?|acceptance criteria|adr|decision record)\b[^\n]{0,48}\b(?:review|inspection|critique)\b|\b(?:review|inspect|critique)\b[^\n]{0,48}\b(?:spec(?:ification)?|requirements?|acceptance criteria|adr|decision record)\b|(?:规格|规范|需求|验收标准|架构决策)(?:审查|评审)|(?:审查|评审)(?:规格|规范|需求|验收标准|架构决策))/iu,
  },
  {
    id: "specification-preparation",
    family: "specification-planning",
    pattern: /(?:\b(?:write|create|draft|author|prepare|update|refine)\b[^\n]{0,48}\b(?:spec(?:ification)?|requirements?|acceptance criteria|adr|decision record)\b|\b(?:spec(?:ification)?|requirements?|adr|decision record)\b[^\n]{0,32}\b(?:writing|authoring|preparation)\b|(?:编写|创建|起草|更新|完善)(?:规格|规范|需求|验收标准|架构决策))/iu,
  },
  {
    id: "planning",
    family: "specification-planning",
    pattern: /(?:\b(?:planning|implementation plan|plan review|plan generation)\b|\b(?:write|create|draft|review|refine)\b[^\n]{0,32}\b(?:implementation )?plan\b|(?:制定|编写|评审|审查|完善)(?:实施)?计划)/iu,
  },
  {
    id: "setup-isolation",
    family: "setup-isolation",
    pattern: /(?:\b(?:setup|bootstrap|installation|environment setup|worktree|sandbox|isolation)\b|环境(?:搭建|设置|隔离)|工作树|沙箱)/iu,
  },
  {
    id: "debugging",
    family: "debugging-testing-verification",
    pattern: /(?:\b(?:debug(?:ging)?|diagnos(?:e|is|tic)|root cause)\b|调试|诊断|排障|根因分析)/iu,
  },
  {
    id: "testing-verification",
    family: "debugging-testing-verification",
    pattern: /(?:\b(?:test(?:ing)?|verification|verify|validation|qa)\b|测试|验证|验收测试)/iu,
  },
  {
    id: "review-acceptance",
    family: "review-acceptance-completion",
    pattern: /(?:\b(?:code|change|pull request|pr|acceptance)\b[^\n]{0,24}\b(?:review|check)\b|\b(?:review|check)\b[^\n]{0,24}\b(?:code|change|pull request|pr|acceptance)\b|代码审查|变更评审|验收评审)/iu,
  },
  {
    id: "release-delivery",
    family: "review-acceptance-completion",
    pattern: /(?:\b(?:release|releasing|released|deploy(?:ment)?|delivery|versioning|changeset)\b|发布|部署|交付)/iu,
  },
  {
    id: "branch-completion",
    family: "review-acceptance-completion",
    pattern: /(?:\b(?:branch completion|pull request completion|merge readiness|ready to merge)\b|分支收尾|合并准备)/iu,
  },
];

function posix(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function safePath(value) {
  const candidate = posix(value).replace(/^\.\//u, "");
  return candidate
    && !candidate.startsWith("/")
    && !/^[A-Za-z]:\//u.test(candidate)
    && !candidate.split("/").includes("..")
    ? candidate
    : "";
}

function normalizedIdentity(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9:_-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function boundedLabel(value, fallback = "unknown") {
  const label = String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, 120);
  return label || fallback;
}

function fileRef(file, label) {
  return { kind: "repository-file", id: file, label: boundedLabel(label, file) };
}

function commitRef(commit, label = "defect and test co-change candidate") {
  return { kind: "git-commit", id: commit, label };
}

function contentFor(fileContents, file) {
  const direct = fileContents?.[file];
  if (direct !== undefined) return String(direct ?? "");
  const normalized = posix(file);
  const key = Object.keys(fileContents ?? {}).find((candidate) => posix(candidate) === normalized);
  return key ? String(fileContents[key] ?? "") : "";
}

function frontmatterValue(content, key) {
  const frontmatter = String(content).match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)?.[1] ?? "";
  return frontmatter.match(new RegExp(`^${key}:\\s*["']?([^\\r\\n"']+)`, "imu"))?.[1]?.trim() ?? "";
}

function instructionFiles(files) {
  return files.filter((file) => /(^|\/)(?:AGENTS|CLAUDE)\.md$|(^|\/)\.github\/copilot-instructions\.md$|(^|\/)(?:\.qoder|\.codex|\.cursor)\/rules(?:\/|$)/iu.test(file));
}

function projectPluginNames(files, fileContents) {
  const manifests = files.filter((file) => /(^|\/)(?:\.qoder-plugin|\.codex-plugin)\/plugin\.json$/iu.test(file));
  return unique(manifests.flatMap((file) => {
    try {
      const value = JSON.parse(contentFor(fileContents, file));
      return [value?.name, value?.id].map(normalizedIdentity);
    } catch {
      return [];
    }
  }));
}

function skillSignals(content) {
  const description = frontmatterValue(content, "description");
  const trigger = /\buse when\b|\bwhen to use\b|^\s*triggers\s*:|何时使用|触发条件/imu.test(`${description}\n${content}`);
  const procedure = /^(?:#{1,4}\s*)?(?:workflow|process|procedure|steps?|checklist|release workflow|default workflow|流程|步骤|清单)\b/imu.test(content)
    || /(?:^|\n)\s*1\.\s+\S[\s\S]{0,200}(?:^|\n)\s*2\.\s+\S/mu.test(content);
  const validation = /^(?:#{1,4}\s*)?(?:validation|verification|verify|testing|tests?|final(?: [\w-]+){0,3} (?:review|check)|preflight|completion gate|success criteria|验证|测试|最终检查)\b/imu.test(content)
    || /\b(?:run|execute)\b[^\n]{0,80}\b(?:test|check|verify|lint|build)\b/iu.test(content);
  const output = /^(?:#{1,4}\s*)?(?:output|result|deliverable|artifact|completion|release contract|final answer|输出|结果|交付物)\b/imu.test(content)
    || /\b(?:produce|return|write|create|push(?:es)?)\b[^\n]{0,80}\b(?:report|file|artifact|summary|spec|plan|commit|branch|tag|release)\b/iu.test(content);
  return { trigger, procedure, output, validation };
}

function firstSkillTitle(content) {
  return String(content).match(/^#\s+(.+)$/mu)?.[1]?.trim() ?? "";
}

function boundedSkillCapabilityText(content) {
  const selected = [];
  let active = false;
  let activeLevel = 0;
  for (const line of String(content).split(/\r?\n/u)) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      const level = heading[1].length;
      if (active && level <= activeLevel) active = false;
      if (SKILL_CAPABILITY_HEADING_RE.test(heading[2].trim())) {
        active = true;
        activeLevel = level;
        selected.push(heading[2].trim());
      }
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    const directTrigger = trimmed.match(DIRECT_SKILL_TRIGGER_RE)?.[1]?.trim();
    if (directTrigger) selected.push(directTrigger);
    else if (active) selected.push(trimmed);
    if (selected.length >= 12) break;
  }
  return selected.join("\n").slice(0, 1_200);
}

function lifecycleClassification(identity, content) {
  const description = frontmatterValue(content, "description");
  const scope = [identity.replace(/[-_:]+/gu, " "), description, firstSkillTitle(content), boundedSkillCapabilityText(content)]
    .map((value) => String(value).normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
  const matches = WORKFLOW_INTENT_RULES.filter((rule) => rule.pattern.test(scope));
  return {
    lifecycleFamilies: unique(matches.map((rule) => rule.family)),
    workflowIntents: unique(matches.map((rule) => rule.id)),
  };
}

function skillRoute(skill, guidanceContents) {
  const escapedPath = skill.path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedDir = skill.path.slice(0, -"/SKILL.md".length).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pathPattern = new RegExp(`(?:${escapedPath}|${escapedDir})`, "iu");
  const route = guidanceContents.find((row) => pathPattern.test(row.content));
  return route?.file ?? "";
}

function sessionSkillRows(insights) {
  const usageRows = rows(insights?.keySignals?.usageEfficiency?.activity?.skills)
    .map((row) => ({ ...row, count: Number(row?.total ?? row?.count ?? 0) }));
  const source = usageRows.length > 0 ? usageRows : rows(insights?.keySignals?.topSkills);
  return source.map((row) => ({
    name: boundedLabel(row?.name),
    count: Math.max(0, Math.trunc(Number(row?.count ?? 0) || 0)),
    sourcePath: safePath(row?.sourcePath ?? row?.path),
    scope: String(row?.scope ?? "").toLowerCase(),
  })).filter((row) => row.name !== "unknown" && row.count > 0);
}

function buildReusableSkillEvidence(files, fileContents, insights) {
  const skillPaths = files.filter((file) => PROJECT_SKILL_RE.test(file)
    && !/(^|\/)(?:node_modules|vendor|dist|build|plugins?\/cache)(\/|$)/iu.test(file));
  const guidanceContents = instructionFiles(files).map((file) => ({ file, content: contentFor(fileContents, file) }));
  const pluginNames = projectPluginNames(files, fileContents);
  const candidates = skillPaths.map((skillPath) => {
    const content = contentFor(fileContents, skillPath);
    const parent = skillPath.split("/").at(-2) ?? "skill";
    const declaredIdentity = normalizedIdentity(frontmatterValue(content, "name"));
    const identity = declaredIdentity || normalizedIdentity(parent);
    const signals = skillSignals(content);
    const classification = lifecycleClassification(declaredIdentity, content);
    const routePath = skillRoute({ path: skillPath, identity }, guidanceContents);
    return {
      id: identity || normalizedIdentity(parent),
      path: skillPath,
      lifecycleFamilies: classification.lifecycleFamilies,
      workflowIntents: classification.workflowIntents,
      trigger: signals.trigger,
      procedure: signals.procedure,
      output: signals.output,
      validation: signals.validation,
      routed: Boolean(routePath),
      ...(routePath ? { routePath } : {}),
      evidenceRefs: [
        fileRef(skillPath, "tracked project Skill"),
        ...(routePath ? [fileRef(routePath, "project instruction route to Skill")] : []),
      ],
    };
  });

  const byPath = new Map(candidates.map((candidate) => [posix(candidate.path), candidate]));
  const namespaceAliases = new Map();
  for (const candidate of candidates) {
    for (const pluginName of pluginNames) namespaceAliases.set(`${pluginName}:${candidate.id}`, candidate);
  }
  const exactPathMatches = [];
  const namespacedMatches = [];
  const unresolvedNameMatches = [];
  const candidateByIdentity = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (const activity of sessionSkillRows(insights)) {
    const pathMatch = activity.sourcePath ? byPath.get(posix(activity.sourcePath)) : null;
    const normalizedName = normalizedIdentity(activity.name);
    const namespaceMatch = namespaceAliases.get(normalizedName);
    const item = pathMatch ?? namespaceMatch;
    if (item) {
      (pathMatch ? exactPathMatches : namespacedMatches).push({
        name: activity.name,
        count: activity.count,
        path: item.path,
        match: pathMatch ? "source-path" : "project-plugin-namespace",
      });
    } else {
      const suffix = normalizedName.includes(":") ? normalizedName.split(":").at(-1) : normalizedName;
      const nameCandidate = candidateByIdentity.get(suffix);
      if (nameCandidate) unresolvedNameMatches.push({ name: activity.name, count: activity.count, candidatePath: nameCandidate.path });
    }
  }
  const observedProjectSkills = [...exactPathMatches, ...namespacedMatches];
  const completeCandidates = candidates.filter((candidate) => candidate.lifecycleFamilies.length > 0
    && candidate.trigger && candidate.procedure && candidate.output && candidate.validation);
  const routedCandidates = completeCandidates.filter((candidate) => candidate.routed);
  const completePaths = new Set(completeCandidates.map((candidate) => candidate.path));
  const exercisedCandidates = observedProjectSkills.filter((candidate) => completePaths.has(candidate.path));
  return {
    status: candidates.length > 0 ? "candidates-present" : "scanned-empty",
    candidateState: exercisedCandidates.length > 0 ? "Exercised"
      : routedCandidates.length > 0 ? "Wired"
        : completeCandidates.length > 0 ? "Present" : "Unobserved",
    candidates,
    observedProjectSkills,
    unresolvedNameMatches,
    excludedUnscopedActivityCount: sessionSkillRows(insights).length - observedProjectSkills.length,
    evidenceRefs: unique(candidates.flatMap((candidate) => candidate.evidenceRefs).map((ref) => JSON.stringify(ref))).map(JSON.parse),
  };
}

function baseStem(file) {
  return path.posix.basename(file).toLowerCase()
    .replace(/\.[^.]+$/u, "")
    .replace(/[._-]?(?:test|tests|spec|specs)$/u, "")
    .replace(/[^a-z0-9]+/gu, "");
}

function pathCorrelated(sourcePaths, testPaths) {
  const sourceStems = sourcePaths.map(baseStem).filter((value) => value.length >= 3);
  const testStems = testPaths.map(baseStem).filter((value) => value.length >= 3);
  return sourceStems.some((source) => testStems.some((test) => source === test || source.includes(test) || test.includes(source)));
}

export function collectBoundedGitHistory(workspace, {
  limit = 200,
  timeout = 5_000,
  runner = spawnSync,
  analysisScope,
} = {}) {
  const resolvedScope = analysisScope
    ? resolveAnalysisScopeForOptions({ cwd: workspace, analysisScope })
    : null;
  const result = runner("git", [
    "-C", resolvedScope?.repoRoot ?? path.resolve(workspace), "log", "--no-merges", `-n${Math.max(1, Math.min(500, Number(limit) || 200))}`,
    "--format=__HD_COMMIT__%H%x09%P%x09%s", "--name-status", "--no-renames",
    ...(resolvedScope ? scopePathspecArgs(resolvedScope) : ["--"]),
  ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout, windowsHide: true });
  if (result?.status !== 0 || typeof result?.stdout !== "string") {
    return { status: "unavailable", commits: [], error: boundedLabel(result?.error?.code ?? "git-log-failed") };
  }
  const commits = [];
  let current = null;
  for (const rawLine of result.stdout.split(/\r?\n/u)) {
    if (rawLine.startsWith("__HD_COMMIT__")) {
      const [hash = "", parents = "", ...subject] = rawLine.slice("__HD_COMMIT__".length).split("\t");
      current = { hash, parentCount: parents.trim() ? parents.trim().split(/\s+/u).length : 0, subject: subject.join("\t"), files: [] };
      commits.push(current);
      continue;
    }
    if (!current || !rawLine.includes("\t")) continue;
    const [status = "", ...fileParts] = rawLine.split("\t");
    const file = safePath(fileParts.at(-1));
    if (file && (!resolvedScope || isPathInAnalysisScope(file, resolvedScope))) {
      current.files.push({ status: status.slice(0, 1), path: file });
    }
  }
  return { status: "complete", commits };
}

function buildRegressionTestEvidence(gitHistory = { status: "unavailable", commits: [] }) {
  const candidates = rows(gitHistory.commits).filter((commit) => {
    if (Number(commit?.parentCount ?? 0) < 1 || !DEFECT_SUBJECT_RE.test(String(commit?.subject ?? ""))) return false;
    return rows(commit?.files).length > 0 && rows(commit.files).length <= 200;
  }).map((commit) => {
    const changedPaths = rows(commit.files).map((entry) => safePath(entry?.path)).filter(Boolean);
    const testPaths = unique(changedPaths.filter((file) => TEST_PATH_RE.test(file)));
    const sourcePaths = unique(changedPaths.filter((file) => SOURCE_PATH_RE.test(file) && !TEST_PATH_RE.test(file)));
    if (testPaths.length === 0 || sourcePaths.length === 0) return null;
    return {
      commit: String(commit.hash).slice(0, 40),
      sourcePaths: sourcePaths.slice(0, 8),
      testPaths: testPaths.slice(0, 8),
      pathCorrelated: pathCorrelated(sourcePaths, testPaths),
      evidenceRefs: [commitRef(String(commit.hash).slice(0, 40))],
    };
  }).filter(Boolean).slice(0, 20);
  return {
    status: gitHistory.status === "complete" ? (candidates.length > 0 ? "candidates-present" : "scanned-empty") : "unavailable",
    historyStatus: gitHistory.status ?? "unavailable",
    inspectedCommitCount: rows(gitHistory.commits).length,
    candidates,
    evidenceRefs: candidates.flatMap((candidate) => candidate.evidenceRefs),
  };
}

function sectionText(content, headings) {
  const lines = String(content).split(/\r?\n/u);
  const selected = [];
  let active = false;
  let level = 0;
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      const nextLevel = heading[1].length;
      if (active && nextLevel <= level) active = false;
      if (headings.test(heading[2])) {
        active = true;
        level = nextLevel;
      }
    } else if (active) selected.push(line);
  }
  return selected.join("\n");
}

function pathReferences(content) {
  return unique([...String(content).matchAll(PATH_REF_RE)].map((match) => safePath(match[1]))).slice(0, 16);
}

function detectedStatuses(content) {
  const statusSection = sectionText(content, /^(?:status|traceability|状态|可追溯性)\b/iu);
  const scope = statusSection || String(content).slice(0, 2_000);
  return STATUS_VALUES.filter((status) => new RegExp(`\\b${status}\\b`, "iu").test(scope));
}

function specRoute(specPath, guidanceContents) {
  const pattern = new RegExp(specPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu");
  return guidanceContents.find((row) => pattern.test(row.content))?.file ?? "";
}

function buildCanonicalSpecEvidence(files, fileContents) {
  const guidanceContents = instructionFiles(files).map((file) => ({ file, content: contentFor(fileContents, file) }));
  const specPaths = files.filter((file) => SPEC_PATH_RE.test(file) || DESIGN_RECORD_RE.test(file));
  const candidates = specPaths.map((specPath) => {
    const content = contentFor(fileContents, specPath);
    const template = /(^|\/)(?:template|adr-?000)(?:[._-]|$)/iu.test(specPath);
    const statuses = detectedStatuses(content);
    const acceptanceIds = unique([...content.matchAll(/\b(?:[A-Z][A-Z0-9-]*-)?AC-\d+\b/gu)].map((match) => match[0])).slice(0, 24);
    const implementationText = sectionText(content, /^(?:implementation|plan(?: and tasks)?|tasks?|affected (?:files|modules)|实现|计划|任务)\b/iu);
    const testText = sectionText(content, /^(?:test(?: and review evidence)?|testing|validation|verification|验收|验证|测试)\b/iu);
    const implementationRefs = pathReferences(implementationText);
    const testRefs = pathReferences(testText);
    const validationCommandCount = [...testText.matchAll(/\b(?:npm|pnpm|yarn|bun|node|go|cargo|mvn|gradle|pytest|make)\b[^\r\n`]*/giu)].length;
    const supersessionLinks = unique([...content.matchAll(/(?:supersed(?:ed|es)|replaced)\s+(?:by\s+)?[^\r\n]*?\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/giu)]
      .map((match) => safePath(String(match[1]).split("#")[0]))).slice(0, 8);
    const routePath = specRoute(specPath, guidanceContents);
    const hasImplementationMapping = implementationRefs.length > 0;
    const hasTestMapping = testRefs.length > 0 || validationCommandCount > 0;
    const completeMapping = !template && statuses.length > 0 && acceptanceIds.length > 0 && hasImplementationMapping && hasTestMapping;
    return {
      path: specPath,
      kind: /(^|\/)adrs?\//iu.test(specPath) ? "ADR" : /(^|\/)rfcs?\//iu.test(specPath) ? "RFC" : DESIGN_RECORD_RE.test(specPath) ? "Design record" : "Spec",
      template,
      statuses,
      acceptanceIds,
      implementationRefs,
      testRefs,
      validationCommandCount,
      supersessionLinks,
      routed: Boolean(routePath),
      ...(routePath ? { routePath } : {}),
      candidateState: completeMapping ? "Wired" : (!template && statuses.length > 0 ? "Present" : "Unobserved"),
      evidenceRefs: [
        fileRef(specPath, "canonical Spec or decision-record candidate"),
        ...(routePath ? [fileRef(routePath, "project instruction route to canonical document")] : []),
      ],
    };
  });
  return {
    status: candidates.some((candidate) => !candidate.template) ? "candidates-present" : "scanned-empty",
    candidates,
    evidenceRefs: unique(candidates.flatMap((candidate) => candidate.evidenceRefs).map((ref) => JSON.stringify(ref))).map(JSON.parse),
  };
}

export function buildLearningCaptureEvidence({
  trackedFiles = [],
  fileContents = {},
  insights = {},
  gitHistory = { status: "unavailable", commits: [] },
} = {}) {
  const files = unique(trackedFiles.map(safePath)).sort();
  return {
    schemaVersion: 1,
    status: "candidate",
    reusableSkillEvidence: buildReusableSkillEvidence(files, fileContents, insights),
    regressionTestEvidence: buildRegressionTestEvidence(gitHistory),
    canonicalSpecEvidence: buildCanonicalSpecEvidence(files, fileContents),
  };
}

function validatePath(value, location, errors) {
  if (!safePath(value) || safePath(value) !== posix(value).replace(/^\.\//u, "")) errors.push(`${location} must be a safe repository-relative path`);
}

function validatePathArray(value, location, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${location} must be an array`);
    return;
  }
  value.forEach((item, index) => validatePath(item, `${location}[${index}]`, errors));
}

function validateRefs(value, location, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${location} must be an array`);
    return;
  }
  for (const [index, ref] of value.entries()) {
    const at = `${location}[${index}]`;
    if (!isObject(ref)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    if (ref.kind === "repository-file") validatePath(ref.id, `${at}.id`, errors);
    else if (ref.kind === "git-commit") {
      if (!/^[0-9a-f]{40}$/u.test(String(ref.id ?? ""))) errors.push(`${at}.id must be a full Git commit id`);
    } else errors.push(`${at}.kind is unsupported`);
  }
}

export function validateLearningCaptureEvidence(value) {
  if (value === undefined) return [];
  if (!isObject(value)) return ["report source repositoryEvidence.learningCaptureEvidence must be an object"];
  const prefix = "report source repositoryEvidence.learningCaptureEvidence";
  const errors = [];
  if (value.schemaVersion !== 1) errors.push(`${prefix}.schemaVersion must be 1`);
  if (value.status !== "candidate") errors.push(`${prefix}.status must be candidate`);

  const skills = value.reusableSkillEvidence;
  if (!isObject(skills)) errors.push(`${prefix}.reusableSkillEvidence must be an object`);
  else {
    if (!new Set(["candidates-present", "scanned-empty"]).has(skills.status)) errors.push(`${prefix}.reusableSkillEvidence.status is invalid`);
    if (!EVIDENCE_STATES.has(skills.candidateState)) errors.push(`${prefix}.reusableSkillEvidence.candidateState is invalid`);
    for (const [index, candidate] of rows(skills.candidates).entries()) {
      const at = `${prefix}.reusableSkillEvidence.candidates[${index}]`;
      validatePath(candidate?.path, `${at}.path`, errors);
      for (const field of ["trigger", "procedure", "output", "validation", "routed"]) {
        if (typeof candidate?.[field] !== "boolean") errors.push(`${at}.${field} must be boolean`);
      }
      if (!Array.isArray(candidate?.lifecycleFamilies)) errors.push(`${at}.lifecycleFamilies must be an array`);
      if (!Array.isArray(candidate?.workflowIntents)) errors.push(`${at}.workflowIntents must be an array`);
      else if (candidate.workflowIntents.some((intent) => typeof intent !== "string" || normalizedIdentity(intent) !== intent)) {
        errors.push(`${at}.workflowIntents must contain normalized string ids`);
      }
      if (candidate?.routePath !== undefined) validatePath(candidate.routePath, `${at}.routePath`, errors);
      validateRefs(candidate?.evidenceRefs, `${at}.evidenceRefs`, errors);
    }
    for (const [field, pathField] of [["observedProjectSkills", "path"], ["unresolvedNameMatches", "candidatePath"]]) {
      for (const [index, row] of rows(skills[field]).entries()) validatePath(row?.[pathField], `${prefix}.reusableSkillEvidence.${field}[${index}].${pathField}`, errors);
    }
    validateRefs(skills.evidenceRefs, `${prefix}.reusableSkillEvidence.evidenceRefs`, errors);
  }

  const regression = value.regressionTestEvidence;
  if (!isObject(regression)) errors.push(`${prefix}.regressionTestEvidence must be an object`);
  else {
    if (!new Set(["candidates-present", "scanned-empty", "unavailable"]).has(regression.status)) errors.push(`${prefix}.regressionTestEvidence.status is invalid`);
    if (!new Set(["complete", "unavailable"]).has(regression.historyStatus)) errors.push(`${prefix}.regressionTestEvidence.historyStatus is invalid`);
    for (const [index, candidate] of rows(regression.candidates).entries()) {
      const at = `${prefix}.regressionTestEvidence.candidates[${index}]`;
      if (!/^[0-9a-f]{40}$/u.test(String(candidate?.commit ?? ""))) errors.push(`${at}.commit must be a full Git commit id`);
      validatePathArray(candidate?.sourcePaths, `${at}.sourcePaths`, errors);
      validatePathArray(candidate?.testPaths, `${at}.testPaths`, errors);
      validateRefs(candidate?.evidenceRefs, `${at}.evidenceRefs`, errors);
    }
    validateRefs(regression.evidenceRefs, `${prefix}.regressionTestEvidence.evidenceRefs`, errors);
  }

  const specs = value.canonicalSpecEvidence;
  if (!isObject(specs)) errors.push(`${prefix}.canonicalSpecEvidence must be an object`);
  else {
    if (!new Set(["candidates-present", "scanned-empty"]).has(specs.status)) errors.push(`${prefix}.canonicalSpecEvidence.status is invalid`);
    for (const [index, candidate] of rows(specs.candidates).entries()) {
      const at = `${prefix}.canonicalSpecEvidence.candidates[${index}]`;
      validatePath(candidate?.path, `${at}.path`, errors);
      for (const field of ["implementationRefs", "testRefs", "supersessionLinks"]) validatePathArray(candidate?.[field], `${at}.${field}`, errors);
      if (!Number.isInteger(candidate?.validationCommandCount) || candidate.validationCommandCount < 0) errors.push(`${at}.validationCommandCount must be a non-negative integer`);
      if (candidate?.routePath !== undefined) validatePath(candidate.routePath, `${at}.routePath`, errors);
      if (!EVIDENCE_STATES.has(candidate?.candidateState)) errors.push(`${at}.candidateState is invalid`);
      validateRefs(candidate?.evidenceRefs, `${at}.evidenceRefs`, errors);
    }
    validateRefs(specs.evidenceRefs, `${prefix}.canonicalSpecEvidence.evidenceRefs`, errors);
  }
  return [...new Set(errors)];
}
