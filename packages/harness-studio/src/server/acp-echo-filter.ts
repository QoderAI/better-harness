import type { HarnessRunEvent, AcpPromptContent } from "@qoder-ai/harness/exec";
/** Suppress exactly one matching local user echo, never repeated actual messages. */
export class AcpEchoFilter {
  private expected?: string;
  private buffered?: HarnessRunEvent[];
  expect(content: AcpPromptContent): void { this.expected = signature(content); }
  accept(event: HarnessRunEvent): HarnessRunEvent[] {
    if (event.type === "message-started" && event.role === "user") { this.buffered = [event]; return []; }
    if (!this.buffered) return [event];
    if (["message-content", "text-delta", "message-finished"].includes(event.type)) {
      this.buffered.push(event);
      if (event.type !== "message-finished") return [];
      const buffered = this.buffered; this.buffered = undefined;
      const content = buffered.flatMap(item => item.type === "message-content" ? [item.content] : item.type === "text-delta" ? [{ type: "text", text: item.text }] : []);
      const matches = this.expected !== undefined && signature(content) === this.expected;
      this.expected = undefined;
      return matches ? [] : buffered;
    }
    // Protocol evidence is retained immediately, even while the user frame is open.
    if (event.type === "protocol-event") return [event];
    const buffered = this.buffered; this.buffered = undefined; this.expected = undefined;
    return [...buffered, event];
  }
}
function signature(blocks: unknown[]): string {
  const canonical: unknown[] = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") { canonical.push(raw); continue; }
    const { _meta, ...block } = raw as Record<string, unknown>;
    const previous = canonical.at(-1) as Record<string, unknown> | undefined;
    if (block.type === "text" && previous?.type === "text") previous.text = String(previous.text) + String(block.text);
    else canonical.push(block);
  }
  return JSON.stringify(canonical, (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}
