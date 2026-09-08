import { Readable, Writable } from "node:stream";
import { agent, methods, ndJsonStream } from "@agentclientprotocol/sdk";

let cancelled = false;
const sessionConfig = {};

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
      agentCapabilities: { loadSession: false },
      authMethods: [],
    };
  })
  .onRequest(methods.agent.session.new, async () => {
    if (process.argv.includes("--delay-new")) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    return {
      sessionId: "fixture-session",
      configOptions: [{
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
  .onRequest(methods.agent.session.setConfigOption, (context) => {
    const { configId, value } = context.params;
    if (process.argv.includes("--reject-config")) {
      return { configOptions: [] };
    }
    sessionConfig[configId] = value;
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
  .onNotification(methods.agent.session.cancel, () => {
    cancelled = true;
  })
  .onRequest(methods.agent.session.prompt, async (context) => {
    if (process.argv.includes("--artifact-internal-error")) {
      process.stderr.write("fixture-secret-context\n");
      throw new Error("fixture-internal-error");
    }
    const sessionId = context.params.sessionId;
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
    if (process.argv.includes("--session-stream")) {
      const notify = (update) => context.client.notify(methods.client.session.update, { sessionId, update });
      await notify({ sessionUpdate: "session_info_update", title: "Inspect the session stream" });
      await notify({ sessionUpdate: "current_mode_update", currentModeId: "plan" });
      await notify({ sessionUpdate: "config_option_update", configOptions: [{ id: "model", name: "Model", type: "select", currentValue: "stream-model", options: [{ name: "Stream model", value: "stream-model" }] }] });
      await notify({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "Review workspace changes" }] });
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
