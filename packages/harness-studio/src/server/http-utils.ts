import type { IncomingMessage, ServerResponse } from "node:http";

/** Static Studio/runtime assets only; artifact media types live in artifacts/registry/artifact-catalog.ts. */
export const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
  ".patch": "text/plain; charset=utf-8",
  ".diff": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Shared bound across artifact and workspace import sessions. */
export const MAX_IMPORT_SESSIONS = 4;
export const MAX_IMPORT_BYTES = 128 * 1024 * 1024;
export const IMPORT_SESSION_TTL_MS = 10 * 60 * 1000;

export function decodeRouteComponent(response: ServerResponse, value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    respondJson(response, 400, { error: "Malformed URL path segment." });
    return undefined;
  }
}
export async function readJsonBody(request: IncomingMessage, maxBytes = 32_768): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(bytes);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function sameOriginRequest(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}
export function respondJson(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(`${JSON.stringify(payload)}\n`);
}

export function encodeSseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
