/**
 * The Studio-wide observation window.
 *
 * Every "observe" View — Sessions, Commits, Artifacts — answers the same
 * question about the same span of time, so the span is chosen once in the
 * sidebar rather than re-picked on each page. Views read the resolved window
 * and filter; none of them owns a calendar of its own.
 *
 * Days are local-calendar days. A reader asking for "today" means the day their
 * clock shows, not a UTC window that starts mid-afternoon.
 */

export type StudioDateRangePreset = "today" | "last7" | "last30" | "all" | "custom";

export interface StudioDateRange {
  preset: StudioDateRangePreset;
  /** Inclusive first local day, `YYYY-MM-DD`. Absent while the preset is `all`. */
  from?: string;
  /** Inclusive last local day, `YYYY-MM-DD`. Absent while the preset is `all`. */
  to?: string;
}

/** Presets offered in the sidebar, in the order they are shown. */
export const STUDIO_DATE_RANGE_PRESETS: readonly StudioDateRangePreset[] = [
  "today",
  "last7",
  "last30",
  "all",
  "custom",
];

/**
 * Studio opens on the last thirty days.
 *
 * The window used to default to everything, on the principle that Studio should
 * never silently withhold a reader's own history. Scanning is bounded, though,
 * so "everything" was answered with the newest page of it and the rest was
 * withheld anyway — under a label that said otherwise. A stated window is the
 * honest form of the same principle: it says what it covers, it reaches every
 * Session inside it, and widening it is one click away.
 */
export const STUDIO_DEFAULT_DATE_RANGE: StudioDateRange = { preset: "last30" };

/**
 * The window as absolute instants, for a reader that cannot see a calendar.
 *
 * Days are local, so only this side can resolve them: `from` opens at local
 * midnight and `to` closes at the last instant of its own local day.
 */
export function dateRangeBounds(range: StudioDateRange, now?: Date): { fromMs?: number; toMs?: number } {
  const window = resolveDateRange(range, now);
  if (window.preset === "all") return {};
  const dayStart = (key: string): number | undefined => {
    const [year, month, day] = key.split("-").map(Number);
    if (year === undefined || month === undefined || day === undefined) return undefined;
    const at = new Date(year, month - 1, day);
    return Number.isNaN(at.getTime()) ? undefined : at.getTime();
  };
  const fromMs = window.from === undefined ? undefined : dayStart(window.from);
  const toStart = window.to === undefined ? undefined : dayStart(window.to);
  return {
    ...(fromMs === undefined ? {} : { fromMs }),
    ...(toStart === undefined ? {} : { toMs: toStart + 86_400_000 - 1 }),
  };
}

/**
 * Is everything the requested window asks for already loaded?
 *
 * Narrowing is free — the reader is asking for a subset of rows already in
 * hand. Widening is not: rows outside the loaded window were never scanned, so
 * the answer has to be fetched rather than filtered.
 */
export function windowCovers(
  loaded: { fromMs?: number; toMs?: number } | undefined,
  requested: { fromMs?: number; toMs?: number },
): boolean {
  if (loaded === undefined) return true;
  if (loaded.fromMs !== undefined && (requested.fromMs === undefined || requested.fromMs < loaded.fromMs)) return false;
  if (loaded.toMs !== undefined && (requested.toMs === undefined || requested.toMs > loaded.toMs)) return false;
  return true;
}

/**
 * Is this exactly the window that was loaded?
 *
 * A shortfall counted for one window says nothing about a narrower one. After
 * narrowing, the rows on screen are a filtered subset of what was already
 * scanned, so the loaded window's count no longer describes what the reader
 * selected and must not be shown against it.
 */
export function windowMatches(
  loaded: { fromMs?: number; toMs?: number } | undefined,
  requested: { fromMs?: number; toMs?: number },
): boolean {
  return (loaded?.fromMs ?? undefined) === (requested.fromMs ?? undefined)
    && (loaded?.toMs ?? undefined) === (requested.toMs ?? undefined);
}

/** `YYYY-MM-DD` for a local calendar day, without a UTC round trip. */
export function localDayKey(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDays(from: Date, days: number): Date {
  const shifted = new Date(from);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

/**
 * Resolve a preset into concrete local days.
 *
 * `custom` keeps whatever the reader typed; a half-filled custom range is left
 * half-filled so the open end stays open rather than silently snapping to today.
 */
export function resolveDateRange(range: StudioDateRange, now: Date = new Date()): StudioDateRange {
  const today = localDayKey(now);
  switch (range.preset) {
    case "today":
      return { preset: "today", from: today, to: today };
    case "last7":
      return { preset: "last7", from: localDayKey(shiftDays(now, -6)), to: today };
    case "last30":
      return { preset: "last30", from: localDayKey(shiftDays(now, -29)), to: today };
    case "all":
      return { preset: "all" };
    case "custom":
      return {
        preset: "custom",
        ...(range.from === undefined ? {} : { from: range.from }),
        ...(range.to === undefined ? {} : { to: range.to }),
      };
  }
}

/**
 * Does a timestamp fall inside the window?
 *
 * An unparseable or absent timestamp is kept rather than dropped: hiding a row
 * because its date could not be read would present a filter as a deletion.
 */
/**
 * The time a row should be judged by. Last activity wins, so a Session that
 * started last year and moved today still belongs to "today".
 */
export function activityTimestamp(...candidates: Array<string | null | undefined>): string | undefined {
  for (const value of candidates) {
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

export function withinDateRange(timestamp: string | undefined, range: StudioDateRange, now?: Date): boolean {
  // Resolve first: callers hold the preset form (`{ preset: "today" }`), whose
  // ends are implied rather than written down. Reading `from`/`to` off it
  // directly would silently match everything.
  const window = resolveDateRange(range, now);
  if (window.preset === "all") return true;
  if (window.from === undefined && window.to === undefined) return true;
  if (timestamp === undefined) return true;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return true;
  const day = localDayKey(parsed);
  if (window.from !== undefined && day < window.from) return false;
  if (window.to !== undefined && day > window.to) return false;
  return true;
}

/** A custom range with its ends crossed reads as a typo, not as an empty result. */
export function dateRangeInverted(range: StudioDateRange): boolean {
  return range.from !== undefined && range.to !== undefined && range.from > range.to;
}

/**
 * Keep a catalog row when it was observed inside the window.
 *
 * Workspace artifacts are dated only through Session observations. A file with
 * no in-range observation is out of the window. Rows that were never dated at
 * all stay visible: the window must not delete a file whose time could not be
 * read.
 */
export function artifactsInDateRange<T extends { id: string }>(
  artifacts: readonly T[],
  observations: ReadonlyArray<{ artifactId: string; savedAt: string }> | undefined,
  range: StudioDateRange,
  now?: Date,
): T[] {
  if (observations === undefined || observations.length === 0) return [...artifacts];
  const datedIds = new Set(observations.map((observation) => observation.artifactId));
  const visibleIds = new Set(
    observations
      .filter((observation) => withinDateRange(observation.savedAt, range, now))
      .map((observation) => observation.artifactId),
  );
  return artifacts.filter((artifact) => !datedIds.has(artifact.id) || visibleIds.has(artifact.id));
}
