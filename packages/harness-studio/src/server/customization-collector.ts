import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import {
  CUSTOMIZATION_CATALOG_KIND,
  CUSTOMIZATION_SCHEMA_VERSION,
  assertCustomizationCatalogV1,
  customizationId,
  customizationRevision,
  summarizeCustomizationCatalog,
  type AgentDefinitionV1,
  type AgentSkillDefinitionV1,
  type CustomizationAnalysisResponseV1,
  type CustomizationCatalogV1,
  type CustomizationDefinitionV1,
  type CustomizationFormatV1,
  type CustomizationHostId,
  type CustomizationScope,
  type CustomizationSourceRefV1,
  type HookDefinitionV1,
  type HostCollectionObservationV1,
  type HostExposureV1,
  type InstructionDefinitionV1,
  type McpServerDefinitionV1,
  type McpServerDiscoveryV1,
  type McpServerRegistrationV1,
  type McpTransportDefinitionV1,
  type PluginInstallationV1,
  type PluginPackageV1,
  type PromptCommandDefinitionV1,
} from "@qoder-ai/harness/customization";

const DEFAULT_HOSTS = ["codex", "claude", "qoder"] as const;
const HOST_LABELS: Record<(typeof DEFAULT_HOSTS)[number], string> = {
  codex: "Codex",
  claude: "Claude",
  qoder: "Qoder",
};

type RawRecord = Record<string, unknown>;

export interface StudioCustomizationCollector {
  analyze(workspacePath: string): Promise<CustomizationAnalysisResponseV1>;
}

export interface AgentCustomizationCollectorOptions {
  collectInventory(options: {
    provider: CustomizationHostId;
    workspace: string;
    includeUserHome: boolean;
  }): Promise<unknown>;
  hosts?: readonly CustomizationHostId[];
  now?: () => Date;
  resolveSourcePath?: (path: string) => Promise<string>;
}

/**
 * Normalize existing Host collectors into the public catalog. Collection is
 * invoked only from `analyze`; constructing this object performs no I/O.
 */
export function createAgentCustomizationCollector(options: AgentCustomizationCollectorOptions): StudioCustomizationCollector {
  const hosts = options.hosts ?? DEFAULT_HOSTS;
  const now = options.now ?? (() => new Date());
  const resolveSourcePath = options.resolveSourcePath ?? (async (path) => await realpath(path).catch(() => resolve(path)));
  return {
    async analyze(workspacePath) {
      const workspaceRoot = await resolveSourcePath(workspacePath);
      const generatedAt = now().toISOString();
      const accumulator = createAccumulator(workspaceRoot, generatedAt);
      const results = await Promise.all(hosts.map(async (hostId) => {
        try {
          const raw = await options.collectInventory({ provider: hostId, workspace: workspaceRoot, includeUserHome: true });
          return { hostId, raw } as const;
        } catch {
          return { hostId, error: true } as const;
        }
      }));

      for (const result of results) {
        if ("error" in result) {
          addHostFailure(accumulator, result.hostId, generatedAt);
          continue;
        }
        await addHostInventory(accumulator, result.hostId, result.raw, generatedAt, resolveSourcePath);
      }

      const catalog: CustomizationCatalogV1 = {
        kind: CUSTOMIZATION_CATALOG_KIND,
        schemaVersion: CUSTOMIZATION_SCHEMA_VERSION,
        generatedAt,
        workspace: {
          label: safeText(basename(workspaceRoot), "Workspace"),
          evidenceId: customizationId("workspace", workspaceRoot),
        },
        hosts: [...accumulator.hosts.values()].sort(byId),
        packages: [...accumulator.packages.values()].sort(byName),
        definitions: [...accumulator.definitions.values()].sort(byKindAndName),
        installations: [...accumulator.installations.values()].sort(byId),
        exposures: [...accumulator.exposures.values()].sort(byId),
        registrations: [...accumulator.registrations.values()].sort(byId),
        runtimeObservations: [...accumulator.runtimeObservations.values()].sort(byId),
      };
      assertCustomizationCatalogV1(catalog);
      return { catalog, summary: summarizeCustomizationCatalog(catalog) };
    },
  };
}

