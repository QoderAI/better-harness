#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  process.stderr.write(
    "Usage: node scripts/validate.mjs <file.harness> [harness-id ...]\n",
  );
}

async function loadHarnessApi() {
  try {
    return await import(new URL("../../../dist/index.js", import.meta.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot load the built @qoder-ai/harness package. Run npm run harness:build first. ${message}`);
  }
}

async function main() {
  const [input, ...requestedIds] = process.argv.slice(2);
  if (!input || input === "--help" || input === "-h") {
    usage();
    process.exitCode = input ? 0 : 2;
    return;
  }

  const inputPath = resolve(input);
  const text = await readFile(inputPath, "utf8");
  const { compileHarness, describeBuiltInAdapter, resolveDeployment, resolveHarness } = await loadHarnessApi();
  const source = `harness://input/${encodeURIComponent(basename(inputPath))}`;
  const compiled = await compileHarness([{ uri: source, text }]);

  if (!compiled.bundle) {
    print({
      valid: false,
      file: input,
      diagnostics: compiled.diagnostics,
      harnesses: [],
    });
    process.exitCode = 1;
    return;
  }

  const harnessIds = requestedIds.length > 0
    ? requestedIds
    : compiled.bundle.harnesses.map((harness) => harness.id);
  const reports = harnessIds.flatMap((harnessId) => {
    const deployments = compiled.bundle.deployments.filter(
      (deployment) => deployment.harness === harnessId,
    );
    const attempts = deployments.length === 0
      ? [resolveHarness(compiled.bundle, harnessId, undefined, { adapter: describeBuiltInAdapter })]
      : deployments.map((deployment) =>
          resolveDeployment(compiled.bundle, deployment.id, { adapter: describeBuiltInAdapter }));
    return attempts.map(({ revision, report }) => ({
      harnessId,
      deploymentId: report.deploymentId ?? null,
      runtime: report.runtime,
      status: report.status,
      revisionId: revision?.revisionId ?? null,
      errors: report.errors,
      realizations: report.realizations,
    }));
  });
  const structuralErrors = harnessIds.length === 0
    ? [{
        severity: "error",
        message: "No harness is declared; generated DSL must be independently resolvable.",
        source,
      }]
    : [];
  const valid = structuralErrors.length === 0 && reports.every((report) => report.status === "resolved");

  print({
    valid,
    file: input,
    diagnostics: [...compiled.diagnostics, ...structuralErrors],
    harnesses: reports,
  });
  if (!valid) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  print({ valid: false, diagnostics: [{ severity: "error", message }], harnesses: [] });
  process.exitCode = 1;
});
