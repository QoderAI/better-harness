import { describe, expect, it } from "vitest";
import {
  applyLaneEvent,
  deriveComparability,
  deriveTreatmentSummary,
  relationCounts,
  resourceLedger,
  roleFor,
} from "../src/app/experiment-comparison-model.js";
import type { ExperimentPreview, LaneDefinition, LaneTrace } from "../src/app/experiment-view-types.js";

const freshDefault: LaneDefinition = {
  id: "fresh-default",
  origin: "execute",
  harnessId: "checkpoint-agent",
  trials: 1,
  runtime: { profile: "default", model: "qoder" },
};
const freshMinimal: LaneDefinition = {
  id: "fresh-minimal",
  origin: "execute",
  harnessId: "checkpoint-agent",
  trials: 1,
  runtime: { profile: "minimal", model: "qoder" },
};
const reference: LaneDefinition = { id: "history", origin: "observed" };

function preview(): ExperimentPreview {
  return {
    manifest: { lanes: [reference, freshDefault, freshMinimal], contrasts: [], task: { prompt: "task" } },
    checkpoint: { digest: "sha256:test", plan: "checkpoint.json" },
    contrasts: [{
      id: "profile",
      lanes: [freshDefault.id, freshMinimal.id],
      attribution: { mode: "attributable", axis: "runtime-profile", detail: "profile differs" },
    }],
    setup: {} as ExperimentPreview["setup"],
    observedCalls: {},
  };
}

function trace(status: LaneTrace["status"] = "idle"): LaneTrace {
  return { status, calls: [], eventCount: 0 };
}

describe("experiment comparison model", () => {
  it("shows the moved profile rather than equal harness ids", () => {
    expect(deriveTreatmentSummary(preview())).toEqual({
      label: "Profile",
      value: "default vs minimal",
      detail: "profile differs",
      controlled: true,
    });
  });

  it("keeps the recorded run a Reference across focused pair changes", () => {
    expect(roleFor(reference, freshDefault.id, freshMinimal.id)).toBe("Reference");
    expect(roleFor(freshDefault, freshDefault.id, freshMinimal.id)).toBe("Baseline");
    expect(roleFor(freshMinimal, freshDefault.id, freshMinimal.id)).toBe("Candidate");
  });

  it("derives the evidence-floor limitation from the same projected contrast", () => {
    expect(deriveComparability(preview(), freshDefault, freshMinimal, trace(), trace())).toEqual({
      level: "Partial",
      detail: "One trial per run can inspect traces but cannot satisfy the evidence floor.",
      axis: "runtime-profile",
    });
  });

  it("folds only canonical stream events in the browser model", () => {
    const started = applyLaneEvent(trace("running"), {
      type: "lane-event",
      experimentId: "exp_1",
      laneId: "fresh-default",
      runId: "run-1",
      event: { type: "tool-call-started", toolCallId: "call-1", toolName: "Read", input: { path: "src/a.ts" } },
    });
    const finished = applyLaneEvent(started, {
      type: "lane-event",
      experimentId: "exp_1",
      laneId: "fresh-default",
      runId: "run-1",
      event: { type: "tool-call-result", toolCallId: "call-1" },
    });
    expect(finished.calls).toEqual([expect.objectContaining({ name: "Read", status: "completed" })]);
  });

  it("settles unfinished calls only for the run that finished", () => {
    const started = ["run-1", "run-2"].reduce((lane, runId) => applyLaneEvent(lane, {
      type: "lane-event",
      experimentId: "exp_1",
      laneId: "fresh-default",
      runId,
      event: { type: "tool-call-started", toolCallId: "call-1", toolName: "Read" },
    }), trace("running"));
    const finished = applyLaneEvent(started, {
      type: "lane-event",
      experimentId: "exp_1",
      laneId: "fresh-default",
      runId: "run-1",
      event: { type: "run-finished" },
    });
    expect(finished.calls.map((call) => [call.runId, call.status])).toEqual([
      ["run-1", "result-unavailable"],
      ["run-2", "running"],
    ]);
  });

  it("derives relation and resource summaries from normalized calls", () => {
    const left = [{ laneId: "left", runId: "1", id: "1", sequence: 0, name: "Read", input: { path: "src/a.ts" }, status: "completed" as const }];
    const right = [{ laneId: "right", runId: "2", id: "2", sequence: 0, name: "Read", input: { path: "src/a.ts" }, status: "completed" as const }];
    expect(relationCounts(left, right).exact).toBe(1);
    expect([...resourceLedger(left).keys()]).toEqual(["src/a.ts"]);
  });
});
