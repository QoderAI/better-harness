/**
 * Native Pi Agent entry point for Better Harness.
 *
 * The extension owns orchestration only. Evidence collection and report
 * semantics stay in the canonical scripts/ tree so Pi and WorkBuddy cannot
 * silently drift into different policy implementations.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, constants as fsConstants } from "node:fs/promises";
import path from "node:path";
import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  hostDoctor,
  prepareHostRun,
  verifyHostRun,
} from "../../scripts/harness-analysis/host-runtime/index.mjs";

export const PI_RPC_FLAGS = Object.freeze([
  "--mode", "rpc",
  "--no-session",
  "--no-tools",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-context-files",
  "--no-approve",
]);

export const DEFAULT_RPC_TIMEOUT_MS = 120_000;
export const PI_COMMAND_NAME = "better-harness";

const REQUEST_FLAGS = new Set(["--quick", "--normal", "--language"]);

function extensionError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function modelPattern(model: unknown, thinkingLevel?: unknown): string | undefined {
  if (!model || typeof model !== "object") return undefined;
  const value = model as { provider?: unknown; id?: unknown };
  if (typeof value.id !== "string" || value.id.length === 0) return undefined;
  const provider = typeof value.provider === "string" && value.provider.length > 0
    ? `${value.provider}/`
    : "";
  const thinking = typeof thinkingLevel === "string" && thinkingLevel.length > 0
    ? `:${thinkingLevel}`
    : "";
  return `${provider}${value.id}${thinking}`;
}

/** Parse only Better Harness request flags; no shell syntax or arbitrary CLI flags are accepted. */
export function parseReviewRequest(input = "") {
  const tokens = String(input).trim().split(/\s+/u).filter(Boolean);
  let depth: "quick" | "normal" = "normal";
  let language = "en";
  const request: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--quick") {
      depth = "quick";
      continue;
    }
    if (token === "--normal") {
      depth = "normal";
      continue;
    }
    if (token === "--language") {
      const next = tokens[++index];
      if (!next || next.startsWith("-")) {
        throw extensionError("INVALID_COMMAND_ARGUMENT", "--language requires a locale");
      }
      language = next;
      continue;
    }
    if (token.startsWith("--language=")) {
      const value = token.slice("--language=".length);
      if (!value) throw extensionError("INVALID_COMMAND_ARGUMENT", "--language requires a locale");
      language = value;
      continue;
    }
    if (token.startsWith("-")) {
      throw extensionError("INVALID_COMMAND_ARGUMENT", `unsupported /better-harness option: ${token}`);
    }
    request.push(token);
  }
  return { depth, language, request: request.join(" ") };
}

export function buildRpcArgs(model?: string): string[] {
  const args = [...PI_RPC_FLAGS];
  if (model) args.push("--model", model);
  return args;
}

function textFromEvent(event: any): string {
  const candidate = event?.message ?? event?.assistantMessage ?? event?.data?.message ?? event;
  const content = candidate?.content ?? event?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: any) => typeof part === "string" ? part : part?.type === "text" ? part.text : "")
    .filter((part: string) => part.length > 0)
    .join("");
}

function parseJsonRecord(text: string): Record<string, any> {
  const candidates = [
    text.trim(),
    ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)].map((match) => match[1].trim()),
  ];
  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    candidates.push(text.slice(firstObject, lastObject + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const value = parsed?.result && typeof parsed.result === "object" ? parsed.result : parsed;
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // Try the next bounded candidate; a non-JSON model answer fails closed below.
    }
  }
  throw extensionError("MALFORMED_SPECIALIST_JSON", "Pi RPC specialist did not return one JSON object");
}

function killChild(child: any, signal = "SIGTERM") {
  try {
    if (child && !child.killed) child.kill(signal);
  } catch {
    // The process may have exited between the state check and kill().
  }
}

