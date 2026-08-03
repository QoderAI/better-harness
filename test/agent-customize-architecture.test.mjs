import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

test("agent-customize inventory keeps host collectors behind provider modules", async () => {
  const [facade, providerIndex] = await Promise.all([
    readRepoFile("scripts/agent-customize/inventory.mjs"),
    readRepoFile("scripts/agent-customize/providers/index.mjs"),
  ]);

  for (const relativePath of [
    "scripts/agent-customize/core/items.mjs",
    "scripts/agent-customize/providers/cursor.mjs",
    "scripts/agent-customize/providers/qoder.mjs",
    "scripts/agent-customize/providers/codex.mjs",
    "scripts/agent-customize/providers/claude.mjs",
    "scripts/agent-customize/providers/qwen.mjs",
    "scripts/agent-customize/providers/copilot.mjs",
    "scripts/agent-customize/providers/index.mjs",
  ]) {
    await assert.doesNotReject(() => readRepoFile(relativePath), `${relativePath} should exist`);
  }

  assert.match(facade, /collectProviderInventory/u);
  assert.doesNotMatch(
    facade,
    /installed_plugins|SharedClientCache|state\.vscdb|\.qoder-plugin|cursor\.plugins\.installedIds/u,
  );
  assert.match(providerIndex, /cursor/u);
  assert.match(providerIndex, /qoder/u);
  assert.match(providerIndex, /codex/u);
  assert.match(providerIndex, /claude/u);
  assert.match(providerIndex, /qwen/u);
  assert.match(providerIndex, /copilot/u);
});

test("host architecture docs keep matrix, providers, and thin shells separate", async () => {
  const [adapterReadme, directoryAdr, architecture, community, glossary] = await Promise.all([
    readRepoFile("docs/adapters/README.md"),
    readRepoFile("docs/adrs/directory-structure.md"),
    readRepoFile("docs/ARCHITECTURE.md"),
    readRepoFile("docs/community.md"),
    readRepoFile("docs/glossary.md"),
  ]);

  assert.match(adapterReadme, /# Host Adapter Matrix/u);
  assert.match(adapterReadme, /`docs\/adapters\/qoder\.md`/u);
  assert.match(adapterReadme, /Codex \| Analysis-capable source-local host \| `\.codex-plugin\/`/u);
  assert.match(adapterReadme, /npm package includes six filesystem metadata\s+roots for Qoder, Claude Code, Codex, Cursor, Qwen, and Copilot, plus Pi install\s+metadata in the existing `package\.json`/u);
  assert.match(adapterReadme, /generated\s+Qoder runtime bundle\s+includes only the Qoder shell/u);
  assert.match(adapterReadme, /Cursor \| Canvas-capable source-local host[^\n]+platforms\/cursor\.mjs/u);
  assert.doesNotMatch(adapterReadme, /Cursor has no session-evidence adapter/u);
  assert.match(adapterReadme, /Split a host into `docs\/adapters\/<host>\.md` only when/u);
  assert.match(adapterReadme, /Canonical product\s+judgment stays in `skills\/`/u);

  assert.match(directoryAdr, /\.cursor-plugin\/\s+# \[active\] thin Cursor shell/u);
  assert.match(directoryAdr, /\.codex-plugin\/\s+# \[active\] thin Codex shell/u);
  assert.match(directoryAdr, /qoder-canvas\.md\s+# \[active\] Qoder Canvas output contract/u);
  assert.match(directoryAdr, /cursor-canvas\.md\s+# \[active\] Cursor Canvas output contract/u);
  assert.match(directoryAdr, /npm-package\/\s+# \[active\] current bundle/u);
  assert.match(directoryAdr, /Host matrix entry\s+\| `docs\/adapters\/README\.md`/u);
  assert.match(directoryAdr, /build-host-plugin\.mjs\s+# assemble an existing thin host shell/u);
  assert.match(directoryAdr, /verify-host-plugin\.mjs\s+# reject host\/package\/state leakage/u);
  assert.match(directoryAdr, /scripts\/packaging\/` owns source-local[\s\S]*excluded from public package\/runtime/u);

  assert.match(architecture, /The Codex shell\s+owns local install\/discovery metadata only/u);
  assert.match(architecture, /public npm\s+package ships all six plugin metadata roots[\s\S]*Qoder runtime bundle\s+includes only `\.qoder-plugin\/`/u);
  assert.match(architecture, /do not create a generic detector or signal umbrella/u);
  assert.match(community, /`docs\/adapters\/README\.md` matrix row/u);
  assert.match(community, /Public npm package includes all six current metadata roots[\s\S]*Qoder runtime bundle includes only `\.qoder-plugin\/`/u);
  assert.match(community, /owning `models\/<model>\.md`, `scripts\/<business-capability>\/`, or `skills\/<skill>\/references\/`/u);
  assert.match(glossary, /public npm package ships all six current metadata roots[\s\S]*Qoder runtime bundle includes only `\.qoder-plugin\/`/u);
  assert.match(glossary, /Start with \[model routing\]\(\.\.\/models\/routing\.md\)/u);

  assert.match(adapterReadme, /Claude Code\s+\|/u);
  assert.match(adapterReadme, /GitHub Copilot \| Analysis-capable source-local host \| `\.github\/plugin\/`[^\n]+platforms\/copilot\.mjs/u);
  assert.match(adapterReadme, /Pi \| Analysis-capable source-local host \| `pi` manifest[^\n]+platforms\/pi\.mjs/u);
  assert.match(directoryAdr, /\.github\/plugin\/\s+# \[active\] thin GitHub Copilot shell/u);
  assert.doesNotMatch(community, /`docs\/adapters\/<host>\.md`\s+\| Discovery paths/u);
  assert.doesNotMatch(architecture, /Do not add `\.codex-plugin\/` until Codex has/u);
  assert.doesNotMatch(directoryAdr, /detector\/\s+# auxiliary detectors/u);
  assert.doesNotMatch(community, /references\/detector/u);
  assert.doesNotMatch(glossary, /references\/detector/u);
});
