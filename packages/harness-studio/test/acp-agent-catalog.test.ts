import { describe, expect, it } from "vitest";
import {
  acpAgentInBox,
  boxNameForWorkspace,
  discoverAcpAgentProfiles,
  findExecutable,
  publicAcpAgentProfiles,
} from "../src/server/acp-agent-catalog.js";

describe("Studio ACP Agent catalog", () => {
  it("discovers protocol entrypoints without treating their underlying CLIs as ACP", async () => {
    const existing = new Set(["/tools/qodercli", "/tools/codex-acp"]);
    const profiles = await discoverAcpAgentProfiles({
      env: { PATH: "/tools:/other" },
      platform: "darwin",
      accessPath: async (path) => { if (!existing.has(path)) throw new Error("missing"); },
    });

    expect(profiles.find((profile) => profile.id === "qodercli")?.agent).toMatchObject({
      command: "/tools/qodercli",
      args: ["--acp"],
    });
    expect(profiles.find((profile) => profile.id === "codex-acp")?.agent?.command).toBe("/tools/codex-acp");
    expect(profiles.find((profile) => profile.id === "pi")).toMatchObject({
      unavailableReason: expect.stringContaining("pi CLI alone"),
    });
    expect(profiles.find((profile) => profile.id === "pi")?.agent).toBeUndefined();
    expect(profiles.find((profile) => profile.id === "claude-acp")).toMatchObject({
      unavailableReason: expect.stringContaining("claude CLI alone"),
    });
    expect(profiles.find((profile) => profile.id === "claude-acp")?.agent).toBeUndefined();
  });

  it("uses Windows PATH and PATHEXT semantics without a shell", async () => {
    const candidate = await findExecutable("qodercli", {
      env: { Path: "C:\\Tools;D:\\Bin", PATHEXT: ".EXE;.CMD" },
      platform: "win32",
      accessPath: async (path) => { if (path !== "C:\\Tools\\qodercli.cmd") throw new Error("missing"); },
    });

    expect(candidate).toBe("C:\\Tools\\qodercli.cmd");
  });

  it("promotes an explicitly configured DSH ACP entrypoint and keeps commands server-only", async () => {
    const profiles = await discoverAcpAgentProfiles({
      explicit: { command: "/opt/dsh/bin/dsh", args: ["acp"], label: "Team DSH" },
      env: { PATH: "" },
      platform: "linux",
      accessPath: async () => { throw new Error("missing"); },
    });
    const projection = publicAcpAgentProfiles({ appDir: "/app", acpAgents: profiles, acpAgent: profiles.find((profile) => profile.id === "dsh")!.agent });

    expect(projection.defaultAgentId).toBe("dsh");
    expect(projection.agents.find((profile) => profile.id === "dsh")).toEqual({
      id: "dsh",
      label: "Team DSH",
      available: true,
      modelPolicy: "agent-default",
      detail: "Available · ACP v1 stdio · uses Agent default model",
      // No shim is staged in this projection, so the reason is the build's and
      // not the Agent's.
      boxAvailable: false,
      boxDetail: "This Studio build has no microVM shim staged.",
    });
    expect(JSON.stringify(projection)).not.toContain("/opt/dsh/bin/dsh");
  });

  it("offers a box placement only to Agents with a recipe, independent of local installation", async () => {
    const profiles = await discoverAcpAgentProfiles({
      env: { PATH: "" },
      platform: "darwin",
      // Nothing is installed on this machine, which must not decide boxability:
      // a box installs the Agent itself.
      accessPath: async () => { throw new Error("missing"); },
    });
    const projection = publicAcpAgentProfiles({ appDir: "/app", acpAgents: profiles, boxExecExecutable: "/native/harness-box-exec" });
    const agent = (id: string) => projection.agents.find((profile) => profile.id === id)!;

    expect(agent("pi").available).toBe(false);
    expect(agent("pi").boxAvailable).toBe(true);
    expect(agent("claude-acp").boxAvailable).toBe(true);
    expect(agent("qodercli").boxAvailable).toBe(false);
    expect(agent("qodercli").boxDetail).toContain("macOS arm64 binary");
    // The host default is not boxable, so a box run needs its own default.
    expect(projection.defaultBoxAgentId).toBe("pi");
  });

  it("builds a box command that mounts the Project and installs the Agent in the guest", async () => {
    const profiles = await discoverAcpAgentProfiles({ env: { PATH: "" }, platform: "darwin", accessPath: async () => { throw new Error("missing"); } });
    const pi = profiles.find((profile) => profile.id === "pi")!;
    const placed = acpAgentInBox(
      { command: "pi-acp", label: "Pi ACP" },
      pi.box!,
      { shim: "/native/harness-box-exec", cwd: "/work/better-harness" },
    );

    expect(placed.command).toBe("/native/harness-box-exec");
    expect(placed.args).toContain("--mount");
    // Mounted at its own path, so ACP's absolute host paths stay valid in the guest.
    expect(placed.args).toContain("/work/better-harness:/work/better-harness");
    expect(placed.args?.at(-1)).toBe("pi-acp");
    expect(placed.args?.join(" ")).toContain("npm install -g --ignore-scripts @earendil-works/pi-coding-agent pi-acp");
    // Egress is an allow-list, so the registry and the provider are both named.
    expect(placed.args?.join(" ")).toContain("registry.npmjs.org");
    expect(placed.args?.join(" ")).toContain("api.anthropic.com");
  });

  it("names one box per Project so a second session reuses the first's install", () => {
    const name = boxNameForWorkspace("/work/better-harness");

    expect(name).toBe(boxNameForWorkspace("/work/better-harness"));
    expect(name).not.toBe(boxNameForWorkspace("/work/other-project"));
    expect(name).toMatch(/^harness-better-harness-[a-z0-9]+$/);
  });
});
