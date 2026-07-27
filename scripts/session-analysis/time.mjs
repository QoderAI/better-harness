const TIMESTAMP_CACHE_LIMIT = 50_000;
const timestampCache = new Map();
const QODER_SEGMENT_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})([+-]\d{2})-(\d{2})/;

export function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return parseTimestamp(value).normalized;
}

export function timestampMillis(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return parseTimestamp(value).millis;
}

export function mergeTimeRange(target, timestamp) {
  const normalized = normalizeTimestamp(timestamp);
  if (!normalized) {
    return;
  }
  if (!target.firstSeen || timestampMillis(normalized) < timestampMillis(target.firstSeen)) {
    target.firstSeen = normalized;
  }
  if (!target.lastSeen || timestampMillis(normalized) > timestampMillis(target.lastSeen)) {
    target.lastSeen = normalized;
  }
}

export function withinTimeRange(timestamp, scope) {
  const time = timestampMillis(timestamp);
  if (time === null) {
    return true;
  }
  if (scope.sinceTime !== null && time < scope.sinceTime) {
    return false;
  }
  if (scope.untilTime !== null && time > scope.untilTime) {
    return false;
  }
  return true;
}

export function normalizeCliDate(value, endOfDay = false) {
  if (!value) {
    return { label: null, time: null };
  }
  const hasTime = /T|\d:\d/.test(value);
  const normalized = !hasTime && endOfDay ? `${value}T23:59:59.999` : value;
  const time = timestampMillis(normalized);
  if (time === null) {
    throw new Error(`Invalid date: ${value}`);
  }
  return { label: value, time };
}

function parseTimestamp(value) {
  if (typeof value === "number") {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    if (!Number.isFinite(millis)) {
      return { normalized: null, millis: null };
    }
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) {
      return { normalized: null, millis: null };
    }
    return {
      normalized: date.toISOString(),
      millis,
    };
  }

  const text = String(value);
  const cached = timestampCache.get(text);
  if (cached) {
    return cached;
  }

  const repaired = text.replace(QODER_SEGMENT_TIMESTAMP_RE, "$1T$2:$3:$4.$5$6:$7");
  const millis = Date.parse(repaired);
  const parsed = Number.isNaN(millis)
    ? { normalized: text, millis: null }
    : { normalized: new Date(millis).toISOString(), millis };
  rememberTimestamp(text, parsed);
  return parsed;
}

function rememberTimestamp(key, value) {
  if (timestampCache.size >= TIMESTAMP_CACHE_LIMIT) {
    timestampCache.clear();
  }
  timestampCache.set(key, value);
}
