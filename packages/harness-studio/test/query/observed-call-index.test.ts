import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ObservedCallIndex } from "../../src/server/query/observed-call-index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ObservedCallIndex", () => {
  for (const callCount of [100, 1_000, 10_000]) {
    it(`keeps the first page bounded for ${callCount.toLocaleString()} tool calls`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "studio-jsonl-index-"));
      temporaryDirectories.push(directory);
      const path = join(directory, "trajectory.jsonl");
      const lines: string[] = [];
      for (let index = 0; index < callCount; index += 1) {
        lines.push(JSON.stringify({ type: "tool-call-started", toolCallId: `call_${index}`, toolName: "Read", input: { path: `file-${index}.ts` } }));
        lines.push(JSON.stringify({ type: "tool-call-result", toolCallId: `call_${index}`, content: "ok" }));
      }
      await writeFile(path, `${lines.join("\n")}\n`, "utf8");
      const index = new ObservedCallIndex(path, "history");
      const page = await index.page(undefined, 100);
      expect(page.calls).toHaveLength(100);
      expect(page.calls[0]).toMatchObject({ sequence: 0, status: "completed" });
      expect(page.parsedLines).toBeLessThanOrEqual(callCount === 100 ? 200 : 201);
      expect(page.complete).toBe(callCount === 100);
      index.close();
    });
  }

  it("continues with a stable cursor and caps caller-provided limits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "studio-jsonl-page-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "trajectory.jsonl");
    await writeFile(path, Array.from({ length: 1_200 }, (_, index) => [
      JSON.stringify({ type: "tool-call-started", toolCallId: `call_${index}`, toolName: "Read" }),
      JSON.stringify({ type: "tool-call-result", toolCallId: `call_${index}` }),
    ].join("\n")).join("\n"), "utf8");
    const index = new ObservedCallIndex(path, "history");
    const first = await index.page(undefined, 900);
    const second = await index.page(first.nextCursor, 100);
    expect(first.calls).toHaveLength(500);
    expect(second.calls[0]?.sequence).toBe(500);
    index.close();
  });
});
