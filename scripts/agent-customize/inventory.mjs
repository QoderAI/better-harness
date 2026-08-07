export {
  filterManageItems,
  groupManageItems,
  tabAvailableForScope,
} from "./core/items.mjs";
import { normalizedHostHomeOptions } from "../host-support/index.mjs";
import { collectProviderInventory } from "./providers/index.mjs";

export async function collectAgentCustomizeInventory(options = {}) {
  const provider = String(options.provider ?? "cursor").toLowerCase();
  if (options.projectCollections !== undefined && provider !== "qoder") {
    throw new TypeError("projectCollections is supported only for the Qoder provider");
  }
  return collectProviderInventory(provider, {
    ...options,
    ...normalizedHostHomeOptions(options, provider),
  });
}

export const collectCustomizeInventory = collectAgentCustomizeInventory;
