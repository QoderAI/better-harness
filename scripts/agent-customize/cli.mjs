#!/usr/bin/env node

import { parseArgs, parseBooleanFlag } from "../session-analysis/index.mjs";
import {
  HOST_CAPABILITIES,
  hostHomeOptionKeys,
  hostIdsFor,
  hostPipeList,
  normalizedHostHomeOptions,
} from "../host-support/index.mjs";
import { collectAgentCustomizeInventory, filterManageItems, groupManageItems } from "./index.mjs";

const CUSTOMIZE_HOSTS = hostIdsFor(HOST_CAPABILITIES.AGENT_CUSTOMIZE);
const CUSTOMIZE_HELP_HOSTS = Object.freeze([
  "cursor",
  ...CUSTOMIZE_HOSTS.filter((hostId) => hostId !== "cursor"),
]);
const CUSTOMIZE_HOME_OPTIONS = hostHomeOptionKeys(CUSTOMIZE_HELP_HOSTS).map((option) => `--${option}`);

function usage() {
  return [
    `Usage: better-harness agent-customize [inventory|manage] --provider <${hostPipeList(CUSTOMIZE_HELP_HOSTS)}> [--workspace <path>]`,
    "       better-harness agent-customize manage --provider <provider> [--tab <tab>] [--query <text>] [--scope <scope>] [--group-by <key>]",
    "",
    "Collect configured agent-customize inventory for one provider as JSON.",
    `Provider home overrides: ${CUSTOMIZE_HOME_OPTIONS.slice(0, 4).join(", ")},`,
    `${CUSTOMIZE_HOME_OPTIONS.slice(4).join(", ")}, --claude-state, --codex-app-path, --qoder-shared-client-cache-root.`,
    "DSH configured-assets options: --cwd <path>, --include-user-home[=<boolean>].",
    "",
  ].join("\n");
}

function wantsHelp(argv) {
  return argv[0] === "help" || argv.includes("--help") || argv.includes("-h");
}

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
    qwenHome: inventory.qwenHome,
    copilotHome: inventory.copilotHome,
    piHome: inventory.piHome,
    workbuddyHome: inventory.workbuddyHome,
    grokHome: inventory.grokHome,
    dshHome: inventory.dshHome,
    claudeStatePath: inventory.claudeStatePath,
    kimiHome: inventory.kimiHome,
    codexAppPath: inventory.codexAppPath,
    sharedClientCacheRoot: inventory.sharedClientCacheRoot,
    workspace: inventory.workspace,
    cwd: inventory.cwd,
    projectRoot: inventory.projectRoot,
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
  const argv = process.argv.slice(2);
  // Help-only path: return before any HOME, workspace, SQLite, or plugin
  // cache access (roadmap A-04).
  if (wantsHelp(argv)) {
    process.stdout.write(usage());
    return;
  }
  const { command = "inventory", options } = parseArgs(argv);
  if (command !== "inventory" && command !== "manage") {
    throw new Error(`Unknown command: ${command}`);
  }
  const inventory = await collectAgentCustomizeInventory({
    provider: options.provider,
    ...normalizedHostHomeOptions(options, options.provider),
    claudeStatePath: options["claude-state"] ?? options["claude-state-path"],
    codexAppPath: options["codex-app-path"],
    qoderSharedClientCacheRoot: options["qoder-shared-client-cache-root"] ?? options["shared-client-cache-root"],
    workspace: options.workspace,
    ...(options.provider === "dsh"
      ? {
          cwd: options.cwd,
          includeUserHome: parseBooleanFlag(options["include-user-home"] ?? false),
        }
      : {}),
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
