#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_SECTIONS = [
  "Executive Verdict",
  "Evidence Boundary",
  "Risk Findings",
  "Readiness Scorecard",
  "Signals And Diagnosis",
  "Action Pathways",
  "Unverified Items",
];

const LEGACY_REQUIRED_SECTION_KEYS = [
  "executiveVerdict",
  "evidenceBoundary",
  "riskFindings",
  "readinessScorecard",
  "signalsAndDiagnosis",
  "actionPathways",
  "unverifiedItems",
];

const COMPACT_REQUIRED_SECTION_KEYS = [
  "projectOverview",
  "whatIsWorking",
  "harnessDimensions",
  "issueFindings",
  "aiAgentPractices",
  "notesAndMethod",
];

const LEGACY_COMPACT_REQUIRED_SECTION_KEYS = [
  "projectOverview",
  "harnessDimensions",
  "issueFindings",
  "nextRecommendations",
  "notesAndMethod",
];

const COMPACT_REQUIRED_SECTION_VARIANTS = [
  COMPACT_REQUIRED_SECTION_KEYS,
  LEGACY_COMPACT_REQUIRED_SECTION_KEYS,
];

const COMPACT_SIGNAL_SECTION_KEYS = [
  ...new Set(COMPACT_REQUIRED_SECTION_VARIANTS.flat().filter((key) => key !== "projectOverview")),
];

const SECTION_LABELS = {
  projectOverview: ["Project Overview", "项目简介"],
  whatIsWorking: ["What Is Working", "已有基础", "可复用基础"],
  executiveVerdict: ["Executive Verdict", "执行结论"],
  evidenceBoundary: ["Evidence Boundary", "证据边界"],
  riskFindings: ["Risk Findings", "风险发现"],
  readinessScorecard: ["Readiness Scorecard", "就绪度记分卡"],
  signalsAndDiagnosis: ["Signals And Diagnosis", "信号与诊断"],
  actionPathways: ["Action Pathways", "行动路径"],
  unverifiedItems: ["Unverified Items", "未验证事项"],
  harnessDimensions: ["Harness Dimensions", "Harness Dimension Assessment", "Harness 维度评估", "5个维度评估", "五个维度评估"],
  issueFindings: ["Issue Findings", "问题发现"],
  aiAgentPractices: ["AI Agent Practices", "Coding Agent Practices", "AI Agent 实践", "智能体实践", "编码代理实践"],
  nextRecommendations: ["Next Recommendations", "后续建议"],
  notesAndMethod: ["Notes And Method", "Notes and Method", "其他说明", "方法说明", "说明与方法"],
};

const IMPACT_LABELS = ["High", "Medium", "Low", "高", "中", "低"];
const TIMING_LABELS = ["Now", "Next", "Later", "现在", "下一步", "稍后"];
const PRIORITY_QUADRANT_RE = /<\s*PriorityQuadrantChart\b/;
const PRIORITY_QUADRANT_TAG_RE = /<\s*PriorityQuadrantChart\b[\s\S]*?(?:\/>|>)/g;
const BAR_LINE_CHART_TAG_RE = /<\s*(BarChart|LineChart)\b[\s\S]*?\/>/g;
const TABLE_TAG_RE = /<\s*Table\b[\s\S]*?\/>/g;
const STACK_TAG_RE = /<\s*Stack\b[^>]*(?:\/>|>)/g;
const TAG_TAG_RE = /<\s*Tag\b[^>]*(?:\/>|>)/g;
const STAT_TAG_RE = /<\s*Stat\b[^>]*(?:\/>|>)/g;
const PRIORITY_IMPACT_AXIS_RE = /\bimpact\b|影响力|影响|价值|收益/i;
const PRIORITY_EFFORT_AXIS_RE = /\beffort\b|\bcomplexity\b|复杂|成本|工作量|实施|难度/i;
const CANVAS_CHART_VISUAL_TAG_RE = /<\s*(BarChart|LineChart|PieChart|RadarChart|RadialBarChart|MultiplierBubbleChart|PriorityQuadrantChart|RiskHeatmap|CapabilityHexMap|Progress)\b/g;

const LEGACY_RISK_FIELDS = [
  ["severity", labelsRe(["Severity", "严重性"])],
  ["evidence", labelsRe(["Evidence", "Evidence strength", "证据", "证据强度"])],
  ["recommendation", labelsRe(["Recommendation", "Suggested action", "Next action", "Risk if unfixed", "Action", "建议", "未修复风险", "风险"])],
  ["pass check", labelsRe(["Pass check", "通过检查"])],
];

const COMPACT_RISK_FIELDS = [
  ["severity", labelsRe(["Severity", "严重性"])],
  ["reason", labelsRe(["Reason", "原因", "理由"])],
  ["dimension", labelsRe(["Dimension", "Dimensions", "维度"])],
];

const RISK_FIELD_VARIANTS = [LEGACY_RISK_FIELDS, COMPACT_RISK_FIELDS];

const LEGACY_CANVAS_RISK_FIELDS = [
  ["severity", /\bseverity\b/i],
  ["evidence", /\bevidence\b|\bevidenceStrength\b|\bevidence strength\b/i],
  ["recommendation", /\brecommendation\b|\briskIfUnfixed\b|\brisk if unfixed\b/i],
  ["passCheck", /\bpassCheck\b|\bpass check\b/i],
];

const COMPACT_CANVAS_RISK_FIELDS = [
  ["severity", /\bseverity\b/],
  ["reason", /\breason\b/],
  ["aiFixPrompt", /\baiFixPrompt\b/],
];

const CANVAS_RISK_FIELD_VARIANTS = [COMPACT_CANVAS_RISK_FIELDS, LEGACY_CANVAS_RISK_FIELDS];

const FLUENCY_SCALE_PROPS = [
  ["min", /\bmin\s*=\s*\{\s*1\s*\}/],
  ["max", /\bmax\s*=\s*\{\s*5\s*\}/],
  ["mediumThreshold", /\bmediumThreshold\s*=\s*\{\s*3\s*\}/],
  ["highThreshold", /\bhighThreshold\s*=\s*\{\s*4\s*\}/],
];

