#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvasPreviewServer } from "./canvas-preview-server.mjs";
import { analyzeCanvasModuleBoundaries } from "./canvas-module-boundaries.mjs";
import { transformCanvasSource } from "./preview-support/canvas-transform.mjs";
import {
  evaluateHarnessCanvasQuality,
  evaluateHarnessReportQuality,
} from "./report-quality.mjs";
import {
  BETTER_HARNESS_AGENT_FLUENCY_DIMENSION_IDS,
  BETTER_HARNESS_AGENT_FLUENCY_MODEL_ID,
  isAgentWorkLoopReport,
} from "./fluency-dimensions.mjs";
import {
  isFullTaskLoopFindings,
  validateCompactTaskLoopFindings,
  validateTaskLoopCanvasSplit,
  validateTaskLoopFindings,
  validateTaskLoopUsagePair,
} from "./task-loop-report.mjs";
import { hasSyntheticEvidenceAlias } from "./ai-fix-prompt.mjs";
import { findingTargetErrors } from "../workspace-topology/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../..");

const SECTION_LABELS = {
  riskFindings: ["Risk Findings", "风险发现"],
  readinessScorecard: ["Readiness Scorecard", "就绪度记分卡"],
  actionPathways: ["Action Pathways", "行动路径"],
  unverifiedItems: ["Unverified Items", "未验证事项"],
};

