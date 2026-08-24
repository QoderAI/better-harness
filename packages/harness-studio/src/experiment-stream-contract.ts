export interface ExperimentToolCall {
  laneId: string;
  runId: string;
  id: string;
  sequence: number;
  name: string;
  input?: unknown;
  status: "running" | "completed" | "failed" | "result-unavailable";
  result?: string;
}

export type CanonicalToolEvent =
  | { type: "tool-call-started"; toolCallId: string; toolName: string; input?: unknown }
  | { type: "tool-call-result"; toolCallId: string; content?: unknown; isError?: boolean }
  | { type: "run-finished" };

export function foldCanonicalToolEvent(
  calls: readonly ExperimentToolCall[],
  laneId: string,
  runId: string,
  event: CanonicalToolEvent,
): ExperimentToolCall[] {
  if (event.type === "tool-call-started") {
    return [...calls, {
      laneId,
      runId,
      id: `${runId}:${event.toolCallId}`,
      sequence: calls.length,
      name: event.toolName,
      ...(event.input === undefined ? {} : { input: event.input }),
      status: "running",
    }];
  }
  if (event.type === "tool-call-result") {
    return calls.map((call) => call.id === `${runId}:${event.toolCallId}`
      ? {
          ...call,
          status: event.isError === true ? "failed" as const : "completed" as const,
          ...(typeof event.content === "string" ? { result: event.content } : {}),
        }
      : call);
  }
  return calls.map((call) => call.status === "running" && call.runId === runId
    ? { ...call, status: "result-unavailable" as const }
    : call);
}