/** Default packaged collector. The bundled runtime is loaded lazily on Analyze. */
export function createBundledAgentCustomizationCollector(): StudioCustomizationCollector {
  let runtime: Promise<{ collectAgentCustomizeInventory(options: RawRecord): Promise<unknown> }> | undefined;
  return createAgentCustomizationCollector({
    collectInventory: async (options) => {
      runtime ??= import(new URL("./runtime/agent-customize-runtime.mjs", import.meta.url).href) as Promise<{
        collectAgentCustomizeInventory(options: RawRecord): Promise<unknown>;
      }>;
      return await (await runtime).collectAgentCustomizeInventory(options);
    },
  });
}

/** Revalidate injected collectors before their result crosses the browser boundary. */
export function validateStudioCustomizationAnalysis(
  value: unknown,
  privateRoots: readonly string[],
): CustomizationAnalysisResponseV1 {
  const candidate = record(value);
  const catalog = candidate?.catalog;
  assertCustomizationCatalogV1(catalog);
  const serialized = JSON.stringify(catalog);
  for (const root of [homedir(), ...privateRoots].filter(Boolean)) {
    if (serialized.toLocaleLowerCase().includes(resolve(root).toLocaleLowerCase())) {
      throw new TypeError("Customization analysis retained a private filesystem root.");
    }
  }
  const forbiddenKeys = new Set(["filePath", "rootPath", "command", "args", "env", "headers", "authorization"]);
  walkJson(catalog, (key, entry) => {
    if (forbiddenKeys.has(key)) throw new TypeError(`Customization analysis retained private collector field '${key}'.`);
    if (key === "logicalPath" && typeof entry === "string" && !isPortableLogicalPath(entry)) {
      throw new TypeError("Customization analysis retained a non-portable logical path.");
    }
  });
  return { catalog, summary: summarizeCustomizationCatalog(catalog) };
}

interface CatalogAccumulator {
  workspaceRoot: string;
  generatedAt: string;
  hosts: Map<string, CustomizationCatalogV1["hosts"][number]>;
  packages: Map<string, PluginPackageV1>;
  installations: Map<string, PluginInstallationV1>;
  definitions: Map<string, CustomizationDefinitionV1>;
  exposures: Map<string, HostExposureV1>;
  registrations: Map<string, McpServerRegistrationV1>;
  runtimeObservations: Map<string, CustomizationCatalogV1["runtimeObservations"][number]>;
}

function createAccumulator(workspaceRoot: string, generatedAt: string): CatalogAccumulator {
  return {
    workspaceRoot,
    generatedAt,
    hosts: new Map(),
    packages: new Map(),
    installations: new Map(),
    definitions: new Map(),
    exposures: new Map(),
    registrations: new Map(),
    runtimeObservations: new Map(),
  };
}

function addHostFailure(accumulator: CatalogAccumulator, hostId: CustomizationHostId, observedAt: string): void {
  const label = hostLabel(hostId);
  accumulator.hosts.set(hostId, { id: hostId, label, status: "error" });
  const observation: HostCollectionObservationV1 = {
    kind: "host-collection",
    id: customizationId("host-collection", [hostId, observedAt]),
    hostId,
    status: "error",
    observedAt,
    message: `${label} customization collection failed. Other Host results remain available.`,
    counts: { packages: 0, definitions: 0, registrations: 0 },
  };
  accumulator.runtimeObservations.set(observation.id, observation);
}

