import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { greeting } from "./greeting";

export const inject = ["tools", "webServer"];

export function apply(ctx: Context) {
  ctx.effect(() => {
    console.log(`HARNESS_WASM_LIFECYCLE ${JSON.stringify({ event: "start", greeting, pid: process.pid })}`);
    return () => console.log(`HARNESS_WASM_LIFECYCLE ${JSON.stringify({ event: "stop", greeting, pid: process.pid })}`);
  });
  ctx.tools.register(defineTool({
    name: "harness_greeting", description: "Read the greeting from the currently loaded Harness plugin.",
    parameters: {}, output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
    async execute() { return greeting; },
  }));
  // Inert GET-only probe. The official DSH Web UI and API remain upstream-owned.
  ctx.effect(() => ctx.webServer.register({ kind: "exact", path: "/harness-wasm-probe",
    async handler(req, res) {
      if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
      const tool = ctx.tools.get("harness_greeting");
      const value = await tool.execute({}, { signal: new AbortController().signal });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ greeting, toolValue: value, pid: process.pid }));
    },
  }));
}
