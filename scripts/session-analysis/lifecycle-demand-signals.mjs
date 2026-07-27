import { createHash } from "node:crypto";

export const LIFECYCLE_DEMAND_SCHEMA_VERSION = 1;

const USER_EVENT_TYPES = new Set(["user", "last-prompt", "UserPromptSubmit"]);
const CONFIDENCE_RANK = new Map([
  ["Low", 0],
  ["Medium", 1],
  ["High", 2],
]);

const DEFINITIONS = Object.freeze([
  definition({
    intent: "specification-review",
    family: "specification",
    dimensionId: "task-understanding",
    checkId: "goal-understanding",
    patterns: [
      exact(/(?:spec|specification|requirements?|prd|adr|rfc|decision[\s_-]+record|(?:user[\s_-]+)?stor(?:y|ies))[\s_-]+review/iu),
      high(/^(?:spec|specification|requirements?|prd|adr|rfc|decision-record|(?:user-)?story)-review\b/iu),
      exact(/(?:规格|规范|需求(?:规格)?|产品需求文档|验收标准|用户故事|架构决策)(?:评审|审查|审核)/u),
      high(/\b(?:review|assess|inspect|validate|critique|tighten)\s+(?:an?\s+|the\s+|this\s+|that\s+|our\s+)?(?:spec|specification|requirements?|prd|adr|rfc|decision\s+record|user\s+stor(?:y|ies)|acceptance\s+criteria)\b/iu),
      high(/\b(?:conduct|perform|run|do|start|schedule|request|need|want)\s+(?:an?\s+|the\s+)?(?:spec|specification|requirements?|prd|adr|decision\s+record|user\s+stor(?:y|ies)|acceptance\s+criteria)\s+(?:review|assessment|inspection)\b/iu),
      high(/\b(?:spec|specification|requirements?|prd|adr|decision\s+record|user\s+stor(?:y|ies)|acceptance\s+criteria)\s+(?:review|assessment|inspection)\b(?=\s+(?:before|for|on|of)\b)/iu),
      high(/(?:请|请先|帮我|需要|先|进行|执行|开展|做(?:一次)?)(?:对)?(?:这份|这个|该|当前|现有)?(?:规格|规范|需求(?:规格)?|产品需求文档|验收标准|用户故事|架构决策)(?:进行)?(?:评审|审查|审核|检查)/u),
      high(/(?:评审|审查|审核|检查|完善)(?:一下|一遍)?(?:这份|这个|该|当前|现有)?(?:规格|规范|需求(?:规格)?|产品需求文档|验收标准|用户故事|架构决策)/u),
    ],
  }),
  definition({
    intent: "specification-authoring",
    family: "specification",
    dimensionId: "task-understanding",
    checkId: "goal-understanding",
    patterns: [
      high(/\b(?:write|draft|create|prepare|author|update|revise|refine|tighten|clarify)\s+(?:an?\s+|the\s+|this\s+|our\s+)?(?:spec|specification|requirements?|prd|adr|decision\s+record|user\s+stor(?:y|ies)|acceptance\s+criteria)\b/iu),
      high(/\b(?:spec|specification|requirements?|prd|adr|decision\s+record|user\s+stor(?:y|ies)|acceptance\s+criteria)\s+(?:authoring|drafting|preparation|refinement)\b/iu),
      high(/(?:编写|起草|创建|制定|准备|更新|修订|完善|细化|澄清)(?:一份|这个|这份|该|当前|现有)?(?:规格|规范|需求(?:规格)?|产品需求文档|用户故事|验收标准|架构决策)/u),
      high(/(?:规格|规范|需求(?:规格)?|产品需求文档|用户故事|验收标准|架构决策)(?:编写|起草|创建|制定|准备|更新|修订|完善|细化|澄清)/u),
    ],
  }),
  definition({
    intent: "task-planning",
    family: "planning",
    dimensionId: "task-understanding",
    checkId: "scope-boundary",
    patterns: [
      high(/\b(?:write|draft|create|prepare|update|revise|refine)\s+(?:an?\s+|the\s+|this\s+|our\s+)?(?:implementation\s+|work\s+|task\s+|delivery\s+)?plan\b/iu),
      high(/\bplan\s+(?:the\s+|this\s+|our\s+)?(?:implementation|work|change|task|delivery|migration|release)\b/iu),
      high(/\b(?:plan|scope|refine)\s+(?:the\s+|this\s+|an?\s+)?(?:issue|ticket|work\s+item)\b/iu),
      high(/\b(?:review|assess|inspect|validate|tighten)\s+(?:an?\s+|the\s+|this\s+|our\s+)?(?:implementation\s+|work\s+|task\s+|delivery\s+)?plan\b/iu),
      high(/\b(?:implementation[\s_-]+|work[\s_-]+|task[\s_-]+|delivery[\s_-]+)?plan[\s_-]+(?:review|assessment|inspection)\b/iu),
      high(/(?:制定|编写|创建|准备|更新|修订|完善|细化)(?:一份|这个|这份|该|当前|现有)?(?:实施|实现|工作|任务|交付|迁移|发布)?计划/u),
      high(/(?:规划|计划|拆解)(?:一下|一遍)?(?:这次|这个|该|当前)?(?:实施|实现|工作|改动|任务|交付|迁移|发布)/u),
      high(/(?:评审|审查|审核|检查|完善)(?:一下|一遍)?(?:这个|这份|该|当前|现有)?(?:实施|实现|工作|任务|交付)?计划/u),
      high(/(?:实施|实现|工作|任务|交付)?计划(?:评审|审查|审核|检查)/u),
    ],
  }),
  definition({
    intent: "setup-isolation",
    family: "setup-isolation",
    dimensionId: "controlled-execution",
    checkId: "instruction-led-start",
    patterns: [
      high(/\b(?:set\s*up|configure|initialize|initialise|bootstrap|install|prepare)\s+(?:an?\s+|the\s+|this\s+|our\s+)?(?:development\s+|local\s+|test\s+)?(?:environment|workspace|project|repo(?:sitory)?|dependencies)\b/iu),
      high(/\b(?:create|prepare|use|open|isolate)\s+(?:an?\s+|the\s+|this\s+)?(?:isolated\s+)?(?:worktree|sandbox|workspace|branch|checkout)\b/iu),
      high(/\b(?:environment|workspace|project|repo(?:sitory)?|worktree)\s+(?:setup|bootstrap|onboarding|isolation)\b/iu),
      high(/(?:搭建|设置|配置|初始化|安装|准备)(?:一个|这个|该|当前|本地|开发|测试)?(?:环境|工作区|项目|仓库|依赖)/u),
      high(/(?:创建|准备|使用|打开|隔离)(?:一个|这个|该|当前)?(?:工作树|worktree|沙箱|隔离环境|隔离分支|独立工作区)/iu),
    ],
  }),
  definition({
    intent: "debugging",
    family: "debug-test-verification",
    dimensionId: "change-validation",
    checkId: "failure-repair",
    patterns: [
      high(/\b(?:debug|diagnose|troubleshoot|reproduce|investigate|fix)\s+(?:the\s+|this\s+|that\s+|an?\s+)?(?:bug|error|failure|issue|problem|regression|crash|failing\s+test|test\s+failure|build\s+failure)\b/iu),
      high(/(?:调试|排查|诊断|复现|调查)(?:一下|一遍)?(?:这个|该|当前)?(?:缺陷|错误|故障|问题|回归|崩溃)/u),
      high(/(?:自动)?修复(?:一下|一遍)?(?:这个|该|当前)?\s*(?:bug|缺陷|错误|故障|回归|崩溃)/iu),
    ],
  }),
  definition({
    intent: "testing-verification",
    family: "debug-test-verification",
    dimensionId: "change-validation",
    checkId: "relevant-check",
    patterns: [
      high(/\b(?:run|execute|write|add|fix|rerun|re-run)\s+(?:the\s+|these\s+|those\s+|some\s+)?(?:(?:focused|relevant|failing|unit|integration|acceptance|regression)\s+)?(?:tests?|checks?|verification|validation)\b/iu),
      high(/\b(?:test|verify|validate|check)\s+(?:the\s+|this\s+|that\s+|our\s+)?(?:change|fix|behavior|behaviour|build|runtime|output|result|artifact|feature)\b/iu),
      high(/(?:运行|执行|编写|添加|修复|重跑|重新运行)(?:一下|一遍|这些|相关|对应)?(?:测试|检查|验证)/u),
      high(/(?:测试|验证|检查)(?:一下|一遍)?(?:这个|该|当前)?(?:改动|修复|行为|构建|运行时|输出|结果|产物|功能)/u),
    ],
  }),
  definition({
    intent: "review-acceptance",
    family: "review-acceptance-delivery",
    dimensionId: "reliable-delivery",
    checkId: "acceptance-evidence",
    patterns: [
      high(/\b(?:review|accept|approve)\s+(?:the\s+|this\s+|that\s+|our\s+)?(?:change|changes|code|pull\s+request|pr|branch|release|delivery)\b/iu),
      high(/\b(?:code|change|pull\s+request|pr|branch|release)\s+(?:review|acceptance|approval|handoff)\b/iu),
      high(/(?:评审|审查|审核|验收|批准)(?:一下|一遍)?(?:这个|这些|该|当前)?(?:代码|改动|变更|拉取请求|PR|分支|发布|交付)/iu),
      high(/(?:代码|改动|变更|拉取请求|PR|分支|发布|交付)(?:的)?(?:评审|审查|审核|验收|批准)/iu),
    ],
  }),
  definition({
    intent: "release-delivery",
    family: "review-acceptance-delivery",
    dimensionId: "reliable-delivery",
    checkId: "acceptance-evidence",
    patterns: [
      high(/\b(?:release|ship|deliver|deploy)\s+(?:the\s+|this\s+|that\s+|our\s+)?(?:change|changes|code|release|build|artifact|delivery|version)\b/iu),
      high(/\b(?:release|deployment|delivery)\s+(?:preparation|handoff|verification|completion)\b/iu),
      high(/(?:发布|部署|交付)(?:一下|一遍)?(?:这个|这些|该|当前)?(?:代码|改动|变更|版本|构建|产物|发布|交付)/iu),
      high(/(?:代码|改动|变更|版本|构建|产物|发布|交付)(?:的)?(?:发布|部署|交付)/iu),
    ],
  }),
  definition({
    intent: "branch-completion",
    family: "review-acceptance-delivery",
    dimensionId: "reliable-delivery",
    checkId: "acceptance-evidence",
    patterns: [
      high(/\b(?:merge|complete|finish|finalize|finalise)\s+(?:the\s+|this\s+|that\s+|our\s+)?(?:change|changes|pull\s+request|pr|branch)\b/iu),
      high(/\b(?:branch|pull\s+request|pr)\s+(?:completion|closeout|merge\s+readiness|ready\s+to\s+merge)\b|\bready\s+to\s+merge\b/iu),
      high(/(?:合并|完成|收尾)(?:一下|一遍)?(?:这个|这些|该|当前)?(?:代码|改动|变更|拉取请求|PR|分支)/iu),
      high(/(?:代码|改动|变更|拉取请求|PR|分支)(?:的)?(?:合并|完成|收尾)/iu),
    ],
  }),
  definition({
    intent: "issue-triage",
    family: "planning",
    dimensionId: "task-understanding",
    checkId: "goal-understanding",
    patterns: [
      exact(/issue[\s_-]+triage/iu),
      high(/^(?:(?:run|start|perform)\s+)?issue[-_]triage\b/iu),
      exact(/(?:Issue|问题单|工单|缺陷)\s*(?:巡检|分诊)/iu),
      high(/\b(?:triage|patrol|inspect|review|sort|prioriti[sz]e|label)\s+(?:(?:the|these)\s+)?(?:open\s+)?(?:issues?|tickets?|bug\s+reports?)\b/iu),
      high(/\b(?:issues?|tickets?|bug\s+reports?)\s+(?:triage|inspection|review|prioriti[sz]ation|labelling|labeling)\b/iu),
      high(/(?:巡检|分诊|分类|梳理|标记|排序|检查)(?:一下|一遍|这些|待处理|开放的)?(?:Issue|issues|问题单|工单|缺陷)/iu),
      high(/(?:Issue|issues|问题单|工单|缺陷)\s*(?:巡检|分诊|分类|梳理|标记|排序|检查)/iu),
    ],
  }),
  definition({
    intent: "documentation-maintenance",
    family: "documentation-maintenance",
    dimensionId: "reliable-delivery",
    checkId: "acceptance-evidence",
    patterns: [
      exact(/(?:documentation|docs?)\s+maintenance/iu),
      exact(/文档(?:维护|巡检)/u),
      high(/\b(?:maintain|update|refresh|repair|audit|review|synchroni[sz]e|sync|check)\s+(?:(?:the|this|our)\s+)?(?:project\s+)?(?:documentation|docs|readme)\b/iu),
      high(/\b(?:detect|fix|repair|check)\s+(?:documentation|docs?)\s+(?:drift|staleness|broken\s+links?)\b/iu),
      high(/(?:维护|更新|刷新|修复|巡检|检查|同步|审查)(?:一下|一遍|这些|该|当前|项目)?(?:文档|说明|README)/iu),
      high(/(?:检测|修复|检查)(?:一下|一遍)?(?:文档)?(?:漂移|过期|失效链接|断链)/u),
    ],
  }),
]);

