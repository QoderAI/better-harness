import { isAbsolute, relative, resolve } from "node:path";
import type {
  QoderToolPermissionCallback,
  QoderToolPermissionResult,
} from "../exec/qoder-sdk.js";

export interface ToolPermissionDecision {
  toolName: string;
  behavior: "allow" | "deny";
  reason: string;
}

const FILE_TOOLS = new Set(["Read", "Edit", "Write", "Glob", "Grep"]);
const MUTATING_FILE_TOOLS = new Set(["Edit", "Write"]);
const SAFE_COMMANDS = new Set([
  "npm test",
  "npm run test",
  "npm run build",
  "npm run example",
  "node --test",
  "node --version",
  "node examples/basic.mjs",
  "node ./examples/basic.mjs",
  "git diff --check",
  "git status --short",
  "git --no-pager status --short",
]);
const SHELL_META = /[\n\r;&|`$<>]/;

export function createBoundedQoderPermissionCallback(
  trialRoot: string,
  decisions: ToolPermissionDecision[],
  writablePaths: string[],
): QoderToolPermissionCallback {
  const root = resolve(trialRoot);
  return async (toolName, input): Promise<QoderToolPermissionResult> => {
    const decision = decideToolUse(root, new Set(writablePaths.map((path) => portable(path))), toolName, input);
    decisions.push({ toolName, behavior: decision.behavior, reason: decision.reason });
    return decision.behavior === "allow"
      ? { behavior: "allow" }
      : { behavior: "deny", message: decision.reason };
  };
}

function decideToolUse(
  root: string,
  writablePaths: Set<string>,
  toolName: string,
  input: Record<string, unknown>,
): { behavior: "allow" | "deny"; reason: string } {
  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? normalizeWhitespace(input.command) : "";
    if (!command || SHELL_META.test(command) || !SAFE_COMMANDS.has(command)) {
      return { behavior: "deny", reason: "Command is outside the frozen validation allowlist." };
    }
    return { behavior: "allow", reason: `Allowed validation command: ${command}` };
  }
  if (!FILE_TOOLS.has(toolName)) {
    return { behavior: "deny", reason: `Tool '${toolName}' is not part of the coding benchmark policy.` };
  }
  const pathValue = firstString(input, ["file_path", "path", "directory"]);
  if (pathValue === undefined) {
    if (MUTATING_FILE_TOOLS.has(toolName) || toolName === "Read") {
      return { behavior: "deny", reason: `Tool '${toolName}' did not provide a file path.` };
    }
    return { behavior: "allow", reason: `Tool '${toolName}' defaults to the isolated trial root.` };
  }
  const candidate = isAbsolute(pathValue) ? resolve(pathValue) : resolve(root, pathValue);
  const fromRoot = relative(root, candidate);
  if (fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot))) {
    const ownedPath = portable(fromRoot || ".");
    if (ownedPath === ".git" || ownedPath.startsWith(".git/")) {
      return { behavior: "deny", reason: "Git metadata is not part of the task write surface." };
    }
    if (MUTATING_FILE_TOOLS.has(toolName) && !writablePaths.has(ownedPath)) {
      return { behavior: "deny", reason: `Task does not authorize writing '${ownedPath}'.` };
    }
    return { behavior: "allow", reason: `Path is inside the isolated trial root: ${ownedPath}` };
  }
  return { behavior: "deny", reason: `Path escapes the isolated trial root: ${portable(pathValue)}` };
}

function firstString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof input[key] === "string") return input[key];
  }
  return undefined;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function portable(value: string): string {
  return value.replaceAll("\\", "/");
}
