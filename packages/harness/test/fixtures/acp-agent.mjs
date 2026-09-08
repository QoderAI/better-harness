import { Readable, Writable } from "node:stream";
import { agent, methods, ndJsonStream } from "@agentclientprotocol/sdk";

let cancelled = false;
let turnCount = 0;
const conversationHistory = [];
const conversation = process.argv.includes("--conversation");
const sessionConfig = {};
const controls = process.argv.includes("--session-controls");
function configOptions() {
  return [
    { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: sessionConfig.mode ?? "agent", options: [{ value: "agent", name: "Agent" }, { value: "plan", name: "Plan" }] },
    { id: "model", name: "Model", category: "model", type: "select", currentValue: sessionConfig.model ?? "fixture-default", options: [{ group: "fixture", name: "Fixture models", options: [{ value: "fixture-default", name: "Fixture default" }, { value: "fixture-candidate", name: "Fixture candidate" }] }] },
    { id: "effort", name: "Reasoning effort", category: "thought_level", type: "select", currentValue: sessionConfig.effort ?? "high", description: "Reasoning budget for this session.", options: (sessionConfig.model === "fixture-candidate" ? ["low", "medium"] : ["low", "medium", "high"]).map(value => ({ value, name: value })) },
    { id: "fast", name: "Fast mode", type: "boolean", currentValue: sessionConfig.fast ?? false },
  ];
}

