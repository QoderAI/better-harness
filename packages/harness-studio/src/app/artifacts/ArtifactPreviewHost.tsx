import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isArtifactBuildSnapshot,
  type ArtifactBuildSnapshot,
  type ArtifactDescriptor,
} from "../../contracts/artifact.js";
import { ArtifactCodeView } from "../code/ArtifactCodeView.js";
import { useRovingTablist } from "../roving-tablist.js";
import { studioApiError } from "../studio-api.js";
import { useStudioTheme } from "../studio-theme.js";

type PreviewState = "compiling" | "starting" | "ready" | "compile-failed" | "runtime-failed";
type PreviewSurface = "preview" | "source";

/**
 * How long the host waits for the preview document to answer `runtime.init`.
 *
 * Compilation has already finished by then, so the only work left is loading a
 * retained build and executing it. Silence past this point means the frame will
 * never answer — most often because the build it names was evicted and the
 * route returned a JSON error the frame cannot respond from — and an unbounded
 * wait would leave "Starting…" on screen permanently.
 */
const PREVIEW_HANDSHAKE_TIMEOUT_MS = 10_000;

const ARTIFACT_PREVIEW_PANEL_ID = "artifact-preview-panel";

export function ArtifactPreviewHost(props: {
  artifact: ArtifactDescriptor;
  liveGeneration: number;
}): React.JSX.Element {
  const { t } = useTranslation("artifactViewers");
  const [surface, setSurface] = useState<PreviewSurface>("preview");
  const [build, setBuild] = useState<ArtifactBuildSnapshot>();
  const [previewState, setPreviewState] = useState<PreviewState>("compiling");
  const [failure, setFailure] = useState<string>();
  const [source, setSource] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const channelRef = useRef<MessageChannel | undefined>(undefined);
  const handshakeRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestRef = useRef(0);
  const theme = useStudioTheme();
  const tablist = useRovingTablist<PreviewSurface>({ ids: ["preview", "source"], active: surface, onSelect: setSurface, panelId: ARTIFACT_PREVIEW_PANEL_ID });

  useEffect(() => {
    // A newly selected artifact starts from its rendered surface. Failure may
    // subsequently move this exact revision to Source, but that state must not
    // leak into the next artifact selected in the workbench.
    setSurface("preview");
  }, [props.artifact.id]);

  useEffect(() => {
    // A blank failed canvas is a dead end. Keep the failure in the status bar
    // and expose Retry, while moving the main editor surface to the exact
    // source revision so the user still has useful, syntax-aware content.
    if (previewState.endsWith("failed")) setSurface("source");
  }, [previewState]);

  useEffect(() => {
    const buildUri = props.artifact.build?.snapshotUri;
    const request = ++requestRef.current;
    const controller = new AbortController();
    closeChannel(channelRef, handshakeRef);
    setPreviewState("compiling");
    setFailure(undefined);
    setBuild(undefined);
    if (buildUri === undefined) {
      setPreviewState("compile-failed");
      setFailure(t("preview.noBuildReference"));
      return () => controller.abort();
    }
    void fetch(buildUri, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(await studioApiError(response));
      const value: unknown = await response.json();
      if (!isArtifactBuildSnapshot(value)
        || value.artifactId !== props.artifact.id
        || value.revisionId !== props.artifact.revision.id) {
        throw new Error("Artifact build snapshot contract is unsupported.");
      }
      if (request !== requestRef.current) return;
      setBuild(value);
      if (value.status === "failed") {
        setPreviewState("compile-failed");
        setFailure(value.diagnostics[0]?.message ?? t("preview.compileFailed"));
      } else {
        setPreviewState("starting");
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && request === requestRef.current) {
        setPreviewState("compile-failed");
        setFailure(error instanceof Error ? error.message : String(error));
      }
    });
    return () => controller.abort();
  }, [props.artifact.build?.snapshotUri, props.artifact.id, props.artifact.revision.id, props.liveGeneration, attempt]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setSource(undefined);
    void fetch(props.artifact.revision.content.uri, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Artifact source failed (${response.status}).`);
      const text = await response.text();
      if (active) setSource(text);
    }).catch((error: unknown) => {
      if (active && !controller.signal.aborted) setFailure(error instanceof Error ? error.message : String(error));
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [props.artifact.id, props.artifact.revision.content.uri, props.artifact.revision.id]);

  // The preview learns the theme once at handshake time, so a later Studio
  // toggle has to be pushed down the same channel or the frame keeps rendering
  // against the palette that was current when it started.
  useEffect(() => {
    channelRef.current?.port1.postMessage({ type: "runtime.theme", theme });
  }, [theme]);

  useEffect(() => () => closeChannel(channelRef, handshakeRef), []);

  const initializePreview = (): void => {
    const frame = frameRef.current;
    if (build?.status !== "ready" || build.previewUri === undefined || frame?.contentWindow == null) return;
    closeChannel(channelRef, handshakeRef);
    const channel = new MessageChannel();
    channelRef.current = channel;
    const expected = {
      artifactId: build.artifactId,
      revisionId: build.revisionId,
      buildId: build.buildId,
      runtimeId: build.runtime.id,
    };
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isRuntimeMessage(message, expected)) return;
      clearTimeout(handshakeRef.current);
      handshakeRef.current = undefined;
      if (message.type === "renderCompleted") {
        setPreviewState("ready");
        setFailure(undefined);
      } else {
        // A failure can arrive long after a completed render, because a throw
        // in an effect or a handler breaks a preview that already mounted.
        setPreviewState("runtime-failed");
        setFailure(message.message ?? t("preview.runtimeFailed"));
      }
    };
    channel.port1.start();
    setPreviewState("starting");
    handshakeRef.current = setTimeout(() => {
      setPreviewState("runtime-failed");
      setFailure(t("preview.noRenderReport"));
    }, PREVIEW_HANDSHAKE_TIMEOUT_MS);
    frame.contentWindow.postMessage({ ...expected, type: "runtime.init", theme }, "*", [channel.port2]);
  };

  return <section className="artifact-runtime-host" aria-label={t("preview.viewAria", { label: props.artifact.label })}>
    <div className="artifact-runtime-header">
      {/* A tablist may only contain tabs, so the build identity sits beside the
          strip rather than inside it. */}
      <div className="artifact-runtime-tabs" aria-label={t("preview.modeAria")} {...tablist.tablistProps}>
        <button type="button" {...tablist.getTabProps("preview")} onClick={() => setSurface("preview")}>{t("preview.previewTab")}</button>
        <button type="button" {...tablist.getTabProps("source")} onClick={() => setSurface("source")}>{t("preview.sourceTab")}</button>
      </div>
      <span>{build === undefined ? t("preview.noBuild") : t("preview.buildIdentity", { id: shortBuild(build.buildId), sequence: build.sequence })}</span>
    </div>
    <div className="artifact-runtime-panel" id={ARTIFACT_PREVIEW_PANEL_ID} role="tabpanel">
      {surface === "source"
        ? source === undefined
          ? <p className="artifact-status" role="status">{t("preview.loadingSource")}</p>
          : <ArtifactCodeView mode="source" content={source} sourceHint={props.artifact.label} className="artifact-code-preview" label={t("sourceLabel", { label: props.artifact.label })} />
        : build?.status === "ready" && build.previewUri !== undefined
          ? <iframe
            key={build.buildId}
            ref={frameRef}
            className="artifact-frame artifact-runtime-frame"
            title={t("preview.liveTitle", { label: props.artifact.label })}
            src={build.previewUri}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            onLoad={initializePreview}
          />
          : <ArtifactBuildFailure build={build} failure={failure} state={previewState} />}
    </div>
    <div
      className={`artifact-runtime-status state-${previewState}`}
      role={previewState.endsWith("failed") ? "alert" : "status"}
      aria-live="polite"
    >
      <span>{previewStatus(previewState, t, failure)}</span>
      {previewState.endsWith("failed") && <button type="button" className="artifact-runtime-retry" onClick={() => setAttempt((value) => value + 1)}>{t("preview.retry")}</button>}
    </div>
  </section>;
}

function closeChannel(
  channelRef: React.RefObject<MessageChannel | undefined>,
  handshakeRef: React.RefObject<ReturnType<typeof setTimeout> | undefined>,
): void {
  clearTimeout(handshakeRef.current);
  handshakeRef.current = undefined;
  channelRef.current?.port1.close();
  channelRef.current?.port2.close();
  channelRef.current = undefined;
}

function ArtifactBuildFailure(props: {
  build?: ArtifactBuildSnapshot;
  failure?: string;
  state: PreviewState;
}): React.JSX.Element {
  const { t } = useTranslation("artifactViewers");
  if (props.state === "compiling" || props.state === "starting") {
    return <p className="artifact-status" role="status">{previewStatus(props.state, t)}</p>;
  }
  return <div className="artifact-build-diagnostics" role="alert">
    <strong>{props.state === "compile-failed" ? t("preview.buildFailed") : t("preview.previewFailed")}</strong>
    <p>{props.failure ?? t("preview.cannotRender")}</p>
    {(props.build?.diagnostics.length ?? 0) > 0 && <ol>{props.build!.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.source ?? "build"}:${index}`}>
      <code>{diagnostic.source ?? "artifact"}{diagnostic.line === undefined ? "" : `:${diagnostic.line}:${diagnostic.column ?? 0}`}</code>
      <span>{diagnostic.message}</span>
    </li>)}</ol>}
  </div>;
}

function isRuntimeMessage(
  value: unknown,
  expected: { artifactId: string; revisionId: string; buildId: string; runtimeId: string },
): value is typeof expected & { type: "renderCompleted" | "renderFailed"; message?: string } {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return (message.type === "renderCompleted" || message.type === "renderFailed")
    && message.artifactId === expected.artifactId
    && message.revisionId === expected.revisionId
    && message.buildId === expected.buildId
    && message.runtimeId === expected.runtimeId
    && (message.message === undefined || typeof message.message === "string");
}

function previewStatus(state: PreviewState, t: (key: string, options?: Record<string, unknown>) => string, failure?: string): string {
  if (state === "compiling") return t("preview.compiling");
  if (state === "starting") return t("preview.starting");
  if (state === "ready") return t("preview.rendered");
  return failure ?? (state === "compile-failed" ? t("preview.buildFailedStatus") : t("preview.previewFailedStatus"));
}

function shortBuild(value: string): string {
  return `${value.slice(7, 15)}…`;
}
