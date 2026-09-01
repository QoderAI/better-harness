import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { ExperimentToolCall } from "../src/contracts/experiment-stream-contract.js";
import { aggregateToolCalls } from "../src/app/experiment/experiment-comparison-model.js";
import { buildTimelineBins, groupLiveTimeline } from "../src/app/run/timeline-model.js";
import { fixedVirtualWindow } from "../src/app/experiment/virtual-list-model.js";
import { HARNESS_RUN_STREAM_EVENT_KIND, type HarnessRunStreamEventV1 } from "@qoder-ai/harness/protocol";
import type { HarnessRunEvent } from "@qoder-ai/harness/exec";
import { applyHarnessRunEvent, initialRunState } from "../src/app/run/run-store.js";

describe("session scale gates", () => {
  for (const eventCount of [100, 1_000, 10_000]) {
    it(`bounds projection work and DOM windows at ${eventCount.toLocaleString()} events`, () => {
      const calls: ExperimentToolCall[] = Array.from({ length: eventCount }, (_, sequence) => ({
        laneId: "lane",
        runId: "run",
        id: `call-${sequence}`,
        sequence,
        name: "Read",
        status: "completed",
      }));
      const startedAt = performance.now();
      const groups = aggregateToolCalls(calls);
      const bins = buildTimelineBins(calls, 64, () => "explore");
      const liveGroups = groupLiveTimeline(calls.map((call) => ({
        kind: "tool-call" as const,
        id: call.id,
        name: call.name,
        argsText: "{}",
        status: "completed" as const,
      })));
      const window = fixedVirtualWindow(calls.length, 44, 44 * Math.max(0, eventCount - 20), 360);
      const duration = performance.now() - startedAt;

      expect(groups).toHaveLength(1);
      expect(groups[0]?.calls).toHaveLength(eventCount);
      expect(liveGroups).toHaveLength(1);
      expect(bins.length).toBeLessThanOrEqual(64);
      expect(window.end - window.start).toBeLessThanOrEqual(22);
      expect(duration).toBeLessThan(1_000);
    });
  }

  it("updates 10,000 streamed tools through keyed lookups", () => {
    let state = initialRunState();
    let sequence = 0;
    const apply = (event: HarnessRunEvent): void => {
      sequence += 1;
      const envelope: HarnessRunStreamEventV1 = {
        kind: HARNESS_RUN_STREAM_EVENT_KIND,
        threadId: "thread",
        runId: "run",
        sequence,
        event,
      };
      state = applyHarnessRunEvent(state, envelope);
    };
    apply({ type: "run-started", revisionId: "sha256:one", host: "qoder" });
    const startedAt = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      const id = `tool-${index}`;
      apply({ type: "tool-call-started", toolCallId: id, toolName: "Read", input: {} });
      apply({ type: "tool-call-finished", toolCallId: id });
      apply({ type: "tool-call-result", toolCallId: id, messageId: `result-${index}`, content: "ok" });
    }
    expect(state.timelineKeys).toHaveLength(10_000);
    expect(state.toolCallCount).toBe(10_000);
    expect(state.timelineByKey.get("tool-call:tool-9999")).toMatchObject({ status: "completed" });
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