async function addHostInventory(
  accumulator: CatalogAccumulator,
  hostId: CustomizationHostId,
  rawValue: unknown,
  observedAt: string,
  resolveSourcePath: (path: string) => Promise<string>,
): Promise<void> {
  const inventory = record(rawValue);
  if (inventory === undefined) {
    addHostFailure(accumulator, hostId, observedAt);
    return;
  }
  const hostPackagesBefore = accumulator.packages.size;
  const hostDefinitions = new Set<string>();
  const hostRegistrationsBefore = accumulator.registrations.size;
  const packageByLegacyId = new Map<string, string>();

  for (const rawPlugin of records(inventory.plugins)) {
    const privateSource = await resolvedPrivateSource(rawPlugin, `plugin:${hostId}:${text(rawPlugin.id) ?? text(rawPlugin.name) ?? "unknown"}`, resolveSourcePath);
    const manifestName = safeText(text(rawPlugin.name) ?? text(rawPlugin.id), "Unnamed Plugin");
    const format = pluginFormat(hostId);
    const packageId = customizationId("plugin-package", [format.id, privateSource, manifestName]);
    const source = sourceRef(rawPlugin, privateSource, accumulator.workspaceRoot, hostId, "plugin");
    const packageValue: PluginPackageV1 = {
      kind: "agent-plugin-package",
      id: packageId,
      format,
      manifest: {
        name: manifestName,
        ...(text(rawPlugin.displayName) === undefined ? {} : { displayName: safeText(text(rawPlugin.displayName), manifestName) }),
        ...(text(rawPlugin.version) === undefined ? {} : { declaredVersion: safeText(text(rawPlugin.version), "") }),
        ...(text(rawPlugin.description) === undefined ? {} : { description: safeText(text(rawPlugin.description), "") }),
        ...(text(record(rawPlugin.author)?.name) === undefined ? {} : { authorName: safeText(text(record(rawPlugin.author)?.name), "") }),
      },
      revision: {
        revisionId: customizationRevision({ format: format.id, privateSource, version: text(rawPlugin.version), manifestName }),
        ...(text(rawPlugin.version) === undefined ? {} : { declaredVersion: text(rawPlugin.version) }),
        completeness: "partial",
      },
      source,
      validation: partialValidation("HOST_NATIVE_PLUGIN", "The Host collector retained manifest metadata but did not hash the complete package tree."),
    };
    accumulator.packages.set(packageId, packageValue);
    for (const key of [text(rawPlugin.id), text(rawPlugin.name), text(rawPlugin.claudePluginId), text(rawPlugin.cursorPluginId)].filter(isString)) {
      packageByLegacyId.set(key, packageId);
    }

    const scopes = stringArray(rawPlugin.installSources).length > 0
      ? stringArray(rawPlugin.installSources)
      : [text(rawPlugin.installSource) ?? text(rawPlugin.scope) ?? "unknown"];
    for (const rawScope of scopes) {
      const scope = normalizeScope(rawScope);
      const installationId = customizationId("plugin-installation", [packageId, hostId, scope, privateSource]);
      const installation: PluginInstallationV1 = {
        kind: "plugin-installation",
        id: installationId,
        packageId,
        hostId,
        scope,
        installSource: installSource(rawScope, rawPlugin),
        installedRevisionId: packageValue.revision.revisionId,
        enablement: enablement(rawPlugin.enabled),
        applicability: rawPlugin.applicable === false ? "not-applicable" : rawPlugin.applicable === true ? "applicable" : "unknown",
        source,
      };
      accumulator.installations.set(installationId, installation);
    }
  }

  const manage = record(inventory.manage) ?? {};
  await addDefinitions(accumulator, hostId, records(manage.skills), "agent-skill", packageByLegacyId, hostDefinitions, resolveSourcePath);
  await addDefinitions(accumulator, hostId, records(manage.rules), "instruction", packageByLegacyId, hostDefinitions, resolveSourcePath);
  await addDefinitions(accumulator, hostId, records(manage.commands), "prompt-command", packageByLegacyId, hostDefinitions, resolveSourcePath);
  await addDefinitions(accumulator, hostId, records(manage.subagents), "agent-definition", packageByLegacyId, hostDefinitions, resolveSourcePath);
  await addDefinitions(accumulator, hostId, records(manage.hooks), "hook", packageByLegacyId, hostDefinitions, resolveSourcePath);
  await addMcpRegistrations(accumulator, hostId, records(manage.mcps), packageByLegacyId, hostDefinitions, resolveSourcePath);

  accumulator.hosts.set(hostId, { id: hostId, label: hostLabel(hostId), status: "ok" });
  const observation: HostCollectionObservationV1 = {
    kind: "host-collection",
    id: customizationId("host-collection", [hostId, observedAt]),
    hostId,
    status: "ok",
    observedAt,
    counts: {
      packages: accumulator.packages.size - hostPackagesBefore,
      definitions: hostDefinitions.size,
      registrations: accumulator.registrations.size - hostRegistrationsBefore,
    },
  };
  accumulator.runtimeObservations.set(observation.id, observation);
}

