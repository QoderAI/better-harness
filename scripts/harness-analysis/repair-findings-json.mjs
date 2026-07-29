#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasSyntheticEvidenceAlias } from "./ai-fix-prompt.mjs";
import { isAgentWorkLoopReport } from "./fluency-dimensions.mjs";

const VALID_RISK_LABELS = new Set(["High", "Medium", "Low"]);
const VALID_AGENT_SURFACES = new Set([
  "Rules",
  "Hooks",
  "Skills",
  "Commands",
  "Custom Agents",
  "MCP",
  "Workflows",
  "Plugins",
  "Session Insights",
  "Memories",
]);
const VALID_AGENT_PRACTICE_SCOPES = new Set(["Project", "Global", "Plugin"]);

const RISK_LABEL_MAP = new Map([
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
  ["critical", "High"],
  ["blocker", "High"],
  ["severe", "High"],
  ["高", "High"],
  ["中", "Medium"],
  ["低", "Low"],
]);

const SURFACE_MAP = new Map([
  ["rules", "Rules"],
  ["rule", "Rules"],
  ["agents.md", "Rules"],
  ["claude.md", "Rules"],
  ["github copilot instructions", "Rules"],
  ["skills", "Skills"],
  ["skill", "Skills"],
  ["project skills", "Skills"],
  ["hooks", "Hooks"],
  ["hook", "Hooks"],
  ["user hooks", "Hooks"],
  ["commands", "Commands"],
  ["command", "Commands"],
  ["custom agents", "Custom Agents"],
  ["custom agent", "Custom Agents"],
  ["subagents", "Custom Agents"],
  ["subagent", "Custom Agents"],
  ["mcp", "MCP"],
  ["mcp tools", "MCP"],
  ["workflows", "Workflows"],
  ["workflow", "Workflows"],
  ["plugins", "Plugins"],
  ["plugin", "Plugins"],
  ["session insights", "Session Insights"],
  ["sessions", "Session Insights"],
  ["session analysis", "Session Insights"],
  ["memories", "Memories"],
  ["memory", "Memories"],
]);

