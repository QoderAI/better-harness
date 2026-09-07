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
