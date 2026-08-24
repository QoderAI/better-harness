import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { ExperimentToolCall } from "../src/experiment-stream-contract.js";
import { aggregateToolCalls } from "../src/app/experiment-comparison-model.js";
import { buildTimelineBins, groupLiveTimeline } from "../src/app/timeline-model.js";
import { fixedVirtualWindow } from "../src/app/virtual-list-model.js";
import { applyAguiEvent, initialRunState } from "../src/app/agui-store.js";

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
    const startedAt = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      const id = `tool-${index}`;
      state = applyAguiEvent(state, { type: "TOOL_CALL_START", toolCallId: id, toolCallName: "Read" });
      state = applyAguiEvent(state, { type: "TOOL_CALL_ARGS", toolCallId: id, delta: "{}" });
      state = applyAguiEvent(state, { type: "TOOL_CALL_RESULT", toolCallId: id, messageId: `result-${index}`, content: "ok", role: "tool" });
    }
    expect(state.timelineKeys).toHaveLength(10_000);
    expect(state.toolCallCount).toBe(10_000);
    expect(state.timelineByKey.get("tool-call:tool-9999")).toMatchObject({ status: "completed" });
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