const PATH_CANDIDATE_RE = /(?:\/[A-Za-z0-9._~-][A-Za-z0-9._~+@!/*{}-]*|[A-Za-z]:\\[^\s"'`,;]+|\.?[\w.-]+\/[\w./*{}@!-]+|(?:AGENTS|CLAUDE|README)(?:\.md)?|(?:Makefile|Dockerfile)|[\w.-]+\.(?:md|markdown|json|ya?ml|toml|go|mod|sum|js|jsx|ts|tsx|mjs|cjs|py|java|kt|kts|rs|rb|php|c|cc|cpp|h|hpp|cs))/gi;
const VALIDATION_COMMAND_RE = /\b(?:npm|node|go test|make|pytest|cargo test|task test|golangci-lint|govulncheck|gradle|\.\/gradlew|mage)\b[^\n。；;]*/i;
const AI_FIX_REPAIR_COMMAND_RE = /^\/better-harness\s+(?:fix\s+this\s+issue|修复这个问题)\b/i;
const AI_FIX_SCHEDULE_COMMAND_RE = /^\/schedule\b/i;
const AI_FIX_VALIDATION_SECTION_RE = /(?:^|\n)##\s*(?:Validation\b|验证)(?:\s|$)/i;
const AI_FIX_SCOPE_RE = /(?:Limit the change to|Keep the change limited to|Scope\s*[:：]|范围\s*[:：]|将改动限制在|只修改|仅修改)/i;
const INVALID_AI_FIX_SCOPE_RE = /(?:Limit the change to|Keep the change limited to)\s+(?:\/[\u3400-\u9fff]|\/、|GitHub\/GitLab\/?|JavaScript\/Node\b|\/Why\b|\/签名前|[^.\n]{80,}?(?:，|。|请|and the directly related files))/i;
const REPORT_VALIDATOR_COMMAND_RE = /scripts\/harness-analysis\/validate-canvas\.mjs/i;
const AI_FIX_SLOT_ASSIGNMENT_RE = /\b(?:target|finding|reason|evidence|request|requested_fix|acceptance(?:_check)?|validation(?:_command)?|risk(?:_boundary)?|safety(?:_note)?|stop(?:_condition)?)=/gi;
const SUMMARY_OUTPUT_FIELDS = new Set([
  "projectName",
  "modelId",
  "overview",
  "strengths",
  "dimensions",
  "aiAgentPractice",
]);

function safePracticePathForSurface(surface, value) {
  const candidate = String(value ?? "").trim().replaceAll("\\", "/");
  const isSafe = candidate
    && !candidate.startsWith("/")
    && !/^[A-Za-z]:\//.test(candidate)
    && !candidate.split("/").includes("..");
  if (!isSafe) return false;
  if (String(surface ?? "") !== "Memories") return true;
  return !candidate.startsWith("~/") && /(?:^|\/)MEMORY\.md$/u.test(candidate);
}
const DIMENSION_OUTPUT_FIELDS = new Set([
  "id",
  "label",
  "score",
  "summary",
  "findingRefs",
]);
const AI_AGENT_PRACTICE_OUTPUT_FIELDS = new Set([
  "inspectedSurfaces",
  "coverageRows",
]);
const AI_AGENT_PRACTICE_ROW_OUTPUT_FIELDS = new Set([
  "surface",
  "scopes",
  "count",
  "paths",
]);
const GENERATED_FINDING_FIELDS = new Set([
  "id",
  "title",
  "severity",
  "reason",
  "aiFixPrompt",
  "dimensionRefs",
]);
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asString(value) {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean).join("; ");
  if (value && typeof value === "object") return Object.values(value).map(asString).filter(Boolean).join("; ");
  return String(value ?? "").trim();
}

function addChange(changes, pathName, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  changes.push({ path: pathName, before, after });
}

function normalizeRiskLabel(value) {
  const text = String(value ?? "").trim();
  if (VALID_RISK_LABELS.has(text)) return text;
  return RISK_LABEL_MAP.get(text.toLowerCase()) ?? text;
}

function normalizeSurface(value) {
  const text = String(value ?? "").trim();
  if (VALID_AGENT_SURFACES.has(text)) return text;
  const lower = text.toLowerCase().replace(/\s*\(.+?\)\s*/g, "").trim();
  if (SURFACE_MAP.has(lower)) return SURFACE_MAP.get(lower);
  for (const [pattern, surface] of SURFACE_MAP.entries()) {
    if (lower.includes(pattern)) return surface;
  }
  return null;
}

function normalizePathCandidate(value) {
  const text = String(value ?? "").trim().replace(/[。.,;；:：)]+$/g, "");
  if (!text || text === "/better-harness" || text === "/schedule") return "";
  if (/^\/|^[A-Za-z]:\\|\.?[\w.-]+\//.test(text)) return text;
  return `./${text}`;
}

function isSafePathCandidate(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 120) return false;
  if (/[\u3400-\u9fff，。；]/.test(text)) return false;
  if (/^(?:\.\/)?(?:GitHub|GitLab|Aone|Jenkins|CircleCI|JavaScript|Node|Kotlin|Android)(?:\/|$)/i.test(text)) return false;
  if (/^(?:\.\/)?(?:gradlew|gradle|npm|node|go|make|mage|pytest|cargo)(?:\s|$)/i.test(text)) return false;
  if (/^(?:\.\/)?[A-Z][A-Za-z]+\/[A-Z][A-Za-z]+\/?$/.test(text)) return false;
  if (/\/$/.test(text) && !/[*.{}]/.test(text) && !/^(?:\.{1,2}|\/(?:Users|tmp|var|opt|home|workspace))\//.test(text)) return false;
  return true;
}

function firstPathCandidate(...values) {
  for (const value of values) {
    const text = asString(value);
    for (const match of text.matchAll(PATH_CANDIDATE_RE)) {
      const candidate = normalizePathCandidate(match[0]);
      if (candidate && isSafePathCandidate(candidate)) return candidate;
    }
  }
  return "";
}

function hasScopeToken(text) {
  return AI_FIX_SCOPE_RE.test(String(text ?? ""));
}

function findingUsesChinese(finding) {
  return /[\u3400-\u9fff]/.test(`${asString(finding?.title)}\n${asString(finding?.reason)}`);
}

function validationCommandFor(finding) {
  const explicit = asString(finding?.validationCommand);
  if (explicit && !REPORT_VALIDATOR_COMMAND_RE.test(explicit)) return explicit;
  const refs = new Set(Array.isArray(finding?.dimensionRefs) ? finding.dimensionRefs : []);
  const chinese = findingUsesChinese(finding);
  if (refs.has("fast-feedback")) return chinese ? "新增或更新后的快速检查，并运行最小相关既有测试" : "the new or updated fast check, plus the smallest related existing test";
  if (refs.has("quality-gates")) return chinese ? "新增或更新后的门禁；可行时确认一个故意违规样例会失败" : "the new or updated gate locally; if practical, confirm a deliberate violation fails";
  if (refs.has("environment-readiness")) return chinese ? "受影响的 setup、doctor、reset 或 build 入口" : "the affected setup, doctor, reset, or build entrypoint";
  if (refs.has("safe-change")) return chinese ? "受影响的 hook、CI/评审、权限或发布 dry-run 路径，并确认不安全路径会被拦截或要求证据" : "the affected hook, CI/review, permission, or release dry-run path and confirm the unsafe path is blocked or requires evidence";
  if (refs.has("context-map")) return chinese ? "变更后的文档链接或任务路由校验" : "the doc-link or route validation for the changed guidance";
  return chinese ? "能够证明该问题已修复的最小项目检查" : "the smallest project check that proves this finding is fixed";
}

function targetPathFor(finding, options) {
  const target = firstPathCandidate(
    finding?.target,
    finding?.path,
    finding?.file,
    finding?.files,
    finding?.paths,
  );
  if (target) return target;
  const fallback = normalizePathCandidate(options.targetPath || "");
  return isSafePathCandidate(fallback) ? fallback : "";
}

function mechanismScopeFor(finding) {
  const refs = new Set(Array.isArray(finding?.dimensionRefs) ? finding.dimensionRefs : []);
  const chinese = findingUsesChinese(finding);
  if (refs.has("fast-feedback")) return chinese ? "负责快速反馈的 lint、测试或 smoke 检查面" : "the smallest lint, test, or smoke-check surface that proves this change";
  if (refs.has("quality-gates")) return chinese ? "负责该规则的 lint、安全扫描、架构或契约检查面" : "the lint, security-scan, schema, architecture, or contract-check surface that owns this rule";
  if (refs.has("environment-readiness")) return chinese ? "负责 setup、run、reset 或 doctor 的入口" : "the setup, run, reset, or doctor entrypoint that owns this gap";
  if (refs.has("safe-change")) return chinese ? "负责 hook、CI/评审、权限或发布安全边界的配置" : "the hook, CI/review, permission, or release-safety surface that owns this acceptance gap";
  if (refs.has("context-map")) return chinese ? "负责该工作流的项目指引或路由说明" : "the project guidance or route map that owns the named workflow";
  return chinese ? "负责该问题的文件或机制" : "the files or mechanism that own this finding";
}

function scopeFor(finding, options) {
  const target = targetPathFor(finding, options);
  if (target && isSafePathCandidate(target)) return `${target} and directly related files`;
  return mechanismScopeFor(finding);
}

function cleanReaderCopy(value) {
  const text = String(value ?? "");
  const oldMergeJargon = `${"base"}-${"bound"}`;
  const chinese = /[\u3400-\u9fff]/.test(text);
  const acceptance = chinese ? "合并前验收路径" : "merge acceptance path";
  const validation = chinese ? "合并前验证" : "pre-merge validation";
  return text
    .replace(new RegExp(`${oldMergeJargon} acceptance`, "gi"), acceptance)
    .replace(new RegExp(`${oldMergeJargon} validation`, "gi"), validation)
    .replace(new RegExp(`\\s*${oldMergeJargon}\\s*接受路径`, "gi"), acceptance)
    .replace(new RegExp(oldMergeJargon, "gi"), acceptance);
}

function promptHasInvalidScope(prompt) {
  return INVALID_AI_FIX_SCOPE_RE.test(String(prompt ?? ""));
}

function promptUsesReportValidatorAsProjectValidation(prompt, finding) {
  if (!REPORT_VALIDATOR_COMMAND_RE.test(String(prompt ?? ""))) return false;
  const text = `${asString(finding?.title)}\n${asString(finding?.reason)}`;
  return !/\b(?:findings\.json|insights\.canvas|canvas|report artifact|generated report|报告产物|生成报告)\b/i.test(text);
}

function repairPromptMissingRequirements(finding) {
  const prompt = String(finding?.aiFixPrompt ?? "");
  if (!prompt.trim()) return ["prompt"];

  const missing = [];
  if (!AI_FIX_REPAIR_COMMAND_RE.test(prompt)) {
    missing.push("repair command");
  }
  if (!hasScopeToken(prompt) || promptHasInvalidScope(prompt)) {
    missing.push("target scope");
  }
  if (!AI_FIX_VALIDATION_SECTION_RE.test(prompt)) {
    missing.push("validation section");
  }
  if (promptUsesReportValidatorAsProjectValidation(prompt, finding)) {
    missing.push("project validation");
  }
  const slotAssignments = Array.from(prompt.matchAll(AI_FIX_SLOT_ASSIGNMENT_RE));
  if (slotAssignments.length >= 3) {
    missing.push("human-readable prose");
  }
  if (hasSyntheticEvidenceAlias(prompt)) {
    missing.push("reader-readable evidence");
  }
  const body = prompt.replace(AI_FIX_REPAIR_COMMAND_RE, "").replace(AI_FIX_VALIDATION_SECTION_RE, "").trim();
  if (body.length < 80) {
    missing.push("problem scope and expected change");
  }
  return missing;
}

function promptMissingRequirements(finding) {
  const text = String(finding?.aiFixPrompt ?? "");
  if (AI_FIX_REPAIR_COMMAND_RE.test(text) || /^\/better-harness\b/i.test(text)) {
    return repairPromptMissingRequirements(finding);
  }

  if (AI_FIX_SCHEDULE_COMMAND_RE.test(text)) {
    const missing = [];
    if (!/\/better-harness\b/i.test(text)) missing.push("/better-harness follow-up");
    if (!/cadence|trigger|weekly|daily|monthly|schedule|recurring|每周|每日|每月|周期|触发|定期/i.test(text)) {
      missing.push("cadence or trigger");
    }
    if (!/stop[_ -]?condition|stop when|until score|停止条件|直到|连续两次|after (?:four|\d+) runs?/i.test(text)) {
      missing.push("stop condition");
    }
    return missing;
  }

  return ["prompt command"];
}

function buildAiFixPrompt(finding, options) {
  const title = asString(finding?.title) || asString(finding?.id) || "Harness finding";
  const reason = asString(finding?.reason) || "The finding needs a scoped fix based on the reviewed harness report.";
  const validation = validationCommandFor(finding);
  const scope = scopeFor(finding, options);
  const chinese = findingUsesChinese(finding);
  const schedulePrompt = /^\/schedule\b/i.test(asString(finding?.aiFixPrompt));
  if (schedulePrompt) {
    return `/schedule create a recurring /better-harness follow-up for ${scope}. Recheck "${title}" weekly until the related score improves or the finding is absent for two consecutive runs. Use ${validation} as the validation path and stop after four runs if the blocker is unchanged.`;
  }

  const scopeLine = chinese
    ? `将改动限制在${scope}。不要修改无关源码或生成报告产物。`
    : `Keep the change limited to ${scope}. Do not edit unrelated source files or generated report artifacts.`;
  const confirmLine = chinese
    ? "确认该问题已解决，并且没有引入无关改动"
    : "Confirm the finding is resolved without introducing unrelated changes";
  const runLine = chinese ? `运行${validation}` : `Run ${validation}`;

  return `/better-harness fix this issue

${title}: ${reason}

${scopeLine}

## Validation

- ${runLine}
- ${confirmLine}`;
}

function normalizeAiAgentPractice(summary, findings, changes) {
  const practice = summary?.aiAgentPractice;
  const findingIds = new Set(findings.map((finding) => String(finding?.id ?? "")).filter(Boolean));
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return;
  if (!practice || typeof practice !== "object" || Array.isArray(practice)) {
    const fallback = {
      inspectedSurfaces: ["Rules"],
      coverageRows: [{
        surface: "Rules",
        scopes: ["Project"],
      }],
    };
    addChange(changes, "summary.aiAgentPractice", practice, fallback);
    summary.aiAgentPractice = fallback;
    return;
  }

  const rowOutputFields = AI_AGENT_PRACTICE_ROW_OUTPUT_FIELDS;

  if (Array.isArray(practice.inspectedSurfaces)) {
    const before = practice.inspectedSurfaces;
    practice.inspectedSurfaces = [...new Set(before.map(normalizeSurface).filter(Boolean))];
    addChange(changes, "summary.aiAgentPractice.inspectedSurfaces", before, practice.inspectedSurfaces);
  }

  if (Array.isArray(practice.coverageRows)) {
    for (const [index, row] of practice.coverageRows.entries()) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const surface = normalizeSurface(row.surface);
      if (surface && surface !== row.surface) {
        addChange(changes, `summary.aiAgentPractice.coverageRows[${index}].surface`, row.surface, surface);
        row.surface = surface;
      }
      if (row.count !== undefined) {
        const count = Number(row.count);
        if (!Number.isInteger(count) || count < 0) {
          addChange(changes, `summary.aiAgentPractice.coverageRows[${index}].count`, row.count, undefined);
          delete row.count;
        } else if (count !== row.count) {
          addChange(changes, `summary.aiAgentPractice.coverageRows[${index}].count`, row.count, count);
          row.count = count;
        }
      }
      if (row.scopes !== undefined) {
        const before = row.scopes;
        const scopes = Array.isArray(before)
          ? [...new Set(before.map((value) => String(value ?? "").trim()).filter((value) => VALID_AGENT_PRACTICE_SCOPES.has(value)))]
          : [];
        if (scopes.length > 0) row.scopes = scopes;
        else delete row.scopes;
        addChange(changes, `summary.aiAgentPractice.coverageRows[${index}].scopes`, before, row.scopes);
      }
      if (row.paths !== undefined) {
        const before = row.paths;
        const paths = Array.isArray(before)
          ? [...new Set(
            before
              .map((value) => String(value ?? "").trim().replaceAll("\\", "/"))
              .filter((value) => safePracticePathForSurface(row.surface, value)),
          )].slice(0, 12)
          : [];
        if (paths.length > 0) row.paths = paths;
        else delete row.paths;
        addChange(changes, `summary.aiAgentPractice.coverageRows[${index}].paths`, before, row.paths);
      }
      for (const field of Object.keys(row)) {
        if (rowOutputFields.has(field)) continue;
        addChange(changes, `summary.aiAgentPractice.coverageRows[${index}].${field}`, row[field], undefined);
        delete row[field];
      }
    }
  }

  for (const field of Object.keys(practice)) {
    if (AI_AGENT_PRACTICE_OUTPUT_FIELDS.has(field)) continue;
    addChange(changes, `summary.aiAgentPractice.${field}`, practice[field], undefined);
    delete practice[field];
  }
}

