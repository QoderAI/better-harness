import { Readable, Writable } from "node:stream";
import { agent, methods, ndJsonStream } from "@agentclientprotocol/sdk";

let cancelled = false;

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
    return { sessionId: "fixture-session" };
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
          text: permission.outcome.outcome === "selected"
            ? `fixture:${permission.outcome.optionId}`
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
