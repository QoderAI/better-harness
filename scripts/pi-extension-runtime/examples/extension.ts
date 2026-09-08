import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { greeting } from "./greeting";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("harness-hello", {
    description: "Show the currently compiled Harness greeting",
    handler: async (_args, ctx) => ctx.ui.notify(greeting, "info"),
  });
}
