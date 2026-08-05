import {
  getHostProfile,
  getHostSurface,
  listHostProfiles,
  supportedHostIds,
} from "../host-support/index.mjs";
import { LifecycleCliError } from "./contract.mjs";

function usageError(code, message, hint) {
  return new LifecycleCliError(code, message, { kind: "usage", hint });
}

function unknownHost(host, { includeAll = false } = {}) {
  const suffix = includeAll ? ", or all" : "";
  return usageError(
    "UNKNOWN_HOST",
    `Unknown host: ${host}`,
    `Use one of: ${supportedHostIds().join(", ")}${suffix}.`,
  );
}

function requireSurface(profile, surfaceId, { label = profile.displayName, includeHint = false } = {}) {
  const surface = getHostSurface(profile.hostId, surfaceId);
  if (surface) return surface;
  const hint = includeHint
    ? `Use one of: ${profile.surfaces.map((entry) => entry.surfaceId).join(", ")}.`
    : undefined;
  throw usageError(
    "UNKNOWN_HOST_SURFACE",
    `Unknown surface for ${label}: ${surfaceId ?? "<missing>"}`,
    hint,
  );
}

function selectStatusProfiles(host) {
  if (!host || host === "all") return listHostProfiles();
  const profile = getHostProfile(host);
  if (!profile) throw unknownHost(host, { includeAll: true });
  return [profile];
}

function selectStatusSurface(profiles, surfaceId) {
  if (!surfaceId) return undefined;
  if (profiles.length !== 1) {
    throw usageError(
      "AMBIGUOUS_SURFACE",
      "--surface requires one explicit host.",
    );
  }
  const profile = profiles[0];
  return requireSurface(profile, surfaceId, { label: profile.hostId, includeHint: true });
}

export function resolveStatusTarget(options = {}) {
  const profiles = selectStatusProfiles(options.host);
  if (options.hostHome && profiles.length !== 1) {
    throw usageError(
      "AMBIGUOUS_HOST_HOME",
      "--host-home requires one explicit host.",
    );
  }
  return {
    profiles,
    surface: selectStatusSurface(profiles, options.surface),
  };
}

export function resolvePlanTarget(options = {}) {
  const { host, surface: surfaceId, scope } = options;
  if (!host || host === "all" || host === "auto") {
    throw usageError(
      "EXPLICIT_HOST_REQUIRED",
      "Plugin plans require one explicit host.",
      `Use --host ${supportedHostIds({ managedOnly: true }).join(" or --host ")}.`,
    );
  }

  const profile = getHostProfile(host);
  if (!profile) throw unknownHost(host);
  if (!surfaceId && profile.surfaces.length > 1) {
    throw usageError(
      "AMBIGUOUS_HOST_SURFACE",
      `${profile.displayName} has multiple lifecycle surfaces.`,
      `Use --surface ${profile.surfaces.map((entry) => entry.surfaceId).join(" or --surface ")}.`,
    );
  }
  const surface = requireSurface(profile, surfaceId);

  const selectedScope = scope ?? surface.defaultScope;
  if (!surface.scopes.includes(selectedScope)) {
    throw usageError(
      "UNSUPPORTED_SCOPE",
      `${profile.displayName}/${surface.surfaceId} does not support scope ${selectedScope}.`,
      `Use one of: ${surface.scopes.join(", ")}.`,
    );
  }
  return { profile, surface, scope: selectedScope };
}
