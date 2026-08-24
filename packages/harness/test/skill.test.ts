import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const VALIDATOR_PATH = fileURLToPath(
  new URL("../skills/generate-harness-dsl/scripts/validate.mjs", import.meta.url),
);
const EXAMPLE_PATH = fileURLToPath(
  new URL("../examples/standard-coding.harness", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function runValidator(file: string, ...harnessIds: string[]) {
  return spawnSync(process.execPath, [VALIDATOR_PATH, file, ...harnessIds], {
    encoding: "utf8",
  });
}

describe("generate-harness-dsl validator", () => {
  it("compiles and resolves the published example through the built public API", () => {
    const result = runValidator(EXAMPLE_PATH);

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.valid).toBe(true);
    expect(output.diagnostics).toEqual([]);
    expect(output.harnesses).toEqual([
      expect.objectContaining({ harnessId: "standard-coding", runtime: "qoder", status: "resolved" }),
    ]);
    expect(output.harnesses[0].realizations).toContainEqual(
      expect.objectContaining({
        agentId: "coder",
        capabilityId: "verification-before-complete",
        dimension: "delivered",
        state: "satisfied",
        mechanism: "prompt-preamble",
      }),
    );
  });

  it("returns structured diagnostics and a non-zero status for invalid DSL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "harness-skill-test-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "invalid.harness");
    await writeFile(
      file,
      "language 0.3\nharness broken { workflow missing-workflow agent coder { use skill missing-skill } }",
      "utf8",
    );

    const result = runValidator(file);

    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.valid).toBe(false);
    expect(output.harnesses).toEqual([]);
    expect(output.diagnostics).toContainEqual(expect.objectContaining({ severity: "error" }));
  });

  it("fails when a requested harness does not exist", () => {
    const result = runValidator(EXAMPLE_PATH, "missing-harness");

    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.valid).toBe(false);
    expect(output.harnesses).toEqual([
      expect.objectContaining({
        harnessId: "missing-harness",
        status: "failed",
        errors: ["Harness 'missing-harness' is not defined in the bundle."],
      }),
    ]);
  });

  it("requires generated files to declare an independently resolvable harness", async () => {
    const directory = await mkdtemp(join(tmpdir(), "harness-skill-test-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "library-only.harness");
    await writeFile(
      file,
      'language 0.3\nskill repository-analysis { description "Analyze the repository." }',
      "utf8",
    );

    const result = runValidator(file);

    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.valid).toBe(false);
    expect(output.harnesses).toEqual([]);
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        message: "No harness is declared; generated DSL must be independently resolvable.",
      }),
    );
  });
});