function normalizeDimensions(summary, findings, changes) {
  if (!Array.isArray(summary?.dimensions)) return;
  const dimensionsById = new Map(summary.dimensions.map((dimension) => [dimension?.id, dimension]).filter(([id]) => id));
  const existingIds = new Set(findings.map((finding) => String(finding?.id ?? "")).filter(Boolean));
  for (const finding of findings) {
    if (!finding?.id || !Array.isArray(finding.dimensionRefs)) continue;
    for (const refId of finding.dimensionRefs) {
      const dimension = dimensionsById.get(refId);
      if (!dimension) continue;
      const before = Array.isArray(dimension.findingRefs) ? [...dimension.findingRefs] : [];
      const next = [...new Set([...before, finding.id])];
      if (next.length !== before.length) {
        dimension.findingRefs = next;
        addChange(changes, `summary.dimensions[${refId}].findingRefs`, before, next);
      }
    }
  }

  for (const [index, dimension] of summary.dimensions.entries()) {
    if (!dimension?.id) continue;
    const before = Array.isArray(dimension.findingRefs) ? [...dimension.findingRefs] : [];
    const validRefs = before.filter((ref) => existingIds.has(String(ref)));
    if (validRefs.length !== before.length) {
      dimension.findingRefs = validRefs;
      addChange(changes, `summary.dimensions[${index}].findingRefs`, before, validRefs);
    }
    if (validRefs.length > 0) continue;
    const candidate = findings.find((finding) => Array.isArray(finding?.dimensionRefs)
      && finding.dimensionRefs.includes(dimension.id)
      && finding.id);
    if (candidate) {
      dimension.findingRefs = [candidate.id];
      addChange(changes, `summary.dimensions[${index}].findingRefs`, before, dimension.findingRefs);
      continue;
    }
  }
}

