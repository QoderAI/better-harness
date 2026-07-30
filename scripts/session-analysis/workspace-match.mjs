import path from "node:path";

export const WORKSPACE_TOPOLOGY_KIND = "better-harness.workspace-topology";
export const WORKSPACE_TOPOLOGY_SCHEMA_VERSION = 1;
export const SESSION_WORKSPACE_SCOPE_KIND = "better-harness.session-workspace-scope";

export const WORKSPACE_CWD_MATCH = Object.freeze({
  DIRECT: "direct-cwd",
  ROOT_CANDIDATE: "root-cwd-candidate",
  UNMATCHED: "unmatched",
});

export const WORKSPACE_SESSION_MATCH = Object.freeze({
  DIRECT_CWD: "direct-cwd",
  ROOT_CWD: "root-cwd",
});

export const WORKSPACE_PATH_CLASS = Object.freeze({
  TARGET: "target",
  GIT_OTHER: "git-other",
  OUTSIDE_GIT: "outside-git",
  UNRESOLVED: "unresolved",
});

export const WORKSPACE_QUALIFICATION_STATUS = Object.freeze({
  DIRECT: "direct",
  TARGET_ONLY: "target-only",
  MIXED: "mixed",
  NO_TARGET: "no-target",
  AMBIGUOUS: "ambiguous",
  TRUNCATED: "truncated",
  UNMATCHED_CWD: "unmatched-cwd",
});

const TARGET_KINDS = new Set(["repo-root", "workspace-member", "repo-subtree", "standalone"]);
const MEMBER_MATCHES = new Set(["exact", "descendant", "none"]);
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/u;

function invalidTopology(message) {
  throw Object.assign(new TypeError(message), { code: "INVALID_WORKSPACE_TOPOLOGY" });
}

function invalidScope() {
  throw Object.assign(new TypeError("a validated session workspace scope is required"), {
    code: "INVALID_SESSION_WORKSPACE_SCOPE",
  });
}

function pathFlavor(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return null;
  if (WINDOWS_ABSOLUTE.test(value)) return "win32";
  if (path.posix.isAbsolute(value)) return "posix";
  return null;
}

function pathApi(flavor) {
  return flavor === "win32" ? path.win32 : path.posix;
}

function normalizePath(value, flavor) {
  const api = pathApi(flavor);
  const normalized = api.normalize(value);
  const root = api.parse(normalized).root;
  if (normalized === root) return normalized;
  return normalized.replace(flavor === "win32" ? /[\\/]+$/u : /\/+$/u, "");
}

function comparable(value, flavor) {
  const normalized = normalizePath(value, flavor);
  return flavor === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left, right, flavor) {
  return comparable(left, flavor) === comparable(right, flavor);
}

function isContainedPath(root, candidate, flavor) {
  const api = pathApi(flavor);
  const relative = api.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative));
}

function normalizeAbsolute(value, expectedFlavor, field) {
  const flavor = pathFlavor(value);
  if (!flavor) invalidTopology(`${field} must be an absolute path`);
  if (expectedFlavor && flavor !== expectedFlavor) {
    invalidTopology(`${field} must use the same path convention as requestedWorkspace`);
  }
  return { value: normalizePath(value, flavor), flavor };
}

function normalizeRoute(value, field) {
  if (value === ".") return value;
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\")) {
    invalidTopology(`${field} must be a canonical Git-root-relative POSIX route`);
  }
  if (path.posix.isAbsolute(value)) {
    invalidTopology(`${field} must be relative to the Git root`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    invalidTopology(`${field} must not contain empty, current, or parent segments`);
  }
  if (path.posix.normalize(value) !== value) {
    invalidTopology(`${field} must be normalized`);
  }
  return value;
}

function routeContains(parent, child) {
  return parent === child || child.startsWith(`${parent}/`);
}

function expectedWorkspace(gitRoot, route, flavor) {
  if (route === ".") return gitRoot;
  return pathApi(flavor).join(gitRoot, ...route.split("/"));
}

/**
 * Validate the topology fields needed by session attribution and return a
 * normalized internal scope. The topology capability remains the owner of the
 * complete public topology contract.
 */
