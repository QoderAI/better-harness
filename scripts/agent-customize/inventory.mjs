export {
  filterManageItems,
  groupManageItems,
  tabAvailableForScope,
} from "./core/items.mjs";
import { collectProviderInventory } from "./providers/index.mjs";

export async function collectAgentCustomizeInventory(options = {}) {
  const provider = String(options.provider ?? "cursor").toLowerCase();
  return collectProviderInventory(provider, options);
}

export const collectCustomizeInventory = collectAgentCustomizeInventory;
