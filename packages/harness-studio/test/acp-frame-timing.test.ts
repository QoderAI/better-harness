import { describe, expect, it } from "vitest";

import {
  acpFrameTimings,
  acpObservationSpan,
  formatObservedClock,
  formatObservedElapsed,
} from "../src/app/run/acp-frame-timing.js";

/** Frames as the pane sees them: an observation clock reading and nothing else. */
const at = (...readings: number[]): { observedAt: number }[] => readings.map((observedAt) => ({ observedAt }));

describe("acpFrameTimings", () => {
  it("leaves the first frame without an elapsed time rather than reporting zero", () => {
    expect(acpFrameTimings(at(1_000))).toEqual([{ observedAt: 1_000 }]);
  });

  it("reports the gap to the immediately preceding frame for every later frame", () => {
    expect(acpFrameTimings(at(1_000, 1_320, 4_320))).toEqual([
      { observedAt: 1_000 },
      { observedAt: 1_320, sincePreviousMs: 320 },
      { observedAt: 4_320, sincePreviousMs: 3_000 },
    ]);
  });

  it("keeps a delta for a frame whose predecessor falls outside the rendered tail", () => {
    const timings = acpFrameTimings(at(0, 100, 250, 450));
    // A pane rendering only the last two frames indexes into the full result.
    expect(timings.slice(-2)).toEqual([
      { observedAt: 250, sincePreviousMs: 150 },
      { observedAt: 450, sincePreviousMs: 200 },
    ]);
  });

  it("clamps a backwards clock reading to zero instead of a negative gap", () => {
    expect(acpFrameTimings(at(5_000, 4_900))[1]?.sincePreviousMs).toBe(0);
  });

  it("returns nothing for an unobserved stream", () => {
    expect(acpFrameTimings([])).toEqual([]);
  });
});

describe("acpObservationSpan", () => {
  it("is undefined until a frame has been observed", () => {
    expect(acpObservationSpan([])).toBeUndefined();
  });

  it("spans a single frame as a zero-length window at that reading", () => {
    expect(acpObservationSpan(at(2_500))).toEqual({ firstAt: 2_500, lastAt: 2_500, totalMs: 0 });
  });

  it("spans first to latest across every retained frame", () => {
    expect(acpObservationSpan(at(1_000, 1_320, 18_200))).toEqual({ firstAt: 1_000, lastAt: 18_200, totalMs: 17_200 });
  });
});

describe("formatObservedElapsed", () => {
  it("steps from milliseconds to seconds at one second", () => {
    expect(formatObservedElapsed(999)).toBe("999 ms");
    expect(formatObservedElapsed(1_000)).toBe("1.0 s");
  });

  it("drops the fraction once a reading passes ten seconds", () => {
    expect(formatObservedElapsed(9_940)).toBe("9.9 s");
    expect(formatObservedElapsed(10_400)).toBe("10 s");
  });

  it("steps to minutes and seconds at one minute", () => {
    expect(formatObservedElapsed(59_500)).toBe("60 s");
    expect(formatObservedElapsed(64_000)).toBe("1m 4s");
  });

  it("reads a negative interval as zero", () => {
    expect(formatObservedElapsed(-5)).toBe("0 ms");
  });
});

describe("formatObservedClock", () => {
  it("reads as a zero-padded 24-hour wall clock", () => {
    const observedAt = new Date(2026, 8, 8, 3, 14, 21).getTime();
    expect(formatObservedClock(observedAt, "en-US")).toBe("03:14:21");
  });
});