const app = agent({ name: "better-harness-acp-fixture" })
  .onRequest(methods.agent.initialize, (context) => {
    if (process.argv.includes("--require-client-services")) {
      const capabilities = context.params.clientCapabilities;
      if (capabilities?.fs?.readTextFile !== true
        || capabilities.fs.writeTextFile !== true
        || capabilities.terminal !== true) {
        throw new Error("fixture-required-client-capabilities-missing");
      }
    }
    return {
      protocolVersion: context.params.protocolVersion,
      agentCapabilities: { loadSession: conversation && !process.argv.includes("--no-recovery"), ...(conversation ? { sessionCapabilities: { resume: {}, close: {} } } : {}), ...(conversation ? { promptCapabilities: { image: true, audio: true, embeddedContext: true } } : {}) },
      authMethods: [],
    };
  })
  .onRequest(methods.agent.session.new, async () => {
    if (process.argv.includes("--delay-new")) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    return {
      sessionId: "fixture-session",
      ...((controls || process.argv.includes("--legacy-modes")) ? { modes: { currentModeId: "agent", availableModes: [{ id: "agent", name: "Agent" }, { id: "plan", name: "Plan" }] } } : {}),
      configOptions: process.argv.includes("--legacy-modes") ? undefined : controls ? configOptions() : [{
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "fixture-default",
        options: [
          { value: "fixture-default", name: "Fixture default" },
          { value: "fixture-candidate", name: "Fixture candidate" },
        ],
      }],
    };
  })
  .onRequest(methods.agent.session.load, async context => {
    if (context.params.sessionId !== "fixture-session") throw new Error("Unknown fixture session");
    if (process.argv.includes("--reject-recovery")) throw new Error("Recovery rejected by fixture");
    turnCount = 20;
    await context.client.notify(methods.client.session.update, { sessionId: context.params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Loaded fixture session\n" } } });
    return { configOptions: configOptions() };
  })
  .onRequest(methods.agent.session.resume, context => {
    if (context.params.sessionId !== "fixture-session") throw new Error("Unknown fixture session");
    turnCount = 30; return { configOptions: configOptions() };
  })
  .onRequest(methods.agent.session.close, () => ({}))
  .onRequest(methods.agent.session.setConfigOption, (context) => {
    const { configId, value } = context.params;
    if (process.argv.includes("--reject-config")) {
      return { configOptions: [] };
    }
    sessionConfig[configId] = value;
    if (controls) {
      if (configId === "model" && value === "fixture-candidate") sessionConfig.effort = "medium";
      return { configOptions: configOptions() };
    }
    return {
      configOptions: [{
        id: configId,
        name: configId,
        type: typeof value === "boolean" ? "boolean" : "select",
        currentValue: value,
        ...(typeof value === "string"
          ? { options: [{ value, name: value }] }
          : {}),
      }],
    };
  })
  .onRequest(methods.agent.session.setMode, async (context) => {
    if (!["agent", "plan"].includes(context.params.modeId)) throw new Error("Invalid mode");
    sessionConfig.mode = context.params.modeId;
    await context.client.notify(methods.client.session.update, { sessionId: context.params.sessionId, update: { sessionUpdate: "current_mode_update", currentModeId: context.params.modeId } });
    return {};
  })
  .onNotification(methods.agent.session.cancel, () => {
    cancelled = true;
  })
  .onRequest(methods.agent.session.prompt, async (context) => {
    if (process.argv.includes("--artifact-internal-error")) {
      process.stderr.write("fixture-secret-context\n");
      throw new Error("fixture-internal-error");
    }
    cancelled = false;
    const sessionId = context.params.sessionId;
    if (conversation) {
      turnCount++;
      const text = context.params.prompt.filter(block => block.type === "text").map(block => block.text).join("\n");
      conversationHistory.push(text);
      const notify = update => context.client.notify(methods.client.session.update, { sessionId, update });
      await notify({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "Review changes", input: { hint: "revision" } }] });
      await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `turn:${turnCount} session:${sessionId} blocks:${context.params.prompt.length} model:${sessionConfig.model ?? "fixture-default"}\n` } });
      await notify({ sessionUpdate: "tool_call", toolCallId: `tool-${turnCount}`, title: "Read conversation evidence", kind: "read", status: "in_progress" });
      if (text.includes("permission")) {
        await Promise.all([1, 2].map(index => context.client.request(methods.client.session.requestPermission, {
          sessionId, toolCall: { toolCallId: `permission-${turnCount}-${index}`, title: `Permission ${index}`, kind: "read", status: "pending" },
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        })));
      }
      if (text.includes("wait")) while (!cancelled) await new Promise(resolve => setTimeout(resolve, 10));
      if (text.includes("long transcript")) for (let index = 0; index < 250; index++) await notify({ sessionUpdate: "agent_message_chunk", messageId: `turn-${turnCount}-message-${index}`, content: { type: "text", text: `Retained entry ${index}: readable conversation history.` } });
      // The final tool update deliberately follows cancellation, before its acknowledgement.
      await notify({ sessionUpdate: "tool_call_update", toolCallId: `tool-${turnCount}`, status: "completed", rawOutput: { turns: turnCount, history: conversationHistory, blocks: context.params.prompt } });
      return { stopReason: cancelled ? "cancelled" : text.includes("refuse") ? "refusal" : "end_turn" };
    }
    if (controls) await context.client.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `configured:${sessionConfig.model ?? "fixture-default"}:${sessionConfig.effort ?? "high"}:${sessionConfig.fast ?? false}\n` } } });
    const permission = await context.client.request(methods.client.session.requestPermission, {
      sessionId,
      toolCall: {
        toolCallId: "fixture-tool",
        title: "Inspect fixture workspace",
        kind: "read",
        status: "pending",
      },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
      _meta: { authorization: "Bearer fixture-secret" },
    });
    if (process.argv.includes("--session-stream") && permission.outcome.outcome === "cancelled") return { stopReason: "cancelled" };
    if (process.argv.includes("--rich-content")) {
      const notify = (update) => context.client.notify(methods.client.session.update, { sessionId, update });
      await notify({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "Replayed user context" } });
      await notify({ sessionUpdate: "agent_message_chunk", content: { type: "image", mimeType: "image/gif", data: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" } });
      await notify({ sessionUpdate: "agent_message_chunk", content: { type: "resource_link", uri: "https://example.com/report", name: "Evidence report", description: "Read-only report" } });
      await notify({ sessionUpdate: "agent_message_chunk", content: { type: "resource", resource: { uri: "file:///fixture/note.txt", text: "Retained resource text" } } });
      await notify({ sessionUpdate: "tool_call_update", toolCallId: "rich-tool", title: "Preview file changes", kind: "edit", status: "in_progress", locations: [{ path: "/fixture/readme.md", line: 1 }], content: [{ type: "diff", path: "/fixture/readme.md", oldText: "old", newText: "new" }, { type: "content", content: { type: "text", text: "Tool progress evidence" } }] });
      await notify({ sessionUpdate: "tool_call_update", toolCallId: "rich-tool", status: "completed" });
      await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "## Verified\n\n**Rich content** is retained." } });
      return { stopReason: "end_turn" };
    }
    if (process.argv.includes("--session-stream")) {
      const notify = (update) => context.client.notify(methods.client.session.update, { sessionId, update });
      await notify({ sessionUpdate: "session_info_update", title: "Inspect the session stream", updatedAt: "2026-09-08T00:00:00Z" });
      await notify({ sessionUpdate: "current_mode_update", currentModeId: "plan" });
      await notify({ sessionUpdate: "config_option_update", configOptions: [{ id: "model", name: "Model", type: "select", currentValue: "stream-model", options: [{ name: "Stream model", value: "stream-model" }] }] });
      await notify({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "Review workspace changes", input: { hint: "Optional revision" } }] });
      await notify({ sessionUpdate: "usage_update", used: 1200, size: 32000, cost: { amount: 0.02, currency: "USD" } });
      await notify({ sessionUpdate: "plan", entries: [{ content: "Inspect the workspace", status: "completed", priority: "high" }, { content: "Verify streamed evidence", status: "in_progress", priority: "medium" }] });
      await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Starting inspection." } });
      await notify({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Inspecting " } });
      await notify({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "the evidence." } });
      await notify({ sessionUpdate: "tool_call", toolCallId: "read-stream", title: "Read workspace", kind: "read", status: "pending" });
      await notify({ sessionUpdate: "tool_call_update", toolCallId: "read-stream", title: "Read stream fixture", status: "in_progress", rawInput: { path: "fixture.txt", limit: 20 } });
      await notify({ sessionUpdate: "tool_call_update", toolCallId: "read-stream", status: "completed", rawOutput: { files: ["fixture.txt"], verified: true } });
      await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: Array.from({ length: 50 }, (_, i) => `Evidence row ${i + 1}: retained session content.\n`).join("") } });
      const second = await context.client.request(methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: "stream-gate", title: "Continue streamed response", kind: "read", status: "pending" },
        options: [{ optionId: "continue", name: "Continue stream", kind: "allow_once" }],
      });
      if (second.outcome.outcome !== "selected") return { stopReason: "cancelled" };
      await notify({ sessionUpdate: "plan", entries: [{ content: "Inspect the workspace", status: "completed", priority: "high" }, { content: "Verify streamed evidence", status: "completed", priority: "medium" }] });
      await notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "stream:complete" } });
      return { stopReason: "end_turn" };
    }
    if (process.argv.includes("--stream-chunks")) {
      await context.client.notify(methods.client.session.update, {
        sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "fixture:stream-first" } },
      });
      await context.client.request(methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: "stream-gate", title: "Continue streamed response", kind: "read", status: "pending" },
        options: [{ optionId: "continue", name: "Continue stream", kind: "allow_once" }],
      });
      await context.client.notify(methods.client.session.update, {
        sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: ":stream-last" } },
      });
      return { stopReason: "end_turn" };
    }
    let serviceResult;
    if (process.argv.includes("--exercise-client-services")) {
      const source = process.env.ACP_SERVICE_SOURCE;
      const target = process.env.ACP_SERVICE_TARGET;
      const cwd = process.env.ACP_SERVICE_CWD;
      if (!source || !target || !cwd) throw new Error("ACP service fixture paths are missing");
      const read = await context.client.request(methods.client.fs.readTextFile, {
        sessionId, path: source, line: 2, limit: 1,
      });
      await context.client.request(methods.client.fs.writeTextFile, {
        sessionId, path: target, content: `copied:${read.content}`,
      });
      const terminal = await context.client.request(methods.client.terminal.create, {
        sessionId,
        command: process.execPath,
        args: ["-e", "process.stdout.write('terminal-ok\\n')"],
        cwd,
        outputByteLimit: 4096,
      });
      const exited = await context.client.request(methods.client.terminal.waitForExit, {
        sessionId, terminalId: terminal.terminalId,
      });
      const terminalOutput = await context.client.request(methods.client.terminal.output, {
        sessionId, terminalId: terminal.terminalId,
      });
      await context.client.request(methods.client.terminal.release, {
        sessionId, terminalId: terminal.terminalId,
      });
      serviceResult = `services:${read.content.trim()}:${terminalOutput.output.trim()}:${exited.exitCode}`;
    }
    await context.client.notify(methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: serviceResult
            ?? (process.argv.includes("--artifact-plan")
            ? JSON.stringify({
                kind: "HarnessStudioArtifactAgentPlanV1",
                summary: "Rename the selected target through the bounded Provider contract.",
                plan: ["Keep the exact semantic target.", "Ask the Provider to prepare one label change."],
                providerSteering: { kind: "rename", message: "Rename to Agent planned" },
              })
            : process.argv.includes("--malformed-artifact-plan")
              ? "The plan is ready."
              : permission.outcome.outcome === "selected"
                ? `fixture:${permission.outcome.optionId}${sessionConfig.model ? `:${sessionConfig.model}` : ""}`
                : "fixture:cancelled"),
        },
      },
    });
    if (process.argv.includes("--wait-for-cancel")) {
      while (!cancelled) await new Promise((resolve) => setTimeout(resolve, 10));
      return { stopReason: "cancelled" };
    }
    return { stopReason: "end_turn" };
  });

const connection = app.connect(ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
));
await connection.closed;
