import { resolve } from "node:path";
import { startHarnessStudioServer } from "../../dist/server/server.js";

const packageRoot = resolve(import.meta.dirname, "../..");
const realHistory = process.env.HARNESS_STUDIO_HISTORY;
const experimentRunner = async (options) => {
  const emit = (type, laneId, runId, event) => options.onEvent?.({
    type,
    experimentId: options.experimentId,
    laneId,
    runId,
    at: new Date().toISOString(),
    ...(event ? { event } : {}),
  });
  for (const laneId of ["fresh-default", "fresh-minimal"]) {
    const runId = `${options.experimentId}:${laneId}:1`;
    emit("lane-started", laneId, runId);
    emit("lane-event", laneId, runId, {
      type: "tool-call-started",
      toolCallId: "read",
      toolName: "Read",
      input: laneId === "fresh-default"
        ? { path: "packages/harness/src/compare/runner.ts" }
        : { file_path: "packages/harness/src/compare/runner.ts" },
    });
    emit("lane-event", laneId, runId, { type: "tool-call-result", toolCallId: "read", content: "read" });
    emit("lane-event", laneId, runId, { type: "tool-call-started", toolCallId: "edit", toolName: "Edit", input: { path: "packages/harness/src/experiment/runner.ts" } });
    emit("lane-event", laneId, runId, { type: "tool-call-result", toolCallId: "edit", content: "edited" });
    emit("lane-event", laneId, runId, {
      type: "tool-call-started",
      toolCallId: "test",
      toolName: "Bash",
      input: { command: laneId === "fresh-default" ? "npm test" : "npm run test" },
    });
    emit("lane-event", laneId, runId, { type: "tool-call-result", toolCallId: "test", content: "passed" });
    emit("lane-finished", laneId, runId);
  }
  const compareSet = {
    contrasts: [
      { id: "profile-effect", lanes: ["fresh-default", "fresh-minimal"], status: "accept", reason: "Matched trials favor the candidate profile." },
      { id: "history-context", lanes: ["history", "fresh-default", "fresh-minimal"], status: "descriptive", reason: "Historical identity is incomplete." },
    ],
  };
  options.onEvent?.({
    type: "experiment-finished",
    experimentId: options.experimentId,
    laneId: null,
    runId: null,
    at: new Date().toISOString(),
    compareSet,
  });
  return compareSet;
};

const started = await startHarnessStudioServer({
  appDir: resolve(packageRoot, "dist/app"),
  experimentManifestPath: resolve(packageRoot, "../harness/examples/checkpoint-experiment/experiment.json"),
  ...(realHistory !== undefined ? { experimentTrajectoryOverrides: { history: resolve(realHistory) } } : {}),
  experimentRunner,
  port: Number(process.env.HARNESS_STUDIO_DEMO_PORT ?? 3312),
});
process.stdout.write(`${started.url}\n`);
