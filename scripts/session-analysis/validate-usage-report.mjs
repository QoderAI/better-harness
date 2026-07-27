#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPORT_CONTRACTS = Object.freeze({
  "zh-CN": Object.freeze({
    locale: "zh-CN",
    title: "# Qoder 会话使用效率报告",
    projectPrefix: "项目：",
    scope: "范围：workspace-only",
    headings: Object.freeze({
      conclusion: "## 结论",
      coverage: "## 覆盖与计费口径",
      problems: "## 关键问题",
      longSessions: "## 长会话",
      models: "## 模型与结果",
      boundary: "## 证据边界",
    }),
    coverageLabels: Object.freeze({
      analyzed: "分析会话：",
      activeLong: "活跃长会话：",
      wallOnly: "仅墙钟长会话：",
      reviewedActiveLong: "语义复核长会话：",
      accounting: "计费口径：",
      responses: "模型响应：",
      nonZeroUsage: "非零 usage：",
      actualCost: "实际成本：",
      pricingVersion: "价格版本：",
    }),
    problemHeadingSeparator: "：",
    problemLabels: Object.freeze(["范围：", "置信度：", "证据：", "影响：", "行动：", "节省口径："]),
    partialReviewBoundary: "未复核长会话不推断任务族或结果",
    candidateModelPrefix: "候选模型：",
  }),
  en: Object.freeze({
    locale: "en",
    title: "# Qoder Session Usage Efficiency Report",
    projectPrefix: "Project: ",
    scope: "Scope: workspace-only",
    headings: Object.freeze({
      conclusion: "## Conclusion",
      coverage: "## Coverage and Accounting",
      problems: "## Key Problems",
      longSessions: "## Long Sessions",
      models: "## Models and Outcomes",
      boundary: "## Evidence Boundary",
    }),
    coverageLabels: Object.freeze({
      analyzed: "Analyzed sessions: ",
      activeLong: "Active long sessions: ",
      wallOnly: "Wall-only long sessions: ",
      reviewedActiveLong: "Reviewed active-long sessions: ",
      accounting: "Accounting mode: ",
      responses: "Model responses: ",
      nonZeroUsage: "Non-zero usage: ",
      actualCost: "Actual cost: ",
      pricingVersion: "Pricing version: ",
    }),
    problemHeadingSeparator: ": ",
    problemLabels: Object.freeze(["Scope: ", "Confidence: ", "Evidence: ", "Impact: ", "Action: ", "Savings basis: "]),
    partialReviewBoundary: "Unreviewed long sessions do not support task family or outcome claims",
    candidateModelPrefix: "Candidate model: ",
  }),
});

const TEMPLATE_PLACEHOLDERS = Object.freeze([
  "basename-only",
  "conclusion",
  "analyzed",
  "eligible",
  "count",
  "reviewed-active-long",
  "active-long",
  "exact|host-estimated|effort-proxy",
  "nonzero",
  "responses",
  "amount",
  "currency",
  "version",
  "problem",
  "scope",
  "confidence",
  "evidence",
  "impact",
  "action",
  "savings-mode",
  "long-session analysis",
  "model",
  "evidence boundary",
]);

function normalizeTemplateLocale(locale) {
  const value = String(locale ?? "").trim();
  if (/^zh(?:-cn)?$/iu.test(value)) return "zh-CN";
  if (/^en(?:-|$)/iu.test(value)) return "en";
  throw new Error(`unsupported usage report template locale: ${locale}; expected en or zh-CN`);
}

function reportContract(report) {
  return Object.values(REPORT_CONTRACTS).find((contract) => report.startsWith(contract.title))
    ?? REPORT_CONTRACTS["zh-CN"];
}

export function usageReportTemplate(locale) {
  const contract = REPORT_CONTRACTS[normalizeTemplateLocale(locale)];
  const coverage = contract.coverageLabels;
  const problems = contract.problemLabels;
  return `${contract.title}

${contract.projectPrefix}<basename-only>
${contract.scope}

${contract.headings.conclusion}

<conclusion>

${contract.headings.coverage}

${coverage.analyzed}<analyzed>/<eligible>
${coverage.activeLong}<count>
${coverage.wallOnly}<count>
${coverage.reviewedActiveLong}<reviewed-active-long>/<active-long>
${coverage.accounting}<exact|host-estimated|effort-proxy>
${coverage.responses}<count>
${coverage.nonZeroUsage}<nonzero>/<responses>
${contract.partialReviewBoundary}
${coverage.actualCost}<amount> <currency>
${coverage.pricingVersion}<version>

${contract.headings.problems}

### P1${contract.problemHeadingSeparator}<problem>
${problems[0]}<scope>
${problems[1]}<confidence>
${problems[2]}<evidence>
${problems[3]}<impact>
${problems[4]}<action>
${problems[5]}<savings-mode>

${contract.headings.longSessions}

<long-session analysis>

${contract.headings.models}

${contract.candidateModelPrefix}<model>

${contract.headings.boundary}

<evidence boundary>
`;
}

