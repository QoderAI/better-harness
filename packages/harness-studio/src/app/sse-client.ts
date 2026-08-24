import type { AguiEvent } from "@qoder-ai/harness-ui";

export interface SseParser {
  /** Feed one decoded chunk; complete frames fire the callback in order. */
  push(chunk: string): void;
  /** Flush a trailing frame that was not `\n\n`-terminated. */
  end(): void;
}

/**
 * Incremental Server-Sent Events parser for AG-UI streams.
 *
 * `fetch` delivers arbitrary chunk boundaries, so frames are reassembled on
 * the blank-line delimiter and each `data:` payload is parsed as one AG-UI
 * event.
 */
export function createSseParser<T = AguiEvent>(onEvent: (event: T) => void): SseParser {
  let buffer = "";
  const emitFrame = (frame: string): void => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data.length > 0) {
      onEvent(JSON.parse(data) as T);
    }
  };
  return {
    push(chunk: string): void {
      buffer += chunk;
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        emitFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    },
    end(): void {
      if (buffer.length > 0) {
        emitFrame(buffer);
        buffer = "";
      }
    },
  };
}
