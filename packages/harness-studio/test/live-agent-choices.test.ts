import { describe, expect, it } from "vitest";
import {
  liveAgentChoices,
  liveRunEndpoint,
  LOCAL_AGENT_CHOICE,
  resolveLiveAgentChoice,
} from "../src/app/run/live-agent-choices.js";

const LABELS = { local: "Qoder SDK · Harness stream", defaultAcp: "ACP Agent · ACP v1" };
const CATALOG = [
  { id: "qodercli", label: "Qoder CLI", available: true, detail: "Available · ACP v1 stdio · uses Agent default model" },
  { id: "pi", label: "Pi ACP", available: false, detail: "pi-acp is not installed." },
  { id: "codex-acp", label: "Codex ACP", available: true, detail: "Available · ACP v1 stdio · uses lane model" },
];

describe("live run Agent choices", () => {
  it("offers the loaded local harness ahead of every registered ACP Agent", () => {
    const choices = liveAgentChoices({ localRunEnabled: true, acpEnabled: true, agents: CATALOG, labels: LABELS });
    expect(choices.map((choice) => choice.value)).toEqual([
      LOCAL_AGENT_CHOICE,
      "acp:qodercli",
      "acp:pi",
      "acp:codex-acp",
    ]);
    expect(choices[1]).toEqual({
      value: "acp:qodercli",
      label: "Qoder CLI",
      available: true,
      detail: "Available · ACP v1 stdio · uses Agent default model",
    });
  });

  it("omits the local harness when no harness is loaded", () => {
    const choices = liveAgentChoices({ localRunEnabled: false, acpEnabled: true, agents: CATALOG, labels: LABELS });
    expect(choices.map((choice) => choice.value)).toEqual(["acp:qodercli", "acp:pi", "acp:codex-acp"]);
  });

  it("keeps a registered but unavailable Agent visible and unselectable", () => {
    const choices = liveAgentChoices({ localRunEnabled: false, acpEnabled: true, agents: CATALOG, labels: LABELS });
    const unavailable = choices.find((choice) => choice.value === "acp:pi");
    expect(unavailable).toMatchObject({ available: false, detail: "pi-acp is not installed." });
    expect(resolveLiveAgentChoice(choices, "acp:pi")?.value).toBe("acp:qodercli");
  });

  it("falls back to one server-default ACP choice when the host publishes no catalog", () => {
    const choices = liveAgentChoices({ localRunEnabled: true, acpEnabled: true, labels: LABELS });
    expect(choices.map((choice) => choice.value)).toEqual([LOCAL_AGENT_CHOICE, "acp:"]);
    expect(liveRunEndpoint(choices[1]!, { run: "/api/runs/stream", acp: "/api/acp/runs/stream" }))
      .toBe("/api/acp/runs/stream");
  });

  it("offers nothing to run when neither a harness nor an ACP Agent is available", () => {
    const choices = liveAgentChoices({ localRunEnabled: false, acpEnabled: false, labels: LABELS });
    expect(choices).toEqual([]);
    expect(resolveLiveAgentChoice(choices, LOCAL_AGENT_CHOICE)).toBeUndefined();
  });

  it("resolves explicit choices and defaults to an available ACP Agent", () => {
    const choices = liveAgentChoices({ localRunEnabled: true, acpEnabled: true, agents: CATALOG, labels: LABELS });
    expect(resolveLiveAgentChoice(choices, "acp:codex-acp")?.label).toBe("Codex ACP");
    expect(resolveLiveAgentChoice(choices, "")?.value).toBe("acp:qodercli");
    expect(resolveLiveAgentChoice(choices, LOCAL_AGENT_CHOICE)?.value).toBe(LOCAL_AGENT_CHOICE);
    expect(resolveLiveAgentChoice(choices, "acp:unknown")?.value).toBe("acp:qodercli");
  });

  it("names the selected Agent in the ACP stream request and leaves the local run untouched", () => {
    const choices = liveAgentChoices({ localRunEnabled: true, acpEnabled: true, agents: CATALOG, labels: LABELS });
    const endpoints = { run: "/api/runs/stream", acp: "/api/acp/runs/stream" };
    expect(liveRunEndpoint(choices[0]!, endpoints)).toBe("/api/runs/stream");
    expect(liveRunEndpoint(choices[1]!, endpoints)).toBe("/api/acp/runs/stream?agent=qodercli");
    expect(liveRunEndpoint(choices[3]!, endpoints)).toBe("/api/acp/runs/stream?agent=codex-acp");
  });

  it("has no ACP target when the host disabled the ACP stream", () => {
    const choices = liveAgentChoices({ localRunEnabled: true, acpEnabled: true, agents: CATALOG, labels: LABELS });
    expect(liveRunEndpoint(choices[1]!, { run: "/api/runs/stream" })).toBeUndefined();
  });
});
