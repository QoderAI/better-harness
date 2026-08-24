#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createInspectorWorkspaceSessionProvider } from "./inspector-workspace-provider.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const { startHarnessStudioServer } = await import(path.join(packageRoot, "dist", "server", "server.js"));
const { createQoderCliIntentAnalyzer } = await import(path.join(packageRoot, "dist", "server", "qoder-intent-analyzer.js"));
const { createBundledAgentCustomizationCollector } = await import(path.join(packageRoot, "dist", "server", "customization-collector.js"));
const portIndex = process.argv.indexOf("--port");
const requestedPort = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 3311;
const port = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 3311;
const intentAnalysisEnabled = process.argv.includes("--intent-analysis");
const acpAgentArgs = JSON.parse(process.env.BETTER_HARNESS_ACP_ARGS_JSON || "[]");
if (!Array.isArray(acpAgentArgs) || !acpAgentArgs.every((value) => typeof value === "string")) {
  throw new Error("BETTER_HARNESS_ACP_ARGS_JSON must be a JSON string array.");
}
const started = await startHarnessStudioServer({
  appDir: path.join(packageRoot, "dist", "app"),
  port,
  workspaceSessionProvider: createInspectorWorkspaceSessionProvider(),
  acpAgent: {
    command: process.env.BETTER_HARNESS_ACP_AGENT || "codex-acp",
    args: acpAgentArgs,
    label: process.env.BETTER_HARNESS_ACP_AGENT_LABEL || "Codex ACP",
  },
  customizationCollector: createBundledAgentCustomizationCollector(),
  ...(intentAnalysisEnabled ? { intentAnalyzer: createQoderCliIntentAnalyzer({ pluginRoot: repositoryRoot }) } : {}),
});
process.stdout.write(`Harness Studio workspace: ${started.url}${intentAnalysisEnabled ? " (experimental qoder Intent analysis enabled)" : ""}\n`);
