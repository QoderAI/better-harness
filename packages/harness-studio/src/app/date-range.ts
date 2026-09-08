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
 * Studio opens on everything it retained.
 *
 * A narrower default would hide a reader's own history behind a control they
 * had not touched yet, which is the opposite of what this window is for: it
 * narrows on request, it never silently withholds.
 */
export const STUDIO_DEFAULT_DATE_RANGE: StudioDateRange = { preset: "all" };

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
