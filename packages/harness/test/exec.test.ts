import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileHarness } from "../src/compiler/compile.js";
import type { HarnessIrBundle, HarnessRevision } from "../src/ir/index.js";
import type { AdapterRealizationDescriptor } from "../src/resolver/adapter-descriptor.js";
import { resolveHarness } from "../src/resolver/resolve.js";
import { lockCapabilitySources } from "../src/resolver/source-lock.js";
import { prepareMaterialization } from "../src/exec/materialization.js";
import { PiSdkAdapter, PiSdkExecutor, materializePiPackage, type PiSdkLike } from "../src/exec/pi-sdk.js";
import {
  QoderSdkAdapter,
  QoderSdkExecutor,
  type QoderSdkLike,
  type QoderSdkMessage,
} from "../src/exec/qoder-sdk.js";

const SOURCE = `
  language 0.3
  skill impact-analysis {
    description "Impact analysis: map the blast radius before editing."
  }
  skill verification-before-complete {
    description "Do not complete without verification evidence."
  }
  tool workspace.read {
    contract "builtin:workspace.read@1"
    description "Read files inside the workspace."
  }
  workflow solo-loop {
    session coder
  }
  harness assembly {
    workflow solo-loop
    agent coder {
      use skill impact-analysis
      use skill verification-before-complete
    }
  }
  harness tooled {
    workflow solo-loop
    agent coder {
      use skill impact-analysis
      require tool workspace.read
    }
  }
  runtime qoder { adapter "@harness/adapter-qoder" }
  runtime pi { adapter "@harness/adapter-pi" }
  deployment assembly-qoder { harness assembly runtime qoder }
  deployment assembly-pi { harness assembly runtime pi }
  deployment tooled-qoder { harness tooled runtime qoder }
  deployment tooled-pi { harness tooled runtime pi }
`;

function descriptorFor(runtimeId: string): AdapterRealizationDescriptor {
  return runtimeId === "qoder" ? new QoderSdkAdapter().describe() : new PiSdkAdapter().describe();
}

async function resolveFor(
  runtimeId: string,
  harnessId = "assembly",
  adapter = descriptorFor(runtimeId),
): Promise<{ bundle: HarnessIrBundle; revision: HarnessRevision }> {
  const { bundle } = await compileHarness(SOURCE);
  const { revision, report } = resolveHarness(bundle!, harnessId, runtimeId, { adapter });
  expect(report.errors).toEqual([]);
  return { bundle: bundle!, revision: revision! };
}

interface FakeQoderSession {
  /** One entry per `query()` call: a new entry means a new host context. */
  queries: Parameters<QoderSdkLike["query"]>[0][];
  /** Text of every user message the host received, across all queries. */
  prompts: string[];
  interrupts: number;
  closes: number;
}

function newFakeSession(): FakeQoderSession {
  return { queries: [], prompts: [], interrupts: 0, closes: 0 };
}

/**
 * A test double shaped like the official Query lifecycle: one `query()` per
 * session, a streamed async iterable of user messages, and `interrupt`/`close`
 * control. `reply` decides what the host answers for one user message.
 */
function fakeQoderSdk(
  state: FakeQoderSession,
  reply: (text: string, turn: number, state: FakeQoderSession) => QoderSdkMessage[] = defaultReply,
  auth: unknown = {},
  /** Model a host that terminates the query stream after answering one message. */
  endsAfterFirstReply = false,
): QoderSdkLike {
  return {
    qodercliAuth: () => auth,
    query: (params) => {
      state.queries.push(params);
      const messages = (async function* (): AsyncGenerator<QoderSdkMessage> {
        if (typeof params.prompt === "string") {
          state.prompts.push(params.prompt);
          yield* reply(params.prompt, state.prompts.length, state);
          return;
        }
        for await (const message of params.prompt) {
          const text = message.message.content;
          state.prompts.push(text);
          yield* reply(text, state.prompts.length, state);
          if (endsAfterFirstReply) {
            return;
          }
        }
      })();
      return {
        [Symbol.asyncIterator]: () => messages,
        interrupt: async () => {
          state.interrupts += 1;
          return undefined;
        },
        close: async () => {
          state.closes += 1;
        },
      };
    },
  };
}

