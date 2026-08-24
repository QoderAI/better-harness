import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  SESSION_EXECUTION_CONSTRAINTS,
  SESSION_EXECUTION_PLAN_VERSION,
  SESSION_EXECUTION_RECEIPT_VERSION,
  SessionExecutorError,
  sessionExecutorErrorCode,
  sessionExecutorErrorMessage,
  type PiCheckpointInspection,
  type SessionContinuationRunner,
  type SessionContinuationRunnerResult,
  type SessionExecutionPlan,
  type SessionExecutionReceipt,
} from "./contracts.js";
import { runPiContinuation } from "./pi-runner.js";

const PROVIDER = "pi" as const;
const PLAN_ID_PREFIX = "sep_";
const EXECUTION_REF_ROOT = "refs/better-harness/session-executions";
const MAX_PROCESS_OUTPUT_BYTES = 16 * 1024 * 1024;

interface GitFacts {
  repoRoot: string;
  gitCommonDir: string;
  commit: string;
  tree: string;
}

interface ProcessResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface CreatePlanOptions {
  workspace: string;
  base: string;
  sessionFile: string;
  entryId: string;
  prompt: string;
  commitMessage: string;
  now?: () => Date;
}

interface ExecutePlanOptions {
  runner?: SessionContinuationRunner;
  now?: () => Date;
}

type JsonObject = Record<string, unknown>;

function fail(code: string, message: string, options: ErrorOptions = {}): never {
  throw new SessionExecutorError(code, message, options);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    fail("INVALID_INPUT", `${field} must be a non-empty string`);
  }
  return value;
}

function requireToken(value: unknown, field: string): string {
  const token = requireNonEmptyString(value, field);
  if (/\s/u.test(token)) fail("INVALID_INPUT", `${field} must not contain whitespace`);
  return token;
}

function requireCommitMessage(value: unknown): string {
  const message = requireNonEmptyString(value, "commitMessage").trim();
  if (/^(Harness-Session|Harness-Checkpoint|Harness-Execution-Plan):/imu.test(message)) {
    fail("RESERVED_TRAILER", "commitMessage must not define session executor provenance trailers");
  }
  return message;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const object = value as JsonObject;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonicalize(object[key])]),
    );
  }
  return value;
}

export function canonicalSessionExecutionJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sessionExecutionSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    input?: string;
    allowedExitCodes?: number[];
    env?: NodeJS.ProcessEnv;
  },
): ProcessResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
  });
  if (result.error) {
    throw new SessionExecutorError("PROCESS_START_FAILED", `Could not start ${command}`, {
      cause: result.error,
    });
  }
  const status = result.status ?? 1;
  const stderr = result.stderr ?? "";
  if (result.signal || !(options.allowedExitCodes ?? [0]).includes(status)) {
    const detail = stderr.trim();
    const suffix = detail ? `: ${detail}` : "";
    throw new SessionExecutorError(
      "PROCESS_FAILED",
      `${command} ${args[0] ?? ""} exited with status ${result.signal ?? status}${suffix}`,
    );
  }
  return { status, stdout: result.stdout ?? "", stderr };
}

function git(cwd: string, args: string[], options: Omit<Parameters<typeof runProcess>[2], "cwd"> = {}): ProcessResult {
  return runProcess("git", args, { cwd, ...options });
}

async function resolveGitFacts(workspace: string, base: string): Promise<GitFacts> {
  requireNonEmptyString(workspace, "workspace");
  requireNonEmptyString(base, "base");
  if (base.startsWith("-")) fail("INVALID_INPUT", "base must not start with '-'");

  let requestedRoot: string;
  try {
    requestedRoot = await realpath(path.resolve(workspace));
  } catch (error) {
    fail("WORKSPACE_NOT_FOUND", "workspace does not exist", { cause: error });
  }
  const repoRoot = await realpath(git(requestedRoot, ["rev-parse", "--show-toplevel"]).stdout.trim());
  const commonValue = git(repoRoot, ["rev-parse", "--git-common-dir"]).stdout.trim();
  const gitCommonDir = await realpath(
    path.isAbsolute(commonValue) ? commonValue : path.resolve(repoRoot, commonValue),
  );
  const commit = git(repoRoot, ["rev-parse", "--verify", `${base}^{commit}`]).stdout.trim();
  const tree = git(repoRoot, ["rev-parse", "--verify", `${commit}^{tree}`]).stdout.trim();
  return { repoRoot, gitCommonDir, commit, tree };
}

