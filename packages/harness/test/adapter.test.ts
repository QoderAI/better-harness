import { describe, expect, it } from "vitest";
import { compileHarness } from "../src/compiler/compile.js";
import type { HarnessIrBundle, HarnessRevision } from "../src/ir/index.js";
import { PROMPT_ONLY_DESCRIPTOR } from "../src/resolver/adapter-descriptor.js";
import { resolveHarness } from "../src/resolver/resolve.js";
import { PI_ADAPTER_DESCRIPTOR, QODER_ADAPTER_DESCRIPTOR } from "../src/resolver/adapter-registry.js";
import {
  HarnessCapabilityUnsupportedError,
  HarnessConcurrentTurnError,
  runOnce,
  type HarnessAdapterSession,
  type HarnessAdapterV1,
} from "../src/exec/adapter.js";
import type { HarnessRunEvent } from "../src/exec/events.js";
import { HarnessHostMismatchError, type HarnessRunResult } from "../src/exec/executor.js";
import { PiSdkAdapter, type PiSdkLike } from "../src/exec/pi-sdk.js";
import {
  QoderSdkAdapter,
  type QoderSdkLike,
  type QoderSdkQueryOptions,
} from "../src/exec/qoder-sdk.js";

const SOURCE = `
  language 0.3
  skill impact-analysis {
    description "Impact analysis: map the blast radius before editing."
  }
  workflow solo-loop {
    session coder
  }
  harness assembly {
    workflow solo-loop
    agent coder {
      use skill impact-analysis
    }
  }
  runtime qoder { adapter "@harness/adapter-qoder" }
  runtime pi { adapter "@harness/adapter-pi" }
  deployment assembly-qoder { harness assembly runtime qoder }
  deployment assembly-pi { harness assembly runtime pi }
`;

async function resolveFor(runtimeId: string): Promise<{ bundle: HarnessIrBundle; revision: HarnessRevision }> {
  const { bundle } = await compileHarness(SOURCE);
  const adapter = runtimeId === "qoder" ? new QoderSdkAdapter() : new PiSdkAdapter();
  const { revision } = resolveHarness(bundle!, "assembly", runtimeId, { adapter: adapter.describe() });
  return { bundle: bundle!, revision: revision! };
}

interface QoderHostState {
  /** One entry per `query()` call: a new entry means a new host context. */
  queries: Array<{ resume?: string; tools: string[]; persistSession: boolean; maxTurns?: number }>;
  /** Every user message the host received, across all queries. */
  turns: string[];
  interrupts: number;
  closes: number;
  /** Transcripts the host kept for `resume`, keyed by session id. */
  persisted: Map<string, string[]>;
}

describe("adapter descriptor registry", () => {
  it("matches each shipped adapter without loading a host SDK", () => {
    expect(new QoderSdkAdapter().describe()).toEqual(QODER_ADAPTER_DESCRIPTOR);
    expect(new PiSdkAdapter().describe()).toEqual(PI_ADAPTER_DESCRIPTOR);
    expect(new QoderSdkAdapter().describe()).toBe(QODER_ADAPTER_DESCRIPTOR);
    expect(new PiSdkAdapter().describe()).toBe(PI_ADAPTER_DESCRIPTOR);
  });
});

function newHostState(): QoderHostState {
  return { queries: [], turns: [], interrupts: 0, closes: 0, persisted: new Map() };
}

/**
 * A host that keeps the conversation for the life of one query, the way the
 * official SDK does: `query()` is called once with a streamed prompt, the host
 * remembers what it was told, and a later turn can be answered from an earlier
 * one. A second `query()` starts an empty context unless it resumes a session
 * the host persisted.
 */