export function validateWorkspaceMatchTopology(topology) {
  if (!topology || typeof topology !== "object" || Array.isArray(topology)) {
    invalidTopology("workspace topology must be an object");
  }
  if (topology.kind !== WORKSPACE_TOPOLOGY_KIND) {
    invalidTopology(`workspace topology kind must be ${WORKSPACE_TOPOLOGY_KIND}`);
  }
  if (topology.schemaVersion !== WORKSPACE_TOPOLOGY_SCHEMA_VERSION) {
    invalidTopology(`workspace topology schemaVersion must be ${WORKSPACE_TOPOLOGY_SCHEMA_VERSION}`);
  }

  const requested = normalizeAbsolute(topology.requestedWorkspace, null, "requestedWorkspace");
  const target = topology.target;
  if (!target || typeof target !== "object" || Array.isArray(target) || !TARGET_KINDS.has(target.kind)) {
    invalidTopology("target.kind must be repo-root, workspace-member, repo-subtree, or standalone");
  }
  const route = normalizeRoute(target.route, "target.route");
  const memberRoute = target.memberRoute === null
    ? null
    : normalizeRoute(target.memberRoute, "target.memberRoute");
  if (!MEMBER_MATCHES.has(target.memberMatch)) {
    invalidTopology("target.memberMatch must be exact, descendant, or none");
  }

  let gitRoot = null;
  if (target.kind === "standalone") {
    if (topology.gitRoot !== null) invalidTopology("standalone topology must have a null gitRoot");
    if (route !== "." || memberRoute !== null || target.memberMatch !== "none") {
      invalidTopology("standalone target must use route '.', null memberRoute, and memberMatch none");
    }
  } else {
    const normalizedRoot = normalizeAbsolute(topology.gitRoot, requested.flavor, "gitRoot");
    gitRoot = normalizedRoot.value;
    if (!isContainedPath(gitRoot, requested.value, requested.flavor)) {
      invalidTopology("requestedWorkspace must be contained by gitRoot");
    }
    if (!samePath(expectedWorkspace(gitRoot, route, requested.flavor), requested.value, requested.flavor)) {
      invalidTopology("target.route must resolve to requestedWorkspace");
    }
  }

  if (target.kind === "repo-root") {
    if (route !== "." || memberRoute !== null || target.memberMatch !== "none") {
      invalidTopology("repo-root target must use route '.', null memberRoute, and memberMatch none");
    }
  } else if (target.kind === "workspace-member") {
    if (route === "." || memberRoute === null || !new Set(["exact", "descendant"]).has(target.memberMatch)) {
      invalidTopology("workspace-member target requires a member route and exact or descendant memberMatch");
    }
    if (!routeContains(memberRoute, route)) {
      invalidTopology("target.memberRoute must contain target.route");
    }
    if (target.memberMatch === "exact" && memberRoute !== route) {
      invalidTopology("exact memberMatch requires target.memberRoute to equal target.route");
    }
    if (target.memberMatch === "descendant" && memberRoute === route) {
      invalidTopology("descendant memberMatch requires target.route below target.memberRoute");
    }
  } else if (target.kind === "repo-subtree") {
    if (route === "." || memberRoute !== null || target.memberMatch !== "none") {
      invalidTopology("repo-subtree target requires a non-root route and no member match");
    }
  }

  return Object.freeze({
    kind: SESSION_WORKSPACE_SCOPE_KIND,
    requestedWorkspace: requested.value,
    gitRoot,
    pathFlavor: requested.flavor,
    target: Object.freeze({
      kind: target.kind,
      route,
      memberRoute,
      memberMatch: target.memberMatch,
    }),
  });
}

function requireScope(scope) {
  if (!scope || scope.kind !== SESSION_WORKSPACE_SCOPE_KIND) invalidScope();
  return scope;
}

function normalizeCandidateAbsolute(value, scope) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return null;
  if (pathFlavor(value) !== scope.pathFlavor) return null;
  return normalizePath(value, scope.pathFlavor);
}

