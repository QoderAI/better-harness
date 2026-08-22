import { lstat } from "node:fs/promises";
import path from "node:path";

export const name = "better-harness-explicit-only";
export const inject = ["skills", "tools"];

export const DSH_NATIVE_VERSION = "0.1.1-rc.2";
export const DSH_NATIVE_SOURCE_SHA = "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e";

const SKILL_NAME = "better-harness";
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;
const REQUIRED_PATHS = [
  { key: "root", relative: ".", kind: "directory" },
  { key: "skillsRoot", relative: "skills", kind: "directory" },
  { key: "skillDirectory", relative: "skills/better-harness", kind: "directory" },
  { key: "skillFile", relative: "skills/better-harness/SKILL.md", kind: "file" },
  { key: "cli", relative: "scripts/better-harness.mjs", kind: "file" },
  { key: "references", relative: "references", kind: "directory" },
  { key: "models", relative: "models", kind: "directory" },
  { key: "templates", relative: "templates", kind: "directory" },
];

export function resolveCanonicalPaths(betterHarnessRoot, { pathApi = path } = {}) {
  if (typeof betterHarnessRoot !== "string" || betterHarnessRoot.length === 0) {
    throw new TypeError("betterHarnessRoot must be a non-empty absolute path");
  }
  if (betterHarnessRoot === "~" || betterHarnessRoot.startsWith("~/") || betterHarnessRoot.startsWith("~\\")) {
    throw new Error("betterHarnessRoot must be absolute; DSH does not expand a literal tilde");
  }
  if (!pathApi.isAbsolute(betterHarnessRoot)) {
    throw new Error("betterHarnessRoot must be an absolute path");
  }

  const root = pathApi.resolve(betterHarnessRoot);
  const skillsRoot = pathApi.join(root, "skills");
  const skillDirectory = pathApi.join(skillsRoot, SKILL_NAME);
  return {
    root,
    skillsRoot,
    skillDirectory,
    skillFile: pathApi.join(skillDirectory, "SKILL.md"),
    cli: pathApi.join(root, "scripts", "better-harness.mjs"),
    resourceDirectories: ["references", "models", "templates"].map((entry) => pathApi.join(root, entry)),
    references: pathApi.join(root, "references"),
    models: pathApi.join(root, "models"),
    templates: pathApi.join(root, "templates"),
  };
}

export async function inspectLocalPath(target) {
  try {
    const info = await lstat(target);
    return {
      kind: info.isFile() ? "file" : info.isDirectory() ? "directory" : "other",
      symbolicLink: info.isSymbolicLink(),
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return undefined;
    throw error;
  }
}

export async function verifyCanonicalSkill({
  betterHarnessRoot,
  skill,
  inspectPath = inspectLocalPath,
  pathApi = path,
}) {
  const paths = resolveCanonicalPaths(betterHarnessRoot, { pathApi });
  const reasons = [];

  if (skill === undefined) {
    return { verified: false, reasons: ["skill-not-discovered"], paths };
  }
  if (skill.source !== "custom") reasons.push("winner-source-mismatch");
  if (skill.path !== paths.skillFile) reasons.push("winner-path-mismatch");
  if (skill.resourceBase?.kind !== "directory" || skill.resourceBase.path !== paths.skillDirectory) {
    reasons.push("resource-base-mismatch");
  }
  const discoveredRoot = skill.resourceBase?.kind === "directory"
    ? pathApi.dirname(pathApi.dirname(skill.resourceBase.path))
    : undefined;
  if (discoveredRoot !== paths.root) reasons.push("root-invariant-mismatch");
  if (skill.invocation?.userInvocable !== true) reasons.push("user-invocation-disabled");

  for (const required of REQUIRED_PATHS) {
    const target = paths[required.key];
    const info = await inspectPath(target);
    if (info === undefined || info.kind !== required.kind) {
      reasons.push(`required-resource-missing:${required.relative}`);
    } else if (info.symbolicLink) {
      reasons.push(`symbolic-link-not-supported:${required.relative}`);
    }
  }

  return { verified: reasons.length === 0, reasons, paths };
}

export function guardBetterHarnessModelInvocation(execution) {
  if (execution?.name !== "skill") return undefined;
  if (typeof execution.arguments !== "object" || execution.arguments === null) return undefined;
  if (execution.arguments.name !== SKILL_NAME) return undefined;
  return "Better Harness requires explicit /better-harness invocation by a user.";
}

export function containsExplicitBetterHarnessGesture(messages) {
  for (const message of messages ?? []) {
    if (message?.source?.kind !== "user") continue;
    for (const block of message.content ?? []) {
      if (block?.type !== "text") continue;
      for (const match of block.text.matchAll(SKILL_GESTURE)) {
        if (match[2] === SKILL_NAME) return true;
      }
    }
  }
  return false;
}

export function createPlugin(inspectPath = inspectLocalPath) {
  return function register(ctx, config = {}) {
    const paths = resolveCanonicalPaths(config.betterHarnessRoot);
    ctx.tools.guard(guardBetterHarnessModelInvocation);
    ctx.on("agent/pre-step", async ({ agent, messages, signal }, next) => {
      if (!containsExplicitBetterHarnessGesture(messages)) return next();
      signal.throwIfAborted();
      const skill = await ctx.skills.get(SKILL_NAME, {
        cwd: agent.session.header.cwd,
        signal,
        scope: agent,
      });
      signal.throwIfAborted();
      const verification = await verifyCanonicalSkill({
        betterHarnessRoot: paths.root,
        skill,
        inspectPath,
      });
      if (!verification.verified) {
        throw new Error(`Better Harness DSH verification failed: ${verification.reasons.join(", ")}`);
      }
      return next();
    });
  };
}

export const apply = createPlugin();

export default { name, inject, apply };