function conversationalQoderSdk(
  state: QoderHostState,
  options: {
    /** Model a host that terminates the query after answering one message. */
    endsAfterEachTurn?: boolean;
    /** Await this before answering, so a test can hold a turn in flight. */
    gate?: () => Promise<void>;
    /** Answer an interrupted turn with a failed result instead of a success. */
    resultSubtypeAfterInterrupt?: string;
  } = {},
): QoderSdkLike {
  let sessions = 0;
  return {
    qodercliAuth: () => ({}),
    query: ({ prompt, options: queryOptions }: {
      prompt: string | AsyncIterable<{ message: { content: string } }>;
      options: QoderSdkQueryOptions;
    }) => {
      sessions += 1;
      const sessionId = queryOptions.resume ?? `session-${sessions}`;
      state.queries.push({
        ...(queryOptions.resume !== undefined ? { resume: queryOptions.resume } : {}),
        tools: [...queryOptions.tools],
        persistSession: queryOptions.persistSession,
        ...(queryOptions.maxTurns !== undefined ? { maxTurns: queryOptions.maxTurns } : {}),
      });
      const memory = [
        ...(queryOptions.resume === undefined ? [] : state.persisted.get(queryOptions.resume) ?? []),
      ];
      let interrupted = false;
      const messages = (async function* () {
        if (typeof prompt === "string") {
          throw new Error("this host only accepts a streamed multi-turn prompt");
        }
        for await (const message of prompt) {
          const text = message.message.content;
          state.turns.push(text);
          memory.push(text);
          if (queryOptions.persistSession) {
            state.persisted.set(sessionId, [...memory]);
          }
          await options.gate?.();
          const subtype = interrupted
            ? options.resultSubtypeAfterInterrupt ?? "success"
            : "success";
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: answerFrom(memory, text) }] },
          };
          yield { type: "result", subtype, session_id: sessionId };
          if (options.endsAfterEachTurn === true) {
            return;
          }
        }
      })();
      return {
        [Symbol.asyncIterator]: () => messages,
        interrupt: async () => {
          state.interrupts += 1;
          interrupted = true;
          return undefined;
        },
        close: async () => {
          state.closes += 1;
        },
      };
    },
  } as QoderSdkLike;
}

/** A recall question is answered from the host's memory, anything else acknowledged. */
function answerFrom(memory: readonly string[], text: string): string {
  if (!/what did i tell you/i.test(text)) {
    return `ack-${memory.length}`;
  }
  const remembered = memory
    .flatMap((entry) => entry.split("\n"))
    .filter((line) => line.startsWith("passphrase "));
  return remembered.length === 0 ? "I have no earlier context." : remembered.join(" ");
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => {
    resolve = () => settle();
  });
  return { promise, resolve };
}

/** Let queued microtasks and abort listeners run before asserting. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/** Each turn must be one complete run: started first, finished last. */
function expectFramedTurns(events: HarnessRunEvent[], turns: number): void {
  const starts = events.filter((event) => event.type === "run-started");
  const finishes = events.filter((event) => event.type === "run-finished");
  expect(starts).toHaveLength(turns);
  expect(finishes).toHaveLength(turns);
  let open = false;
  for (const event of events) {
    if (event.type === "run-started") {
      expect(open).toBe(false);
      open = true;
    } else if (event.type === "run-finished") {
      expect(open).toBe(true);
      open = false;
    } else {
      expect(open).toBe(true);
    }
  }
  expect(open).toBe(false);
}