function defaultReply(_text: string, turn: number): QoderSdkMessage[] {
  return [
    { type: "assistant", message: { content: [{ type: "text", text: `turn-${turn}` }] } },
    { type: "result", subtype: "success", session_id: "session-1" },
  ];
}

describe("QoderSdkExecutor", () => {
  it("streams one Qoder SDK query with explicit auth, cwd, and tool authorization", async () => {
    const state = newFakeSession();
    const auth = { kind: "test-auth" };
    const abortController = new AbortController();
    const canUseTool = async () => ({ behavior: "allow" as const });
    const streamedTrace: unknown[] = [];
    const executor = new QoderSdkExecutor({
      loadSdk: async () => fakeQoderSdk(state, defaultReply, auth),
      allowedTools: ["Read"],
      tools: ["Read", "Bash"],
      disallowedTools: ["WebFetch"],
      permissionMode: "default",
      canUseTool,
      model: "test-model",
      enableFileCheckpointing: true,
      abortController,
      onTraceEvent: (event) => streamedTrace.push(event),
      maxTurns: 12,
    });
    const { bundle, revision } = await resolveFor("qoder", "assembly", executor.describe());

    const result = await executor.execute(revision, bundle, { prompt: "Fix the bug", cwd: "/tmp" });

    expect(state.queries).toHaveLength(1);
    expect(state.queries[0].options).toEqual({
      auth,
      cwd: "/tmp",
      allowedTools: ["Read"],
      tools: ["Read", "Bash"],
      disallowedTools: ["WebFetch"],
      permissionMode: "default",
      canUseTool,
      persistSession: false,
      maxTurns: 12,
      model: "test-model",
      enableFileCheckpointing: true,
      includePartialMessages: true,
      abortController,
    });
    // Multi-turn queries take an async iterable of user messages, not a string.
    expect(typeof state.queries[0].prompt).not.toBe("string");
    expect(state.prompts).toHaveLength(1);
    expect(state.prompts[0].endsWith("Fix the bug")).toBe(true);
    expect(state.prompts[0]).toContain(revision.revisionId);
    expect(state.prompts[0]).toContain("Impact analysis: map the blast radius before editing.");
    expect(result).toMatchObject({
      host: "qoder",
      exitCode: 0,
      output: "turn-1",
      runtimeReceipt: {
        executor: "@qoder-ai/qoder-agent-sdk",
        tools: ["Read", "Bash"],
        allowedTools: ["Read"],
        disallowedTools: ["WebFetch"],
        permissionMode: "default",
        maxTurns: 12,
        model: "test-model",
        fileCheckpointing: true,
        partialMessages: true,
        permissionCallback: "configured",
      },
    });
    expect(streamedTrace).toEqual(result.trace);
    expect(state.closes).toBe(1);
  });

  it("exposes the host tools a revision's tool capabilities require", async () => {
    const executor = new QoderSdkExecutor({ loadSdk: async () => fakeQoderSdk(newFakeSession()) });
    const { bundle, revision } = await resolveFor("qoder", "tooled", executor.describe());
    const state = newFakeSession();
    const wired = new QoderSdkExecutor({ loadSdk: async () => fakeQoderSdk(state) });

    const result = await wired.execute(revision, bundle, { prompt: "Read the README" });

    expect(state.queries[0].options.tools).toContain("Read");
    expect(result.runtimeReceipt?.tools).toEqual(["Read"]);
    expect(result.materialization?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capabilityId: "workspace.read",
          dimension: "exposed",
          state: "materialized",
          mechanism: "host-tool:Read",
        }),
      ]),
    );
  });

  it("honours a caller-declared exposure the standard map has never heard of", async () => {
    // `toolExposure` is documented as an extension point for hosts that expose
    // more than the standard map, so an unknown capability is an extension, not
    // registry drift.
    const extended = {
      toolExposure: {
        "workspace.notebook": {
          hostTool: "NotebookEdit",
          contract: "urn:test:workspace.notebook:v1",
        },
      },
    };
    const bundle = (await compileHarness(`
      language 0.3
      skill s { description "x" }
      tool workspace.notebook { contract "urn:test:workspace.notebook:v1" }
      workflow solo { session coder }
      harness notebooks {
        workflow solo
        agent coder {
          use skill s
          require tool workspace.notebook
        }
      }
      runtime qoder { adapter "@harness/adapter-qoder" }
      deployment notebooks-qoder { harness notebooks runtime qoder }
    `)).bundle!;
    const descriptor = new QoderSdkAdapter(extended).describe();
    const { revision } = resolveHarness(bundle, "notebooks", "qoder", { adapter: descriptor });
    const state = newFakeSession();

    const result = await new QoderSdkExecutor({
      ...extended,
      loadSdk: async () => fakeQoderSdk(state),
    }).execute(revision!, bundle, { prompt: "Fix the notebook" });

    expect(state.queries[0].options.tools).toContain("NotebookEdit");
    expect(result.materialization?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capabilityId: "workspace.notebook",
          mechanism: "host-tool:NotebookEdit",
          state: "materialized",
        }),
      ]),
    );
  });

  it("still rejects a standard capability remapped away from the registry", async () => {
    await expect(
      new QoderSdkAdapter({
        toolExposure: {
          "workspace.read": {
            hostTool: "ReadFile",
            contract: "builtin:workspace.read@1",
          },
        },
      }).doStart({
        revision: {} as HarnessRevision,
        bundle: {} as HarnessIrBundle,
      }),
    ).rejects.toThrow(/descriptor drift/);
  });

  it("refuses a revision whose tool exposure this adapter cannot reproduce", async () => {
    const exposing = new QoderSdkAdapter();
    const { bundle, revision } = await resolveFor("qoder", "tooled", exposing.describe());
    let loaded = false;
    // Read is denied here, so the recorded `host-tool:Read` realization is a claim
    // this configuration cannot back.
    const narrowed = new QoderSdkExecutor({
      disallowedTools: ["Read"],
      loadSdk: async () => {
        loaded = true;
        throw new Error("must not load");
      },
    });

    await expect(narrowed.execute(revision, bundle, { prompt: "Read the README" })).rejects.toThrow(
      /locked adapter contract/,
    );
    expect(loaded).toBe(false);
  });

  it("retains usage evidence while redacting credential-shaped trace fields", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const state = newFakeSession();
    const sdk = fakeQoderSdk(state, () => [
      {
        type: "system",
        subtype: "init",
        access_token: "must-not-leak",
        nested: { serviceAccountKey: "also-must-not-leak" },
      },
      {
        type: "result",
        subtype: "success",
        duration_ms: 120,
        duration_api_ms: 90,
        num_turns: 2,
        total_cost_usd: 0.01,
        total_credits: 1.25,
        usage: { input_tokens: 10, output_tokens: 5 },
        modelUsage: { model: { inputTokens: 10 } },
        permission_denials: [],
        session_id: "session-1",
        stop_reason: "end_turn",
        terminal_reason: "completed",
      },
    ]);

    const result = await new QoderSdkExecutor({ loadSdk: async () => sdk }).execute(
      revision,
      bundle,
      { prompt: "Inspect" },
    );

    expect(result.trace).toContainEqual(
      expect.objectContaining({ access_token: "[REDACTED]" }),
    );
    expect(JSON.stringify(result.trace)).not.toContain("must-not-leak");
    expect(result.trace).toContainEqual(
      expect.objectContaining({ nested: { serviceAccountKey: "[REDACTED]" } }),
    );
    expect(result.metrics).toEqual({
      durationMs: 120,
      durationApiMs: 90,
      turns: 2,
      costUsd: 0.01,
      credits: 1.25,
      usage: { input_tokens: 10, output_tokens: 5 },
      modelUsage: { model: { inputTokens: 10 } },
      permissionDenials: [],
      sessionId: "session-1",
      stopReason: "end_turn",
      terminalReason: "completed",
    });
  });

  it("materializes the frozen qoder-minimal-v1 SDK surface and receipt", async () => {
    const state = newFakeSession();
    const canUseTool = async () => ({ behavior: "allow" as const });
    const executor = new QoderSdkExecutor({
      profile: "qoder-minimal-v1",
      loadSdk: async () => fakeQoderSdk(state, () => [{ type: "result", subtype: "success" }]),
      tools: ["Bash", "Edit", "Read", "Write"],
      allowedTools: [],
      disallowedTools: ["WebFetch", "WebSearch", "Task"],
      permissionMode: "default",
      canUseTool,
      maxTurns: 8,
    });
    const { bundle, revision } = await resolveFor("qoder", "assembly", executor.describe());

    const result = await executor.execute(revision, bundle, { prompt: "Create README.md", cwd: "/tmp" });

    expect(state.queries).toHaveLength(1);
    expect(state.queries[0].options).toMatchObject({
      tools: ["Read", "Write", "Edit", "Bash"],
      allowedTools: [],
      disallowedTools: ["WebFetch", "WebSearch", "Agent", "Task"],
      permissionMode: "default",
      persistSession: false,
      settingSources: [],
      skills: [],
      extensions: [],
      plugins: [],
      mcpServers: {},
      strictMcpConfig: true,
      systemPrompt: expect.stringContaining("focused coding agent"),
    });
    expect(state.queries[0].options.systemPrompt).toEqual(expect.stringContaining('working directory is "/tmp"'));
    expect(state.queries[0].options.systemPrompt).toEqual(
      expect.stringContaining("Use relative paths such as package.json"),
    );
    expect(result.runtimeReceipt).toEqual(expect.objectContaining({
      runtimeProfile: "qoder-minimal-v1",
      tools: ["Read", "Write", "Edit", "Bash"],
      allowedTools: [],
      systemPromptSource: "executor-profile",
      settingSources: [],
      skills: [],
      extensionCount: 0,
      pluginCount: 0,
      mcpServerNames: [],
      strictMcpConfig: true,
      permissionCallback: "configured",
    }));
    expect(JSON.stringify(result.runtimeReceipt)).not.toContain("focused coding agent");
  });

  it("rejects options that weaken qoder-minimal-v1 before loading the SDK", async () => {
    let loaded = false;
    const loadSdk = async (): Promise<QoderSdkLike> => {
      loaded = true;
      throw new Error("must not load");
    };

    expect(() => new QoderSdkExecutor({
      profile: "qoder-minimal-v1",
      loadSdk,
      allowedTools: ["Read"],
    })).toThrow(/does not permit auto-approved tools/);
    expect(() => new QoderSdkExecutor({
      profile: "qoder-minimal-v1",
      loadSdk,
      tools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
    })).toThrow(/fixes the visible tools/);
    expect(() => new QoderSdkExecutor({
      profile: "qoder-minimal-v1",
      loadSdk,
      persistSession: true,
    })).toThrow(/requires an ephemeral session/);
    expect(() => new QoderSdkExecutor({
      profile: "qoder-minimal-v1",
      loadSdk,
    })).toThrow(/requires canUseTool/);
    expect(loaded).toBe(false);
  });

  it("materializes delivered skill guidance without a synthetic degradation", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const executor = new QoderSdkExecutor({
      loadSdk: async () => fakeQoderSdk(newFakeSession(), () => [{ type: "result", subtype: "success" }]),
    });

    const result = await executor.execute(revision, bundle, { prompt: "Fix the bug" });

    expect(result.warnings).toEqual([]);
    expect(result.materialization?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capabilityId: "verification-before-complete",
          dimension: "delivered",
          state: "materialized",
          mechanism: "prompt-preamble",
        }),
      ]),
    );
  });

  it("rejects a revision targeting another host before loading the Qoder SDK", async () => {
    const { bundle, revision } = await resolveFor("pi");
    let loaded = false;
    const executor = new QoderSdkExecutor({
      loadSdk: async () => {
        loaded = true;
        throw new Error("should not load");
      },
    });

    await expect(executor.execute(revision, bundle, { prompt: "Fix the bug" })).rejects.toThrow(
      /targets runtime 'pi'.*executor host is 'qoder'/,
    );
    expect(loaded).toBe(false);
  });

  it("reports an SDK query failure without leaking non-error messages", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const sdk = fakeQoderSdk(newFakeSession(), () => [
      { type: "assistant", message: { content: [{ type: "text", text: "partial" }] } },
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["auth failed"],
      },
    ]);

    const result = await new QoderSdkExecutor({ loadSdk: async () => sdk }).execute(
      revision,
      bundle,
      { prompt: "Fix the bug" },
    );

    expect(result).toMatchObject({ exitCode: 1, output: "partial", errorOutput: "auth failed" });
  });

  it("fails closed when the Qoder SDK stream ends without a result message", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const sdk = fakeQoderSdk(
      newFakeSession(),
      () => [{ type: "assistant", message: { content: [{ type: "text", text: "partial" }] } }],
      {},
      true,
    );

    const result = await new QoderSdkExecutor({ loadSdk: async () => sdk }).execute(
      revision,
      bundle,
      { prompt: "Fix the bug" },
    );

    expect(result).toMatchObject({
      exitCode: 1,
      output: "partial",
      errorOutput: "Qoder SDK query ended without a result message.",
    });
  });
});