export function classifyWorkspaceCwd(candidate, inputScope) {
  const scope = requireScope(inputScope);
  const normalized = normalizeCandidateAbsolute(candidate, scope);
  if (!normalized) return WORKSPACE_CWD_MATCH.UNMATCHED;
  if (isContainedPath(scope.requestedWorkspace, normalized, scope.pathFlavor)) {
    return WORKSPACE_CWD_MATCH.DIRECT;
  }
  if (scope.target.kind === "workspace-member"
    && scope.gitRoot
    && samePath(scope.gitRoot, normalized, scope.pathFlavor)) {
    return WORKSPACE_CWD_MATCH.ROOT_CANDIDATE;
  }
  return WORKSPACE_CWD_MATCH.UNMATCHED;
}

function resolvePathFact(fact, scope, sessionCwd) {
  const objectFact = fact && typeof fact === "object" && !Array.isArray(fact) ? fact : null;
  const rawPath = typeof fact === "string" ? fact : objectFact?.path ?? objectFact?.filePath;
  if (typeof rawPath !== "string"
    || rawPath.length === 0
    || rawPath.includes("\0")
    || rawPath === "~"
    || rawPath.startsWith("~/")
    || rawPath.startsWith("~\\")) {
    return null;
  }

  const absoluteFlavor = pathFlavor(rawPath);
  if (absoluteFlavor) {
    return absoluteFlavor === scope.pathFlavor ? normalizePath(rawPath, scope.pathFlavor) : null;
  }

  const rawBase = objectFact && Object.hasOwn(objectFact, "cwd") ? objectFact.cwd : sessionCwd;
  const base = normalizeCandidateAbsolute(rawBase, scope);
  if (!base) return null;
  return normalizePath(pathApi(scope.pathFlavor).resolve(base, rawPath), scope.pathFlavor);
}

/**
 * Classify one trusted event path fact. This function never reads prose or the
 * filesystem and returns only a privacy-safe category.
 */
export function classifyWorkspacePathFact(fact, inputScope, options = {}) {
  const scope = requireScope(inputScope);
  const absolute = resolvePathFact(fact, scope, options.cwd);
  if (!absolute) return WORKSPACE_PATH_CLASS.UNRESOLVED;
  if (isContainedPath(scope.requestedWorkspace, absolute, scope.pathFlavor)) {
    return WORKSPACE_PATH_CLASS.TARGET;
  }
  if (scope.gitRoot && isContainedPath(scope.gitRoot, absolute, scope.pathFlavor)) {
    return WORKSPACE_PATH_CLASS.GIT_OTHER;
  }
  return WORKSPACE_PATH_CLASS.OUTSIDE_GIT;
}

function emptyPathDiagnostics() {
  return { observed: 0, target: 0, foreign: 0, unresolved: 0 };
}

function result({ qualified, status, workspaceMatch, cwdMatch, pathFacts, truncated, basis }) {
  return Object.freeze({
    qualified,
    status,
    workspaceMatch,
    diagnostics: Object.freeze({
      basis,
      cwdMatch,
      pathFacts: Object.freeze({ ...pathFacts }),
      truncated,
    }),
  });
}

/**
 * Qualify a discovered session for one workspace. Direct-CWD sessions retain
 * current behavior. Root-CWD candidates require positive, target-only trusted
 * path facts and fail closed on ambiguity or truncation.
 */