function normalizeSummary(summary, changes) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return;

  for (const field of Object.keys(summary)) {
    if (SUMMARY_OUTPUT_FIELDS.has(field)) continue;
    addChange(changes, `summary.${field}`, summary[field], undefined);
    delete summary[field];
  }

  if (Array.isArray(summary.dimensions)) {
    for (const [index, dimension] of summary.dimensions.entries()) {
      if (!dimension || typeof dimension !== "object" || Array.isArray(dimension)) continue;
      for (const field of Object.keys(dimension)) {
        if (DIMENSION_OUTPUT_FIELDS.has(field)) continue;
        addChange(changes, `summary.dimensions[${index}].${field}`, dimension[field], undefined);
        delete dimension[field];
      }
    }
  }
}

function normalizeFindings(findings, changes, options) {
  for (const [index, finding] of findings.entries()) {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) continue;

    for (const field of ["title", "reason", "aiFixPrompt"]) {
      if (typeof finding[field] !== "string") continue;
      const cleaned = cleanReaderCopy(finding[field]);
      if (cleaned !== finding[field]) {
        addChange(changes, `findings[${index}].${field}`, finding[field], cleaned);
        finding[field] = cleaned;
      }
    }

    const severity = normalizeRiskLabel(finding.severity);
    if (severity !== finding.severity) {
      addChange(changes, `findings[${index}].severity`, finding.severity, severity);
      finding.severity = severity;
    }

    const missing = promptMissingRequirements(finding);
    if (missing.length > 0) {
      const prompt = buildAiFixPrompt(finding, options);
      addChange(changes, `findings[${index}].aiFixPrompt`, finding.aiFixPrompt, prompt);
      finding.aiFixPrompt = prompt;
    }

    for (const field of Object.keys(finding)) {
      if (GENERATED_FINDING_FIELDS.has(field)) continue;
      addChange(changes, `findings[${index}].${field}`, finding[field], undefined);
      delete finding[field];
    }
  }
}

