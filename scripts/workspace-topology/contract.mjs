import path from "node:path";

export const WORKSPACE_TOPOLOGY_KIND = "better-harness.workspace-topology";
export const WORKSPACE_TOPOLOGY_SCHEMA_VERSION = 1;

const TARGET_KINDS = new Set([
  "repo-root",
  "workspace-member",
  "repo-subtree",
  "standalone",
]);
const MEMBER_MATCHES = new Set(["exact", "descendant", "none"]);
const STATUS_VALUES = new Set(["complete", "partial"]);
const MEMBER_KINDS = new Set(["manifest", "convention"]);
const INSTRUCTION_PROVIDERS = new Set([
  "codex",
  "qoder",
  "claude",
  "cursor",
  "qwen",
  "copilot",
  "pi",
]);
const INSTRUCTION_ACTIVATIONS = new Set(["effective", "candidate"]);

function contractError(message, code = "INVALID_WORKSPACE_TOPOLOGY") {
  return Object.assign(new Error(message), { code });
}

function sameAbsolutePath(left, right) {
  const leftPath = path.resolve(String(left));
  const rightPath = path.resolve(String(right));
  return process.platform === "win32"
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

export function pathIdentityKey(value) {
  const text = String(value ?? "");
  return process.platform === "win32" ? text.toLowerCase() : text;
}

export function normalizeRoute(value, name = "route") {
  let route = String(value ?? "").replaceAll("\\", "/").trim();
  route = route.replace(/^\.\/+/u, "").replace(/\/+$/u, "");
  if (!route || route === ".") return ".";
  if (route.startsWith("/") || /^[A-Za-z]:\//u.test(route) || route.includes("\0")) {
    throw contractError(`${name} must be a relative route`);
  }
  const parts = route.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw contractError(`${name} must not escape its root`);
  }
  return parts.join("/") || ".";
}

export function routeContains(parentRoute, childRoute) {
  const parent = normalizeRoute(parentRoute, "parent route");
  const child = normalizeRoute(childRoute, "child route");
  return parent === "." || child === parent || child.startsWith(`${parent}/`);
}

export function relativeRoute(root, target, name = "target") {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === "") return ".";
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw contractError(`${name} must be contained by the topology root`, "WORKSPACE_OUTSIDE_TOPOLOGY_ROOT");
  }
  return normalizeRoute(relative, `${name} route`);
}

function countEnvelopeErrors(value, name) {
  const errors = [];
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) {
    return [`${name} must contain an items array`];
  }
  for (const field of ["total", "omitted"]) {
    if (!Number.isInteger(value[field]) || value[field] < 0) {
      errors.push(`${name}.${field} must be a non-negative integer`);
    }
  }
  if (typeof value.truncated !== "boolean") {
    errors.push(`${name}.truncated must be boolean`);
  }
  if (Number.isInteger(value.total) && value.total < value.items.length) {
    errors.push(`${name}.total must cover retained items`);
  }
  if (Number.isInteger(value.omitted)
    && Number.isInteger(value.total)
    && value.items.length + value.omitted !== value.total) {
    errors.push(`${name}.omitted must equal total minus retained items`);
  }
  return errors;
}

