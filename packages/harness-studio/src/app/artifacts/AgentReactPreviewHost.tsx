import { useEffect, useRef, useState } from "react";
import {
  isArtifactBuildSnapshot,
  type ArtifactBuildSnapshot,
  type ArtifactDescriptor,
} from "../../contracts/artifact.js";
import { ArtifactCodeView } from "../code/ArtifactCodeView.js";
import { useRovingTablist } from "../roving-tablist.js";
import { studioApiError } from "../studio-api.js";
import { useStudioTheme } from "../studio-theme.js";
import {
  AGENT_REACT_SHOW_SOURCE_ACTION,
  grantedAgentReactCapabilities,
  isAgentReactFrameRequest,
  stageAgentReactState,
  type AgentReactStateSlot,
  validateAgentReactStateValue,
} from "./AgentReactHostServices.js";

type PreviewState = "compiling" | "starting" | "ready" | "compile-failed" | "runtime-failed";
type PreviewSurface = "preview" | "source";

const HANDSHAKE_TIMEOUT_MS = 10_000;
const PANEL_ID = "agent-react-preview-panel";
const OBSERVATION_EVENT = "harness.artifact-observation";

interface FrameSession {
  readonly build: ArtifactBuildSnapshot;
  readonly channel: MessageChannel;
  readonly frameToken: string;
  readonly generation: number;
  mode: "dry-run" | "live";
  stateSlots: Map<string, AgentReactStateSlot>;
  timeout?: ReturnType<typeof setTimeout>;
}