async function addDefinitions(
  accumulator: CatalogAccumulator,
  hostId: CustomizationHostId,
  items: RawRecord[],
  kind: "agent-skill" | "instruction" | "prompt-command" | "agent-definition" | "hook",
  packageByLegacyId: Map<string, string>,
  hostDefinitions: Set<string>,
  resolveSourcePath: (path: string) => Promise<string>,
): Promise<void> {
  for (const item of items) {
    const privateSource = await resolvedPrivateSource(item, `${kind}:${hostId}:${text(item.id) ?? text(item.name) ?? "unknown"}`, resolveSourcePath);
    const identitySuffix = kind === "hook"
      ? [text(item.step), number(item.registrationIndex), number(item.hookIndex), text(item.configurationDigest)]
      : [];
    const definitionId = customizationId("definition", [kind, privateSource, ...identitySuffix]);
    const source = sourceRef(item, privateSource, accumulator.workspaceRoot, hostId, normalizeScope(text(item.scope)));
    const packageId = packageByLegacyId.get(text(item.pluginId) ?? "");
    const definition = definitionFromLegacy(kind, definitionId, item, source, hostId);
    if (!accumulator.definitions.has(definitionId)) accumulator.definitions.set(definitionId, definition);
    hostDefinitions.add(definitionId);
    const exposureId = customizationId("host-exposure", [definitionId, hostId, normalizeScope(text(item.scope)), packageId]);
    const exposure: HostExposureV1 = {
      kind: "host-exposure",
      id: exposureId,
      definitionId,
      hostId,
      scope: normalizeScope(text(item.scope)),
      discovery: definition.validation.status === "invalid" ? "invalid" : "valid",
      enablement: packageId === undefined ? "unspecified" : enablement(item.pluginEnabled),
      availability: item.pluginEnabled === false ? "unavailable" : "available",
      activation: "not-observed",
      execution: "not-observed",
      ...(kind === "agent-skill" || kind === "prompt-command"
        ? { invocation: { user: "unknown" as const, model: "unknown" as const } }
        : {}),
      ...(packageId === undefined ? {} : { contributedByPackageId: packageId }),
      source,
    };
    accumulator.exposures.set(exposureId, exposure);
  }
}

