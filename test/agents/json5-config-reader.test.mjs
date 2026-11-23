import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  normalizeJson5Text,
  parseJson5Text,
  readJson5File,
  stripTrailingCommas,
} from "../../scripts/agent-customize/core/json5.mjs";

test("parseJson5Text leaves valid JSON on the strict path", () => {
  const result = parseJson5Text('{"mcp":{"servers":{}}}');
  assert.equal(result.format, "json");
  assert.deepEqual(result.value, { mcp: { servers: {} } });
});

test("parseJson5Text reads comments, trailing commas, bare keys, and single quotes", () => {
  const text = `{
    // managed servers
    mcp: {
      /* nested block comment */
      servers: {
        docs: { command: 'npx', args: ['-y', 'docs-mcp'], },
        remote: { url: "https://mcp.example.com/sse" },
        offline: { command: 'offline-mcp', enabled: false },
      },
    },
  }`;
  const result = parseJson5Text(text);
  assert.equal(result.format, "json5", result.message);
  assert.deepEqual(result.value, {
    mcp: {
      servers: {
        docs: { command: "npx", args: ["-y", "docs-mcp"] },
        remote: { url: "https://mcp.example.com/sse" },
        offline: { command: "offline-mcp", enabled: false },
      },
    },
  });
});

test("parseJson5Text keeps comment and comma markers that live inside strings", () => {
  const text = `{
    note: "https://example.com//path?q=1", // real comment
    pattern: "a,}",
    quoted: 'say "hi"',
    escaped: 'it\\'s',
  }`;
  const result = parseJson5Text(text);
  assert.equal(result.format, "json5", result.message);
  assert.equal(result.value.note, "https://example.com//path?q=1");
  assert.equal(result.value.pattern, "a,}");
  assert.equal(result.value.quoted, 'say "hi"');
  assert.equal(result.value.escaped, "it's");
});

test("parseJson5Text reports text it cannot normalize instead of returning an empty config", () => {
  const result = parseJson5Text("{ agents: { defaults: { workspace: /opt/agents } } }");
  assert.equal(result.ok, false);
  assert.equal(result.format, "invalid");
  assert.equal(typeof result.message, "string");
});

test("stripTrailingCommas leaves arrays and nested closings intact", () => {
  assert.equal(stripTrailingCommas('{"a":[1,2,],"b":{"c":3,},}'), '{"a":[1,2],"b":{"c":3}}');
  assert.equal(stripTrailingCommas('{"a":"x,}"}'), '{"a":"x,}"}');
  assert.equal(normalizeJson5Text('{"a":1}'), '{"a":1}');
});

test("readJson5File separates empty and missing config files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-json5-"));
  try {
    const empty = path.join(root, "empty.json");
    await writeFile(empty, "  \n// nothing configured yet\n");
    const emptyResult = await readJson5File(empty);
    assert.equal(emptyResult.ok, true);
    assert.equal(emptyResult.exists, true);
    assert.deepEqual(emptyResult.value, {});

    const missingResult = await readJson5File(path.join(root, "missing.json"));
    assert.equal(missingResult.ok, false);
    assert.equal(missingResult.exists, false);
    assert.equal(missingResult.format, "missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
