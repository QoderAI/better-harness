import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const packageRoot = path.resolve(import.meta.dirname, "..", "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const cli = path.join(repositoryRoot, "scripts", "better-harness.mjs");
const port = process.env.HARNESS_UI_TEST_PORT ?? "3410";

export const UPLOADS_DIRECTORY = path.join(packageRoot, "test-results", "uploads");

/**
 * Drive the real `upload plan` and `upload apply` commands against the running
 * Dashboard so the browser assertions read evidence the destination actually
 * accepted, not a fixture written straight into its store.
 */
export default async function globalSetup() {
  const work = path.join(packageRoot, "test-results", "upload-plans");
  await rm(UPLOADS_DIRECTORY, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const planPath = path.join(work, "browser-plan.json");

  await execFileAsync(process.execPath, [
    cli,
    "upload", "plan",
    "--input", path.join(packageRoot, "fixtures", "task-evidence-input.json"),
    "--workspace", repositoryRoot,
    "--workspace-label", "better-harness-browser",
    "--destination", `http://127.0.0.1:${port}/api/upload`,
    "--organization", "acme-engineering",
    "--out", planPath,
  ], { cwd: repositoryRoot });

  await execFileAsync(process.execPath, [cli, "upload", "apply", "--plan", planPath], {
    cwd: repositoryRoot,
  });
}