export interface RpcLaneOptions {
  lane: string;
  inputHash: string;
  input: unknown;
  model?: string;
  cwd: string;
  executable?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  spawn?: (file: string, args: string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;
  onChild?: (child: any) => void;
  onChildExit?: (child: any) => void;
}

function lanePrompt(lane: string, inputHash: string, input: unknown, contextId: string): string {
  return [
    "You are one isolated, read-only Better Harness Pi specialist.",
    `Lane: ${lane}`,
    `Context identity: ${contextId}`,
    `Input hash: ${inputHash}`,
    "Use only the evidence envelope below. Do not inspect files, sessions, home directories, tools, or another lane.",
    "Return exactly one JSON object with keys lane, contextId, status, inputHash, output.",
    "status must be completed, partial, or unavailable; output must be a bounded object.",
    JSON.stringify({ lane, contextId, inputHash, evidence: input }),
  ].join("\n");
}

/** Run one Pi RPC child. It never puts lane evidence in argv. */
export function runPiRpcLane(options: RpcLaneOptions): Promise<Record<string, any>> {
  if (options.signal?.aborted) {
    return Promise.reject(extensionError("SPECIALIST_CANCELLED", `Pi specialist cancelled: ${options.lane}`));
  }
  const spawn = options.spawn ?? ((file, args, spawnOptions) => nodeSpawn(file, args, spawnOptions));
  const executable = options.executable ?? process.env.PI_BIN ?? "pi";
  const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  const model = options.model;
  const args = buildRpcArgs(model);
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    return Promise.reject(Object.assign(error as Error, { code: "RPC_SPAWN_FAILED" }));
  }
  options.onChild?.(child);
  const contextId = `pi-rpc:${String(child.pid ?? "unknown")}:${randomUUID()}`;
  const prompt = lanePrompt(options.lane, options.inputHash, options.input, contextId);

  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    let sawAgentEnd = false;
    const deltaText: string[] = [];
    const messageText: string[] = [];
    const timeout = setTimeout(() => finish(extensionError("SPECIALIST_TIMEOUT", `Pi specialist timed out: ${options.lane}`)), timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      options.onChildExit?.(child);
    };
    const finish = (error?: Error & { code?: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        killChild(child);
        reject(error);
        return;
      }
      const text = messageText.length > 0 ? messageText.join("") : deltaText.join("");
      try {
        const result = parseJsonRecord(text);
        resolve({ ...result, pid: child.pid ?? null, contextId: result.contextId ?? contextId });
      } catch (parseError) {
        killChild(child);
        reject(parseError);
      }
    };
    const onAbort = () => finish(extensionError("SPECIALIST_CANCELLED", `Pi specialist cancelled: ${options.lane}`));
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const onLine = (line: string) => {
      if (!line.trim()) return;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        finish(extensionError("RPC_MALFORMED_JSON", `Pi RPC emitted malformed JSON for ${options.lane}`));
        return;
      }
      if (event?.type === "response" && event.success === false) {
        finish(extensionError("RPC_COMMAND_FAILED", String(event.error?.message ?? event.error ?? "Pi RPC command failed")));
        return;
      }
      if (event?.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        deltaText.push(String(event.assistantMessageEvent.delta ?? ""));
      } else if (event?.type === "message_end") {
        const text = textFromEvent(event);
        if (text) messageText.push(text);
      } else if (event?.type === "agent_end") {
        sawAgentEnd = true;
        finish();
      }
    };
    child.stdout.on("data", (chunk: Buffer | string) => {
      buffer += String(chunk);
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        let line = buffer.slice(0, newlineIndex);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        buffer = buffer.slice(newlineIndex + 1);
        onLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    });
    child.stdout.on("end", () => {
      if (buffer.length > 0) onLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
    });
    child.on("error", (error: Error) => finish(Object.assign(error, { code: "RPC_SPAWN_FAILED" })));
    child.on("close", (code: number | null) => {
      if (!settled && !sawAgentEnd) {
        finish(extensionError("RPC_EARLY_EXIT", `Pi RPC child exited before agent_end (${code ?? "unknown"})`));
      }
    });
    try {
      child.stdin.write(`${JSON.stringify({ id: `better-harness-${options.lane}`, type: "prompt", message: prompt })}\n`);
    } catch (error) {
      finish(Object.assign(error as Error, { code: "RPC_STDIN_FAILED" }));
    }
  });
}

export interface SpecialistRunOptions {
  cwd: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  spawn?: RpcLaneOptions["spawn"];
}

/** Run exactly the three canonical lanes and terminate siblings on any failure. */
export async function runPiSpecialists(plan: any, options: SpecialistRunOptions): Promise<Record<string, any>[]> {
  const controller = new AbortController();
  const abortForwarder = () => controller.abort(options.signal?.reason ?? new Error("cancelled"));
  if (options.signal?.aborted) controller.abort(options.signal.reason ?? new Error("cancelled"));
  options.signal?.addEventListener("abort", abortForwarder, { once: true });
  const children = new Set<any>();
  const childOptions = (child: any) => children.add(child);
  const childExit = (child: any) => children.delete(child);
  try {
    const results = await Promise.all([
      "sessionEvidence",
      "projectHarness",
      "agentCustomize",
    ].map((lane) => runPiRpcLane({
      lane,
      inputHash: plan.lanes[lane].inputHash,
      input: plan.lanes[lane].input,
      cwd: options.cwd,
      model: options.model,
      timeoutMs: options.timeoutMs,
      signal: controller.signal,
      spawn: options.spawn,
      onChild: childOptions,
      onChildExit: childExit,
    })));
    return results;
  } catch (error) {
    controller.abort(error);
    for (const child of children) killChild(child);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortForwarder);
    for (const child of children) killChild(child);
  }
}