export function validateUsageReport({ source, report }) {
  const errors = [];
  const usage = source?.insights?.keySignals?.usageEfficiency ?? source?.usageEfficiency ?? null;
  const selection = source?.selection ?? source?.insights?.manifest?.selection ?? {};
  if (!usage) return ["source is missing insights.keySignals.usageEfficiency"];

  const contract = reportContract(report);
  const requiredHeadings = Object.values(contract.headings);
  const projectName = path.basename(source?.scope?.workspace ?? source?.insights?.scope?.workspace ?? "");
  if (!report.startsWith(contract.title)) errors.push("report must start with a supported canonical title");
  for (const heading of requiredHeadings) {
    if (!report.includes(heading)) errors.push(`report is missing heading: ${heading}`);
  }
  if (projectName && !report.includes(`${contract.projectPrefix}${projectName}`)) {
    errors.push(`report must include project marker: ${contract.projectPrefix}${projectName}`);
  }
  if (!report.includes(contract.scope)) {
    errors.push(`report must declare ${contract.scope}`);
  }
  for (const placeholder of TEMPLATE_PLACEHOLDERS) {
    if (report.includes(`<${placeholder}>`)) {
      errors.push(`report must replace or remove template placeholder: <${placeholder}>`);
    }
  }

  const eligible = Number(selection.eligibleCount ?? usage.coverage?.analyzedSessionCount ?? 0);
  const analyzed = Number(selection.analyzedCount ?? usage.coverage?.analyzedSessionCount ?? 0);
  const responseCount = Number(usage.coverage?.responseCount ?? 0);
  const nonZeroUsageCount = Number(usage.coverage?.nonZeroUsageCount ?? 0);
  const longActiveCount = Number(usage.longSessions?.longActiveCount ?? 0);
  const reviewedLongCount = Number.isInteger(usage.outcomeReview?.reviewedActiveLongCount)
    ? Math.min(longActiveCount, usage.outcomeReview.reviewedActiveLongCount)
    : (usage.candidates ?? []).filter((candidate) =>
      Array.isArray(candidate?.candidateReasons) && candidate.candidateReasons.includes("active-long")
    ).length;
  const coverage = contract.coverageLabels;
  const markers = [
    `${coverage.analyzed}${analyzed}/${eligible}`,
    `${coverage.activeLong}${longActiveCount}`,
    `${coverage.wallOnly}${Number(usage.longSessions?.wallOnlyCount ?? 0)}`,
    `${coverage.reviewedActiveLong}${reviewedLongCount}/${longActiveCount}`,
    `${coverage.accounting}${usage.accountingMode}`,
    `${coverage.responses}${responseCount}`,
    `${coverage.nonZeroUsage}${nonZeroUsageCount}/${responseCount}`,
  ];
  const coverageStart = report.indexOf(contract.headings.coverage);
  const coverageTail = coverageStart >= 0
    ? report.slice(coverageStart + contract.headings.coverage.length)
    : "";
  const coverageSection = coverageTail.split(/\n##\s/u, 1)[0] ?? "";
  for (const marker of markers) {
    if (!coverageSection.includes(marker)) errors.push(`coverage section must include source marker: ${marker}`);
  }
  const hasPartialReviewBoundary = report.includes(contract.partialReviewBoundary);
  if (reviewedLongCount < longActiveCount && !hasPartialReviewBoundary) {
    errors.push("partial long-session review must limit task-family and outcome claims to reviewed aliases");
  }
  if (reviewedLongCount >= longActiveCount && hasPartialReviewBoundary) {
    errors.push("complete long-session review must remove the partial-review boundary");
  }

  const problemCount = [...report.matchAll(/^### P[1-3](?:\s|：|:)/gmu)].length;
  if (problemCount < 1 || problemCount > 3) errors.push("report must contain one to three canonical P1-P3 problem headings");
  const problemSections = report.split(/\n(?=### P[1-3](?:\s|：|:)|##\s)/u).filter((section) => /^### P[1-3](?:\s|：|:)/u.test(section));
  for (const [index, section] of problemSections.entries()) {
    for (const marker of contract.problemLabels) {
      if (!section.includes(marker)) errors.push(`problem P${index + 1} must include ${marker}`);
    }
  }
  if (report.split(/\r?\n/u).length > 160) errors.push("report must stay within 160 lines");

  if (usage.accountingMode === "effort-proxy") {
    if (!saysExactTokenUsageUnavailable(report)) {
      errors.push("effort-proxy report must say exact token/credits are unavailable");
    }
    if (claimsExactSavings(report)) {
      errors.push("effort-proxy report must not claim exact token, credit, or currency savings");
    }
  }
  if (usage.accountingMode === "exact") {
    const cost = usage.actualCost;
    if (!cost?.available || !cost.pricingVersion || !cost.currency || !Number.isFinite(Number(cost.amount))) {
      errors.push("exact accounting requires source actualCost with amount, currency, and pricingVersion");
    } else {
      for (const marker of [
        `${coverage.actualCost}${cost.amount} ${cost.currency}`,
        `${coverage.pricingVersion}${cost.pricingVersion}`,
      ]) {
        if (!coverageSection.includes(marker)) errors.push(`coverage section must include source marker: ${marker}`);
      }
    }
  } else {
    for (const marker of [coverage.actualCost, coverage.pricingVersion]) {
      if (coverageSection.includes(marker)) {
        errors.push(`non-exact accounting must remove inapplicable coverage marker: ${marker}`);
      }
    }
  }
  if (usage.coverage?.exactCreditsAvailable !== true) {
    if (!saysExactCreditsUnavailable(report)) {
      errors.push("report must say exact credits are unavailable when no credit table exists");
    }
    if (claimsExactSavings(report)) {
      errors.push("report must not claim exact credit or currency savings without a credit table");
    }
  }

  if (usage.outcomeReview?.comparableModelOutcomeEvidence !== true) {
    if (!recommendsControlledModelAB(report)) {
      errors.push("report must recommend a controlled model A/B when comparable outcome evidence is unavailable");
    }
    if (hasUnsupportedModelCausation(report)) {
      errors.push("report must not claim model causation without comparable outcome evidence");
    }
    if (report.includes(contract.candidateModelPrefix)) {
      errors.push("report must not name a candidate model without comparable outcome evidence");
    }
  }
  if (usage.outcomeReview?.comparableModelOutcomeEvidence === true) {
    const models = (usage.outcomeReview.comparisons ?? []).map((row) => row.candidateModel).filter(Boolean);
    if (models.length === 0) errors.push("comparable model evidence requires at least one candidateModel");
    for (const model of models) {
      const marker = `${contract.candidateModelPrefix}${model}`;
      if (!report.includes(marker)) errors.push(`model section must include source candidate: ${marker}`);
    }
  }

  if (/\/Users\/|[A-Za-z]:\\Users\\|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\btask-[a-z0-9._-]+|\.jsonl\b/iu.test(report)) {
    errors.push("report must not contain absolute user paths, stable session ids, task ids, or transcript filenames");
  }
  return errors;
}

function saysExactTokenUsageUnavailable(report) {
  return /(?:无法|不能)[^\n]{0,16}精确[^\n]{0,16}token(?:\/credits)?|(?:确切|精确)[^\n]{0,16}token[^\n]{0,24}(?:credits?|信用点|信用额度)[^\n]{0,12}(?:不可用|不可得|无法|不能)|token\/credits[^\n]{0,16}(?:无法|不能)|(?:exact\s+)?tokens?[^\n]{0,30}(?:unavailable|not available|unknown|cannot be (?:calculated|determined|measured))/iu.test(report);
}

function saysExactCreditsUnavailable(report) {
  return /(?:credits?|credit|信用点|信用额度)[^\n]{0,24}(?:不可用|不可得|无法计算|不能计算|unavailable|not available|unknown|cannot be (?:calculated|determined))|(?:无法|不能)[^\n]{0,20}(?:credits?|credit|信用点|信用额度)/iu.test(report);
}

function claimsExactSavings(report) {
  return /(?:节省|sav(?:e|es|ed|ing|ings))[^\n]{0,30}(?:\b\d[\d,.]*\s*(?:tokens?|credits?|元|美元)\b|[¥$]\s*\d)/iu.test(report);
}

function recommendsControlledModelAB(report) {
  return /(?:受控|控制变量|同类任务).{0,12}(?:模型\s*)?A\/B|模型\s*A\/B|(?:controlled|same-task)[^\n]{0,20}(?:model\s*)?A\/B|model\s*A\/B/iu.test(report);
}

function hasUnsupportedModelCausation(report) {
  const patterns = [
    /(?:模型|使用\s*\S+\s*模型)[^\n]{0,24}(?:导致|造成|所以失败)|因为[^\n]{0,24}模型[^\n]{0,12}(?:失败|不好)/giu,
    /(?:the\s+)?model[^\n]{0,24}(?:caused?|led to|made)[^\n]{0,16}(?:failure|fail)|fail(?:ed|ure)[^\n]{0,24}because[^\n]{0,16}(?:the\s+)?model/giu,
  ];
  for (const pattern of patterns) {
    for (const match of report.matchAll(pattern)) {
      const context = report.slice(Math.max(0, match.index - 80), Math.min(report.length, match.index + match[0].length + 80));
      if (!/(?:无法判断|不能判断|不归因|不能归因|无法归因|推断[^\n]{0,16}(?:缺乏依据|不成立|不可用)|并非|不是|cannot determine|can't determine|do not attribute|not attributable|cannot infer|no basis|not caused|does not show)/iu.test(context)) return true;
    }
  }
  return false;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    options[value.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options["print-template"]) {
    process.stdout.write(usageReportTemplate(options["print-template"]));
    return;
  }
  if (!options.source || !options.report) {
    throw new Error(
      "usage: validate-usage-report.mjs --source <insights.json> --report <report.md> | --print-template <locale>",
    );
  }
  const source = JSON.parse(await readFile(path.resolve(options.source), "utf8"));
  const report = await readFile(path.resolve(options.report), "utf8");
  const errors = validateUsageReport({ source, report });
  const result = { ok: errors.length === 0, errors };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (errors.length > 0) process.exitCode = 1;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