describe("PiSdkExecutor", () => {
  it("drives the Pi SDK session with the composed prompt", async () => {
    const { bundle, revision } = await resolveFor("pi");
    const prompts: string[] = [];
    const workingDirectories: Array<string | undefined> = [];
    const selectedModel = { provider: "deepseek", id: "deepseek-chat" };
    const runtime = { marker: "runtime" };
    const configuredRuntimes: unknown[] = [];
    const sessionConfigs: Parameters<PiSdkLike["createAgentSession"]>[0][] = [];
    let disposed = false;
    let listener: ((event: { type?: string; assistantMessageEvent?: { type?: string; delta?: string } }) => void) | undefined;
    const stubSdk: PiSdkLike = {
      createAgentSession: async (config) => {
        sessionConfigs.push(config);
        workingDirectories.push(config.cwd);
        return {
          session: {
            prompt: async (text: string) => {
              prompts.push(text);
              listener?.({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "pi-response" },
              });
              return undefined;
            },
            subscribe: (nextListener) => {
              listener = nextListener;
              return () => {
                listener = undefined;
              };
            },
            dispose: () => {
              disposed = true;
            },
          },
        };
      },
      SessionManager: { inMemory: () => ({}) },
      ModelRuntime: { create: async () => runtime },
    };
    const executor = new PiSdkExecutor({
      loadSdk: async () => stubSdk,
      configureModelRuntime: async (modelRuntime) => {
        configuredRuntimes.push(modelRuntime);
      },
      selectModel: (modelRuntime) => {
        expect(modelRuntime).toBe(runtime);
        return selectedModel;
      },
    });

    const result = await executor.execute(revision, bundle, { prompt: "Fix the bug", cwd: "/tmp" });

    expect(prompts).toHaveLength(1);
    expect(configuredRuntimes).toEqual([runtime]);
    expect(workingDirectories).toEqual(["/tmp"]);
    expect(sessionConfigs[0]).toMatchObject({
      modelRuntime: runtime,
      model: selectedModel,
      noTools: "all",
    });
    expect(disposed).toBe(true);
    expect(prompts[0].endsWith("Fix the bug")).toBe(true);
    expect(prompts[0]).toContain(revision.revisionId);
    expect(result).toMatchObject({ host: "pi", exitCode: 0, output: "pi-response" });
    expect(result.materialization?.adapter).toEqual({
      id: "@harness/adapter-pi",
      specificationVersion: "harness-adapter-v1",
    });
  });

  it("surfaces a model failure encoded in the final Pi assistant message", async () => {
    const { bundle, revision } = await resolveFor("pi");
    let listener:
      | ((event: {
          type?: string;
          message?: { role?: string; stopReason?: string; errorMessage?: string };
        }) => void)
      | undefined;
    let disposed = false;
    const stubSdk: PiSdkLike = {
      createAgentSession: async () => ({
        session: {
          prompt: async () => {
            listener?.({
              type: "message_end",
              message: {
                role: "assistant",
                stopReason: "error",
                errorMessage: "provider rejected request",
              },
            });
          },
          subscribe: (nextListener) => {
            listener = nextListener;
            return () => {
              listener = undefined;
            };
          },
          dispose: () => {
            disposed = true;
          },
        },
      }),
      SessionManager: { inMemory: () => ({}) },
      ModelRuntime: { create: async () => ({}) },
    };

    const result = await new PiSdkExecutor({ loadSdk: async () => stubSdk }).execute(
      revision,
      bundle,
      { prompt: "Fix the bug" },
    );

    expect(result).toMatchObject({
      exitCode: 1,
      output: "",
      errorOutput: "provider rejected request",
    });
    expect(disposed).toBe(true);
  });

  it("rejects a revision targeting another host before loading the Pi SDK", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    let loaded = false;
    const executor = new PiSdkExecutor({
      loadSdk: async () => {
        loaded = true;
        throw new Error("should not load");
      },
    });

    await expect(executor.execute(revision, bundle, { prompt: "Fix the bug" })).rejects.toThrow(
      /targets runtime 'qoder'.*executor host is 'pi'/,
    );
    expect(loaded).toBe(false);
  });

  it("reports the missing optional peer dependency with install guidance", async () => {
    const { bundle, revision } = await resolveFor("pi");
    const executor = new PiSdkExecutor({
      loadSdk: async () => {
        throw new Error("simulated missing optional peer");
      },
    });

    await expect(executor.execute(revision, bundle, { prompt: "Fix the bug" })).rejects.toThrow(
      /@earendil-works\/pi-coding-agent/,
    );
  });
});

