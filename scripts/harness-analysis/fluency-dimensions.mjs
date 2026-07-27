export const SOFTWARE_FLUENCY_MODEL_ID = "software-fluency";

// Compatibility export for modules that still use the historical constant
// name. New static readiness artifacts must identify software-fluency.
export const BETTER_HARNESS_AGENT_FLUENCY_MODEL_ID = SOFTWARE_FLUENCY_MODEL_ID;

export const BETTER_HARNESS_AGENT_FLUENCY_DIMENSION_IDS = [
  "context-map",
  "environment-readiness",
  "fast-feedback",
  "quality-gates",
  "safe-change",
];

// Software Fluency keeps the traditional five engineering facets for the
// no-session or explicitly repository-only fallback. Agent Work Loop is the
// default after a source probe confirms usable sessions.
export const AGENT_WORK_LOOP_MODEL_ID = "agent-work-loop-v4";
export const AGENT_WORK_LOOP_REPORT_CONTRACT_VERSION = 25;
export const LEARNING_CAPTURE_REVIEWED_SCORE_FLOOR = 35;

// These IDs and reader-facing labels are the canonical Agent Work Loop
// contract. Older dimension identifiers are intentionally unsupported.
export const AGENT_WORK_LOOP_DIMENSIONS = Object.freeze([
  {
    id: "task-understanding",
    label: "Task Understanding",
    zhLabel: "任务理解",
    question: "Does the agent understand the intended outcome, apply the relevant authoritative context, and keep the work within an explicit scope and effect boundary?",
    zhQuestion: "Agent 是否理解预期结果、应用相关权威上下文，并让工作保持在明确的范围和影响边界内？",
    subdimensions: Object.freeze([
      { id: "goal-understanding", label: "Intent and Acceptance", zhLabel: "意图与验收" },
      { id: "relevant-context", label: "Relevant Context", zhLabel: "相关上下文" },
      { id: "scope-boundary", label: "Scope Boundary", zhLabel: "范围边界" },
    ]),
  },
  {
    id: "controlled-execution",
    label: "Controlled Execution",
    zhLabel: "可控执行",
    question: "Can the agent start and operate the project through supported routes while remaining within enforced permission and operating boundaries?",
    zhQuestion: "Agent 能否通过项目支持的路径启动和操作，并始终处于受约束的权限和操作边界内？",
    subdimensions: Object.freeze([
      { id: "instruction-led-start", label: "Reproducible Startup", zhLabel: "可复现启动" },
      { id: "supported-operation", label: "Supported Operation", zhLabel: "受支持操作" },
      { id: "permission-boundary", label: "Permission Boundary", zhLabel: "权限边界" },
    ]),
  },
  {
    id: "change-validation",
    label: "Change Validation",
    zhLabel: "改动验证",
    question: "Does the agent run verification relevant to the final change, diagnose and repair failures with usable observability, and revalidate the repaired result?",
    zhQuestion: "Agent 是否针对最终改动执行相关验证，借助可用的可观测性诊断并修复故障，再对修复后的结果进行复验？",
    subdimensions: Object.freeze([
      { id: "relevant-check", label: "Relevant Verification", zhLabel: "相关验证" },
      { id: "failure-repair", label: "Failure Diagnosis and Repair", zhLabel: "故障诊断与修复" },
      { id: "validate-again", label: "Post-repair Revalidation", zhLabel: "修复后复验" },
    ]),
  },
  {
    id: "reliable-delivery",
    label: "Reliable Delivery",
    zhLabel: "可靠交付",
    question: "Is the current result accepted at its real delivery boundary, with risk-appropriate approval and a usable rollback or recovery path?",
    zhQuestion: "当前结果是否在真实交付边界完成验收，并具备与风险匹配的审批以及可用的回滚或恢复路径？",
    subdimensions: Object.freeze([
      { id: "acceptance-evidence", label: "Delivery Acceptance", zhLabel: "交付验收" },
      { id: "high-risk-approval", label: "High-risk Approval", zhLabel: "高风险审批" },
      { id: "rollback-recovery", label: "Rollback or Recovery", zhLabel: "回滚或恢复" },
    ]),
  },
  {
    id: "learning-capture",
    label: "Learning Capture",
    zhLabel: "经验沉淀",
    question: "Does the Harness detect lifecycle, recurring, and maintenance opportunities, turn supported opportunities into reusable improvements, and keep those improvements accurate and effective over time?",
    zhQuestion: "Harness 是否能发现生命周期、重复工作和维护机会，把有证据支持的机会转化为可复用改进，并让这些改进长期保持准确、有效？",
    crossWindow: true,
    subdimensions: Object.freeze([
      { id: "lifecycle-repeat-detection", label: "Lifecycle Opportunity Detection", zhLabel: "生命周期机会识别" },
      { id: "loop-engineering", label: "Loop Engineering", zhLabel: "闭环工程化" },
      { id: "later-validation", label: "Longitudinal Validation", zhLabel: "长期验证" },
    ]),
  },
]);

