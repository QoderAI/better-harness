import path from "node:path";
import { fileURLToPath } from "node:url";

import { startHarnessStudioServer } from "../../dist/server/server.js";

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(fixtureDirectory, "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const acpAgentFixture = path.resolve(packageRoot, "../harness/test/fixtures/acp-agent.mjs");
const configuredAgent = process.env.BETTER_HARNESS_ACP_AGENT;
const configuredAgentArgs = configuredAgent === undefined
  ? [acpAgentFixture]
  : JSON.parse(process.env.BETTER_HARNESS_ACP_ARGS_JSON || "[]");
if (!Array.isArray(configuredAgentArgs) || !configuredAgentArgs.every((value) => typeof value === "string")) {
  throw new Error("BETTER_HARNESS_ACP_ARGS_JSON must be a JSON string array.");
}
const portIndex = process.argv.indexOf("--port");
const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 3311;

const started = await startHarnessStudioServer({
  appDir: path.join(packageRoot, "dist", "app"),
  port,
  workspaceDirectoryPicker: async () => repositoryRoot,
  workspaceSessionProvider: {
    discover: async () => ({ label: "better-harness ACP fixture", sessions: [] }),
  },
  acpAgent: {
    command: configuredAgent || process.execPath,
    args: configuredAgentArgs,
    label: configuredAgent ? "Codex ACP" : "Fixture ACP",
  },
});

process.stdout.write(`ACP Debugger fixture: ${started.url}\n`);
