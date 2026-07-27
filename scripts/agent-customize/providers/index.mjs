import { collectClaudeCustomizeInventory } from "./claude.mjs";
import { collectCodexCustomizeInventory } from "./codex.mjs";
import { collectCursorCustomizeInventory } from "./cursor.mjs";
import { collectQoderCustomizeInventory } from "./qoder.mjs";

export const PROVIDER_COLLECTORS = new Map([
  ["cursor", collectCursorCustomizeInventory],
  ["qoder", collectQoderCustomizeInventory],
  ["codex", collectCodexCustomizeInventory],
  ["claude", collectClaudeCustomizeInventory],
]);

export async function collectProviderInventory(provider, options = {}) {
  const collectProvider = PROVIDER_COLLECTORS.get(provider);
  if (!collectProvider) {
    throw new Error(`Unsupported agent-customize provider: ${provider}`);
  }
  return collectProvider(options);
}