describe("QoderSdkAdapter sessions", () => {
  it("identifies itself and its realization facts through the versioned contract", () => {
    const adapter = new QoderSdkAdapter({ loadSdk: async () => conversationalQoderSdk(newHostState()) });

    expect(adapter.specificationVersion).toBe("harness-adapter-v1");
    expect(adapter.adapterId).toBe("@harness/adapter-qoder");
    expect(adapter.host).toBe("qoder");
    // The descriptor is what the resolver measures a harness against, so it only
    // claims what this adapter can actually do to a host session.
    expect(adapter.describe()).toMatchObject({
      adapterId: "@harness/adapter-qoder",
      mcpSupport: null,
      workflowModes: ["session"],
    });
  });

  it("answers the second turn from first-turn context inside one query", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const state = newHostState();
    const events: HarnessRunEvent[] = [];
    const adapter = new QoderSdkAdapter({ loadSdk: async () => conversationalQoderSdk(state) });

    const session = await adapter.doStart({
      revision,
      bundle,
      onRunEvent: (event) => events.push(event),
    });
    const first = await session.doPromptTurn({ prompt: "passphrase velvet-otter" });
    const second = await session.doPromptTurn({ prompt: "What did I tell you?" });
    await session.doStop();

    // One query for the whole session: turn 2 reaches the same host context that
    // received turn 1, which is the only way it can recall the passphrase.
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0].maxTurns).toBeUndefined();
    expect(state.turns).toHaveLength(2);
    expect(first.output).toBe("ack-1");
    expect(second.output).toContain("velvet-otter");
    // The preamble belongs to the session, not to every turn: the host already
    // has it after turn 1.
    expect(state.turns[0]).toContain(revision.revisionId);
    expect(state.turns[1]).toBe("What did I tell you?");
    expect(state.closes).toBe(1);
    expectFramedTurns(events, 2);
  });

  it("refuses a second turn while one is still in flight", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const state = newHostState();
    const gate = deferred();
    const adapter = new QoderSdkAdapter({
      loadSdk: async () => conversationalQoderSdk(state, { gate: () => gate.promise }),
    });

    const session = await adapter.doStart({ revision, bundle });
    const inFlight = session.doPromptTurn({ prompt: "passphrase velvet-otter" });
    await settle();

    await expect(session.doPromptTurn({ prompt: "and another thing" })).rejects.toThrow(
      HarnessConcurrentTurnError,
    );
    gate.resolve();
    await expect(inFlight).resolves.toMatchObject({ exitCode: 0 });
    // The refused turn never reached the host.
    expect(state.turns).toHaveLength(1);
    await session.doStop();
  });

  it("interrupts the live query when a turn abort signal fires", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const state = newHostState();
    const gate = deferred();
    const adapter = new QoderSdkAdapter({
      loadSdk: async () =>
        conversationalQoderSdk(state, {
          gate: () => gate.promise,
          resultSubtypeAfterInterrupt: "error_during_execution",
        }),
    });
    const controller = new AbortController();

    const session = await adapter.doStart({ revision, bundle });
    const turn = session.doPromptTurn({ prompt: "Fix the bug", abortSignal: controller.signal });
    await settle();
    controller.abort(new Error("caller gave up"));
    await settle();
    gate.resolve();
    const result = await turn;
    await session.doStop();

    expect(state.interrupts).toBe(1);
    expect(result.exitCode).toBe(1);
  });

  it("closes the query on stop and interrupts it on destroy", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const stopped = newHostState();
    const destroyed = newHostState();

    const stopSession = await new QoderSdkAdapter({
      loadSdk: async () => conversationalQoderSdk(stopped),
    }).doStart({ revision, bundle });
    await stopSession.doPromptTurn({ prompt: "Fix the bug" });
    await stopSession.doStop();

    const destroySession = await new QoderSdkAdapter({
      loadSdk: async () => conversationalQoderSdk(destroyed),
    }).doStart({ revision, bundle });
    await destroySession.doPromptTurn({ prompt: "Fix the bug" });
    await destroySession.doDestroy();

    expect(stopped).toMatchObject({ closes: 1, interrupts: 0 });
    expect(destroyed).toMatchObject({ closes: 1, interrupts: 1 });
  });

  it("resumes the persisted host session when the query terminated between turns", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const state = newHostState();
    const adapter = new QoderSdkAdapter({
      loadSdk: async () => conversationalQoderSdk(state, { endsAfterEachTurn: true }),
      persistSession: true,
    });

    const session = await adapter.doStart({ revision, bundle });
    await session.doPromptTurn({ prompt: "passphrase velvet-otter" });
    const second = await session.doPromptTurn({ prompt: "What did I tell you?" });
    await session.doStop();

    expect(state.queries).toHaveLength(2);
    expect(state.queries[0].resume).toBeUndefined();
    // The reopened query carries the host session id, so the transcript the host
    // kept is the context turn 2 is answered from.
    expect(state.queries[1].resume).toBe("session-1");
    expect(session.sessionId).toBe("session-1");
    expect(second.output).toContain("velvet-otter");
    expect(second.exitCode).toBe(0);
  });

  it("rejects a mismatched revision before loading the SDK and rejects turns after stop", async () => {
    const { bundle, revision } = await resolveFor("pi");
    let loaded = false;
    const adapter = new QoderSdkAdapter({
      loadSdk: async () => {
        loaded = true;
        throw new Error("must not load");
      },
    });

    await expect(adapter.doStart({ revision, bundle })).rejects.toThrow(HarnessHostMismatchError);
    expect(loaded).toBe(false);

    const matching = await resolveFor("qoder");
    const state = newHostState();
    const openAdapter = new QoderSdkAdapter({ loadSdk: async () => conversationalQoderSdk(state) });
    const session = await openAdapter.doStart({ revision: matching.revision, bundle: matching.bundle });
    await session.doStop();
    await expect(session.doPromptTurn({ prompt: "too late" })).rejects.toThrow(/has ended/);
    expect(state.turns).toHaveLength(0);
  });
});

