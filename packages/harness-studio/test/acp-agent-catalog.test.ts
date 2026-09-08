import { describe, expect, it } from "vitest";
import {
  discoverAcpAgentProfiles,
  findExecutable,
  publicAcpAgentProfiles,
} from "../src/server/acp-agent-catalog.js";

describe("Studio ACP Agent catalog", () => {
  it.each([
    { platform: "darwin" as const, env: { PATH: "/tools" }, command: "/tools/dsh" },
    { platform: "linux" as const, env: { PATH: "/tools" }, command: "/tools/dsh" },
    { platform: "win32" as const, env: { Path: "C:\\Tools", PATHEXT: ".EXE;.CMD" }, command: "C:\\Tools\\dsh.cmd" },
  ])("discovers the native DSH ACP profile on $platform", async ({ platform, env, command }) => {
    const profiles = await discoverAcpAgentProfiles({ env, platform, accessPath: async path => { if (path !== command) throw new Error("missing"); } });
    expect(profiles.find(profile => profile.id === "dsh")?.agent).toEqual({ command, args: ["--profile", "acp"], label: "DSH ACP", modelPolicy: "agent-default" });
    expect(publicAcpAgentProfiles({ appDir: "/app", acpAgents: profiles }).agents.find(profile => profile.id === "dsh")?.available).toBe(true);
    expect(JSON.stringify(publicAcpAgentProfiles({ appDir: "/app", acpAgents: profiles }))).not.toContain(command);
  });

  it("keeps DSH unavailable when its executable is absent", async () => {
    const profiles = await discoverAcpAgentProfiles({ env: { PATH: "" } });
    expect(profiles.find(profile => profile.id === "dsh")).toEqual({ id: "dsh", label: "DSH ACP", unavailableReason: expect.stringContaining("not installed") });
  });

  it("preserves explicitly configured Windows DSH arguments", async () => {
    const explicit = { command: "C:\\Team Tools\\dsh.cmd", args: ["--profile", "team-acp"], label: "Team DSH" };
    const profiles = await discoverAcpAgentProfiles({ explicit, platform: "win32", env: { PATH: "" } });
    expect(profiles.find(profile => profile.id === "dsh")?.agent).toEqual({ ...explicit, modelPolicy: "agent-default" });
    expect(profiles).toHaveLength(5);
  });
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
    });
    expect(JSON.stringify(projection)).not.toContain("/opt/dsh/bin/dsh");
  });
});