export function repairFindingsJsonData(input, options = {}) {
  const data = clone(input);
  if (isAgentWorkLoopReport(data)) {
    // Task-loop reader contracts are deterministic and carry evidence bridges
    // that the legacy repairer must never strip or rewrite.
    return { data, changes: [], changed: false };
  }
  const changes = [];
  const findings = Array.isArray(data?.findings) ? data.findings : [];

  normalizeSummary(data?.summary, changes);
  normalizeAiAgentPractice(data?.summary, findings, changes);
  normalizeFindings(findings, changes, options);
  normalizeDimensions(data?.summary, findings, changes);

  return {
    data,
    changes,
    changed: changes.length > 0,
  };
}

function parseArgs(argv) {
  const args = { write: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--write") {
      args.write = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--findings") {
      args.findingsPath = argv[++index];
    } else if (arg === "--target") {
      args.targetPath = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

const HELP = `Usage: node scripts/harness-analysis/repair-findings-json.mjs --findings <findings.json> [--write] [--target <path>] [--json]

Deterministically normalize common findings.json schema drift for Better Harness reports.

Options:
  --findings <file>  findings.json to normalize
  --write            overwrite the findings file
  --target <path>    target project path used when a finding has no concrete path
  --json             emit a repair summary instead of the repaired findings content
  -h, --help         print this help
`;

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!args.findingsPath) throw new Error("--findings is required");

  const findingsPath = path.resolve(args.findingsPath);
  const input = JSON.parse(readFileSync(findingsPath, "utf8"));
  const result = repairFindingsJsonData(input, { targetPath: args.targetPath });
  const repairedText = `${JSON.stringify(result.data, null, 2)}\n`;
  if (args.write) {
    await writeFile(findingsPath, repairedText);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify({
      kind: "harness-findings-json-repair",
      status: "pass",
      findingsPath,
      write: args.write,
      changed: result.changed,
      changeCount: result.changes.length,
      changes: result.changes,
    }, null, 2)}\n`);
  } else if (!args.write) {
    process.stdout.write(repairedText);
  } else {
    process.stdout.write(`harness-findings-json-repair: ${result.changed ? "changed" : "unchanged"} (${result.changes.length} changes)\n`);
  }
  return 0;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exit(1);
  });
}