function definitionFromLegacy(
  kind: "agent-skill" | "instruction" | "prompt-command" | "agent-definition" | "hook",
  id: string,
  item: RawRecord,
  source: CustomizationSourceRefV1,
  hostId: CustomizationHostId,
): AgentSkillDefinitionV1 | InstructionDefinitionV1 | PromptCommandDefinitionV1 | AgentDefinitionV1 | HookDefinitionV1 {
  const name = safeText(text(item.displayName) ?? text(item.name) ?? text(item.label), "Unnamed customization");
  const description = text(item.description) === undefined ? undefined : safeText(text(item.description), "");
  const base = {
    id,
    name,
    ...(description === undefined ? {} : { description }),
    revision: {
      revisionId: customizationRevision({ kind, source: source.evidenceId, name, description, configurationDigest: text(item.configurationDigest) }),
      completeness: "partial" as const,
    },
    source,
    validation: partialValidation("LEGACY_COLLECTOR_PROJECTION", "This V1 definition was normalized from the existing metadata collector."),
  };
  if (kind === "agent-skill") {
    return {
      ...base,
      kind,
      format: { id: "agent-skills", conformance: "unknown" },
      entry: { mediaType: "text/markdown" },
      resources: [],
    };
  }
  if (kind === "instruction") {
    return {
      ...base,
      kind,
      format: hostNativeFormat(hostId, "instruction"),
      instructionRole: instructionRole(item),
      ...(text(item.precedence) === undefined ? {} : { precedence: safeText(text(item.precedence), "host-defined") }),
      composition: text(item.sourceKind) === "design-md-contract" ? "append" : "host-defined",
    };
  }
  if (kind === "prompt-command") {
    return {
      ...base,
      kind,
      format: hostNativeFormat(hostId, "prompt-command"),
      invocationName: name,
      invocation: { user: "unknown", model: "unknown", visible: "unknown" },
    };
  }
  if (kind === "agent-definition") {
    return {
      ...base,
      kind,
      format: hostNativeFormat(hostId, "agent-definition"),
      skillRefs: [],
      mcpRegistrationRefs: [],
      hookRefs: [],
      isolation: "unknown",
    };
  }
  const handlerType = hookHandlerType(text(item.handlerType));
  const actionDigest = customizationRevision({
    configurationDigest: text(item.configurationDigest),
    handlerType,
    source: source.evidenceId,
  });
  const commandDisplay = safeCommandDisplay(text(item.commandDisplay));
  return {
    ...base,
    kind,
    format: hostNativeFormat(hostId, "hook"),
    event: { namespace: hostId, name: safeText(text(item.step), "Unknown event") },
    ...(text(item.matcher) === undefined ? {} : { matcher: safeText(text(item.matcher), "") }),
    ...(text(item.condition) === undefined ? {} : { conditionDigest: customizationRevision(text(item.condition)) }),
    handler: handlerType === "command"
      ? { type: "command", actionDigest, ...(commandDisplay === undefined ? {} : { safeDisplay: commandDisplay }) }
      : { type: handlerType, actionDigest },
    ...(number(item.timeoutMs) === undefined ? {} : { timeoutMs: number(item.timeoutMs) }),
    ...(typeof item.async !== "boolean" ? {} : { async: item.async }),
    ...(number(item.registrationIndex) === undefined ? {} : { order: number(item.registrationIndex) }),
  };
}

async function addMcpRegistrations(
  accumulator: CatalogAccumulator,
  hostId: CustomizationHostId,
  items: RawRecord[],
  packageByLegacyId: Map<string, string>,
  hostDefinitions: Set<string>,
  resolveSourcePath: (path: string) => Promise<string>,
): Promise<void> {
  for (const item of items) {
    const alias = safeText(text(item.name), "Unnamed MCP Server");
    const privateSource = await resolvedPrivateSource(item, `mcp:${hostId}:${text(item.id) ?? alias}`, resolveSourcePath);
    const source = sourceRef(item, privateSource, accumulator.workspaceRoot, hostId, normalizeScope(text(item.scope)));
    const definitionId = customizationId("definition", ["mcp-server-definition", privateSource, alias]);
    const transport = mcpTransport(item);
    const packageId = packageByLegacyId.get(text(item.pluginId) ?? "");
    const environmentKeys = stringArray(item.envKeys).map((key) => safeText(key, "")).filter(Boolean);
    const headerNames = stringArray(item.headerNames).map((key) => safeText(key, "")).filter(Boolean);
    const definition: McpServerDefinitionV1 = {
      kind: "mcp-server-definition",
      id: definitionId,
      name: alias,
      format: hostNativeFormat(hostId, "mcp-server"),
      revision: {
        revisionId: customizationRevision({ source: source.evidenceId, alias, transport, environmentKeys, headerNames }),
        completeness: "partial",
      },
      source,
      validation: {
        status: "partial",
        diagnostics: [
          { level: "info", code: "MCP_REGISTRATION_ONLY", message: "Static registration evidence does not prove a runtime connection." },
          ...(item.needsAttention === true
            ? [{ level: "warning" as const, code: "HOST_REPORTED_MCP_ATTENTION", message: "The Host reported configuration or runtime attention; registration validity remains separate." }]
            : []),
        ],
      },
      transport,
      environmentKeys,
      headerNames,
      secretRisk: stringArray(item.directSecretEnvKeys).length > 0 ? "direct-secret-observed" : "none-observed",
    };
    if (!accumulator.definitions.has(definitionId)) accumulator.definitions.set(definitionId, definition);
    hostDefinitions.add(definitionId);
    const registrationId = customizationId("mcp-registration", [hostId, normalizeScope(text(item.scope)), privateSource, alias]);
    const registration: McpServerRegistrationV1 = {
      kind: "mcp-server-registration",
      id: registrationId,
      definitionId,
      hostId,
      scope: normalizeScope(text(item.scope)),
      alias,
      transport,
      enablement: item.enabled === false ? "disabled" : item.enabled === true ? "enabled" : "unspecified",
      environmentKeys,
      headerNames,
      validation: definition.validation,
      source,
      ...(packageId === undefined ? {} : { contributedByPackageId: packageId }),
    };
    accumulator.registrations.set(registrationId, registration);

    if (number(item.toolCount) !== undefined || number(item.resourceCount) !== undefined || item.runtimeEvidence !== undefined || item.sourceKind === "runtime-mcp") {
      const discoveryId = customizationId("mcp-discovery", [registrationId, record(item.runtimeEvidence)?.path ?? privateSource]);
      const toolNames = stringArray(item.toolNames).map((name) => safeText(name, "")).filter(Boolean);
      const discovery: McpServerDiscoveryV1 = {
        kind: "mcp-server-discovery",
        id: discoveryId,
        registrationId,
        status: "partial",
        evidenceSource: "host-cache",
        freshness: "unknown",
        serverInfo: { name: alias, trust: "self-reported" },
        capabilities: {
          ...(number(item.toolCount) === undefined ? {} : { tools: {} }),
          ...(number(item.resourceCount) === undefined ? {} : { resources: {} }),
        },
        catalog: toolNames.map((name) => ({
          kind: "mcp-tool" as const,
          id: customizationId("mcp-tool", [registrationId, name]),
          discoveryId,
          name,
          descriptorDigest: customizationRevision({ registrationId, name }),
        })),
      };
      accumulator.runtimeObservations.set(discoveryId, discovery);
    }
  }
}

