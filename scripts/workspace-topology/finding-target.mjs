import {
  normalizeRoute,
  routeContains,
  validateWorkspaceTopology,
} from "./contract.mjs";

export const FINDING_TARGET_KINDS = Object.freeze([
  "repo-root",
  "workspace-member",
  "repo-subtree",
  "standalone",
]);

const FINDING_TARGET_KIND_SET = new Set(FINDING_TARGET_KINDS);
const FINDING_TARGET_FIELDS = new Set(["kind", "packageRoute", "ownerRoute"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalNullableRouteErrors(value, field, prefix) {
  if (value === null) return [];
  if (typeof value !== "string" || value.trim() === "") {
    return [`${prefix}.${field} must be a canonical relative route or null`];
  }
  try {
    return normalizeRoute(value, `${prefix}.${field}`) === value
      ? []
      : [`${prefix}.${field} must be canonical`];
  } catch (error) {
    return [error.message];
  }
}

export function findingTargetErrors(target, {
  topology,
  required = false,
  requireOwnerRoute = false,
  prefix = "finding.target",
} = {}) {
  if (target === undefined) return required ? [`${prefix} is required for this workspace target`] : [];
  if (!isObject(target)) return [`${prefix} must be an object`];

  const errors = [];
  for (const field of Object.keys(target)) {
    if (!FINDING_TARGET_FIELDS.has(field)) {
      errors.push(`${prefix} has unsupported field: ${field}`);
    }
  }
  for (const field of FINDING_TARGET_FIELDS) {
    if (!Object.hasOwn(target, field)) errors.push(`${prefix} missing ${field}`);
  }
  if (!FINDING_TARGET_KIND_SET.has(target.kind)) {
    errors.push(`${prefix}.kind is unsupported`);
  }
  errors.push(...canonicalNullableRouteErrors(target.packageRoute, "packageRoute", prefix));
  errors.push(...canonicalNullableRouteErrors(target.ownerRoute, "ownerRoute", prefix));

  if (target.kind === "workspace-member" && target.packageRoute === null) {
    errors.push(`${prefix}.packageRoute is required for a workspace-member`);
  }
  if (requireOwnerRoute && target.ownerRoute === null) {
    errors.push(`${prefix}.ownerRoute is required for this operation`);
  }
  if (target.kind && target.kind !== "workspace-member" && target.packageRoute !== null) {
    errors.push(`${prefix}.packageRoute must be null for ${target.kind}`);
  }

  if (topology === undefined) return errors;
  try {
    validateWorkspaceTopology(topology);
  } catch (error) {
    errors.push(`${prefix} cannot be checked against invalid topology: ${error.message}`);
    return errors;
  }
  if (topology.status !== "complete") {
    errors.push(`${prefix} requires complete workspace topology`);
  }
  if (target.kind !== topology.target.kind) {
    errors.push(`${prefix}.kind does not match the frozen workspace topology`);
  }
  const expectedPackageRoute = topology.target.kind === "workspace-member"
    ? topology.target.memberRoute
    : null;
  if (target.packageRoute !== expectedPackageRoute) {
    errors.push(`${prefix}.packageRoute does not match the frozen workspace topology`);
  }
  if (target.ownerRoute !== null) {
    try {
      const ownerRoute = normalizeRoute(target.ownerRoute, `${prefix}.ownerRoute`);
      const targetRoute = topology.target.route;
      if (!routeContains(ownerRoute, targetRoute) && !routeContains(targetRoute, ownerRoute)) {
        errors.push(`${prefix}.ownerRoute is outside the frozen target route`);
      }
    } catch {
      // The canonical route error above already describes this failure.
    }
  }
  return errors;
}

export function validateFindingTarget(target, options = {}) {
  const errors = findingTargetErrors(target, options);
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join("; ")), {
      code: "INVALID_FINDING_TARGET",
      errors,
    });
  }
  return target;
}

export function findingTargetFromTopology(topology, { ownerRoute } = {}) {
  validateWorkspaceTopology(topology);
  const target = {
    kind: topology.target.kind,
    packageRoute: topology.target.kind === "workspace-member"
      ? topology.target.memberRoute
      : null,
    ownerRoute: ownerRoute === null
      ? null
      : normalizeRoute(
          ownerRoute ?? topology.target.memberRoute ?? topology.target.route,
          "finding owner route",
        ),
  };
  validateFindingTarget(target, {
    topology,
    requireOwnerRoute: topology.target.kind === "workspace-member",
  });
  return Object.freeze(target);
}
