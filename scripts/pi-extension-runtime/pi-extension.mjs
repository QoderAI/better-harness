import path from "node:path";
import { createExtensionCompiler } from "./compiler.mjs";

/** Control only: the generated module is loaded separately by official Pi. */
export default function runtimeCompiler(pi) {
  let compiler;
  let building = false;
  let stopped = false;

  pi.registerCommand("harness-reload", {
    description: "Compile Harness extension with esbuild-wasm, then reload Pi",
    handler: async (_args, ctx) => {
      if (building || stopped) return;
      building = true;
      try {
        await ctx.waitForIdle();
        if (stopped) return;
        const entry = process.env.BH_PI_EXTENSION_ENTRY;
        const outfile = process.env.BH_PI_EXTENSION_OUTPUT;
        if (!entry || !outfile) throw new Error("Start with the pi-extension-runtime run command to select source and output.");
        compiler ??= await createExtensionCompiler({
          entry: path.resolve(ctx.cwd, entry), outfile: path.resolve(ctx.cwd, outfile),
        });
        if (stopped) { await compiler.dispose(); return; }
        const result = await compiler.rebuild();
        if (stopped) return;
        if (result.status !== "ready") {
          ctx.ui.notify(`Harness compilation failed; previous extension retained.\n${result.diagnostics.map((d) => d.text).join("\n")}`, "error");
          return;
        }
        ctx.ui.notify(`Harness compiled ${result.revision.slice(0, 12)} (${Math.round(result.durationMs)} ms). Reloading Pi.`, "info");
        // A reload invalidates the old context. Only local cleanup follows it.
        await ctx.reload();
        return;
      } catch (error) {
        if (!stopped) ctx.ui.notify(error.message ?? String(error), "error");
        return;
      } finally {
        building = false;
      }
    },
  });

  pi.registerTool({
    name: "harness_reload", label: "Compile Harness extension",
    description: "After editing the configured Harness extension source, queue compilation and native Pi reload. Completion is reported by the command, not this tool.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      // Pi 0.85.1 otherwise treats this as literal model input, not a command.
      pi.sendUserMessage("/harness-reload", { deliverAs: "followUp", expandPromptTemplates: true });
      return { content: [{ type: "text", text: "Queued /harness-reload; compilation and activation have not completed yet." }], details: { status: "queued" } };
    },
  });

  pi.on("session_shutdown", async () => {
    stopped = true;
    await compiler?.dispose();
  });
}