function sourceRef(
  item: RawRecord,
  privateSource: string,
  workspaceRoot: string,
  hostId: CustomizationHostId,
  scope: CustomizationScope | "plugin",
): CustomizationSourceRefV1 {
  return {
    evidenceId: customizationId("evidence", privateSource),
    scope,
    logicalPath: safeLogicalPath(privateSource, workspaceRoot, hostId),
    ...(text(item.sourceLabel) === undefined ? {} : { sourceLabel: safeText(text(item.sourceLabel), hostLabel(hostId)) }),
  };
}

async function resolvedPrivateSource(item: RawRecord, fallback: string, resolveSourcePath: (path: string) => Promise<string>): Promise<string> {
  const candidate = text(item.filePath) ?? text(record(item.evidence)?.path) ?? text(item.rootPath);
  return candidate !== undefined && isAbsolute(candidate) ? await resolveSourcePath(candidate) : fallback;
}

function safeLogicalPath(source: string, workspaceRoot: string, hostId: CustomizationHostId): string | undefined {
  if (!isAbsolute(source)) return undefined;
  const workspaceRelative = relative(workspaceRoot, source);
  if (insideRelative(workspaceRelative)) return portableJoin("Workspace", workspaceRelative);
  const userRelative = relative(homedir(), source);
  if (insideRelative(userRelative)) return portableJoin("User", userRelative);
  return portableJoin("External", hostLabel(hostId), basename(source));
}

function insideRelative(value: string): boolean {
  return value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function portableJoin(...values: string[]): string {
  return values.flatMap((value) => value.split(/[\\/]+/u)).filter(Boolean).join("/");
}

function mcpTransport(item: RawRecord): McpTransportDefinitionV1 {
  const rawType = text(item.type)?.toLowerCase();
  const endpoint = text(item.url);
  if (rawType === "sse") return { kind: "legacy-http-sse", ...(endpoint === undefined ? {} : { endpoint: safeEndpoint(endpoint) }), deprecated: true };
  if (endpoint !== undefined || rawType === "http" || rawType === "streamable-http") {
    return { kind: "streamable-http", ...(endpoint === undefined ? {} : { endpoint: safeEndpoint(endpoint) }) };
  }
  if (text(item.command) !== undefined || rawType === "stdio") {
    return {
      kind: "stdio",
      ...(text(item.command) === undefined ? {} : { executable: safeExecutable(text(item.command)!) }),
      ...(Array.isArray(item.args) ? { argumentCount: item.args.length } : {}),
    };
  }
  return rawType === undefined ? { kind: "unknown" } : { kind: "custom", name: safeText(rawType, "unknown") };
}

function safeEndpoint(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "unavailable";
  }
}