function decodeUtf8(buffer: Buffer, field: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    fail("INVALID_UTF8", `${field} must be valid UTF-8`, { cause: error });
  }
}

function parseJsonLine(line: string, lineNumber: number): JsonObject {
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("INVALID_SESSION", `session JSONL line ${lineNumber} must contain an object`);
    }
    return value as JsonObject;
  } catch (error) {
    if (error instanceof SessionExecutorError) throw error;
    fail("INVALID_SESSION", `session JSONL line ${lineNumber} is not valid JSON`, { cause: error });
  }
}

export async function inspectPiCheckpoint(
  sessionFile: string,
  entryId: string,
): Promise<PiCheckpointInspection> {
  requireNonEmptyString(sessionFile, "sessionFile");
  requireToken(entryId, "entryId");
  let resolvedSessionFile: string;
  let bytes: Buffer;
  try {
    resolvedSessionFile = await realpath(path.resolve(sessionFile));
    bytes = await readFile(resolvedSessionFile);
  } catch (error) {
    fail("SESSION_NOT_FOUND", "session JSONL file could not be read", { cause: error });
  }
  const lines = decodeUtf8(bytes, "session JSONL")
    .split(/\r?\n/u)
    .map((text, index) => ({ text, number: index + 1 }))
    .filter(({ text }) => text.trim().length > 0);
  if (lines.length < 2) fail("INVALID_SESSION", "session JSONL must contain a header and at least one entry");

  const header = parseJsonLine(lines[0]!.text, lines[0]!.number);
  if (header.type !== "session") fail("INVALID_SESSION", "first session JSONL object must be a Pi session header");
  const sessionId = requireToken(header.id, "session header id");
  if (!Number.isInteger(header.version) || (header.version as number) < 1) {
    fail("INVALID_SESSION", "session header version must be a positive integer");
  }
  if (typeof header.cwd !== "string") fail("INVALID_SESSION", "session header cwd must be a string");

  const entries = lines.slice(1).map(({ text, number }) => parseJsonLine(text, number));
  const entriesById = new Map<string, JsonObject>();
  for (const entry of entries) {
    const id = requireToken(entry.id, "session entry id");
    if (entry.type === "session") fail("INVALID_SESSION", "session JSONL must contain exactly one header");
    if (entry.parentId !== null && typeof entry.parentId !== "string") {
      fail("INVALID_SESSION", `entry ${id} has an invalid parentId`);
    }
    if (entriesById.has(id)) fail("INVALID_SESSION", `duplicate session entry id: ${id}`);
    entriesById.set(id, entry);
  }

  const selected = entriesById.get(entryId);
  if (!selected) fail("CHECKPOINT_NOT_FOUND", `session entry was not found: ${entryId}`);
  const branch: JsonObject[] = [];
  const visited = new Set<string>();
  let current: JsonObject | undefined = selected;
  while (current) {
    const currentId = requireToken(current.id, "session entry id");
    if (visited.has(currentId)) fail("INVALID_SESSION", `session parent cycle reaches entry ${currentId}`);
    visited.add(currentId);
    branch.push(current);
    if (current.parentId === null) break;
    const parentId = requireToken(current.parentId, "session parent id");
    const parent = entriesById.get(parentId);
    if (!parent) fail("INVALID_SESSION", `session entry ${currentId} references missing parent ${parentId}`);
    current = parent;
  }
  branch.reverse();
  const branchEntryIds = branch.map((entry) => requireToken(entry.id, "session branch entry id"));

  return {
    file: resolvedSessionFile,
    sha256: sessionExecutionSha256(bytes),
    sessionId,
    version: header.version as number,
    sourceCwd: header.cwd,
    entryCount: entries.length,
    entryId,
    entryType: typeof selected.type === "string" ? selected.type : "unknown",
    branchEntryIds,
    branchDigest: sessionExecutionSha256(canonicalSessionExecutionJson(branchEntryIds)),
  };
}

