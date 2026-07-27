import {
  classifyLifecycleCommand,
  detectLifecycleDemandSignals,
} from "./lifecycle-demand-signals.mjs";

const GOAL_TOOL_NAMES = new Set(["get_goal", "create_goal", "update_goal"]);
const PLAN_TOOL_NAMES = new Set(["update_plan"]);
const USER_EVENT_TYPES = new Set(["user", "last-prompt", "UserPromptSubmit"]);

const STRONG_PLAN_MODE_PATTERN = /Switched mode to PLAN|Plan mode is active|You are now in Plan mode/i;
const CODEX_PLAN_MODE_PATTERN = /\bPlan Mode\b|Collaboration Mode:\s*Plan/i;
const SPEC_REFERENCE_PATTERN = /(?:^|[\s@`'"])(?:[^\s`'"]*\/)?(?:docs|\.qoder|\.agents|\.codex|\.cursor|\.claude)\/specs?\/[^\s`'"]+\.md\b|\bSpec ID:\s*[-A-Za-z0-9_./]+/i;
const SPEC_ACTION_PATTERN = /\b(?:review|read|inspect|assess|validate|tighten|create|update|write|draft)\b|审查|评审|检查|阅读|分析|创建|更新|编写|完善/iu;

export function detectPlanningSignals(event, { platform }) {
  const signals = [];
  const host = platform;
  const scope = event.planningScope ?? "workspace";
  const userText = event.userText ?? "";
  const content = event.content ?? userText;
  const acceptsUserText = isUserTextEvent(event);

  if (event.functionCallName && GOAL_TOOL_NAMES.has(event.functionCallName)) {
    signals.push(makeSignal({
      name: event.functionCallName,
      kind: "goal-tool",
      host,
      scope,
      confidence: "High",
      event,
    }));
  }

  if (event.functionCallName && PLAN_TOOL_NAMES.has(event.functionCallName)) {
    signals.push(makeSignal({
      name: event.functionCallName,
      kind: "plan-tool",
      host,
      scope,
      confidence: "High",
      event,
    }));
  }

  if (acceptsUserText && isUserCommand(userText, "/goal")) {
    signals.push(makeSignal({
      name: "/goal",
      kind: "goal-command",
      host,
      scope,
      confidence: "High",
      event,
    }));
  }

  const lifecycleCommand = acceptsUserText ? classifyLifecycleCommand(userText) : null;
  if (lifecycleCommand) {
    signals.push(makeSignal({
      name: lifecycleCommand.canonicalName,
      kind: lifecycleCommand.kind,
      host,
      scope,
      confidence: "High",
      event,
    }));
  }

  const planModeConfidence = planModeSignalConfidence(content, platform);
  if (planModeConfidence) {
    signals.push(makeSignal({
      name: "plan-mode",
      kind: "plan-mode",
      host,
      scope,
      confidence: planModeConfidence,
      event,
    }));
  }

  const bareSpecificationDemand = acceptsUserText
    && lifecycleCommand?.kind !== "spec-command"
    && detectLifecycleDemandSignals({ ...event, type: event.type ?? "user" }, { platform })
      .some((signal) => signal.family === "specification");
  if (acceptsUserText && (isSpecReference(userText) || bareSpecificationDemand)) {
    signals.push(makeSignal({
      name: "spec-session-reference",
      kind: "spec-reference",
      host,
      scope,
      confidence: "Medium",
      event,
    }));
  }

  return signals;
}

export function topPlanningSignals(events, { platform, limit = 20 } = {}) {
  const counts = new Map();
  const refs = new Map();
  const metadata = new Map();

  for (const event of events) {
    for (const signal of detectPlanningSignals(event, { platform })) {
      const key = [signal.host, signal.kind, signal.name, signal.scope, signal.confidence].join("\0");
      counts.set(key, (counts.get(key) ?? 0) + 1);
      metadata.set(key, signal);
      if (!refs.has(key)) {
        refs.set(key, []);
      }
      if (signal.evidenceRef && refs.get(key).length < 3) {
        refs.get(key).push(signal.evidenceRef);
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || signalSortName(metadata.get(a[0])).localeCompare(signalSortName(metadata.get(b[0]))))
    .slice(0, limit)
    .map(([key, count]) => {
      const signal = metadata.get(key);
      return {
        name: signal.name,
        kind: signal.kind,
        host: signal.host,
        scope: signal.scope,
        confidence: signal.confidence,
        count,
        evidenceRefs: refs.get(key) ?? [],
      };
    });
}

function makeSignal({ name, kind, host, scope, confidence, event }) {
  return {
    name,
    kind,
    host,
    scope,
    confidence,
    evidenceRef: event.evidenceRef,
  };
}

function isUserCommand(text, command) {
  if (!text) {
    return false;
  }
  const pattern = new RegExp(`^\\s*${escapeRegExp(command)}(?:\\s|$)`, "i");
  return pattern.test(text);
}

function isUserTextEvent(event) {
  return USER_EVENT_TYPES.has(event?.type);
}

function planModeSignalConfidence(text, platform) {
  if (!text) {
    return null;
  }
  if (STRONG_PLAN_MODE_PATTERN.test(text)) {
    return "High";
  }
  if (platform === "codex" && CODEX_PLAN_MODE_PATTERN.test(text)) {
    return "Medium";
  }
  return null;
}

function isSpecReference(text) {
  if (!text || text.includes("<loaded_context>")) {
    return false;
  }
  if (!SPEC_REFERENCE_PATTERN.test(text)) {
    return false;
  }
  return SPEC_ACTION_PATTERN.test(text)
    || /^@\S*(?:docs|\.qoder|\.agents|\.codex|\.cursor|\.claude)\/specs?\//i.test(text.trim());
}

function signalSortName(signal) {
  return [signal?.host, signal?.scope, signal?.kind, signal?.name].filter(Boolean).join(":");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
