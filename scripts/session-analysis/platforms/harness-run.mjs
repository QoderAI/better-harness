import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { SessionAnalyzer } from "../analyzer.mjs";
import { pathExists, walkFiles } from "../fs.mjs";
import { normalizeWorkspace } from "../paths.mjs";

const MAX_TRACE_BYTES = 5_000_000;

export class HarnessRunSessionAnalyzer extends SessionAnalyzer {
  async resolveScope(options = {}) {
    const workspace = normalizeWorkspace(options.workspace);
    return {
      platform: "harness-run",
      workspace,
      evidenceRoot: path.resolve(options.home ?? options["harness-run-home"] ?? path.join(workspace, ".better-harness", "harness-runs")),
      since: null,
      sinceTime: null,
      until: null,
      untilTime: null,
      sessionId: options["session-id"] ?? options.sessionId ?? null,
    };
  }

  async discoverSourceRoots(scope) {
    return [{
      id: "harness-run-evidence",
      kind: "harness-run-jsonl",
      role: "persisted-harness-run-evidence",
      path: scope.evidenceRoot,
      optional: true,
      enabled: true,
      workspaceScoped: true,
      exists: await pathExists(scope.evidenceRoot),
    }];
  }

  async discoverSessions(scope, roots) {
    const root = roots.find((candidate) => candidate.kind === "harness-run-jsonl");
    if (!root?.exists) return [];
    const traceFiles = await walkFiles(root.path, {
      maxDepth: 6,
      limit: 1_000,
      match: (file) => path.basename(file) === "trace.jsonl",
    });
    const sessions = [];
    for (const tracePath of traceFiles) {
      const trialDirectory = path.dirname(tracePath);
      const variantDirectory = path.dirname(trialDirectory);
      const revisionPath = path.join(variantDirectory, "revision.json");
      if (!await pathExists(revisionPath)) continue;
      const revision = JSON.parse(await readFile(revisionPath, "utf8"));
      const metadata = await stat(tracePath);
      const variant = path.basename(variantDirectory);
      const trial = path.basename(trialDirectory);
      sessions.push({
        sessionId: `${revision.revisionId}:${variant}:${trial}`,
        platform: "harness-run",
        provider: "harness-run",
        workspace: scope.workspace,
        revisionId: revision.revisionId,
        firstSeen: metadata.mtime.toISOString(),
        lastSeen: metadata.mtime.toISOString(),
        sources: [{ kind: "harness-run-jsonl", path: tracePath, revisionId: revision.revisionId }],
      });
    }
    return sessions.sort((left, right) => right.lastSeen.localeCompare(left.lastSeen));
  }

  normalizeEvent(raw, sourceRef, _options = {}) {
    const base = {
      sessionId: sourceRef.sessionId,
      timestamp: raw.timestamp ?? sourceRef.timestamp,
      sourceKind: "harness-run-jsonl",
      planningScope: "workspace",
      evidenceRef: { kind: "harness-run-jsonl", path: sourceRef.path, line: sourceRef.line },
      revisionId: sourceRef.revisionId,
    };
    if (raw.type === "tool-call-started") {
      return {
        ...base,
        type: "tool.requested",
        category: "tool",
        lifecyclePhase: "request",
        toolInvocationId: raw.toolCallId,
        toolName: raw.toolName,
        ...(typeof raw.input?.file_path === "string" ? { filePath: raw.input.file_path } : {}),
        summary: "Harness tool request observed",
      };
    }
    if (raw.type === "tool-call-result") {
      return {
        ...base,
        type: "tool.execution.finished",
        category: "tool",
        lifecyclePhase: "result",
        toolInvocationId: raw.toolCallId,
        success: raw.isError !== true,
        hasError: raw.isError === true,
        summary: "Harness tool result observed",
      };
    }
    return {
      ...base,
      type: raw.type ?? "harness.event",
      category: raw.type?.startsWith("run-") ? "system" : "assistant",
      summary: raw.type ?? "Harness run event",
    };
  }

  async readSession(session) {
    const source = session.sources[0];
    const metadata = await stat(source.path);
    if (metadata.size > MAX_TRACE_BYTES) {
      throw new Error(`Harness trace exceeds ${MAX_TRACE_BYTES} bytes.`);
    }
    const text = await readFile(source.path, "utf8");
    const events = [];
    let offset = 0;
    for (const [index, line] of text.split(/\r?\n/u).entries()) {
      if (!line.trim()) continue;
      const raw = JSON.parse(line);
      events.push(this.normalizeEvent(raw, {
        ...source,
        sessionId: session.sessionId,
        line: index + 1,
        timestamp: new Date(metadata.mtimeMs + offset).toISOString(),
      }));
      offset += 1;
    }
    return events;
  }
}
