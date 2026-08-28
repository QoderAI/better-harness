import { Readable, Writable } from "node:stream";
import { agent, methods, ndJsonStream } from "@agentclientprotocol/sdk";

let cancelled = false;
const sessionConfig = {};

const app = agent({ name: "better-harness-acp-fixture" })
  .onRequest(methods.agent.initialize, (context) => ({
    protocolVersion: context.params.protocolVersion,
    agentCapabilities: { loadSession: false },
    authMethods: [],
  }))
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
    await context.client.notify(methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: process.argv.includes("--artifact-plan")
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
                : "fixture:cancelled",
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