describe("PiSdkAdapter sessions", () => {
  function multiTurnPiSdk(state: {
    prompts: string[];
    sessionsCreated: number;
    disposals: number;
  }): PiSdkLike {
    let listener: ((event: {
      type?: string;
      assistantMessageEvent?: { type?: string; delta?: string };
    }) => void) | undefined;
    return {
      createAgentSession: async () => {
        state.sessionsCreated += 1;
        return {
          session: {
            prompt: async (text: string) => {
              state.prompts.push(text);
              listener?.({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: `pi-${state.prompts.length}` },
              });
            },
            subscribe: (nextListener) => {
              listener = nextListener;
              return () => {
                listener = undefined;
              };
            },
            dispose: () => {
              state.disposals += 1;
            },
          },
        };
      },
      SessionManager: { inMemory: () => ({}) },
      ModelRuntime: { create: async () => ({}) },
    };
  }

  it("keeps one Pi session across turns and sends the preamble on the first turn only", async () => {
    const { bundle, revision } = await resolveFor("pi");
    const state = { prompts: [] as string[], sessionsCreated: 0, disposals: 0 };
    const events: HarnessRunEvent[] = [];
    const adapter = new PiSdkAdapter({ loadSdk: async () => multiTurnPiSdk(state) });

    const session = await adapter.doStart({
      revision,
      bundle,
      onRunEvent: (event) => events.push(event),
    });
    const first = await session.doPromptTurn({ prompt: "Fix the bug" });
    const second = await session.doPromptTurn({ prompt: "Now add a test" });
    await session.doStop();

    expect(state.sessionsCreated).toBe(1);
    expect(state.disposals).toBe(1);
    expect(first.output).toBe("pi-1");
    expect(second.output).toBe("pi-2");
    expect(state.prompts[0]).toContain(revision.revisionId);
    expect(state.prompts[1]).toBe("Now add a test");
    expectFramedTurns(events, 2);

    await expect(session.doPromptTurn({ prompt: "too late" })).rejects.toThrow(/has ended/);
    await session.doDestroy();
    expect(state.disposals).toBe(1);
  });

  it("refuses a turn abort signal with a typed capability-unsupported error", async () => {
    const { bundle, revision } = await resolveFor("pi");
    const state = { prompts: [] as string[], sessionsCreated: 0, disposals: 0 };
    const adapter = new PiSdkAdapter({ loadSdk: async () => multiTurnPiSdk(state) });

    const session = await adapter.doStart({ revision, bundle });
    const attempt = session.doPromptTurn({
      prompt: "Fix the bug",
      abortSignal: new AbortController().signal,
    });

    await expect(attempt).rejects.toThrow(HarnessCapabilityUnsupportedError);
    await expect(attempt).rejects.toMatchObject({
      adapterId: "@harness/adapter-pi",
      capability: "turn-abort",
    });
    expect(state.prompts).toHaveLength(0);
    await session.doStop();
  });
});

