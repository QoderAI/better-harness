#!/usr/bin/env node

import { parseArgs } from "../session-analysis/cli.mjs";
import { collectAgentCustomizeInventory, filterManageItems, groupManageItems } from "./index.mjs";

function summarize(inventory, options) {
  const tab = options.tab ?? "plugins";
  const items = filterManageItems(inventory, options);
  const groups = groupManageItems(items, { tab, groupBy: options["group-by"] });
  return {
    provider: inventory.provider,
    cursorHome: inventory.cursorHome,
    qoderHome: inventory.qoderHome,
    codexHome: inventory.codexHome,
    claudeHome: inventory.claudeHome,
    claudeStatePath: inventory.claudeStatePath,
    codexAppPath: inventory.codexAppPath,
    sharedClientCacheRoot: inventory.sharedClientCacheRoot,
    workspace: inventory.workspace,
    tab,
    query: options.query ?? "",
    scopeKind: options.scope ?? options["scope-kind"],
    count: items.length,
    groups: groups.map((group) => ({
      key: group.key,
      title: group.title,
      count: group.items.length,
      items: group.items.map((item) => ({
        name: item.displayName ?? item.name ?? item.label,
        scope: item.scope,
        sourceLabel: item.sourceLabel,
        evidencePath: item.evidence?.path,
      })),
    })),
    unsupported: inventory.unsupported,
  };
}

async function main() {
  const { command = "inventory", options } = parseArgs(process.argv.slice(2));
  if (command !== "inventory" && command !== "manage") {
    throw new Error(`Unknown command: ${command}`);
  }
  const inventory = await collectAgentCustomizeInventory({
    provider: options.provider,
    cursorHome: options["cursor-home"],
    qoderHome: options["qoder-home"],
    codexHome: options["codex-home"],
    claudeHome: options["claude-home"],
    claudeStatePath: options["claude-state"] ?? options["claude-state-path"],
    codexAppPath: options["codex-app-path"],
    qoderSharedClientCacheRoot: options["qoder-shared-client-cache-root"] ?? options["shared-client-cache-root"],
    workspace: options.workspace,
  });
  const payload =
    command === "manage"
      ? summarize(inventory, {
          tab: options.tab,
          query: options.query,
          scopeKind: options.scope ?? options["scope-kind"],
          "group-by": options["group-by"],
        })
      : inventory;
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
