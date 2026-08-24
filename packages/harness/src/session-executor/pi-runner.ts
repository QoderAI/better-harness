import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import {
  SessionExecutorError,
  type SessionContinuationRunnerInput,
  type SessionContinuationRunnerResult,
} from "./contracts.js";

const PI_SDK_MODULE = "@earendil-works/pi-coding-agent";
const TOOL_NAMES = ["read", "ls", "edit", "write"] as const;

type PiSdkModule = typeof import("@earendil-works/pi-coding-agent");
type PiSessionManager = ReturnType<PiSdkModule["SessionManager"]["forkFrom"]>;

function pathIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function containmentError(message: string): SessionExecutorError {
  return new SessionExecutorError("PATH_OUTSIDE_WORKTREE", message);
}

/**
 * Reject lexical escapes, `.git` metadata, and symlink targets outside the
 * execution-owned worktree. This is a local POC boundary, not an OS sandbox
 * against a concurrent hostile process racing filesystem changes.
 */
export async function assertContainedSessionPath(
  worktree: string,
  candidate: string,
  options: { mustExist?: boolean } = {},
): Promise<string> {
  const lexicalRoot = path.resolve(worktree);
  const root = await realpath(lexicalRoot);
  const absolute = path.resolve(lexicalRoot, candidate);
  const containmentRoot = pathIsInside(lexicalRoot, absolute)
    ? lexicalRoot
    : pathIsInside(root, absolute)
      ? root
      : undefined;
  if (!containmentRoot) {
    throw containmentError("tool path resolves outside the isolated worktree");
  }
  const relative = path.relative(containmentRoot, absolute);
  if (relative.split(path.sep).some((segment) => segment.toLowerCase() === ".git")) {
    throw containmentError("tool access to Git metadata is not allowed");
  }

  try {
    await lstat(absolute);
    const resolved = await realpath(absolute);
    if (!pathIsInside(root, resolved)) {
      throw containmentError("tool path follows a symlink outside the isolated worktree");
    }
    return absolute;
  } catch (error) {
    if (error instanceof SessionExecutorError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (options.mustExist) throw error;
  }

  let ancestor = path.dirname(absolute);
  while (pathIsInside(root, ancestor)) {
    try {
      await lstat(ancestor);
      const resolvedAncestor = await realpath(ancestor);
      if (!pathIsInside(root, resolvedAncestor)) {
        throw containmentError("tool path has an ancestor outside the isolated worktree");
      }
      return absolute;
    } catch (error) {
      if (error instanceof SessionExecutorError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (ancestor === root) break;
    ancestor = path.dirname(ancestor);
  }
  throw containmentError("tool path has no contained existing ancestor");
}

export async function createContainedSessionTools(
  sdk: PiSdkModule,
  worktree: string,
): Promise<ToolDefinition[]> {
  const root = await realpath(worktree);
  const readable = async (absolutePath: string): Promise<string> => {
    const contained = await assertContainedSessionPath(root, absolutePath, { mustExist: true });
    await access(contained, fsConstants.R_OK);
    return contained;
  };

  const readDefinition = sdk.createReadToolDefinition(root, {
    operations: {
      async access(absolutePath) {
        await readable(absolutePath);
      },
      async readFile(absolutePath) {
        return readFile(await readable(absolutePath));
      },
    },
  });
  const lsDefinition = sdk.createLsToolDefinition(root, {
    operations: {
      async exists(absolutePath) {
        const contained = await assertContainedSessionPath(root, absolutePath);
        try {
          await access(contained, fsConstants.F_OK);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      },
      async stat(absolutePath) {
        return stat(await assertContainedSessionPath(root, absolutePath, { mustExist: true }));
      },
      async readdir(absolutePath) {
        return readdir(await assertContainedSessionPath(root, absolutePath, { mustExist: true }));
      },
    },
  });
  const editDefinition = sdk.createEditToolDefinition(root, {
    operations: {
      async access(absolutePath) {
        const contained = await assertContainedSessionPath(root, absolutePath, { mustExist: true });
        await access(contained, fsConstants.R_OK | fsConstants.W_OK);
      },
      async readFile(absolutePath) {
        return readFile(await readable(absolutePath));
      },
      async writeFile(absolutePath, content) {
        const contained = await assertContainedSessionPath(root, absolutePath, { mustExist: true });
        await writeFile(contained, content, "utf8");
      },
    },
  });
  const writeDefinition = sdk.createWriteToolDefinition(root, {
    operations: {
      async mkdir(directory) {
        const contained = await assertContainedSessionPath(root, directory);
        await mkdir(contained, { recursive: true });
        await assertContainedSessionPath(root, contained, { mustExist: true });
      },
      async writeFile(absolutePath, content) {
        const contained = await assertContainedSessionPath(root, absolutePath);
        await writeFile(contained, content, "utf8");
      },
    },
  });
  // Pi's heterogeneous ToolDefinition schemas are intentionally collected
  // behind its erased SDK registration boundary.
  return [readDefinition, lsDefinition, editDefinition, writeDefinition] as unknown as ToolDefinition[];
}

async function loadPiSdk(loader?: () => Promise<PiSdkModule>): Promise<PiSdkModule> {
  try {
    if (loader) return await loader();
    return await import(PI_SDK_MODULE);
  } catch (error) {
    throw new SessionExecutorError(
      "PI_SDK_UNAVAILABLE",
      `The session executor POC needs the optional peer dependency '${PI_SDK_MODULE}'`,
      { cause: error },
    );
  }
}

export async function preparePiCheckpointSession(options: {
  sourceSessionFile: string;
  entryId: string;
  worktree: string;
  sessionDirectory: string;
  loadSdk?: () => Promise<PiSdkModule>;
}): Promise<{ sdk: PiSdkModule; sessionManager: PiSessionManager }> {
  const sdk = await loadPiSdk(options.loadSdk);
  await mkdir(options.sessionDirectory, { recursive: true });
  let sessionManager: PiSessionManager;
  try {
    sessionManager = sdk.SessionManager.forkFrom(
      options.sourceSessionFile,
      options.worktree,
      options.sessionDirectory,
    );
    if (!sessionManager.getEntry(options.entryId)) {
      throw new Error(`Entry ${options.entryId} not found in the forked Pi session`);
    }
    sessionManager.branch(options.entryId);
  } catch (error) {
    throw new SessionExecutorError(
      "PI_CHECKPOINT_FORK_FAILED",
      "Pi could not fork the selected session checkpoint",
      { cause: error },
    );
  }
  return { sdk, sessionManager };
}

export async function runPiContinuation(
  input: SessionContinuationRunnerInput,
): Promise<SessionContinuationRunnerResult> {
  const { sdk, sessionManager } = await preparePiCheckpointSession({
    sourceSessionFile: input.sourceSessionFile,
    entryId: input.plan.checkpoint.entryId,
    worktree: input.worktree,
    sessionDirectory: input.sessionDirectory,
  });
  const settingsManager = sdk.SettingsManager.inMemory({
    defaultTools: [...TOOL_NAMES],
    defaultProjectTrust: "never",
    packages: [],
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
    enableSkillCommands: false,
  }, { projectTrusted: false });
  const agentDir = sdk.getAgentDir();
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd: input.worktree,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: false,
  });
  await resourceLoader.reload();
  const modelRuntime = await sdk.ModelRuntime.create({ allowModelNetwork: false });
  const customTools = await createContainedSessionTools(sdk, input.worktree);
  const created = await sdk.createAgentSession({
    cwd: input.worktree,
    agentDir,
    modelRuntime,
    settingsManager,
    resourceLoader,
    sessionManager,
    tools: [...TOOL_NAMES],
    excludeTools: ["bash", "grep", "find"],
    customTools,
  });
  const { session } = created;
  const activeTools = [...session.getActiveToolNames()].sort();
  const expectedTools = [...TOOL_NAMES].sort();
  if (JSON.stringify(activeTools) !== JSON.stringify(expectedTools)) {
    session.dispose();
    throw new SessionExecutorError(
      "PI_TOOL_BOUNDARY_FAILED",
      `Pi activated unexpected tools: ${activeTools.join(", ") || "none"}`,
    );
  }

  let output = "";
  let terminalError = "";
  let limitError: SessionExecutorError | undefined;
  const toolCalls: Array<{ id?: string; name: string }> = [];
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update"
      && event.assistantMessageEvent?.type === "text_delta"
      && typeof event.assistantMessageEvent.delta === "string") {
      output += event.assistantMessageEvent.delta;
    }
    if (event.type === "tool_execution_start") {
      toolCalls.push({ id: event.toolCallId, name: event.toolName });
      if (toolCalls.length > input.plan.constraints.maxToolCalls && !limitError) {
        limitError = new SessionExecutorError(
          "PI_TOOL_CALL_LIMIT",
          `Pi exceeded the ${input.plan.constraints.maxToolCalls} tool-call execution limit`,
        );
        void session.abort();
      }
    }
    if (event.type === "message_end"
      && event.message.role === "assistant"
      && (event.message.stopReason === "error" || event.message.stopReason === "aborted")) {
      terminalError = event.message.errorMessage ?? `Pi stopped with ${event.message.stopReason}`;
    }
  });
  const timeout = setTimeout(() => {
    if (!limitError) {
      limitError = new SessionExecutorError(
        "PI_EXECUTION_TIMEOUT",
        `Pi exceeded the ${input.plan.constraints.maxDurationMs}ms execution limit`,
      );
      void session.abort();
    }
  }, input.plan.constraints.maxDurationMs);

  try {
    await session.prompt(input.plan.continuation.prompt);
    await session.waitForIdle();
    if (limitError) throw limitError;
    if (terminalError) throw new SessionExecutorError("PI_CONTINUATION_FAILED", terminalError);
    if (!session.sessionFile) {
      throw new SessionExecutorError("PI_SESSION_NOT_PERSISTED", "Pi did not persist the continued session");
    }
    return {
      provider: "pi",
      executionSessionId: session.sessionId,
      sessionFile: session.sessionFile,
      model: session.model ? { provider: session.model.provider, id: session.model.id } : null,
      modelFallbackMessage: created.modelFallbackMessage ?? null,
      toolCalls,
      output,
    };
  } finally {
    clearTimeout(timeout);
    unsubscribe();
    session.dispose();
  }
}
