import { isAgentWorkLoopReport } from "../fluency-dimensions.mjs";
import { repairProgressFromFindings } from "../task-loop-report.mjs";

function value(value, fallback = "not observed") {
  if (Array.isArray(value)) return value.filter(Boolean).join("; ") || fallback;
  return value == null || value === "" ? fallback : String(value);
}

function tableRow(cells) {
  return `| ${cells.map((cell) => value(cell).replace(/\|/g, "\\|")).join(" | ")} |`;
}

function dimensions(source) {
  return source.summary.dimensions ?? [];
}

function projectSummary(source) {
  return [
    value(source.summary.projectName ?? source.target.name, "Project"),
    `Model: ${value(source.summary.modelId, "software-fluency")}`,
    `Findings: ${source.findings.length}`,
  ].join(". ");
}

function averageScore(source) {
  const scores = dimensions(source)
    .map((dimension) => Number(dimension.score))
    .filter((score) => Number.isFinite(score));
  if (scores.length === 0) return "unscored";
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function evidenceScoreLabel(source) {
  const platform = String(source.summary?.evidenceBoundary?.manifest?.platform ?? "").toLowerCase();
  if (platform === "qoder") return "Qoder Evidence Score (Loop Effectiveness)";
  if (platform === "codex") return "Codex Evidence Score (Loop Effectiveness)";
  return "Loop Effectiveness";
}

function aiScopeLine(source) {
  const practice = source.summary.aiAgentPractice ?? {};
  const hiddenSurfaces = new Set(aiPracticeRows(source)
    .filter((row) => Number.isInteger(Number(row.count)) && Number(row.count) === 0)
    .map((row) => row.surface));
  const surfaces = Array.isArray(practice.inspectedSurfaces)
    ? practice.inspectedSurfaces.filter((surface) => !hiddenSurfaces.has(surface))
    : [];
  if (surfaces.length === 0) {
    return "- AI Agent practice scope: no inspected surfaces supplied.";
  }
  return `- AI Agent practice scope: inspected ${surfaces.join(", ")}.`;
}

function aiPracticeRows(source) {
  const rows = source.summary.aiAgentPractice?.coverageRows;
  return Array.isArray(rows)
    ? rows.filter((row) => !(Number.isInteger(Number(row.count)) && Number(row.count) === 0))
    : [];
}

function practiceDescription(surface, locale) {
  const descriptions = {
    Rules: ["Standing project guidance and task-routing instructions.", "项目常驻指引与任务路由说明。"],
    Skills: ["Reusable agent workflows available to the project.", "项目可用的可复用 Agent 工作流。"],
    "Custom Agents": ["Specialized agent profiles available for delegated work.", "可用于委派工作的专用 Agent 配置。"],
    Hooks: ["Lifecycle automation around agent and delivery events.", "围绕 Agent 与交付事件的生命周期自动化。"],
    MCP: ["External tools and resources exposed through MCP.", "通过 MCP 暴露的外部工具与资源。"],
    Commands: ["Named command entry points for repeatable agent work.", "可重复 Agent 工作的命令入口。"],
    Workflows: ["Reusable multi-step project workflows.", "可复用的多步骤项目工作流。"],
    Plugins: ["Installed packages that contribute agent capabilities.", "提供 Agent 能力的已安装插件。"],
    "Session Insights": ["Task-session evidence available for report analysis.", "可用于报告分析的任务会话证据。"],
    Memories: ["Representative project or global Memory note files.", "项目级或全局 Memory 的代表性笔记文件。"],
  };
  const copy = descriptions[surface] ?? ["Recorded agent capability sources.", "已记录的 Agent 能力来源。"];
  return locale === "zh-CN" ? copy[1] : copy[0];
}

function renderStrengths(source) {
  const strengths = Array.isArray(source.summary.strengths) ? source.summary.strengths : [];
  if (strengths.length === 0) return "- No strengths supplied.";
  return strengths.map((item) => `- ${item}`).join("\n");
}

function renderExpectedOutput(finding) {
  const output = Array.isArray(finding.expectedOutput) ? finding.expectedOutput.filter(Boolean) : [];
  return output.length > 0
    ? output.map((item, index) => `  ${index + 1}. ${item}`).join("\n")
    : "  1. Concrete output not supplied.";
}

function renderAiPracticeBlock(source) {
  const rows = aiPracticeRows(source);
  if (rows.length === 0) {
    return "- AI Agent practice coverage was not supplied in findings.json.";
  }

  return [
    tableRow(["Surface", "Description", "Scope", "Count", "Sources"]),
    tableRow(["---", "---", "---", "---", "---"]),
    ...rows.map((row) => tableRow([
      row.surface,
      practiceDescription(row.surface, source.summary?.locale),
      Array.isArray(row.scopes) && row.scopes.length > 0 ? row.scopes.join(" + ") : "-",
      Number.isInteger(Number(row.count)) ? row.count : "-",
      Array.isArray(row.paths) && row.paths.length > 0 ? row.paths.join(", ") : "-",
    ])),
  ].join("\n");
}

function renderDimensionTable(source) {
  const rows = dimensions(source).map((dimension) => tableRow([
    dimension.label ?? dimension.id,
    dimension.score,
    dimension.summary,
    Array.isArray(dimension.findingRefs) ? dimension.findingRefs.join(", ") : "",
  ]));
  return [
    tableRow(["Dimension", "Score", "Why this score", "Linked findings"]),
    tableRow(["---", "---", "---", "---"]),
    ...rows,
  ].join("\n");
}

function renderFindingTable(source) {
  const rows = source.findings.map((finding) => tableRow([
    finding.severity,
    finding.title,
    finding.reason,
    Array.isArray(finding.dimensionRefs) ? finding.dimensionRefs.join(", ") : finding.dimensionRefs,
  ]));
  return [
    tableRow(["Severity", "Finding", "Reason", "Dimensions"]),
    tableRow(["---", "---", "---", "---"]),
    ...rows,
  ].join("\n");
}

function bridgeState(row) {
  return row?.evidenceBridge?.state ?? row?.state ?? "unobserved";
}

function readerLayer(value) {
  return {
    Present: "It exists",
    Wired: "It is connected",
    Exercised: "Used in a real task",
    "Outcome-supported": "A real result supports it",
    Missing: "Inspected and missing",
    "Not applicable": "Not needed for this task",
  }[value] ?? "Not observed yet";
}

function readerBridgeState(value) {
  return {
    "static-only": "static evidence only",
    "wired-unobserved": "connected, not seen in a task yet",
    exercised: "used, awaiting accepted result evidence",
    "outcome-supported": "accepted result evidence linked",
    missing: "inspected and missing",
    "not-applicable": "not needed for this task",
    unobserved: "not observed in this boundary",
  }[value] ?? "not observed in this boundary";
}

function taskLoopDimensionLabel(source, id) {
  return dimensions(source).find((dimension) => dimension.id === id)?.label ?? value(id);
}

function readerFinding(finding) {
  return {
    reason: value(finding?.reason),
  };
}

function suggestionKindLabel(kind, locale) {
  const labels = {
    "try-existing": ["Try an existing capability", "试用已有能力"],
    "working-pattern": ["Reuse a working pattern", "复用有效模式"],
    "loop-candidate": ["Evaluate a loop candidate", "评估循环候选"],
    horizon: ["Longer-horizon direction", "中长期方向"],
  }[kind] ?? [value(kind), value(kind)];
  return locale === "zh-CN" ? labels[1] : labels[0];
}

function renderSuggestionRows(source) {
  const suggestions = Array.isArray(source.summary?.suggestions) ? source.summary.suggestions : [];
  if (suggestions.length === 0) return "";
  const locale = source.summary?.locale;
  const label = (en, zh) => locale === "zh-CN" ? zh : en;
  return `### ${label("Additional suggestions", "补充建议")}

${suggestions.map((suggestion) => {
    const prerequisites = Array.isArray(suggestion.prerequisites) ? suggestion.prerequisites.filter(Boolean) : [];
    const blockedBy = Array.isArray(suggestion.blockedBy) ? suggestion.blockedBy.filter(Boolean) : [];
    return [
      `#### ${value(suggestion.title)}`,
      `- ${label("Type", "类型")}: ${suggestionKindLabel(suggestion.kind, locale)} · ${label("Confidence", "可信度")}: ${value(suggestion.confidence)}`,
      `- ${label("Why", "原因")}: ${value(suggestion.reason)}`,
      `- ${label("Owner", "负责人")}: ${value(suggestion.owner)}`,
      `- ${label("Next step", "下一步")}: ${value(suggestion.nextStep)}`,
      `- ${label("Validation", "验证")}: ${value(suggestion.validation)}`,
      ...(prerequisites.length ? [`- ${label("Prerequisites", "前置条件")}: ${prerequisites.join("; ")}`] : []),
      ...(blockedBy.length ? [`- ${label("Blocked by", "阻塞项")}: ${blockedBy.join("; ")}`] : []),
    ].join("\n");
  }).join("\n\n")}`;
}

function readerLearningState(value) {
  return {
    "N/A": "Needs a comparison",
    pending: "Comparison planned",
    improving: "Improving",
    unchanged: "No clear change",
    regressing: "Worse — stop or revert",
    "outcome-supported": "A later result supports it",
  }[value] ?? "Not observed";
}

function renderTaskLoopMarkdown(source) {
  const glance = source.summary?.atAGlance ?? {};
  const radius = glance.demonstratedAutonomyRadius ?? {};
  const coverage = glance.coverage ?? {};
  const boundary = source.summary?.evidenceBoundary ?? {};
  const rows = dimensions(source);
  const moves = Array.isArray(glance.priorityMoves) ? glance.priorityMoves : [];
  const learning = source.summary?.learningCapture ?? {};
  const strengths = Array.isArray(source.summary?.strengths) ? source.summary.strengths : [];
  const repairProgress = repairProgressFromFindings(source.findings);
  const loopEffectiveness = averageScore(source);
  const loopRows = rows.map((dimension) => tableRow([
    dimension.label ?? dimension.id,
    readerLayer(dimension.level ?? dimension.state),
    readerBridgeState(bridgeState(dimension)),
    dimension.summary,
    dimension.blocker,
  ]));
  const smallCheckRows = rows.flatMap((dimension) => (Array.isArray(dimension.subdimensions) ? dimension.subdimensions : []).map((subdimension) => tableRow([
    dimension.label ?? dimension.id,
    subdimension.label ?? subdimension.id,
    readerLayer(subdimension.level ?? subdimension.state),
    readerBridgeState(bridgeState(subdimension)),
  ])));
  const findingRows = source.findings.map((finding) => {
    const reader = readerFinding(finding);
    return [
      `### ${value(finding.title)}`,
      `- Priority: ${value(finding.severity)} · Evidence: ${readerBridgeState(bridgeState(finding))}`,
      `- Reason: ${reader.reason}`,
      "- Expected Output:",
      renderExpectedOutput(finding),
    ].join("\n");
  });
  const moveRows = moves.map((move) => `- ${taskLoopDimensionLabel(source, move.dimensionRef)}: ${value(move.expectedUnlock)} Smallest move: ${value(move.move)}`);

  return `# Better Harness Task-Loop Report

## At a Glance

- ${evidenceScoreLabel(source)}: ${loopEffectiveness}/100 (changes only after comparable later task outcomes)
- Asset Health / Repair Progress: ${repairProgress.score}/100 (${repairProgress.verifiedFindingCount} verified, ${repairProgress.partialFindingCount} partial, ${repairProgress.pendingFindingCount} pending)
- Demonstrated autonomy radius: ${value(radius.level)} (${value(radius.status)}; ${value(radius.confidence)} confidence)
- Strongest loop: ${glance.strongestLoop ? `${taskLoopDimensionLabel(source, glance.strongestLoop.dimensionRef)} (${readerLayer(glance.strongestLoop.state)})` : "Not enough evidence difference to name one."}
- Largest observed leak: ${glance.largestLeak ? `${taskLoopDimensionLabel(source, glance.largestLeak.dimensionRef)} — ${value(glance.largestLeak.blocker)}` : "Use the priority moves; no single loop is uniquely weakest."}
- Top expected gain: ${value(moves[0]?.expectedUnlock, "No priority benefit is available in this evidence boundary.")}

## What You Can Rely On Today

${strengths.map((strength) => `- ${value(strength)}`).join("\n") || "- No reliable user outcome has been demonstrated in this evidence boundary yet."}

## What You Gain Next

${moveRows.join("\n") || "- No priority Harness move is available in this evidence boundary."}

${renderSuggestionRows(source)}

### Why these moves matter

${findingRows.join("\n\n") || "- No concrete project or session finding was generated. Use the evidence-status rows below to choose the next observation or small improvement."}

## Five Lifecycle Dimensions

${tableRow(["Dimension", "What the evidence proves", "Evidence boundary", "Summary", "Boundary / blocker"])}
${tableRow(["---", "---", "---", "---", "---"])}
${loopRows.join("\n")}

## The 15 Small Checks

${tableRow(["Dimension", "Small check", "What the evidence proves", "Evidence boundary"])}
${tableRow(["---", "---", "---", "---"])}
${smallCheckRows.join("\n")}

## Evidence and Boundaries

- Episode coverage: ${value(coverage.episodeCount, 0)} episodes, ${value(coverage.editedEpisodeCount, 0)} edited, ${value(coverage.closedEpisodeCount, 0)} closed, ${value(coverage.recoveredEpisodeCount, 0)} repaired-and-passed
- Model: ${value(source.summary?.modelId)}
- Session selection: ${value(boundary.manifest?.selection?.strategy)}; ${value(boundary.manifest?.selection?.analyzedCount, 0)} sessions analyzed of ${value(boundary.manifest?.selection?.eligibleCount, 0)} eligible sessions; ${value(boundary.manifest?.selection?.confidence)} confidence
- Delivery grades observed: ${value(boundary.deliveryEvidenceLevels)}
- Source gaps: ${value(boundary.sourceGaps)}
- Provider coverage: ${value(boundary.providerCoverage?.status, "not observed")}; unsupported capabilities: ${value(boundary.providerCoverage?.unsupportedCapabilities, "none")}
- Learning comparison: ${readerLearningState(learning.state)}; ${value(learning.interventions?.length, 0)} declared intervention(s)
`;
}

export function renderMarkdown(source) {
  if (isAgentWorkLoopReport(source)) return renderTaskLoopMarkdown(source);
  return `# Better Harness Report

- Harness score: ${averageScore(source)}
${aiScopeLine(source)}

## Project Overview

${projectSummary(source)}

## What Is Working

${renderStrengths(source)}

## Harness Dimensions

${renderDimensionTable(source)}

## Issue Findings

${renderFindingTable(source)}

## AI Agent Practices

${renderAiPracticeBlock(source)}

## Notes And Method

- Generated artifacts: report.md and findings.json.
`;
}
