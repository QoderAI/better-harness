import os from "node:os";
import path from "node:path";

import { pathExists } from "../../session-analysis/fs.mjs";
import { expandHome } from "../../session-analysis/paths.mjs";

function resolved(value) {
  return path.resolve(expandHome(value));
}

async function source(id, role, filePath, options = {}) {
  return {
    id,
    role,
    exists: await pathExists(filePath),
    selected: Boolean(options.selected),
    editable: Boolean(options.editable),
    generated: Boolean(options.generated),
    precedence: options.precedence ?? null,
  };
}

export async function collectQoderSourceResolution(options = {}, inventory = {}) {
  if ((options.provider ?? "qoder") !== "qoder") {
    return {
      provider: options.provider,
      state: "not-applicable",
      sources: [],
    };
  }

  const explicitHome = options.qoderHome;
  const environmentHome = process.env.QODER_HOME;
  const inventoryHome = inventory.qoderHome;
  const activeHome = resolved(explicitHome ?? environmentHome ?? inventoryHome ?? path.join(os.homedir(), ".qoder"));
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const sharedRoot = inventory.sharedClientCacheRoot
    ? path.resolve(inventory.sharedClientCacheRoot)
    : options.qoderSharedClientCacheRoot
      ? resolved(options.qoderSharedClientCacheRoot)
      : null;
  const projectQoderPath = path.join(workspace, ".qoder", "mcp.json");
  const projectFallbackPath = path.join(workspace, ".mcp.json");
  const projectQoderExists = await pathExists(projectQoderPath);
  const projectFallbackExists = await pathExists(projectFallbackPath);

  const sources = [
    await source("qoder-user-authored", "user-authored", path.join(activeHome, "mcp.json"), {
      selected: true,
      editable: true,
      precedence: 10,
    }),
    await source("qoder-user-merged-runtime", "user-merged-runtime", path.join(activeHome, "extension", "local", "mcp.json"), {
      generated: true,
      precedence: 20,
    }),
    await source("qoder-project-authored", "project-authored", projectQoderPath, {
      selected: projectQoderExists,
      editable: true,
      precedence: 30,
    }),
    await source("qoder-project-fallback", "project-compatibility-fallback", projectFallbackPath, {
      selected: !projectQoderExists && projectFallbackExists,
      editable: true,
      precedence: 25,
    }),
    await source("qoder-legacy-shared-client", "legacy-or-client-authored", path.join(activeHome, "shared_client", "mcp.json"), {
      precedence: 5,
    }),
  ];
  if (sharedRoot) {
    sources.push(
      await source("qoder-shared-cache-merged-runtime", "alternate-merged-runtime", path.join(sharedRoot, "extension", "local", "mcp.json"), {
        generated: true,
        precedence: null,
      }),
    );
  }

  return {
    provider: "qoder",
    state: "selected",
    activeHomeEvidence: explicitHome
      ? "explicit-option"
      : environmentHome
        ? "environment"
        : inventoryHome
          ? "inventory-resolver"
          : "product-default",
    activeHomeExists: await pathExists(activeHome),
    sources,
    selectedProjectSource:
      sources.find((item) => item.id === "qoder-project-authored" && item.selected)?.id ??
      sources.find((item) => item.id === "qoder-project-fallback" && item.selected)?.id ??
      null,
    alternateHomesMerged: false,
    generatedRuntimeSourcesEditable: false,
  };
}
