export const CUSTOMIZATION_CATALOG_KIND = "BetterHarnessCustomizationCatalogV1" as const;
export const CUSTOMIZATION_SCHEMA_VERSION = "better-harness.customization/v1" as const;

export type CustomizationDigest = `sha256:${string}`;
export type CustomizationHostId = "codex" | "claude" | "qoder" | (string & {});
export type CustomizationScope = "user" | "project" | "plugin" | "local" | "bundled" | "managed" | "unknown";

/** Browser-safe evidence handle. Native absolute paths remain server-private. */
export interface CustomizationSourceRefV1 {
  evidenceId: string;
  scope: CustomizationScope;
  /** A portable, privacy-safe label such as `Workspace/.agents/skills/review`. */
  logicalPath?: string;
  sourceLabel?: string;
}

export interface CustomizationRevisionV1 {
  revisionId: CustomizationDigest;
  declaredVersion?: string;
  sourceRevision?: string;
  entryDigest?: CustomizationDigest;
  contentDigest?: CustomizationDigest;
  treeDigest?: CustomizationDigest;
  completeness: "complete" | "partial" | "unknown";
}

export interface CustomizationValidationV1 {
  status: "valid" | "invalid" | "partial";
  diagnostics: Array<{
    level: "info" | "warning" | "error";
    code: string;
    message: string;
  }>;
}

export interface CustomizationFormatV1 {
  id: string;
  version?: string;
  conformance: "standard" | "host-native" | "unknown";
}

interface CustomizationDefinitionBaseV1<K extends string> {
  kind: K;
  id: string;
  name: string;
  description?: string;
  format: CustomizationFormatV1;
  revision: CustomizationRevisionV1;
  source: CustomizationSourceRefV1;
  validation: CustomizationValidationV1;
}

export interface InstructionDefinitionV1 extends CustomizationDefinitionBaseV1<"instruction"> {
  instructionRole:
    | "host-global"
    | "project"
    | "local-override"
    | "compatibility"
    | "design-contract"
    | "host-native-rule";
  appliesTo?: { pathPatterns: string[] };
  precedence?: string;
  composition: "append" | "override" | "host-defined";
}

export interface AgentSkillDefinitionV1 extends CustomizationDefinitionBaseV1<"agent-skill"> {
  entry: { mediaType: "text/markdown"; digest?: CustomizationDigest };
  resources: Array<{
    ref: string;
    role: "script" | "reference" | "asset" | "other";
    digest?: CustomizationDigest;
    mediaType?: string;
  }>;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  declaredToolPolicy?: { raw: string; experimental: true };
}

export interface PromptCommandDefinitionV1 extends CustomizationDefinitionBaseV1<"prompt-command"> {
  invocationName: string;
  invocation: {
    user: "allowed" | "disallowed" | "unknown";
    model: "allowed" | "disallowed" | "unknown";
    visible: "visible" | "hidden" | "unknown";
    argumentHint?: string;
  };
  toolPolicyDigest?: CustomizationDigest;
  modelPolicy?: string;
}

export interface AgentDefinitionV1 extends CustomizationDefinitionBaseV1<"agent-definition"> {
  modelSelector?: string;
  toolPolicy?: { allow?: string[]; deny?: string[] };
  skillRefs: string[];
  mcpRegistrationRefs: string[];
  hookRefs: string[];
  permissionPolicy?: string;
  resourceLimits?: { maxTurns?: number; timeoutMs?: number };
  isolation: "same-context" | "child-context" | "worktree" | "host-defined" | "unknown";
}

export type HookHandlerV1 =
  | { type: "command"; actionDigest: CustomizationDigest; safeDisplay?: string }
  | { type: "prompt"; actionDigest: CustomizationDigest }
  | { type: "agent"; actionDigest: CustomizationDigest }
  | { type: "http"; actionDigest: CustomizationDigest }
  | { type: "mcp-tool"; actionDigest: CustomizationDigest }
  | { type: "host-defined"; actionDigest: CustomizationDigest };

export interface HookDefinitionV1 extends CustomizationDefinitionBaseV1<"hook"> {
  event: { namespace: CustomizationHostId; name: string };
  matcher?: string;
  conditionDigest?: CustomizationDigest;
  handler: HookHandlerV1;
  timeoutMs?: number;
  async?: boolean;
  order?: number;
}

export type McpTransportDefinitionV1 =
  | { kind: "stdio"; executable?: string; argumentCount?: number }
  | { kind: "streamable-http"; endpoint?: string }
  | { kind: "legacy-http-sse"; endpoint?: string; deprecated: true }
  | { kind: "custom"; name: string }
  | { kind: "unknown"; rawType?: string };

export interface McpServerDefinitionV1 extends CustomizationDefinitionBaseV1<"mcp-server-definition"> {
  transport: McpTransportDefinitionV1;
  environmentKeys: string[];
  headerNames: string[];
  secretRisk: "none-observed" | "direct-secret-observed" | "unknown";
}