const COMMAND_DEFINITIONS = Object.freeze({
  "issue-workflow-planning": definition({
    intent: "issue-workflow-planning",
    family: "planning",
    dimensionId: "task-understanding",
    checkId: "scope-boundary",
    patterns: [],
  }),
});

const DEFINITION_BY_INTENT = new Map(
  [...DEFINITIONS, ...Object.values(COMMAND_DEFINITIONS)].map((item) => [item.intent, item]),
);

const INJECTED_BLOCK_TAGS = Object.freeze([
  "environment_context",
  "loaded_context",
  "system_reminder",
  "system_message",
  "system-reminder",
  "system-message",
  "developer_context",
  "app_context",
  "skill",
]);

export function detectLifecycleDemandSignals(event, { platform } = {}) {
  const text = preparedUserText(event);
  if (!text) return [];

  const signals = [];
  const command = commandDefinition(text);
  if (command) {
    signals.push(makeSignal(command, event, { confidence: "High", platform }));
  }

  const commandFamily = command?.family ?? null;
  for (const item of DEFINITIONS) {
    if (commandFamily && item.family === commandFamily) continue;
    if (command?.intent === "issue-triage" && item.intent === "issue-triage") continue;
    if (item.intent === "documentation-maintenance" && /(?:docs?|documentation)[\\/]specs?\b/iu.test(text)) continue;
    const confidence = matchConfidence(text, item.patterns);
    if (!confidence) continue;
    signals.push(makeSignal(item, event, { confidence, platform }));
  }

  return deduplicateLifecycleDemandSignals(signals);
}

