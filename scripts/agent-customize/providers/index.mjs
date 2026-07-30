import { collectClaudeCustomizeInventory } from "./claude.mjs";
import { collectCodexCustomizeInventory } from "./codex.mjs";
import { collectCopilotCustomizeInventory } from "./copilot.mjs";
import { collectCursorCustomizeInventory } from "./cursor.mjs";
import { collectPiCustomizeInventory } from "./pi.mjs";
import { collectQoderCustomizeInventory } from "./qoder.mjs";
import { collectQwenCustomizeInventory } from "./qwen.mjs";
import { collectWorkbuddyCustomizeInventory } from "./workbuddy.mjs";

export const PROVIDER_COLLECTORS = new Map([
  ["cursor", collectCursorCustomizeInventory],
  ["qoder", collectQoderCustomizeInventory],
  ["codex", collectCodexCustomizeInventory],
  ["claude", collectClaudeCustomizeInventory],
  ["qwen", collectQwenCustomizeInventory],
  ["copilot", collectCopilotCustomizeInventory],
  ["pi", collectPiCustomizeInventory],
  ["workbuddy", collectWorkbuddyCustomizeInventory],
]);

export async function collectProviderInventory(provider, options = {}) {
  const collectProvider = PROVIDER_COLLECTORS.get(provider);
  if (!collectProvider) {
    throw new Error(`Unsupported agent-customize provider: ${provider}`);
  }
  return collectProvider(options);
}
