import { timestampMillis } from "./time.mjs";
import { isFailure } from "./tool-call-trace.mjs";

export const DAILY_USAGE_SCHEMA_VERSION = 5;

const DEFAULT_MAX_DAYS = 365;
const DEFAULT_MODEL_LIMIT = 6;
const DEFAULT_SKILL_LIMIT = 8;
const DEFAULT_MCP_LIMIT = 8;
const NESTED_MCP_CALL_RE = /\btools\.(mcp__[A-Za-z_$][\w$]*(?:__[A-Za-z_$][\w$]*)+)\s*\(/gu;
const TOKEN_FIELDS = Object.freeze([
  "inputTokens",
  "outputTokens",
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
]);

function dateKey(value) {
  const millis = timestampMillis(value);
  return millis === null ? null : new Date(millis).toISOString().slice(0, 10);
}

function boundedLabel(value) {
  const label = String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, 80);
  return label || null;
}

function dateRange(first, last, maxDays) {
  if (!first || !last) return { dates: [], truncated: false };
  const start = Date.parse(`${first}T00:00:00.000Z`);
  const end = Date.parse(`${last}T00:00:00.000Z`);
  const totalDays = Math.floor((end - start) / 86_400_000) + 1;
  const boundedDays = Math.min(totalDays, maxDays);
  const boundedStart = end - ((boundedDays - 1) * 86_400_000);
  return {
    dates: Array.from({ length: boundedDays }, (_, index) =>
      new Date(boundedStart + (index * 86_400_000)).toISOString().slice(0, 10)),
    truncated: totalDays > boundedDays,
  };
}

