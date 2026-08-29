import { DebuggerSession } from "../contracts/debugger-session.js";
import { CheckpointSourcePreview, ExperimentLockReceipt } from "../contracts/experiment-setup.js";
import { GitCommitDetail, GitRefsSnapshot } from "../contracts/git-history.js";
import { UserInputTraceV1 } from "../contracts/input-trace.js";
import { StudioProjectDescriptor, StudioProjectKind } from "../contracts/studio-project.js";
import { ArtifactCompileLimits } from "./artifacts/registry/artifact-compile-runtime.js";
import {
  ArtifactAdaptContext,
  ArtifactHostedIntentOutcomeV1,
  ArtifactInteractionPreparedProposalV1,
  ArtifactInteractionProvenanceV1,
  ArtifactInteractionRuntimeImplementation,
  ArtifactInteractionTransitionReceiptV1,
  ExternalArtifactProvider,
} from "./artifacts/registry/artifact-plugin-registry.js";
import { StudioCustomizationCollector } from "./customization-collector.js";
import { lockHistoryExperiment } from "./experiment/lock.js";
import { StudioIntentAnalyzer } from "./intent-analyzer.js";
import { CheckpointHistoryAdapter } from "./query/checkpoint-history.js";
import { ObservedCallIndex } from "./query/observed-call-index.js";
import { SavedRunRecord } from "./run-log.js";
import { StudioSourceCandidate, StudioSourceKind } from "./workspace/source-catalog.js";
import { WorkspaceArtifactSourceObservation } from "./workspace/workspace-artifacts.js";
import { HarnessUiExecutorFactory } from "@qoder-ai/harness-ui";
import { CustomizationAnalysisResponseV1 } from "@qoder-ai/harness/customization";
import { AcpPermissionHandler } from "@qoder-ai/harness/exec";
import { HarnessExperimentCompareSet, RunHarnessExperimentOptions } from "@qoder-ai/harness/experiment";