export function topLifecycleDemandSignals(events = [], { platform, limit = 20 } = {}) {
  const counts = new Map();
  const metadata = new Map();
  const refs = new Map();

  for (const event of events) {
    for (const signal of detectLifecycleDemandSignals(event, { platform })) {
      const key = [signal.host ?? "unknown", signal.scope, signal.family, signal.intent].join("\0");
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const previous = metadata.get(key);
      metadata.set(key, previous && confidenceRank(previous.confidence) >= confidenceRank(signal.confidence)
        ? previous
        : signal);
      const evidenceRefs = refs.get(key) ?? [];
      evidenceRefs.push(...signal.evidenceRefs);
      refs.set(key, uniqueEvidenceRefs(evidenceRefs).slice(0, 3));
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || signalSortName(metadata.get(left[0])).localeCompare(signalSortName(metadata.get(right[0]))))
    .slice(0, limit)
    .map(([key, count]) => ({
      ...publicSignal(metadata.get(key)),
      count,
      evidenceRefs: refs.get(key) ?? [],
    }));
}

export function deduplicateLifecycleDemandSignals(signals = []) {
  const grouped = new Map();
  for (const source of signals) {
    const signal = normalizeSignal(source);
    if (!signal) continue;
    const key = [signal.host ?? "unknown", signal.scope, signal.family, signal.intent].join("\0");
    const previous = grouped.get(key);
    if (!previous) {
      grouped.set(key, signal);
      continue;
    }
    grouped.set(key, {
      ...(confidenceRank(previous.confidence) >= confidenceRank(signal.confidence) ? previous : signal),
      evidenceRefs: uniqueEvidenceRefs([...previous.evidenceRefs, ...signal.evidenceRefs]).slice(0, 8),
    });
  }
  return [...grouped.values()].sort((left, right) => signalSortName(left).localeCompare(signalSortName(right)));
}

function definition({ intent, family, dimensionId, checkId, patterns }) {
  return Object.freeze({ intent, family, dimensionId, checkId, patterns: Object.freeze(patterns) });
}

function high(pattern) {
  return Object.freeze({ pattern, confidence: "High", exact: false });
}

function exact(pattern) {
  return Object.freeze({ pattern, confidence: "High", exact: true });
}

export function classifyLifecycleCommand(text) {
  const source = String(text ?? "");
  const match = source.match(/^\s*\/([\p{L}\p{N}][\p{L}\p{N}._-]*)(?=\s|$)/iu);
  if (!match) return null;
  const command = match[1].toLowerCase();
  const args = source.slice(match[0].length).trim();
  if (/^(?:plan|planning|ultraplan|ultra-plan)(?:-[\p{L}\p{N}._-]+)?$/iu.test(command)
    || /^(?:计划|规划)(?:-[\p{L}\p{N}._-]+)?$/u.test(command)) {
    return {
      intent: "task-planning",
      canonicalName: /^(?:ultraplan|ultra-plan)$/iu.test(command) ? "/ultraplan" : "/plan",
      kind: "plan-command",
    };
  }
  const story = command.match(/^(?:story|user-story)(?:-([\p{L}\p{N}._-]+))?$/iu)
    ?? command.match(/^(?:故事|用户故事)(?:-([\p{L}\p{N}._-]+))?$/u);
  if (story) {
    const action = [story[1], args].filter(Boolean).join(" ");
    const review = /^(?:(?:review|assess|inspect|validate|critique|tighten)(?:\b|-)|(?:评审|审查|审核|检查))/iu.test(action);
    return {
      intent: review ? "specification-review" : "specification-authoring",
      canonicalName: "/story",
      kind: "spec-command",
    };
  }
  const specification = command.match(/^(?:spec|specification|requirements?|prd|adr|rfc|decision-record|acceptance(?:-criteria)?)(?:-([\p{L}\p{N}._-]+))?$/iu)
    ?? command.match(/^(?:规格|规范|需求|验收标准)(?:-([\p{L}\p{N}._-]+))?$/u);
  if (specification) {
    const action = [specification[1], args].filter(Boolean).join(" ");
    const review = /^(?:(?:review|assess|inspect|validate|critique|tighten)(?:\b|-)|(?:评审|审查|审核|检查))/iu.test(action);
    return {
      intent: review ? "specification-review" : "specification-authoring",
      canonicalName: "/spec",
      kind: "spec-command",
    };
  }
  if (/^issue-[\p{L}\p{N}][\p{L}\p{N}._-]*$/iu.test(command)) {
    const triage = /issue-(?:(?:triage|patrol|inspect|review|audit)(?:-|$)|(?:巡检|分诊)$)/iu.test(command);
    return {
      intent: triage ? "issue-triage" : "issue-workflow-planning",
      canonicalName: "/issue-*",
      kind: "plan-command",
    };
  }
  return null;
}

function classifyLifecycleSkillInvocation(text) {
  const source = String(text ?? "").trim();
  const match = source.match(/^(?:use\s+)?\$?([\p{L}\p{N}][\p{L}\p{N}._-]*(?::[\p{L}\p{N}][\p{L}\p{N}._-]*)?)(?=\s|$)/iu);
  if (!match) return null;
  const token = match[1].toLowerCase().split(":").at(-1);
  if (/^(?:spec|specification|requirements?|adr|rfc)-review$/iu.test(token)) {
    return { intent: "specification-review", canonicalName: "$spec-review", kind: "skill-invocation" };
  }
  if (/^(?:spec|specification|requirements?|adr|rfc)-(?:authoring|preparation|writer)$/iu.test(token)) {
    return { intent: "specification-authoring", canonicalName: "$spec", kind: "skill-invocation" };
  }
  if (/^(?:ultra-?plan|planning|task-planning)$/iu.test(token)) {
    return { intent: "task-planning", canonicalName: "$plan", kind: "skill-invocation" };
  }
  if (/^issue-(?:triage|patrol|inspect|review|audit)$/iu.test(token)) {
    return { intent: "issue-triage", canonicalName: "$issue-triage", kind: "skill-invocation" };
  }
  return null;
}

function commandDefinition(text) {
  const command = classifyLifecycleCommand(text) ?? classifyLifecycleSkillInvocation(text);
  return command ? DEFINITION_BY_INTENT.get(command.intent) : null;
}

function matchConfidence(text, patterns) {
  let best = null;
  for (const item of patterns) {
    const pattern = item.exact
      ? new RegExp(`^(?:${item.pattern.source})[\\s.!?。！？]*$`, item.pattern.flags)
      : item.pattern;
    const match = firstUnnegatedMatch(text, pattern);
    if (!match) continue;
    if (!best || confidenceRank(item.confidence) > confidenceRank(best)) best = item.confidence;
  }
  return best;
}

function firstUnnegatedMatch(text, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(globalPattern)) {
    if (!isNegated(text, match.index ?? 0)) return match;
  }
  return null;
}