function increment(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

function tokenCount(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function tokenUsageObservation(event) {
  const date = dateKey(event?.timestamp);
  if (!date) return null;
  const values = Object.fromEntries(TOKEN_FIELDS.map((field) => [field, tokenCount(event?.modelUsage?.[field])]));
  return TOKEN_FIELDS.some((field) => values[field] > 0) ? { date, ...values } : null;
}

function activatedSkillNames(event) {
  const values = [event?.skillName, ...(Array.isArray(event?.skillNames) ? event.skillNames : [])]
    .map(boundedLabel)
    .filter(Boolean);
  return [...new Set(values)];
}

export function collectSkillUsageObservations(events = []) {
  const seen = new Set();
  const observations = [];
  for (const event of events) {
    const invocations = Array.isArray(event?.skillInvocations) && event.skillInvocations.length > 0
      ? event.skillInvocations
      : activatedSkillNames(event).map((name) => ({ name, id: null }));
    for (const invocation of invocations) {
      const name = boundedLabel(invocation?.name);
      if (!name) continue;
      const invocationId = boundedLabel(invocation?.id);
      const identity = invocationId
        ? `${event?.sessionId ?? "unknown"}:id:${invocationId}`
        : `${event?.sessionId ?? "unknown"}:event:${event?.timestamp ?? "unknown"}:${name}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      observations.push({
        name,
        date: dateKey(event?.timestamp),
        evidenceRef: event?.evidenceRef,
        failed: isFailure(event),
      });
    }
  }
  return observations;
}

function mcpToolName(event) {
  const direct = boundedLabel(event?.toolName ?? event?.functionCallName);
  if (direct && direct !== "exec") return direct;
  if (direct !== "exec") return null;
  const matches = [...String(event?.commandText ?? "").matchAll(NESTED_MCP_CALL_RE)];
  return boundedLabel(matches.at(-1)?.[1]);
}

function mcpServerName(toolName) {
  const match = String(toolName ?? "").match(/^mcp__(\S+?)__(\S+)$/u);
  return boundedLabel(match?.[1]);
}

export function collectMcpUsageObservations(events = []) {
  const seen = new Set();
  const observations = [];
  events.forEach((event, index) => {
    const toolName = mcpToolName(event);
    const name = mcpServerName(toolName);
    const date = dateKey(event?.timestamp);
    if (!name || !date) return;
    const invocationId = boundedLabel(
      event?.toolInvocationId ?? event?.requestId ?? event?.callId,
    );
    const sessionId = boundedLabel(event?.sessionId) ?? "unknown";
    const fallbackId = boundedLabel(event?.evidenceRef)
      ?? boundedLabel(event?.timestamp)
      ?? String(index);
    const identity = invocationId
      ? `${sessionId}:invocation:${invocationId}`
      : `${sessionId}:event:${fallbackId}:${toolName}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    observations.push({ name, date, failed: isFailure(event) });
  });
  return observations;
}

export function collectModelSessionObservations(responses = []) {
  const seen = new Set();
  const observations = [];
  responses.forEach((event, index) => {
    const date = dateKey(event?.timestamp);
    const name = boundedLabel(event?.model) ?? "Unknown model";
    if (!date) return;
    const sessionId = boundedLabel(event?.sessionId);
    const fallbackId = boundedLabel(event?.evidenceRef) ?? boundedLabel(event?.timestamp) ?? String(index);
    const identity = sessionId
      ? `${date}:session:${sessionId}:model:${name}`
      : `${date}:event:${fallbackId}:model:${name}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    observations.push({ date, name });
  });
  return observations;
}

function buildSeries(observations, dates, limit, fallbackLabel) {
  const totals = new Map();
  const daily = new Map();
  const totalsFailed = new Map();
  const dailyFailed = new Map();
  for (const observation of observations) {
    const name = boundedLabel(observation.name) ?? fallbackLabel;
    increment(totals, name);
    const row = daily.get(name) ?? new Map();
    increment(row, observation.date);
    daily.set(name, row);
    if (observation.failed) {
      increment(totalsFailed, name);
      const failRow = dailyFailed.get(name) ?? new Map();
      increment(failRow, observation.date);
      dailyFailed.set(name, failRow);
    }
  }
  const ranked = [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const selected = ranked.slice(0, limit);
  const selectedNames = new Set(selected.map(([name]) => name));
  const output = selected.map(([name, total]) => ({
    name,
    total,
    daily: dates.map((date) => daily.get(name)?.get(date) ?? 0),
    totalFailed: totalsFailed.get(name) ?? 0,
    dailyFailed: dates.map((date) => dailyFailed.get(name)?.get(date) ?? 0),
  }));
  const other = ranked.filter(([name]) => !selectedNames.has(name));
  if (other.length > 0) {
    output.push({
      name: "Other",
      total: other.reduce((sum, [, count]) => sum + count, 0),
      daily: dates.map((date) => other.reduce((sum, [name]) => sum + (daily.get(name)?.get(date) ?? 0), 0)),
      totalFailed: other.reduce((sum, [name]) => sum + (totalsFailed.get(name) ?? 0), 0),
      dailyFailed: dates.map((date) => other.reduce((sum, [name]) => sum + (dailyFailed.get(name)?.get(date) ?? 0), 0)),
    });
  }
  return output;
}

export function buildDailyUsageActivity(sessions = [], durationRows = [], responses = [], events = [], options = {}) {
  const sessionById = new Map(sessions.map((session) => [session.sessionId, session]));
  const sessionRows = durationRows.map((row) => ({
    date: dateKey(row.firstSeen ?? sessionById.get(row.id)?.firstSeen),
    activeMinutes: Math.max(0, Number(row.activeMs ?? 0) / 60_000),
  })).filter((row) => row.date);
  const modelObservations = collectModelSessionObservations(responses);
  const tokenObservations = responses.map(tokenUsageObservation).filter(Boolean);
  const skillObservations = collectSkillUsageObservations(events).filter((row) => row.date);
  const mcpObservations = collectMcpUsageObservations(events);
  const observedDates = [
    ...sessionRows.map((row) => row.date),
    ...modelObservations.map((row) => row.date),
    ...tokenObservations.map((row) => row.date),
    ...skillObservations.map((row) => row.date),
    ...mcpObservations.map((row) => row.date),
  ].sort();
  if (observedDates.length === 0) return null;

  const maxDays = Math.max(1, Math.min(366, Number(options.maxDays ?? DEFAULT_MAX_DAYS)));
  const { dates, truncated } = dateRange(observedDates[0], observedDates.at(-1), maxDays);
  const dateSet = new Set(dates);
  const sessionStarts = new Map();
  const activeMinutes = new Map();
  const visibleTokenObservations = tokenObservations.filter((row) => dateSet.has(row.date));
  for (const row of sessionRows) {
    if (!dateSet.has(row.date)) continue;
    increment(sessionStarts, row.date);
    increment(activeMinutes, row.date, row.activeMinutes);
  }
  const tokenDaily = Object.fromEntries(TOKEN_FIELDS.map((field) => [
    field,
    dates.map((date) => visibleTokenObservations
      .filter((row) => row.date === date)
      .reduce((total, row) => total + row[field], 0)),
  ]));
  const tokenTotals = Object.fromEntries(TOKEN_FIELDS.map((field) => [
    field,
    tokenDaily[field].reduce((total, value) => total + value, 0),
  ]));
  return {
    schemaVersion: DAILY_USAGE_SCHEMA_VERSION,
    dateBasis: "UTC",
    measurementBasis: "session-starts-active-estimate-model-active-session-days-skill-invocations-loads-mcp-tool-calls-and-observed-token-usage",
    truncated,
    dates,
    sessions: {
      // Keep the complete analyzed population even when a provider session has
      // no usable timestamp. The date series remains the dated subset.
      total: sessions.length,
      starts: dates.map((date) => sessionStarts.get(date) ?? 0),
      activeMinutes: dates.map((date) => Number((activeMinutes.get(date) ?? 0).toFixed(1))),
    },
    models: buildSeries(modelObservations, dates, Number(options.modelLimit ?? DEFAULT_MODEL_LIMIT), "Unknown model"),
    skills: buildSeries(skillObservations, dates, Number(options.skillLimit ?? DEFAULT_SKILL_LIMIT), "Unknown Skill"),
    mcps: buildSeries(mcpObservations, dates, Number(options.mcpLimit ?? DEFAULT_MCP_LIMIT), "Unknown MCP"),
    ...(visibleTokenObservations.length > 0 ? {
      tokens: {
        observedResponseCount: visibleTokenObservations.length,
        totals: tokenTotals,
        daily: tokenDaily,
      },
    } : {}),
  };
}
