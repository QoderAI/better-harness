import { timingSafeEqual } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { activateCandidate, withAgentMaintenance } from "./activation.mjs";

export const inject = ["tools", "agents", "loader", "webServer"];

function errorDetail(error, depth = 0) {
  if (depth > 3) return "";
  const details = [String(error.message ?? error)];
  if (error.cause) details.push(errorDetail(error.cause, depth + 1));
  for (const nested of error.errors ?? []) details.push(errorDetail(nested, depth + 1));
  return details.filter(Boolean).join("; ");
}

export async function apply(ctx, config) {
  const { createPluginRuntime } = await import(config.compilerUrl);
  const runtime = await createPluginRuntime(config);
  const lifetime = new AbortController();
  let status = { phase: "idle", entry: config.entry, message: "Edit the plugin entry, then call harness_compile_plugin in DSH." };
  let job;
  const output = { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] };
  const report = () => JSON.stringify(status);
  ctx.tools.register(defineTool({ name: "harness_design_status", description: "Read Harness Design's source entry, compilation and native activation status.", parameters: {}, output,
    async execute() { return report(); },
  }));
  ctx.tools.register(defineTool({ name: "harness_compile_plugin",
    description: `Compile ${config.entry} with esbuild WASM and queue native DSH plugin activation after all agents are idle. Returns queued status, not activation success. Finish this turn, then use harness_design_status to check activation. Local imports and DSH packages are supported.`,
    parameters: {}, output,
    async execute() {
      if (lifetime.signal.aborted) throw new Error("Harness Design is stopping.");
      if (job) return report();
      status = { phase: "compiling", entry: config.entry, message: "Compiling plugin." };
      // Detach activation from the calling agent's tool turn: waiting here for
      // that same agent to become idle would deadlock its own completion.
      job = (async () => {
        const candidate = await runtime.build({ publish: false });
        if (candidate.status !== "compiled") throw new Error(candidate.diagnostics.map(item => item.text).join("\n"));
        status = { ...status, phase: "waiting", revision: candidate.revision, message: "Compiled; waiting for agents to finish." };
        await withAgentMaintenance({ agents: ctx.agents, onCreated: listener => ctx.on("agent/created", listener), signal: lifetime.signal }, async signal => {
          status = { ...status, phase: "activating", message: "Loading the compiled plugin." };
          const entry = [...ctx.loader.entries()].find(entry => entry.options.id === "harness-wasm-plugin");
          if (!entry) throw new Error("Harness Design plugin entry is unavailable.");
          await activateCandidate({ entry, runtime, candidate, signal });
        });
        status = { ...status, phase: "active", message: "Plugin activated in the running DSH process." };
      })().catch(error => {
        status = { ...status, phase: "error", message: errorDetail(error).slice(0, 2000) };
      }).finally(() => { job = undefined; });
      return report();
    },
  }));
  ctx.effect(() => ctx.webServer.register({ kind: "exact", path: "/harness-design/status", handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
    const provided = Buffer.from(String(req.headers["x-harness-design-token"] ?? ""));
    const expected = Buffer.from(config.token);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { res.writeHead(403); res.end(); return; }
    res.setHeader("Content-Type", "application/json"); res.end(report());
  } }));
  ctx.effect(() => async () => { lifetime.abort(); await job; await runtime.dispose(); });
}
