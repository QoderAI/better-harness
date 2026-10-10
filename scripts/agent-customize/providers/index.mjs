import { collectClaudeCustomizeInventory } from "./claude.mjs";
import { collectCodexCustomizeInventory } from "./codex.mjs";
import { collectCopilotCustomizeInventory } from "./copilot.mjs";
import { collectCursorCustomizeInventory } from "./cursor.mjs";
import { collectGrokCustomizeInventory } from "./grok.mjs";
import { collectPiCustomizeInventory } from "./pi.mjs";
import { collectKimiCustomizeInventory } from "./kimi.mjs";
import { collectQoderCustomizeInventory } from "./qoder.mjs";
import { collectQwenCustomizeInventory } from "./qwen.mjs";
import { collectWorkbuddyCustomizeInventory } from "./workbuddy.mjs";
import { HOST_CAPABILITIES, hostIdsFor } from "../../host-support/index.mjs";

async function collectDshCustomizeInventory(options) {
  let provider;
  try {
    provider = await import("./dsh.mjs");
  } catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && /Cannot find package 'yaml'/u.test(error.message)) {
      throw new Error("DSH configured-assets inventory requires the yaml runtime dependency. Run npm ci in a source checkout, or use the packaged runtime bundle.", { cause: error });
    }
    throw error;
  }
  return provider.collectDshCustomizeInventory(options);
}

export const PROVIDER_COLLECTORS = new Map([
  ["cursor", collectCursorCustomizeInventory],
  ["qoder", collectQoderCustomizeInventory],
  ["codex", collectCodexCustomizeInventory],
  ["claude", collectClaudeCustomizeInventory],
  ["qwen", collectQwenCustomizeInventory],
  ["copilot", collectCopilotCustomizeInventory],
  ["pi", collectPiCustomizeInventory],
  ["kimi", collectKimiCustomizeInventory],
  ["workbuddy", collectWorkbuddyCustomizeInventory],
  ["grok", collectGrokCustomizeInventory],
  ["dsh", collectDshCustomizeInventory],
]);

export const SUPPORTED_CUSTOMIZE_PROVIDERS = hostIdsFor(HOST_CAPABILITIES.AGENT_CUSTOMIZE);

export async function collectProviderInventory(provider, options = {}) {
  const collectProvider = PROVIDER_COLLECTORS.get(provider);
  if (!collectProvider) {
    throw new Error(`Unsupported agent-customize provider: ${provider}`);
  }
  return collectProvider(options);
}