function planIdentity(plan: SessionExecutionPlan): Omit<SessionExecutionPlan, "planId" | "output"> {
  return {
    schemaVersion: plan.schemaVersion,
    provider: plan.provider,
    createdAt: plan.createdAt,
    workspace: {
      root: plan.workspace.root,
      gitCommonDir: plan.workspace.gitCommonDir,
      baseCommit: plan.workspace.baseCommit,
      baseTree: plan.workspace.baseTree,
    },
    checkpoint: {
      sessionFile: plan.checkpoint.sessionFile,
      sessionSha256: plan.checkpoint.sessionSha256,
      sessionId: plan.checkpoint.sessionId,
      sessionVersion: plan.checkpoint.sessionVersion,
      sourceCwd: plan.checkpoint.sourceCwd,
      entryCount: plan.checkpoint.entryCount,
      entryId: plan.checkpoint.entryId,
      entryType: plan.checkpoint.entryType,
      branchEntryIds: plan.checkpoint.branchEntryIds,
      branchDigest: plan.checkpoint.branchDigest,
    },
    continuation: {
      prompt: plan.continuation.prompt,
      promptSha256: plan.continuation.promptSha256,
      commitMessage: plan.continuation.commitMessage,
    },
    constraints: plan.constraints,
  };
}

function planIdFor(identity: ReturnType<typeof planIdentity>): string {
  return `${PLAN_ID_PREFIX}${sessionExecutionSha256(canonicalSessionExecutionJson(identity))}`;
}

function outputFor(gitCommonDir: string, planId: string): SessionExecutionPlan["output"] {
  return {
    ref: `${EXECUTION_REF_ROOT}/${planId}`,
    artifactDir: path.join(gitCommonDir, "better-harness", "session-executions", planId),
  };
}