function isNegated(text, index) {
  const prefix = text.slice(Math.max(0, index - 72), index);
  return /(?:\b(?:never|cannot|can't|could\s+not|couldn't|should\s+not|shouldn't|must\s+not|mustn't|do\s+not|don't|does\s+not|doesn't|no\s+need\s+(?:to|for)|not\s+going\s+to|without)\b|(?:不(?:要|需|需要|用|必|会)|无需|無需|不用|别|別))[^\n.!?;:。！？；：]{0,48}$/iu.test(prefix);
}

function preparedUserText(event) {
  if (!USER_EVENT_TYPES.has(event?.type)) return "";
  let text = stripInjectedAndQuotedContext(String(event?.userText ?? event?.content ?? ""));
  if (text === null) return "";
  text = text.trim();
  if (!text) return "";
  const requestMarker = text.match(/(?:^|\n)#{1,3}\s*My request for Codex:\s*/iu);
  if (requestMarker?.index !== undefined) {
    text = text.slice(requestMarker.index + requestMarker[0].length).trim();
  } else if (/^(?:#\s*AGENTS\.md instructions\b|<environment_context>|<loaded_context>|<skill>|#\s*Files mentioned by the user:)/iu.test(text)) {
    return "";
  }
  // A leading, bounded lifecycle command is user intent, not a POSIX path.
  // Arguments never enter the normalized signal, so preserving this text is
  // safe and keeps /plan, /spec, /story, and /issue-* detectable.
  const prepared = classifyLifecycleCommand(text) || classifyLifecycleSkillInvocation(text) ? text : maskPathLikeText(text);
  return prepared
    .replace(/\s+/gu, " ")
    .trim();
}

function stripInjectedAndQuotedContext(value) {
  let text = String(value ?? "");
  for (const marker of ["```", "~~~"]) {
    const count = text.split(marker).length - 1;
    if (count % 2 !== 0) return null;
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    text = text.replace(new RegExp(`${escaped}[\\s\\S]*?${escaped}`, "gu"), " ");
  }
  const commentStarts = (text.match(/<!--/gu) ?? []).length;
  const commentEnds = (text.match(/-->/gu) ?? []).length;
  if (commentStarts !== commentEnds) return null;
  text = text.replace(/<!--[\s\S]*?-->/gu, " ");
  text = text.replace(/^[ \t]*>[^\n]*(?:\n|$)/gmu, " ");
  text = text.replace(/\[([^\]\n]{0,200})\]\(([^)\n]{1,500})\)/gu, (_match, label, target) => {
    const normalizedTarget = String(target).trim().replace(/^<|>$/gu, "");
    return /^skill:\/\//iu.test(normalizedTarget) && /^\$[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u.test(String(label).trim())
      ? ` ${String(label).trim()} `
      : semanticPathPlaceholder(normalizedTarget);
  });

  for (const tag of INJECTED_BLOCK_TAGS) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const open = new RegExp(`<${escaped}\\b[^>]*>`, "iu");
    const close = new RegExp(`<\\/${escaped}\\s*>`, "iu");
    while (open.test(text)) {
      const openMatch = open.exec(text);
      const remainder = text.slice((openMatch?.index ?? 0) + (openMatch?.[0].length ?? 0));
      const closeMatch = close.exec(remainder);
      if (!openMatch || !closeMatch) return null;
      const end = openMatch.index + openMatch[0].length + closeMatch.index + closeMatch[0].length;
      text = `${text.slice(0, openMatch.index)} ${text.slice(end)}`;
    }
    const fragment = new RegExp(`<\\/?${escaped}(?:\\b|[_-])`, "iu");
    if (open.test(text) || close.test(text) || fragment.test(text)) return null;
  }

  return text
    .replace(/`([^`\n]+)`/gu, (_match, content) => quotedContextPlaceholder(content))
    .replace(/"([^"\n]{1,400})"/gu, (_match, content) => quotedContextPlaceholder(content))
    .replace(/'([^'\n]{2,400})'/gu, (_match, content) => quotedContextPlaceholder(content))
    .replace(/“([^”\n]{1,400})”/gu, (_match, content) => quotedContextPlaceholder(content))
    .replace(/‘([^’\n]{1,400})’/gu, (_match, content) => quotedContextPlaceholder(content));
}

function quotedContextPlaceholder(content) {
  return maskPathLikeText(content).includes(" specification ") ? " specification " : " ";
}

function maskPathLikeText(value) {
  return String(value ?? "")
    .replace(/(^|[\s(])((?:[A-Za-z]:[\\/]|~?[\\/])[^\s<>"'`]+)/gmu, (_match, prefix, pathValue) =>
      `${prefix}${semanticPathPlaceholder(pathValue)}`)
    .replace(/(^|[\s(])((?:(?:\.{1,2}|[A-Za-z0-9_.@-]+)[\\/])+[A-Za-z0-9_.@-]+)/gmu, (_match, prefix, pathValue) =>
      `${prefix}${semanticPathPlaceholder(pathValue)}`);
}

