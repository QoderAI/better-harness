import { describe, expect, it } from "vitest";
import {
  HARNESS_RUN_REQUEST_KIND,
  HARNESS_RUN_STREAM_EVENT_KIND,
  parseHarnessRunRequestV1,
  parseHarnessRunStreamEventV1,
} from "../src/protocol/index.js";

describe("Harness run stream protocol", () => {
  it("validates bounded run requests", () => {
    expect(parseHarnessRunRequestV1({
      kind: HARNESS_RUN_REQUEST_KIND,
      threadId: "thread-1",
      runId: "run-1",
      prompt: "inspect",
    })).toEqual({ kind: HARNESS_RUN_REQUEST_KIND, threadId: "thread-1", runId: "run-1", prompt: "inspect" });
    expect(() => parseHarnessRunRequestV1({ kind: HARNESS_RUN_REQUEST_KIND, threadId: "t", runId: "r", prompt: "" }))
      .toThrow(/prompt/);
  });

  it("parses sequenced neutral events and rejects unknown event types", () => {
    expect(parseHarnessRunStreamEventV1({
      kind: HARNESS_RUN_STREAM_EVENT_KIND,
      threadId: "thread-1",
      runId: "run-1",
      sequence: 1,
      event: { type: "text-delta", messageId: "message-1", text: "hello" },
    })).toMatchObject({ sequence: 1, event: { type: "text-delta", text: "hello" } });
    expect(() => parseHarnessRunStreamEventV1({
      kind: HARNESS_RUN_STREAM_EVENT_KIND,
      threadId: "thread-1",
      runId: "run-1",
      sequence: 2,
      event: { type: "invented" },
    })).toThrow(/Unsupported/);
  });
});