export type CustomizationDefinitionV1 =
  | InstructionDefinitionV1
  | AgentSkillDefinitionV1
  | PromptCommandDefinitionV1
  | AgentDefinitionV1
  | HookDefinitionV1
  | McpServerDefinitionV1;

export interface PluginPackageV1 {
  kind: "agent-plugin-package";
  id: string;
  format: CustomizationFormatV1;
  manifest: {
    name: string;
    displayName?: string;
    declaredVersion?: string;
    description?: string;
    authorName?: string;
  };
  revision: CustomizationRevisionV1;
  source: CustomizationSourceRefV1;
  validation: CustomizationValidationV1;
}

export interface PluginInstallationV1 {
  kind: "plugin-installation";
  id: string;
  packageId: string;
  hostId: CustomizationHostId;
  scope: CustomizationScope;
  installSource: "bundled" | "marketplace" | "local" | "unknown";
  installedRevisionId?: CustomizationDigest;
  enablement: "enabled" | "disabled" | "unspecified" | "unknown";
  applicability: "applicable" | "not-applicable" | "unknown";
  source: CustomizationSourceRefV1;
}

export interface HostExposureV1 {
  kind: "host-exposure";
  id: string;
  definitionId: string;
  hostId: CustomizationHostId;
  scope: CustomizationScope;
  discovery: "valid" | "invalid" | "skipped" | "unsupported" | "unknown";
  enablement: "enabled" | "disabled" | "inherited" | "unspecified" | "unknown";
  availability: "available" | "unavailable" | "unknown";
  activation: "observed" | "not-observed" | "unknown";
  execution: "observed" | "not-observed" | "unknown";
  invocation?: {
    user: "allowed" | "disallowed" | "unknown";
    model: "allowed" | "disallowed" | "unknown";
  };
  contributedByPackageId?: string;
  source: CustomizationSourceRefV1;
}

export interface McpServerRegistrationV1 {
  kind: "mcp-server-registration";
  id: string;
  definitionId: string;
  hostId: CustomizationHostId;
  scope: CustomizationScope;
  alias: string;
  transport: McpTransportDefinitionV1;
  enablement: "enabled" | "disabled" | "unspecified";
  environmentKeys: string[];
  headerNames: string[];
  validation: CustomizationValidationV1;
  source: CustomizationSourceRefV1;
  contributedByPackageId?: string;
}

export interface McpToolDescriptorV1 {
  kind: "mcp-tool";
  id: string;
  discoveryId: string;
  name: string;
  title?: string;
  description?: string;
  descriptorDigest: CustomizationDigest;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface HostCollectionObservationV1 {
  kind: "host-collection";
  id: string;
  hostId: CustomizationHostId;
  status: "ok" | "partial" | "error" | "unsupported";
  observedAt: string;
  message?: string;
  counts: { packages: number; definitions: number; registrations: number };
}

export interface McpServerDiscoveryV1 {
  kind: "mcp-server-discovery";
  id: string;
  registrationId: string;
  status: "succeeded" | "partial" | "failed";
  evidenceSource: "live-rpc" | "host-cache" | "host-state";
  observedAt?: string;
  freshness: "current" | "within-ttl" | "expired" | "unknown";
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string; trust: "self-reported" };
  capabilities?: {
    tools?: { listChanged?: boolean };
    resources?: { listChanged?: boolean; subscribe?: boolean };
    prompts?: { listChanged?: boolean };
  };
  catalog: McpToolDescriptorV1[];
}

export type RuntimeObservationV1 =
  | HostCollectionObservationV1
  | McpServerDiscoveryV1;

export interface CustomizationCatalogV1 {
  kind: typeof CUSTOMIZATION_CATALOG_KIND;
  schemaVersion: typeof CUSTOMIZATION_SCHEMA_VERSION;
  generatedAt: string;
  workspace: { label: string; evidenceId: string };
  hosts: Array<{
    id: CustomizationHostId;
    label: string;
    status: "ok" | "partial" | "error" | "unsupported";
  }>;
  packages: PluginPackageV1[];
  definitions: CustomizationDefinitionV1[];
  installations: PluginInstallationV1[];
  exposures: HostExposureV1[];
  registrations: McpServerRegistrationV1[];
  runtimeObservations: RuntimeObservationV1[];
}

export interface CustomizationCatalogSummaryV1 {
  packageCount: number;
  definitionCount: number;
  installationCount: number;
  exposureCount: number;
  registrationCount: number;
  runtimeObservationCount: number;
  definitionsByKind: Record<CustomizationDefinitionV1["kind"], number>;
  hosts: Array<{
    id: CustomizationHostId;
    label: string;
    status: "ok" | "partial" | "error" | "unsupported";
    definitions: number;
    packages: number;
    registrations: number;
  }>;
}

export interface CustomizationAnalysisResponseV1 {
  catalog: CustomizationCatalogV1;
  summary: CustomizationCatalogSummaryV1;
}
