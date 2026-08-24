import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP, type AddressInfo } from "node:net";
import {
  latestUserPrompt,
  parseRunAgentInput,
  RunAgentInputError,
  type AguiEvent,
} from "./protocol.js";
import { encodeSseEvent } from "./sse.js";
import { runHarnessAgui, type HarnessUiExecutorFactory } from "./run.js";

const MAX_BODY_BYTES = 1_048_576;

export interface HarnessUiServerOptions {
  /** `.harness` source text served by this endpoint. */
  source: string;
  harnessId?: string;
  runtimeId?: string;
  /** Working directory handed to the executor for each run. */
  cwd?: string;
  /** Root a `source`-backed skill's path is locked and delivered against. */
  sourceRoot?: string;
  executorFactory: HarnessUiExecutorFactory;
  /** Exact browser origins allowed in addition to this server's own origin. */
  allowedOrigins?: readonly string[];
  /** Optional server-owned cancellation signal for one validated browser run id. */
  runAbortSignal?: (runId: string) => AbortSignal | undefined;
}

/**
 * A minimal AG-UI HTTP endpoint for one harness assembly.
 *
 * - `POST /agui` — accepts an AG-UI `RunAgentInput` body and answers with an
 *   SSE stream of AG-UI events for one run.
 * - `GET /healthz` — liveness probe.
 *
 * This is a local development surface: bind it to loopback (the default in
 * {@link startHarnessUiServer}) and put a real gateway in front for anything
 * else.
 */