const ALLOWED_IMPORTS = new Set(["qoder/canvas", "react", "react/jsx-runtime", "react/jsx-dev-runtime"]);
const FINDINGS_JSON_FILE = "findings.json";
const CANVAS_DATA_FILE = "canvas.json";
const HARNESS_CANVAS_ALLOWED_IMPORTS = new Set([
  "qoder/canvas",
  `./${FINDINGS_JSON_FILE}`,
  `./${CANVAS_DATA_FILE}`,
]);
const NODE_IMPORT_PREFIXES = ["node:", "fs", "path", "os", "child_process", "process", "url", "http", "https"];
const FORBIDDEN_JSX_COMPONENTS = ["Canvas", "Markdown", "Mermaid", "Badge", "Column", "Heading", "Title", "Section"];
const QODER_CANVAS_DECLARATION_RELATIVES = [
  path.join("node_modules", "qoder", "canvas", "index.d.ts"),
  path.join(".canvas-sdk", "qoder", "canvas", "index.d.ts"),
];
const FORBIDDEN_RUNTIME_APIS = [
  ["fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["WebSocket", /\bWebSocket\b/],
  ["readFileSync", /\breadFileSync\s*\(/],
  ["require", /\brequire\s*\(/],
  ["process", /\bprocess\./],
];

function check(id, errors = [], warnings = [], extra = {}) {
  return {
    id,
    status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    errors,
    warnings,
    ...extra,
  };
}

function isTaskLoopFindingsText(text) {
  try {
    return isAgentWorkLoopReport(JSON.parse(text));
  } catch {
    return false;
  }
}

function evaluateTaskLoopCanvasQuality(text) {
  const errors = [];
  if (/reportContractVersion\s*(?:===|!==|==|!=)|schemaVersion\s*(?:===|!==|==|!=)/u.test(text)) {
    errors.push("task-loop Canvas must use payload capabilities instead of version equality gates");
  }
  if (!/row\.expectedOutput/.test(text) || !/Expected Output/.test(text)) {
    errors.push("task-loop Canvas must render the concrete expected output list");
  }
  if (!/row\.reason/.test(text)) {
    errors.push("task-loop Finding Cards must render the row-owned diagnosis");
  }
  if (!/row\.scopes/.test(text) || !/row\.paths/.test(text)) {
    errors.push("task-loop Canvas must preserve Agent capability scopes and safe paths");
  }
  if (!/semanticFacets/.test(text) || !/session-insight:session-usage-efficiency/.test(text)) {
    errors.push("task-loop Canvas must support the optional projected session-usage overview");
  }
  if (!/usageActivity/.test(text)
    || !/<RiskHeatmap\b/.test(text)
    || !/364 \* 86_400_000/.test(text)
    || !/weekCount = 53/.test(text)
    || !/cellSize=\{16\}/.test(text)
    || !/columnWidth=\{16\}/.test(text)
    || !/columnWidth=\{16\}[\s\S]{0,240}\bresponsive\b/.test(text)
    || !/minCellSize=\{8\}/.test(text)
    || !/minGap=\{2\}/.test(text)
    || !/initialScrollPosition="end"/.test(text)
    || !/ariaLabel: taskLoopCopy\(`\$\{dateKey\}: no observed activity`/.test(text)
    || !/ariaLabel: taskLoopCopy\(`\$\{date\}: \$\{formatActivityMinutes\(active\)\}`/.test(text)) {
    errors.push("task-loop Canvas must render the optional daily activity payload as a responsive square-cell 53-week annual matrix, anchored to the latest dates when it still overflows");
  }
  if (!/usageEfficiency/.test(text) || !/activeCount/.test(text) || !/accounting/.test(text) || !/comparableModelOutcomeEvidence/.test(text)) {
    errors.push("task-loop Canvas must render the all-eligible usage, accounting, and model-outcome boundary");
  }
  const longSessionReviewStart = text.indexOf("function TaskLoopLongSessionReview");
  const longSessionReviewEnd = text.indexOf("function TaskLoopProjectUsage", longSessionReviewStart + 1);
  const longSessionReviewBody = longSessionReviewStart >= 0 && longSessionReviewEnd > longSessionReviewStart
    ? text.slice(longSessionReviewStart, longSessionReviewEnd)
    : "";
  const sessionRefUses = longSessionReviewBody.match(/sample\.sessionRef/g) ?? [];
  if (!longSessionReviewBody
    || !/reviewLead/.test(longSessionReviewBody)
    || sessionRefUses.length !== 0
    || !/samples\.map/.test(longSessionReviewBody)
    || !/<Stack gap=\{0\}>/.test(longSessionReviewBody)
    || !/Review \$\{pendingCount\} sessions/.test(longSessionReviewBody)
    || !/Estimated active time/.test(longSessionReviewBody)
    || /sample\.(?:userInputSummary|rawSessionId)/.test(longSessionReviewBody)
    || /<Grid\b|<Callout\b/.test(longSessionReviewBody)) {
    errors.push("task-loop Canvas must render long-session review leads as one alias-only summary-first vertical queue with estimate boundaries and one review handoff");
  }
  const fluencyCalls = text.match(/<TaskLoopFluency\b/g) ?? [];
  if (!/TaskLoopFluency/.test(text) || !/dimensionFluencyTooltip/.test(text) || fluencyCalls.length !== 1) {
    errors.push("task-loop Canvas must render exactly one reviewed five-dimension Fluency surface with hover reasons");
  }
  const fluencyTooltipStart = text.indexOf("function dimensionFluencyTooltip");
  const fluencyTooltipEnd = text.indexOf("function severityTone", fluencyTooltipStart + 1);
  const fluencyTooltipBody = fluencyTooltipStart >= 0 && fluencyTooltipEnd > fluencyTooltipStart
    ? text.slice(fluencyTooltipStart, fluencyTooltipEnd)
    : "";
  if (!/title/.test(fluencyTooltipBody)
    || !/splitFluencyTooltipReason\(fluencyReason\(row\)\)/.test(fluencyTooltipBody)
    || /subtitle|taskLoopDimensionLabel|stage\.score/.test(fluencyTooltipBody)) {
    errors.push("task-loop Fluency hover must show only the reviewed reason without dimension category or score");
  }
  const reportHeaderStart = text.indexOf("function TaskLoopReportHeader");
  const reportHeaderEnd = text.indexOf("function TaskLoopFluency", reportHeaderStart + 1);
  const reportHeaderBody = reportHeaderStart >= 0 && reportHeaderEnd > reportHeaderStart
    ? text.slice(reportHeaderStart, reportHeaderEnd)
    : "";
  if (/useCanvasAction|aicoding\.canvas\.openHarnessInsights|Handoff to Better Harness|到 Better Harness 处理/.test(text)
    || !/<H1>\{projectName\(\)\}<\/H1>/.test(reportHeaderBody)) {
    errors.push("task-loop Canvas header must keep project context and omit the IDE-only Better Harness handoff");
  }
  if (!/learning-capture/.test(text) || !/row\.id !== "learning-capture"/.test(text)) {
    errors.push("task-loop Canvas must keep Learning Capture outside generic score-band decoration");
  }
  if (/Longitudinal boundary|Longitudinal state|Completed stage|LEARNING_LOOP_STAGE_NUMBERS/.test(text)) {
    errors.push("task-loop Canvas must keep Learning Capture supporting-check stages out of the reader tooltip");
  }
  if (/TaskLoopSummary|TaskLoopReaderSummary|taskLoopDecisionColumns|taskLoopDimensionExtreme/.test(text)) {
    errors.push("task-loop Canvas must keep summary and action-order duplicates out of the main reader flow");
  }
  if (/TaskLoopScoreOverview|TaskLoopDimensionDetails|<Progress\b/.test(text)) {
    errors.push("task-loop Canvas must keep detailed dimension evidence in data and Markdown instead of repeating the five dimensions in progress or detail surfaces");
  }
  if (/TaskLoopEvidenceScore|TaskLoopTopDecision|Work-stage coverage|Highest-priority improvement/.test(text)) {
    errors.push("task-loop Canvas must not duplicate Fluency or findings with coverage and top-decision cards");
  }
  if (!/TaskLoopProjectUsage/.test(text) || !/TaskLoopFindingCards/.test(text) || !/TaskLoopPracticeTable/.test(text)) {
    errors.push("task-loop Canvas must render project usage, findings, and Agent surfaces with responsive reader components");
  }
  const projectUsageStart = text.indexOf("function TaskLoopProjectUsage");
  const projectUsageEnd = text.indexOf("function TaskLoopUsageMethodology", projectUsageStart + 1);
  const projectUsageBody = projectUsageStart >= 0 && projectUsageEnd > projectUsageStart
    ? text.slice(projectUsageStart, projectUsageEnd)
    : "";
  const projectUsageHeadingStart = text.indexOf('<H2>{taskLoopCopy("Project usage"');
  const projectUsageRenderStart = text.indexOf("<TaskLoopProjectUsage", projectUsageHeadingStart + 1);
  const projectUsageHeadingBody = projectUsageHeadingStart >= 0 && projectUsageRenderStart > projectUsageHeadingStart
    ? text.slice(projectUsageHeadingStart, projectUsageRenderStart)
    : "";
  if (!projectUsageBody || /<Card\b|<CardHeader\b|<CardBody\b/.test(projectUsageBody)) {
    errors.push("task-loop Project usage must keep its activity content in a borderless section without Card wrappers");
  }
  if (/activeDays|active days|个活跃日|sessionOverview|Project activity|项目活动/.test(projectUsageBody)
    || !/<TaskLoopActivityHeatmap\b/.test(projectUsageBody)
    || !projectUsageHeadingBody
    || /<IconButton\b/.test(projectUsageHeadingBody)
    || /usageCoverageInfo|taskLoopUsageCoverageInfo/.test(text)) {
    errors.push("task-loop Project usage must keep a plain heading and chart-only activity layer without a coverage info affordance");
  }
  if (!/TaskLoopModelUsageTable/.test(text) || !/userThreadCandidateCount/.test(text) || !/exactCreditsAvailable/.test(text) || !/modelUsage/.test(text)) {
    errors.push("task-loop Canvas must render session composition, response accounting, exact-credit availability, and per-model response values");
  }
  const usageMethodStart = text.indexOf("function TaskLoopUsageMethodology");
  const usageMethodEnd = text.indexOf("function usageTrendLeader", usageMethodStart + 1);
  const usageMethodBody = usageMethodStart >= 0 && usageMethodEnd > usageMethodStart
    ? text.slice(usageMethodStart, usageMethodEnd)
    : "";
  if (!usageMethodBody || /TaskLoopLongSessionReview/.test(usageMethodBody)) {
    errors.push("task-loop usage measurement must keep accounting detail separate from the long-session review queue");
  }
  if (!/TaskLoopSessionInsights/.test(text) || !/semanticFacets\?\.entries/.test(text) || !/taskLoopSessionInsightDetail/.test(text)) {
    errors.push("task-loop Canvas must render every projected semantic facet with bounded evidence details");
  }
  const sessionInsightColumnsStart = text.indexOf("function taskLoopSessionInsightColumns");
  const sessionInsightColumnsEnd = text.indexOf("function taskLoopSessionInsightDetail", sessionInsightColumnsStart + 1);
  const sessionInsightColumnsBody = sessionInsightColumnsStart >= 0 && sessionInsightColumnsEnd > sessionInsightColumnsStart
    ? text.slice(sessionInsightColumnsStart, sessionInsightColumnsEnd)
    : "";
  const sessionInsightDetailStart = text.indexOf("function taskLoopSessionInsightDetail");
  const sessionInsightsDialogStart = text.indexOf("function TaskLoopSessionInsightsDialog", sessionInsightDetailStart + 1);
  const sessionInsightsStart = text.indexOf("function TaskLoopSessionInsights()", sessionInsightsDialogStart + 1);
  const sessionInsightDetailBody = sessionInsightDetailStart >= 0 && sessionInsightsDialogStart > sessionInsightDetailStart
    ? text.slice(sessionInsightDetailStart, sessionInsightsDialogStart)
    : "";
  const sessionInsightsDialogBody = sessionInsightsDialogStart >= 0 && sessionInsightsStart > sessionInsightsDialogStart
    ? text.slice(sessionInsightsDialogStart, sessionInsightsStart)
    : "";
  const sessionInsightsEnd = text.indexOf("function TaskLoopFindingDialog", sessionInsightsStart + 1);
  const sessionInsightsBody = sessionInsightsStart >= 0 && sessionInsightsEnd > sessionInsightsStart
    ? text.slice(sessionInsightsStart, sessionInsightsEnd)
    : "";
  if (!sessionInsightColumnsBody
    || /key: "status"/.test(sessionInsightColumnsBody)
    || !/Status/.test(sessionInsightDetailBody)
    || !/<Dialog\b/.test(sessionInsightsDialogBody)
    || !/density="compact"/.test(sessionInsightsDialogBody)
    || !/View all/.test(sessionInsightsDialogBody)
    || !/representativeEntries/.test(sessionInsightsBody)
    || !/evidenceCount/.test(sessionInsightsBody)
    || !/<Grid columns=\{3\} minColumnWidth=\{220\} gap=\{8\} align="stretch">/.test(sessionInsightsBody)
    || !/<CardBody style=\{\{ padding: 12, height: 142 \}\}>/.test(sessionInsightsBody)
    || !/WebkitLineClamp: 2/.test(sessionInsightsBody)
    || !/marginTop: "auto"/.test(sessionInsightsBody)
    || /fontSize: 22|padding: "13px 0"/.test(sessionInsightsBody)
    || !/slice\(0, 3\)/.test(text)) {
    errors.push("task-loop session observations must show three compact evidence-bearing cards and keep the complete table with bounded metadata in one dialog");
  }
  const agentAssetsStart = text.indexOf("function practiceScopeCell");
  const agentAssetsEnd = text.indexOf("function TaskLoopActivityHeatmap", agentAssetsStart + 1);
  const agentAssetsBody = agentAssetsStart >= 0 && agentAssetsEnd > agentAssetsStart
    ? text.slice(agentAssetsStart, agentAssetsEnd)
    : "";
  if (!agentAssetsBody
    || !/taskLoopPracticeColumns/.test(agentAssetsBody)
    || !/TaskLoopPracticeTable/.test(agentAssetsBody)
    || !/PracticeSurfaceIcon/.test(agentAssetsBody)
    || !/Representative source/.test(agentAssetsBody)
    || !/View \$\{remaining\.length\} more locations/.test(agentAssetsBody)
    || !/defaultOpen=\{false\}/.test(agentAssetsBody)
    || !/<Table\b/.test(agentAssetsBody)
    || !/density="compact"/.test(agentAssetsBody)
    || !/renderDetail=\{practiceSourceDetail\}/.test(agentAssetsBody)
    || /TaskLoopAgentAssets|TaskLoopDetectedAssetRow|TaskLoopCoverageSummary|Detected assets|fontSize: 30/.test(agentAssetsBody)) {
    errors.push("task-loop Agent Customize must use the compact asset, coverage, and representative-source table with row-scoped remaining locations");
  }
  if (!/taskLoopCopy\("Agent Customize", "Agent 自定义"\)/.test(text)
    || !/taskLoopCopy\("Coverage", "覆盖范围"\)/.test(text)
    || !/Discovered sources, not a quality or maturity score/.test(text)) {
    errors.push("task-loop Agent Customize must explain inventory coverage without presenting a quality or maturity score");
  }
  const findingDialogStart = text.indexOf("function TaskLoopFindingDialog");
  const findingCardStart = text.indexOf("function TaskLoopFindingCard");
  const findingCardsStart = text.indexOf("function TaskLoopFindingCards");
  const findingDialogBody = findingDialogStart >= 0 && findingCardStart > findingDialogStart
    ? text.slice(findingDialogStart, findingCardStart)
    : "";
  const findingCardBody = findingCardStart >= 0 && findingCardsStart > findingCardStart
    ? text.slice(findingCardStart, findingCardsStart)
    : "";
  if (/findingEvidenceCounts|findingEvidenceReferences|Details and evidence|Finding ID|Repository evidence/.test(text)
    || /<Card size="sm" style=\{\{ minHeight: 220 \}\}/.test(text)
    || (findingCardBody.match(/WebkitLineClamp: 2/g) ?? []).length !== 2
    || !/<CardBody style=\{\{ padding: 14, height: 190 \}\}>/.test(findingCardBody)
    || !/style=\{\{ height: "100%" \}\}/.test(findingCardBody)
    || !/style=\{\{ marginTop: "auto" \}\}/.test(findingCardBody)
    || !/<Grid columns=\{3\} minColumnWidth=\{300\} gap=\{8\} align="stretch">/.test(text)
    || /<CollapsibleSection\b/.test(findingCardBody)
    || !/SendToChatButton[\s\S]*Plan AI Fix/.test(findingCardBody)
    || !/<TaskLoopFindingDialog row=\{row\}/.test(findingCardBody)
    || findingCardBody.indexOf("SendToChatButton") > findingCardBody.indexOf("TaskLoopFindingDialog")) {
    errors.push("task-loop Finding Cards must show a bounded cause preview with Plan AI Fix left and popup detail right");
  }
  if (!findingDialogBody
    || !/<Dialog\b/.test(findingDialogBody)
    || !/trigger=\{\([\s\S]*<Button variant="ghost">[\s\S]*View details/.test(findingDialogBody)
    || !/title=\{row\.title \?\? row\.id\}/.test(findingDialogBody)
    || !/closeLabel=\{taskLoopCopy\("Close", "关闭"\)\}/.test(findingDialogBody)
    || !/maxWidth=\{880\}/.test(findingDialogBody)
    || !/Cause/.test(findingDialogBody)
    || !/row\.reason/.test(findingDialogBody)
    || !/Expected Output/.test(findingDialogBody)
    || !/expectedOutput\.map/.test(findingDialogBody)
    || !/footer=\{\([\s\S]*Plan AI Fix/.test(findingDialogBody)
    || /<dialog\b|\bdocument\b|showModal|taskLoopFindingBackdropClick/.test(text)
    || />\s*\{row\.aiFixPrompt\}\s*</.test(findingDialogBody)) {
    errors.push("task-loop Finding Detail must use the Canvas SDK Dialog without local DOM ownership or printed AI Fix instructions");
  }
  if (/TaskLoopPracticeDetailRows/.test(text)) {
    errors.push("task-loop practice sources must not render as a full-width divider list");
  }
  if (!/TaskLoopUsageTrends/.test(text) || !/<AreaChart\b/.test(text) || /<LineChart\b/.test(text)) {
    errors.push("task-loop Canvas must render optional model and Skill daily trends with SDK AreaChart visuals");
  }
  const usageTrendStart = text.indexOf("function TaskLoopUsageTrend");
  const usageTrendEnd = text.indexOf("function TaskLoopUsageTrends", usageTrendStart + 1);
  const usageTrendBody = usageTrendStart >= 0 && usageTrendEnd > usageTrendStart
    ? text.slice(usageTrendStart, usageTrendEnd)
    : "";
  if (!usageTrendBody
    || /<CardHeader\b|trailing=/.test(usageTrendBody)
    || !/<CardBody\b/.test(usageTrendBody)
    || !/tone="secondary"/.test(usageTrendBody)
    || !/tone="tertiary"/.test(usageTrendBody)
    || !/leaderDescription/.test(usageTrendBody)) {
    errors.push("task-loop usage trends must use a title, muted description, AreaChart, and factual footer without a competing CardHeader total");
  }
  if (/TaskLoopPriorityMoves|TaskLoopFindingsTable|TaskLoopPracticeCards|ImprovementKataCard/.test(text)) {
    errors.push("task-loop Canvas must not restore the clipped Kata row, findings table, or practice-card grid");
  }
  const findingCardsEnd = text.indexOf("function TaskLoopEvidenceBoundary", findingCardsStart + 1);
  const findingCardsBody = findingCardsStart >= 0 && findingCardsEnd > findingCardsStart
    ? text.slice(findingCardsStart, findingCardsEnd)
    : "";
  if (!/<Grid\b/.test(findingCardsBody)
    || !/columns=\{3\}/.test(findingCardsBody)
    || !/minColumnWidth=\{300\}/.test(findingCardsBody)) {
    errors.push("task-loop Finding Cards must use a responsive one-to-three-column Grid with a 300px card boundary");
  }
  if (/TaskLoopOverview|Work loop evidence states|The Five Questions|Five Lifecycle Dimensions/.test(text)) {
    errors.push("task-loop Canvas must not repeat internal evidence states as a reader overview");
  }
  const readerMarkers = [
    "<TaskLoopReportHeader",
    "<TaskLoopFluency",
    "<TaskLoopProjectUsage",
    "<TaskLoopFindingCards",
    "<TaskLoopPracticeTable",
    "<TaskLoopUsageTrends",
    "<TaskLoopEvidenceBoundary",
  ];
  const readerOrder = readerMarkers.map((marker) => text.indexOf(marker));
  if (readerOrder.some((offset) => offset < 0)
    || !readerOrder.every((offset, index) => index === 0 || offset > readerOrder[index - 1])) {
    errors.push("task-loop Canvas reader order must be header, Fluency, activity, findings, practices, trends, then the evidence decision brief");
  }
  const evidenceFactStart = text.indexOf("function TaskLoopEvidenceFact");
  const evidenceFactEnd = text.indexOf("function TaskLoopEvidenceDetails", evidenceFactStart + 1);
  const evidenceFactBody = evidenceFactStart >= 0 && evidenceFactEnd > evidenceFactStart
    ? text.slice(evidenceFactStart, evidenceFactEnd)
    : "";
  const evidenceStart = text.indexOf("function TaskLoopEvidenceBoundary");
  const evidenceEnd = text.indexOf("function TaskLoopReport", evidenceStart + 1);
  const evidenceBody = evidenceStart >= 0 && evidenceEnd > evidenceStart ? text.slice(evidenceStart, evidenceEnd) : "";
  const closedEvidenceDisclosures = evidenceBody.match(/defaultOpen=\{false\}/g) ?? [];
  if (!evidenceFactBody
    || !/<Card size="sm">/.test(evidenceFactBody)
    || !/<Tag size="sm" tone=\{tone\}>\{value\}<\/Tag>/.test(evidenceFactBody)
    || /fontSize: 22|borderLeft|divided/.test(evidenceFactBody)
    || closedEvidenceDisclosures.length !== 1
    || !/Evidence and methodology/.test(evidenceBody)
    || !/fontSize: 20/.test(evidenceBody)
    || !/<Callout[\s\S]{0,180}tone="warning"/.test(evidenceBody)
    || !/padding: "10px 12px"/.test(evidenceBody)
    || !/<Grid columns=\{3\} minColumnWidth=\{180\} gap=\{8\} align="stretch">/.test(evidenceBody)
    || !/Sampling confidence/.test(evidenceBody)
    || !/Source gaps/.test(evidenceBody)
    || !/Delivery outcome/.test(evidenceBody)
    || !/TaskLoopLongSessionReview/.test(evidenceBody)
    || !/TaskLoopSessionInsights/.test(evidenceBody)
    || !/View measurement and model details/.test(evidenceBody)
    || !/TaskLoopEvidenceDetails/.test(evidenceBody)) {
    errors.push("task-loop Canvas must render a visible evidence decision brief with one technical-detail disclosure, one review queue, and representative observations");
  }
  return { errors, warnings: [], summary: { contract: "agent-work-loop" } };
}

function skippedCheck(id, reason) {
  return {
    id,
    status: "skip",
    errors: [],
    warnings: [reason],
  };
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionRe(labels) {
  return new RegExp(`^##\\s+(?:${labels.map(escapeRe).join("|")})(?:\\s|$)`, "im");
}

function extractSection(text, labels) {
  const match = sectionRe(labels).exec(text);
  if (!match) return "";

  const after = text.slice(match.index + match[0].length);
  const next = after.search(/^##\s+/m);
  return next === -1 ? after : after.slice(0, next);
}

function parseMarkdownTableRows(sectionText) {
  return sectionText
    .split(/\r?\n/)
    .filter((line) => /^\s*\|/.test(line))
    .map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length > 1 && !cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function normalizeHeaderCell(value) {
  return String(value ?? "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanMarkdownHeading(value) {
  return String(value ?? "")
    .replace(/[`*]/g, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/^\s*R-?\d+\s*[:：]\s*/i, "")
    .replace(/\s*\((?:High|Medium|Low|高|中|低)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isRiskTitleHeading(value) {
  const text = String(value ?? "").trim();
  return !/^(?:core files?|core paths?|affected files?|affected paths?|核心文件|核心路径)(?:\s|$|\()/i.test(text)
    && !/^(?:High|Medium|Low|Severity|高|中|低|严重性)$/i.test(text);
}

function extractMarkdownSubheadings(sectionText) {
  return unique(Array.from(String(sectionText).matchAll(/^#{3,6}\s+(.+?)\s*#*\s*$/gm))
    .map((match) => cleanMarkdownHeading(match[1]))
    .filter(isRiskTitleHeading));
}

function tableColumnIndex(header, candidates) {
  const normalizedCandidates = candidates.map(normalizeHeaderCell);
  return header.findIndex((cell) => normalizedCandidates.includes(normalizeHeaderCell(cell)));
}

function normalizeRiskId(value) {
  return String(value ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function uniqueRiskEntries(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const id = String(entry?.id ?? "").trim();
    const title = cleanMarkdownHeading(entry?.title);
    if (!isConcreteValue(title)) continue;

    const key = `${normalizeRiskId(id)}:${normalizeFindingTitle(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ id, title });
  }
  return result;
}

function riskTitleColumnIndex(header) {
  return tableColumnIndex(header, [
    "Title",
    "Name",
    "Finding",
    "Risk finding",
    "Risk",
    "Issue",
    "标题",
    "名称",
    "发现",
    "风险",
    "问题",
  ]);
}

function extractRiskEntries(sectionText) {
  const subheadingEntries = Array.from(String(sectionText).matchAll(/^#{3,6}\s+(.+?)\s*#*\s*$/gm))
    .map((match) => ({
      id: match[1].match(/^\s*(R-?\d+)\s*[:：]/i)?.[1] ?? "",
      title: cleanMarkdownHeading(match[1]),
    }))
    .filter((entry) => isRiskTitleHeading(entry.title));
  if (subheadingEntries.length > 0) {
    return uniqueRiskEntries(subheadingEntries);
  }

  const rows = parseMarkdownTableRows(sectionText);
  if (rows.length === 0) return [];

  const header = rows[0] ?? [];
  const idIndex = tableColumnIndex(header, ["ID", "Risk ID", "Finding ID", "编号"]);
  const fieldIndex = tableColumnIndex(header, ["Field", "字段"]);
  const valueIndex = tableColumnIndex(header, ["Value", "值"]);
  if (fieldIndex >= 0 && valueIndex >= 0) {
    return uniqueRiskEntries(rows.slice(1)
      .filter((cells) => /^(finding|title|name|risk finding|发现|标题|名称)$/i.test(normalizeHeaderCell(cells[fieldIndex])))
      .map((cells) => ({ id: "", title: cells[valueIndex] })));
  }

  const findingIndex = riskTitleColumnIndex(header);
  if (findingIndex >= 0) {
    return uniqueRiskEntries(rows.slice(1).map((cells) => ({
      id: idIndex >= 0 ? cells[idIndex] : "",
      title: cells[findingIndex],
    })));
  }

  return uniqueRiskEntries(rows.slice(1).map((cells) => ({
    id: "",
    title: cells[1],
  })));
}

function extractRiskTitles(sectionText) {
  return extractRiskEntries(sectionText).map((entry) => entry.title);
}

function isConcreteValue(value) {
  return Boolean(value)
    && !/^<.*>$/.test(value)
    && !/^[-:| ]+$/.test(value)
    && value.length >= 3;
}

function unique(values) {
  return Array.from(new Set(values.filter(isConcreteValue)));
}

function tokenVariants(value) {
  const text = String(value).trim();
  return unique([
    text,
    text.replace(/[。.]$/, ""),
  ]);
}

function canvasIncludesToken(canvasText, value) {
  return tokenVariants(value).some((candidate) => canvasText.includes(candidate));
}

function extractReportParityTokens(reportText) {
  const riskSection = extractSection(reportText, SECTION_LABELS.riskFindings);
  const scorecardRows = parseMarkdownTableRows(extractSection(reportText, SECTION_LABELS.readinessScorecard));
  const actionRows = parseMarkdownTableRows(extractSection(reportText, SECTION_LABELS.actionPathways));
  const unverifiedItems = extractSection(reportText, SECTION_LABELS.unverifiedItems)
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean);

  return {
    risks: extractRiskTitles(riskSection),
    dimensions: unique(scorecardRows.slice(1).map((cells) => cells[0])),
    actions: unique(actionRows.slice(1).map((cells) => cells[0])),
    unverified: unique(unverifiedItems),
  };
}

function extractReportRiskEntries(reportText) {
  return extractRiskEntries(extractSection(reportText, SECTION_LABELS.riskFindings));
}

function readSdkExports(declarationsPath) {
  if (!declarationsPath || !existsSync(declarationsPath)) return null;
  const text = readFileSync(declarationsPath, "utf8");
  const exports = new Set();
  for (const match of text.matchAll(/\bexport\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\b/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/i)[0]?.trim();
      if (name) exports.add(name);
    }
  }
  return exports;
}

function qoderHome(env = process.env) {
  return env.QODER_HOME ? path.resolve(env.QODER_HOME) : path.join(os.homedir(), ".qoder");
}

function uniquePaths(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function canvasDeclarationPaths(canvasesRoot) {
  if (!canvasesRoot) return [];
  return QODER_CANVAS_DECLARATION_RELATIVES.map((relativePath) => path.join(canvasesRoot, relativePath));
}

function findCanvasesRoot(filePath) {
  if (!filePath) return null;
  let current = path.dirname(path.resolve(filePath));
  while (true) {
    if (path.basename(current) === "canvases") return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function normalizeQoderProjectPath(projectPath) {
  return path.resolve(projectPath).replace(/[:\\/]+/g, "-");
}

function defaultSdkDeclarationCandidates({
  canvasPath,
  repoRoot = defaultRepoRoot,
  platform = "qoder",
  env = process.env,
} = {}) {
  if (env.CANVAS_SDK_DECLARATIONS) {
    return [path.resolve(env.CANVAS_SDK_DECLARATIONS)];
  }

  const candidates = [
    ...canvasDeclarationPaths(findCanvasesRoot(canvasPath)),
    ...canvasDeclarationPaths(repoRoot),
  ];

  if (platform === "qoder" && repoRoot) {
    const home = qoderHome(env);
    const projectCanvasesRoot = path.join(home, "projects", normalizeQoderProjectPath(repoRoot), "canvases");
    candidates.push(...canvasDeclarationPaths(projectCanvasesRoot));
    candidates.push(path.join(home, "canvas", "sdk", "index.d.ts"));
  }
  return uniquePaths(candidates);
}

function defaultSdkDeclarationsPath(options = {}) {
  const candidates = defaultSdkDeclarationCandidates(options);
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function stripRuntimeScanNoise(text) {
  let output = "";
  let index = 0;
  let state = "code";
  let quote = "";

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
        output += "\n";
      } else {
        output += " ";
      }
      index += 1;
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 2;
        state = "code";
      } else {
        output += char === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }

    if (state === "string") {
      if (char === "\\") {
        output += "  ";
        index += 2;
        continue;
      }
      output += char === "\n" ? "\n" : " ";
      index += 1;
      if (char === quote) state = "code";
      continue;
    }

    if (char === "/" && next === "/") {
      output += "  ";
      index += 2;
      state = "line-comment";
      continue;
    }

    if (char === "/" && next === "*") {
      output += "  ";
      index += 2;
      state = "block-comment";
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      output += " ";
      index += 1;
      quote = char;
      state = "string";
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function evaluateRuntimeBoundaries(canvasText, { sdkDeclarationsPath, platform = "qoder" } = {}) {
  const errors = [];
  const warnings = [];
  const moduleBoundary = analyzeCanvasModuleBoundaries(canvasText);
  const qoderImports = moduleBoundary.imports.filter((record) => record.source === "qoder/canvas");
  const importNames = unique(qoderImports.flatMap((record) => record.namedImports));
  const isHarnessBundle = moduleBoundary.imports.some((record) => record.source === `./${FINDINGS_JSON_FILE}`)
    && moduleBoundary.imports.some((record) => record.source === `./${CANVAS_DATA_FILE}`);
  const runtimeScanText = stripRuntimeScanNoise(canvasText);

  if (moduleBoundary.syntaxError) {
    errors.push("Canvas module syntax could not be parsed safely");
  }
  if (moduleBoundary.dynamicImport) {
    errors.push("forbidden runtime API: dynamic import");
  }
  if (moduleBoundary.reexports.length > 0) {
    errors.push(`Canvas report must not re-export modules: ${moduleBoundary.reexports.join(", ")}`);
  }
  if (qoderImports.some((record) => record.defaultImport || record.namespaceImport)) {
    errors.push("qoder/canvas must use named imports so SDK exports can be validated");
  }

  for (const source of moduleBoundary.staticSources) {
    if (isHarnessBundle && HARNESS_CANVAS_ALLOWED_IMPORTS.has(source)) continue;
    if (!isHarnessBundle && ALLOWED_IMPORTS.has(source)) continue;
    if (!isHarnessBundle && (source === `./${FINDINGS_JSON_FILE}` || source === `./${CANVAS_DATA_FILE}`)) continue;
    if (source.startsWith(".") || source.startsWith("/") || NODE_IMPORT_PREFIXES.includes(source) || source.startsWith("node:")) {
      errors.push(`forbidden import source: ${source}`);
    } else {
      errors.push(`forbidden import source: ${source}`);
    }
  }

  for (const [name, pattern] of FORBIDDEN_RUNTIME_APIS) {
    if (pattern.test(runtimeScanText)) {
      errors.push(`forbidden runtime API: ${name}`);
    }
  }

  for (const component of FORBIDDEN_JSX_COMPONENTS) {
    if (new RegExp(`<${component}(?:\\s|>|/)`).test(canvasText)) {
      errors.push(`forbidden guessed JSX component: ${component}`);
    }
  }

  const sdkExports = readSdkExports(sdkDeclarationsPath);
  if (!sdkExports) {
    warnings.push(sdkDeclarationsPath
      ? `SDK declarations not found: ${sdkDeclarationsPath}`
      : `SDK declarations not found for ${platform} artifact`);
  } else {
    for (const name of importNames) {
      if (!sdkExports.has(name)) {
        errors.push(`qoder/canvas export not found in SDK declarations: ${name}`);
      }
    }
  }

  return check("runtime-boundaries", errors, warnings, {
    summary: {
      sdkDeclarationsPath,
      platform,
      imports: importNames,
    },
  });
}

function parsedJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resolveArtifactPlatform({ platform, canvasDataText, findingsText } = {}) {
  const candidate = String(platform
    ?? parsedJson(canvasDataText)?.summary?.evidenceBoundary?.manifest?.platform
    ?? parsedJson(findingsText)?.summary?.evidenceBoundary?.manifest?.platform
    ?? "qoder").toLowerCase();
  if (!["qoder", "codex"].includes(candidate)) {
    throw new Error(`Unsupported Canvas artifact platform: ${candidate}`);
  }
  return candidate;
}

function evaluateReportCanvasParity(reportText, canvasText, { evidenceText = "" } = {}) {
  const errors = [];
  const tokens = extractReportParityTokens(reportText);
  const combinedCanvasEvidence = [canvasText, evidenceText].filter(Boolean).join("\n");
  for (const [kind, values] of Object.entries(tokens)) {
    for (const value of values) {
      if (!canvasIncludesToken(combinedCanvasEvidence, value)) {
        errors.push(`canvas does not mirror report text (${kind}): ${value}`);
      }
    }
  }
  return check("markdown-canvas-parity", errors, [], { summary: tokens });
}

const FINDINGS_JSON_TOP_LEVEL_FIELDS = [
  "summary",
  "findings",
];
const FINDINGS_JSON_TOP_LEVEL_FIELD_SET = new Set(FINDINGS_JSON_TOP_LEVEL_FIELDS);

const FINDINGS_JSON_SUMMARY_FIELDS = [
  "projectName",
  "modelId",
  "strengths",
  "dimensions",
  "aiAgentPractice",
];
const FINDINGS_JSON_SUMMARY_FIELD_SET = new Set([
  ...FINDINGS_JSON_SUMMARY_FIELDS,
  "overview",
]);
const FINDINGS_JSON_DIMENSION_FIELDS = [
  "id",
  "label",
  "score",
  "summary",
  "findingRefs",
];
const FINDINGS_JSON_DIMENSION_FIELD_SET = new Set(FINDINGS_JSON_DIMENSION_FIELDS);
const DIMENSION_SUMMARY_EXAMPLE_RE = /^(?:example|示例)\s*[:：]/i;
const AI_AGENT_PRACTICE_FIELDS = [
  "inspectedSurfaces",
  "coverageRows",
];
const AI_AGENT_PRACTICE_FIELD_SET = new Set(AI_AGENT_PRACTICE_FIELDS);
const AI_AGENT_PRACTICE_ROW_FIELD_SET = new Set([
  "surface",
  "scopes",
  "count",
  "paths",
]);

const FINDING_REQUIRED_FIELDS = [
  "id",
  "title",
  "severity",
  "reason",
  "aiFixPrompt",
  "dimensionRefs",
];
const FINDING_FIELD_SET = new Set([...FINDING_REQUIRED_FIELDS, "target"]);

const FINDINGS_JSON_RISK_LABELS = new Set(["High", "Medium", "Low"]);
const AI_AGENT_PRACTICE_SURFACES = new Set([
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
const AI_AGENT_PRACTICE_SCOPES = new Set(["Project", "Inherited", "Global", "Plugin"]);
const AI_FIX_REPAIR_COMMAND_RE = /^\/better-harness\s+(?:fix\s+this\s+issue|修复这个问题)\b/i;
const AI_FIX_SCHEDULE_PROMPT_REQUIREMENTS = [
  ["/schedule", /\/schedule\b/i],
  ["/better-harness", /(?:^|\s)\/better-harness(?:\s|$)/i],
  ["cadence or trigger", /cadence|trigger|weekly|daily|monthly|schedule|recurring|每周|每日|每月|周期|触发|定期/i],
  ["stop condition", /stop[_ -]?condition|stop when|until score|停止条件|直到|连续两次|after (?:four|\d+) runs?/i],
];
const AI_FIX_SCOPE_RE = /(?:Limit the change to|Keep the change limited to|Scope\s*[:：]|范围\s*[:：]|将改动限制在|只修改|仅修改)/i;
const AI_FIX_VALIDATION_SECTION_RE = /(?:^|\n)##\s*(?:Validation\b|验证)(?:\s|$)/i;
const AI_FIX_SLOT_ASSIGNMENT_RE = /\b(?:target|finding|reason|evidence|request|requested_fix|acceptance(?:_check)?|validation(?:_command)?|risk(?:_boundary)?|safety(?:_note)?|stop(?:_condition)?)=/gi;
const AI_FIX_REPAIR_PROMPT_REQUIREMENTS = [
  ["target scope", AI_FIX_SCOPE_RE],
  ["validation section", AI_FIX_VALIDATION_SECTION_RE],
];

function safePracticePathForSurface(surface, value) {
  const candidate = String(value ?? "").trim().replaceAll("\\", "/");
  const isSafe = candidate
    && candidate.length <= 240
    && !candidate.startsWith("/")
    && !/^[A-Za-z]:\//.test(candidate)
    && !candidate.split("/").includes("..");
  if (!isSafe) return false;
  if (String(surface ?? "") !== "Memories") return true;
  return !candidate.startsWith("~/") && /(?:^|\/)MEMORY\.md$/u.test(candidate);
}

function normalizeFindingTitle(value) {
  return String(value ?? "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getFindingsArray(parsed) {
  if (Array.isArray(parsed?.findings)) return parsed.findings;
  return null;
}

function getFindingTitle(finding) {
  return finding?.finding ?? finding?.title ?? finding?.name ?? "";
}

function isConcreteJsonValue(value) {
  if (typeof value === "string") return isConcreteValue(value);
  if (Array.isArray(value)) return value.some(isConcreteJsonValue);
  if (value && typeof value === "object") return Object.values(value).some(isConcreteJsonValue);
  return value !== null && value !== undefined;
}

function isConcreteJsonFieldValue(field, value) {
  if (field === "id") {
    return typeof value === "string" && value.trim().length > 0 && !/^<.*>$/.test(value.trim());
  }
  return isConcreteJsonValue(value);
}

function collectScoreRows(summary) {
  const rows = [];
  for (const value of [summary?.dimensions, summary?.fluency?.dimensions, summary?.fluency?.scores]) {
    if (Array.isArray(value)) rows.push(...value);
  }
  return rows.filter((row) => row && typeof row === "object");
}

function scorePercentageError(score) {
  if (score === undefined || score === null || score === "") return "";
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) {
    return "score must be numeric";
  }
  if (numericScore < 0 || numericScore > 100) {
    return "score must be a 0-100 percentage";
  }
  if (Number.isInteger(numericScore) && numericScore > 0 && numericScore <= 5) {
    return "score must be a 0-100 percentage, not a 1-5 stage value";
  }
  return "";
}

function collectDimensionRefs(summary) {
  const rows = collectScoreRows(summary);
  const refsByDimensionId = new Map();
  for (const row of rows) {
    const id = String(row?.id ?? "").trim();
    if (!id) continue;
    const refs = refsByDimensionId.get(id) ?? new Set();
    for (const ref of Array.isArray(row?.findingRefs) ? row.findingRefs : []) {
      refs.add(String(ref));
    }
    refsByDimensionId.set(id, refs);
  }
  return refsByDimensionId;
}

function fluencyDimensionContractErrors(summary) {
  const errors = [];
  const usesSoftwareFluency = summary?.modelId === BETTER_HARNESS_AGENT_FLUENCY_MODEL_ID
    || summary?.fluency?.modelId === BETTER_HARNESS_AGENT_FLUENCY_MODEL_ID;
  if (!usesSoftwareFluency) return errors;

  const expected = BETTER_HARNESS_AGENT_FLUENCY_DIMENSION_IDS;
  const expectedSet = new Set(expected);
  const checkRows = (fieldPath, rows, required = false) => {
    if (!Array.isArray(rows)) {
      if (required) {
        errors.push(`${fieldPath} must contain exactly ${expected.length} software-fluency dimensions`);
      }
      return;
    }
    const ids = rows.map((row) => String(row?.id ?? "").trim()).filter(Boolean);
    const idSet = new Set(ids);
    for (const id of expected) {
      if (!idSet.has(id)) {
        errors.push(`${fieldPath} missing software-fluency dimension: ${id}`);
      }
    }
    for (const id of ids) {
      if (!expectedSet.has(id)) {
        errors.push(`${fieldPath} contains unsupported software-fluency dimension: ${id}`);
      }
    }
    if (ids.length !== expected.length || idSet.size !== expected.length) {
      errors.push(`${fieldPath} must contain exactly ${expected.length} software-fluency dimensions`);
    }
  };

  checkRows("findings.json summary.dimensions", summary?.dimensions, true);
  checkRows("findings.json summary.fluency.dimensions", summary?.fluency?.dimensions);
  checkRows("findings.json summary.fluency.scores", summary?.fluency?.scores);
  return errors;
}

function fluencyScoreLinkErrors(parsed, findings) {
  const errors = [];
  const summary = parsed?.summary ?? {};
  if (summary.modelId && summary.modelId !== BETTER_HARNESS_AGENT_FLUENCY_MODEL_ID) {
    errors.push(`findings.json summary.modelId must be ${BETTER_HARNESS_AGENT_FLUENCY_MODEL_ID}; found ${summary.modelId}`);
  }
  if (summary.fluency?.modelId && summary.fluency.modelId !== BETTER_HARNESS_AGENT_FLUENCY_MODEL_ID) {
    errors.push(`findings.json summary.fluency.modelId must be ${BETTER_HARNESS_AGENT_FLUENCY_MODEL_ID}; found ${summary.fluency.modelId}`);
  }
  errors.push(...fluencyDimensionContractErrors(summary));

  const findingIds = new Set(findings.map((finding) => String(finding?.id ?? "")).filter(Boolean));
  for (const [index, row] of collectScoreRows(summary).entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`summary score row ${index} must be an object`);
      continue;
    }
    for (const field of Object.keys(row)) {
      if (!FINDINGS_JSON_DIMENSION_FIELD_SET.has(field)) {
        errors.push(`summary score row ${index} has unsupported field: ${field}`);
      }
    }
    for (const field of FINDINGS_JSON_DIMENSION_FIELDS) {
      if (field === "findingRefs") {
        if (!Array.isArray(row?.findingRefs)) {
          errors.push(`summary score row ${index} missing findingRefs`);
        }
        continue;
      }
      if (!isConcreteJsonFieldValue(field, row?.[field])) {
        errors.push(`summary score row ${index} missing ${field}`);
      }
    }
    if (typeof row?.summary === "string" && DIMENSION_SUMMARY_EXAMPLE_RE.test(row.summary.trim())) {
      errors.push(`summary score row ${index} summary must be project-specific, not an example placeholder`);
    }
    const scoreError = scorePercentageError(row?.score);
    if (scoreError) {
      errors.push(`summary score row ${index} ${scoreError}`);
    }
    const hasScoreValue = row?.score !== undefined && row?.score !== null && row?.score !== "";
    const hasScoreLikeValue = hasScoreValue || isConcreteJsonValue(row?.band) || isConcreteJsonValue(row?.status);
    if (!hasScoreLikeValue) continue;
    if (!Array.isArray(row.findingRefs)) {
      errors.push(`summary score row ${index} missing findingRefs`);
      continue;
    }
    for (const ref of row.findingRefs) {
      if (!findingIds.has(String(ref))) {
        errors.push(`summary score row ${index} findingRefs contains unknown finding id: ${ref}`);
      }
    }
  }
  const refsByDimensionId = collectDimensionRefs(summary);
  if (refsByDimensionId.size > 0) {
    for (const [index, finding] of findings.entries()) {
      const findingId = String(finding?.id ?? "").trim();
      if (!Array.isArray(finding?.dimensionRefs) || finding.dimensionRefs.length === 0) {
        errors.push(`findings[${index}] missing dimensionRefs`);
        continue;
      }
      for (const ref of finding.dimensionRefs) {
        const refId = String(ref);
        const dimensionFindingRefs = refsByDimensionId.get(refId);
        if (!dimensionFindingRefs) {
          errors.push(`findings[${index}] dimensionRefs contains unknown dimension id: ${refId}`);
          continue;
        }
        if (findingId && !dimensionFindingRefs.has(findingId)) {
          errors.push(`findings[${index}] dimensionRefs includes ${refId}, but summary dimension ${refId} does not link back to ${findingId}`);
        }
      }
    }
  }
  return errors;
}

function aiAgentPracticeCoverageErrors(summary, findingIds = null) {
  const practice = summary?.aiAgentPractice;
  if (!practice || typeof practice !== "object" || Array.isArray(practice)) return [];
  const errors = [];
  for (const field of Object.keys(practice)) {
    if (!AI_AGENT_PRACTICE_FIELD_SET.has(field)) {
      errors.push(`findings.json summary.aiAgentPractice has unsupported field: ${field}`);
    }
  }
  const inspectedSurfaces = Array.isArray(practice.inspectedSurfaces)
    ? practice.inspectedSurfaces.map((surface) => String(surface ?? "").trim()).filter(Boolean)
    : [];
  const coverageRows = Array.isArray(practice.coverageRows) ? practice.coverageRows : [];
  const rowFields = AI_AGENT_PRACTICE_ROW_FIELD_SET;

  if (inspectedSurfaces.length === 0 && coverageRows.length === 0) {
    errors.push("findings.json summary.aiAgentPractice must include inspectedSurfaces or coverageRows");
  }

  for (const surface of inspectedSurfaces) {
    if (!AI_AGENT_PRACTICE_SURFACES.has(surface)) {
      errors.push(`findings.json summary.aiAgentPractice inspectedSurfaces contains unsupported surface: ${surface}`);
    }
  }

  for (const [index, row] of coverageRows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`summary.aiAgentPractice.coverageRows[${index}] must be an object`);
      continue;
    }
    for (const field of Object.keys(row)) {
      if (!rowFields.has(field)) {
        errors.push(`summary.aiAgentPractice.coverageRows[${index}] has unsupported field: ${field}`);
      }
    }
    if (!isConcreteJsonFieldValue("surface", row?.surface)) {
      errors.push(`summary.aiAgentPractice.coverageRows[${index}] missing surface`);
    } else if (!AI_AGENT_PRACTICE_SURFACES.has(String(row.surface))) {
      errors.push(`summary.aiAgentPractice.coverageRows[${index}] has unsupported surface: ${row.surface}`);
    }
    if (row?.count !== undefined && (!Number.isInteger(Number(row.count)) || Number(row.count) < 0)) {
      errors.push(`summary.aiAgentPractice.coverageRows[${index}].count must be a non-negative integer`);
    }
    if (row?.scopes !== undefined && (
      !Array.isArray(row.scopes) ||
      row.scopes.length === 0 ||
      row.scopes.some((scope) => !AI_AGENT_PRACTICE_SCOPES.has(String(scope)))
    )) {
      errors.push(`summary.aiAgentPractice.coverageRows[${index}].scopes must contain Project, Global, or Plugin`);
    }
    if (row?.paths !== undefined) {
      const paths = Array.isArray(row.paths) ? row.paths : [];
      const invalidPath = paths.some((value) => !safePracticePathForSurface(row.surface, value));
      if (!Array.isArray(row.paths) || paths.length > 12 || invalidPath) {
        errors.push(`summary.aiAgentPractice.coverageRows[${index}].paths must contain at most 12 project-relative or home-relative paths${row.surface === "Memories" ? "; Memory rows must omit user-home note paths and may link only to project-relative MEMORY.md" : ""}`);
      } else if (row.count !== undefined && Number(row.count) < paths.length) {
        errors.push(`summary.aiAgentPractice.coverageRows[${index}].count must be at least the number of listed paths`);
      }
    }
  }

  return errors;
}

function aiFixPromptQualityErrors(finding, index) {
  const prompt = String(finding?.aiFixPrompt ?? "");
  if (!prompt.trim()) return [];
  const errors = [];
  const isRepairPrompt = /^\/better-harness\b/i.test(prompt);
  const isSchedulePrompt = /^\/schedule\b/i.test(prompt);
  if (!isRepairPrompt && !isSchedulePrompt) {
    errors.push(`findings[${index}] aiFixPrompt must start with /better-harness or /schedule`);
  }
  if (isRepairPrompt && !AI_FIX_REPAIR_COMMAND_RE.test(prompt)) {
    errors.push(`findings[${index}] repair aiFixPrompt must start with /better-harness fix this issue or /better-harness 修复这个问题`);
  }
  if (isRepairPrompt) {
    const slotAssignments = Array.from(prompt.matchAll(AI_FIX_SLOT_ASSIGNMENT_RE));
    if (slotAssignments.length >= 3) {
      errors.push(`findings[${index}] repair aiFixPrompt must use human-readable prose, not key=value slot packets`);
    }
    const body = prompt.replace(AI_FIX_REPAIR_COMMAND_RE, "").replace(AI_FIX_VALIDATION_SECTION_RE, "").trim();
    if (body.length < 80) {
      errors.push(`findings[${index}] repair aiFixPrompt must describe the problem, scope, and expected change`);
    }
    if (hasSyntheticEvidenceAlias(prompt)) {
      errors.push(`findings[${index}] repair aiFixPrompt must describe evidence directly instead of using synthetic numbered aliases`);
    }
  }
  if (isSchedulePrompt) {
    for (const [label, pattern] of AI_FIX_SCHEDULE_PROMPT_REQUIREMENTS) {
      if (!pattern.test(prompt)) {
        errors.push(`findings[${index}] schedule aiFixPrompt missing ${label}`);
      }
    }
    if (!/\/schedule\b/i.test(prompt)) {
      errors.push(`findings[${index}] schedule aiFixPrompt must include /schedule`);
    }
  }
  const requirements = isRepairPrompt ? AI_FIX_REPAIR_PROMPT_REQUIREMENTS : [];
  for (const [label, pattern] of requirements) {
    if (!pattern.test(prompt)) {
      errors.push(`findings[${index}] aiFixPrompt missing ${label}`);
    }
  }
  return errors;
}

export function evaluateFindingsJson(findingsText, reportText, canvasDataText = null, options = {}) {
  const errors = [];
  let parsed;
  try {
    parsed = JSON.parse(findingsText);
  } catch (error) {
    return check("findings-json", [`findings.json is not valid JSON: ${error.message}`]);
  }

  if (Array.isArray(parsed)) {
    errors.push("findings.json must be an object with top-level summary and findings, not a bare array");
    return check("findings-json", errors);
  }
  if (!parsed || typeof parsed !== "object") {
    errors.push("findings.json must be an object with top-level summary and findings");
    return check("findings-json", errors);
  }

  if (isTaskLoopFindingsText(findingsText)) {
    let taskLoopErrors;
    if (!isFullTaskLoopFindings(parsed)) {
      if (options.allowStandaloneTaskLoop === true) {
        taskLoopErrors = validateCompactTaskLoopFindings(parsed);
      } else {
        let canvas;
        try {
          canvas = JSON.parse(String(canvasDataText ?? ""));
        } catch (error) {
          return check("findings-json", [`canvas.json is not valid JSON: ${error.message}`]);
        }
        taskLoopErrors = validateTaskLoopCanvasSplit(parsed, canvas);
      }
    } else {
      taskLoopErrors = [...validateTaskLoopFindings(parsed), ...validateTaskLoopUsagePair(parsed)];
    }
    return check("findings-json", taskLoopErrors, [], {
      summary: {
        findings: Array.isArray(parsed.findings) ? parsed.findings.length : 0,
        contract: "agent-work-loop",
      },
    });
  }

  for (const field of FINDINGS_JSON_TOP_LEVEL_FIELDS) {
    if (!(field in parsed)) {
      errors.push(`findings.json missing top-level ${field}`);
    }
  }
  for (const field of Object.keys(parsed)) {
    if (!FINDINGS_JSON_TOP_LEVEL_FIELD_SET.has(field)) {
      errors.push(`findings.json has unsupported top-level ${field}; only summary and findings are allowed`);
    }
  }

  if (!parsed.summary || typeof parsed.summary !== "object" || Array.isArray(parsed.summary)) {
    errors.push("findings.json summary must be an object");
  } else {
    for (const field of Object.keys(parsed.summary)) {
      if (!FINDINGS_JSON_SUMMARY_FIELD_SET.has(field)) {
        errors.push(`findings.json summary has unsupported field: ${field}`);
      }
    }
  }

  for (const field of FINDINGS_JSON_SUMMARY_FIELDS) {
    if (!isConcreteJsonValue(parsed?.summary?.[field])) {
      errors.push(`findings.json summary missing ${field}`);
    }
  }
  const findings = getFindingsArray(parsed);
  if (!findings) {
    errors.push("findings.json must include a findings array");
    return check("findings-json", errors);
  }

  if (findings.length === 0) {
    errors.push("findings.json must include at least one risk finding");
  }

  const practiceFindingIds = new Set(findings.map((finding) => String(finding?.id ?? "")).filter(Boolean));
  errors.push(...aiAgentPracticeCoverageErrors(parsed?.summary, practiceFindingIds));

  const seenTitles = new Set();
  for (const [index, finding] of findings.entries()) {
    const title = getFindingTitle(finding);
    if (!title || typeof title !== "string") {
      errors.push(`findings[${index}] missing title`);
    }
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      errors.push(`findings[${index}] must be an object`);
      continue;
    }
    for (const field of Object.keys(finding)) {
      if (!FINDING_FIELD_SET.has(field)) {
        errors.push(`findings[${index}] has unsupported field: ${field}`);
      }
    }
    for (const field of FINDING_REQUIRED_FIELDS) {
      if (!isConcreteJsonFieldValue(field, finding?.[field])) {
        errors.push(`findings[${index}] missing ${field}`);
      }
    }
    if (finding?.severity && !FINDINGS_JSON_RISK_LABELS.has(finding.severity)) {
      errors.push(`findings[${index}] has invalid severity: ${finding.severity}; use High, Medium, or Low`);
    }
    errors.push(...findingTargetErrors(finding.target, {
      topology: options.topology,
      required: options.requireFindingTarget === true
        || options.topology?.target?.kind === "workspace-member",
      requireOwnerRoute: finding?.target?.kind === "workspace-member",
      prefix: `findings[${index}].target`,
    }));
    errors.push(...aiFixPromptQualityErrors(finding, index));
    const normalized = normalizeFindingTitle(title);
    if (normalized) {
      if (seenTitles.has(normalized)) {
        errors.push(`duplicate finding title: ${title}`);
      }
      seenTitles.add(normalized);
    }
  }

  errors.push(...fluencyScoreLinkErrors(parsed, findings));

  const reportRiskEntries = extractReportRiskEntries(reportText);
  const jsonTitles = new Set(findings.map((finding) => normalizeFindingTitle(getFindingTitle(finding))));
  const jsonIds = new Set(findings.map((finding) => normalizeRiskId(finding?.id)).filter(Boolean));
  for (const entry of reportRiskEntries) {
    const reportId = normalizeRiskId(entry.id);
    if (reportId) {
      if (!jsonIds.has(reportId)) {
        errors.push(`findings.json does not mirror report risk finding: ${entry.id} ${entry.title}`.trim());
      }
      continue;
    }

    if (!jsonTitles.has(normalizeFindingTitle(entry.title))) {
      errors.push(`findings.json does not mirror report risk finding: ${entry.title}`);
    }
  }

  return check("findings-json", errors, [], {
    summary: {
      findings: findings.length,
      reportRiskFindings: reportRiskEntries.length,
    },
  });
}

function findingsPathForCanvas(canvasPath) {
  return path.join(path.dirname(canvasPath), FINDINGS_JSON_FILE);
}

function canvasDataPathForCanvas(canvasPath) {
  return path.join(path.dirname(canvasPath), CANVAS_DATA_FILE);
}

export function evaluateCanvasFindingsSource(canvasText, { requireCanvasData = false } = {}) {
  const text = String(canvasText ?? "");
  const errors = [];
  const moduleBoundary = analyzeCanvasModuleBoundaries(text);
  const importSources = moduleBoundary.imports.map((record) => record.source);

  if (!importSources.includes("./findings.json")) {
    errors.push("Canvas report must import ./findings.json");
  }
  if (requireCanvasData && !importSources.includes("./canvas.json")) {
    errors.push("Canvas report must import ./canvas.json for Agent Work Loop v3 data");
  }
  const allowedRelativeImports = new Set(["./findings.json", "./canvas.json"]);
  const relativeImports = moduleBoundary.staticSources.filter((source) => source.startsWith(".") && !allowedRelativeImports.has(source));
  if (relativeImports.length > 0) {
    errors.push(`Canvas report must not import additional relative modules: ${relativeImports.join(", ")}`);
  }
  if (/\buseCanvasState\b/.test(text)) {
    errors.push("Canvas report must import findings.json instead of using Canvas state");
  }
  const canvasDataSuffix = [".canvas", ".data", ".json"].join("");
  if (new RegExp(`[\\w.-]+${escapeRe(canvasDataSuffix)}`, "i").test(text)) {
    errors.push("Canvas report must not reference old Canvas data filenames");
  }
  if (/\b(?!insights\.canvas\.tsx\b)[\w.-]+\.canvas\.tsx\b/i.test(text)) {
    errors.push("Canvas report must not reference other Canvas module filenames");
  }
  const inlineReportObjectRe = /\b(?:const|let|var)\s+(?!EMPTY_REPORT\b)\w*(?:REPORT|Report|report)\w*\s*=\s*\{[\s\S]{0,2000}?(?:["']?summary["']?\s*:)[\s\S]{0,2000}?(?:["']?findings["']?\s*:)/;
  if (inlineReportObjectRe.test(text)) {
    errors.push("Canvas report must not duplicate structured report data; import ./findings.json");
  }

  return check("canvas-findings-source", errors, [], {
    summary: {
      findingsImport: importSources.includes("./findings.json"),
      canvasDataImport: importSources.includes("./canvas.json"),
    },
  });
}

function evaluateTransform(canvasText, { canvasPath, repoRoot = defaultRepoRoot, sdkRoot } = {}) {
  try {
    const sourcefile = canvasPath ? path.relative(path.resolve(repoRoot), path.resolve(canvasPath)) : "insights.canvas.tsx";
    const transformed = transformCanvasSource(canvasText, {
      sourcefile,
      sourcePath: canvasPath ? path.resolve(canvasPath) : undefined,
      runtime: { sdkRoot },
    });
    return check("tsx-transform", [], [], {
      summary: {
        bytes: transformed.code.length,
      },
    });
  } catch (error) {
    return check("tsx-transform", [String(error?.message ?? error)]);
  }
}

async function fetchText(url) {
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${body}`);
  }
  return body;
}

async function checkPreviewServer(preview) {
  const health = await fetchText(`${preview.url}/health`);
  const moduleCode = await fetchText(`${preview.url}/canvas-module.js`);
  const errors = [];
  if (health.trim() !== "ok") {
    errors.push(`preview health returned ${health}`);
  }
  if (!moduleCode.trim()) {
    errors.push("preview module is empty");
  }
  return check("preview-smoke", errors, [], { summary: { url: preview.url, moduleBytes: moduleCode.length } });
}

async function runPreviewSmoke({ canvasPath, repoRoot, sdkRoot, sdkMedia, env }) {
  let preview;
  try {
    preview = await createCanvasPreviewServer({
      canvasPath,
      host: "127.0.0.1",
      port: 0,
      watch: false,
      open: false,
      repoRoot,
      sdkRoot,
      sdkMedia,
      env,
    });
    return await checkPreviewServer(preview);
  } catch (error) {
    return check("preview-smoke", [String(error?.message ?? error)]);
  } finally {
    await preview?.close();
  }
}

async function defaultLoadPlaywright() {
  return import("playwright");
}

function chromeExecutableCandidates(env = process.env) {
  const candidates = [
    env.CHROME_PATH,
    env.GOOGLE_CHROME_BIN,
    env.CHROMIUM_BIN,
  ].filter(Boolean);

  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else if (process.platform === "win32") {
    candidates.push(
      path.join(env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    );
  }

  return candidates;
}

function findChromeExecutable({ chromePath, env = process.env } = {}) {
  if (chromePath === false) return null;
  const candidates = chromePath ? [chromePath] : chromeExecutableCandidates(env);
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openWebSocket(url) {
  if (!globalThis.WebSocket) {
    throw new Error("global WebSocket is unavailable in this Node runtime");
  }

  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error(`WebSocket open timed out: ${url}`)), 10000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    }, { once: true });
    socket.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${event.message ?? "unknown error"}`));
    }, { once: true });
  });
}

function messageDataToString(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return String(data);
}

async function waitForChromeWebSocket(child) {
  let stderr = "";
  let settled = false;
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Chrome did not expose DevTools WebSocket within 10s: ${stderr.slice(-1000)}`));
    }, 10000);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(match[1]);
    });

    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools was ready: code=${code} signal=${signal} ${stderr.slice(-1000)}`));
    });
  });
}

async function closeChrome(child, userDataDir) {
  let closed = false;
  const closePromise = new Promise((resolve) => {
    child.once("close", () => {
      closed = true;
      resolve();
    });
  });
  child.kill("SIGTERM");
  await Promise.race([closePromise, sleep(3000)]);
  if (!closed) child.kill("SIGKILL");
  await rm(userDataDir, { recursive: true, force: true });
}

async function runChromeCdpSmoke({ previewUrl, chromePath }) {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "better-harness-chrome-smoke-"));
  const child = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  try {
    const browserWsUrl = await waitForChromeWebSocket(child);
    const browserUrl = new URL(browserWsUrl);
    const baseUrl = `http://${browserUrl.hostname}:${browserUrl.port}`;
    let targetResponse = await fetch(`${baseUrl}/json/new?${encodeURIComponent(previewUrl)}`, { method: "PUT" });
    if (!targetResponse.ok) {
      targetResponse = await fetch(`${baseUrl}/json/new?${encodeURIComponent(previewUrl)}`);
    }
    if (!targetResponse.ok) {
      throw new Error(`/json/new returned ${targetResponse.status}: ${await targetResponse.text()}`);
    }

    const target = await targetResponse.json();
    const socket = await openWebSocket(target.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const errors = [];
    let loadResolve;
    const loadPromise = new Promise((resolve) => {
      loadResolve = resolve;
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(messageDataToString(event.data));
      if (message.id && pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) {
          reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`.trim()));
        } else {
          resolve(message.result);
        }
        return;
      }

      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        errors.push(`page exception: ${details?.exception?.description ?? details?.text ?? "unknown exception"}`);
      } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        const text = message.params.args?.map((arg) => arg.value ?? arg.description ?? arg.type).join(" ");
        errors.push(`console error: ${text}`);
      } else if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry?.level)) {
        errors.push(`${message.params.entry.level}: ${message.params.entry.text}`);
      } else if (message.method === "Page.loadEventFired") {
        loadResolve();
      }
    });

    const send = (method, params = {}) => {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, 10000);
        pending.set(id, { resolve, reject, timer });
      });
    };

    await send("Runtime.enable");
    await send("Log.enable");
    await send("Page.enable");
    await send("Page.navigate", { url: previewUrl });
    const loaded = await Promise.race([loadPromise.then(() => true), sleep(10000).then(() => false)]);
    if (!loaded) {
      errors.push("page load timed out");
    }
    await sleep(1500);
    const bodyText = await send("Runtime.evaluate", {
      expression: "document.body?.innerText?.trim() ?? ''",
      returnByValue: true,
    });
    if (!String(bodyText.result?.value ?? "").trim()) {
      errors.push("blank body");
    }
    socket.close();

    return check("browser-smoke", errors, [], {
      summary: {
        engine: "chrome-cdp",
        executable: chromePath,
      },
    });
  } finally {
    await closeChrome(child, userDataDir);
  }
}

async function runBrowserSmoke({
  previewUrl,
  loadPlaywright = defaultLoadPlaywright,
  chromePath,
  env = process.env,
}) {
  let browser;
  try {
    const { chromium } = await loadPlaywright();
    browser = await chromium.launch({ headless: true });
    const errors = [];
    const viewports = [
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ];

    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console error: ${message.text()}`);
      });
      page.on("pageerror", (error) => errors.push(`page error: ${error.message}`));
      await page.goto(previewUrl, { waitUntil: "networkidle" });
      const bodyText = await page.locator("body").innerText();
      if (!bodyText.trim()) {
        errors.push(`blank body at ${viewport.width}x${viewport.height}`);
      }
      await page.close();
    }

    return check("browser-smoke", errors, [], { summary: { engine: "playwright" } });
  } catch (error) {
    const executable = findChromeExecutable({ chromePath, env });
    if (!executable) {
      return skippedCheck("browser-smoke", `Playwright unavailable and Chrome fallback not found: ${String(error?.message ?? error)}`);
    }
    try {
      return await runChromeCdpSmoke({ previewUrl, chromePath: executable });
    } catch (chromeError) {
      return check("browser-smoke", [`Chrome browser smoke failed after Playwright was unavailable: ${String(chromeError?.message ?? chromeError)}`]);
    }
  } finally {
    await browser?.close();
  }
}

function summarize(checks) {
  const errors = checks.flatMap((item) => item.errors.map((error) => `${item.id}: ${error}`));
  const warnings = checks.flatMap((item) => item.warnings.map((warning) => `${item.id}: ${warning}`));
  const hasSkippedBrowser = checks.some((item) => item.id === "browser-smoke" && item.status === "skip");
  return {
    errors,
    warnings,
    status: errors.length > 0 ? "fail" : warnings.length > 0 || hasSkippedBrowser ? "warn" : "pass",
  };
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function commandPayload(args) {
  return {
    argv: args,
    command: args.map(shellQuote).join(" "),
  };
}

function validationCommand({ reportPath, canvasPath, findingsPath }) {
  const args = [
    "node",
    path.join(__dirname, "validate-canvas.mjs"),
  ];
  if (reportPath) args.push("--report", reportPath);
  args.push("--canvas", canvasPath);
  if (findingsPath) args.push("--findings", findingsPath);
  return commandPayload(args);
}

function repairHintForCheck(check, { findingsPath }) {
  if (check.id === "findings-json" && findingsPath) {
    return {
      check: check.id,
      action: "repair-findings-json",
      reason: "findings.json schema or handoff prompts are blocking validation",
      safetyNote: "Run the repair command directly; do not create .bak or other extra files in the harness output folder.",
      command: commandPayload([
        "node",
        path.join(__dirname, "repair-findings-json.mjs"),
        "--findings",
        findingsPath,
        "--write",
      ]),
      sampleErrors: check.errors.slice(0, 8),
    };
  }
  if (check.id === "canvas-quality") {
    return {
      check: check.id,
      action: "repair-canvas",
      reason: "Canvas structure or AI handoff bindings are blocking validation",
      sampleErrors: check.errors.slice(0, 8),
    };
  }
  return {
    check: check.id,
    action: "inspect-check-errors",
    reason: `${check.id} is blocking validation`,
    sampleErrors: check.errors.slice(0, 8),
  };
}

function agentValidationSummary({ summary, checks, reportPath, canvasPath, findingsPath }) {
  const failedChecks = checks.filter((check) => check.status === "fail");
  const warningChecks = checks.filter((check) => check.status === "warn" || check.status === "skip");
  return {
    ok: summary.status !== "fail",
    status: summary.status,
    completion: summary.status === "fail"
      ? "do-not-complete"
      : summary.status === "warn"
        ? "complete-with-warnings"
        : "complete",
    failedChecks: failedChecks.map((check) => check.id),
    warningChecks: warningChecks.map((check) => check.id),
    blockingErrorCount: summary.errors.length,
    warningCount: summary.warnings.length,
    primaryFailure: failedChecks[0]?.id ?? null,
    repairHints: failedChecks.map((check) => repairHintForCheck(check, { findingsPath })),
    verificationCommand: validationCommand({ reportPath, canvasPath, findingsPath }),
  };
}

export async function validateHarnessCanvasArtifacts({
  reportPath,
  canvasPath,
  findingsPath,
  canvasDataPath,
  repoRoot = defaultRepoRoot,
  sdkRoot,
  sdkMedia,
  sdkDeclarationsPath,
  platform,
  preview = false,
  browser = false,
  env = process.env,
  loadPlaywright = defaultLoadPlaywright,
  chromePath,
} = {}) {
  if (!canvasPath) throw new Error("--canvas is required");

  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedSdkRoot = sdkRoot ? path.resolve(sdkRoot) : undefined;
  const resolvedReportPath = reportPath ? path.resolve(resolvedRepoRoot, reportPath) : null;
  const resolvedCanvasPath = path.resolve(resolvedRepoRoot, canvasPath);
  const resolvedFindingsPath = findingsPath
    ? path.resolve(resolvedRepoRoot, findingsPath)
    : findingsPathForCanvas(resolvedCanvasPath);
  const resolvedCanvasDataPath = canvasDataPath
    ? path.resolve(resolvedRepoRoot, canvasDataPath)
    : canvasDataPathForCanvas(resolvedCanvasPath);
  const reportText = resolvedReportPath ? readFileSync(resolvedReportPath, "utf8") : null;
  const canvasText = readFileSync(resolvedCanvasPath, "utf8");
  const findingsText = resolvedFindingsPath && existsSync(resolvedFindingsPath)
    ? readFileSync(resolvedFindingsPath, "utf8")
    : null;
  const canvasDataText = resolvedCanvasDataPath && existsSync(resolvedCanvasDataPath)
    ? readFileSync(resolvedCanvasDataPath, "utf8")
    : null;
  const resolvedPlatform = resolveArtifactPlatform({ platform, canvasDataText, findingsText });
  const resolvedSdkDeclarationsPath = sdkDeclarationsPath
    ? path.resolve(sdkDeclarationsPath)
    : defaultSdkDeclarationsPath({
      canvasPath: resolvedCanvasPath,
      repoRoot: resolvedRepoRoot,
      platform: resolvedPlatform,
      env,
    });
  const evidenceText = findingsText ?? "";

  const isTaskLoop = isTaskLoopFindingsText(findingsText);
  const canvasQuality = isTaskLoop
    ? evaluateTaskLoopCanvasQuality(canvasText)
    : evaluateHarnessCanvasQuality(canvasText, { evidenceText });
  const checks = [
    check("canvas-quality", canvasQuality.errors, canvasQuality.warnings, { summary: canvasQuality.summary }),
    evaluateCanvasFindingsSource(canvasText, {
      requireCanvasData: isTaskLoop,
    }),
    evaluateRuntimeBoundaries(canvasText, {
      sdkDeclarationsPath: resolvedSdkDeclarationsPath,
      platform: resolvedPlatform,
    }),
    evaluateTransform(canvasText, {
      canvasPath: resolvedCanvasPath,
      repoRoot: resolvedRepoRoot,
      sdkRoot: resolvedSdkRoot,
    }),
  ];
  if (reportText !== null) {
    const reportQuality = evaluateHarnessReportQuality(reportText);
    checks.unshift(check("report-quality", reportQuality.errors, reportQuality.warnings, { summary: reportQuality.summary }));
    checks.splice(3, 0, evaluateReportCanvasParity(reportText, canvasText, { evidenceText }));
  } else {
    checks.unshift(check("report-quality", [], [], {
      summary: { skipped: true, reason: "report.md not provided for Canvas-only validation" },
    }));
    checks.splice(3, 0, check("markdown-canvas-parity", [], [], {
      summary: { skipped: true, reason: "report.md not provided for Canvas-only validation" },
    }));
  }

  if (resolvedFindingsPath) {
    if (findingsText !== null) {
      checks.push(evaluateFindingsJson(findingsText, reportText, canvasDataText));
    } else {
      checks.push(check("findings-json", [`findings.json not found: ${resolvedFindingsPath}`]));
    }
  }

  if (preview || browser) {
    let previewServer;
    let previewCheck;
    try {
      previewServer = await createCanvasPreviewServer({
        canvasPath: resolvedCanvasPath,
        host: "127.0.0.1",
        port: 0,
        watch: false,
        open: false,
        repoRoot: resolvedRepoRoot,
        sdkRoot: resolvedSdkRoot,
        sdkMedia,
        env,
      });
      previewCheck = await checkPreviewServer(previewServer);
      checks.push(previewCheck);

      if (browser) {
        checks.push(previewCheck.status === "pass"
          ? await runBrowserSmoke({
            previewUrl: previewServer.url,
            loadPlaywright,
            chromePath,
            env,
          })
          : skippedCheck("browser-smoke", "Browser smoke skipped because preview-smoke did not pass"));
      }
    } catch (error) {
      previewCheck = check("preview-smoke", [String(error?.message ?? error)]);
      checks.push(previewCheck);
      if (browser) {
        checks.push(skippedCheck("browser-smoke", "Browser smoke skipped because preview-smoke did not pass"));
      }
    } finally {
      await previewServer?.close();
    }
  }

  const summary = summarize(checks);
  const agentSummary = agentValidationSummary({
    summary,
    checks,
    reportPath: resolvedReportPath,
    canvasPath: resolvedCanvasPath,
    findingsPath: resolvedFindingsPath,
    canvasDataPath: resolvedCanvasDataPath,
  });
  return {
    kind: "harness-canvas-validation",
    ok: agentSummary.ok,
    status: summary.status,
    agentSummary,
    reportPath: resolvedReportPath,
    canvasPath: resolvedCanvasPath,
    findingsPath: resolvedFindingsPath,
    platform: resolvedPlatform,
    sdkDeclarationsPath: resolvedSdkDeclarationsPath,
    checks,
    errors: summary.errors,
    warnings: summary.warnings,
  };
}

function parseArgs(argv) {
  const args = {
    preview: false,
    browser: false,
    json: false,
    repoRoot: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--report") {
      args.reportPath = argv[++index];
    } else if (arg === "--canvas") {
      args.canvasPath = argv[++index];
    } else if (arg === "--findings") {
      args.findingsPath = argv[++index];
    } else if (arg === "--repo-root") {
      args.repoRoot = argv[++index];
    } else if (arg === "--sdk-root") {
      args.sdkRoot = argv[++index];
    } else if (arg === "--sdk-media") {
      args.sdkMedia = argv[++index];
    } else if (arg === "--sdk-declarations") {
      args.sdkDeclarationsPath = argv[++index];
    } else if (arg === "--platform") {
      args.platform = argv[++index];
    } else if (arg === "--chrome-path") {
      args.chromePath = argv[++index];
    } else if (arg === "--preview") {
      args.preview = true;
    } else if (arg === "--browser") {
      args.browser = true;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await validateHarnessCanvasArtifacts(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "fail" ? 1 : 0;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exit(1);
  });
}
