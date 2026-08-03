export const HOST_CAPABILITIES = Object.freeze({
  SESSION_ANALYSIS: "sessionAnalysis",
  AGENT_CUSTOMIZE: "agentCustomize",
  ASSET_PRACTICES: "assetPractices",
  HARNESS_REPORT: "harnessReport",
  REPORT_RENDERING: "reportRendering",
  EVIDENCE_BUNDLE: "evidenceBundle",
  CHECKUP: "checkup",
});

const ALL_CAPABILITIES = Object.freeze(Object.values(HOST_CAPABILITIES));
const COMMON_CAPABILITIES = Object.freeze(ALL_CAPABILITIES.filter(
  (capability) => capability !== HOST_CAPABILITIES.CHECKUP,
));
const CHECKUP_CAPABILITIES = Object.freeze([...COMMON_CAPABILITIES, HOST_CAPABILITIES.CHECKUP]);

function descriptor({ id, displayName, aliases = [], capabilities, sessionScopeTokens = [], practiceMemory = "none" }) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    throw new Error(`Host ${id} must explicitly declare at least one capability`);
  }
  const unknownCapabilities = capabilities.filter((capability) => !ALL_CAPABILITIES.includes(capability));
  if (unknownCapabilities.length > 0) {
    throw new Error(`Host ${id} declares unknown capabilities: ${unknownCapabilities.join(", ")}`);
  }
  return Object.freeze({
    id,
    displayName,
    aliases: Object.freeze([...aliases]),
    homeOption: `${id}-home`,
    homeProperty: `${id.replace(/-([a-z0-9])/gu, (_match, character) => character.toUpperCase())}Home`,
    capabilities: Object.freeze([...capabilities]),
    sessionScopeTokens: Object.freeze([...sessionScopeTokens]),
    practiceMemory,
  });
}

// Pure host metadata only. Executable adapter imports remain in their
// capability-local registries so one missing capability never fabricates a
// repository-wide HostAdapter implementation.
export const HOST_DESCRIPTORS = Object.freeze([
  descriptor({
    id: "qoder",
    displayName: "Qoder",
    capabilities: CHECKUP_CAPABILITIES,
    practiceMemory: "project",
    sessionScopeTokens: [".qoder", "qoder"],
  }),
  descriptor({
    id: "codex",
    displayName: "Codex",
    capabilities: CHECKUP_CAPABILITIES,
    practiceMemory: "global",
    sessionScopeTokens: [".codex", "codex"],
  }),
  descriptor({
    id: "claude",
    displayName: "Claude",
    aliases: ["Claude Code"],
    capabilities: CHECKUP_CAPABILITIES,
    sessionScopeTokens: [".claude", "claude"],
  }),
  descriptor({
    id: "cursor",
    displayName: "Cursor",
    capabilities: CHECKUP_CAPABILITIES,
    sessionScopeTokens: [".cursor", "cursor"],
  }),
  descriptor({
    id: "qwen",
    displayName: "Qwen",
    aliases: ["Qwen Code"],
    capabilities: CHECKUP_CAPABILITIES,
    sessionScopeTokens: [".qwen", "qwen"],
  }),
  descriptor({
    id: "copilot",
    displayName: "Copilot",
    aliases: ["GitHub Copilot"],
    capabilities: CHECKUP_CAPABILITIES,
    sessionScopeTokens: [".copilot", "copilot"],
  }),
  descriptor({
    id: "pi",
    displayName: "Pi",
    capabilities: CHECKUP_CAPABILITIES,
    sessionScopeTokens: [".pi", "pi"],
  }),
  descriptor({
    id: "kimi",
    displayName: "Kimi",
    aliases: ["Kimi Code"],
    capabilities: COMMON_CAPABILITIES,
    sessionScopeTokens: [".kimi-code", ".kimi", "kimi"],
  }),
  descriptor({
    id: "workbuddy",
    displayName: "WorkBuddy",
    capabilities: CHECKUP_CAPABILITIES,
    sessionScopeTokens: [".workbuddy", "workbuddy"],
  }),
  descriptor({
    id: "grok",
    displayName: "Grok",
    capabilities: COMMON_CAPABILITIES,
    sessionScopeTokens: [".grok", "grok"],
  }),
]);

const HOST_BY_ID = new Map(HOST_DESCRIPTORS.map((host) => [host.id, host]));
const HOST_IDS_BY_CAPABILITY = new Map(ALL_CAPABILITIES.map((capability) => [
  capability,
  Object.freeze(HOST_DESCRIPTORS.filter((host) => host.capabilities.includes(capability)).map((host) => host.id)),
]));

export const HOST_IDS = Object.freeze(HOST_DESCRIPTORS.map((host) => host.id));

export function getHostDescriptor(hostId) {
  return HOST_BY_ID.get(String(hostId ?? "").toLowerCase());
}

export function hostIdsFor(capability) {
  const hostIds = HOST_IDS_BY_CAPABILITY.get(capability);
  if (!hostIds) throw new Error(`Unknown host capability: ${capability}`);
  return hostIds;
}

export function hostIdSetFor(capability) {
  return new Set(hostIdsFor(capability));
}

export function hostPipeList(hostIds) {
  return [...hostIds].join("|");
}

export function formatHostList(hostIds, { displayNames = false, conjunction = "or" } = {}) {
  const values = [...hostIds].map((hostId) => {
    if (!displayNames) return hostId;
    return getHostDescriptor(hostId)?.displayName ?? hostId;
  });
  if (values.length < 2) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} ${conjunction} ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, ${conjunction} ${values.at(-1)}`;
}

export function hostHomeValue(options = {}, hostId) {
  const host = getHostDescriptor(hostId);
  if (!host) return options.home;
  return options.home ?? options[host.homeProperty] ?? options[host.homeOption];
}

export function normalizedHostHomeOptions(options = {}, hostId) {
  const host = getHostDescriptor(hostId);
  const home = hostHomeValue(options, hostId);
  if (!host || home === undefined) return home === undefined ? {} : { home };
  return {
    home,
    [host.homeProperty]: home,
    [host.homeOption]: home,
  };
}

export function hostHomeOptionKeys(hostIds) {
  return [...hostIds].map((hostId) => getHostDescriptor(hostId)?.homeOption).filter(Boolean);
}

export function hostSessionScopeTokens(capability = HOST_CAPABILITIES.SESSION_ANALYSIS) {
  return hostIdsFor(capability).flatMap((hostId) => getHostDescriptor(hostId)?.sessionScopeTokens ?? []);
}
