import type { AguiEvent } from "./protocol.js";

/**
 * Encode one AG-UI event as a Server-Sent Events frame.
 *
 * AG-UI's HTTP transport is a plain SSE stream of JSON events; `data:` is the
 * only field required by consumers such as `@ag-ui/client`'s HttpAgent.
 */
export function encodeSseEvent(event: AguiEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Parse the AG-UI events out of a complete SSE stream body. */
export function decodeSseStream(body: string): AguiEvent[] {
  const events: AguiEvent[] = [];
  for (const frame of body.split("\n\n")) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data.length > 0) {
      events.push(JSON.parse(data) as AguiEvent);
    }
  }
  return events;
}
