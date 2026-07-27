import { readFileSync } from "node:fs";
import path from "node:path";

import { listTrackedFiles } from "../core-change-watch/common.mjs";
import {
  buildLearningCaptureEvidence,
  collectBoundedGitHistory,
} from "./learning-capture-evidence.mjs";

function posix(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function evidence(id, label, kind = "repository") {
  return { kind, id, label };
}

function matching(files, pattern) {
  return files.filter((file) => pattern.test(file));
}

function scriptNames(packageManifest = {}) {
  return Object.keys(packageManifest?.scripts ?? {});
}

function scriptMatches(names, pattern) {
  return names.some((name) => pattern.test(name));
}

const FRONTEND_FRAMEWORK_PACKAGES = new Set([
  "@angular/core",
  "@remix-run/react",
  "@storybook/react",
  "@storybook/vue3",
  "@sveltejs/kit",
  "astro",
  "lit",
  "next",
  "nuxt",
  "preact",
  "react",
  "react-dom",
  "solid-js",
  "svelte",
  "vue",
]);

function frontendProjectEvidence(files, packageManifest = {}) {
  const dependencies = {
    ...(packageManifest?.dependencies ?? {}),
    ...(packageManifest?.devDependencies ?? {}),
    ...(packageManifest?.peerDependencies ?? {}),
  };
  const frameworkPackages = Object.keys(dependencies)
    .filter((name) => FRONTEND_FRAMEWORK_PACKAGES.has(name))
    .sort();
  const frameworkConfigs = matching(files, /(^|\/)(?:angular\.json|(?:next|nuxt|svelte|astro)\.config\.[^/]+|\.storybook\/main\.[^/]+)$/i);
  const viteConfigs = matching(files, /(^|\/)vite\.config\.[^/]+$/i);
  const uiSources = matching(files, /(^|\/)(?:app|pages|src|components)\/[^/]+(?:\/[^/]+)*\.(?:jsx|tsx|vue|svelte)$/i);
  const browserEntries = matching(files, /(^|\/)(?:index\.html|src\/(?:main|index)\.[cm]?[jt]s)$/i);
  const styleSources = matching(files, /(^|\/)(?:app|src|styles?|theme|tokens?)\/[^/]+(?:\/[^/]+)*\.(?:css|scss|sass|less|styl|json|ya?ml)$/i);
  const uiImplementation = [...new Set([...uiSources, ...browserEntries])];
  const evidenceRefs = [];
  if (frameworkPackages.length > 0) {
    evidenceRefs.push(evidence("frontend-framework", `frontend framework packages: ${frameworkPackages.slice(0, 6).join(", ")}`));
  }
  if (frameworkConfigs.length > 0) {
    evidenceRefs.push(evidence("frontend-config", `${frameworkConfigs.length} canonical frontend configuration file(s)`));
  }
  if (uiImplementation.length > 0 && (viteConfigs.length > 0 || styleSources.length > 0)) {
    evidenceRefs.push(evidence("frontend-ui-source", `${uiImplementation.length} UI source or browser entry file(s) with a frontend build or style surface`));
  }
  return evidenceRefs;
}

function normalizedContentMap(fileContents = {}) {
  return new Map(Object.entries(fileContents).map(([file, content]) => [posix(file).toLowerCase(), String(content ?? "")]));
}

function matchingContent(contentMap, files) {
  return files.map((file) => contentMap.get(posix(file).toLowerCase()) ?? "").filter(Boolean).join("\n");
}

function activeConfigContent(value) {
  return String(value ?? "")
    .split(/\r?\n/u)
    .filter((line) => !/^\s*#/u.test(line))
    .join("\n");
}

function ciVerificationProfile(contentMap, files) {
  const mergeTriggerRe = /\b(?:merge_request|pull_request)\b/iu;
  const verificationRe = /\b(?:go\s+test|(?:\.\/)?gradlew(?:\.bat)?[^\n]*(?:test|check)|mvn[^\n]*\btest\b|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|check|verify)\b|run-tests?|test_build|pytest|cargo\s+test)\b/iu;
  const highRiskAutomationRe = /\b(?:deploy|publish|upload|release|credential|secret|access[_ -]?key|webhook|oss)\b/iu;
  const entries = files.map((file) => {
    const key = posix(file).toLowerCase();
    const known = contentMap.has(key);
    const content = activeConfigContent(contentMap.get(key));
    return {
      file,
      known,
      mergeTriggered: mergeTriggerRe.test(content),
      verifies: verificationRe.test(content),
      highRisk: highRiskAutomationRe.test(content),
    };
  });
  return {
    entries,
    contentComplete: entries.length > 0 && entries.every((entry) => entry.known),
    mergeTriggered: entries.some((entry) => entry.mergeTriggered),
    mergeVerified: entries.some((entry) => entry.mergeTriggered && entry.verifies),
    highRisk: entries.some((entry) => entry.highRisk),
  };
}

function publicInsightRefs(card, prefix) {
  return (card?.evidenceRefs ?? []).map((ref, index) => ({
    kind: String(ref?.kind ?? "session-event"),
    id: `${prefix}-${index + 1}`,
    ...(ref?.type ? { type: String(ref.type) } : {}),
    ...(Number.isInteger(Number(ref?.line)) ? { line: Number(ref.line) } : {}),
  }));
}

function workspacePlanningSignals(insights) {
  const supportedKinds = new Set(["plan-command", "plan-mode", "plan-tool", "spec-command", "spec-reference"]);
  return (insights?.keySignals?.planningSignals ?? [])
    .filter((signal) => signal?.scope === "workspace" && supportedKinds.has(signal?.kind));
}

function planningWorkflowFinding({ specs, insights, locale }) {
  const analyzedSessionCount = Number(insights?.sample?.analyzedSessionCount ?? 0);
  if (!Number.isFinite(analyzedSessionCount) || analyzedSessionCount <= 0) return null;

  const planningSignals = workspacePlanningSignals(insights);
  const specSignals = planningSignals.filter((signal) => signal?.kind === "spec-reference");
  const workflowSignals = planningSignals.filter((signal) => signal?.kind !== "spec-reference");
  if (specs.length > 0 && specSignals.length === 0) {
    const specTargets = specs.slice(0, 3).map((file) => `\`${file}\``).join(", ");
    return {
      id: "planning-workflow-spec-use-gap",
      kind: "evidence-gap",
      severity: "Low",
      title: reader(locale, "Project specs were not observed in the planning workflow", "项目 Spec 尚未在规划流程中被观察到使用"),
      reason: reader(locale,
        `The project tracks ${specs.length} spec file(s), but the selected ${analyzedSessionCount} workspace session(s) contain no action-oriented reference to a project spec. Planning commands or modes alone do not prove that a spec was reviewed or used.`,
        `项目跟踪了 ${specs.length} 个 Spec 文件，但选中的 ${analyzedSessionCount} 个工作区会话没有出现对项目 Spec 的操作型引用。仅有规划命令或模式信号不能证明 Spec 已被评审或使用。`),
      expectedOutcome: reader(locale,
        "Non-trivial changes connect their planning step to the relevant project spec and its acceptance evidence.",
        "非平凡改动会把规划步骤关联到对应的项目 Spec 及其验收证据。"),
      expectedArtifact: "Workflow",
      expectedOutput: [reader(locale,
        "Update the project planning Workflow so non-trivial changes open the relevant spec and retain its acceptance evidence before implementation.",
        "更新项目规划工作流，使非平凡改动在实现前打开相关 Spec，并保留对应的验收证据。")],
      dimensionRefs: ["task-understanding"],
      subdimensionRefs: ["goal-understanding", "scope-boundary"],
      staticEvidence: [evidence("project-spec-files", `${specs.length} tracked project spec file(s)`)],
      episodeEvidence: workflowSignals.flatMap((signal, index) => publicInsightRefs(signal, `planning-workflow-${index + 1}`)),
      projectionPolicy: "required",
      aiFixPrompt: reader(locale,
        `/better-harness fix this issue\n\nUpdate the project's planning workflow so non-trivial changes open the relevant existing spec before implementation. Start with ${specTargets}; connect the selected spec's acceptance ids to the task plan and validation evidence. Keep the change in the existing planning or agent-instruction owner rather than duplicating the specs.\n\n## Validation\n\n- Run the repository's existing Markdown or spec-link check when available\n- Exercise one non-trivial planning task and confirm it cites the selected spec path and at least one acceptance id`,
        `/better-harness 修复这个问题\n\n更新项目现有的规划工作流，让非平凡改动在实现前先打开相关 Spec。先从 ${specTargets} 中选择匹配项，把其中的验收编号关联到任务计划和验证证据；改动应落在已有规划或 Agent 指引归属中，不要复制 Spec 内容。\n\n## 验证\n\n- 运行仓库已有的 Markdown 或 Spec 链接检查（如果存在）\n- 用一个非平凡规划任务确认结果引用了所选 Spec 路径和至少一个验收编号`),
    };
  }

  if (specs.length === 0 && planningSignals.length > 0) {
    return {
      id: "planning-workflow-project-binding-gap",
      kind: "missing-mechanism",
      severity: "Low",
      title: reader(locale, "Observed planning is not bound to a project spec", "已观察到的规划流程尚未绑定项目 Spec"),
      reason: reader(locale,
        `The selected ${analyzedSessionCount} workspace session(s) contain Plan or Spec workflow signals, but the tracked project has no spec file under a recognized project spec path.`,
        `选中的 ${analyzedSessionCount} 个工作区会话包含 Plan 或 Spec 工作流信号，但已跟踪项目在可识别的 Spec 路径下没有 Spec 文件。`),
      expectedOutcome: reader(locale,
        "Non-trivial planning decisions land in a reviewable project spec with acceptance and validation evidence.",
        "非平凡规划决策会落到可评审的项目 Spec，并包含验收与验证证据。"),
      expectedArtifact: "Document",
      expectedOutput: [reader(locale,
        "Add a reviewable project planning Document so intent, stable acceptance ids, non-goals, implementation tasks, and validation evidence stay connected.",
        "新增一份可评审的项目规划文档，使意图、稳定验收编号、非目标、实现任务和验证证据保持关联。")],
      dimensionRefs: ["task-understanding"],
      subdimensionRefs: ["goal-understanding", "scope-boundary"],
      episodeEvidence: planningSignals.flatMap((signal, index) => publicInsightRefs(signal, `planning-workflow-${index + 1}`)),
      projectionPolicy: "required",
      aiFixPrompt: reader(locale,
        "/better-harness fix this issue\n\nAdd the smallest project spec under `docs/specs/` (or the repository's existing recognized spec directory) for one current non-trivial planning route. Include intent, stable acceptance ids, non-goals, implementation tasks, and validation evidence; then link that spec from the existing planning or agent-instruction owner.\n\n## Validation\n\n- Run the repository's existing Markdown or spec-link check when available\n- Exercise the planning route and confirm it opens the new spec and cites one acceptance id before implementation",
        "/better-harness 修复这个问题\n\n在 `docs/specs/`（或仓库现有的规范目录）为一个当前非平凡规划路径新增最小项目 Spec，包含意图、稳定验收编号、非目标、实现任务和验证证据；随后从已有规划或 Agent 指引归属链接该 Spec。\n\n## 验证\n\n- 运行仓库已有的 Markdown 或 Spec 链接检查（如果存在）\n- 执行该规划路径，确认实现前打开了新 Spec 并引用至少一个验收编号"),
    };
  }

  return null;
}

function row() {
  return { present: [], wired: [] };
}

function add(target, layer, ref) {
  if (ref && !target[layer].some((item) => item.id === ref.id)) target[layer].push(ref);
}

function reader(locale, english, chinese) {
  return locale === "zh-CN" ? chinese : english;
}

function workSurfaceKinds(files) {
  const kinds = [];
  if (files.some((file) => /(^|\/)Makefile$/i.test(file))) kinds.push("Make");
  if (files.some((file) => /(^|\/)(?:magefile\.go|magefiles\/)/i.test(file))) kinds.push("Mage");
  if (files.some((file) => /(^|\/)Taskfile\.ya?ml$/i.test(file))) kinds.push("Task");
  if (files.some((file) => /(^|\/)justfile$/i.test(file))) kinds.push("Just");
  return kinds;
}

function practiceCoverageRow(surface, files) {
  const paths = [...new Set(files.map(posix).filter(Boolean))].sort();
  if (paths.length === 0) return null;
  return {
    surface,
    scopes: ["Project"],
    count: paths.length,
    paths: paths.slice(0, 12),
  };
}

function dependencyEcosystems(files) {
  const definitions = [
    { id: "node", label: "Node", manifests: /(^|\/)package\.json$/i, locks: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i },
    { id: "php", label: "PHP", manifests: /(^|\/)composer\.json$/i, locks: /(^|\/)composer\.lock$/i },
    { id: "go", label: "Go", manifests: /(^|\/)go\.mod$/i, locks: /(^|\/)go\.sum$/i },
    { id: "python", label: "Python", manifests: /(^|\/)pyproject\.toml$/i, locks: /(^|\/)(poetry\.lock|Pipfile\.lock)$/i },
    { id: "rust", label: "Rust", manifests: /(^|\/)Cargo\.toml$/i, locks: /(^|\/)Cargo\.lock$/i },
  ];
  return definitions.map((definition) => ({
    ...definition,
    manifestFiles: matching(files, definition.manifests),
    lockFiles: matching(files, definition.locks),
  })).filter((entry) => entry.manifestFiles.length > 0);
}

function englishList(values) {
  if (values.length < 2) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

export function buildTaskLoopRepositoryEvidence({
  trackedFiles = [],
  packageManifest = {},
  fileContents = {},
  insights = {},
  secretScan = {},
  gitHistory = { status: "unavailable", commits: [] },
  locale = "en",
} = {}) {
  const files = trackedFiles.map(posix);
  const names = scriptNames(packageManifest);
  const contentMap = normalizedContentMap(fileContents);
  const dimensions = {
    "task-understanding": row(),
    "controlled-execution": row(),
    "change-validation": row(),
    "reliable-delivery": row(),
  };
  const subdimensions = Object.fromEntries([
    "goal-understanding", "relevant-context", "scope-boundary",
    "instruction-led-start", "supported-operation", "permission-boundary",
    "relevant-check", "failure-repair", "validate-again",
    "acceptance-evidence", "high-risk-approval", "rollback-recovery",
  ].map((id) => [id, row()]));
  const findings = [];

  const designContracts = matching(files, /^DESIGN\.md$/u);
  const guidance = [...new Set([
    ...matching(files, /(^|\/)(AGENTS|CLAUDE)\.md$|(^|\/)\.github\/copilot-instructions\.md$|(^|\/)(?:\.qoder|\.codex|\.cursor)\/rules(?:\/|$)/i),
    ...designContracts,
  ])];
  const architecture = matching(files, /(^|\/)(README|ARCHITECTURE|DESIGN)\.md$/i);
  const specs = matching(files, /(^|\/)(?:(?:docs|\.qoder|\.agents|\.codex|\.cursor)\/(?:specs?|adrs?|rfcs?)\/|(?:specs?|adrs?|rfcs?)\/)/i);
  const manifests = matching(files, /(^|\/)(package\.json|composer\.json|go\.mod|pyproject\.toml|pom\.xml|build\.gradle(?:\.kts)?|Cargo\.toml)$/i);
  const lockfiles = matching(files, /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock|go\.sum|poetry\.lock|Pipfile\.lock|Gemfile\.lock|Cargo\.lock)$/i);
  const ecosystems = dependencyEcosystems(files);
  const unlockedEcosystems = ecosystems.filter((entry) => entry.lockFiles.length === 0);
  const lockedEcosystems = ecosystems.filter((entry) => entry.lockFiles.length > 0);
  const runtimePins = matching(files, /(^|\/)(\.nvmrc|\.node-version|\.tool-versions|\.python-version|rust-toolchain(?:\.toml)?)$/i);
  const tests = matching(files, /(^|\/)(__tests__|tests?|spec)(\/|$)|[._-](test|spec)\.[^.]+$/i);
  const focusedMappings = matching(files, /(^|\/)(test-mapping|affected-tests?|mapping-gate|blast-radius)(\/|\.|$)/i);
  const actualHooks = matching(files, /(^|\/)(?:\.qoder|\.codex|\.cursor)\/hooks\.json$|(^|\/)(?:\.qoder-plugin|\.codex-plugin)\/hooks\/hooks\.json$/i);
  const hookAssets = matching(files, /^(?:hooks\/(?:git-scripts|scripts)\/|hooks\/hooks\.json$)|(^|\/)(?:\.qoder-plugin|\.codex-plugin)\/hooks\//i);
  const skills = matching(files, /(^|\/)(?:(?:\.qoder|\.agents|\.codex|\.cursor|\.claude|\.github|\.qoder-plugin|\.codex-plugin)\/skills\/|skills\/)[^/]+\/SKILL\.md$/i);
  const commands = matching(files, /(^|\/)(?:\.qoder|\.agents|\.codex|\.cursor)\/commands\//i);
  const agents = matching(files, /(^|\/)(?:\.qoder|\.agents|\.codex|\.cursor)\/(?:agents|subagents)\//i);
  const mcpAssets = matching(files, /(^|\/)(?:\.mcp\.json|mcp\.jsonc?|(?:\.qoder|\.codex|\.cursor)\/mcp[^/]*\.json)$/i);
  const workflows = matching(files, /(^|\/)(?:\.github\/workflows\/|\.qoder\/workflows\/|\.codex\/workflows\/|\.agents\/workflows\/|workflows\/)/i);
  const pluginAssets = matching(files, /(^|\/)(?:\.qoder-plugin|\.codex-plugin|\.cursor-plugin)\/(?:plugin|marketplace)\.json$/i);
  const memories = matching(files, /(^|\/)MEMORY\.md$|(^|\/)(?:\.qoder|\.codex|\.agents)\/memor(?:y|ies)(?:\/|$)/i);
  const ci = matching(files, /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.ya?ml$|\.circleci\/|Jenkinsfile$|azure-pipelines\.ya?ml$|\.aoneci\/)/i);
  const codeowners = matching(files, /(^|\/)CODEOWNERS$/i);
  const recoveryAssets = matching(files, /(^|\/)[^/]*(rollback|revert|reset|backup|restore|dry-run)[^/]*$/i);
  const workSurfaceFiles = matching(files, /(^|\/)(?:Makefile|Taskfile\.ya?ml|justfile|magefile\.go)$|(^|\/)magefiles\//i);
  const runScripts = scriptMatches(names, /^(start|dev|serve|preview|build|compile|test)(:|$)/i) || workSurfaceFiles.length > 0;
  const setupScripts = scriptMatches(names, /^(setup|bootstrap|install|doctor|reset)(:|$)/i);
  const testScripts = scriptMatches(names, /(^|:)(test|check)(:|$)/i);
  const constraintScripts = scriptMatches(names, /(^|:)(lint|typecheck|format|scan|verify|check)(:|$)|pack:verify/i);
  const releaseChecks = scriptMatches(names, /(pack|publish|release|deploy)(:|$)/i);
  const frontendEvidence = frontendProjectEvidence(files, packageManifest);
  const guidanceText = matchingContent(contentMap, guidance);
  const instructionBoundary = /(?:stop\s+and\s+report|stop\s+condition|maximum\s+retries|max(?:imum)?\s+\d+\s+(?:tries|attempts)|human\s+(?:confirmation|approval)|人工确认|停止并报告|失败后停止|最大重试)/i.test(guidanceText);
  const ciProfile = ciVerificationProfile(contentMap, ci);

  if (guidance.length > 0) {
    const ref = evidence("agent-guidance", `${guidance.length} agent guidance file(s)`);
    add(dimensions["task-understanding"], "present", ref);
    add(subdimensions["goal-understanding"], "present", ref);
    add(subdimensions["relevant-context"], "present", ref);
  }
  if (designContracts.length > 0) {
    const ref = evidence("root-design-contract", "root DESIGN.md visual design contract");
    add(dimensions["task-understanding"], "present", ref);
    add(subdimensions["relevant-context"], "present", ref);
  }
  if (architecture.length > 0 || specs.length > 0) {
    const ref = evidence("scoped-project-routes", `${architecture.length} architecture/readme and ${specs.length} spec file(s)`);
    add(dimensions["task-understanding"], "wired", ref);
    add(subdimensions["relevant-context"], "wired", ref);
    add(subdimensions["scope-boundary"], "present", ref);
  }
  if (frontendEvidence.length > 0 && designContracts.length === 0) {
    findings.push({
      id: "frontend-design-contract-missing",
      kind: "missing-mechanism",
      severity: "Low",
      title: reader(locale,
        "Frontend design rules have no root DESIGN.md contract",
        "前端设计规则缺少根目录 DESIGN.md 契约"),
      reason: reader(locale,
        "The repository contains confirmed frontend framework or UI implementation evidence, but no exact uppercase `DESIGN.md` exists at the project root. Agents must reconstruct colors, typography, spacing, component states, and design rationale from scattered implementation details.",
        "仓库包含明确的前端框架或 UI 实现证据，但项目根目录没有精确大写的 `DESIGN.md`。Agent 只能从分散的实现细节中重新推断颜色、字体、间距、组件状态和设计依据。"),
      expectedOutcome: reader(locale,
        "Frontend agents read one root design contract with machine-readable tokens, human-readable rationale, component states, accessibility constraints, and explicit unresolved design decisions.",
        "前端 Agent 可以读取一份根目录设计契约，其中包含机器可读 Token、可读设计依据、组件状态、无障碍约束和明确标记的未决设计决策。"),
      expectedArtifact: "Rule",
      expectedOutput: [reader(locale,
        "Create a root design Rule document so agents can reuse the project's existing tokens, rationale, component states, accessibility constraints, and unresolved decisions.",
        "创建根目录设计规则文档，使 Agent 能复用项目现有 Token、设计依据、组件状态、无障碍约束和未决事项。")],
      dimensionRefs: ["task-understanding"],
      subdimensionRefs: ["relevant-context"],
      staticEvidence: frontendEvidence,
      projectionPolicy: "required",
      aiFixPrompt: reader(locale,
        "/better-harness fix this issue\n\nFollow the activated Better Harness Skill's finding-owner route to load the packaged DESIGN.md contract and its linked complete example before authoring.\n\nCreate a root `DESIGN.md` from the project's existing theme, CSS variables, component library, screenshots, and design-token evidence. If the design-review plugin is available, use `design-system-capture` when the contract must be inferred and `design-md-review` to author or review it; otherwise use the packaged contract and example as the structural fallback. Follow the public DESIGN.md schema with top-level `colors`, `typography`, `rounded`, `spacing`, and `components` token groups plus readable Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, and Do's and Don'ts sections. Label inferred rules and unresolved policy as `needs-design-decision`; do not invent brand decisions.\n\n## Validation\n\n- Run `npx -p @google/design.md designmd lint DESIGN.md` and resolve structural or token-reference errors\n- Run the project's smallest frontend build or preview check, then inspect one representative rendered state against the new contract",
        "/better-harness 修复这个问题\n\n先沿已激活 Better Harness Skill 的 finding owner 路由加载随包提供的 DESIGN.md 契约及其完整示例，再开始编写。\n\n根据项目已有的主题、CSS 变量、组件库、截图和设计 Token 证据，在根目录创建 `DESIGN.md`。如果已安装 design-review 插件，需要从实现反推契约时先使用 `design-system-capture`，编写或复核文件时使用 `design-md-review`；否则以随包提供的契约和示例作为结构 fallback。遵循公开 DESIGN.md schema，在 frontmatter 中使用顶层 `colors`、`typography`、`rounded`、`spacing` 和 `components` Token 组，并补充可读的 Overview、Colors、Typography、Layout、Elevation & Depth、Shapes、Components、Do's and Don'ts 章节。把推断规则和未决策略标记为 `needs-design-decision`，不要发明品牌决策。\n\n## 验证\n\n- 运行 `npx -p @google/design.md designmd lint DESIGN.md`，修复结构或 Token 引用错误\n- 运行项目最小前端构建或预览检查，并对照新契约检查一个代表性渲染状态"),
    });
  }

  if (manifests.length > 0) {
    const ref = evidence("workspace-manifest", `${manifests.length} workspace manifest(s)`);
    add(dimensions["controlled-execution"], "present", ref);
    add(subdimensions["instruction-led-start"], "present", ref);
  }
  if (lockfiles.length > 0 || runtimePins.length > 0) {
    const ref = evidence("reproducible-environment", `${lockfiles.length} lockfile(s), ${runtimePins.length} runtime pin(s)`);
    add(subdimensions["instruction-led-start"], lockfiles.length > 0 && runtimePins.length > 0 ? "wired" : "present", ref);
  }
  if (runScripts) {
    const workKinds = workSurfaceKinds(workSurfaceFiles);
    const ref = evidence("runnable-work-surface", workSurfaceFiles.length > 0
      ? reader(locale,
        `a ${workKinds.join("/")} work surface (${workSurfaceFiles.length} files)`,
        `${workKinds.join("/")} 工作入口（${workSurfaceFiles.length} 个文件）`)
      : reader(locale, "workspace run/build/test scripts", "工作区运行、构建或测试脚本"));
    add(dimensions["controlled-execution"], "wired", ref);
    add(subdimensions["supported-operation"], "wired", ref);
  }
  if (setupScripts) add(subdimensions["instruction-led-start"], "wired", evidence("setup-doctor-reset", "setup, doctor, or reset script"));
  if (actualHooks.length > 0) {
    const ref = evidence("project-agent-hooks", `${actualHooks.length} project Hook configuration(s)`);
    add(subdimensions["permission-boundary"], "wired", ref);
    add(dimensions["reliable-delivery"], "wired", ref);
    add(subdimensions["high-risk-approval"], "wired", ref);
  } else if (hookAssets.length > 0) {
    const ref = evidence("hook-assets", `${hookAssets.length} Hook asset(s)`);
    add(subdimensions["permission-boundary"], "present", ref);
    add(dimensions["reliable-delivery"], "present", ref);
    add(subdimensions["high-risk-approval"], "present", ref);
  }
  if (instructionBoundary) {
    add(subdimensions["permission-boundary"], "present", evidence("instruction-stop-boundary", "agent instructions define a stop or human-confirmation boundary"));
  }

  if (tests.length > 0) {
    const ref = evidence("test-surface", `${tests.length} tracked test file(s)`);
    add(dimensions["change-validation"], "present", ref);
    add(subdimensions["relevant-check"], "present", ref);
    add(subdimensions["validate-again"], "present", ref);
  }
  if (testScripts) {
    const ref = evidence("test-command", "workspace test/check script");
    add(dimensions["change-validation"], "wired", ref);
    add(subdimensions["relevant-check"], "wired", ref);
  }
  if (focusedMappings.length > 0) add(subdimensions["relevant-check"], "wired", evidence("affected-check-route", `${focusedMappings.length} affected-check mapping asset(s)`));
  if (constraintScripts) add(subdimensions["relevant-check"], "wired", evidence("constraint-checks", "lint, type, scan, or package verification script"));

  if (ci.length > 0) {
    const ref = evidence("pre-acceptance-ci", `${ci.length} CI workflow file(s)`);
    add(dimensions["reliable-delivery"], "wired", ref);
    add(subdimensions["acceptance-evidence"], "wired", ref);
  }
  if (codeowners.length > 0) add(subdimensions["acceptance-evidence"], "present", evidence("review-routing", "CODEOWNERS review route"));
  if (releaseChecks) add(dimensions["reliable-delivery"], "present", evidence("release-check", "package/release verification script"));
  if (recoveryAssets.length > 0) add(subdimensions["rollback-recovery"], "present", evidence("recovery-route", `${recoveryAssets.length} reset/rollback/recovery asset(s)`));

  const concreteGuardrailNeed = instructionBoundary || (guidance.length > 0 && ciProfile.highRisk);
  if (concreteGuardrailNeed && actualHooks.length === 0 && hookAssets.length === 0) {
    findings.push({
      id: "repository-agent-lifecycle-guardrail-gap",
      kind: "missing-mechanism",
      severity: "Medium",
      title: reader(locale,
        "Risky Agent actions can proceed without asking or stopping",
        "高风险 Agent 操作仍可能在没有询问或拦截时继续"),
      reason: reader(locale,
        instructionBoundary
          ? "The project documents when an agent should stop, but it has no repository-shared Hook that applies this protection consistently in every environment."
          : "The repository has no shared Hook or guardrail that defines when risky agent actions should ask, block, require evidence, or stop.",
        instructionBoundary
          ? "项目已经写明 Agent 应在什么情况下停止，但没有仓库共享的 Hook，无法保证不同环境都应用这层保护。"
          : "仓库没有共享 Hook 或守卫来定义高风险操作何时需要询问、拦截、补证据或停止。"),
      expectedOutcome: reader(locale,
        "Risky agent writes, deployments, or credential access ask, block, or stop consistently across clean environments.",
        "高风险 Agent 写入、部署或凭据访问会在不同干净环境中一致地询问、拦截或停止。"),
      expectedArtifact: "Hook",
      expectedOutput: [reader(locale,
        "Add a repository-owned Hook so risky operations consistently ask, block, require evidence, or stop at the documented boundaries.",
        "新增仓库归属的 Hook，使高风险操作在已记录的边界上一致地询问、拦截、要求证据或停止。")],
      dimensionRefs: ["reliable-delivery"],
      subdimensionRefs: ["high-risk-approval", "permission-boundary"],
      staticEvidence: [evidence("no-agent-lifecycle-guardrail", "agent Hook and guardrail asset scan returned empty")],
    });
  }

  if (tests.length > 0 && ciProfile.contentComplete && !ciProfile.mergeVerified) {
    findings.push({
      id: "repository-ci-verification-gap",
      kind: "missing-mechanism",
      severity: "Medium",
      title: reader(locale,
        ciProfile.mergeTriggered
          ? "Merge requests can be accepted without running project checks"
          : "Changes can be merged without running project tests",
        ciProfile.mergeTriggered
          ? "合并请求可能在没有运行项目检查时被接受"
          : "改动可能在没有运行项目测试时被合并"),
      reason: reader(locale,
        ciProfile.mergeTriggered
          ? `The repository tracks ${tests.length} test file(s), but the inspected merge-request workflow does not run an explicit test, lint, check, or verify command; verification appears only on another CI route.`
          : `The repository tracks ${tests.length} test file(s) and ${ci.length} CI file(s), but no active pull-request or merge-request route runs an explicit test, lint, check, or verify command before acceptance.`,
        ciProfile.mergeTriggered
          ? `仓库有 ${tests.length} 个测试文件，但已检查的合并请求工作流没有运行明确的 test、lint、check 或 verify 命令；验证只出现在其他 CI 路径。`
          : `仓库有 ${tests.length} 个测试文件和 ${ci.length} 个 CI 文件，但没有生效的拉取请求或合并请求路径在验收前运行明确的 test、lint、check 或 verify 命令。`),
      expectedOutcome: reader(locale,
        "Every proposed merge runs the repository's smallest relevant verification gate and records the result before acceptance.",
        "每个待合并改动都会在验收前运行仓库最小相关验证门禁并记录结果。"),
      expectedArtifact: "Config",
      expectedOutput: [reader(locale,
        "Update the active merge-request Config so every proposed merge runs the smallest relevant repository verification and records the result before acceptance.",
        "更新生效的合并请求配置，使每个待合并改动都运行仓库最小相关验证，并在验收前记录结果。")],
      dimensionRefs: ["change-validation", "reliable-delivery"],
      subdimensionRefs: ["relevant-check", "acceptance-evidence"],
      staticEvidence: [evidence("pre-acceptance-ci-review", `${tests.length} test file(s), ${ci.length} inspected CI file(s), no merge-triggered verification route`)],
    });
  }

  const planningFinding = planningWorkflowFinding({ specs, insights, locale });
  if (planningFinding) findings.push(planningFinding);

  if (ci.length === 0 && codeowners.length === 0) {
    findings.push({
      id: "repository-acceptance-path-gap",
      kind: "missing-mechanism",
      severity: "High",
      title: reader(locale,
        "Changes can land without shared checks or review",
        "改动可能未经共享检查或评审就进入主线"),
      reason: reader(locale, "No tracked CI workflow or review-routing file connects a change to acceptance before it lands.", "没有已跟踪的 CI 工作流或评审路由把改动连接到进入主线前的验收。"),
      expectedOutcome: reader(locale,
        "Changes run the shared focused checks before acceptance and leave a clear recovery path when blocked.",
        "改动会在进入主线前运行共享的聚焦检查，被拦截时也会留下清楚的恢复路径。"),
      expectedArtifact: "Workflow",
      expectedOutput: [reader(locale,
        "Add an active pre-acceptance Workflow so changes run shared focused checks, record acceptance evidence, and expose a recovery route when blocked.",
        "新增生效的合并前验收工作流，使改动运行共享聚焦检查、记录验收证据，并在被拦截时提供恢复路径。")],
      dimensionRefs: ["reliable-delivery"],
      subdimensionRefs: ["acceptance-evidence"],
      staticEvidence: [evidence("no-pre-acceptance-route", "CI and review-route scan returned empty")],
    });
  }

  if (unlockedEcosystems.length > 0) {
    const unlockedLabels = unlockedEcosystems.map((entry) => entry.label);
    const lockedLabels = lockedEcosystems.map((entry) => entry.label);
    const unlockedNames = englishList(unlockedLabels);
    const lockedNames = englishList(lockedLabels);
    const unlockedNamesZh = unlockedLabels.join("、");
    const lockedNamesZh = lockedLabels.join("、");
    const manifestCount = unlockedEcosystems.reduce((sum, entry) => sum + entry.manifestFiles.length, 0);
    const manifestLabel = manifestCount === 1 ? "manifest" : "manifests";
    findings.push({
      id: "repository-reproducibility-gap",
      kind: "evidence-gap",
      severity: "Medium",
      title: reader(locale,
        `${unlockedNames} dependencies are not locked across machines`,
        `${unlockedNamesZh} 依赖没有锁定，不同机器可能安装出不同版本`),
      reason: reader(locale,
        `${lockedNames ? `${lockedNames} dependencies have a tracked lockfile, but ` : ""}${manifestCount} ${unlockedNames} ${manifestLabel} have no matching dependency lockfile${runtimePins.length === 0 ? "; no runtime-version pin is tracked either" : ""}.`,
        `${lockedNamesZh ? `${lockedNamesZh} 依赖已有锁文件，但 ` : ""}${manifestCount} 个 ${unlockedNamesZh} 依赖清单没有对应的锁文件${runtimePins.length === 0 ? "，项目也没有已跟踪的运行时版本约束" : ""}。`),
      expectedOutcome: reader(locale,
        `Newcomers and agents resolve the same ${unlockedNames} dependencies${runtimePins.length === 0 ? " and validation runtime" : ""} on different machines.`,
        `新人和 Agent 在不同机器上会解析出一致的 ${unlockedNamesZh} 依赖${runtimePins.length === 0 ? "和验证运行时" : ""}。`),
      expectedArtifact: "Config",
      expectedOutput: [reader(locale,
        "Update dependency and runtime Config so supported environments resolve the same dependency graph and validation runtime.",
        "更新依赖与运行时配置，使受支持环境解析出一致的依赖图和验证运行时。")],
      dimensionRefs: ["controlled-execution"],
      subdimensionRefs: ["instruction-led-start"],
      staticEvidence: [evidence("unlocked-runtime", `${unlockedNames} manifest without matching lockfile${runtimePins.length === 0 ? " or runtime pin" : ""}`)],
    });
  }

  const credentialFindings = (Array.isArray(secretScan?.findings) ? secretScan.findings : [])
    .filter((finding) => ["high", "critical"].includes(String(finding?.severity ?? "").toLowerCase())
      && String(finding?.confidence ?? "").toLowerCase() === "high");
  if (credentialFindings.length > 0) {
    const files = [...new Set(credentialFindings.map((finding) => posix(finding?.file)
      .replace(/^(?:\.\.\/)+/u, "")
      .split("/").slice(-3).join("/")))].filter(Boolean);
    const visibleFiles = files.slice(0, 3);
    findings.push({
      id: "repository-embedded-credential",
      kind: "evidence-gap",
      severity: "High",
      title: reader(locale, "Tracked configuration contains embedded credentials", "已跟踪配置中包含嵌入式凭据"),
      reason: reader(locale,
        `A redacted high-confidence scan found ${credentialFindings.length} embedded credential pattern${credentialFindings.length === 1 ? "" : "s"} in ${files.length} tracked configuration file${files.length === 1 ? "" : "s"}${visibleFiles.length > 0 ? ` (${visibleFiles.join(", ")})` : ""}. Keeping credentials in repository history exposes them to every checkout and automation reader.`,
        `脱敏高置信扫描在 ${files.length} 个已跟踪配置文件中发现 ${credentialFindings.length} 个嵌入式凭据模式${visibleFiles.length > 0 ? `（${visibleFiles.join("、")}）` : ""}。凭据进入仓库历史后，会暴露给每个检出环境和自动化读取者。`),
      expectedOutcome: reader(locale,
        "Automation reads rotated credentials from the approved secret store, and tracked configuration contains no reusable credential value.",
        "自动化从批准的密钥存储读取已轮换凭据，已跟踪配置不再包含可复用的凭据值。"),
      expectedArtifact: "Config",
      expectedOutput: [reader(locale,
        "Update the affected automation Config to read rotated credentials from the approved secret store, with no reusable credential value left in tracked files.",
        "更新受影响的自动化配置，使其从批准的密钥存储读取已轮换凭据，且已跟踪文件中不再保留可复用凭据值。")],
      dimensionRefs: ["reliable-delivery", "controlled-execution"],
      subdimensionRefs: ["permission-boundary", "acceptance-evidence"],
      staticEvidence: credentialFindings.slice(0, 5).map((finding, index) => ({
        kind: "secret-scan",
        id: String(finding?.fingerprint ?? `${finding?.ruleId ?? "credential"}-${index + 1}`),
        label: `${posix(finding?.file).replace(/^(?:\.\.\/)+/u, "").split("/").slice(-3).join("/")}:${Number(finding?.line ?? 0)}`,
      })),
      projectionPolicy: "required",
      aiFixPrompt: reader(locale,
        `/better-harness fix this issue\n\nRepair the embedded credential findings in ${visibleFiles.length > 0 ? visibleFiles.map((file) => `\`${file}\``).join(", ") : "the secret-scan-owned configuration files"}. Rotate every exposed value, replace tracked literals with the repository's approved secret-store reference, and update only the directly affected automation configuration. Follow the project's history-remediation policy when a credential remains reusable from Git history.\n\n## Validation\n\n- Re-run the repository secret scan and confirm the cited high-confidence findings are absent\n- Run the smallest affected automation/configuration check with injected test credentials\n- Confirm no rotated value remains in tracked files or generated patches`,
        `/better-harness 修复这个问题\n\n修复 ${visibleFiles.length > 0 ? visibleFiles.map((file) => `\`${file}\``).join("、") : "由 secret scan 定位的配置文件"} 中的嵌入式凭据：轮换所有已暴露值，把已跟踪明文替换为仓库批准的密钥存储引用，并只更新直接受影响的自动化配置；如果 Git 历史中仍可复用该凭据，按项目现有历史清理策略处理。\n\n## 验证\n\n- 重新运行仓库 secret scan，确认引用的高置信 finding 已消失\n- 使用测试凭据运行受影响自动化或配置的最小检查\n- 确认已跟踪文件和生成补丁中都不再包含轮换后的值`),
    });
  }

  const practiceCoverageRows = [
    practiceCoverageRow("Rules", guidance),
    practiceCoverageRow("Skills", skills),
    practiceCoverageRow("Hooks", [...actualHooks, ...hookAssets]),
    practiceCoverageRow("Commands", commands),
    practiceCoverageRow("Custom Agents", agents),
    practiceCoverageRow("MCP", mcpAssets),
    practiceCoverageRow("Workflows", workflows),
    practiceCoverageRow("Plugins", pluginAssets),
    practiceCoverageRow("Memories", memories),
  ].filter(Boolean);
  const learningCaptureEvidence = buildLearningCaptureEvidence({
    trackedFiles: files,
    fileContents,
    insights,
    gitHistory,
  });

  return {
    dimensions,
    subdimensions,
    findings,
    aiAgentPractice: {
      coverageRows: practiceCoverageRows,
    },
    learningCaptureEvidence,
  };
}

export function scanTaskLoopRepositoryEvidence({ workspace, insights = {}, secretScan = {}, locale = "en" } = {}) {
  const root = path.resolve(workspace);
  const trackedFiles = listTrackedFiles(root);
  let packageManifest = {};
  const fileContents = {};
  if (trackedFiles.map(posix).includes("package.json")) {
    try {
      packageManifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    } catch {
      packageManifest = {};
    }
  }
  for (const file of trackedFiles) {
    if (!/(^|\/)(?:AGENTS|CLAUDE|DESIGN)\.md$|(^|\/)\.github\/copilot-instructions\.md$|(^|\/)(?:\.qoder|\.codex|\.cursor)\/rules(?:\/|$)|(^|\/)(?:(?:\.qoder|\.agents|\.codex|\.cursor|\.claude|\.github|\.qoder-plugin|\.codex-plugin)\/skills\/|skills\/)[^/]+\/SKILL\.md$|(^|\/)(?:(?:docs|\.qoder|\.agents|\.codex|\.cursor)\/(?:specs?|adrs?|rfcs?)\/|(?:specs?|adrs?|rfcs?)\/)[^/]+\.md$|(^|\/)docs\/[^/]*(?:design|decision)[^/]*\.md$|(^|\/)(?:\.qoder-plugin|\.codex-plugin)\/plugin\.json$|(^|\/)(?:\.github\/workflows\/|\.gitlab-ci\.ya?ml$|\.circleci\/|Jenkinsfile$|azure-pipelines\.ya?ml$|\.aoneci\/)/i.test(posix(file))) continue;
    try {
      fileContents[file] = readFileSync(path.join(root, file), "utf8").slice(0, 256_000);
    } catch {
      // The inventory remains useful when an optional guidance file cannot be read.
    }
  }
  const gitHistory = collectBoundedGitHistory(root);
  return buildTaskLoopRepositoryEvidence({ trackedFiles, packageManifest, fileContents, insights, secretScan, gitHistory, locale });
}
