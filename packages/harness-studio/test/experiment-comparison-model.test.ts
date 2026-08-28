import { describe, expect, it } from "vitest";
import {
  applyLaneEvent,
  deriveComparability,
  deriveSimpleComparisonScope,
  deriveSimpleResultFacts,
  deriveTreatmentSummary,
  globalStreamFailure,
  relationCounts,
  resourceComparisonRows,
  resourceLedger,
  roleFor,
} from "../src/app/experiment/experiment-comparison-model.js";
import type { ExperimentPreview, LaneDefinition, LaneTrace } from "../src/app/experiment/experiment-view-types.js";

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
  return {
    status,
    calls: [],
    eventCount: 0,
    protocolFrameCount: 0,
    acpSessionIds: [],
    pendingPermissions: [],
    activities: [],
  };
}

describe("experiment comparison model", () => {
  it("describes the configured comparison scope without overstating evidence", () => {
    const baseline = { ...freshDefault, runtime: { profile: "acp-v1-stdio", model: "gpt-5.4" } };
    const candidate = { ...freshMinimal, runtime: { profile: "acp-v1-stdio", model: "gpt-5.5" } };
    const qoder = { id: "qodercli", label: "Qoder CLI", modelPolicy: "agent-default" as const };
    const codex = { id: "codex-acp", label: "Codex ACP", modelPolicy: "lane" as const };

    expect(deriveSimpleComparisonScope(baseline, candidate, qoder, qoder)).toMatchObject({
      kind: "repeatability",
      axes: [],
      title: "Repeatability comparison",
    });
    expect(deriveSimpleComparisonScope(baseline, candidate, codex, codex)).toMatchObject({
      kind: "single-variable",
      axes: ["model"],
      title: "Configured difference: model",
    });
    expect(deriveSimpleComparisonScope(baseline, candidate, qoder, codex)).toMatchObject({
      kind: "descriptive",
      axes: ["agent", "model-policy", "model"],
      title: "Descriptive comparison: Agent + model policy + model",
    });
  });

  it("summarizes only retained resource, edit, verification, and lane facts", () => {
    const baseline = trace("finished");
    baseline.calls = [
      { laneId: "left", runId: "left:1", id: "left-read", sequence: 0, name: "Read", input: { path: "README.md" }, status: "completed" },
      { laneId: "left", runId: "left:1", id: "left-edit", sequence: 1, name: "Edit", input: { path: "README.md" }, status: "completed" },
    ];
    const candidate = trace("failed");
    candidate.calls = [
      { laneId: "right", runId: "right:1", id: "right-read", sequence: 0, name: "Read", input: { path: "README.md" }, status: "completed" },
      { laneId: "right", runId: "right:1", id: "right-search", sequence: 1, name: "Search", input: { pattern: "AGENTS.md" }, status: "completed" },
      { laneId: "right", runId: "right:1", id: "right-verify", sequence: 2, name: "Bash", input: { command: "npm test" }, status: "failed" },
    ];

    expect(deriveSimpleResultFacts(baseline, candidate)).toEqual({
      sharedResources: 1,
      baselineOnlyResources: 0,
      candidateOnlyResources: 2,
      baseline: { status: "finished", resources: 1, editedResources: ["README.md"], verificationCalls: 0 },
      candidate: { status: "failed", resources: 3, editedResources: [], verificationCalls: 1 },
    });
  });

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

  it("keeps selected Agent identity as an explicit treatment axis", () => {
    expect(deriveComparability(
      preview(),
      { ...freshDefault, trials: 2 },
      { ...freshMinimal, trials: 2 },
      trace("finished"),
      trace("finished"),
      { "fresh-default": "qodercli", "fresh-minimal": "codex-acp" },
    )).toEqual({
      level: "Partial",
      detail: "Agent identity and the manifest treatment both changed; this pair does not isolate one cause.",
      axis: "runtime-profile+agent",
    });

    const agentOnly = preview();
    agentOnly.contrasts[0]!.attribution = { mode: "descriptive", detail: "configured identically" };
    expect(deriveComparability(
      agentOnly,
      { ...freshDefault, trials: 2 },
      { ...freshMinimal, trials: 2 },
      trace("finished"),
      trace("finished"),
      { "fresh-default": "qodercli", "fresh-minimal": "codex-acp" },
    )).toEqual({
      level: "Controlled",
      detail: "The fresh runs share a checkpoint and isolate Agent identity.",
      axis: "agent",
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

  it("shows a failed trial result as failed instead of transport-finished", () => {
    expect(applyLaneEvent(trace("running"), {
      type: "lane-finished",
      experimentId: "exp_1",
      laneId: "fresh-default",
      runId: "run-1",
      result: { classification: "failed", executorError: "invalid model" },
    })).toMatchObject({ status: "failed", detail: "invalid model" });
  });

  it("preserves assistant messages and tool starts in lane activity order", () => {
    const events = [
      { type: "assistant-message-started", messageId: "message-1" },
      { type: "assistant-text-delta", messageId: "message-1", text: "Inspecting " },
      { type: "assistant-text-delta", messageId: "message-1", text: "the project." },
      { type: "assistant-message-finished", messageId: "message-1" },
      { type: "tool-call-started", toolCallId: "read-1", toolName: "Read" },
    ] as const;
    const lane = events.reduce((current, event) => applyLaneEvent(current, {
      type: "lane-event",
      experimentId: "exp_1",
      laneId: "fresh-default",
      runId: "run-1",
      event,
    }), trace("running"));

    expect(lane.activities).toEqual([
      { kind: "assistant", id: "run-1:message-1", text: "Inspecting the project.", complete: true },
      { kind: "tool", id: "tool:run-1:read-1", runId: "run-1", toolCallId: "read-1" },
    ]);
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

  it("retains ACP session identity and pending permission state outside the tool-call fold", () => {
    const lane = applyLaneEvent(trace("running"), {
      type: "lane-event",
      experimentId: "exp_1",
      laneId: "fresh-default",
      runId: "exp_1:fresh-default:1",
      event: {
        type: "permission-requested",
        protocol: "acp",
        requestId: "permission-1",
        toolCallId: "tool-1",
        title: "Inspect workspace",
        sessionId: "session-1",
        options: [{ optionId: "allow", name: "Allow" }],
      },
    });

    expect(lane.calls).toEqual([]);
    expect(lane.protocolFrameCount).toBe(1);
    expect(lane.acpSessionIds).toEqual(["session-1"]);
    expect(lane.pendingPermissions).toEqual([
      expect.objectContaining({ runId: "exp_1:fresh-default:1", requestId: "permission-1" }),
    ]);
    expect(applyLaneEvent(lane, {
      type: "lane-finished",
      experimentId: "exp_1",
      laneId: "fresh-default",
      runId: "exp_1:fresh-default:1",
    }).pendingPermissions).toEqual([]);
  });

  it("surfaces experiment-wide stream failures before a lane starts", () => {
    expect(globalStreamFailure({
      type: "lane-failed",
      experimentId: "exp_1",
      laneId: null,
      runId: null,
      detail: "Checkpoint digest mismatch.",
    })).toEqual({ status: "failed", detail: "Checkpoint digest mismatch." });
    expect(globalStreamFailure({
      type: "experiment-finished",
      experimentId: "exp_1",
      laneId: null,
      runId: null,
    })).toBeUndefined();
  });

  it("derives relation and resource summaries from normalized calls", () => {
    const left = [{ laneId: "left", runId: "1", id: "1", sequence: 0, name: "Read", input: { path: "src/a.ts" }, status: "completed" as const }];
    const right = [{ laneId: "right", runId: "2", id: "2", sequence: 0, name: "Read", input: { path: "src/a.ts" }, status: "completed" as const }];
    expect(relationCounts(left, right).exact).toBe(1);
    expect([...resourceLedger(left).keys()]).toEqual(["src/a.ts"]);
  });

  it("aligns compound ACP operations around shared and run-only resources", () => {
    const baseline = [{
      laneId: "left",
      runId: "1",
      id: "left-1",
      sequence: 0,
      name: "Read package.json, Read README.md",
      input: { parsed_cmd: [
        { type: "read", path: "package.json", cmd: "cat package.json" },
        { type: "read", path: "README.md", cmd: "cat README.md" },
      ] },
      status: "completed" as const,
    }];
    const candidate = [{
      laneId: "right",
      runId: "2",
      id: "right-1",
      sequence: 0,
      name: "Search AGENTS.md, Read README.md",
      input: { parsed_cmd: [
        { type: "search", query: "AGENTS.md", path: "..", cmd: "find .. -name AGENTS.md" },
        { type: "read", path: "README.md", cmd: "cat README.md" },
      ] },
      status: "completed" as const,
    }];

    expect(resourceComparisonRows(baseline, candidate).map((row) => ({
      resource: row.resource,
      baseline: row.baseline.map((operation) => operation.kind),
      candidate: row.candidate.map((operation) => operation.kind),
    }))).toEqual([
      { resource: "AGENTS.md", baseline: [], candidate: ["search"] },
      { resource: "package.json", baseline: ["read"], candidate: [] },
      { resource: "README.md", baseline: ["read"], candidate: ["read"] },
    ]);
  });
});
