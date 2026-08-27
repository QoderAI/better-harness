import type { ActionMode, BuildSnapshot } from "../../contracts/index.js";
import { cloneAndFreezePlainData } from "../data-ownership.js";

/**
 * The frame handshake contract.
 *
 * The transport is intentionally not decided here. A real Studio frame is an
 * `<iframe sandbox="allow-scripts">` without `allow-same-origin` — the browser
 * then treats it as an opaque origin that cannot reach Studio's cookies, storage,
 * or DOM — and the Host transfers a private `MessagePort` after the first
 * `postMessage`. The in-process factory used by this POC speaks the same messages
 * so the transport can be swapped without touching the Host or the controller.
 */

export const FRAME_PROTOCOL_VERSION = "agent-react/1";
export const FRAME_INIT_MESSAGE = "artifact.runtime.init";
export const FRAME_RENDER_COMPLETED = "renderCompleted";
export const FRAME_RENDER_FAILED = "renderFailed";

export interface FrameIdentity {
  readonly buildDigest: string;
  readonly artifactDigest: string;
  readonly frameToken: string;
  readonly actionMode: ActionMode;
}

export interface FrameInitMessage extends FrameIdentity {
  readonly type: typeof FRAME_INIT_MESSAGE;
  readonly protocol: typeof FRAME_PROTOCOL_VERSION;
  readonly actionMode: ActionMode;
  readonly state: Readonly<Record<string, unknown>>;
}

export function createFrameInitMessage(input: {
  readonly snapshot: BuildSnapshot;
  readonly actionMode: ActionMode;
  readonly frameToken: string;
  readonly state: Readonly<Record<string, unknown>>;
}): FrameInitMessage {
  return cloneAndFreezePlainData({
    type: FRAME_INIT_MESSAGE,
    protocol: FRAME_PROTOCOL_VERSION,
    buildDigest: input.snapshot.buildDigest,
    artifactDigest: input.snapshot.artifactDigest,
    frameToken: input.frameToken,
    actionMode: input.actionMode,
    state: input.state,
  }, "Frame init message");
}

/**
 * A frame must reject an init it was not built for.
 *
 * An opaque origin cannot serve as an identity, so verifying the sender proves
 * only "something that can reach this frame". Matching the protocol version, both
 * digests, and the frame token is what makes a stale or crossed handshake — the
 * common case when a build is superseded mid-stage — fail closed instead of
 * mounting the wrong bundle.
 */
export function isMatchingInit(message: unknown, expected: FrameIdentity): boolean {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<FrameInitMessage>;
  return candidate.type === FRAME_INIT_MESSAGE
    && candidate.protocol === FRAME_PROTOCOL_VERSION
    && candidate.buildDigest === expected.buildDigest
    && candidate.artifactDigest === expected.artifactDigest
    && candidate.frameToken === expected.frameToken
    && candidate.actionMode === expected.actionMode
    && typeof candidate.state === "object"
    && candidate.state !== null
    && !Array.isArray(candidate.state);
}

export type FrameReport =
  | { readonly type: typeof FRAME_RENDER_COMPLETED; readonly protocol: string; readonly buildDigest: string }
  | { readonly type: typeof FRAME_RENDER_FAILED; readonly protocol: string; readonly buildDigest: string; readonly message: string };

export function renderCompletedReport(buildDigest: string): FrameReport {
  return { type: FRAME_RENDER_COMPLETED, protocol: FRAME_PROTOCOL_VERSION, buildDigest };
}

export function renderFailedReport(buildDigest: string, message: string): FrameReport {
  return {
    type: FRAME_RENDER_FAILED,
    protocol: FRAME_PROTOCOL_VERSION,
    buildDigest,
    message: message.slice(0, 600),
  };
}

/** A report from the wrong build is not evidence about this one. */
export function isReportFor(report: unknown, buildDigest: string): report is FrameReport {
  if (typeof report !== "object" || report === null) return false;
  const candidate = report as Partial<FrameReport>;
  return candidate.protocol === FRAME_PROTOCOL_VERSION
    && candidate.buildDigest === buildDigest
    && (candidate.type === FRAME_RENDER_COMPLETED
      || (candidate.type === FRAME_RENDER_FAILED
        && typeof candidate.message === "string"
        && candidate.message.length <= 600));
}