function safeExecutable(value: string): string {
  return safeText(value.trim().split(/\s+/u)[0]?.split(/[\\/]/u).filter(Boolean).at(-1), "unavailable");
}

function safeCommandDisplay(value: string | undefined): string | undefined {
  if (value === undefined || /(?:^|\s)(?:~|\/|[A-Za-z]:[\\/])/u.test(value) || /(?:token|secret|password|authorization)/iu.test(value)) {
    return undefined;
  }
  return safeText(value, "") || undefined;
}

function instructionRole(item: RawRecord): InstructionDefinitionV1["instructionRole"] {
  if (item.sourceKind === "agents-md-compat") return "compatibility";
  if (item.sourceKind === "design-md-contract") return "design-contract";
  const name = text(item.name) ?? "";
  if (/\.local\.md$/iu.test(name)) return "local-override";
  if (item.scope === "user") return "host-global";
  if (item.scope === "project") return "project";
  return "host-native-rule";
}

function hookHandlerType(value: string | undefined): "command" | "prompt" | "agent" | "http" | "mcp-tool" | "host-defined" {
  return value === "command" || value === "prompt" || value === "agent" || value === "http" || value === "mcp-tool"
    ? value
    : "host-defined";
}

function pluginFormat(hostId: CustomizationHostId): CustomizationFormatV1 {
  return hostNativeFormat(hostId, "plugin");
}

function hostNativeFormat(hostId: CustomizationHostId, component: string): CustomizationFormatV1 {
  return { id: `${hostId}-${component}-native`, conformance: "host-native" };
}

function partialValidation(code: string, message: string) {
  return { status: "partial" as const, diagnostics: [{ level: "info" as const, code, message }] };
}

function installSource(rawScope: string, plugin: RawRecord): PluginInstallationV1["installSource"] {
  const value = `${rawScope} ${text(plugin.installMatch) ?? ""} ${text(plugin.installSource) ?? ""}`.toLowerCase();
  if (value.includes("bundled")) return "bundled";
  if (value.includes("market") || value.includes("remote") || value.includes("cache")) return "marketplace";
  if (value.includes("local") || value.includes("project") || value.includes("user")) return "local";
  return "unknown";
}

function enablement(value: unknown): PluginInstallationV1["enablement"] {
  return value === true ? "enabled" : value === false ? "disabled" : value === undefined ? "unspecified" : "unknown";
}

function normalizeScope(value: string | undefined): CustomizationScope {
  return value === "user" || value === "project" || value === "plugin" || value === "local" || value === "bundled" || value === "managed"
    ? value
    : "unknown";
}

function hostLabel(hostId: CustomizationHostId): string {
  return hostId in HOST_LABELS ? HOST_LABELS[hostId as keyof typeof HOST_LABELS] : safeText(hostId, "Unknown Host");
}

function safeText(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  return (normalized || fallback).slice(0, 240);
}

function walkJson(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const entry of value) walkJson(entry, visit);
    return;
  }
  const object = record(value);
  if (object === undefined) return;
  for (const [key, entry] of Object.entries(object)) {
    visit(key, entry);
    walkJson(entry, visit);
  }
}

function isPortableLogicalPath(value: string): boolean {
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.length >= 1 && ["Workspace", "User", "External"].includes(segments[0]!)
    && segments.every((segment) => segment !== "" && segment !== ".." && segment !== ".");
}

function record(value: unknown): RawRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : undefined;
}

function records(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is RawRecord => item !== undefined) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function byName(left: PluginPackageV1, right: PluginPackageV1): number {
  return left.manifest.name.localeCompare(right.manifest.name) || left.id.localeCompare(right.id);
}

function byKindAndName(left: CustomizationDefinitionV1, right: CustomizationDefinitionV1): number {
  return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}
