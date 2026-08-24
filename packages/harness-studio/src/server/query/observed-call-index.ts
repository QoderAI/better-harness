import { createReadStream, type ReadStream } from "node:fs";
import { createInterface, type Interface } from "node:readline";
import type { ExperimentToolCall } from "../../experiment-stream-contract.js";
import { canonicalToolEvents } from "../experiment-events.js";

export interface ObservedCallPage {
  calls: ExperimentToolCall[];
  nextCursor?: string;
  complete: boolean;
  parsedLines: number;
  malformedLines: number;
}

/**
 * Incremental, process-local JSONL index. It never retains raw session lines:
 * only canonical tool calls and the current stream cursor stay in memory.
 */
export class ObservedCallIndex {
  private readonly runId: string;
  private readonly calls: ExperimentToolCall[] = [];
  private readonly callIndexByToolId = new Map<string, number>();
  private input: ReadStream | undefined;
  private lines: Interface | undefined;
  private iterator: AsyncIterator<string> | undefined;
  private complete = false;
  private parsedLines = 0;
  private malformedLines = 0;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string, private readonly laneId: string) {
    this.runId = `observed:${laneId}`;
  }

  page(cursor: string | undefined, requestedLimit: number): Promise<ObservedCallPage> {
    const offset = parseCursor(cursor);
    const limit = Math.min(500, Math.max(1, Math.trunc(requestedLimit)));
    const task = this.pending.then(() => this.readPage(offset, limit));
    this.pending = task.catch(() => undefined);
    return task;
  }

  close(): void {
    this.lines?.close();
    this.input?.destroy();
    this.complete = true;
  }

  private async readPage(offset: number, limit: number): Promise<ObservedCallPage> {
    const lookahead = offset + limit + 1;
    while (!this.complete && this.calls.length < lookahead) {
      const line = await this.nextLine();
      if (line === undefined) {
        this.complete = true;
        this.settleRunningCalls();
        break;
      }
      this.parsedLines += 1;
      if (line.trim() === "") continue;
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch {
        this.malformedLines += 1;
        continue;
      }
      for (const event of canonicalToolEvents(value)) this.applyEvent(event);
    }
    const calls = this.calls.slice(offset, offset + limit);
    const hasMore = this.calls.length > offset + calls.length || !this.complete;
    return {
      calls,
      ...(hasMore ? { nextCursor: String(offset + calls.length) } : {}),
      complete: !hasMore,
      parsedLines: this.parsedLines,
      malformedLines: this.malformedLines,
    };
  }

  private async nextLine(): Promise<string | undefined> {
    if (this.iterator === undefined) {
      this.input = createReadStream(this.path, { encoding: "utf8" });
      this.lines = createInterface({ input: this.input, crlfDelay: Infinity });
      this.iterator = this.lines[Symbol.asyncIterator]();
    }
    const next = await this.iterator.next();
    return next.done ? undefined : next.value;
  }

  private applyEvent(event: ReturnType<typeof canonicalToolEvents>[number]): void {
    if (event.type === "tool-call-started") {
      const index = this.calls.length;
      this.callIndexByToolId.set(event.toolCallId, index);
      this.calls.push({
        laneId: this.laneId,
        runId: this.runId,
        id: `${this.runId}:${event.toolCallId}`,
        sequence: index,
        name: event.toolName,
        ...(event.input === undefined ? {} : { input: event.input }),
        status: "running",
      });
      return;
    }
    if (event.type === "tool-call-result") {
      const index = this.callIndexByToolId.get(event.toolCallId);
      const call = index === undefined ? undefined : this.calls[index];
      if (index === undefined || call === undefined) return;
      this.calls[index] = {
        ...call,
        status: event.isError === true ? "failed" : "completed",
        ...(typeof event.content === "string" ? { result: event.content } : {}),
      };
      return;
    }
    this.settleRunningCalls();
  }

  private settleRunningCalls(): void {
    for (let index = 0; index < this.calls.length; index += 1) {
      const call = this.calls[index]!;
      if (call.status === "running") this.calls[index] = { ...call, status: "result-unavailable" };
    }
  }
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") return 0;
  if (!/^\d+$/.test(cursor)) throw new Error("Observed-call cursor must be a non-negative integer.");
  const value = Number(cursor);
  if (!Number.isSafeInteger(value)) throw new Error("Observed-call cursor is outside the supported range.");
  return value;
}