describe("installed SDK contracts", () => {
  it("exposes the Qoder SDK entry points used by the executor", async () => {
    const sdk = await import("@qoder-ai/qoder-agent-sdk");

    expect(sdk.query).toBeTypeOf("function");
    expect(sdk.qodercliAuth).toBeTypeOf("function");
  });

  it("exposes the current Pi SDK entry points used by the executor", async () => {
    const sdk = await import("@earendil-works/pi-coding-agent");

    expect(sdk.createAgentSession).toBeTypeOf("function");
    expect(sdk.SessionManager.inMemory).toBeTypeOf("function");
    expect(sdk.ModelRuntime.create).toBeTypeOf("function");
  });
});

describe("materializePiPackage", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it("writes an installable Pi package with delivered skills", async () => {
    const { bundle, revision } = await resolveFor("pi");
    directory = await mkdtemp(join(tmpdir(), "harness-pi-"));

    const written = await materializePiPackage(revision, bundle, directory);

    expect(written).toContain("package.json");
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    expect(manifest.pi.skills).toEqual(["./skills"]);
    const skill = await readFile(join(directory, "skills", "impact-analysis", "SKILL.md"), "utf8");
    expect(skill).toContain("name: impact-analysis");
    expect(skill).toContain('description: "Impact analysis: map the blast radius before editing."');
    expect(skill).toContain(revision.revisionId);
    // Only skill capabilities become Pi skills; nothing else in the revision does.
    expect(written.filter((path) => path.endsWith("SKILL.md"))).toHaveLength(
      revision.resolved.capabilities.filter((capability) => capability.kind === "skill").length,
    );
    await expect(access(join(directory, "skills", "workspace.read", "SKILL.md"))).rejects.toThrow();
  });

  it("ships a source-backed skill's real bytes, not a generated stub", async () => {
    const root = await mkdtemp(join(tmpdir(), "harness-pi-src-"));
    directory = await mkdtemp(join(tmpdir(), "harness-pi-"));
    try {
      const skillDir = join(root, "skills", "grounding");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        "---\nname: grounding\ndescription: \"Ground claims in the repository.\"\n---\n\nQuote the file you relied on.\n",
        "utf8",
      );
      await writeFile(join(skillDir, "checklist.md"), "- cite a path\n", "utf8");
      const bundle = (await compileHarness(`
        language 0.3
        skill grounding { source "./skills/grounding" }
        workflow solo { session coder }
        harness grounded {
          workflow solo
          agent coder { use skill grounding }
        }
        runtime pi { adapter "@harness/adapter-pi" }
        deployment grounded-pi { harness grounded runtime pi }
      `)).bundle!;
      const sourceLocks = await lockCapabilitySources(bundle, { root });
      const { revision } = resolveHarness(bundle, "grounded", "pi", {
        adapter: new PiSdkAdapter().describe(),
        sourceLocks,
      });

      const written = await materializePiPackage(revision!, bundle, directory, { sourceRoot: root });

      const skill = await readFile(join(directory, "skills", "grounding", "SKILL.md"), "utf8");
      expect(skill).toContain("Quote the file you relied on.");
      expect(skill).toContain(revision!.revisionId);
      // The reference file travels with the skill, so its guidance can actually
      // disclose it after installation.
      expect(written).toContain(join("skills", "grounding", "checklist.md"));
      expect(await readFile(join(directory, "skills", "grounding", "checklist.md"), "utf8")).toBe(
        "- cite a path\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects materialization for a revision targeting another host", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    directory = await mkdtemp(join(tmpdir(), "harness-pi-"));

    await expect(materializePiPackage(revision, bundle, directory)).rejects.toThrow(
      /targets runtime 'qoder'.*executor host is 'pi'/,
    );
  });

  it("refuses to materialize another bundle under a locked revision id", async () => {
    const { bundle, revision } = await resolveFor("pi");
    const compiled = await compileHarness(
      SOURCE.replace(
        "Impact analysis: map the blast radius before editing.",
        "Swapped bundle content must never be materialized.",
      ),
    );
    directory = await mkdtemp(join(tmpdir(), "harness-pi-"));

    await expect(materializePiPackage(revision, compiled.bundle!, directory)).rejects.toThrow(
      /does not match the supplied IR bundle/,
    );
    expect(await access(join(directory, "package.json")).then(() => true, () => false)).toBe(false);
  });

  it("fails closed instead of mixing a revision with pre-existing files", async () => {
    const { bundle, revision } = await resolveFor("pi");
    directory = await mkdtemp(join(tmpdir(), "harness-pi-"));
    await writeFile(join(directory, "keep.txt"), "user-owned\n", "utf8");

    await expect(materializePiPackage(revision, bundle, directory)).rejects.toThrow(
      /destination must be empty/,
    );
    expect(await readFile(join(directory, "keep.txt"), "utf8")).toBe("user-owned\n");
  });
});

describe("prepareMaterialization", () => {
  it("records only adapter-observed facts", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const descriptor = new QoderSdkAdapter().describe();

    const receipt = prepareMaterialization(revision, bundle, descriptor);

    expect(receipt.capabilities).toContainEqual(expect.objectContaining({
      capabilityId: "impact-analysis",
      dimension: "delivered",
      state: "materialized",
      mechanism: "prompt-preamble",
    }));
    expect(receipt).not.toHaveProperty("permissions");
    expect(receipt).not.toHaveProperty("settings");
  });
});
