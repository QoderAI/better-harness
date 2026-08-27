import { describe, expect, it } from "vitest";
import type { Digest } from "../../src/agent-react/contracts/index.js";
import {
  createFrameInitMessage,
  FRAME_PROTOCOL_VERSION,
  isMatchingInit,
  isReportFor,
  renderFailedReport,
} from "../../src/agent-react/host/frames/frame-protocol.js";

const snapshot = {
  buildDigest: "sha256:build" as Digest,
  artifactDigest: "sha256:artifact" as Digest,
  artifactId: "orders.dashboard",
  buildGeneration: 1,
  compilerVersion: "oxc-test",
  profileVersion: "1",
  runtimeVersion: "1",
  buildPolicyDigest: "sha256:policy" as Digest,
  status: "ready" as const,
  bundle: "",
  sourceMaps: [],
  semanticIndex: [],
  diagnostics: [],
};

describe("AgentReact frame protocol", () => {
  it("owns the init state and matches the complete frame identity", () => {
    const state = { "/orders": { rows: [] as unknown[] } };
    const message = createFrameInitMessage({
      snapshot,
      actionMode: "dry-run",
      frameToken: "token",
      state,
    });
    state["/orders"].rows.push("late mutation");

    expect(Object.isFrozen(message)).toBe(true);
    expect(message.state).toEqual({ "/orders": { rows: [] } });
    expect(isMatchingInit(message, {
      buildDigest: snapshot.buildDigest,
      artifactDigest: snapshot.artifactDigest,
      frameToken: "token",
      actionMode: "dry-run",
    })).toBe(true);
    expect(isMatchingInit({ ...message, actionMode: "live" }, {
      buildDigest: snapshot.buildDigest,
      artifactDigest: snapshot.artifactDigest,
      frameToken: "token",
      actionMode: "dry-run",
    })).toBe(false);
  });

  it("rejects malformed failure reports instead of trusting their shape", () => {
    expect(isReportFor({
      type: "renderFailed",
      protocol: FRAME_PROTOCOL_VERSION,
      buildDigest: snapshot.buildDigest,
    }, snapshot.buildDigest)).toBe(false);
    expect(isReportFor({
      type: "renderFailed",
      protocol: FRAME_PROTOCOL_VERSION,
      buildDigest: snapshot.buildDigest,
      message: "x".repeat(601),
    }, snapshot.buildDigest)).toBe(false);
    expect(isReportFor(renderFailedReport(snapshot.buildDigest, "x".repeat(700)), snapshot.buildDigest)).toBe(true);
  });
});
