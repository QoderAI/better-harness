#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HarnessComponentSnapshotError,
  createHarnessComponentSnapshot,
  diffHarnessComponentSnapshots,
  parseRollbackReference,
  resolveHarnessComponentRollbackReference,
  validateHarnessComponentSnapshot,
} from "./index.mjs";

const HELP = `Harness Component Snapshot v1

Usage:
  node scripts/harness-component-snapshot/cli.mjs create [--workspace <dir>] [--provider qoder] [--population-key <opaque>]
  node scripts/harness-component-snapshot/cli.mjs validate --snapshot <file>
  node scripts/harness-component-snapshot/cli.mjs diff --before <file> --after <file> [--limit <n>]
  node scripts/harness-component-snapshot/cli.mjs resolve --snapshot <file> --reference <ref>

Operational commands emit one JSON document on stdout; help emits this text.
`;

const COMMANDS = new Set(["create", "validate", "diff", "resolve"]);

// Usage reasons stay explicit, but only allowlisted flag names may appear in
// them. Unrecognized commands and options are caller-supplied argv that can
// hold a private path, so they are reported without their value.
class UsageError extends Error {
  constructor(reason, safeFlag) {
    super(safeFlag ? `${reason}: ${safeFlag}` : reason);
    this.code = "INVALID_USAGE";
    this.exitCode = 64;
    this.usageReason = reason;
    this.usageFlag = safeFlag;
  }
}

function parseOptions(argv, allowed) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--") || !allowed.has(flag)) throw new UsageError("unrecognized option");
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError("missing option value", flag);
    if (Object.hasOwn(options, flag)) throw new UsageError("duplicate option", flag);
    options[flag] = value;
    index += 1;
  }
  return options;
}

function requireOption(options, flag) {
  if (!options[flag]) throw new UsageError("missing required option", flag);
  return options[flag];
}

async function readSnapshot(filePath) {
  let value;
  try {
    value = JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  } catch {
    throw new HarnessComponentSnapshotError("SNAPSHOT_READ_FAILED", "snapshot JSON could not be read or parsed");
  }
  validateHarnessComponentSnapshot(value);
  return value;
}

export async function runHarnessComponentSnapshotCli(argv) {
  if (argv.length === 0 || (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h"))) {
    process.stdout.write(HELP);
    return;
  }
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) throw new UsageError("unrecognized command");
  if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
    process.stdout.write(HELP);
    return;
  }
  let output;
  if (command === "create") {
    const options = parseOptions(rest, new Set(["--workspace", "--provider", "--population-key"]));
    output = await createHarnessComponentSnapshot({
      workspace: options["--workspace"] ?? process.cwd(),
      provider: options["--provider"] ?? "qoder",
      populationKey: options["--population-key"],
    });
  } else if (command === "validate") {
    const options = parseOptions(rest, new Set(["--snapshot"]));
    const snapshot = await readSnapshot(requireOption(options, "--snapshot"));
    output = { kind: "HarnessComponentSnapshotValidationV1", valid: true, snapshotDigest: snapshot.snapshotDigest };
  } else if (command === "diff") {
    const options = parseOptions(rest, new Set(["--before", "--after", "--limit"]));
    const before = await readSnapshot(requireOption(options, "--before"));
    const after = await readSnapshot(requireOption(options, "--after"));
    output = diffHarnessComponentSnapshots(before, after, { limit: options["--limit"] });
  } else if (command === "resolve") {
    const options = parseOptions(rest, new Set(["--snapshot", "--reference"]));
    const snapshot = await readSnapshot(requireOption(options, "--snapshot"));
    const reference = requireOption(options, "--reference");
    parseRollbackReference(reference);
    output = resolveHarnessComponentRollbackReference(snapshot, reference);
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runHarnessComponentSnapshotCli(process.argv.slice(2)).catch((error) => {
    const code = error.code ?? "SNAPSHOT_FAILED";
    const message = error instanceof UsageError
      ? error.message
      : "component snapshot operation failed";
    process.stderr.write(`${code}: ${message}\n`);
    process.exitCode = error.exitCode ?? 1;
  });
}
