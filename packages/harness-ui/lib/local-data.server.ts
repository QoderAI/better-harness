import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { DashboardInput } from "./contracts";

const execFileAsync = promisify(execFile);
let localDataPromise: Promise<DashboardInput> | null = null;

function collectorPath() {
  const candidates = [
    path.resolve(process.cwd(), "scripts", "collect-local-data.mjs"),
    path.resolve(process.cwd(), "packages", "harness-ui", "scripts", "collect-local-data.mjs"),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) throw new Error("Cannot locate the Harness Dashboard data collector.");
  return resolved;
}

function workspacePath(collector: string) {
  return process.env.BETTER_HARNESS_WORKSPACE
    ? path.resolve(process.env.BETTER_HARNESS_WORKSPACE)
    : path.resolve(path.dirname(collector), "..", "..", "..");
}

async function collectLocalData() {
  const collector = collectorPath();
  const { stdout } = await execFileAsync(process.execPath, [
    collector,
    "--workspace",
    workspacePath(collector),
    "--limit",
    process.env.BETTER_HARNESS_SESSION_LIMIT ?? "200",
  ], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
  return JSON.parse(stdout) as DashboardInput;
}

export function loadLocalDashboardInput() {
  localDataPromise ??= collectLocalData().catch((error) => {
    localDataPromise = null;
    throw error;
  });
  return localDataPromise;
}
