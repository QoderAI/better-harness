import { describe, expect, it } from "vitest";
import { planElementState, toolElementState } from "../src/app/run/ai-elements-adapter.js";

describe("ACP display states", () => {
  it.each([
    ["preparing", "input-streaming"], ["running", "input-available"],
    ["completed", "output-available"], ["failed", "output-error"],
    ["result-unavailable", "output-unavailable"], ["interrupted", "interrupted"],
  ] as const)("preserves %s evidence as %s", (status, expected) => {
    expect(toolElementState(status)).toBe(expected);
  });
  it("projects observed plan progress without treating pending work as complete", () => {
    expect(["pending", "in_progress", "completed"].map(status => planElementState(status as "pending" | "in_progress" | "completed"))).toEqual(["pending", "active", "complete"]);
  });
});
