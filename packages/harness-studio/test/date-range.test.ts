import { describe, expect, it } from "vitest";
import {
  STUDIO_DEFAULT_DATE_RANGE,
  activityTimestamp,
  artifactsInDateRange,
  dateRangeBounds,
  dateRangeInverted,
  localDayKey,
  resolveDateRange,
  windowCovers,
  windowMatches,
  withinDateRange,
} from "../src/app/date-range.js";

/** A fixed local noon, so a day shift never lands on a DST boundary. */
const NOW = new Date(2026, 8, 8, 12, 0, 0);

/**
 * Stamps built from the local clock rather than written as `...Z` literals: a
 * fixed UTC instant lands on a different local day depending on the host offset,
 * which would make these cases pass in UTC CI and fail west of it.
 */
const ON_NOW_DAY = new Date(2026, 8, 8, 3, 22, 0).toISOString();
const MONTHS_EARLIER = new Date(2026, 6, 1, 0, 0, 0).toISOString();

describe("studio date range", () => {
  // Discovery is bounded, so "everything" could only ever be answered with the
  // newest page of everything. A stated window is the honest form: it says what
  // it covers and reaches every Session inside it.
  it("opens on a window it can answer completely, and says which one", () => {
    expect(STUDIO_DEFAULT_DATE_RANGE.preset).toBe("last30");
    expect(withinDateRange(ON_NOW_DAY, STUDIO_DEFAULT_DATE_RANGE, NOW)).toBe(true);
    expect(withinDateRange("2019-01-01T00:00:00.000Z", STUDIO_DEFAULT_DATE_RANGE, NOW)).toBe(false);
    expect(withinDateRange("2019-01-01T00:00:00.000Z", { preset: "all" })).toBe(true);
  });

  it("resolves local days into instants a server can compare without a timezone", () => {
    const bounds = dateRangeBounds({ preset: "last30" }, NOW);
    expect(new Date(bounds.fromMs!)).toEqual(new Date(2026, 7, 10, 0, 0, 0, 0));
    expect(new Date(bounds.toMs!)).toEqual(new Date(2026, 8, 8, 23, 59, 59, 999));
    expect(dateRangeBounds({ preset: "all" })).toEqual({});
  });

  // Narrowing is a filter over rows already in hand; widening asks about
  // Sessions that were never scanned and has to reach the server again.
  // A shortfall counted for one window says nothing about a narrower one.
  it("only recognizes the window a scan actually answered", () => {
    const loaded = dateRangeBounds({ preset: "last7" }, NOW);
    expect(windowMatches(loaded, dateRangeBounds({ preset: "last7" }, NOW))).toBe(true);
    expect(windowMatches(loaded, dateRangeBounds({ preset: "today" }, NOW))).toBe(false);
    expect(windowMatches(undefined, dateRangeBounds({ preset: "all" }))).toBe(true);
    expect(windowMatches(undefined, dateRangeBounds({ preset: "last7" }, NOW))).toBe(false);
  });

  it("knows when a window can be answered from what is already loaded", () => {
    const loaded = dateRangeBounds({ preset: "last30" }, NOW);
    expect(windowCovers(loaded, dateRangeBounds({ preset: "today" }, NOW))).toBe(true);
    expect(windowCovers(loaded, dateRangeBounds({ preset: "last7" }, NOW))).toBe(true);
    expect(windowCovers(loaded, dateRangeBounds({ preset: "all" }))).toBe(false);
    expect(windowCovers(undefined, dateRangeBounds({ preset: "all" }))).toBe(true);
  });

  it("resolves each preset to inclusive local days", () => {
    expect(resolveDateRange({ preset: "today" }, NOW)).toEqual({
      preset: "today", from: "2026-09-08", to: "2026-09-08",
    });
    // Seven days means today plus the six before it, not today minus seven.
    expect(resolveDateRange({ preset: "last7" }, NOW)).toEqual({
      preset: "last7", from: "2026-09-02", to: "2026-09-08",
    });
    expect(resolveDateRange({ preset: "last30" }, NOW)).toEqual({
      preset: "last30", from: "2026-08-10", to: "2026-09-08",
    });
    expect(resolveDateRange({ preset: "all" }, NOW)).toEqual({ preset: "all" });
  });

  it("keeps a half-filled custom range open at the end the reader left open", () => {
    expect(resolveDateRange({ preset: "custom", from: "2026-01-01" }, NOW))
      .toEqual({ preset: "custom", from: "2026-01-01" });
    expect(withinDateRange("2026-06-01T00:00:00", { preset: "custom", from: "2026-01-01" })).toBe(true);
    expect(withinDateRange("2025-06-01T00:00:00", { preset: "custom", from: "2026-01-01" })).toBe(false);
  });

  it("includes both ends of the window", () => {
    // A preset window is relative, so `now` has to be pinned on every call:
    // `withinDateRange` re-resolves the preset and would otherwise re-derive the
    // ends from the wall clock and drift out from under the fixtures.
    const range = resolveDateRange({ preset: "last7" }, NOW);
    expect(withinDateRange("2026-09-02T00:00:01", range, NOW)).toBe(true);
    expect(withinDateRange("2026-09-08T23:59:59", range, NOW)).toBe(true);
    expect(withinDateRange("2026-09-01T23:59:59", range, NOW)).toBe(false);
    expect(withinDateRange("2026-09-09T00:00:00", range, NOW)).toBe(false);
  });

  it("keeps a row whose timestamp cannot be read rather than dropping it", () => {
    // Filtering is a narrowing, not a deletion: an unreadable date must not make
    // a row disappear with no way for the reader to find it again.
    const range = resolveDateRange({ preset: "today" }, NOW);
    expect(withinDateRange(undefined, range, NOW)).toBe(true);
    expect(withinDateRange("not-a-date", range, NOW)).toBe(true);
  });

  it("uses the local calendar day rather than a UTC one", () => {
    // 23:30 local on the 8th is the 9th in UTC; "today" must still hold it.
    const lateLocal = new Date(2026, 8, 8, 23, 30, 0);
    expect(localDayKey(lateLocal)).toBe("2026-09-08");
    expect(withinDateRange(lateLocal.toISOString(), resolveDateRange({ preset: "today" }, NOW), NOW)).toBe(true);
  });

  it("judges a Session by last activity rather than when it started", () => {
    expect(activityTimestamp(ON_NOW_DAY, MONTHS_EARLIER)).toBe(ON_NOW_DAY);
    const today = resolveDateRange({ preset: "today" }, NOW);
    expect(withinDateRange(activityTimestamp(ON_NOW_DAY, MONTHS_EARLIER), today, NOW)).toBe(true);
    expect(withinDateRange(MONTHS_EARLIER, today, NOW)).toBe(false);
  });

  it("hides Artifacts whose observations fall outside the window", () => {
    const artifacts = [{ id: "recent" }, { id: "old" }, { id: "undated" }];
    const observations = [
      { artifactId: "recent", savedAt: ON_NOW_DAY },
      { artifactId: "old", savedAt: MONTHS_EARLIER },
    ];
    const visible = artifactsInDateRange(artifacts, observations, { preset: "today" }, NOW);
    expect(visible.map((artifact) => artifact.id)).toEqual(["recent", "undated"]);
  });

  it("reports a crossed custom range instead of silently returning nothing", () => {
    expect(dateRangeInverted({ preset: "custom", from: "2026-09-09", to: "2026-09-01" })).toBe(true);
    expect(dateRangeInverted({ preset: "custom", from: "2026-09-01", to: "2026-09-09" })).toBe(false);
    expect(dateRangeInverted({ preset: "all" })).toBe(false);
  });
});
