import { afterEach, expect, it, vi } from "vitest";
import { streamRun } from "../src/app/run/stream-run.js";
import { HARNESS_RUN_STREAM_EVENT_KIND } from "@qoder-ai/harness/protocol";
const callbacks = new Map<number, FrameRequestCallback>();
function setup(chunks: string[]) {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(1, callback); return 1; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } })));
}
function event(type: string, sequence: number, fields = {}) {
  return `data: ${JSON.stringify({ kind: HARNESS_RUN_STREAM_EVENT_KIND, threadId: "thread", runId: "run", sequence, event: { type, ...fields } })}\n\n`;
}
afterEach(() => { vi.unstubAllGlobals(); callbacks.clear(); });
it.each([ ["premature closure", "", "closed before completion"], ["malformed event", "data: invalid\n\n", /JSON|Unexpected/] ])("flushes retained events and cancels late frames on %s", async (_, tail, error) => {
  setup([event("run-started", 1, { revisionId: "sha256:test", host: "qoder" }), tail]);
  const batches: unknown[] = [];
  await expect(streamRun("/run", "hi", "thread", "run", undefined, (events) => batches.push(events))).rejects.toThrow(error);
  expect(batches).toHaveLength(1);
  expect(callbacks.size).toBe(0);
});
it("accepts a completed first request", async () => {
  setup([event("run-started", 1, { revisionId: "sha256:test", host: "qoder" }), event("run-finished", 2, { exitCode: 0 })]);
  const batches: unknown[] = [];
  await streamRun("/run", "hi", "thread", "run", undefined, (events) => batches.push(events));
  expect(batches).toHaveLength(1);
  expect(callbacks.size).toBe(0);
});