export function qualifyWorkspaceSession({ cwd, pathFacts = [], truncated = false } = {}, inputScope) {
  const scope = requireScope(inputScope);
  if (!Array.isArray(pathFacts)) {
    throw Object.assign(new TypeError("pathFacts must be an array"), { code: "INVALID_SESSION_PATH_FACTS" });
  }
  if (typeof truncated !== "boolean") {
    throw Object.assign(new TypeError("truncated must be a boolean"), { code: "INVALID_SESSION_PATH_FACTS" });
  }

  const cwdMatch = classifyWorkspaceCwd(cwd, scope);
  if (cwdMatch === WORKSPACE_CWD_MATCH.DIRECT) {
    return result({
      qualified: true,
      status: WORKSPACE_QUALIFICATION_STATUS.DIRECT,
      workspaceMatch: WORKSPACE_SESSION_MATCH.DIRECT_CWD,
      cwdMatch,
      pathFacts: emptyPathDiagnostics(),
      truncated: false,
      basis: "cwd",
    });
  }
  if (cwdMatch === WORKSPACE_CWD_MATCH.UNMATCHED) {
    return result({
      qualified: false,
      status: WORKSPACE_QUALIFICATION_STATUS.UNMATCHED_CWD,
      workspaceMatch: null,
      cwdMatch,
      pathFacts: emptyPathDiagnostics(),
      truncated: false,
      basis: "cwd",
    });
  }

  const counts = emptyPathDiagnostics();
  for (const fact of pathFacts) {
    counts.observed += 1;
    const classification = classifyWorkspacePathFact(fact, scope, { cwd });
    if (classification === WORKSPACE_PATH_CLASS.TARGET) counts.target += 1;
    else if (classification === WORKSPACE_PATH_CLASS.UNRESOLVED) counts.unresolved += 1;
    else counts.foreign += 1;
  }

  const common = {
    workspaceMatch: null,
    cwdMatch,
    pathFacts: counts,
    truncated,
    basis: "cwd-and-trusted-path-facts",
  };
  if (truncated) {
    return result({ ...common, qualified: false, status: WORKSPACE_QUALIFICATION_STATUS.TRUNCATED });
  }
  if (counts.unresolved > 0) {
    return result({ ...common, qualified: false, status: WORKSPACE_QUALIFICATION_STATUS.AMBIGUOUS });
  }
  if (counts.target > 0 && counts.foreign > 0) {
    return result({ ...common, qualified: false, status: WORKSPACE_QUALIFICATION_STATUS.MIXED });
  }
  if (counts.target === 0) {
    return result({ ...common, qualified: false, status: WORKSPACE_QUALIFICATION_STATUS.NO_TARGET });
  }
  return result({
    ...common,
    qualified: true,
    status: WORKSPACE_QUALIFICATION_STATUS.TARGET_ONLY,
    workspaceMatch: WORKSPACE_SESSION_MATCH.ROOT_CWD,
  });
}

/** Aggregate qualifications without retaining paths, CWDs, or session ids. */
export function summarizeWorkspaceQualifications(qualifications = []) {
  if (!Array.isArray(qualifications)) {
    throw Object.assign(new TypeError("qualifications must be an array"), {
      code: "INVALID_SESSION_WORKSPACE_QUALIFICATIONS",
    });
  }
  const summary = {
    basis: "workspace-match-aggregate",
    sessions: qualifications.length,
    qualified: { directCwd: 0, rootCwd: 0 },
    omitted: {
      unmatchedCwd: 0,
      noTargetActivity: 0,
      mixedActivity: 0,
      ambiguousActivity: 0,
      truncatedPreflight: 0,
    },
  };
  for (const qualification of qualifications) {
    if (qualification?.workspaceMatch === WORKSPACE_SESSION_MATCH.DIRECT_CWD && qualification?.qualified) {
      summary.qualified.directCwd += 1;
    } else if (qualification?.workspaceMatch === WORKSPACE_SESSION_MATCH.ROOT_CWD
      && qualification?.qualified) {
      summary.qualified.rootCwd += 1;
    } else if (qualification?.status === WORKSPACE_QUALIFICATION_STATUS.UNMATCHED_CWD) {
      summary.omitted.unmatchedCwd += 1;
    } else if (qualification?.status === WORKSPACE_QUALIFICATION_STATUS.NO_TARGET) {
      summary.omitted.noTargetActivity += 1;
    } else if (qualification?.status === WORKSPACE_QUALIFICATION_STATUS.MIXED) {
      summary.omitted.mixedActivity += 1;
    } else if (qualification?.status === WORKSPACE_QUALIFICATION_STATUS.AMBIGUOUS) {
      summary.omitted.ambiguousActivity += 1;
    } else if (qualification?.status === WORKSPACE_QUALIFICATION_STATUS.TRUNCATED) {
      summary.omitted.truncatedPreflight += 1;
    }
  }
  return summary;
}
