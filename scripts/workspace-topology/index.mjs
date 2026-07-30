import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  WORKSPACE_TOPOLOGY_KIND,
  WORKSPACE_TOPOLOGY_SCHEMA_VERSION,
  analysisScopeFromTopology,
  freezeWorkspaceTopology,
  normalizeRoute,
  ownerRouteForTopologyPath,
  relativeRoute,
  routeContains,
  validateWorkspaceTopology,
} from "./contract.mjs";
import {
  assertWorkspaceDirectory,
  collectWorkspaceInventory,
  resolveGitRoot,
} from "./inventory.mjs";
import { discoverWorkspaceStructure } from "./manifests.mjs";

const DEFAULT_MAX_FILES = 50_000;
const DEFAULT_MAX_MEMBERS = 500;
const DEFAULT_MAX_INSTRUCTION_SCOPES = 1_000;

function positiveLimit(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
    throw Object.assign(new Error(`${name} must be an integer from 1 to 1000000`), {
      code: "INVALID_WORKSPACE_TOPOLOGY_LIMIT",
    });
  }
  return parsed;
}

function bounded(items, limit, preserve = null) {
  let retained = items.slice(0, limit);
  if (preserve && !retained.some((item) => item.route === preserve)) {
    const required = items.find((item) => item.route === preserve);
    if (required) {
      retained = limit === 1 ? [required] : [...retained.slice(0, limit - 1), required];
      retained.sort((left, right) => left.route.localeCompare(right.route));
    }
  }
  return {
    items: retained,
    total: items.length,
    omitted: items.length - retained.length,
    truncated: items.length > retained.length,
  };
}

function owningMember(members, targetRoute) {
  return members
    .filter((member) => routeContains(member.route, targetRoute))
    .sort((left, right) => right.route.length - left.route.length || left.route.localeCompare(right.route))[0] ?? null;
}

function targetContract({ gitRoot, targetRoute, member }) {
  if (!gitRoot) {
    return {
      kind: "standalone",
      route: ".",
      memberRoute: null,
      memberMatch: "none",
    };
  }
  if (targetRoute === ".") {
    return {
      kind: "repo-root",
      route: ".",
      memberRoute: null,
      memberMatch: "none",
    };
  }
  if (member) {
    return {
      kind: "workspace-member",
      route: targetRoute,
      memberRoute: member.route,
      memberMatch: member.route === targetRoute ? "exact" : "descendant",
    };
  }
  return {
    kind: "repo-subtree",
    route: targetRoute,
    memberRoute: null,
    memberMatch: "none",
  };
}

export async function resolveWorkspaceTopology(options = {}, dependencies = {}) {
  const input = typeof options === "string" ? { workspace: options } : options;
  if (!input.workspace) {
    throw Object.assign(new Error("--workspace is required"), { code: "MISSING_WORKSPACE" });
  }
  const requestedPath = path.resolve(String(input.workspace));
  await (dependencies.assertWorkspaceDirectory ?? assertWorkspaceDirectory)(requestedPath);
  const requestedWorkspace = await realpath(requestedPath);
  const gitProbe = (dependencies.resolveGitRoot ?? resolveGitRoot)(requestedWorkspace);
  const gitRoot = gitProbe.gitRoot;
  const topologyRoot = gitRoot ?? requestedWorkspace;
  const targetRoute = gitRoot
    ? relativeRoute(gitRoot, requestedWorkspace, "workspace")
    : ".";
  const maxFiles = positiveLimit(input.maxFiles ?? input["max-files"], DEFAULT_MAX_FILES, "maxFiles");
  const maxMembers = positiveLimit(input.maxMembers ?? input["max-members"], DEFAULT_MAX_MEMBERS, "maxMembers");
  const maxInstructionScopes = positiveLimit(
    input.maxInstructionScopes ?? input["max-instruction-scopes"],
    DEFAULT_MAX_INSTRUCTION_SCOPES,
    "maxInstructionScopes",
  );
  const inventory = await (dependencies.collectWorkspaceInventory ?? collectWorkspaceInventory)({
    root: topologyRoot,
    gitRoot,
    gitAvailable: gitProbe.gitAvailable,
    maxFiles,
    initialWarnings: gitProbe.warning ? [gitProbe.warning] : [],
  });
  const structure = await (dependencies.discoverWorkspaceStructure ?? discoverWorkspaceStructure)({
    root: topologyRoot,
    items: inventory.discoveryItems ?? inventory.items,
    targetRoute,
  });
  const member = owningMember(structure.members, targetRoute);
  const members = bounded(structure.members, maxMembers, member?.route ?? null);
  const instructionScopes = bounded(structure.instructionScopes, maxInstructionScopes);
  const discoveryWarnings = [
    ...inventory.coverage.warnings,
    ...structure.warnings,
    ...(members.truncated ? [{ code: "member-list-truncated" }] : []),
    ...(instructionScopes.truncated ? [{ code: "instruction-scope-list-truncated" }] : []),
  ];
  const partial = inventory.coverage.truncated
    || members.truncated
    || instructionScopes.truncated
    || discoveryWarnings.some((item) => !new Set([
      "git-root-realpath-unavailable",
    ]).has(item.code));

  const topology = freezeWorkspaceTopology({
    kind: WORKSPACE_TOPOLOGY_KIND,
    schemaVersion: WORKSPACE_TOPOLOGY_SCHEMA_VERSION,
    status: partial ? "partial" : "complete",
    requestedWorkspace,
    gitRoot,
    target: targetContract({ gitRoot, targetRoute, member }),
    members,
    instructionScopes,
    discovery: {
      ...inventory.coverage,
      warnings: discoveryWarnings,
    },
  });
  const analysisScope = analysisScopeFromTopology(topology);
  return Object.freeze({
    topology,
    analysisScope,
    inventory: Object.freeze({
      items: Object.freeze(inventory.items.map((item) => Object.freeze({ ...item }))),
    }),
  });
}

export function ownerRouteForPath(topology, filePath) {
  return ownerRouteForTopologyPath(topology, filePath);
}

export {
  WORKSPACE_TOPOLOGY_KIND,
  WORKSPACE_TOPOLOGY_SCHEMA_VERSION,
  analysisScopeFromTopology,
  normalizeRoute,
  routeContains,
  validateWorkspaceTopology,
};
export {
  FINDING_TARGET_KINDS,
  findingTargetErrors,
  findingTargetFromTopology,
  validateFindingTarget,
} from "./finding-target.mjs";