export async function createSessionExecutionPlan(options: CreatePlanOptions): Promise<SessionExecutionPlan> {
  const prompt = requireNonEmptyString(options.prompt, "prompt");
  const commitMessage = requireCommitMessage(options.commitMessage);
  const [gitFacts, checkpoint] = await Promise.all([
    resolveGitFacts(options.workspace, options.base),
    inspectPiCheckpoint(options.sessionFile, options.entryId),
  ]);
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const identity: ReturnType<typeof planIdentity> = {
    schemaVersion: SESSION_EXECUTION_PLAN_VERSION,
    provider: PROVIDER,
    createdAt,
    workspace: {
      root: gitFacts.repoRoot,
      gitCommonDir: gitFacts.gitCommonDir,
      baseCommit: gitFacts.commit,
      baseTree: gitFacts.tree,
    },
    checkpoint: {
      sessionFile: checkpoint.file,
      sessionSha256: checkpoint.sha256,
      sessionId: checkpoint.sessionId,
      sessionVersion: checkpoint.version,
      sourceCwd: checkpoint.sourceCwd,
      entryCount: checkpoint.entryCount,
      entryId: checkpoint.entryId,
      entryType: checkpoint.entryType,
      branchEntryIds: checkpoint.branchEntryIds,
      branchDigest: checkpoint.branchDigest,
    },
    continuation: {
      prompt,
      promptSha256: sessionExecutionSha256(prompt),
      commitMessage,
    },
    constraints: SESSION_EXECUTION_CONSTRAINTS,
  };
  const planId = planIdFor(identity);
  return {
    ...identity,
    planId,
    output: outputFor(gitFacts.gitCommonDir, planId),
  };
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertPlanShape(value: unknown): asserts value is SessionExecutionPlan {
  if (!isObject(value)) fail("INVALID_PLAN", "plan must be a JSON object");
  if (value.schemaVersion !== SESSION_EXECUTION_PLAN_VERSION) {
    fail("UNSUPPORTED_PLAN", `unsupported plan schema: ${String(value.schemaVersion ?? "missing")}`);
  }
  if (value.provider !== PROVIDER) {
    fail("UNSUPPORTED_PROVIDER", `unsupported checkpoint provider: ${String(value.provider ?? "missing")}`);
  }
  if (!isObject(value.workspace) || !isObject(value.checkpoint) || !isObject(value.continuation)
    || !isObject(value.output) || !isObject(value.constraints)) {
    fail("INVALID_PLAN", "plan is missing a required section");
  }
  requireToken(value.planId, "planId");
  const createdAt = requireNonEmptyString(value.createdAt, "createdAt");
  if (!Number.isFinite(Date.parse(createdAt))) fail("INVALID_PLAN", "createdAt must be an ISO timestamp");
  requireNonEmptyString(value.workspace.root, "workspace.root");
  requireNonEmptyString(value.workspace.gitCommonDir, "workspace.gitCommonDir");
  requireToken(value.workspace.baseCommit, "workspace.baseCommit");
  requireToken(value.workspace.baseTree, "workspace.baseTree");
  requireNonEmptyString(value.checkpoint.sessionFile, "checkpoint.sessionFile");
  requireToken(value.checkpoint.sessionSha256, "checkpoint.sessionSha256");
  requireToken(value.checkpoint.sessionId, "checkpoint.sessionId");
  requireToken(value.checkpoint.entryId, "checkpoint.entryId");
  requireNonEmptyString(value.checkpoint.entryType, "checkpoint.entryType");
  if (!Number.isInteger(value.checkpoint.sessionVersion) || (value.checkpoint.sessionVersion as number) < 1) {
    fail("INVALID_PLAN", "checkpoint.sessionVersion must be a positive integer");
  }
  if (!Number.isInteger(value.checkpoint.entryCount) || (value.checkpoint.entryCount as number) < 1) {
    fail("INVALID_PLAN", "checkpoint.entryCount must be a positive integer");
  }
  if (!Array.isArray(value.checkpoint.branchEntryIds) || value.checkpoint.branchEntryIds.length === 0) {
    fail("INVALID_PLAN", "checkpoint.branchEntryIds must be a non-empty array");
  }
  for (const id of value.checkpoint.branchEntryIds) requireToken(id, "checkpoint branch entry id");
  requireToken(value.checkpoint.branchDigest, "checkpoint.branchDigest");
  requireNonEmptyString(value.continuation.prompt, "continuation.prompt");
  requireToken(value.continuation.promptSha256, "continuation.promptSha256");
  requireCommitMessage(value.continuation.commitMessage);
  requireNonEmptyString(value.output.ref, "output.ref");
  requireNonEmptyString(value.output.artifactDir, "output.artifactDir");
}

export function validateSessionExecutionPlanEnvelope(value: unknown): SessionExecutionPlan {
  assertPlanShape(value);
  if (sessionExecutionSha256(value.continuation.prompt) !== value.continuation.promptSha256) {
    fail("PLAN_TAMPERED", "continuation prompt digest does not match the plan");
  }
  if (sessionExecutionSha256(canonicalSessionExecutionJson(value.checkpoint.branchEntryIds))
    !== value.checkpoint.branchDigest) {
    fail("PLAN_TAMPERED", "checkpoint branch digest does not match the plan");
  }
  if (canonicalSessionExecutionJson(value.constraints)
    !== canonicalSessionExecutionJson(SESSION_EXECUTION_CONSTRAINTS)) {
    fail("UNSUPPORTED_PLAN", "plan requests unsupported execution constraints");
  }
  const expectedId = planIdFor(planIdentity(value));
  if (value.planId !== expectedId) fail("PLAN_TAMPERED", "planId does not match the plan contents");
  const expectedOutput = outputFor(value.workspace.gitCommonDir, value.planId);
  if (value.output.ref !== expectedOutput.ref
    || path.resolve(value.output.artifactDir) !== path.resolve(expectedOutput.artifactDir)) {
    fail("PLAN_TAMPERED", "plan output locations are not derived from the planId");
  }
  return value;
}

function compareCheckpoint(plan: SessionExecutionPlan, checkpoint: PiCheckpointInspection): void {
  const expected = plan.checkpoint;
  const comparisons: Array<[unknown, unknown, string]> = [
    [checkpoint.file, expected.sessionFile, "session file"],
    [checkpoint.sha256, expected.sessionSha256, "session digest"],
    [checkpoint.sessionId, expected.sessionId, "session id"],
    [checkpoint.version, expected.sessionVersion, "session version"],
    [checkpoint.entryCount, expected.entryCount, "session entry count"],
    [checkpoint.entryId, expected.entryId, "entry id"],
    [checkpoint.entryType, expected.entryType, "entry type"],
    [checkpoint.branchDigest, expected.branchDigest, "entry branch"],
  ];
  for (const [actual, wanted, label] of comparisons) {
    if (actual !== wanted) fail("CHECKPOINT_CHANGED", `${label} no longer matches the plan`);
  }
}

function assertRefAbsent(repoRoot: string, ref: string): void {
  const result = git(repoRoot, ["show-ref", "--verify", "--quiet", ref], { allowedExitCodes: [0, 1] });
  if (result.status === 0) fail("OUTPUT_EXISTS", `output ref already exists: ${ref}`);
}

export async function validateSessionExecutionPlan(
  plan: unknown,
  options: { allowExistingOutputRef?: boolean } = {},
): Promise<{
  plan: SessionExecutionPlan;
  gitFacts: GitFacts;
  checkpoint: PiCheckpointInspection;
}> {
  const validatedPlan = validateSessionExecutionPlanEnvelope(plan);
  const [gitFacts, checkpoint] = await Promise.all([
    resolveGitFacts(validatedPlan.workspace.root, validatedPlan.workspace.baseCommit),
    inspectPiCheckpoint(validatedPlan.checkpoint.sessionFile, validatedPlan.checkpoint.entryId),
  ]);
  if (gitFacts.repoRoot !== validatedPlan.workspace.root
    || gitFacts.gitCommonDir !== validatedPlan.workspace.gitCommonDir) {
    fail("WORKSPACE_CHANGED", "workspace root or Git common directory no longer matches the plan");
  }
  if (gitFacts.commit !== validatedPlan.workspace.baseCommit
    || gitFacts.tree !== validatedPlan.workspace.baseTree) {
    fail("BASE_CHANGED", "base commit or tree no longer matches the plan");
  }
  compareCheckpoint(validatedPlan, checkpoint);
  if (options.allowExistingOutputRef !== true) {
    assertRefAbsent(gitFacts.repoRoot, validatedPlan.output.ref);
  }
  return { plan: validatedPlan, gitFacts, checkpoint };
}

export async function writeSessionExecutionPlan(outputPath: string, plan: unknown): Promise<string> {
  const validatedPlan = validateSessionExecutionPlanEnvelope(plan);
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  try {
    await writeFile(resolved, `${JSON.stringify(validatedPlan, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (sessionExecutorErrorCode(error) === "EEXIST") {
      fail("OUTPUT_EXISTS", "plan output already exists", { cause: error });
    }
    throw error;
  }
  return resolved;
}

export async function readSessionExecutionPlan(planPath: string): Promise<SessionExecutionPlan> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path.resolve(planPath));
  } catch (error) {
    fail("PLAN_NOT_FOUND", "plan file could not be read", { cause: error });
  }
  let plan: unknown;
  try {
    plan = JSON.parse(decodeUtf8(bytes, "plan"));
  } catch (error) {
    if (error instanceof SessionExecutorError) throw error;
    fail("INVALID_PLAN", "plan file is not valid JSON", { cause: error });
  }
  return validateSessionExecutionPlanEnvelope(plan);
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

async function validateRunnerResult(
  value: unknown,
  artifactDir: string,
  plan: SessionExecutionPlan,
): Promise<SessionContinuationRunnerResult & { sessionFile: string; sessionSha256: string }> {
  if (!isObject(value)) fail("INVALID_RUNNER_RESULT", "continuation runner returned no result");
  const executionSessionId = requireToken(value.executionSessionId, "executionSessionId");
  const requestedSessionFile = requireNonEmptyString(value.sessionFile, "execution session file");
  let sessionFile: string;
  try {
    sessionFile = await realpath(requestedSessionFile);
  } catch (error) {
    fail("INVALID_RUNNER_RESULT", "continuation runner did not persist its session JSONL", { cause: error });
  }
  const artifactRoot = await realpath(artifactDir);
  if (!isInside(artifactRoot, sessionFile)) {
    fail("INVALID_RUNNER_RESULT", "continuation session must be stored in the execution artifact directory");
  }
  const continuedCheckpoint = await inspectPiCheckpoint(sessionFile, plan.checkpoint.entryId);
  if (continuedCheckpoint.sessionId !== executionSessionId) {
    fail("INVALID_RUNNER_RESULT", "execution session id does not match the continued Pi JSONL header");
  }
  let model: SessionContinuationRunnerResult["model"] = null;
  if (value.model !== undefined && value.model !== null) {
    if (!isObject(value.model)) fail("INVALID_RUNNER_RESULT", "runner model must be an object or null");
    model = {
      provider: requireToken(value.model.provider, "runner model provider"),
      id: requireToken(value.model.id, "runner model id"),
    };
  }
  const toolCalls: Array<{ id?: string; name: string }> = [];
  if (value.toolCalls !== undefined) {
    if (!Array.isArray(value.toolCalls)) fail("INVALID_RUNNER_RESULT", "runner toolCalls must be an array");
    for (const call of value.toolCalls) {
      if (!isObject(call)) fail("INVALID_RUNNER_RESULT", "runner tool call must be an object");
      const id = call.id === undefined ? undefined : requireToken(call.id, "runner tool call id");
      toolCalls.push({ ...(id ? { id } : {}), name: requireToken(call.name, "runner tool call name") });
    }
  }
  return {
    executionSessionId,
    sessionFile,
    sessionSha256: continuedCheckpoint.sha256,
    model,
    toolCalls,
    output: typeof value.output === "string" ? value.output : "",
  };
}

function changedPathsFrom(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

function commitMessageFor(plan: SessionExecutionPlan, executionSessionId: string): string {
  return [
    plan.continuation.commitMessage.trimEnd(),
    "",
    `Harness-Session: ${executionSessionId}`,
    `Harness-Checkpoint: ${plan.checkpoint.sessionId}:${plan.checkpoint.entryId}`,
    `Harness-Execution-Plan: ${plan.planId}`,
    "",
  ].join("\n");
}

async function removeTemporaryWorktree(options: {
  repoRoot: string;
  temporaryRoot: string;
  worktree: string;
  worktreeAdded: boolean;
}): Promise<string[]> {
  const warnings: string[] = [];
  if (options.worktreeAdded) {
    try {
      git(options.repoRoot, ["worktree", "remove", "--force", options.worktree]);
    } catch (error) {
      warnings.push(`temporary worktree cleanup failed at ${options.worktree}: ${sessionExecutorErrorMessage(error)}`);
      return warnings;
    }
  }
  try {
    await rm(options.temporaryRoot, { recursive: true, force: true });
  } catch (error) {
    warnings.push(`temporary directory cleanup failed at ${options.temporaryRoot}: ${sessionExecutorErrorMessage(error)}`);
  }
  return warnings;
}

export async function executeSessionExecutionPlan(
  inputPlan: unknown,
  options: ExecutePlanOptions = {},
): Promise<SessionExecutionReceipt> {
  const { plan, gitFacts } = await validateSessionExecutionPlan(inputPlan);
  const runner = options.runner ?? runPiContinuation;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const artifactDir = plan.output.artifactDir;
  let artifactCreated = false;
  let refCreated = false;
  let worktreeAdded = false;
  let temporaryRoot: string | undefined;
  let worktree: string | undefined;
  let preparedReceipt: SessionExecutionReceipt | undefined;
  let failure: unknown;

  try {
    await mkdir(path.dirname(artifactDir), { recursive: true });
    try {
      await mkdir(artifactDir);
      artifactCreated = true;
    } catch (error) {
      if (sessionExecutorErrorCode(error) === "EEXIST") {
        fail("OUTPUT_EXISTS", "execution artifact directory already exists", { cause: error });
      }
      throw error;
    }

    const frozenSessionFile = path.join(artifactDir, "source-session.jsonl");
    await copyFile(plan.checkpoint.sessionFile, frozenSessionFile, fsConstants.COPYFILE_EXCL);
    const frozenCheckpoint = await inspectPiCheckpoint(frozenSessionFile, plan.checkpoint.entryId);
    if (frozenCheckpoint.sha256 !== plan.checkpoint.sessionSha256) {
      fail("CHECKPOINT_CHANGED", "session changed while the execution snapshot was being created");
    }
    await writeJsonAtomically(path.join(artifactDir, "plan.json"), plan);

    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "better-harness-session-executor-"));
    worktree = path.join(temporaryRoot, "worktree");
    git(gitFacts.repoRoot, ["worktree", "add", "--detach", worktree, plan.workspace.baseCommit]);
    worktreeAdded = true;

    const runnerResult = await validateRunnerResult(await runner({
      plan,
      worktree,
      sourceSessionFile: frozenSessionFile,
      sessionDirectory: path.join(artifactDir, "sessions"),
      artifactDir,
    }), artifactDir, plan);

    const head = git(worktree, ["rev-parse", "HEAD"]).stdout.trim();
    if (head !== plan.workspace.baseCommit) {
      fail("BASE_MOVED", "continuation runner changed the isolated worktree HEAD");
    }
    assertRefAbsent(gitFacts.repoRoot, plan.output.ref);
    git(worktree, ["add", "--all", "--", "."]);
    const changedPaths = changedPathsFrom(git(worktree, [
      "diff",
      "--cached",
      "--name-only",
      "-z",
      plan.workspace.baseCommit,
      "--",
    ]).stdout);
    if (changedPaths.length === 0) fail("NO_CHANGES", "continuation produced no file changes");

    const resultTree = git(worktree, ["write-tree"]).stdout.trim();
    const resultCommit = git(worktree, [
      "commit-tree",
      resultTree,
      "-p",
      plan.workspace.baseCommit,
    ], { input: commitMessageFor(plan, runnerResult.executionSessionId) }).stdout.trim();

    preparedReceipt = {
      schemaVersion: SESSION_EXECUTION_RECEIPT_VERSION,
      status: "prepared",
      planId: plan.planId,
      provider: PROVIDER,
      startedAt,
      completedAt: null,
      workspace: {
        root: plan.workspace.root,
        baseCommit: plan.workspace.baseCommit,
        baseTree: plan.workspace.baseTree,
      },
      checkpoint: {
        sourceSessionFile: plan.checkpoint.sessionFile,
        frozenSessionFile,
        sourceSessionSha256: plan.checkpoint.sessionSha256,
        sourceSessionId: plan.checkpoint.sessionId,
        sourceSessionVersion: plan.checkpoint.sessionVersion,
        entryId: plan.checkpoint.entryId,
        entryType: plan.checkpoint.entryType,
        branchDigest: plan.checkpoint.branchDigest,
      },
      execution: {
        sessionId: runnerResult.executionSessionId,
        sessionFile: runnerResult.sessionFile,
        sessionSha256: runnerResult.sessionSha256,
        model: runnerResult.model ?? null,
        toolCalls: runnerResult.toolCalls ?? [],
        outputSha256: sessionExecutionSha256(runnerResult.output ?? ""),
      },
      result: {
        commit: resultCommit,
        tree: resultTree,
        parent: plan.workspace.baseCommit,
        ref: plan.output.ref,
        changedPaths,
      },
      constraints: plan.constraints,
      cleanup: { worktreeRemoved: false, warnings: [] },
    };
    await writeJsonAtomically(path.join(artifactDir, "receipt.json"), preparedReceipt);
    git(gitFacts.repoRoot, [
      "update-ref",
      plan.output.ref,
      resultCommit,
      "0".repeat(plan.workspace.baseCommit.length),
    ]);
    refCreated = true;
  } catch (error) {
    failure = error;
  }

  const cleanupWarnings = temporaryRoot && worktree
    ? await removeTemporaryWorktree({
      repoRoot: gitFacts.repoRoot,
      temporaryRoot,
      worktree,
      worktreeAdded,
    })
    : [];

  if (failure) {
    if (artifactCreated && !refCreated) {
      try {
        await rm(artifactDir, { recursive: true, force: true });
      } catch (error) {
        cleanupWarnings.push(`incomplete artifact cleanup failed at ${artifactDir}: ${sessionExecutorErrorMessage(error)}`);
      }
    }
    const executionError = failure instanceof SessionExecutorError
      ? failure
      : new SessionExecutorError("EXECUTION_FAILED", sessionExecutorErrorMessage(failure), { cause: failure });
    if (cleanupWarnings.length > 0) executionError.cleanupWarnings = cleanupWarnings;
    throw executionError;
  }

  if (!preparedReceipt || !refCreated) {
    fail("EXECUTION_INCOMPLETE", "execution ended without a prepared receipt and result ref");
  }
  const receipt: SessionExecutionReceipt = {
    ...preparedReceipt,
    status: "complete",
    completedAt: now().toISOString(),
    cleanup: {
      worktreeRemoved: cleanupWarnings.length === 0,
      warnings: cleanupWarnings,
    },
  };
  try {
    await writeJsonAtomically(path.join(artifactDir, "receipt.json"), receipt);
  } catch (error) {
    receipt.cleanup.warnings.push(`final receipt update failed: ${sessionExecutorErrorMessage(error)}`);
  }
  return receipt;
}