export const AGENT_WORK_LOOP_DIMENSION_IDS = Object.freeze(
  AGENT_WORK_LOOP_DIMENSIONS.map((dimension) => dimension.id),
);

export const AGENT_WORK_LOOP_CURRENT_TASK_DIMENSION_IDS = Object.freeze(
  AGENT_WORK_LOOP_DIMENSIONS
    .filter((dimension) => dimension.crossWindow !== true)
    .map((dimension) => dimension.id),
);

export const AGENT_WORK_LOOP_SUBDIMENSION_IDS = Object.freeze(
  AGENT_WORK_LOOP_DIMENSIONS.flatMap((dimension) => dimension.subdimensions.map((subdimension) => subdimension.id)),
);

export const TASK_LOOP_EVIDENCE_LAYERS = [
  "Present",
  "Wired",
  "Exercised",
  "Outcome-supported",
];

// Deterministic evidence indexes and ceilings apply only to the four
// current-task dimensions. The helpers below return null for Learning Capture so
// its Agent-authored score cannot inherit a state-to-score rule accidentally.
export const AGENT_WORK_LOOP_EVIDENCE_SCORES = Object.freeze({
  Present: 40,
  Wired: 60,
  Exercised: 75,
  "Outcome-supported": 90,
  Missing: 0,
  Unobserved: 0,
  "Not applicable": 0,
});

export const AGENT_WORK_LOOP_AI_SCORE_CEILINGS = Object.freeze({
  Present: 74,
  Wired: 84,
  Exercised: 94,
  "Outcome-supported": 100,
  Missing: 59,
  Unobserved: 59,
  "Not applicable": 59,
});

const LEARNING_LOOP_SCORE_ROW_IDS = new Set([
  "learning-capture",
  ...AGENT_WORK_LOOP_DIMENSIONS
    .find((dimension) => dimension.id === "learning-capture")
    .subdimensions.map((subdimension) => subdimension.id),
]);

function containsLearningLoopScoreRow(rows) {
  return rows.some((row) => LEARNING_LOOP_SCORE_ROW_IDS.has(row?.id));
}

export function scoreAgentWorkLoopEvidence(row) {
  if (LEARNING_LOOP_SCORE_ROW_IDS.has(row?.id)) return null;
  const key = row?.level ?? row?.state ?? "Unobserved";
  return AGENT_WORK_LOOP_EVIDENCE_SCORES[key] ?? 0;
}

export function scoreAgentWorkLoopDimension(subdimensions) {
  const rows = Array.isArray(subdimensions) ? subdimensions : [];
  if (rows.length === 0) return 0;
  if (containsLearningLoopScoreRow(rows)) return null;
  return Math.round(rows.reduce((total, row) => total + scoreAgentWorkLoopEvidence(row), 0) / rows.length);
}

export function agentWorkLoopDimensionScoreCeiling(subdimensions) {
  const rows = Array.isArray(subdimensions) ? subdimensions : [];
  if (rows.length === 0) return 59;
  if (containsLearningLoopScoreRow(rows)) return null;
  return rows.reduce((highest, row) => {
    const key = row?.level ?? row?.state ?? "Unobserved";
    return Math.max(highest, AGENT_WORK_LOOP_AI_SCORE_CEILINGS[key] ?? 59);
  }, 59);
}

export function isAgentWorkLoopReport(value) {
  const summary = value?.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
  if (!Array.isArray(value?.findings) || !Array.isArray(summary.dimensions)) return false;
  if (summary.modelId === AGENT_WORK_LOOP_MODEL_ID) return true;
  if (!summary.learningCapture || typeof summary.learningCapture !== "object" || Array.isArray(summary.learningCapture)) return false;
  if (!summary.aiAgentPractice || typeof summary.aiAgentPractice !== "object" || Array.isArray(summary.aiAgentPractice)) return false;
  return summary.dimensions.length > 0
    && summary.dimensions.every((dimension) => typeof dimension?.id === "string" && Array.isArray(dimension?.findingRefs))
    && value.findings.every((finding) => typeof finding?.id === "string" && Array.isArray(finding?.dimensionRefs));
}
