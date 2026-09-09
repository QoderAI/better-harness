import { collectMcpUsageObservations, collectSkillUsageObservations } from "./daily-usage.mjs";
import { timestampMillis } from "./time.mjs";

export const CUSTOMIZATION_USAGE_SCHEMA_VERSION = 1;

/** Bounds one Project's aggregate so a large history cannot grow the payload without limit. */
const MAX_ENTRIES = 400;

/**
 * The matching vocabulary between an observed invocation and a catalog definition.
 *
 * A Host names an invocation the way its own runtime does: Codex reports a Skill
 * from a plugin as `better-harness:ui-ux-pro-max`, while the catalog knows it by
 * the name in its `SKILL.md`. The distinguishing part is the last segment, so
 * matching normalizes to it rather than asking either side to change. This is a
 * deliberate name match and nothing more: it associates an observation with a
 * definition, it does not create a catalog edge, and callers must present it as
 * an observation.
 */
export function normalizeCustomizationUsageName(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "") return null;
  const segment = text.split(/[:/\\]/u).filter(Boolean).at(-1);
  return segment === undefined || segment === "" ? null : segment;
}

function observationDate(value) {
  const millis = timestampMillis(value);
  return millis === null ? null : new Date(millis).toISOString();
}

function record(map, kind, name, date) {
  const key = normalizeCustomizationUsageName(name);
  if (key === null) return;
  const identity = `${kind}\u0000${key}`;
  const current = map.get(identity) ?? { kind, name: key, count: 0, lastObservedAt: null };
  current.count += 1;
  if (date !== null && (current.lastObservedAt === null || date > current.lastObservedAt)) {
    current.lastObservedAt = date;
  }
  map.set(identity, current);
}

/**
 * One Session's invocation counts, read from the events the Session summary
 * already normalized. Both dimensions reuse the existing observation rules, so a
 * Host that gains Skill detection gains it here without a second implementation.
 */
export function collectSessionCustomizationUsage(events = []) {
  const entries = new Map();
  for (const observation of collectSkillUsageObservations(events)) {
    record(entries, "skill", observation.name, observation.date === null ? null : `${observation.date}T00:00:00.000Z`);
  }
  for (const observation of collectMcpUsageObservations(events)) {
    record(entries, "mcp-server", observation.name, observation.date === null ? null : `${observation.date}T00:00:00.000Z`);
  }
  if (entries.size === 0) return null;
  return { entries: [...entries.values()].sort(compareEntries) };
}

function compareEntries(left, right) {
  return right.count - left.count
    || left.kind.localeCompare(right.kind)
    || left.name.localeCompare(right.name);
}

/**
 * The Project-wide aggregate. A count is attributed to the Host whose Session
 * produced it, because "this Skill ran under Codex" and "this Skill ran under
 * Qoder" are different facts and a reader filtering by Agent is asking for one of
 * them. Sessions without a usage record still count towards the observed window,
 * so an empty aggregate stays distinguishable from an unread history.
 */
export function aggregateCustomizationUsage(sessions = []) {
  const entries = new Map();
  let observedSessions = 0;
  let from = null;
  let to = null;
  for (const session of sessions) {
    const hostId = String(session?.hostId ?? session?.platform ?? "").trim();
    if (hostId === "") continue;
    observedSessions += 1;
    for (const bound of [observationDate(session?.firstSeen), observationDate(session?.lastSeen)]) {
      if (bound === null) continue;
      if (from === null || bound < from) from = bound;
      if (to === null || bound > to) to = bound;
    }
    for (const entry of session?.customizationUsage?.entries ?? []) {
      const key = normalizeCustomizationUsageName(entry?.name);
      if (key === null || (entry?.kind !== "skill" && entry?.kind !== "mcp-server")) continue;
      const identity = `${hostId}\u0000${entry.kind}\u0000${key}`;
      const current = entries.get(identity) ?? { kind: entry.kind, hostId, name: key, count: 0, lastObservedAt: null };
      current.count += Number.isFinite(entry.count) && entry.count > 0 ? Math.round(entry.count) : 0;
      const observed = observationDate(entry.lastObservedAt);
      if (observed !== null && (current.lastObservedAt === null || observed > current.lastObservedAt)) {
        current.lastObservedAt = observed;
      }
      entries.set(identity, current);
    }
  }
  return {
    kind: "BetterHarnessCustomizationUsageV1",
    schemaVersion: CUSTOMIZATION_USAGE_SCHEMA_VERSION,
    observedSessions,
    window: { from, to },
    entries: [...entries.values()]
      .filter((entry) => entry.count > 0)
      .sort((left, right) => compareEntries(left, right) || left.hostId.localeCompare(right.hostId))
      .slice(0, MAX_ENTRIES)
      .map((entry) => ({
        kind: entry.kind,
        hostId: entry.hostId,
        name: entry.name,
        count: entry.count,
        ...(entry.lastObservedAt === null ? {} : { lastObservedAt: entry.lastObservedAt }),
      })),
  };
}