/** Production AgentReact Surface: one visible Current plus one hidden Staging frame. */
export function AgentReactPreviewHost(props: {
  artifact: ArtifactDescriptor;
  liveGeneration: number;
}): React.JSX.Element {
  const [surface, setSurface] = useState<PreviewSurface>("preview");
  const [current, setCurrent] = useState<ArtifactBuildSnapshot>();
  const [staging, setStaging] = useState<ArtifactBuildSnapshot>();
  const [previewState, setPreviewState] = useState<PreviewState>("compiling");
  const [failure, setFailure] = useState<string>();
  const [source, setSource] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const sessions = useRef(new Map<string, FrameSession>());
  const initializeFrameRef = useRef<(build: ArtifactBuildSnapshot) => void>(() => undefined);
  const currentRef = useRef<ArtifactBuildSnapshot | undefined>(undefined);
  const stagingRef = useRef<ArtifactBuildSnapshot | undefined>(undefined);
  const stateSlots = useRef(new Map<string, AgentReactStateSlot>());
  const generation = useRef(0);
  const observationSequence = useRef(0);
  const theme = useStudioTheme();
  const tablist = useRovingTablist<PreviewSurface>({
    ids: ["preview", "source"],
    active: surface,
    onSelect: setSurface,
    panelId: PANEL_ID,
  });

  const record = (build: ArtifactBuildSnapshot, kind: string, detail?: Record<string, unknown>): void => {
    observationSequence.current += 1;
    window.dispatchEvent(new CustomEvent(OBSERVATION_EVENT, { detail: {
      type: "CUSTOM",
      name: OBSERVATION_EVENT,
      value: {
        kind,
        sequence: observationSequence.current,
        artifactDigest: build.agentReact!.artifactDigest,
        buildDigest: build.agentReact!.buildDigest,
        ...(detail === undefined ? {} : { detail }),
      },
    } }));
  };

  const closeSession = (buildId: string): void => {
    const session = sessions.current.get(buildId);
    if (session === undefined) return;
    clearTimeout(session.timeout);
    session.channel.port1.close();
    session.channel.port2.close();
    sessions.current.delete(buildId);
  };

  const rejectStaging = (build: ArtifactBuildSnapshot, reason: string): void => {
    if (stagingRef.current?.buildId !== build.buildId) return;
    closeSession(build.buildId);
    stagingRef.current = undefined;
    setStaging(undefined);
    setPreviewState("runtime-failed");
    setFailure(reason);
    record(build, "renderFailed", { phase: "staging", reason });
    if (currentRef.current === undefined) setSurface("source");
  };

  const failCurrent = (build: ArtifactBuildSnapshot, reason: string): void => {
    if (currentRef.current?.buildId !== build.buildId) return;
    closeSession(build.buildId);
    currentRef.current = undefined;
    setCurrent(undefined);
    setPreviewState("runtime-failed");
    setFailure(reason);
    setSurface("source");
    record(build, "renderFailed", { phase: "current", reason });
  };

  const promote = (session: FrameSession): void => {
    if (stagingRef.current?.buildId !== session.build.buildId || session.generation !== generation.current) return;
    clearTimeout(session.timeout);
    session.timeout = undefined;
    const outgoing = currentRef.current;
    stateSlots.current = new Map(session.stateSlots);
    session.mode = "live";
    session.channel.port1.postMessage({
      type: "runtime.promote",
      buildDigest: session.build.agentReact!.buildDigest,
      frameToken: session.frameToken,
    });
    currentRef.current = session.build;
    stagingRef.current = undefined;
    setCurrent(session.build);
    setStaging(undefined);
    setPreviewState("ready");
    setFailure(undefined);
    record(session.build, "renderCompleted", { phase: "committed" });
    if (outgoing !== undefined && outgoing.buildId !== session.build.buildId) closeSession(outgoing.buildId);
  };

  const postResult = (session: FrameSession, message: Record<string, unknown>): void => {
    session.channel.port1.postMessage({
      ...message,
      buildDigest: session.build.agentReact!.buildDigest,
      frameToken: session.frameToken,
    });
  };

  const handleStateSet = (session: FrameSession, message: Record<string, unknown>): void => {
    const requestId = Number(message.requestId);
    const path = message.path;
    if (typeof path !== "string") return;
    const declaration = session.build.agentReact!.view.state.find((entry) => entry.path === path);
    if (session.mode !== "live" || currentRef.current?.buildId !== session.build.buildId) {
      postResult(session, { type: "state.result", requestId, path, ok: false, reason: "A staging or stale frame cannot write Artifact state." });
      record(session.build, "stateValidationFailed", { path, reason: "not-live" });
      return;
    }
    if (declaration === undefined) {
      postResult(session, { type: "state.result", requestId, path, ok: false, reason: "State path is not declared." });
      record(session.build, "stateValidationFailed", { path, reason: "not-declared" });
      return;
    }
    const validated = validateAgentReactStateValue(declaration.schema, declaration.version, message.value);
    if (!validated.ok) {
      postResult(session, { type: "state.result", requestId, path, ok: false, reason: validated.reason });
      record(session.build, "stateValidationFailed", { path, reason: validated.reason });
      return;
    }
    const slot = { schema: declaration.schema, version: declaration.version, value: validated.value };
    session.stateSlots.set(path, slot);
    stateSlots.current.set(path, slot);
    postResult(session, { type: "state.result", requestId, path, ok: true, value: validated.value });
  };

  const handleAction = (session: FrameSession, message: Record<string, unknown>): void => {
    const requestId = Number(message.requestId);
    const capability = message.capability;
    if (typeof capability !== "string") return;
    record(session.build, "actionAttempted", { capability, actionMode: session.mode });
    const declared = session.build.agentReact!.view.capabilities.includes(capability);
    const granted = grantedAgentReactCapabilities(session.build.agentReact!.view.capabilities).includes(capability);
    if (!declared || !granted) {
      const reason = !declared ? "Action capability is not declared by this build." : "Action capability is refused by Host policy.";
      postResult(session, { type: "action.result", requestId, outcome: { status: "denied", reason } });
      record(session.build, "actionDenied", { capability, reason });
      return;
    }
    if (session.mode === "dry-run") {
      postResult(session, { type: "action.result", requestId, outcome: { status: "dry-run" } });
      return;
    }
    if (currentRef.current?.buildId !== session.build.buildId) {
      const reason = "Action frame is stale.";
      postResult(session, { type: "action.result", requestId, outcome: { status: "denied", reason } });
      record(session.build, "actionDenied", { capability, reason });
      return;
    }
    if (capability === AGENT_REACT_SHOW_SOURCE_ACTION) {
      setSurface("source");
      postResult(session, { type: "action.result", requestId, outcome: { status: "completed", result: { surface: "source" } } });
    }
  };

  const initializeFrame = (build: ArtifactBuildSnapshot): void => {
    if (stagingRef.current?.buildId !== build.buildId || build.agentReact === undefined) return;
    const frame = frames.current.get(build.buildId);
    if (frame?.contentWindow == null) return;
    // The child can announce readiness more than once across browser lifecycle
    // events. A build owns exactly one channel, so duplicate readiness must not
    // invalidate the port that is already executing the verified bundle.
    if (sessions.current.has(build.buildId)) return;
    const channel = new MessageChannel();
    const staged = stageAgentReactState(build.agentReact.view.state, stateSlots.current);
    const session: FrameSession = {
      build,
      channel,
      frameToken: crypto.randomUUID(),
      generation: generation.current,
      mode: "dry-run",
      stateSlots: new Map(staged.slots),
    };
    sessions.current.set(build.buildId, session);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (isRuntimeReport(message, build, session.frameToken)) {
        if (message.type === "renderCompleted") {
          if (session.mode === "dry-run") {
            record(build, "renderCompleted", { phase: "staging" });
            promote(session);
          }
        } else if (session.mode === "live") {
          failCurrent(build, message.message ?? "The committed AgentReact build failed at runtime.");
        } else {
          rejectStaging(build, message.message ?? "AgentReact preview failed at runtime.");
        }
        return;
      }
      if (!isAgentReactFrameRequest(message)
        || message.buildDigest !== build.agentReact!.buildDigest
        || message.frameToken !== session.frameToken) return;
      if (message.type === "state.set") handleStateSet(session, message);
      else handleAction(session, message);
    };
    channel.port1.start();
    session.timeout = setTimeout(() => rejectStaging(build, "The AgentReact staging frame did not report a render before its deadline."), HANDSHAKE_TIMEOUT_MS);
    frame.contentWindow.postMessage({
      type: "runtime.init",
      artifactId: build.artifactId,
      revisionId: build.revisionId,
      buildId: build.buildId,
      runtimeId: build.runtime.id,
      agentReact: build.agentReact,
      frameToken: session.frameToken,
      actionMode: "dry-run",
      state: staged.values,
      grantedCapabilities: grantedAgentReactCapabilities(build.agentReact.view.capabilities),
      theme,
    }, "*", [channel.port2]);
  };
  initializeFrameRef.current = initializeFrame;

  useEffect(() => {
    const acceptReadyFrame = (event: MessageEvent<unknown>): void => {
      const build = stagingRef.current;
      if (build === undefined || !isRuntimeReady(event.data, build)) return;
      const frame = frames.current.get(build.buildId);
      if (frame?.contentWindow == null || event.source !== frame.contentWindow) return;
      initializeFrameRef.current(build);
    };
    window.addEventListener("message", acceptReadyFrame);
    return () => window.removeEventListener("message", acceptReadyFrame);
  }, []);

  useEffect(() => {
    const buildUri = props.artifact.build?.snapshotUri;
    const controller = new AbortController();
    generation.current += 1;
    const mine = generation.current;
    if (stagingRef.current !== undefined
      && stagingRef.current.buildId !== currentRef.current?.buildId) closeSession(stagingRef.current.buildId);
    stagingRef.current = undefined;
    setStaging(undefined);
    setPreviewState("compiling");
    setFailure(undefined);
    if (buildUri === undefined) {
      setPreviewState("compile-failed");
      setFailure("The AgentReact Artifact has no build reference.");
      return () => controller.abort();
    }
    void fetch(buildUri, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(await studioApiError(response));
      const value: unknown = await response.json();
      if (!isArtifactBuildSnapshot(value)
        || value.artifactId !== props.artifact.id
        || value.revisionId !== props.artifact.revision.id
        || (value.status === "ready" && value.agentReact === undefined)) {
        throw new Error("AgentReact build snapshot contract is unsupported.");
      }
      if (mine !== generation.current) return;
      if (value.status === "failed") {
        setPreviewState("compile-failed");
        setFailure(value.diagnostics[0]?.message ?? "AgentReact compilation failed.");
        if (currentRef.current === undefined) setSurface("source");
        return;
      }
      if (currentRef.current?.buildId === value.buildId) {
        stagingRef.current = undefined;
        setStaging(undefined);
        setPreviewState("ready");
        setFailure(undefined);
        return;
      }
      stagingRef.current = value;
      setStaging(value);
      setPreviewState("starting");
    }).catch((error: unknown) => {
      if (controller.signal.aborted || mine !== generation.current) return;
      setPreviewState("compile-failed");
      setFailure(error instanceof Error ? error.message : String(error));
      if (currentRef.current === undefined) setSurface("source");
    });
    return () => controller.abort();
  }, [props.artifact.build?.snapshotUri, props.artifact.id, props.artifact.revision.id, props.liveGeneration, attempt]);

  useEffect(() => {
    const controller = new AbortController();
    setSource(undefined);
    void fetch(props.artifact.revision.content.uri, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Artifact source failed (${response.status}).`);
      setSource(await response.text());
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : String(error));
    });
    return () => controller.abort();
  }, [props.artifact.id, props.artifact.revision.content.uri, props.artifact.revision.id]);

  useEffect(() => {
    for (const session of sessions.current.values()) session.channel.port1.postMessage({ type: "runtime.theme", theme });
  }, [theme]);

  useEffect(() => () => {
    generation.current += 1;
    for (const buildId of [...sessions.current.keys()]) closeSession(buildId);
  }, []);

  const builds = [current, staging].filter((build, index, all): build is ArtifactBuildSnapshot =>
    build !== undefined && all.findIndex((candidate) => candidate?.buildId === build.buildId) === index);
  const displayedBuild = staging ?? current;

  return <section className="artifact-runtime-host agent-react-runtime-host" aria-label={`AgentReact view: ${props.artifact.label}`}>
    <div className="artifact-runtime-header">
      <div className="artifact-runtime-tabs" aria-label="Artifact view mode" {...tablist.tablistProps}>
        <button type="button" {...tablist.getTabProps("preview")} onClick={() => setSurface("preview")}>Preview</button>
        <button type="button" {...tablist.getTabProps("source")} onClick={() => setSurface("source")}>Source</button>
      </div>
      <span>{displayedBuild === undefined ? "No build" : `${displayedBuild.agentReact?.view.id ?? "AgentReact"} · build ${displayedBuild.sequence}`}</span>
    </div>
    <div className="artifact-runtime-panel agent-react-runtime-panel" id={PANEL_ID} role="tabpanel">
      {builds.map((build) => <iframe
        key={build.buildId}
        ref={(element) => {
          if (element === null) frames.current.delete(build.buildId);
          else frames.current.set(build.buildId, element);
        }}
        className={`artifact-frame artifact-runtime-frame agent-react-frame${build.buildId === current?.buildId && surface === "preview" ? " is-current" : " is-staging"}`}
        title={`${build.buildId === staging?.buildId ? "Staging" : "Live"} AgentReact preview: ${props.artifact.label}`}
        src={build.previewUri}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        aria-hidden={build.buildId !== current?.buildId || surface !== "preview"}
      />)}
      {surface === "source" && (source === undefined
        ? <p className="artifact-status" role="status">Loading source…</p>
        : <ArtifactCodeView mode="source" content={source} sourceHint={props.artifact.label} className="artifact-code-preview" label={`Artifact source: ${props.artifact.label}`} />)}
      {surface === "preview" && current === undefined && <p className="artifact-status agent-react-starting" role="status">{failure ?? "Verifying AgentReact build in an isolated staging frame…"}</p>}
    </div>
    <div className={`artifact-runtime-status state-${previewState}`} role={previewState.endsWith("failed") ? "alert" : "status"} aria-live="polite">
      <span>{statusText(previewState, failure, current !== undefined)}</span>
      {previewState.endsWith("failed") && <button type="button" className="artifact-runtime-retry" onClick={() => setAttempt((value) => value + 1)}>Retry</button>}
    </div>
  </section>;
}

function isRuntimeReady(value: unknown, build: ArtifactBuildSnapshot): boolean {
  if (typeof value !== "object" || value === null || build.agentReact === undefined) return false;
  const message = value as Record<string, unknown>;
  return message.type === "runtime.ready"
    && message.artifactId === build.artifactId
    && message.revisionId === build.revisionId
    && message.buildId === build.buildId
    && message.runtimeId === build.runtime.id
    && message.agentReact !== null
    && typeof message.agentReact === "object"
    && (message.agentReact as Record<string, unknown>).buildDigest === build.agentReact.buildDigest;
}

function isRuntimeReport(
  value: unknown,
  build: ArtifactBuildSnapshot,
  frameToken: string,
): value is { type: "renderCompleted" | "renderFailed"; message?: string } {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return (message.type === "renderCompleted" || message.type === "renderFailed")
    && message.artifactId === build.artifactId
    && message.revisionId === build.revisionId
    && message.buildId === build.buildId
    && message.runtimeId === build.runtime.id
    && message.frameToken === frameToken
    && message.agentReact !== null
    && typeof message.agentReact === "object"
    && (message.agentReact as Record<string, unknown>).buildDigest === build.agentReact?.buildDigest
    && (message.message === undefined || typeof message.message === "string");
}

function statusText(state: PreviewState, failure: string | undefined, retained: boolean): string {
  if (state === "compiling") return retained ? "Compiling the next AgentReact revision; Current remains live." : "Compiling AgentReact revision…";
  if (state === "starting") return retained ? "Verifying the next build; Current remains live." : "Verifying AgentReact staging frame…";
  if (state === "ready") return "AgentReact build committed from isolated staging.";
  if (failure !== undefined && retained) return `${failure} Current remains on the last verified build.`;
  return failure ?? "AgentReact build failed.";
}
