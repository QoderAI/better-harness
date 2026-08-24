import assert from "node:assert/strict";
import { test } from "vitest";

import {
  LifecycleCliError,
  normalizeReadOnlyTimeout,
  parseReadOnlyOptions,
  runReadOnlyCommand,
} from "../../scripts/plugin-lifecycle/index.mjs";

function outputBuffer() {
  let value = "";
  return {
    stream: { write(chunk) { value += chunk; } },
    read() { return value; },
  };
}

test("shared read-only parser owns common flags and command-specific values", () => {
  const parsed = parseReadOnlyOptions([
    "install",
    "--workspace=space ü",
    "--host", "qwen",
    "--json",
    "--no-color",
    "--timeout", "25",
  ], {
    valueOptions: { "--host": "host" },
  });
  assert.deepEqual(parsed.positionals, ["install"]);
  assert.deepEqual(normalizeReadOnlyTimeout(parsed.options), {
    json: true,
    noColor: true,
    help: false,
    workspace: "space ü",
    host: "qwen",
    timeout: 25,
  });
});

test("shared read-only parser rejects duplicate, empty, and unknown options", () => {
  assert.throws(
    () => parseReadOnlyOptions(["--json", "--json"]),
    (error) => error.code === "DUPLICATE_OPTION",
  );
  assert.throws(
    () => parseReadOnlyOptions(["--workspace="]),
    (error) => error.code === "MISSING_OPTION_VALUE",
  );
  assert.throws(
    () => parseReadOnlyOptions(["--json=true"]),
    (error) => error.code === "UNKNOWN_OPTION",
  );
  assert.throws(
    () => normalizeReadOnlyTimeout({ timeout: "0", help: false }),
    (error) => error.code === "INVALID_TIMEOUT",
  );
});

test("shared runner handles help and JSON failure without executing capability code", async () => {
  const helpOut = outputBuffer();
  let executions = 0;
  const helpExit = await runReadOnlyCommand({
    argv: ["--help"],
    command: "better-harness fixture",
    parse: (argv) => normalizeReadOnlyTimeout(parseReadOnlyOptions(argv).options),
    usage: () => "fixture help\n",
    execute: async () => { executions += 1; },
    envelope: () => { throw new Error("must not envelope help"); },
    renderHuman: () => "must not render",
    stdout: helpOut.stream,
    stderr: outputBuffer().stream,
  });
  assert.equal(helpExit, 0);
  assert.equal(helpOut.read(), "fixture help\n");
  assert.equal(executions, 0);

  const failureOut = outputBuffer();
  const failureExit = await runReadOnlyCommand({
    argv: ["--json"],
    command: "better-harness fixture",
    parse: () => { throw new LifecycleCliError("FIXTURE_INVALID", "Fixture invalid.", { kind: "usage" }); },
    usage: () => "fixture help\n",
    execute: async () => { executions += 1; },
    envelope: () => { throw new Error("must not envelope failure"); },
    renderHuman: () => "must not render",
    stdout: failureOut.stream,
    stderr: outputBuffer().stream,
  });
  assert.equal(failureExit, 64);
  assert.equal(JSON.parse(failureOut.read()).diagnostics[0].code, "FIXTURE_INVALID");
  assert.equal(executions, 0);
});

test("shared runner owns timeout, envelope, human rendering, and exit mapping", async () => {
  const machineOut = outputBuffer();
  const machineExit = await runReadOnlyCommand({
    argv: ["--json"],
    command: "better-harness fixture",
    parse: (argv) => normalizeReadOnlyTimeout(parseReadOnlyOptions(argv).options),
    usage: () => "fixture help\n",
    execute: async () => ({ status: "partial", diagnostics: [] }),
    renderHuman: () => "fixture human\n",
    stdout: machineOut.stream,
    stderr: outputBuffer().stream,
  });
  assert.equal(machineExit, 2);
  const payload = JSON.parse(machineOut.read());
  assert.equal(payload.command, "better-harness fixture");
  assert.equal(payload.meta.sideEffects, "read-only");

  const humanOut = outputBuffer();
  const humanExit = await runReadOnlyCommand({
    argv: [],
    command: "better-harness fixture",
    parse: (argv) => normalizeReadOnlyTimeout(parseReadOnlyOptions(argv).options),
    usage: () => "fixture help\n",
    execute: async () => ({ status: "ok", diagnostics: [] }),
    envelope: () => { throw new Error("human mode must not create an envelope"); },
    renderHuman: () => "fixture human\n",
    stdout: humanOut.stream,
    stderr: outputBuffer().stream,
  });
  assert.equal(humanExit, 0);
  assert.equal(humanOut.read(), "fixture human\n");
});