export interface StudioWorkspaceSessionSummary {
  id: string;
  savedAt: string;
  prompt: string;
  status: "finished" | "error" | "observed";
  toolCallCount: number;
  provider?: string;
  messageCount?: number;
  warningCount?: number;
}
export interface StudioWorkspaceSession {
  summary: StudioWorkspaceSessionSummary;
  debugger: DebuggerSession;
}
export interface StudioWorkspaceProviderDiagnostic {
  provider: string;
  status: "ok" | "no-evidence" | "error";
  discovered: number;
  included: number;
  message?: string;
}
export interface StudioWorkspaceDiscovery {
  label: string;
  sessions: StudioWorkspaceSession[];
  providers?: StudioWorkspaceProviderDiagnostic[];
  /** Privacy-filtered Inspector workbench projection for this workspace. */
  inspectorReport?: Record<string, unknown>;
}
export interface StudioWorkspaceSessionProvider {
  discover(workspacePath: string): Promise<StudioWorkspaceDiscovery>;
}
export interface HarnessStudioServerOptions {
  /** Directory holding the built React app (index.html + assets/). */
  appDir: string;
  /** Self-contained Harness Inspector HTML report mounted read-only at /inspector. */
  inspectorReportPath?: string;
  /** harness-compare evidence directory containing verdict.json. */
  evidenceDir?: string;
  /** `.harness` source text; enables the embedded AG-UI endpoint. */
  harnessSource?: string;
  /** Presentation provenance for the active harness. */
  harnessMode?: "configured" | "workspace-default";
  harnessId?: string;
  runtimeId?: string;
  cwd?: string;
  /** Root a `source`-backed skill's path is locked and delivered against. */
  sourceRoot?: string;
  /** Durable directory for saved Debugger run records (default: .harness-studio-runs under cwd). */
  runDirectory?: string;
  /** Directory of run-produced artifacts exposed read-only under /api/artifacts. */
  artifactDirectory?: string;
  /** Optional portable paths below artifactDirectory; omitted for a flat compatibility catalog. */
  artifactPaths?: readonly string[];
  /** Provisioned Canvas format viewers (default: $QODER_HOME/canvas/canvases). */
  canvasViewerRoot?: string;
  /** Canvas SDK checkout used to host trusted format viewers. */
  canvasSdkRoot?: string;
  /** Prebuilt Canvas SDK media directory containing canvas-sdk.js and index-canvas.html. */
  canvasSdkMedia?: string;
  /** Studio-private external Artifact activation state root. */
  artifactProviderStateRoot?: string;
  /** Explicit local Provider implementations supplied by an embedding application. */
  artifactProviders?: readonly ExternalArtifactProvider[];
  /** Bounded numeric policy overrides for Studio-owned code compilation. */
  artifactCompileLimits?: Partial<ArtifactCompileLimits>;
  /** Studio-owned Walnut cache root; defaults to the platform cache location. */
  walnutCacheRoot?: string;
  /** Additional bounded source candidates selectable from inside Studio. */
  sourceCatalog?: StudioSourceCandidate[];
  executorFactory?: HarnessUiExecutorFactory;
  /** Explicit local ACP Agent. The browser can select it but cannot alter its command or argv. */
  acpAgent?: StudioAcpAgentOptions;
  /** Server-owned selectable ACP Agent catalog, including unavailable known presets. */
  acpAgents?: readonly StudioAcpAgentProfile[];
  /** `harness-experiment.v1` manifest; enables the live three-lane trace view. */
  experimentManifestPath?: string;
  /** Runtime-only trajectory sources, useful for previewing imported host history before it is copied. */
  experimentTrajectoryOverrides?: Record<string, string>;
  /** Adapter-owned browser projection; omitted to use the built-in session-plan adapter. */
  checkpointSourcePreview?: CheckpointSourcePreview;
  /** Optional source-owned history adapter; its opaque ids are the browser contract. */
  checkpointHistoryAdapter?: CheckpointHistoryAdapter;
  /** File-backed first adapter, used when no injected history adapter is supplied. */
  checkpointHistoryCatalogPath?: string;
  /** Durable root for content-addressed locked experiment definitions. */
  experimentLockDirectory?: string;
  /** Test/embedder seam; defaults to the durable content-addressed locker. */
  experimentLocker?: typeof lockHistoryExperiment;
  experimentOutputDirectory?: string;
  experimentRunner?: (options: RunHarnessExperimentOptions) => Promise<HarnessExperimentCompareSet>;
  /** In-process Inspector-style workspace-to-Session discovery capability. */
  workspaceSessionProvider?: StudioWorkspaceSessionProvider;
  /** Test/embedder seam for the server-owned native working-directory chooser. */
  workspaceDirectoryPicker?: () => Promise<string | undefined>;
  /** Optional semantic claim provider. Results are accepted only after local contract validation. */
  intentAnalyzer?: StudioIntentAnalyzer;
  /** On-demand local customization collector. Constructing the server never invokes it. */
  customizationCollector?: StudioCustomizationCollector;
}
export interface StudioAcpAgentOptions {
  command: string;
  args?: readonly string[];
  label?: string;
  env?: NodeJS.ProcessEnv;
  /** Optional ACP-specific Harness source; workspace-default Studio uses its built-in source. */
  harnessSource?: string;
  harnessId?: string;
  runtimeId?: string;
  /** Whether Studio applies the manifest lane model or retains the Agent's configured default. */
  modelPolicy?: "lane" | "agent-default";
}
export interface StudioAcpAgentProfile {
  id: string;
  label: string;
  /** Omitted when the known Agent or its ACP bridge is unavailable on this host. */
  agent?: StudioAcpAgentOptions;
  unavailableReason?: string;
}
export interface ArtifactImportSession {
  directory: string;
  fileCount: number;
  totalBytes: number;
  labels: Set<string>;
  expiry: NodeJS.Timeout;
}
export interface WorkspaceImportSession {
  directory: string;
  fileCount: number;
  totalBytes: number;
  paths: Set<string>;
  label: string;
  expiry: NodeJS.Timeout;
  busy: boolean;
  expired: boolean;
}
export interface StudioWorkspace {
  label: string;
  sessionCount: number;
  omittedCount: number;
  sessions: Map<string, StoredWorkspaceSession>;
  providers: StudioWorkspaceProviderDiagnostic[];
  inspectorReport?: Record<string, unknown>;
  inputTrace?: UserInputTraceV1;
  /** Server-only execution root for the selected local project. Never serialized. */
  localDirectory?: string;
  /** Current workspace files supported by retained change/deliver evidence. */
  artifactObservations?: WorkspaceArtifactSourceObservation[];
  /** Canonical server-only repository root. Never serialized. */
  gitRoot?: string;
  /** Ref snapshot shared by refs and log requests until the next explicit refresh. */
  gitRefs?: GitRefsSnapshot;
  /** Small immutable-detail cache used by commit and patch routes. */
  gitCommitCache?: Map<string, GitCommitDetail>;
  ownedDirectory?: string;
}
export interface StoredWorkspaceSession extends StudioWorkspaceSession {
  retainedRun?: SavedRunRecord;
}
export interface StoredStudioProject {
  descriptor: StudioProjectDescriptor;
  kind: StudioProjectKind;
  /** Canonical server-only directory for a remembered local Project. */
  localDirectory?: string;
  /** Imported workspaces retain their bounded materialization until removal. */
  importedWorkspace?: StudioWorkspace;
}
export interface StudioProjectRevisionContext {
  projectId: string;
  /** Canonical server-only execution root captured when this revision was active. */
  localDirectory: string;
}
export interface HarnessStudioState {
  sourceCatalog: StudioSourceCandidate[];
  activeSources: Partial<Record<StudioSourceKind, string>>;
  activeManifestPath?: string;
  templateManifestPath?: string;
  trajectoryOverrides?: Record<string, string>;
  historyAdapter?: CheckpointHistoryAdapter;
  lockReceipt?: ExperimentLockReceipt;
  observedIndexes: Map<string, ObservedCallIndex>;
  artifactDirectory?: string;
  artifactPaths?: readonly string[];
  ownedArtifactDirectory?: string;
  artifactImports: Map<string, ArtifactImportSession>;
  artifactEventStreams: number;
  artifactAgentRuns: Map<string, ArtifactAgentRunControl>;
  artifactIntentAdmissions: Map<string, ArtifactHostedIntentAdmissionState>;
  artifactInteractionProposals: Map<string, ArtifactInteractionProposalState>;
  workspace?: StudioWorkspace;
  projects: Map<string, StoredStudioProject>;
  activeProjectId?: string;
  projectRevision: number;
  /** Bounded recent revision bindings keep completed runs in their starting Project. */
  projectRevisionContexts: Map<number, StudioProjectRevisionContext>;
  workspaceImports: Map<string, WorkspaceImportSession>;
  workspaceOpenStage: "idle" | "choosing" | "discovering" | "removing";
  intentAnalysisRunning: boolean;
  customizationAnalysisRunning: boolean;
  customizationAnalysis?: CustomizationAnalysisResponseV1;
  acpRuns: Map<string, AcpRunControl>;
}
export interface ArtifactAgentRunControl {
  artifactId: string;
  revision: string;
  abortController: AbortController;
  startedAtMs: number;
}
export interface ArtifactHostedIntentAdmissionState {
  authorityId: string;
  artifactId: string;
  revision: string;
  bindingId: string;
  intentId: string;
  requestDigest: string;
  promise: Promise<ArtifactHostedIntentOutcomeV1>;
  outcome?: ArtifactHostedIntentOutcomeV1;
  failure?: { code: string; status: number; message: string };
  createdAtMs: number;
  expiresAtMs: number;
}
export interface ArtifactInteractionProposalState {
  artifactId: string;
  revision: string;
  providerId: string;
  contributionId: string;
  providerFingerprint: string;
  context: ArtifactAdaptContext;
  runtime: ArtifactInteractionRuntimeImplementation;
  prepared: ArtifactInteractionPreparedProposalV1;
  provenance?: ArtifactInteractionProvenanceV1;
  createdAtMs: number;
  expiresAtMs: number;
  settling?: {
    decision: "approve" | "reject";
    decisionId: string;
    actorId: string;
    promise: Promise<ArtifactInteractionTransitionReceiptV1>;
  };
  terminal?: {
    decision: "approve" | "reject";
    decisionId: string;
    actorId: string;
    receipt: ArtifactInteractionTransitionReceiptV1;
  };
}
export interface AcpRunControl {
  abortController: AbortController;
  pendingPermissions: Map<string, AcpPendingPermission>;
}
interface AcpPendingPermission {
  optionIds: Set<string>;
  settle: (response: Awaited<ReturnType<AcpPermissionHandler>>) => void;
}
