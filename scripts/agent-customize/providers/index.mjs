import { collectClaudeCustomizeInventory } from "./claude.mjs";
import { collectCodexCustomizeInventory } from "./codex.mjs";
import { collectCopilotCustomizeInventory } from "./copilot.mjs";
import { collectCursorCustomizeInventory } from "./cursor.mjs";
import { collectDshCustomizeInventory } from "./dsh.mjs";
import { collectGrokCustomizeInventory } from "./grok.mjs";
import { collectPiCustomizeInventory } from "./pi.mjs";
import { collectKimiCustomizeInventory } from "./kimi.mjs";
import { collectQoderCustomizeInventory } from "./qoder.mjs";
import { collectQwenCustomizeInventory } from "./qwen.mjs";
import { collectWorkbuddyCustomizeInventory } from "./workbuddy.mjs";
import { HOST_CAPABILITIES, hostIdsFor } from "../../host-support/index.mjs";

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
