import {
  HARNESS_RUN_REQUEST_KIND,
  parseHarnessRunStreamEventV1,
  type HarnessRunStreamEventV1,
} from "@qoder-ai/harness/protocol";
import { createSseParser } from "../sse-client.js";

export interface StudioRunProjectBinding {
  id: string;
  label: string;
  revision: number;
}

/**
 * Post one Harness run and fold its native event stream into state updates.
 *
 * Batching through one animation frame keeps a chatty Agent from re-rendering
 * per token, and it lets several concurrent runs share the same transport
 * without competing for frames.
 */
export async function streamRun(
  endpoint: string,
  prompt: string,
  threadId: string,
  runId: string,
  project: StudioRunProjectBinding | undefined,
  onEvents: (events: HarnessRunStreamEventV1[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(project === undefined ? {} : {
        "X-Harness-Project-Id": project.id,
        "X-Harness-Project-Revision": String(project.revision),
      }),
    },
    body: JSON.stringify({
      kind: HARNESS_RUN_REQUEST_KIND,
      threadId,
      runId,
      prompt,
    }),
  });
  if (!response.ok || response.body === null) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Run request failed (${response.status}): ${detail}`);
  }
  let pendingEvents: HarnessRunStreamEventV1[] = [];
  let frame: number | undefined;
  const flush = (): void => {
    frame = undefined;
    const events = pendingEvents;
    pendingEvents = [];
    if (events.length > 0) onEvents(events);
  };
  let terminal = false;
  const apply = (event: HarnessRunStreamEventV1): void => {
    if (event.event.type === "run-finished" || event.event.type === "run-error") terminal = true;
    pendingEvents.push(event);
    frame ??= globalThis.requestAnimationFrame(flush);
  };
  const parser = createSseParser<unknown>((event) => apply(parseHarnessRunStreamEventV1(event)));
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
    if (!terminal) throw new Error("Run stream closed before completion. Try the run again.");
  } finally {
    if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
    flush();
    reader.releaseLock();
  }
}
