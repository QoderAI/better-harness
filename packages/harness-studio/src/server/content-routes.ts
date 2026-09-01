import { sessionFromRetainedRun } from "./debugger-session-transform.js";
import { loadEvidenceVerdict } from "./query/evidence-query.js";
import { extractInspectorReportJson, loadInspectorReport } from "./query/inspector-query.js";
import { listRunRecords, parseRunSnapshot, readRunRecord, saveRunRecord } from "./run-log.js";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { readJsonBody, respondJson, sameOriginRequest, STATIC_CONTENT_TYPES } from "./http-utils.js";
import { HarnessStudioServerOptions } from "./studio-types.js";

export async function serveInspectorReport(response: ServerResponse, reportPath: string | undefined): Promise<void> {
  if (reportPath === undefined) {
    respondJson(response, 404, {
      error: "No Inspector report loaded; start with --inspector <report.html>.",
    });
    return;
  }
  try {
    const html = await loadInspectorReport(reportPath);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(html);
  } catch {
    respondJson(response, 404, {
      error: "Cannot read the configured Inspector report.",
    });
  }
}
export async function serveInspectorReportJson(response: ServerResponse, reportPath: string | undefined): Promise<void> {
  if (reportPath === undefined) {
    respondJson(response, 404, {
      error: "No Inspector report loaded; start with --inspector <report.html>.",
    });
    return;
  }
  try {
    const html = await loadInspectorReport(reportPath);
    let json: string;
    try {
      json = extractInspectorReportJson(html);
    } catch {
      response.writeHead(204, {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(`${json}\n`);
  } catch {
    respondJson(response, 404, {
      error: "Cannot read the configured Inspector report.",
    });
  }
}
/** Saved Debugger runs: retained browser-observed Harness evidence, one JSON file per run. */
export async function routeRuns(
  request: IncomingMessage,
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  url: URL,
  runId: string | undefined,
  sessionProjection = false,
): Promise<void> {
  if (options.harnessSource === undefined) {
    respondJson(response, 404, { error: "No harness loaded; saved runs require --harness <file.harness>." });
    return;
  }
  const directory = options.runDirectory ?? resolve(options.cwd ?? process.cwd(), ".harness-studio-runs");
  try {
    if (request.method === "GET" && runId !== undefined) {
      try {
        const record = await readRunRecord(directory, runId);
        respondJson(response, 200, sessionProjection ? sessionFromRetainedRun(record) : record);
      } catch {
        respondJson(response, 404, { error: `Saved run '${runId}' is not available.` });
      }
      return;
    }
    if (request.method === "GET") {
      respondJson(response, 200, { runs: await listRunRecords(directory) });
      return;
    }
    if (request.method === "POST" && runId === undefined) {
      if (!sameOriginRequest(request)) {
        respondJson(response, 403, { error: "Cross-origin run saving is not allowed." });
        return;
      }
      const snapshot = parseRunSnapshot(await readJsonBody(request, 2_000_000));
      respondJson(response, 201, await saveRunRecord(directory, snapshot));
      return;
    }
    respondJson(response, 405, { error: `Use GET or POST for ${url.pathname}.` });
  } catch (error) {
    respondJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}
export async function serveEvidence(response: ServerResponse, evidenceDir: string | undefined): Promise<void> {
  if (evidenceDir === undefined) {
    respondJson(response, 404, { error: "No evidence directory loaded; start with --evidence <dir>." });
    return;
  }
  try {
    const raw = await loadEvidenceVerdict(evidenceDir);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(raw);
  } catch {
    respondJson(response, 404, { error: `No readable verdict.json in '${evidenceDir}'.` });
  }
}
export async function serveStatic(response: ServerResponse, appDir: string, pathname: string): Promise<void> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const root = resolve(appDir);
  const target = normalize(resolve(root, relative));
  if (target !== root && !target.startsWith(root + sep)) {
    respondJson(response, 403, { error: "Path escapes the app directory." });
    return;
  }
  try {
    const stats = await stat(target);
    if (!stats.isFile()) {
      throw new Error("not a file");
    }
    response.writeHead(200, {
      "Content-Type": STATIC_CONTENT_TYPES[extname(target)] ?? "application/octet-stream",
      "Content-Length": stats.size,
    });
    createReadStream(target).pipe(response);
  } catch {
    respondJson(response, 404, { error: `No static asset for '${pathname}'.` });
  }
}
