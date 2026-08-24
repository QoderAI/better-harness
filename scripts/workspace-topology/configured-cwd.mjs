import { realpathSync, statSync } from "node:fs";
import path from "node:path";

function invalidConfiguredCwd(message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), {
    code: "INVALID_CONFIGURED_CWD",
  });
}

export function canonicalPath(value) {
  return realpathSync.native(path.resolve(value));
}

function canonicalDirectory(value, label, dependencies = {}) {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\u0000")) {
    throw invalidConfiguredCwd(`${label} must be a non-empty directory path`);
  }
  try {
    const canonicalizePath = dependencies.canonicalizePath ?? canonicalPath;
    const canonical = canonicalizePath(path.resolve(value));
    if (!statSync(canonical).isDirectory()) {
      throw invalidConfiguredCwd(`${label} must resolve to a directory`);
    }
    return canonical;
  } catch (error) {
    if (error?.code === "INVALID_CONFIGURED_CWD") throw error;
    throw invalidConfiguredCwd(`${label} must resolve to an existing directory`, error);
  }
}

export function pathIsContained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

export function resolveConfiguredCwd({ workspace, cwd } = {}, dependencies = {}) {
  const canonicalWorkspace = canonicalDirectory(workspace, "workspace", dependencies);
  const effectiveCwd = cwd === undefined ? workspace : cwd;
  const canonicalCwd = canonicalDirectory(effectiveCwd, "cwd", dependencies);
  if (!pathIsContained(canonicalWorkspace, canonicalCwd)) {
    throw Object.assign(new Error("cwd must resolve inside workspace"), {
      code: "CONFIGURED_CWD_OUTSIDE_WORKSPACE",
    });
  }
  return Object.freeze({
    workspace: canonicalWorkspace,
    cwd: canonicalCwd,
  });
}