const FIVE_PROJECT_CAPABILITY_LABELS = [
  "Context Map",
  "Environment Readiness",
  "Fast Feedback",
  "Quality Gates",
  "Change Safety",
];
const OLD_DIMENSION_GUIDE_RE = /(?:5R Dimension Guide|5R 维度说明|5R 维度导读|DIMENSION_GUIDE|dimensionGuide)/i;
const DIAGNOSTIC_MODEL_NOTES_HEADING_RE = /^##\s+(?:Diagnostic Model Notes|Diagnostic Model Guide|Diagnostic Model Explanation|诊断模型说明)(?:\s|$)/im;
const CANVAS_DIAGNOSTIC_MODEL_NOTES_RE = /(?:\bDIAGNOSTIC_MODEL_NOTES\b|\bdiagnosticModelNotes\b|<H[1-3]>\s*(?:Diagnostic Model Notes|诊断模型说明)\s*<\/H[1-3]>|\b(?:title|heading|label|sectionTitle)\s*[:=]\s*(["'`])(?:Diagnostic Model Notes|诊断模型说明)\1)/i;
const AI_PRACTICE_SCOPE_RE = /(?:coding[- ]agent practice scope|ai agent practice scope|ai agent 实践范围|智能体实践范围|编码代理实践范围)\s*[:：]\s*([^\n]+)/i;
const AI_PRACTICE_SCOPE_NEGATIVE_RE = /^\s*(?:(?:not in scope|out of scope|not inspected|none|n\/a|not applicable)\b|(?:未纳入|未检查|不在范围|不适用|无)(?:\s|。|$))/i;
const AI_PRACTICE_SECTION_RE = /^(#{2,4})\s+(?:AI Agent Practices|Coding Agent Practices|AI Agent 实践|智能体实践|编码代理实践)(?:\s|$)/im;
const AI_PRACTICE_LABEL_RE = /^\s*\*\*(?:AI Agent Practices|Coding Agent Practices|AI Agent 实践|智能体实践|编码代理实践)\s*[:：]?\*\*\s*$/im;
const AI_PRACTICE_SURFACE_RE = /\b(?:Rules|Hooks|Skills|Custom Agents|MCP|Plugins|Session Insights|Sessions|DESIGN\.md|Design Tokens?|Design Contract|design-token contract)\b|规则|技能|自定义\s*(?:Agent|智能体)|插件|会话洞察|会话|设计(?:令牌|契约)/i;
const AI_PRACTICE_SESSION_SCOPE_RE = /(?:\.qoder|\.codex|\.claude|\.cursor|\.qwen|\.copilot|\.pi\b|\.workbuddy|qoder|codex|claude|cursor|qwen|copilot|\bpi\b|workbuddy|session-analysis|session sources|session evidence|会话分析|会话证据)/i;
const AI_READINESS_DIMENSION_RE = /\bAI Readiness\b|\bAI Agent Readiness\b|AI\s*(?:就绪度|就绪|准备度)/i;
const SESSION_SOURCES_RE = /session-analysis\.mjs\s+sources/i;
const SESSION_BOUNDARY_RE = /session-analysis\.mjs\s+(?:sources\s+and\s+)?facets|no enabled roots|no enabled session|no sessions|no session(?: analysis)? evidence|no agent session logs|no execution history|no proof of agent workflow|no-session boundary|source probe failed|session-analysis (?:was )?not run|session sources.*none|qoder\/codex session sources.*none|没有启用.*(?:root|session|根|会话)|没有.*会话|源探测失败/i;
const NO_VALIDATION_PATH_RE = /(?:no|without)\s+(?:credible\s+)?(?:runnable|executable|executed|local)?\s*(?:validation|build|test|lint|typecheck|ci)\s+(?:path|evidence|observed|found|inspected|executed)|nothing\s+(?:was\s+)?executed|runtime and CI (?:were|was) not inspected|no project build, test, CI, runtime, or UI validation|没有(?:可运行|可执行|已执行)?(?:验证|测试|构建|CI)|未执行(?:验证|测试|构建|CI)/i;
const ADVANCED_LEVEL_RE = /\b(?:readiness|verdict|current state|level|maturity|就绪|结论|等级|成熟度)[^.\n|]{0,80}\bL[45]\b|\bL[45]\b[^.\n|]{0,80}(?:readiness|verdict|level|maturity|就绪|结论|等级|成熟度)/i;
const HIGH_SCORE_RE = /(?:(?:better_harness|better_loop)_score_0_100|score|static evidence index|readiness index|overall rating|分数|得分|指数)[^0-9\n]{0,32}(?:7[5-9]|[89][0-9]|100)\b/i;
const VISIBLE_LEVEL_WORD_RE = /\|\s*(?:Level|Rating)\s*\||\b(?:Current|Target|Readiness|Maturity|Overall|AI Readiness|current|target|readiness|maturity|overall|ai readiness)\s+(?:level|rating)\b|\b(?:Level|Rating)\s*:\s*|(?:等级|级别)/;
const CURRENT_L2_L3_RE = /(?:current|当前)[^.\n|]{0,120}(?:L2\s*[-–]\s*L3|L3 candidate|L3 候选)|(?:L2\s*[-–]\s*L3|L3 candidate|L3 候选)[^.\n|]{0,80}(?:boundary|candidate|current|当前|边界|候选)/i;
const TARGET_L4_LINE_RE = /^.*(?:target|目标)[^\n]*\bL4\b.*$/gim;
const ASPIRATIONAL_TARGET_RE = /(?:strategic|aspirational|north[- ]?star|long[- ]?term|future-state|战略|远期|长期|愿景)/i;
const NEAR_TERM_L3_RE = /(?:near[- ]term|next[- ]step|next stable|intermediate|closure|下一步|下一阶段|近[期程]|中间|先|补齐)[^.\n]{0,100}\bL3\b|\bL3\b[^.\n]{0,100}(?:closure|gate|闭环|补齐)/i;
const LOW_SCORE_THRESHOLD = 50;
const HEADLINE_READINESS_SCORE_RE = /(?:\bReadiness score\b|当前分数|当前得分|就绪度分数|就绪分数|readiness_score|(?:better_harness|better_loop)_score_0_100)[^0-9\n]{0,48}(\d{1,3})(?:\s*\/\s*100)?/gi;
const AI_READINESS_INLINE_SCORE_RE = /(?:\bAI Readiness\b|\bAI Agent Readiness\b|AI\s*(?:就绪度|就绪|准备度))[^0-9\n]{0,48}(\d{1,3})(?:\s*\/\s*100)?/gi;
const CANVAS_SCORE_OBJECT_RE = /\b(?:dimension|label)\s*:\s*(["'`])(?:AI Readiness|AI Agent Readiness|AI\s*(?:就绪度|就绪|准备度)|Readiness score)\1[\s\S]{0,180}?\b(?:score|value)\s*:\s*(\d{1,3})\b/gi;
const SCHEDULE_HANDOFF_RE = /\/schedule\b/i;
const HARNESS_RE = /(?:^|\s)\/better-harness(?:\s|$)|\bharness\b/i;
const SCHEDULE_STOP_CONDITION_RE = /stop[_ -]?condition|stop when|until score|停止条件|直到|连续两次|after (?:four|\d+) runs?/i;
const SCHEDULE_LABEL_RE = /\bSchedule follow-up\b|定期复查|安排复查/i;
const SCHEDULE_TARGET_RE = /\bTarget\s*[:=]|目标\s*[:：=]/i;
const SCHEDULE_FINDING_RE = /\bFinding\s*[:=]|发现\s*[:：=]|\bAIA-[A-Z0-9-]+/i;
const SCHEDULE_EVIDENCE_RE = /\bEvidence\s*[:=]|证据\s*[:：=]/i;
const SCHEDULE_CADENCE_OR_TRIGGER_RE = /\b(?:cadence|trigger|weekly|daily|monthly|schedule|recurring)\b|每周|每日|每月|周期|触发|定期/i;
const SCHEDULE_ACCEPTANCE_RE = /\bAcceptance\s*[:=]|\bPass check\b|验收\s*[:：=]|通过检查/i;
const SCHEDULE_VALIDATION_RE = /\bValidation(?: command)?\s*[:=]|\bvalidation[_ -]?command\b|\b(?:validate|npm|node|go test|make|pytest|cargo test|task test)\b|验证命令|验证\s*[:：=]/i;
const SCHEDULE_RISK_RE = /\bRisk boundary\s*[:=]|\brisk\b|风险边界|风险\s*[:：=]/i;
const SCHEDULE_SAFETY_RE = /\bSafety note\s*[:=]|\bsafety\b|\bdo not\b|\bavoid\b|安全提示|安全\s*[:：=]|不要|不修改/i;
const LOOP_DISCOVERY_RE = /\bLoop Discovery\b|\bloopDiscovery\b|loop-discovery/i;
const LOOP_DISCOVERY_SCHEDULE_READY_RE = /schedule[-_ ]ready|schedule_handoff|schedule\s+follow-up|scheduled?\s+(?:re-?check|reassessment|follow-up)|recurring\s+(?:harness|re-?check|reassessment|follow-up|validation|loop)|cadence\s*[:=]/i;
const LOOP_DISCOVERY_NEEDS_MORE_EVIDENCE_RE = /needs more evidence|human[- ]gated|human judgment|人工判断|证据不足/i;
const SCHEDULE_HANDOFF_REQUIREMENTS = [
  SCHEDULE_LABEL_RE,
  SCHEDULE_HANDOFF_RE,
  HARNESS_RE,
  SCHEDULE_TARGET_RE,
  SCHEDULE_FINDING_RE,
  SCHEDULE_EVIDENCE_RE,
  SCHEDULE_CADENCE_OR_TRIGGER_RE,
  SCHEDULE_ACCEPTANCE_RE,
  SCHEDULE_VALIDATION_RE,
  SCHEDULE_RISK_RE,
  SCHEDULE_SAFETY_RE,
  SCHEDULE_STOP_CONDITION_RE,
];
const GENERIC_OWNERSHIP_GAP_TITLES = [
  "Core code ownership missing",
  "Core path ownership missing",
  "Code ownership missing",
  "Missing code ownership",
  "Ownership missing",
  "Unclear code ownership",
  "核心代码所有权缺失",
  "核心路径所有权缺失",
  "代码所有权缺失",
  "代码所有权不明确",
  "所有权缺失",
];
const CANVAS_FIRST_H2_LABELS = new Set([
  "Software Fluency",
  "Agent Work Loop",
  "Harness Dimensions",
  "Capability Matrix",
  "Score Dimensions",
  "Diagnostic Signals",
  "Audit Matrix",
  "Transformation Roadmap",
  "AI Readiness",
]);
const CANVAS_CANONICAL_TRAILING_H2_HEADINGS = [
  "Findings And AI Actions",
  "Suggestions",
  "Dimension And Method Notes",
];
const CANVAS_MIN_READER_H2_COUNT = 1 + CANVAS_CANONICAL_TRAILING_H2_HEADINGS.length;
const CANVAS_LEGACY_AGGREGATE_H2_RE = /^(?:Issue\s+Distribution|问题分布)$/i;

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelsRe(labels) {
  return new RegExp(labels.map(escapeRe).join("|"), "i");
}

function normalizeVisibleTitle(value) {
  return String(value ?? "")
    .replace(/[`*_]/g, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[。.:：；;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const GENERIC_OWNERSHIP_GAP_TITLE_SET = new Set(
  GENERIC_OWNERSHIP_GAP_TITLES.map((title) => normalizeVisibleTitle(title)),
);

function isGenericOwnershipGapTitle(value) {
  return GENERIC_OWNERSHIP_GAP_TITLE_SET.has(normalizeVisibleTitle(value));
}

function sectionRe(section) {
  const labels = SECTION_LABELS[section] ?? [section];
  return new RegExp(`^##\\s+(?:${labels.map(escapeRe).join("|")})(?:\\s|$)`, "im");
}

function markdownSectionText(text, section) {
  const match = sectionRe(section).exec(text);
  if (!match) return "";

  const rest = text.slice(match.index + match[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  return nextHeading ? rest.slice(0, nextHeading.index) : rest;
}

function presentSections(text, keys) {
  return keys.filter((key) => sectionRe(key).test(text));
}

function markdownReportShape(text) {
  const compactSignalPresent = presentSections(text, COMPACT_SIGNAL_SECTION_KEYS);
  if (compactSignalPresent.length > 0) {
    const variants = COMPACT_REQUIRED_SECTION_VARIANTS.map((requiredKeys) => {
      const present = presentSections(text, requiredKeys);
      return {
        requiredKeys,
        missingKeys: requiredKeys.filter((key) => !present.includes(key)),
      };
    }).sort((left, right) => left.missingKeys.length - right.missingKeys.length);
    const compact = variants[0];
    return {
      shape: compact.missingKeys.length > 0 ? "compact-incomplete" : "compact",
      requiredKeys: compact.requiredKeys,
      missingKeys: compact.missingKeys,
    };
  }

  const legacyMissing = LEGACY_REQUIRED_SECTION_KEYS.filter((key) => !sectionRe(key).test(text));
  return {
    shape: legacyMissing.length > 0 ? "legacy-incomplete" : "legacy",
    requiredKeys: LEGACY_REQUIRED_SECTION_KEYS,
    missingKeys: legacyMissing,
  };
}

function requiredMarkdownSectionErrors(text) {
  const shape = markdownReportShape(text);
  return shape.missingKeys.map((key) => `missing section: ${SECTION_LABELS[key][0]}`);
}

function markdownDimensionSectionText(text) {
  return markdownSectionText(text, "harnessDimensions") || markdownSectionText(text, "readinessScorecard");
}

function markdownTableCells(line) {
  if (!line.includes("|")) return null;

  const cells = line.trim().split("|").map((cell) => cell.trim());
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells.length ? cells : null;
}

function isMarkdownTableSeparator(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function targetColumnL4Rows(text) {
  const rows = [];
  let targetColumnLabels = [];

  for (const line of text.split(/\r?\n/)) {
    const cells = markdownTableCells(line);
    if (!cells) {
      targetColumnLabels = [];
      continue;
    }

    if (isMarkdownTableSeparator(cells)) continue;

    const headerTargetLabels = cells.map((cell, index) => (
      /(?:target|目标)/i.test(cell) ? [index, cell] : null
    )).filter(Boolean);
    if (headerTargetLabels.length > 0) {
      targetColumnLabels = [];
      for (const [index, label] of headerTargetLabels) {
        targetColumnLabels[index] = label;
      }
      continue;
    }

    for (const [index, label] of targetColumnLabels.entries()) {
      if (label && /\bL4\b/.test(cells[index] ?? "")) {
        rows.push(`${label} column row: ${line.trim()}`);
      }
    }
  }

  return rows;
}

function hasWeakEvidenceMode(text) {
  return /analysis mode:\s*.*(?:small-sample|static-only|evidence-pack-only)|static-only evidence|small-sample/i.test(text);
}

function hasUnsupportedL3Claim(text) {
  return /everything else[^.\n]*\bL3\b/i.test(text)
    || /\blow-effort\b/i.test(text)
    || /readiness (?:level|verdict):?\s*\*?\*?L3\b/i.test(text);
}

function textWithoutCapThresholdPhrases(text) {
  return String(text ?? "").replace(/\b(?:cap(?:ped)?|below|under|less than|<)\s*75\b/gi, "");
}

function advancedScoreWithoutValidationErrors(text) {
  if (!NO_VALIDATION_PATH_RE.test(text)) return [];
  if (!ADVANCED_LEVEL_RE.test(text) && !HIGH_SCORE_RE.test(textWithoutCapThresholdPhrases(text))) return [];

  return [
    "high score requires an observed runnable validation path; cap static-only reports below 75",
  ];
}

function visibleLevelErrors(text, mode = "report") {
  const errors = [];
  if (VISIBLE_LEVEL_WORD_RE.test(text)) {
    errors.push(`${mode} exposes unqualified Level/Rating/等级/级别 language; use explicit scale, stage, score, or matrix labels`);
  }
  return errors;
}

function targetLevelJumpErrors(text) {
  if (!CURRENT_L2_L3_RE.test(text)) return [];

  const targetText = [
    markdownSectionText(text, "executiveVerdict"),
    markdownSectionText(text, "readinessScorecard"),
    markdownSectionText(text, "signalsAndDiagnosis"),
    markdownSectionText(text, "actionPathways"),
    markdownSectionText(text, "harnessDimensions"),
    markdownSectionText(text, "issueFindings"),
    markdownSectionText(text, "nextRecommendations"),
    markdownSectionText(text, "notesAndMethod"),
  ].filter(Boolean).join("\n\n") || text;

  TARGET_L4_LINE_RE.lastIndex = 0;
  const targetL4Lines = [
    ...[...targetText.matchAll(TARGET_L4_LINE_RE)].map((match) => match[0].trim()),
    ...targetColumnL4Rows(targetText),
  ];
  if (targetL4Lines.length === 0) return [];

  const bareTarget = targetL4Lines.find((line) => !ASPIRATIONAL_TARGET_RE.test(line));
  if (bareTarget) {
    return [
      `bare L4 target from L2-L3 current state: "${bareTarget}"; use near-term L3 target or label L4 as strategic/aspirational`,
    ];
  }

  if (!NEAR_TERM_L3_RE.test(targetText)) {
    return [
      "strategic or aspirational L4 target from L2-L3 current state must also name the near-term L3 closure gate",
    ];
  }

  return [];
}

function hasOneToFiveFluencyWithoutScale(text) {
  if (!/<Fluency\b/.test(text)) return false;
  if (!/\bscore\s*:\s*[1-5]\b/.test(text)) return false;
  return FLUENCY_SCALE_PROPS.some(([, pattern]) => !pattern.test(text));
}

function hasAllFiveProjectCapabilityLabels(text) {
  return FIVE_PROJECT_CAPABILITY_LABELS.every((label) => new RegExp(`\\b${label}\\b`).test(text));
}

function hasCanvasDiagnosticModelNotes(text) {
  return CANVAS_DIAGNOSTIC_MODEL_NOTES_RE.test(text);
}

function diagnosticModelNotesMarkdownErrors(text) {
  const errors = [];

  if (OLD_DIMENSION_GUIDE_RE.test(text)) {
    errors.push("uses old 5R Dimension Guide / 5R 维度说明; integrate capability model notes only when methodology is requested");
  }

  return errors;
}

function diagnosticModelNotesCanvasErrors(text) {
  const errors = [];

  if (OLD_DIMENSION_GUIDE_RE.test(text)) {
    errors.push("uses old 5R Dimension Guide / 5R 维度说明; integrate capability model notes only when methodology is requested");
  }

  return errors;
}

function aiPracticeScopeValue(text) {
  const match = AI_PRACTICE_SCOPE_RE.exec(text);
  return match?.[1] ?? null;
}

function hasInScopeAiPractice(text) {
  const value = aiPracticeScopeValue(text);
  return Boolean(value && !AI_PRACTICE_SCOPE_NEGATIVE_RE.test(value));
}

function hasAiPracticeSessionScope(text) {
  const value = aiPracticeScopeValue(text);
  return Boolean(value && !AI_PRACTICE_SCOPE_NEGATIVE_RE.test(value) && AI_PRACTICE_SESSION_SCOPE_RE.test(value));
}

function aiPracticeSectionText(text) {
  const match = AI_PRACTICE_SECTION_RE.exec(text);
  if (!match) {
    const labelMatch = AI_PRACTICE_LABEL_RE.exec(text);
    if (!labelMatch) return "";

    const sectionStart = labelMatch.index + labelMatch[0].length;
    const rest = text.slice(sectionStart);
    const nextPeer = /^(?:#{1,6}\s+|\s*\*\*[^*\n]+[:：]?\*\*\s*$)/m.exec(rest);
    return nextPeer ? rest.slice(0, nextPeer.index) : rest;
  }

  const headingDepth = match[1].length;
  const sectionStart = match.index + match[0].length;
  const rest = text.slice(sectionStart);
  const nextPeerOrParent = new RegExp(`^#{1,${headingDepth}}\\s+`, "m").exec(rest);
  return nextPeerOrParent ? rest.slice(0, nextPeerOrParent.index) : rest;
}

function aiPracticeVisibilityErrors(text) {
  if (!hasInScopeAiPractice(text)) return [];

  const errors = [];
  const section = aiPracticeSectionText(text);
  if (!section) {
    errors.push("AI Agent practice scope requires a visible AI Agent Practices section or block");
    return errors;
  }
  if (!AI_PRACTICE_SURFACE_RE.test(section)) {
    errors.push("AI Agent Practices must name inspected surfaces such as Rules, Hooks, Skills, Custom Agents, MCP, Plugins, or Session Insights");
  }
  if (hasAiPracticeSessionScope(text) && !SESSION_SOURCES_RE.test(text) && !SESSION_BOUNDARY_RE.test(text)) {
    errors.push("Coding-agent session-scoped AI Agent Practices must cite session-analysis.mjs sources for the target workspace");
  }
  if (hasAiPracticeSessionScope(text) && !SESSION_BOUNDARY_RE.test(text)) {
    errors.push("Coding-agent session-scoped AI Agent Practices must cite session-analysis.mjs facets or an explicit no-session/source-failed boundary");
  }
  return errors;
}

function hasObjectBackedMaturityMatrixCells(text) {
  if (!/<MaturityMatrix\b/.test(text)) return false;
  if (/<MaturityMatrix\b[^>]*\bcells\s*=\s*\{\s*\{/s.test(text)) return true;

  const cellPropMatches = text.matchAll(/<MaturityMatrix\b[\s\S]*?\bcells\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}[\s\S]*?\/?>/g);
  for (const match of cellPropMatches) {
    const name = match[1];
    const declaration = new RegExp(`\\b(?:const|let|var)\\s+${escapeRe(name)}(?:\\s*:[^=]+)?\\s*=\\s*\\{`, "s");
    if (declaration.test(text)) return true;
  }

  return false;
}

function countMatches(text, pattern) {
  return Array.from(text.matchAll(pattern)).length;
}

const IMPACT_LABEL_RE = labelsRe(IMPACT_LABELS);
const TIMING_LABEL_RE = labelsRe(TIMING_LABELS);
const MARKDOWN_HEADING_RE = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm;
const MARKDOWN_BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/gm;
const JS_VISIBLE_PROP_RE = /\b(?:title|current|finding|pathway|label|name)\s*(?:=|:)\s*(["'`])([^"'`\n]+)\1/g;
const CANVAS_SHARED_FINDING_ROWS_RE = /\b(?:FINDINGS|ISSUE_ROWS|RISK_FINDINGS)\b|Risk Findings|风险发现/;
const CANVAS_STANDALONE_ACTION_PATHWAYS_RE = /\b(?:ACTION_PATHWAYS|actionPathways)\b/;
const CANVAS_AI_HANDOFF_RE = /<SendToChatButton\b|\bsendToChat\s*\(/;
const CANVAS_AI_HANDOFF_FALLBACK_RE = /(?:missing[- ]export|fallback)[^\n]*(?:SendToChatButton|sendToChat)|(?:SendToChatButton|sendToChat)[^\n]*(?:missing[- ]export|fallback)/i;
const SEND_TO_CHAT_BUTTON_TAG_RE = /<SendToChatButton\b[\s\S]*?>/g;
const CANVAS_REPAIR_PROMPT_RE = /\/better-harness\s+(?:fix\s+this\s+issue|修复这个问题)\b/i;
const CANVAS_VALIDATION_SECTION_RE = /(?:^|\\n|\n)##\s*(?:Validation|验证)\b/i;
const CANVAS_HANDOFF_CONTEXT_RE = /\b(target|finding|evidence|action|acceptance|validation|risk boundary|safety note)\s*[:=]|(目标|发现|证据|行动|操作|验收|验证|风险边界|安全提示)\s*[:：=]/gi;
const CANVAS_SLOT_ASSIGNMENT_RE = /\b(?:target|finding|evidence|request|requested_fix|acceptance(?:_check)?|validation(?:_command)?|risk(?:_boundary)?|safety(?:_note)?|stop(?:_condition)?)=/gi;
const WEAK_AI_FIX_LITERAL_RE = /^(?:fix|draft fix plan|起草修复方案|continue analysis|继续分析|verify this item|验证此项|investigate gap|排查缺口)$/i;
const CANVAS_STANDALONE_NOTES_SECTION_LABEL_RE = /\b(?:Evidence Boundary|Unverified Items)\b|证据边界|未验证事项|未验证项/i;
const VISIBLE_STATIC_EVIDENCE_LABEL_RE = /\bStatic evidence index\b|静态证据索引|\bStatic evidence boundary\b|静态证据边界/i;
const CANVAS_EVIDENCE_BOUNDARY_METADATA_RE = /\bEvidence boundary\s*[:：]|证据边界\s*[:：]/i;
const CORE_PATH_RE = /核心路径|核心文件|关键路径|\bcore paths?\b|\bcore files?\b|\bcritical paths?\b|\bcritical files?\b/i;
const REVIEW_ROUTING_RE = /评审人|评审路由|自动评审|reviewer|review route|review routing|required reviewer/i;
const CODEOWNERS_ABSENCE_RE = /(?:无|没有|缺少|未发现)\s*`?CODEOWNERS`?(?!\s*(?:覆盖|列出|包含|保护))|(?:no|missing|without)\s+`?CODEOWNERS`?(?:\s+(?:file|configuration|config))?(?!\s+(?:coverage|cover|covers|covering|entry|entries|listing|lists|listed))/i;
const GITHUB_HOST_EVIDENCE_RE = /\bGitHub\b|\.github\/|github\.com/i;
const CODEOWNERS_OR_APPROVAL_RE = /\bCODEOWNERS\b|approval rule|protected-review|保护规则|审批规则/i;
const CORE_FILES_LIST_LABEL_RE = /\bcoreFiles\b|(?:核心文件|Core files?)\s*(?:[:：|]|列表|清单)/i;
const CORE_FILES_PHRASE_RE = /(?:all\s+)?(?:core|critical)\s+(?:files|paths)\s+(?:under|include|covered|listed|touching)|(?:affected|listed)\s+(?:core|critical)\s+(?:files|paths)|(?:核心|关键)(?:文件|路径).{0,24}(?:包括|覆盖|列出|涉及)/i;
const CONCRETE_PATH_TOKEN_RE = /(?:^|[\s`"'([{,|])(?:\.?[\w.-]+\/[\w./*{}@!-]+|\.[\w./*{}@!-]+|[\w.-]+\.(?:mjs|cjs|js|jsx|ts|tsx|go|py|java|kt|kts|rs|rb|php|c|cc|cpp|h|hpp|cs|json|md|yml|yaml))(?=$|[\s`"',;)\]}|])/i;
const SCOPED_CODEOWNERS_COVERAGE_RE = /\bCODEOWNERS\b[^.\n|]{0,100}(?:does not|doesn't|do not|未|没有)[^.\n|]{0,80}(?:list|lists|listed|cover|covers|covering|覆盖|列出|包含)[^.\n|]{0,80}(?:core|critical|affected|path|paths|file|files|核心|关键|受影响)/i;

function tableCells(text) {
  const cells = [];

  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*\|.*\|\s*$/.test(line)) continue;
    if (/^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line)) continue;

    const trimmed = line.trim();
    cells.push(...trimmed.slice(1, -1).split("|").map((cell) => cell.trim()));
  }

  return cells;
}

function collectGenericOwnershipGapTitles(text, mode) {
  const titles = new Set();

  for (const cell of tableCells(text)) {
    if (isGenericOwnershipGapTitle(cell)) titles.add(cell);
  }

  for (const match of text.matchAll(MARKDOWN_HEADING_RE)) {
    if (isGenericOwnershipGapTitle(match[1])) titles.add(match[1]);
  }

  for (const match of text.matchAll(MARKDOWN_BULLET_RE)) {
    if (isGenericOwnershipGapTitle(match[1])) titles.add(match[1]);
  }

  if (mode === "canvas") {
    for (const match of text.matchAll(JS_VISIBLE_PROP_RE)) {
      if (isGenericOwnershipGapTitle(match[2])) titles.add(match[2]);
    }
  }

  return [...titles];
}

function ownershipGapTitleErrors(text, mode) {
  return collectGenericOwnershipGapTitles(text, mode).map(
    (title) => `ownership-worded review-routing title "${title}"; use reviewer-routing wording with the affected scope or path`,
  );
}

function codeownersCoverageWordingErrors(text) {
  if (!CORE_PATH_RE.test(text) || !REVIEW_ROUTING_RE.test(text) || !CODEOWNERS_ABSENCE_RE.test(text)) {
    return [];
  }

  if (SCOPED_CODEOWNERS_COVERAGE_RE.test(text) && hasCoreFilesList(text)) {
    return [];
  }

  if (!/\b(?:coverage|cover|covers|covering|entry|entries|listing|lists|listed|path|paths|file|files|核心|关键|覆盖|列出|包含)\b/i.test(text)) {
    return [];
  }

  return [
    "CODEOWNERS coverage wording uses repository-level absence for a core path reviewer gap; say CODEOWNERS does not list or cover the affected core files/paths",
  ];
}

function codeownersHostNeutralWordingErrors(text) {
  if (!CODEOWNERS_ABSENCE_RE.test(text) || GITHUB_HOST_EVIDENCE_RE.test(text)) {
    return [];
  }

  return [
    "CODEOWNERS absence wording requires GitHub host evidence; use host-neutral owner/reviewer route wording",
  ];
}

function hasCorePathReviewerGap(text) {
  return CORE_PATH_RE.test(text) && REVIEW_ROUTING_RE.test(text) && CODEOWNERS_OR_APPROVAL_RE.test(text);
}

function hasConcretePathNear(pattern, text) {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const start = Math.max(0, match.index - 80);
    const end = Math.min(text.length, match.index + match[0].length + 320);
    if (CONCRETE_PATH_TOKEN_RE.test(text.slice(start, end))) return true;
  }
  return false;
}

function hasCoreFilesList(text) {
  return hasConcretePathNear(new RegExp(CORE_FILES_LIST_LABEL_RE, "gi"), text)
    || hasConcretePathNear(new RegExp(CORE_FILES_PHRASE_RE, "gi"), text);
}

function coreFileListErrors(text) {
  if (!hasCorePathReviewerGap(text) || hasCoreFilesList(text)) {
    return [];
  }

  return [
    "core path reviewer gap must include a core files list with concrete affected paths",
  ];
}

function hasCanvasRiskOrActionSection(text) {
  return CANVAS_SHARED_FINDING_ROWS_RE.test(text) || CANVAS_STANDALONE_ACTION_PATHWAYS_RE.test(text);
}

function hasCanvasAiHandoff(text) {
  return CANVAS_AI_HANDOFF_RE.test(text) || CANVAS_AI_HANDOFF_FALLBACK_RE.test(text);
}

function sendToChatButtonTextProp(tag) {
  const match = tag.match(/\btext\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`\s*\}|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\}|\{\s*([^}]+?)\s*\})/s);
  if (!match) return null;
  const literal = match.slice(1, 6).find((value) => value !== undefined);
  if (literal !== undefined) return { kind: "literal", value: literal };
  return { kind: "expression", value: match[6] ?? "" };
}

function isWeakAiFixPromptLiteral(value) {
  const trimmed = String(value ?? "").replace(/\s+/g, " ").trim();
  if (Array.from(trimmed.matchAll(CANVAS_SLOT_ASSIGNMENT_RE)).length >= 3) return true;
  if (!trimmed || (CANVAS_REPAIR_PROMPT_RE.test(trimmed) && CANVAS_VALIDATION_SECTION_RE.test(trimmed))) return !trimmed;
  return WEAK_AI_FIX_LITERAL_RE.test(trimmed) || (/fix|draft|repair|修复|起草|verify|验证|investigate|排查/i.test(trimmed) && trimmed.length < 80);
}

function hasFullAiHandoffPromptSource(text) {
  if (Array.from(text.matchAll(CANVAS_SLOT_ASSIGNMENT_RE)).length >= 3) return false;
  if (CANVAS_REPAIR_PROMPT_RE.test(text) && CANVAS_VALIDATION_SECTION_RE.test(text)) return true;
  const fields = new Set();
  for (const match of text.matchAll(CANVAS_HANDOFF_CONTEXT_RE)) {
    fields.add((match[1] ?? match[2] ?? "").toLowerCase());
  }
  return fields.size >= 5;
}

function canvasAiHandoffPromptErrors(text, { evidenceText = "" } = {}) {
  if (!/<SendToChatButton\b/.test(text)) return [];
  const errors = [];
  const combined = [text, evidenceText].filter(Boolean).join("\n");
  const hasFullAiFixPromptSource = /\baiFixPrompt\b/.test(combined) && hasFullAiHandoffPromptSource(combined);

  for (const match of text.matchAll(SEND_TO_CHAT_BUTTON_TAG_RE)) {
    const prop = sendToChatButtonTextProp(match[0]);
    if (!prop) continue;

    if (prop.kind === "literal" && isWeakAiFixPromptLiteral(prop.value)) {
      errors.push(`SendToChatButton.text must carry a full AI handoff prompt, not a label-only prompt: ${JSON.stringify(prop.value)}`);
    }

    if (prop.kind === "expression" && /\brow\.prompt\b/.test(prop.value) && !hasFullAiFixPromptSource) {
      errors.push("SendToChatButton.text must bind to row.aiFixPrompt or another full repair-plan prompt source, not row.prompt");
    }

    if (prop.kind === "expression" && /\baiFixPrompt\b/.test(prop.value) && !hasFullAiFixPromptSource) {
      errors.push("SendToChatButton aiFixPrompt bindings require source rows to contain full AI handoff prompts");
    }
  }

  return errors;
}

function canvasAiHandoffErrors(text) {
  if (!hasCanvasRiskOrActionSection(text) || hasCanvasAiHandoff(text)) return [];
  return [
    "canvas shared issue/finding rows require row-scoped AI handoffs via SendToChatButton, sendToChat, or a visible missing-export fallback",
  ];
}

function canvasStandaloneActionPathwayErrors(text) {
  if (!CANVAS_STANDALONE_ACTION_PATHWAYS_RE.test(text)) return [];
  return [
    "canvas ACTION_PATHWAYS must be folded into shared finding rows; use finding reason and aiFixPrompt instead",
  ];
}

function priorityAxisPropValue(tag, propNames) {
  for (const prop of propNames) {
    const valueRe = new RegExp(
      "\\b" + prop + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|\\{\\s*\"([^\"]*)\"\\s*\\}|\\{\\s*'([^']*)'\\s*\\}|\\{\\s*`([^`]*)`\\s*\\})",
      "i",
    );
    const match = tag.match(valueRe);
    if (match) return match.slice(1).find(Boolean) ?? "";
  }
  return "";
}

function canvasPriorityQuadrantAxisErrors(text) {
  if (!PRIORITY_QUADRANT_RE.test(text)) return [];
  for (const match of text.matchAll(PRIORITY_QUADRANT_TAG_RE)) {
    const tag = match[0];
    const xLabel = priorityAxisPropValue(tag, ["xLabel", "xAxis"]);
    const yLabel = priorityAxisPropValue(tag, ["yLabel", "yAxis"]);
    if (
      (xLabel && PRIORITY_IMPACT_AXIS_RE.test(xLabel))
      || (yLabel && PRIORITY_EFFORT_AXIS_RE.test(yLabel))
    ) {
      return [
        "PriorityQuadrantChart x-axis must be effort/complexity and y-axis must be impact",
      ];
    }
  }
  return [];
}

function firstNumberProperty(body, names) {
  for (const name of names) {
    const match = body.match(new RegExp("(?:[\"']?" + name + "[\"']?)\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\b"));
    if (match) return Number(match[1]);
  }
  return undefined;
}

function priorityQuadrantCoordinates(text) {
  if (!PRIORITY_QUADRANT_RE.test(text)) return [];
  const coordinates = [];
  for (const match of text.matchAll(/\{[^{}]*\}/g)) {
    const body = match[0];
    const x = firstNumberProperty(body, ["x", "effort", "complexity"]);
    const y = firstNumberProperty(body, ["y", "impact"]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      coordinates.push({ x, y });
    }
  }
  return coordinates;
}

function canvasPriorityQuadrantCoordinateErrors(text) {
  const coordinates = priorityQuadrantCoordinates(text);
  if (coordinates.length < 3) return [];
  const pairs = new Set(coordinates.map(({ x, y }) => `${x}:${y}`));
  const xs = new Set(coordinates.map(({ x }) => x));
  const ys = new Set(coordinates.map(({ y }) => y));
  if (pairs.size < coordinates.length || (xs.size <= 2 && ys.size <= 2)) {
    return [
      "PriorityQuadrantChart uses duplicate or coarse coordinates; provide differentiated effort/complexity and impact scores or use a table",
    ];
  }
  return [];
}

function jsxTagHasProp(tag, propName) {
  return new RegExp("\\b" + propName + "\\s*=").test(tag);
}

function canvasSdkDataShapeErrors(text) {
  const errors = [];
  if (/<\s*MetricItem\b/.test(text)) {
    errors.push("MetricItem is a MetricsGrid item type, not a JSX component; use Stat or MetricsGrid items");
  }

  for (const match of text.matchAll(BAR_LINE_CHART_TAG_RE)) {
    const component = match[1];
    const tag = match[0];
    if (jsxTagHasProp(tag, "data")) {
      errors.push(`${component} uses unsupported data prop; use categories plus series so the Qoder Canvas chart has data`);
    }
    if (!jsxTagHasProp(tag, "categories") || !jsxTagHasProp(tag, "series")) {
      errors.push(`${component} must provide categories and series props`);
    }
  }

  for (const match of text.matchAll(TABLE_TAG_RE)) {
    const tag = match[0];
    if (jsxTagHasProp(tag, "data")) {
      errors.push("Table uses unsupported data prop; use rows with columns or headers");
    }
    if (!jsxTagHasProp(tag, "rows")) {
      errors.push("Table must provide rows prop");
    }
  }

  for (const match of text.matchAll(STACK_TAG_RE)) {
    const tag = match[0];
    if (jsxTagHasProp(tag, "direction")) {
      errors.push("Stack does not support a direction prop; use Row for horizontal layouts or style flexDirection");
    }
  }

  for (const match of text.matchAll(TAG_TAG_RE)) {
    const tag = match[0];
    if (jsxTagHasProp(tag, "color")) {
      errors.push("Tag uses unsupported color prop; use tone=\"danger\", tone=\"warning\", tone=\"success\", tone=\"info\", or tone=\"neutral\"");
    }
  }

  for (const match of text.matchAll(STAT_TAG_RE)) {
    const tag = match[0];
    if (jsxTagHasProp(tag, "suffix")) {
      errors.push("Stat uses unsupported suffix prop; use valueSuffix");
    }
    if (!jsxTagHasProp(tag, "label")) {
      errors.push("Stat must provide a label prop");
    }
  }
  return errors;
}

function canvasStandaloneNotesSectionErrors(text) {
  const labels = [];
  for (const match of text.matchAll(/<\s*(?:H1|H2|H3)\b[^>]*>\s*([^<{}]+?)\s*<\s*\/\s*(?:H1|H2|H3)\s*>/gis)) {
    if (CANVAS_STANDALONE_NOTES_SECTION_LABEL_RE.test(match[1])) labels.push(match[1].trim());
  }
  for (const match of text.matchAll(/\b(?:title|heading|sectionTitle)\s*[:=]\s*(?:(["'`])([^"'`]*?)\1|\{\s*(["'`])([^"'`]*?)\3\s*\})/gi)) {
    const label = (match[2] ?? match[4] ?? "").trim();
    if (CANVAS_STANDALONE_NOTES_SECTION_LABEL_RE.test(label)) labels.push(label);
  }
  if (labels.length === 0) return [];
  const renderedLabels = [...new Set(labels)].join(", ");
  return [
    `canvas renders deprecated standalone note labels; use the compact reader section set (${renderedLabels})`,
  ];
}

function staticEvidenceLabelErrors(text, mode) {
  if (VISIBLE_STATIC_EVIDENCE_LABEL_RE.test(text)) {
    return [
      `${mode} uses deprecated static-only score labels; use reader-facing score labels`,
    ];
  }
  return [];
}

function canvasEvidenceBoundaryMetadataErrors(text) {
  if (!CANVAS_EVIDENCE_BOUNDARY_METADATA_RE.test(text)) return [];
  return [
    "canvas uses deprecated metadata labels in headers, subtitles, badges, or notes",
  ];
}

function jsxSectionAfterHeading(text, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingMatch = new RegExp(`<H[1-3]>\\s*${escapedHeading}\\s*<\\/H[1-3]>`).exec(text);
  if (!headingMatch) return "";

  const rest = text.slice(headingMatch.index + headingMatch[0].length);
  const nextHeading = rest.search(/<H[1-3]>/);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

function getCanvasLayoutAntiPatternErrors(text) {
  const errors = [];

  if (/<(?:Stack|Row|Grid)\b[^>]*\bgap\s*=\s*["']/s.test(text)) {
    errors.push("uses string gap props; Stack, Row, and Grid gap must be numeric JSX expressions");
  }

  if (/<Spacer\b[^>]*\bsize\s*=/s.test(text)) {
    errors.push("uses Spacer size prop; do not use Spacer for vertical spacing");
  }

  if (countMatches(text, /<Divider\s*\/>/g) > 1) {
    errors.push("uses repeated bare Divider separators; add semantic spacing or Divider margin");
  }

  const priorityPrescriptions = jsxSectionAfterHeading(text, "Priority Prescriptions");
  const priorityKataCount = countMatches(priorityPrescriptions, /<ImprovementKataCard\b/g);

  if (priorityKataCount > 1 && !/<Grid\b/.test(priorityPrescriptions)) {
    errors.push("Priority Prescriptions with multiple ImprovementKataCard blocks must use Grid");
  }

  if (/\bvariant\s*=\s*(?:"card"|'card'|\{\s*["']card["']\s*\})/.test(priorityPrescriptions)) {
    errors.push('Priority Prescriptions should not force variant="card"; use variant="auto"');
  }

  return errors;
}

function canvasH2Headings(text) {
  return Array.from(String(text).matchAll(/<H2\b[^>]*>\s*([^<{}]+?)\s*<\/H2>/gis))
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function canvasReaderSectionErrors(text) {
  const headings = canvasH2Headings(text);
  if (headings.length < 3) return [];

  const joined = headings.join(" | ");
  const errors = [];
  if (headings.some((heading) => CANVAS_LEGACY_AGGREGATE_H2_RE.test(heading))) {
    errors.push("canvas renders a deprecated standalone aggregate issue section; keep issue evidence in finding rows or style-owned visuals");
  }
  if (headings.length !== 4) {
    errors.push(`canvas must render exactly four visible H2 reader parts; found ${headings.length}: ${joined}`);
  }
  if (!CANVAS_FIRST_H2_LABELS.has(headings[0])) {
    errors.push(`canvas H2 1 must be a style-selected framing label; found ${headings[0] ?? "missing"}`);
  }
  for (const [offset, expected] of CANVAS_CANONICAL_TRAILING_H2_HEADINGS.entries()) {
    const index = offset + 1;
    if (headings[index] !== expected) {
      errors.push(`canvas H2 ${index + 1} must be ${expected}; found ${headings[index] ?? "missing"}`);
    }
  }
  return errors;
}

function collectNumericCaptures(text, pattern, group = 1) {
  const scores = [];
  pattern.lastIndex = 0;
  for (const match of String(text ?? "").matchAll(pattern)) {
    const score = Number(match[group]);
    if (Number.isFinite(score)) scores.push(score);
  }
  return scores;
}

function scoreIsLow(score) {
  return Number.isFinite(score) && score < LOW_SCORE_THRESHOLD;
}

function aiReadinessScoresFromMarkdown(text) {
  const scores = [];
  for (const line of markdownSectionText(text, "readinessScorecard").split(/\r?\n/)) {
    if (!AI_READINESS_DIMENSION_RE.test(line) || !/^\s*\|/.test(line)) continue;
    const cells = line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
    for (const cell of cells.slice(1)) {
      const match = cell.match(/\b(\d{1,3})(?:\s*\/\s*100)?\b/);
      if (match) {
        scores.push(Number(match[1]));
        break;
      }
    }
  }
  if (scores.length > 0) return scores;
  return collectNumericCaptures(markdownSectionText(text, "readinessScorecard"), AI_READINESS_INLINE_SCORE_RE);
}

function hasLowReportScore(text) {
  const headlineScores = collectNumericCaptures(text, HEADLINE_READINESS_SCORE_RE);
  if (headlineScores.length > 0) return headlineScores.some(scoreIsLow);
  return aiReadinessScoresFromMarkdown(text).some(scoreIsLow);
}

function aiReadinessScoresFromCanvas(text) {
  const scores = collectNumericCaptures(text, CANVAS_SCORE_OBJECT_RE, 2);
  scores.push(...collectNumericCaptures(text, AI_READINESS_INLINE_SCORE_RE));
  return scores;
}

function hasLowCanvasScore(text, evidenceText = "") {
  const combined = [text, evidenceText].filter(Boolean).join("\n");
  const headlineScores = collectNumericCaptures(combined, HEADLINE_READINESS_SCORE_RE);
  if (headlineScores.length > 0) return headlineScores.some(scoreIsLow);
  return aiReadinessScoresFromCanvas(combined).some(scoreIsLow);
}

function hasScheduleHandoff(text, evidenceText = "") {
  const combined = [text, evidenceText].filter(Boolean).join("\n");
  const windows = [];
  for (const pattern of [SCHEDULE_HANDOFF_RE, SCHEDULE_LABEL_RE]) {
    for (const match of combined.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
      windows.push(combined.slice(Math.max(0, match.index - 360), Math.min(combined.length, match.index + 1400)));
    }
  }
  return windows.some((windowText) => SCHEDULE_HANDOFF_REQUIREMENTS.every((pattern) => pattern.test(windowText)));
}

function lowScoreScheduleHandoffErrors(text, mode, { evidenceText = "" } = {}) {
  if (mode === "canvas" && canvasH2Headings(text).length < CANVAS_MIN_READER_H2_COUNT) return [];
  const hasLowScore = mode === "canvas" ? hasLowCanvasScore(text, evidenceText) : hasLowReportScore(text);
  if (!hasLowScore || hasScheduleHandoff(text, evidenceText)) return [];
  return [
    `${mode} low-score report must include a row-scoped Schedule follow-up handoff using /schedule, harness, and a stop condition`,
  ];
}

function hasScheduleReadyLoopDiscovery(text, evidenceText = "") {
  const combined = [text, evidenceText].filter(Boolean).join("\n");
  if (!LOOP_DISCOVERY_RE.test(combined) || !LOOP_DISCOVERY_SCHEDULE_READY_RE.test(combined)) {
    return false;
  }
  if (LOOP_DISCOVERY_NEEDS_MORE_EVIDENCE_RE.test(combined) && !/schedule[-_ ]ready/i.test(combined)) {
    return false;
  }
  return true;
}

function loopDiscoveryScheduleHandoffErrors(text, mode, { evidenceText = "" } = {}) {
  if (mode === "canvas" && canvasH2Headings(text).length < CANVAS_MIN_READER_H2_COUNT) return [];
  if (!hasScheduleReadyLoopDiscovery(text, evidenceText) || hasScheduleHandoff(text, evidenceText)) return [];
  return [
    `${mode} loop-discovery schedule-ready outcome must include a row-scoped Schedule follow-up handoff using /schedule, harness, and a stop condition`,
  ];
}

function missingFields(fields, text) {
  return fields.filter(([, pattern]) => !pattern.test(text));
}

function riskFieldErrors(text) {
  if (RISK_FIELD_VARIANTS.some((fields) => missingFields(fields, text).length === 0)) {
    return [];
  }
  return missingFields(LEGACY_RISK_FIELDS, text).map(([name]) => `missing risk field: ${name}`);
}

function canvasRiskFieldErrors(text) {
  if (CANVAS_RISK_FIELD_VARIANTS.some((fields) => missingFields(fields, text).length === 0)) {
    return [];
  }
  return missingFields(LEGACY_CANVAS_RISK_FIELDS, text).map(([name]) => `missing canvas risk field: ${name}`);
}

export function evaluateHarnessReportQuality(reportText) {
  const text = String(reportText ?? "");
  const errors = [];
  const warnings = [];
  const sectionShape = markdownReportShape(text);

  errors.push(...requiredMarkdownSectionErrors(text));

  if (/\bP[0-2]\b/.test(text)) {
    errors.push("uses incident-style priority codes; use High/Medium/Low impact and Now/Next/Later timing");
  }

  if (/analysis mode:\s*.*small-sample|small-sample/i.test(text)) {
    errors.push("uses small-sample framing; name the actual evidence boundary and cap claims");
  }

  if (hasWeakEvidenceMode(text) && hasUnsupportedL3Claim(text)) {
    errors.push("small-sample/static-only report makes unsupported L3 or low-effort claim");
  }

  errors.push(...riskFieldErrors(text));

  errors.push(...aiPracticeVisibilityErrors(text));
  errors.push(...ownershipGapTitleErrors(text, "report"));
  errors.push(...codeownersCoverageWordingErrors(text));
  errors.push(...codeownersHostNeutralWordingErrors(text));
  errors.push(...coreFileListErrors(text));
  errors.push(...visibleLevelErrors(text, "report"));
  errors.push(...diagnosticModelNotesMarkdownErrors(text));
  errors.push(...staticEvidenceLabelErrors(text, "report"));
  errors.push(...advancedScoreWithoutValidationErrors(text));
  errors.push(...targetLevelJumpErrors(text));
  errors.push(...lowScoreScheduleHandoffErrors(text, "report"));
  errors.push(...loopDiscoveryScheduleHandoffErrors(text, "report"));

  if (!IMPACT_LABEL_RE.test(text)) {
    errors.push("missing High/Medium/Low labels");
  }

  if ((sectionRe("actionPathways").test(text) || sectionRe("nextRecommendations").test(text)) && !TIMING_LABEL_RE.test(text)) {
    errors.push("recommendations/actions must include Now, Next, or Later timing");
  }

  return {
    kind: "harness-report-quality",
    status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    summary: {
      reportShape: sectionShape.shape,
      requiredSections: sectionShape.requiredKeys.length,
      projectOverview: sectionRe("projectOverview").test(text),
      missingSections: sectionShape.missingKeys.map((section) => SECTION_LABELS[section][0]),
      weakEvidenceMode: hasWeakEvidenceMode(text),
      aiPracticeScope: hasInScopeAiPractice(text),
      aiReadinessDimension: AI_READINESS_DIMENSION_RE.test(markdownDimensionSectionText(text)),
      noValidationPath: NO_VALIDATION_PATH_RE.test(text),
      l2L3CurrentState: CURRENT_L2_L3_RE.test(text),
    },
    errors,
    warnings,
  };
}

export function evaluateHarnessCanvasQuality(canvasText, { evidenceText = "" } = {}) {
  const text = String(canvasText ?? "");
  const evidence = String(evidenceText ?? "");
  const combined = [text, evidence].filter(Boolean).join("\n");
  const errors = [];
  const warnings = [];

  if (!/\b(export\s+default|export\s+default\s+function)\b/.test(text)) {
    errors.push("missing default export");
  }

  if (/\bP[0-2]\b/.test(text)) {
    errors.push("uses incident-style priority codes; use High/Medium/Low impact and Now/Next/Later timing");
  }

  errors.push(...canvasRiskFieldErrors(combined));

  errors.push(...ownershipGapTitleErrors(text, "canvas"));
  errors.push(...codeownersCoverageWordingErrors(text));
  errors.push(...codeownersHostNeutralWordingErrors(text));
  errors.push(...coreFileListErrors(text));
  errors.push(...visibleLevelErrors(text, "canvas"));
  errors.push(...canvasStandaloneNotesSectionErrors(text));
  errors.push(...staticEvidenceLabelErrors(text, "canvas"));
  errors.push(...canvasEvidenceBoundaryMetadataErrors(text));
  errors.push(...canvasStandaloneActionPathwayErrors(text));
  errors.push(...canvasSdkDataShapeErrors(text));
  errors.push(...canvasPriorityQuadrantAxisErrors(text));
  errors.push(...canvasPriorityQuadrantCoordinateErrors(text));
  errors.push(...canvasAiHandoffErrors(text));
  errors.push(...canvasAiHandoffPromptErrors(text, { evidenceText: evidence }));
  errors.push(...lowScoreScheduleHandoffErrors(text, "canvas", { evidenceText: evidence }));
  errors.push(...loopDiscoveryScheduleHandoffErrors(text, "canvas", { evidenceText: evidence }));

  if (!IMPACT_LABEL_RE.test(combined)) {
    errors.push("canvas must include High/Medium/Low labels");
  }

  if (hasOneToFiveFluencyWithoutScale(text)) {
    errors.push("Fluency uses apparent 1-5 scores without explicit min={1}, max={5}, mediumThreshold={3}, and highThreshold={4}");
  }

  errors.push(...diagnosticModelNotesCanvasErrors(text));
  errors.push(...canvasReaderSectionErrors(text));

  if (hasObjectBackedMaturityMatrixCells(text)) {
    errors.push("MaturityMatrix cells must be a MaturityMatrixCell[] array with scopeId, dimensionId, and level; do not pass nested Record objects");
  }

  errors.push(...getCanvasLayoutAntiPatternErrors(text));

  return {
    kind: "harness-canvas-quality",
    status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    summary: {
      requiredRiskFields: COMPACT_CANVAS_RISK_FIELDS.length,
      missingRiskFields: COMPACT_CANVAS_RISK_FIELDS
        .filter(([, pattern]) => !pattern.test(combined))
        .map(([name]) => name),
      aiReadinessDimension: AI_READINESS_DIMENSION_RE.test(combined),
      chartVisualComponents: Array.from(new Set(Array.from(text.matchAll(CANVAS_CHART_VISUAL_TAG_RE), (match) => match[1]))),
    },
    errors,
    warnings,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--report") {
      args.report = argv[index + 1];
      index += 1;
    } else if (arg === "--canvas") {
      args.canvas = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const input = args.report || args.canvas
    ? readFileSync(resolve(String(args.report ?? args.canvas)), "utf8")
    : readFileSync(0, "utf8");
  const result = args.canvas
    ? evaluateHarnessCanvasQuality(input)
    : evaluateHarnessReportQuality(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "fail" ? 1 : 0;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main();
}