export function workspaceTopologyErrors(topology) {
  const errors = [];
  if (!topology || typeof topology !== "object" || Array.isArray(topology)) {
    return ["topology must be an object"];
  }
  if (topology.kind !== WORKSPACE_TOPOLOGY_KIND) {
    errors.push(`kind must be ${WORKSPACE_TOPOLOGY_KIND}`);
  }
  if (topology.schemaVersion !== WORKSPACE_TOPOLOGY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${WORKSPACE_TOPOLOGY_SCHEMA_VERSION}`);
  }
  if (!STATUS_VALUES.has(topology.status)) {
    errors.push("status must be complete or partial");
  }
  if (!path.isAbsolute(String(topology.requestedWorkspace ?? ""))) {
    errors.push("requestedWorkspace must be absolute");
  }
  if (topology.gitRoot !== null && !path.isAbsolute(String(topology.gitRoot ?? ""))) {
    errors.push("gitRoot must be null or absolute");
  }

  const target = topology.target;
  if (!target || typeof target !== "object") {
    errors.push("target must be an object");
  } else {
    if (!TARGET_KINDS.has(target.kind)) errors.push("target.kind is unsupported");
    if (!MEMBER_MATCHES.has(target.memberMatch)) errors.push("target.memberMatch is unsupported");
    try {
      if (normalizeRoute(target.route, "target.route") !== target.route) {
        errors.push("target.route must be canonical");
      }
    } catch (error) {
      errors.push(error.message);
    }
    if (target.memberRoute !== null) {
      try {
        if (normalizeRoute(target.memberRoute, "target.memberRoute") !== target.memberRoute) {
          errors.push("target.memberRoute must be canonical");
        }
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (target.kind === "repo-root" && target.route !== ".") {
      errors.push("repo-root target.route must be .");
    }
    if (target.kind !== "standalone" && topology.gitRoot === null) {
      errors.push(`${target.kind} topology requires a gitRoot`);
    }
    if (target.kind === "standalone" && topology.gitRoot !== null) {
      errors.push("standalone topology must not have a gitRoot");
    }
    if (target.kind === "workspace-member" && target.memberRoute === null) {
      errors.push("workspace-member target requires memberRoute");
    }
    if (target.kind === "workspace-member" && target.memberRoute !== null) {
      try {
        if (!routeContains(target.memberRoute, target.route)) {
          errors.push("workspace-member target.memberRoute must contain target.route");
        }
      } catch {
        // Canonical route errors above already describe this failure.
      }
      if (target.memberMatch === "exact" && target.memberRoute !== target.route) {
        errors.push("exact memberMatch requires target.memberRoute to equal target.route");
      }
      if (target.memberMatch === "descendant" && target.memberRoute === target.route) {
        errors.push("descendant memberMatch requires target.route below target.memberRoute");
      }
    }
    if (target.kind !== "workspace-member"
      && (target.memberRoute !== null || target.memberMatch !== "none")) {
      errors.push(`${target.kind} target must not declare member ownership`);
    }
    if (topology.gitRoot !== null
      && path.isAbsolute(String(topology.gitRoot ?? ""))
      && path.isAbsolute(String(topology.requestedWorkspace ?? ""))) {
      try {
        const expectedWorkspace = target.route === "."
          ? topology.gitRoot
          : path.resolve(topology.gitRoot, ...normalizeRoute(target.route, "target.route").split("/"));
        if (!sameAbsolutePath(expectedWorkspace, topology.requestedWorkspace)) {
          errors.push("target.route must resolve from gitRoot to requestedWorkspace");
        }
      } catch {
        // Canonical route errors above already describe this failure.
      }
    }
  }

  errors.push(...countEnvelopeErrors(topology.members, "members"));
  errors.push(...countEnvelopeErrors(topology.instructionScopes, "instructionScopes"));

  for (const [index, member] of (topology.members?.items ?? []).entries()) {
    try {
      if (normalizeRoute(member.route, `members.items[${index}].route`) !== member.route) {
        errors.push(`members.items[${index}].route must be canonical`);
      }
    } catch (error) {
      errors.push(error.message);
    }
    if (!MEMBER_KINDS.has(member.kind)) {
      errors.push(`members.items[${index}].kind is unsupported`);
    }
    if (!Array.isArray(member.discoveredBy) || member.discoveredBy.length === 0) {
      errors.push(`members.items[${index}].discoveredBy must be non-empty`);
    }
    if (member.manifestRoute !== null && member.manifestRoute !== undefined) {
      try {
        if (normalizeRoute(member.manifestRoute, `members.items[${index}].manifestRoute`) !== member.manifestRoute) {
          errors.push(`members.items[${index}].manifestRoute must be canonical`);
        }
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  for (const [index, scope] of (topology.instructionScopes?.items ?? []).entries()) {
    try {
      if (normalizeRoute(scope.route, `instructionScopes.items[${index}].route`) !== scope.route) {
        errors.push(`instructionScopes.items[${index}].route must be canonical`);
      }
    } catch (error) {
      errors.push(error.message);
    }
    if (!INSTRUCTION_PROVIDERS.has(scope.provider)) {
      errors.push(`instructionScopes.items[${index}].provider is unsupported`);
    }
    if (!INSTRUCTION_ACTIVATIONS.has(scope.activation)) {
      errors.push(`instructionScopes.items[${index}].activation is unsupported`);
    }
  }

  if (!topology.discovery || typeof topology.discovery !== "object") {
    errors.push("discovery must be an object");
  } else {
    for (const field of ["tracked", "untracked", "scanned", "omitted"]) {
      if (!Number.isInteger(topology.discovery[field]) || topology.discovery[field] < 0) {
        errors.push(`discovery.${field} must be a non-negative integer`);
      }
    }
    if (typeof topology.discovery.truncated !== "boolean") {
      errors.push("discovery.truncated must be boolean");
    }
    if (!Array.isArray(topology.discovery.warnings)) {
      errors.push("discovery.warnings must be an array");
    }
    if (Number.isInteger(topology.discovery.tracked)
      && Number.isInteger(topology.discovery.untracked)
      && Number.isInteger(topology.discovery.scanned)
      && Number.isInteger(topology.discovery.omitted)
      && topology.discovery.tracked + topology.discovery.untracked
        !== topology.discovery.scanned + topology.discovery.omitted) {
      errors.push("discovery scanned plus omitted must equal tracked plus untracked");
    }
  }

  if (topology.status === "complete"
    && (topology.members?.truncated
      || topology.instructionScopes?.truncated
      || topology.discovery?.truncated)) {
    errors.push("complete topology must not contain truncated collections");
  }

  if (target?.memberRoute
    && !(topology.members?.items ?? []).some((member) => member.route === target.memberRoute)) {
    errors.push("target memberRoute must be retained in members.items");
  }
  return errors;
}

export function validateWorkspaceTopology(topology) {
  const errors = workspaceTopologyErrors(topology);
  if (errors.length > 0) {
    throw Object.assign(contractError(errors.join("; ")), { errors });
  }
  return topology;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function freezeWorkspaceTopology(topology) {
  validateWorkspaceTopology(topology);
  return deepFreeze(structuredClone(topology));
}

export function analysisScopeFromTopology(topology) {
  validateWorkspaceTopology(topology);
  const route = topology.target.route;
  return Object.freeze({
    kind: topology.target.kind === "repo-root" || topology.target.kind === "standalone"
      ? "repo"
      : "path",
    route,
    pathspecs: topology.gitRoot && route !== "."
      ? Object.freeze([`:(top,literal)${route}`])
      : Object.freeze([]),
  });
}

export function ownerRouteForTopologyPath(topology, filePath) {
  validateWorkspaceTopology(topology);
  const route = path.isAbsolute(String(filePath))
    ? relativeRoute(topology.gitRoot ?? topology.requestedWorkspace, filePath, "file")
    : normalizeRoute(filePath, "file route");
  const matches = topology.members.items
    .map((member) => member.route)
    .filter((memberRoute) => routeContains(memberRoute, route))
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  return matches[0] ?? ".";
}
