import { describe, expect, it } from "vitest";
import {
  STUDIO_DEFAULT_DATE_RANGE,
  dateRangeInverted,
  localDayKey,
  resolveDateRange,
  withinDateRange,
} from "../src/app/date-range.js";

/** A fixed local noon, so a day shift never lands on a DST boundary. */
const NOW = new Date(2026, 8, 8, 12, 0, 0);

describe("studio date range", () => {
  it("opens on everything, so a fresh launch never hides retained history", () => {
    expect(STUDIO_DEFAULT_DATE_RANGE.preset).toBe("all");
    expect(withinDateRange("2019-01-01T00:00:00.000Z", STUDIO_DEFAULT_DATE_RANGE)).toBe(true);
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
    const range = resolveDateRange({ preset: "last7" }, NOW);
    expect(withinDateRange("2026-09-02T00:00:01", range)).toBe(true);
    expect(withinDateRange("2026-09-08T23:59:59", range)).toBe(true);
    expect(withinDateRange("2026-09-01T23:59:59", range)).toBe(false);
    expect(withinDateRange("2026-09-09T00:00:00", range)).toBe(false);
  });

  it("keeps a row whose timestamp cannot be read rather than dropping it", () => {
    // Filtering is a narrowing, not a deletion: an unreadable date must not make
    // a row disappear with no way for the reader to find it again.
    const range = resolveDateRange({ preset: "today" }, NOW);
    expect(withinDateRange(undefined, range)).toBe(true);
    expect(withinDateRange("not-a-date", range)).toBe(true);
  });

  it("uses the local calendar day rather than a UTC one", () => {
    // 23:30 local on the 8th is the 9th in UTC; "today" must still hold it.
    const lateLocal = new Date(2026, 8, 8, 23, 30, 0);
    expect(localDayKey(lateLocal)).toBe("2026-09-08");
    expect(withinDateRange(lateLocal.toISOString(), resolveDateRange({ preset: "today" }, NOW))).toBe(true);
  });

  it("reports a crossed custom range instead of silently returning nothing", () => {
    expect(dateRangeInverted({ preset: "custom", from: "2026-09-09", to: "2026-09-01" })).toBe(true);
    expect(dateRangeInverted({ preset: "custom", from: "2026-09-01", to: "2026-09-09" })).toBe(false);
    expect(dateRangeInverted({ preset: "all" })).toBe(false);
  });
});