describe("runOnce", () => {
  function fakeResult(revision: HarnessRevision): HarnessRunResult {
    return {
      host: "qoder",
      revisionId: revision.revisionId,
      exitCode: 0,
      output: "done",
      errorOutput: "",
      warnings: [],
    };
  }

  it("degrades an unsupported graceful stop to a destroy plus a result warning", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    let destroyed = false;
    const session: HarnessAdapterSession = {
      adapterId: "@harness/adapter-fake",
      revisionId: revision.revisionId,
      doPromptTurn: async () => fakeResult(revision),
      doStop: async () => {
        throw new HarnessCapabilityUnsupportedError("@harness/adapter-fake", "graceful-stop");
      },
      doDestroy: async () => {
        destroyed = true;
      },
    };
    const adapter: HarnessAdapterV1 = {
      specificationVersion: "harness-adapter-v1",
      adapterId: "@harness/adapter-fake",
      host: "qoder",
      describe: () => PROMPT_ONLY_DESCRIPTOR,
      doStart: async () => session,
    };

    const result = await runOnce(adapter, revision, bundle, { prompt: "Fix the bug" });

    expect(destroyed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("cannot stop gracefully");
    expect(result.warnings[0]).toContain("graceful-stop");
  });

  it("tears the session down and rethrows when a graceful stop fails for another reason", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    let destroyed = false;
    const adapter: HarnessAdapterV1 = {
      specificationVersion: "harness-adapter-v1",
      adapterId: "@harness/adapter-fake",
      host: "qoder",
      describe: () => PROMPT_ONLY_DESCRIPTOR,
      doStart: async () => ({
        adapterId: "@harness/adapter-fake",
        revisionId: revision.revisionId,
        doPromptTurn: async () => fakeResult(revision),
        doStop: async () => {
          throw new Error("host socket already gone");
        },
        doDestroy: async () => {
          destroyed = true;
        },
      }),
    };

    await expect(runOnce(adapter, revision, bundle, { prompt: "Fix the bug" })).rejects.toThrow(
      "host socket already gone",
    );
    // A failed stop still leaves a live host session, so it must be torn down.
    expect(destroyed).toBe(true);
  });

  it("destroys the session and rethrows when the turn itself fails", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    let destroyed = false;
    const adapter: HarnessAdapterV1 = {
      specificationVersion: "harness-adapter-v1",
      adapterId: "@harness/adapter-fake",
      host: "qoder",
      describe: () => PROMPT_ONLY_DESCRIPTOR,
      doStart: async () => ({
        adapterId: "@harness/adapter-fake",
        revisionId: revision.revisionId,
        doPromptTurn: async () => {
          throw new Error("turn exploded");
        },
        doStop: async () => {
          throw new Error("stop must not be called after a failed turn");
        },
        doDestroy: async () => {
          destroyed = true;
        },
      }),
    };

    await expect(runOnce(adapter, revision, bundle, { prompt: "Fix the bug" })).rejects.toThrow(
      "turn exploded",
    );
    expect(destroyed).toBe(true);
  });

  it("emits the legacy failure event sequence when the session cannot start", async () => {
    const { bundle, revision } = await resolveFor("qoder");
    const events: HarnessRunEvent[] = [];
    const adapter: HarnessAdapterV1 = {
      specificationVersion: "harness-adapter-v1",
      adapterId: "@harness/adapter-fake",
      host: "qoder",
      describe: () => PROMPT_ONLY_DESCRIPTOR,
      doStart: async () => {
        throw new Error("sdk missing");
      },
    };

    await expect(
      runOnce(adapter, revision, bundle, { prompt: "Fix the bug" }, {
        onRunEvent: (event) => events.push(event),
      }),
    ).rejects.toThrow("sdk missing");

    expect(events.map((event) => event.type)).toEqual(["run-started", "run-error", "run-finished"]);
  });
});
