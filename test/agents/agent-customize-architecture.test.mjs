import assert from "node:assert/strict";
import { test } from "vitest";

import * as inventory from "../../scripts/agent-customize/inventory.mjs";
import {
  collectProviderInventory,
  PROVIDER_COLLECTORS,
  SUPPORTED_CUSTOMIZE_PROVIDERS,
} from "../../scripts/agent-customize/providers/index.mjs";

test("agent-customize exposes one stable facade over provider collectors", () => {
  assert.deepEqual(Object.keys(inventory).sort(), [
    "collectAgentCustomizeInventory",
    "collectCustomizeInventory",
    "filterManageItems",
    "groupManageItems",
    "tabAvailableForScope",
  ]);
  assert.equal(inventory.collectCustomizeInventory, inventory.collectAgentCustomizeInventory);
  assert.deepEqual([...PROVIDER_COLLECTORS.keys()].sort(), [...SUPPORTED_CUSTOMIZE_PROVIDERS].sort());
  assert.equal([...PROVIDER_COLLECTORS.values()].every((collector) => typeof collector === "function"), true);
});

test("agent-customize provider routing fails closed for undeclared hosts", async () => {
  await assert.rejects(
    collectProviderInventory("unknown-provider"),
    /Unsupported agent-customize provider: unknown-provider/u,
  );
});