function semanticPathPlaceholder(pathValue) {
  const normalized = String(pathValue ?? "")
    .replaceAll("\\", "/")
    .replace(/[),.;:!?。！？；：]+$/gu, "")
    .replace(/(\.md)(?:[#?][^/]*)$/iu, "$1")
    .toLowerCase();
  return /(?:^|\/)(?:(?:docs|\.qoder|\.agents|\.codex|\.cursor)\/)?(?:specs?|adrs?|rfcs?)\/(?:[^/]+\/)*[^/]+\.md$/iu.test(normalized)
    ? " specification "
    : " <path> ";
}

function makeSignal(item, event, { confidence, platform }) {
  const evidenceRefs = uniqueEvidenceRefs([
    event?.evidenceRef,
    ...(Array.isArray(event?.evidenceRefs) ? event.evidenceRefs : []),
  ].map((reference) => privacySafeEvidenceRef(reference, event)).filter(Boolean)).slice(0, 8);
  return {
    schemaVersion: LIFECYCLE_DEMAND_SCHEMA_VERSION,
    intent: item.intent,
    family: item.family,
    dimensionId: item.dimensionId,
    checkId: item.checkId,
    confidence,
    scope: event?.planningScope === "user-global" ? "user-global" : "workspace",
    ...(platform ? { host: safeHost(platform) } : {}),
    evidenceRefs,
  };
}

function normalizeSignal(source) {
  const item = DEFINITION_BY_INTENT.get(String(source?.intent ?? ""));
  if (!item) return null;
  const host = source?.host ? safeHost(source.host) : null;
  return {
    schemaVersion: LIFECYCLE_DEMAND_SCHEMA_VERSION,
    intent: item.intent,
    family: item.family,
    dimensionId: item.dimensionId,
    checkId: item.checkId,
    confidence: CONFIDENCE_RANK.has(source?.confidence) ? source.confidence : "Medium",
    scope: source?.scope === "user-global" ? "user-global" : "workspace",
    ...(host ? { host } : {}),
    evidenceRefs: uniqueEvidenceRefs((source?.evidenceRefs ?? []).map((value) => privacySafeEvidenceRef(value)).filter(Boolean)).slice(0, 8),
  };
}

function publicSignal(signal) {
  return {
    schemaVersion: signal.schemaVersion,
    intent: signal.intent,
    family: signal.family,
    dimensionId: signal.dimensionId,
    checkId: signal.checkId,
    confidence: signal.confidence,
    scope: signal.scope,
    ...(signal.host ? { host: signal.host } : {}),
  };
}

function privacySafeEvidenceRef(reference, event = {}) {
  const source = reference && typeof reference === "object" ? reference : {};
  const preservedId = /^event-[a-f0-9]{16}$/u.test(String(source.id ?? "")) ? source.id : null;
  const seed = {
    reference: source,
    sessionId: event?.sessionId ?? null,
    timestamp: event?.timestamp ?? null,
    type: event?.type ?? source?.type ?? null,
  };
  if (Object.values(seed).every((value) => value === null || (typeof value === "object" && Object.keys(value).length === 0))) {
    return null;
  }
  const result = {
    kind: safeEvidenceToken(source.kind, "session-event"),
    id: preservedId ?? `event-${fingerprint(seed)}`,
  };
  if (source.type || event?.type) result.type = safeEvidenceToken(source.type ?? event.type, "event");
  if (Number.isInteger(Number(source.line))) result.line = Number(source.line);
  if (Number.isInteger(Number(source.seq))) result.seq = Number(source.seq);
  return result;
}

function uniqueEvidenceRefs(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${value?.kind ?? ""}:${value?.id ?? ""}:${value?.line ?? ""}:${value?.seq ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function safeHost(value) {
  const host = String(value ?? "").toLowerCase();
  return ["qoder", "codex", "claude", "cursor"].includes(host) ? host : "unknown";
}

function safeEvidenceToken(value, fallback) {
  const token = String(value ?? "").trim();
  return /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u.test(token) ? token : fallback;
}

function confidenceRank(value) {
  return CONFIDENCE_RANK.get(value) ?? -1;
}

function signalSortName(signal) {
  return [signal?.host, signal?.scope, signal?.family, signal?.intent].filter(Boolean).join(":");
}
