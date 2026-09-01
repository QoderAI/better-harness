import type { IncomingMessage, ServerResponse } from "node:http";
import { runHarness, type HarnessExecutorFactory } from "@qoder-ai/harness/exec";
import {
  HARNESS_RUN_STREAM_EVENT_KIND,
  parseHarnessRunRequestV1,
  type HarnessRunStreamEventV1,
} from "@qoder-ai/harness/protocol";
import { encodeSseData, readJsonBody, respondJson, sameOriginRequest } from "./http-utils.js";

export interface StudioRunStreamOptions {
  source: string;
  harnessId?: string;
  runtimeId?: string;
  cwd?: string;
  sourceRoot?: string;
  executorFactory: HarnessExecutorFactory;
  runAbortSignal?: (runId: string) => AbortSignal | undefined;
  onClientDisconnect?: (runId: string) => void;
}

export async function streamHarnessRun(
  request: IncomingMessage,
  response: ServerResponse,
  options: StudioRunStreamOptions,
): Promise<void> {
  if (!sameOriginRequest(request)) {
    respondJson(response, 403, { error: "Cross-origin Harness runs are not allowed." });
    return;
  }
  if (!isJsonRequest(request)) {
    respondJson(response, 415, { error: "Harness runs require Content-Type: application/json." });
    return;
  }
  let input;
  try {
    input = parseHarnessRunRequestV1(await readJsonBody(request, 66_560));
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  });
  let sequence = 0;
  let terminal = false;
  const disconnect = (): void => {
    if (!terminal && !response.writableEnded) options.onClientDisconnect?.(input.runId);
  };
  response.once("close", disconnect);
  try {
    const abortSignal = options.runAbortSignal?.(input.runId);
    await runHarness({
      source: options.source,
      prompt: input.prompt,
      threadId: input.threadId,
      runId: input.runId,
      onRunEvent: (event) => {
        sequence += 1;
        if (event.type === "run-finished") terminal = true;
        const envelope: HarnessRunStreamEventV1 = {
          kind: HARNESS_RUN_STREAM_EVENT_KIND,
          threadId: input.threadId,
          runId: input.runId,
          sequence,
          event,
        };
        response.write(encodeSseData(envelope));
      },
      ...(options.harnessId === undefined ? {} : { harnessId: options.harnessId }),
      ...(options.runtimeId === undefined ? {} : { runtimeId: options.runtimeId }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.sourceRoot === undefined ? {} : { sourceRoot: options.sourceRoot }),
      ...(abortSignal === undefined ? {} : { abortSignal }),
      executorFactory: options.executorFactory,
    });
  } finally {
    response.removeListener("close", disconnect);
    if (!response.writableEnded) response.end();
  }
}

function isJsonRequest(request: IncomingMessage): boolean {
  const header = request.headers["content-type"];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