function currentSessionId(ctx: ExtensionCommandContext): string | undefined {
  try {
    const id = ctx.sessionManager.getSessionId();
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

function leadMessage({ plan, verified, request, outputRoot, model }: { plan: any; verified: any; request: string; outputRoot: string; model?: string }): string {
  return [
    "Better Harness three isolated lanes are verified. Perform exactly one lead reconciliation in this current Pi turn.",
    "Do not rerun collectors, inspect raw sessions, read home directories, or delegate another lane.",
    "Use the canonical Better Harness Skill and existing renderer. Write only findings.json, report.md, and report.html under the output root.",
    "Preserve evidence boundaries and explicitly report configured/enabled/observed/verified/unsupported/unavailable states.",
    `Output root: ${outputRoot}`,
    `Review request: ${request || "Evaluate this workspace's AI delivery readiness."}`,
    JSON.stringify({
      runId: plan.runId,
      provider: plan.provider,
      model,
      depth: plan.depth,
      diagnostics: verified.diagnostics,
      lead: plan.lead,
      specialistResults: verified.results,
    }),
    "After rendering, validate report.md, report.html, and findings.json with the existing report-quality/render validators.",
  ].join("\n");
}

export async function executeBetterHarness(ctx: ExtensionCommandContext, requestInput = "", dependencies: any = {}) {
  const parsed = parseReviewRequest(requestInput);
  const sessionId = currentSessionId(ctx);
  const model = modelPattern(ctx.model, ctx.thinkingLevel);
  const doctor = await (dependencies.hostDoctor ?? hostDoctor)({
    platform: "pi",
    provider: "pi",
    workspace: ctx.cwd,
    model,
    "exclude-session-id": sessionId,
  });
  if (doctor.status === "fail") {
    throw extensionError("PI_HOST_DOCTOR_FAILED", doctor.checks.filter((check: any) => check.status === "fail").map((check: any) => check.detail).join("; "));
  }
  const prepared = await (dependencies.prepareHostRun ?? prepareHostRun)({
    platform: "pi",
    provider: "pi",
    workspace: ctx.cwd,
    depth: parsed.depth,
    language: parsed.language,
    model,
    "exclude-session-id": sessionId,
  }, dependencies);
  if (prepared.status === "failed" && parsed.depth === "normal") {
    throw extensionError("PI_PREPARE_FAILED", "normal Better Harness run could not collect all required lanes");
  }
  const runSpecialists = dependencies.runPiSpecialists ?? runPiSpecialists;
  const results = await runSpecialists(prepared.plan, {
    cwd: ctx.cwd,
    model,
    signal: ctx.signal,
    timeoutMs: dependencies.timeoutMs,
    spawn: dependencies.spawn,
  });
  const verified = (dependencies.verifyHostRun ?? verifyHostRun)(prepared.plan, results);
  if (!verified.ok) {
    throw extensionError("PI_VERIFY_FAILED", verified.diagnostics.errors.map((error: any) => error.code).join(", "));
  }
  const outputRoot = path.join(ctx.cwd, ".pi", "better-harness");
  await access(path.dirname(outputRoot), fsConstants.W_OK).catch(async () => {
    await access(ctx.cwd, fsConstants.W_OK).catch(() => {
      throw extensionError("PI_OUTPUT_UNWRITABLE", `Pi report output parent is not writable: ${ctx.cwd}`);
    });
  });
  const message = leadMessage({ plan: prepared.plan, verified, request: parsed.request, outputRoot, model });
  if (dependencies.sendMessage) {
    await dependencies.sendMessage(message);
  } else {
    // Custom messages participate in the next lead turn without exposing the
    // private lane manifest as a durable run file.
    ctx.ui.notify("Better Harness: three isolated lanes verified; starting reconciliation.", "info");
    (dependencies.pi ?? null)?.sendMessage?.({
      customType: "better-harness.reconciliation",
      content: message,
      display: true,
      details: { runId: prepared.plan.runId, laneCount: verified.results.length },
    }, { triggerTurn: true, deliverAs: "followUp" });
  }
  return { runId: prepared.plan.runId, verified, outputRoot };
}

export default function activate(pi: ExtensionAPI): void {
  pi.registerCommand(PI_COMMAND_NAME, {
    description: "Run three isolated Better Harness evidence reviews and reconcile one report",
    handler: async (args, ctx) => {
      try {
        await executeBetterHarness(ctx, args, { pi });
      } catch (error: any) {
        ctx.ui.notify(`Better Harness failed: ${error.message}`, "error");
      }
    },
  });
}
