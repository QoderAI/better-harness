/** Versioned JSON intermediate representation for Harness DSL v0.3. */
import { type Static, Type } from "@sinclair/typebox";

export const LANGUAGE_VERSION = "0.3";
export const IR_VERSION = "0.3.0";

const IrVersion = Type.Literal(IR_VERSION);
const Identifier = Type.String({ pattern: "^[_a-zA-Z][\\w-]*$" });
const QualifiedIdentifier = Type.String({ pattern: "^[_a-zA-Z][\\w-]*(\\.[_a-zA-Z][\\w-]*)*$" });

export const STANDARD_TOOL_CONTRACTS: Readonly<Record<string, string>> = Object.freeze({
  "workspace.read": "builtin:workspace.read@1",
  "workspace.glob": "builtin:workspace.glob@1",
  "workspace.search": "builtin:workspace.search@1",
  "workspace.edit": "builtin:workspace.edit@1",
  "workspace.write": "builtin:workspace.write@1",
  "process.exec": "builtin:process.exec@1",
});

export const CapabilityKindSchema = Type.Union([
  Type.Literal("skill"),
  Type.Literal("tool"),
  Type.Literal("mcp"),
]);
export type CapabilityKind = Static<typeof CapabilityKindSchema>;

export const SkillIrSchema = Type.Object(
  {
    irVersion: IrVersion,
    kind: Type.Literal("skill"),
    id: QualifiedIdentifier,
    source: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type SkillIr = Static<typeof SkillIrSchema>;

export const ToolIrSchema = Type.Object(
  {
    irVersion: IrVersion,
    kind: Type.Literal("tool"),
    id: QualifiedIdentifier,
    contract: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    implicit: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ToolIr = Static<typeof ToolIrSchema>;

export const McpEndpointIrSchema = Type.Union([
  Type.Object(
    { type: Type.Literal("env"), variable: Identifier },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("literal"), value: Type.String() },
    { additionalProperties: false },
  ),
]);
export type McpEndpointIr = Static<typeof McpEndpointIrSchema>;

export const McpIrSchema = Type.Object(
  {
    irVersion: IrVersion,
    kind: Type.Literal("mcp"),
    id: QualifiedIdentifier,
    transport: Type.Union([Type.Literal("stdio"), Type.Literal("http"), Type.Literal("sse")]),
    url: Type.Optional(McpEndpointIrSchema),
    command: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type McpIr = Static<typeof McpIrSchema>;

export type CapabilityIr = SkillIr | ToolIr | McpIr;

export const WorkflowEventSchema = Type.Object(
  { agent: Identifier, outcome: Identifier, to: Identifier },
  { additionalProperties: false },
);
export type WorkflowEvent = Static<typeof WorkflowEventSchema>;

export const WorkflowStopSchema = Type.Object(
  { agent: Identifier, outcome: Identifier },
  { additionalProperties: false },
);
export type WorkflowStop = Static<typeof WorkflowStopSchema>;

export const WorkflowModeSchema = Type.Union([
  Type.Literal("session"),
  Type.Literal("state-machine"),
  Type.Literal("programmatic"),
]);
export type WorkflowMode = Static<typeof WorkflowModeSchema>;

export const WorkflowIrSchema = Type.Object(
  {
    irVersion: IrVersion,
    kind: Type.Literal("workflow"),
    id: Identifier,
    mode: WorkflowModeSchema,
    entry: Type.Optional(Identifier),
    events: Type.Array(WorkflowEventSchema),
    stops: Type.Array(WorkflowStopSchema),
    program: Type.Optional(
      Type.Object(
        { language: Identifier, entry: Type.String() },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type WorkflowIr = Static<typeof WorkflowIrSchema>;

export const RuntimeIrSchema = Type.Object(
  {
    irVersion: IrVersion,
    kind: Type.Literal("runtime"),
    id: Identifier,
    adapter: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type RuntimeIr = Static<typeof RuntimeIrSchema>;

export const CapabilityRequirementIrSchema = Type.Object(
  {
    capabilityId: QualifiedIdentifier,
    capabilityKind: CapabilityKindSchema,
  },
  { additionalProperties: false },
);
export type CapabilityRequirementIr = Static<typeof CapabilityRequirementIrSchema>;

export const AgentIrSchema = Type.Object(
  {
    id: Identifier,
    outcomes: Type.Array(Identifier),
    requirements: Type.Array(CapabilityRequirementIrSchema),
  },
  { additionalProperties: false },
);
export type AgentIr = Static<typeof AgentIrSchema>;

export const HarnessSpecIrSchema = Type.Object(
  {
    irVersion: IrVersion,
    kind: Type.Literal("harness-spec"),
    id: Identifier,
    workflow: Identifier,
    agents: Type.Array(AgentIrSchema),
  },
  { additionalProperties: false },
);
export type HarnessSpecIr = Static<typeof HarnessSpecIrSchema>;

export const DeploymentIrSchema = Type.Object(
  {
    irVersion: IrVersion,
    kind: Type.Literal("deployment"),
    id: Identifier,
    harness: Identifier,
    runtime: Identifier,
  },
  { additionalProperties: false },
);
export type DeploymentIr = Static<typeof DeploymentIrSchema>;

export const HarnessIrBundleSchema = Type.Object(
  {
    irVersion: IrVersion,
    kind: Type.Literal("harness-ir-bundle"),
    skills: Type.Array(SkillIrSchema),
    tools: Type.Array(ToolIrSchema),
    mcps: Type.Array(McpIrSchema),
    workflows: Type.Array(WorkflowIrSchema),
    runtimes: Type.Array(RuntimeIrSchema),
    harnesses: Type.Array(HarnessSpecIrSchema),
    deployments: Type.Array(DeploymentIrSchema),
  },
  { additionalProperties: false },
);
export type HarnessIrBundle = Static<typeof HarnessIrBundleSchema>;

export const RealizationDimensionSchema = Type.Union([
  Type.Literal("delivered"),
  Type.Literal("exposed"),
  Type.Literal("connected"),
  Type.Literal("orchestrated"),
]);
export type RealizationDimension = Static<typeof RealizationDimensionSchema>;

export const RealizationSchema = Type.Object(
  {
    agentId: Identifier,
    capabilityId: QualifiedIdentifier,
    capabilityKind: CapabilityKindSchema,
    dimension: RealizationDimensionSchema,
    state: Type.Union([Type.Literal("satisfied"), Type.Literal("failed")]),
    mechanism: Type.Union([Type.String(), Type.Null()]),
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type Realization = Static<typeof RealizationSchema>;

/** Immutable content lock for one source-backed capability. */
export const SourceLockSchema = Type.Object(
  {
    capabilityId: QualifiedIdentifier,
    uri: Type.String(),
    digest: Type.String(),
    files: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type SourceLock = Static<typeof SourceLockSchema>;

export const HarnessRevisionSchema = Type.Object(
  {
    irVersion: IrVersion,
    kind: Type.Literal("harness-revision"),
    revisionId: Type.String({ pattern: "^hr_[0-9a-f]{32}$" }),
    harness: Type.Object(
      { id: Identifier, contentHash: Type.String() },
      { additionalProperties: false },
    ),
    deployment: Type.Object(
      { id: Identifier, contentHash: Type.String() },
      { additionalProperties: false },
    ),
    target: Type.Object(
      {
        runtime: Identifier,
        adapter: Type.String(),
        adapterSpecificationVersion: Type.String(),
        adapterImplementationVersion: Type.String(),
        adapterDescriptorHash: Type.String(),
      },
      { additionalProperties: false },
    ),
    workflow: Type.Object(
      { id: Identifier, mode: WorkflowModeSchema, contentHash: Type.String() },
      { additionalProperties: false },
    ),
    resolved: Type.Object(
      {
        capabilities: Type.Array(
          Type.Object(
            { id: QualifiedIdentifier, kind: CapabilityKindSchema, contentHash: Type.String() },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    agents: Type.Array(
      Type.Object(
        { id: Identifier, capabilities: Type.Array(QualifiedIdentifier) },
        { additionalProperties: false },
      ),
    ),
    realization: Type.Array(RealizationSchema),
    sourceLocks: Type.Array(SourceLockSchema),
    componentSnapshotRef: Type.Optional(Type.Object(
      { snapshotId: Type.String(), digest: Type.String() },
      { additionalProperties: false },
    )),
  },
  { additionalProperties: false },
);
export type HarnessRevision = Static<typeof HarnessRevisionSchema>;

export const ResolutionReportSchema = Type.Object(
  {
    irVersion: IrVersion,
    kind: Type.Literal("resolution-report"),
    harnessId: Identifier,
    deploymentId: Type.Optional(Identifier),
    runtime: Identifier,
    status: Type.Union([Type.Literal("resolved"), Type.Literal("failed")]),
    realizations: Type.Array(RealizationSchema),
    errors: Type.Array(Type.String()),
    warnings: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export type ResolutionReport = Static<typeof ResolutionReportSchema>;

export const CapabilityMaterializationSchema = Type.Object(
  {
    capabilityId: QualifiedIdentifier,
    capabilityKind: CapabilityKindSchema,
    dimension: RealizationDimensionSchema,
    state: Type.Literal("materialized"),
    mechanism: Type.String(),
    detail: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type CapabilityMaterialization = Static<typeof CapabilityMaterializationSchema>;

export const HarnessMaterializationReceiptSchema = Type.Object(
  {
    irVersion: IrVersion,
    kind: Type.Literal("materialization-receipt"),
    revisionId: Type.String({ pattern: "^hr_[0-9a-f]{32}$" }),
    adapter: Type.Object(
      { id: Type.String(), specificationVersion: Type.String() },
      { additionalProperties: false },
    ),
    capabilities: Type.Array(CapabilityMaterializationSchema),
    workflow: Type.Object(
      {
        id: Identifier,
        dimension: Type.Literal("orchestrated"),
        requestedMode: WorkflowModeSchema,
        realizedMode: WorkflowModeSchema,
        state: Type.Literal("materialized"),
      },
      { additionalProperties: false },
    ),
    warnings: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export type HarnessMaterializationReceipt = Static<typeof HarnessMaterializationReceiptSchema>;

export function findCapability(
  bundle: HarnessIrBundle,
  capabilityId: string,
): CapabilityIr | undefined {
  return (
    bundle.skills.find((skill) => skill.id === capabilityId) ??
    bundle.tools.find((tool) => tool.id === capabilityId) ??
    bundle.mcps.find((mcp) => mcp.id === capabilityId)
  );
}
