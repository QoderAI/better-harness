import { describe, it, expect } from "vitest";
import { AcpEchoFilter } from "../src/server/acp-echo-filter.js";
import type { HarnessRunEvent } from "@qoder-ai/harness/exec";
const image = { type: "image" as const, mimeType: "image/png", data: "aGVsbG8=" };
function echo(filter: AcpEchoFilter, text: string): HarnessRunEvent[] {
  return [filter.accept({ type: "message-started", role: "user", messageId: "remote" }), filter.accept({ type: "message-content", messageId: "remote", content: { type: "text", text: text.slice(0, 2) } }), filter.accept({ type: "message-content", messageId: "remote", content: { type: "text", text: text.slice(2) } }), filter.accept({ type: "message-content", messageId: "remote", content: { data: image.data, type: image.type, mimeType: image.mimeType } }), filter.accept({ type: "message-finished", messageId: "remote" })].flat();
}
describe("ACP optimistic echo identity", () => {
  it("AC-06 suppresses one matching text/media echo, preserves an identical later message", () => {
    const filter = new AcpEchoFilter(); filter.expect([{ type: "text", text: "hello" }, image]);
    expect(echo(filter, "hello")).toEqual([]); expect(echo(filter, "hello")).toHaveLength(5);
  });
  it("does not suppress different replayed context", () => {
    const filter = new AcpEchoFilter(); filter.expect([{ type: "text", text: "hello" }, image]);
    expect(echo(filter, "other")).toHaveLength(5);
  });
});