export function createHarnessUiServer(options: HarnessUiServerOptions): Server {
  const normalizedOptions = {
    ...options,
    allowedOrigins: normalizeAllowedOrigins(options.allowedOrigins),
  };
  return createServer((request, response) => {
    void route(request, response, normalizedOptions);
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessUiServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "OPTIONS" && url.pathname === "/agui") {
    if (!authorizeBrowserOrigin(request, response, options.allowedOrigins)) {
      return;
    }
    response.writeHead(204, {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/healthz") {
    respondJson(response, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && url.pathname === "/agui") {
    await handleAguiRun(request, response, options);
    return;
  }
  respondJson(response, 404, { error: `No route for ${request.method} ${url.pathname}` });
}

/**
 * Handle one AG-UI run request/response pair. Exported so embedders (for
 * example `@qoder-ai/harness-studio`) can mount the endpoint on their own
 * server without re-implementing the protocol handshake.
 */
export async function handleAguiRun(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessUiServerOptions,
): Promise<void> {
  if (!authorizeBrowserOrigin(request, response, options.allowedOrigins)) {
    return;
  }
  if (!isJsonRequest(request)) {
    respondJson(response, 415, { error: "POST /agui requires Content-Type: application/json." });
    return;
  }
  let body: string;
  try {
    body = await readBody(request);
  } catch (error) {
    respondJson(response, 413, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  let input;
  try {
    input = parseRunAgentInput(body.length > 0 ? JSON.parse(body) : undefined);
  } catch (error) {
    const message = error instanceof RunAgentInputError || error instanceof SyntaxError
      ? error.message
      : String(error);
    respondJson(response, 400, { error: message });
    return;
  }
  const prompt = latestUserPrompt(input);
  if (prompt === undefined) {
    respondJson(response, 400, { error: "RunAgentInput.messages must contain a user message with content." });
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let runStarted = false;
  let runTerminated = false;
  const writeEvent = (event: AguiEvent): void => {
    if (event.type === "RUN_STARTED") runStarted = true;
    if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") runTerminated = true;
    response.write(encodeSseEvent(event));
  };
  try {
    const abortSignal = options.runAbortSignal?.(input.runId);
    await runHarnessAgui({
      source: options.source,
      prompt,
      threadId: input.threadId,
      runId: input.runId,
      onEvent: writeEvent,
      ...(options.harnessId !== undefined ? { harnessId: options.harnessId } : {}),
      ...(options.runtimeId !== undefined ? { runtimeId: options.runtimeId } : {}),
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.sourceRoot !== undefined ? { sourceRoot: options.sourceRoot } : {}),
      executorFactory: options.executorFactory,
      ...(abortSignal !== undefined ? { abortSignal } : {}),
    });
  } catch (error) {
    // runHarnessAgui normally reports failures itself. Preserve a complete
    // outer lifecycle if an unexpected transport or embedding failure escapes.
    if (!runStarted) writeEvent({ type: "RUN_STARTED", threadId: input.threadId, runId: input.runId });
    if (!runTerminated) {
      writeEvent({
        type: "RUN_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    response.end();
  }
}

export interface StartedHarnessUiServer {
  server: Server;
  url: string;
  close(): Promise<void>;
}

export async function startHarnessUiServer(
  options: HarnessUiServerOptions & { port?: number; host?: string; allowRemote?: boolean },
): Promise<StartedHarnessUiServer> {
  const server = createHarnessUiServer(options);
  const host = options.host ?? "127.0.0.1";
  assertBindAddressAllowed(host, options.allowRemote === true);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(options.port ?? 0, host, resolvePromise);
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
        server.closeAllConnections();
      }),
  };
}

function respondJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(`${JSON.stringify(payload)}\n`);
}

function authorizeBrowserOrigin(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: readonly string[] | undefined,
): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) {
    return true;
  }
  const normalizedOrigin = parseOrigin(origin);
  const host = request.headers.host;
  const ownOrigin = host === undefined ? undefined : parseOrigin(`http://${host}`);
  const allowed = new Set(normalizeAllowedOrigins(allowedOrigins));
  const sameLoopbackOrigin = normalizedOrigin === ownOrigin && host !== undefined && isLoopbackHost(host);
  if (normalizedOrigin === undefined || (!sameLoopbackOrigin && !allowed.has(normalizedOrigin))) {
    respondJson(response, 403, { error: `Browser origin '${origin}' is not allowed.` });
    return false;
  }
  response.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  response.setHeader("Vary", "Origin");
  return true;
}

export class HarnessUiRemoteBindError extends Error {
  constructor(readonly host: string) {
    super(
      `Refusing to bind the AG-UI endpoint to '${host}'. POST /agui runs a coding agent with ` +
        "host tools in the server's working directory and has no authentication, so a " +
        "reachable bind address hands that agent to anyone who can route to it. Bind to " +
        "loopback and put a gateway in front, or pass allowRemote (CLI: " +
        "--unsafe-allow-remote) to accept that risk explicitly.",
    );
    this.name = "HarnessUiRemoteBindError";
  }
}

/**
 * Refuse a reachable bind address unless the caller opted in.
 *
 * The origin check below is a browser-CSRF guard, not authentication: a request
 * without an `Origin` header — any script, any `curl` — is allowed through by
 * design. That is safe only while the socket itself is unreachable, which makes
 * the bind address the real boundary.
 */
export function assertBindAddressAllowed(host: string, allowRemote: boolean): void {
  if (allowRemote || isLoopbackBindAddress(host)) {
    return;
  }
  throw new HarnessUiRemoteBindError(host);
}

/** Loopback as a *bind* address; wildcards such as `0.0.0.0` and `::` are reachable. */
function isLoopbackBindAddress(host: string): boolean {
  const hostname = host.trim().toLowerCase().replace(/^\[|\]$/gu, "");
  if (hostname === "localhost" || hostname === "::1") {
    return true;
  }
  return isIP(hostname) === 4 && hostname.startsWith("127.");
}

function isLoopbackHost(host: string): boolean {
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "[::1]" || (isIP(hostname) === 4 && hostname.startsWith("127."));
  } catch {
    return false;
  }
}

function normalizeAllowedOrigins(allowedOrigins: readonly string[] | undefined): string[] {
  return (allowedOrigins ?? []).map((value) => {
    const normalized = parseOrigin(value);
    if (normalized === undefined) {
      throw new Error(`Invalid allowed browser origin '${value}'. Use an absolute http(s) origin without a path.`);
    }
    return normalized;
  });
}

function parseOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function isJsonRequest(request: IncomingMessage): boolean {
  const contentType = request.headers["content-type"];
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const rejectTooLarge = (): void => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      // Keep draining the request so the response can be written on the same
      // socket. Destroying here turns the intended 413 into ECONNRESET.
      request.resume();
      rejectPromise(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes.`));
    };
    const contentLength = request.headers["content-length"];
    if (contentLength !== undefined && Number(contentLength) > MAX_BODY_BYTES) {
      rejectTooLarge();
      return;
    }
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        rejectTooLarge();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolvePromise(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    });
  });
}
