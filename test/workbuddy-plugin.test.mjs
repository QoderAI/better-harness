import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  buildWorkBuddyPluginArtifact,
  verifyWorkBuddyPluginRoot,
  WORKBUDDY_REQUIRED_PATHS,
} from "../scripts/packaging/workbuddy-plugin.mjs";

function zipEntryNames(buffer) {
  const entries = new Set();
  let offset = 0;
  while (offset < buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    entries.add(buffer.toString("utf8", nameStart, nameStart + nameLength));
    offset = nameStart + nameLength + extraLength + compressedSize;
  }
  return entries;
}

test("WB-AC-01 validates the native team manifest, lead settings, and three members", async () => {
  const result = await verifyWorkBuddyPluginRoot();
  assert.equal(result.name, "better-harness");
  assert.equal(result.agentCount, 4);
  assert.equal(result.memberCount, 3);
});

test("WB-AC-06 and WB-AC-08 build an isolated archive without private host state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-workbuddy-artifact-"));
  const archive = path.join(root, "better-harness.zip");
  try {
    const result = await buildWorkBuddyPluginArtifact({ outputRoot: archive });
    assert.equal(result.archive, archive);
    const entries = zipEntryNames(await readFile(archive));
    for (const required of WORKBUDDY_REQUIRED_PATHS) assert.ok(entries.has(required), required);
    assert.equal([...entries].some((entry) => entry.startsWith(".workbuddy/")), false);
    assert.equal([...entries].some((entry) => entry.startsWith("node_modules/")), false);
    assert.equal([...entries].some((entry) => entry.includes("/Users/") || entry.includes("/home/")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("WB-AC-02 builds a replaceable directory artifact with no symlinks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-workbuddy-dir-"));
  const output = path.join(root, "better-harness");
  try {
    const first = await buildWorkBuddyPluginArtifact({ outputRoot: output });
    assert.equal(first.pluginRoot, output);
    const verified = await verifyWorkBuddyPluginRoot(output);
    assert.equal(verified.version, "0.6.4");
    const second = await buildWorkBuddyPluginArtifact({ outputRoot: output });
    assert.equal(second.pluginRoot, output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
