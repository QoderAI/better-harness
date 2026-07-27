import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 180_000;

export function createCodexCliJsonModelClient({
  command = "codex",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  runner = runProcess,
} = {}) {
  return {
    async generateJson({ name, prompt, schema }) {
      const runDirectory = await mkdtemp(path.join(os.tmpdir(), "better-harness-session-facets-"));
      const schemaFile = path.join(runDirectory, `${safeName(name)}.schema.json`);
      const outputFile = path.join(runDirectory, `${safeName(name)}.output.json`);
      await writeFile(schemaFile, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
      try {
        await runner({
          command,
          args: [
            "exec",
            "--sandbox", "read-only",
            "--ephemeral",
            "--skip-git-repo-check",
            "--ignore-user-config",
            "--ignore-rules",
            "--cd", runDirectory,
            "--output-schema", schemaFile,
            "--output-last-message", outputFile,
            "-",
          ],
          input: prompt,
          cwd: runDirectory,
          timeoutMs,
        });
        const output = await readFile(outputFile, "utf8");
        return parseJsonObject(output, name);
      } finally {
        await rm(runDirectory, { recursive: true, force: true });
      }
    },
  };
}

export async function runProcess({ command, args, input, cwd, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: withoutDumbTerm(process.env),
      stdio: ["pipe", "ignore", "pipe"],
      shell: false,
    });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(Object.assign(new Error(`${command} timed out after ${timeoutMs}ms`), {
        code: "SEMANTIC_MODEL_TIMEOUT",
      }));
    }, timeoutMs);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(Object.assign(
        new Error(`${command} failed with code ${code ?? signal}: ${stderr.slice(0, 1_000)}`),
        { code: "SEMANTIC_MODEL_FAILED" },
      ));
    });
    child.stdin.end(input);
  });
}

function parseJsonObject(value, name) {
  const text = String(value ?? "").trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through to the bounded object extraction for CLI wrappers that add prose.
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to the stable fail-closed error below.
    }
  }
  throw Object.assign(new Error(`${name} model output was not one JSON object`), {
    code: "INVALID_SEMANTIC_MODEL_JSON",
  });
}

function safeName(value) {
  return String(value ?? "analysis").replace(/[^A-Za-z0-9._-]/gu, "-").slice(0, 80) || "analysis";
}

function withoutDumbTerm(environment) {
  const next = { ...environment };
  if (next.TERM === "dumb") delete next.TERM;
  return next;
}
