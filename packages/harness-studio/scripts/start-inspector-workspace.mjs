#!/usr/bin/env node

import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createInspectorWorkspaceSessionProvider } from "./inspector-workspace-provider.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const { startHarnessStudioServer } = await import(path.join(packageRoot, "dist", "server", "server.js"));
const { createQoderCliIntentAnalyzer } = await import(path.join(packageRoot, "dist", "server", "providers", "qoder", "intent-analyzer.js"));
const { createBundledAgentCustomizationCollector } = await import(path.join(packageRoot, "dist", "server", "customization-collector.js"));
const portIndex = process.argv.indexOf("--port");
const requestedPort = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 3311;
const port = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 3311;
const intentAnalysisEnabled = process.argv.includes("--intent-analysis");
const acpAgentArgs = JSON.parse(process.env.BETTER_HARNESS_ACP_ARGS_JSON || "[]");
if (!Array.isArray(acpAgentArgs) || !acpAgentArgs.every((value) => typeof value === "string")) {
  throw new Error("BETTER_HARNESS_ACP_ARGS_JSON must be a JSON string array.");
}
const nativeIndex = process.argv.indexOf("--evidence-host");
const nativeExecutable = nativeIndex >= 0 ? path.resolve(process.argv[nativeIndex + 1])
  : path.join(repositoryRoot, "packages", "better-harness-desktop", "dist", "native", `harness-evidence-host${process.platform === "win32" ? ".exe" : ""}`);
const { createRustEvidenceHost } = await import(path.join(packageRoot, "dist", "server", "workspace", "rust-evidence-provider.js"));
const performanceHost = existsSync(nativeExecutable) ? createRustEvidenceHost({ executable: nativeExecutable }) : undefined;
// The desktop app stages the microVM shim; a dev Studio reads it from the same
// place so the Debugger's placement control can be exercised without packaging.
const { discoverAcpAgentProfiles } = await import(path.join(packageRoot, "dist", "server", "acp-agent-catalog.js"));
const boxExecutable = path.join(repositoryRoot, "packages", "better-harness-desktop", "dist", "native", "harness-box-exec");
// The desktop app always runs ACP through the Rust host. Without this a dev
// Studio silently takes the Node SDK path instead, which behaves differently in
// ways worth catching here rather than after packaging — Agent startup
// diagnostics, for one, only exist on the Rust side.
const acpHostExecutable = path.join(repositoryRoot, "packages", "better-harness-desktop", "dist", "native", "harness-acp-host");
const started = await startHarnessStudioServer({
  appDir: path.join(packageRoot, "dist", "app"),
  port,
  sessionPerformanceProvider: performanceHost,
  workspaceSessionProvider: createInspectorWorkspaceSessionProvider(),
  acpAgent: {
    command: process.env.BETTER_HARNESS_ACP_AGENT || "codex-acp",
    args: acpAgentArgs,
    label: process.env.BETTER_HARNESS_ACP_AGENT_LABEL || "Codex ACP",
  },
  // The whole catalog, not just the default: placement needs to know which
  // Agents have a recipe, including ones absent from this machine.
  acpAgents: await discoverAcpAgentProfiles(),
  ...(existsSync(boxExecutable) ? { boxExecExecutable: boxExecutable } : {}),
  ...(existsSync(acpHostExecutable) ? { acpHostExecutable, acpHostTransport: "stdio" } : {}),
  customizationCollector: createBundledAgentCustomizationCollector(),
  ...(intentAnalysisEnabled ? { intentAnalyzer: createQoderCliIntentAnalyzer({ pluginRoot: repositoryRoot }) } : {}),
});
process.stdout.write(`Harness Studio workspace: ${started.url}${intentAnalysisEnabled ? " (experimental qoder Intent analysis enabled)" : ""}\n`);
