import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "vitest";

import {
  artifactPackage,
  assertOutputBoundary,
  buildAntigravityPluginArtifact,
  formatBuildSuccess,
  publishStagedArtifact,
} from "../../scripts/packaging/antigravity/build-antigravity-plugin.mjs";

import {
  ANTIGRAVITY_ARTIFACT_KIND,
  ANTIGRAVITY_ARTIFACT_MARKER,
  ANTIGRAVITY_ARTIFACT_SCHEMA_VERSION,
  ANTIGRAVITY_HOST,
  CANONICAL_SKILL,
  FILE_LIMITS,
  GRAPH_LIMITS,
  RUNTIME_DEPENDENCIES,
  parseEsmSpecifiers,
  parseMarkdownTargets,
  validatePortablePathComponent,
  validateTraversalBounds,
  verifyAntigravityPluginArtifact,
  verifyMarkdownSourceClosure,
} from "../../scripts/packaging/antigravity/verify-antigravity-plugin.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDir, "../..");
const verifierPath = path.resolve(
  currentDir,
  "../../scripts/packaging/antigravity/verify-antigravity-plugin.mjs",
);
const builderPath = path.resolve(
  currentDir,
  "../../scripts/packaging/antigravity/build-antigravity-plugin.mjs",
);

async function writeArtifactFile(root, relativePath, content = "fixture\n") {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

function baseMarker(overrides = {}) {
  return {
    kind: ANTIGRAVITY_ARTIFACT_KIND,
    schemaVersion: ANTIGRAVITY_ARTIFACT_SCHEMA_VERSION,
    host: ANTIGRAVITY_HOST,
    pluginName: "better-harness",
    version: "1.2.3",
    canonicalSkill: CANONICAL_SKILL,
    runtimeDependencies: [...RUNTIME_DEPENDENCIES],
    ...overrides,
  };
}

function basePackage(overrides = {}) {
  return {
    name: "@qoder-ai/better-harness",
    version: "1.2.3",
    private: true,
    license: "MIT",
    type: "module",
    bin: { "better-harness": "scripts/better-harness.mjs" },
    engines: { node: ">=22", npm: ">=10" },
    dependencies: {
      "@vscode/tree-sitter-wasm": "1.0.0",
      "esbuild-wasm": "1.0.0",
    },
    ...overrides,
  };
}

function baseSourcePackage(overrides = {}) {
  return {
    name: "@qoder-ai/better-harness",
    version: "1.2.3",
    license: "MIT",
    type: "module",
    bin: { "better-harness": "scripts/better-harness.mjs" },
    engines: { node: ">=22", npm: ">=10" },
    dependencies: {
      "@vscode/tree-sitter-wasm": "1.0.0",
      "esbuild-wasm": "1.0.0",
    },
    ...overrides,
  };
}

async function createArtifact({
  rootName = "better-harness",
  manifest = { name: "better-harness" },
  manifestText,
  marker = baseMarker(),
  packageJson = basePackage(),
} = {}) {
  const container = await mkdtemp(path.join(os.tmpdir(), "better-harness-antigravity-test-"));
  const pluginRoot = path.join(container, rootName);
  await mkdir(pluginRoot);
  for (const relativePath of [
    "README.md",
    "AGENTS.md",
    "DESIGN.md",
    "LICENSE",
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
  ]) {
    await writeArtifactFile(pluginRoot, relativePath);
  }
  await writeArtifactFile(
    pluginRoot,
    "plugin.json",
    manifestText ?? `${JSON.stringify(manifest)}\n`,
  );
  await writeArtifactFile(
    pluginRoot,
    ANTIGRAVITY_ARTIFACT_MARKER,
    `${JSON.stringify(marker)}\n`,
  );
  await writeArtifactFile(pluginRoot, "package.json", `${JSON.stringify(packageJson)}\n`);
  await writeArtifactFile(
    pluginRoot,
    CANONICAL_SKILL,
    [
      "# Better Harness",
      "",
      "[Direct](../../references/direct.md)",
      "[Guide][guide]",
      "[guide]: ../../docs/guide.md#start",
      "",
    ].join("\n"),
  );
  await writeArtifactFile(
    pluginRoot,
    "references/direct.md",
    "[Transitive](../templates/transitive.md?mode=test)\n",
  );
  await writeArtifactFile(
    pluginRoot,
    "templates/transitive.md",
    "[Cycle](../skills/better-harness/SKILL.md)\n",
  );
  await writeArtifactFile(pluginRoot, "docs/guide.md", "# Guide\n");
  await writeArtifactFile(
    pluginRoot,
    "scripts/better-harness.mjs",
    [
      'import "./runtime/main.mjs";',
      'export { exported } from "./runtime/exported.mjs";',
      'export const dynamic = import("./runtime/dynamic.mjs");',
      "",
    ].join("\n"),
  );
  await writeArtifactFile(
    pluginRoot,
    "scripts/runtime/main.mjs",
    [
      'import "node:path";',
      'import "@vscode/tree-sitter-wasm";',
      'export * from "./helper.mjs";',
      "",
    ].join("\n"),
  );
  await writeArtifactFile(pluginRoot, "scripts/runtime/helper.mjs", "export const helper = true;\n");
  await writeArtifactFile(pluginRoot, "scripts/runtime/exported.mjs", "export const exported = true;\n");
  await writeArtifactFile(pluginRoot, "scripts/runtime/dynamic.mjs", "export default true;\n");
  await writeArtifactFile(
    pluginRoot,
    "node_modules/@vscode/tree-sitter-wasm/package.json",
    '{"name":"@vscode/tree-sitter-wasm","version":"1.0.0"}\n',
  );
  await writeArtifactFile(pluginRoot, "node_modules/@vscode/tree-sitter-wasm/LICENSE");
  await writeArtifactFile(
    pluginRoot,
    "node_modules/esbuild-wasm/package.json",
    '{"name":"esbuild-wasm","version":"1.0.0"}\n',
  );
  await writeArtifactFile(pluginRoot, "node_modules/esbuild-wasm/worker.mjs", "export default true;\n");
  await writeArtifactFile(pluginRoot, "node_modules/esbuild-wasm/LICENSE.md");
  return { container, pluginRoot };
}

async function withArtifact(options, callback) {
  const artifact = await createArtifact(options);
  try {
    return await callback(artifact);
  } finally {
    await rm(artifact.container, { recursive: true, force: true });
  }
}

async function createPublishFixture() {
  const { container, pluginRoot: outputRoot } = await createArtifact();
  const stageRoot = path.join(container, "stage-container", "better-harness");
  await cp(outputRoot, stageRoot, { recursive: true });
  return { container, outputRoot, stageRoot };
}

async function createSourceRepo({ manifestText, packageJson } = {}) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "better-harness-antigravity-source-"));
  for (const relative of [
    "README.md",
    "AGENTS.md",
    "DESIGN.md",
    "LICENSE",
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
  ]) await writeArtifactFile(repoRoot, relative);
  const sourcePackage = packageJson ?? baseSourcePackage();
  await writeArtifactFile(repoRoot, "package.json", `${JSON.stringify(sourcePackage)}\n`);
  await writeArtifactFile(
    repoRoot,
    "scripts/packaging/antigravity/plugin-manifest.json",
    manifestText ?? '{"name":"better-harness"}\n',
  );
  await writeArtifactFile(repoRoot, CANONICAL_SKILL, "# Better Harness\n");
  await writeArtifactFile(repoRoot, "scripts/better-harness.mjs", "export const fixture = true;\n");
  for (const dependency of RUNTIME_DEPENDENCIES) {
    await writeArtifactFile(
      repoRoot,
      `node_modules/${dependency}/package.json`,
      `${JSON.stringify({ name: dependency, version: "1.0.0" })}\n`,
    );
    const license = dependency === "esbuild-wasm" ? "LICENSE.md" : "LICENSE";
    await writeArtifactFile(repoRoot, `node_modules/${dependency}/${license}`);
  }
  return repoRoot;
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message.includes(path.parse(os.tmpdir()).root), false);
    return true;
  });
}

test("verifies the closed Agy CLI manifest variants with recursive Markdown and runtime closure", async () => {
  for (const manifest of [
    { name: "better-harness" },
    { name: "better-harness", description: "" },
    { name: "better-harness", description: "Better Harness" },
  ]) {
    await withArtifact({ manifest }, async ({ pluginRoot }) => {
      const result = await verifyAntigravityPluginArtifact(pluginRoot);
      assert.equal(result.pluginName, "better-harness");
      assert.equal(result.version, "1.2.3");
      assert.deepEqual(result.runtimeDependencies, RUNTIME_DEPENDENCIES);
      assert.ok(result.markdownClosure.files.includes("references/direct.md"));
      assert.ok(result.markdownClosure.files.includes("templates/transitive.md"));
      assert.ok(result.markdownClosure.nodes < 10, "cycle must remain bounded");
      assert.ok(result.runtimeClosure.files.includes("scripts/runtime/helper.mjs"));
      assert.ok(result.runtimeClosure.files.includes("scripts/runtime/dynamic.mjs"));
      assert.equal(JSON.stringify(result).includes(pluginRoot), false);
    });
  }
});

test("parses only syntax-authoritative ESM dependencies", () => {
  const source = String.raw`
    import "./side-effect.mjs";
    import value from "./value.mjs";
    export { value } from "./exported.mjs";
    const ordinary = "escaped\\nstring import('ignored-one')";
    const pattern = /import\("ignored-two"\)/gu;
    const object = { import() {} };
    object.import("ignored-three");
    const exporter = { export() { const from = 1; return from; } };
    exporter.export(from);
    const meta = import.meta.url;
    if (ok) /import("ignored-six")/.test(value);
    while (ok) /import("ignored-seven")/.test(value);
    do /import("ignored-eight")/.test(value); while (ok);
    for await (const item of items) /import("ignored-nine")/.test(item);
    // import("ignored-four")
    /* export * from "ignored-five" */
    const template = ` + "`text ${import(\"./template-literal.mjs\")} ${ordinary}`" + `;
  `;
  assert.deepEqual(parseEsmSpecifiers(source), [
    "./side-effect.mjs",
    "./value.mjs",
    "./template-literal.mjs",
    "./exported.mjs",
  ]);
  assert.throws(
    () => parseEsmSpecifiers("const value = `x ${import(target)}`;"),
    (error) => error.code === "runtime-dynamic-import-unresolved",
  );
  assert.deepEqual(parseEsmSpecifiers([
    "const object = { import(value = import('method-default')) { return import('method-body'); } };",
    "class Example { import(value) { return value; } }",
  ].join("\n")), ["method-default", "method-body"]);
  assert.throws(
    () => parseEsmSpecifiers("const value = import(target);"),
    (error) => error.code === "runtime-dynamic-import-unresolved",
  );
});

test("verifies the pinned real runtime closure through better-harness-cli", async () => {
  await withArtifact({}, async ({ pluginRoot }) => {
    await rm(path.join(pluginRoot, "scripts"), { recursive: true, force: true });
    await cp(path.join(repositoryRoot, "scripts"), path.join(pluginRoot, "scripts"), {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}scripts${path.sep}packaging`),
    });
    const result = await verifyAntigravityPluginArtifact(pluginRoot);
    assert.ok(result.runtimeClosure.files.includes("scripts/better-harness.mjs"));
    assert.ok(result.runtimeClosure.files.includes("scripts/better-harness-cli/cli.mjs"));
    assert.equal(result.runtimeClosure.modules, 19);
  });
});

test("parses Markdown destinations without treating code as closure", () => {
  const targets = parseMarkdownTargets([
    "[angle](<../../docs/my file.md>)",
    "[balanced](../../docs/a_(b).md)",
    String.raw`[escaped](../../docs/a_\(b\).md)`,
    "[reference][guide]",
    "[collapsed][]",
    "[shortcut]",
    "[outer [inner]](../../docs/nested.md)",
    String.raw`[outer \[escaped\]](../../docs/escaped.md)`,
    "[`inline-code-label`](../../docs/code-label.md)",
    "[multi",
    "  line](../../docs/multiline.md)",
    "[guide]: ../../docs/reference.md",
    "[collapsed]: ../../docs/collapsed.md",
    "[shortcut]: ../../docs/shortcut.md",
    "`[inline](../../docs/ignored-inline.md)`",
    "```md",
    "[fenced](../../docs/ignored-fenced.md)",
    "```",
    "    [indented](../../docs/ignored-indented.md)",
    "- item",
    "    [list-active](../../docs/list-active.md)",
    "  - nested",
    "      [nested-active](../../docs/nested-active.md)",
    "        [nested-code](../../docs/ignored-nested-code.md)",
    "",
    "[dedented](../../docs/dedented.md)",
  ].join("\n"));
  assert.deepEqual(targets, [
    "../../docs/my file.md",
    "../../docs/a_(b).md",
    "../../docs/a_(b).md",
    "../../docs/reference.md",
    "../../docs/collapsed.md",
    "../../docs/shortcut.md",
    "../../docs/nested.md",
    "../../docs/escaped.md",
    "../../docs/code-label.md",
    "../../docs/multiline.md",
    "../../docs/list-active.md",
    "../../docs/nested-active.md",
    "../../docs/dedented.md",
  ]);
  for (const malformed of [
    "[x](<unterminated)",
    "[x](a_(b.md)",
    "`unterminated",
    "[](target.md)",
    "[\n ](target.md)",
    "[unbalanced\nlabel(target.md)",
  ]) {
    assert.throws(
      () => parseMarkdownTargets(malformed),
      (error) => error.code === "markdown-link-unsupported",
    );
  }
});

test("resolves extensionless Markdown targets uniquely and classifies schemes", async () => {
  for (const scenario of [
    { target: "../../docs/exact", file: "docs/exact" },
    { target: "../../docs/candidate", file: "docs/candidate.md" },
    { target: "../../docs/guide-dir", file: "docs/guide-dir/README.md" },
  ]) {
    await withArtifact({}, async ({ pluginRoot }) => {
      await writeArtifactFile(pluginRoot, CANONICAL_SKILL, `[target](${scenario.target})\n`);
      await writeArtifactFile(pluginRoot, scenario.file, "fixture\n");
      const result = await verifyAntigravityPluginArtifact(pluginRoot);
      assert.ok(result.markdownClosure.files.includes(scenario.file));
    });
  }

  await withArtifact({}, async ({ pluginRoot }) => {
    await writeArtifactFile(pluginRoot, CANONICAL_SKILL, "[target](../../docs/ambiguous)\n");
    await writeArtifactFile(pluginRoot, "docs/ambiguous", "fixture\n");
    await writeArtifactFile(pluginRoot, "docs/ambiguous.md", "fixture\n");
    await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "markdown-target-ambiguous");
  });
  await withArtifact({}, async ({ pluginRoot }) => {
    await writeArtifactFile(pluginRoot, CANONICAL_SKILL, "[target](../../docs/extensionless-missing)\n");
    await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "required-file-missing");
  });
  await withArtifact({}, async ({ pluginRoot }) => {
    await writeArtifactFile(pluginRoot, CANONICAL_SKILL, [
      "[pathname](pathname:///demo/adapter-matrix)",
      "[http](http://example.com)",
      "[https](https://example.com)",
      "[mail](mailto:test@example.com)",
      "",
    ].join("\n"));
    const result = await verifyAntigravityPluginArtifact(pluginRoot);
    assert.equal(result.markdownClosure.edges, 0);
  });
  for (const target of ["file:///private.md", "custom://route"]) {
    await withArtifact({}, async ({ pluginRoot }) => {
      await writeArtifactFile(pluginRoot, CANONICAL_SKILL, `[target](${target})\n`);
      await expectCode(
        verifyAntigravityPluginArtifact(pluginRoot),
        target.startsWith("file:") ? "markdown-file-uri" : "markdown-scheme-invalid",
      );
    });
  }
});

test("freezes the pinned canonical Markdown closure and source link classification", async () => {
  const closure = await verifyMarkdownSourceClosure(repositoryRoot);
  assert.deepEqual(
    { nodes: closure.nodes, edges: closure.edges, files: closure.files.length },
    { nodes: 93, edges: 290, files: 96 },
  );
  for (const required of [
    "AGENTS.md",
    "DESIGN.md",
    "docs/adrs/checkpoint-backed-compare-sources.md",
    "docs/adrs/harness-checkpoint-experiment-compare.md",
    "docs/docs/hosts/adapter-matrix.md",
    "docs/docs/hosts/contributing-new-coding-agent.md",
    "references/agent-customize/platforms/qoder.md",
    "references/agent-customize/agents-md-review.md",
    "references/agent-customize/custom-agents-review.md",
    "references/project-harness/observability.md",
  ]) assert.ok(closure.files.includes(required), `missing frozen closure file: ${required}`);
  assert.equal(closure.files.includes("references/agent-customize/platforms/codex.md"), false);
  assert.equal(closure.files.some((file) => file.startsWith(".agents/") || file.startsWith(".github/")), false);

  const sourceAssertions = [
    ["references/project-harness/observability.md", "(../agent-customize/agents-md-review.md)"],
    ["references/agent-customize/platforms/qoder.md", "(../custom-agents-review.md)"],
    ["references/agent-customize/platforms/codex.md", "(../custom-agents-review.md)"],
    ["docs/adapters/contributing-new-coding-agent.md", "https://github.com/QoderAI/better-harness/blob/main/.agents/skills/change-traceability-review/SKILL.md"],
    ["docs/adapters/contributing-new-coding-agent.md", "https://github.com/QoderAI/better-harness/blob/main/.github/pull_request_template.md"],
  ];
  for (const [relative, expected] of sourceAssertions) {
    assert.ok((await readFile(path.join(repositoryRoot, relative), "utf8")).includes(expected));
  }
});

test("uses the first duplicate Markdown reference definition", async () => {
  await withArtifact({}, async ({ pluginRoot }) => {
    await writeArtifactFile(pluginRoot, CANONICAL_SKILL, [
      "[reference][duplicate]",
      "[duplicate]: ../../../outside.md",
      "[duplicate]: ../../docs/guide.md",
      "",
    ].join("\n"));
    await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "markdown-path-escape");
  });
});

test("rejects invalid manifest identities and shapes", async () => {
  const cases = [
    { options: { rootName: "wrong-root", manifest: {} }, code: "plugin-root-name-invalid" },
    { options: { manifest: {} }, code: "manifest-name-required" },
    { options: { manifest: { description: "missing name" } }, code: "manifest-name-required" },
    { options: { manifest: { name: "" } }, code: "manifest-name-blank" },
    { options: { manifest: { name: 7 } }, code: "manifest-name-type-invalid" },
    { options: { manifest: { name: "better harness" } }, code: "manifest-name-pattern-invalid" },
    { options: { manifest: { name: "better/harness" } }, code: "manifest-name-pattern-invalid" },
    { options: { manifest: { name: "better.harness" } }, code: "manifest-name-pattern-invalid" },
    { options: { manifest: { name: "better:harness" } }, code: "manifest-name-pattern-invalid" },
    { options: { manifest: { name: "better\\harness" } }, code: "manifest-name-pattern-invalid" },
    { options: { manifest: { name: "better[harness]" } }, code: "manifest-name-pattern-invalid" },
    { options: { manifest: { name: "other" } }, code: "plugin-identity-mismatch" },
    { options: { manifest: { name: "better-harness", description: null } }, code: "manifest-description-invalid" },
    { options: { manifest: { name: "better-harness", description: 7 } }, code: "manifest-description-invalid" },
    { options: { manifest: { name: "better-harness", unexpected: true } }, code: "manifest-schema-invalid" },
    {
      options: { manifest: { name: "better-harness", $schema: "https://example.invalid/schema.json" } },
      code: "manifest-schema-invalid",
    },
    { options: { manifestText: "null\n" }, code: "manifest-invalid" },
    { options: { manifestText: "[]\n" }, code: "manifest-invalid" },
    { options: { manifestText: "{\n" }, code: "manifest-invalid" },
  ];
  for (const scenario of cases) {
    await withArtifact(scenario.options, async ({ pluginRoot }) => {
      await expectCode(verifyAntigravityPluginArtifact(pluginRoot), scenario.code);
    });
  }
});

test("rejects missing, escaped, forbidden, and oversized Markdown closure targets", async () => {
  const cases = [
    { content: "[Missing](../../references/missing.md)\n", code: "required-file-missing" },
    { content: "[Escape](../../../outside.md)\n", code: "markdown-path-escape" },
    { content: "[Absolute](C:/private/file.md)\n", code: "markdown-absolute-path" },
    { content: "[File](file:///private/file.md)\n", code: "markdown-file-uri" },
    { content: "[Encoded](../../%2e%2e/outside.md)\n", code: "markdown-path-escape" },
    { content: "[Forbidden](../../scripts/packaging/private.md)\n", code: "markdown-target-forbidden" },
  ];
  for (const scenario of cases) {
    await withArtifact({}, async ({ pluginRoot }) => {
      await writeArtifactFile(pluginRoot, CANONICAL_SKILL, scenario.content);
      await expectCode(verifyAntigravityPluginArtifact(pluginRoot), scenario.code);
    });
  }

  await withArtifact({}, async ({ pluginRoot }) => {
    const links = [];
    for (let index = 0; index <= GRAPH_LIMITS.markdownNodes; index += 1) {
      const relative = `docs/limit-${index}.md`;
      links.push(`[${index}](../../${relative})`);
      await writeArtifactFile(pluginRoot, relative, `# ${index}\n`);
    }
    await writeArtifactFile(pluginRoot, CANONICAL_SKILL, `${links.join("\n")}\n`);
    await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "markdown-node-limit");
  });
});

test("rejects unsafe runtime closure imports", async () => {
  const cases = [
    { source: 'import "./missing.mjs";\n', code: "runtime-target-missing" },
    { source: 'import "./packaging/private.mjs";\n', code: "runtime-target-forbidden" },
    { source: 'import "unexpected-package";\n', code: "runtime-dependency-forbidden" },
    { source: "const target = './runtime/main.mjs'; import(target);\n", code: "runtime-dynamic-import-unresolved" },
  ];
  for (const scenario of cases) {
    await withArtifact({}, async ({ pluginRoot }) => {
      await writeArtifactFile(pluginRoot, "scripts/better-harness.mjs", scenario.source);
      await expectCode(verifyAntigravityPluginArtifact(pluginRoot), scenario.code);
    });
  }
});

test("enforces every closed ownership marker field", async () => {
  const withoutCanonicalSkill = baseMarker();
  delete withoutCanonicalSkill.canonicalSkill;
  const cases = [
    { marker: withoutCanonicalSkill, code: "marker-schema-invalid" },
    { marker: { ...baseMarker(), extra: true }, code: "marker-schema-invalid" },
    { marker: baseMarker({ kind: "other" }), code: "marker-kind-invalid" },
    { marker: baseMarker({ schemaVersion: 2 }), code: "marker-schema-version-invalid" },
    { marker: baseMarker({ host: "other" }), code: "marker-host-invalid" },
    { marker: baseMarker({ pluginName: "other" }), code: "plugin-identity-mismatch" },
    { marker: baseMarker({ pluginName: 7 }), code: "marker-plugin-name-invalid" },
    { marker: baseMarker({ version: "" }), code: "marker-version-invalid" },
    { marker: baseMarker({ version: "9.9.9" }), code: "package-version-invalid" },
    { marker: baseMarker({ canonicalSkill: "skills/other/SKILL.md" }), code: "marker-skill-invalid" },
    { marker: baseMarker({ runtimeDependencies: [...RUNTIME_DEPENDENCIES].reverse() }), code: "marker-dependencies-invalid" },
    { marker: baseMarker({ runtimeDependencies: "invalid" }), code: "marker-dependencies-invalid" },
  ];
  for (const scenario of cases) {
    await withArtifact({ marker: scenario.marker }, async ({ pluginRoot }) => {
      await expectCode(verifyAntigravityPluginArtifact(pluginRoot), scenario.code);
    });
  }
});

test("enforces the closed Better Harness artifact package schema", async () => {
  const withoutName = basePackage();
  delete withoutName.name;
  const withoutBin = basePackage();
  delete withoutBin.bin;
  const cases = [
    { packageJson: { ...basePackage(), extra: true }, code: "package-schema-invalid" },
    { packageJson: withoutName, code: "package-schema-invalid" },
    { packageJson: withoutBin, code: "package-schema-invalid" },
    { packageJson: basePackage({ name: "other" }), code: "package-name-invalid" },
    { packageJson: basePackage({ private: false }), code: "package-private-invalid" },
    { packageJson: basePackage({ version: "" }), code: "package-version-invalid" },
    { packageJson: basePackage({ version: "9.9.9" }), code: "package-version-invalid" },
    { packageJson: basePackage({ license: " " }), code: "package-license-invalid" },
    { packageJson: basePackage({ type: "commonjs" }), code: "package-type-invalid" },
    { packageJson: basePackage({ bin: null }), code: "package-bin-invalid" },
    { packageJson: basePackage({ bin: [] }), code: "package-bin-invalid" },
    { packageJson: basePackage({ bin: {} }), code: "package-bin-invalid" },
    { packageJson: basePackage({ bin: { "better-harness": "wrong.mjs" } }), code: "package-bin-invalid" },
    {
      packageJson: basePackage({
        bin: { "better-harness": "scripts/better-harness.mjs", extra: "wrong.mjs" },
      }),
      code: "package-bin-invalid",
    },
    { packageJson: basePackage({ engines: null }), code: "package-engines-invalid" },
    { packageJson: basePackage({ engines: [] }), code: "package-engines-invalid" },
    { packageJson: basePackage({ engines: { node: ">=22" } }), code: "package-engines-invalid" },
    { packageJson: basePackage({ engines: { node: ">=22", npm: "" } }), code: "package-engines-invalid" },
    { packageJson: basePackage({ engines: { node: 22, npm: ">=10" } }), code: "package-engines-invalid" },
    {
      packageJson: basePackage({ engines: { node: ">=22", npm: ">=10", extra: "1" } }),
      code: "package-engines-invalid",
    },
    { packageJson: basePackage({ dependencies: null }), code: "package-dependencies-invalid" },
    {
      packageJson: basePackage({
        dependencies: { ...basePackage().dependencies, unexpected: "1.0.0" },
      }),
      code: "package-dependencies-invalid",
    },
    {
      packageJson: basePackage({ dependencies: { "esbuild-wasm": "1.0.0" } }),
      code: "package-dependencies-invalid",
    },
    {
      packageJson: basePackage({
        dependencies: {
          "@vscode/tree-sitter-wasm": "",
          "esbuild-wasm": "1.0.0",
        },
      }),
      code: "package-dependency-version-invalid",
    },
    {
      packageJson: basePackage({
        dependencies: {
          "@vscode/tree-sitter-wasm": 1,
          "esbuild-wasm": "1.0.0",
        },
      }),
      code: "package-dependency-version-invalid",
    },
  ];
  for (const scenario of cases) {
    await withArtifact({ packageJson: scenario.packageJson }, async ({ pluginRoot }) => {
      await expectCode(verifyAntigravityPluginArtifact(pluginRoot), scenario.code);
    });
  }

  for (const packageText of ["null\n", "[]\n", "{\n"]) {
    await withArtifact({}, async ({ pluginRoot }) => {
      await writeArtifactFile(pluginRoot, "package.json", packageText);
      await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "package-invalid");
    });
  }
});

test("projects a fresh exact artifact package and rejects malformed source runtime metadata", () => {
  const source = baseSourcePackage({ description: "allowed source-only metadata" });
  const projected = artifactPackage(source);
  assert.deepEqual(Object.keys(projected).sort(), [
    "bin",
    "dependencies",
    "engines",
    "license",
    "name",
    "private",
    "type",
    "version",
  ]);
  assert.deepEqual(projected, basePackage());

  source.bin["better-harness"] = "mutated.mjs";
  source.engines.node = "mutated";
  source.dependencies["esbuild-wasm"] = "mutated";
  assert.equal(projected.bin["better-harness"], "scripts/better-harness.mjs");
  assert.equal(projected.engines.node, ">=22");
  assert.equal(projected.dependencies["esbuild-wasm"], "1.0.0");

  const cases = [
    { value: baseSourcePackage({ name: "wrong" }), code: "source-package-invalid" },
    { value: baseSourcePackage({ type: "commonjs" }), code: "source-package-invalid" },
    { value: baseSourcePackage({ bin: null }), code: "source-bin-invalid" },
    { value: baseSourcePackage({ bin: [] }), code: "source-bin-invalid" },
    { value: baseSourcePackage({ bin: {} }), code: "source-bin-invalid" },
    { value: baseSourcePackage({ bin: { "better-harness": "wrong.mjs" } }), code: "source-bin-invalid" },
    {
      value: baseSourcePackage({
        bin: { "better-harness": "scripts/better-harness.mjs", extra: "wrong.mjs" },
      }),
      code: "source-bin-invalid",
    },
    { value: baseSourcePackage({ engines: null }), code: "source-engines-invalid" },
    { value: baseSourcePackage({ engines: [] }), code: "source-engines-invalid" },
    { value: baseSourcePackage({ engines: { node: ">=22" } }), code: "source-engines-invalid" },
    { value: baseSourcePackage({ engines: { node: ">=22", npm: " " } }), code: "source-engines-invalid" },
    { value: baseSourcePackage({ engines: { node: 22, npm: ">=10" } }), code: "source-engines-invalid" },
    {
      value: baseSourcePackage({ engines: { node: ">=22", npm: ">=10", extra: "1" } }),
      code: "source-engines-invalid",
    },
  ];
  for (const scenario of cases) {
    assert.throws(() => artifactPackage(scenario.value), (error) => error.code === scenario.code);
  }
});

test("binds dependency package identity, version, and imported subpaths", async () => {
  const metadataCases = [
    { relative: "node_modules/esbuild-wasm/package.json", text: "{\n", code: "dependency-package-invalid" },
    { relative: "node_modules/esbuild-wasm/package.json", text: "null\n", code: "dependency-package-invalid" },
    { relative: "node_modules/esbuild-wasm/package.json", text: '{"name":"wrong","version":"1.0.0"}\n', code: "dependency-package-name-invalid" },
    { relative: "node_modules/esbuild-wasm/package.json", text: '{"name":"esbuild-wasm"}\n', code: "dependency-package-version-invalid" },
    { relative: "node_modules/esbuild-wasm/package.json", text: '{"name":"esbuild-wasm","version":"2.0.0"}\n', code: "dependency-package-version-invalid" },
    { relative: "node_modules/@vscode/tree-sitter-wasm/package.json", text: '{"name":"wrong","version":"1.0.0"}\n', code: "dependency-package-name-invalid" },
  ];
  for (const scenario of metadataCases) {
    await withArtifact({}, async ({ pluginRoot }) => {
      await writeArtifactFile(pluginRoot, scenario.relative, scenario.text);
      await expectCode(verifyAntigravityPluginArtifact(pluginRoot), scenario.code);
    });
  }

  await withArtifact({}, async ({ pluginRoot }) => {
    await writeArtifactFile(pluginRoot, "scripts/better-harness.mjs", 'import "esbuild-wasm/worker";\n');
    const result = await verifyAntigravityPluginArtifact(pluginRoot);
    assert.deepEqual(result.runtimeClosure.externalDependencies, ["esbuild-wasm"]);
  });
  await withArtifact({}, async ({ pluginRoot }) => {
    await writeArtifactFile(pluginRoot, "scripts/better-harness.mjs", 'import "esbuild-wasm/missing";\n');
    await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "runtime-dependency-subpath-missing");
  });
  await withArtifact({}, async ({ pluginRoot }) => {
    await writeArtifactFile(pluginRoot, "node_modules/esbuild-wasm/worker.js", "export default true;\n");
    await writeArtifactFile(pluginRoot, "scripts/better-harness.mjs", 'import "esbuild-wasm/worker";\n');
    await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "runtime-dependency-subpath-ambiguous");
  });
});

test("enforces host-neutral portable components and traversal bounds", () => {
  for (const component of [
    "CON",
    "con.txt",
    "PrN.json",
    "COM1",
    "lpt9.log",
    "trailing.",
    "trailing ",
    "stream:name",
    "back\\slash",
    `control${String.fromCharCode(1)}`,
    "x".repeat(FILE_LIMITS.componentLength + 1),
  ]) {
    assert.throws(
      () => validatePortablePathComponent(component),
      (error) => error.code === "path-component-invalid",
    );
  }
  assert.equal(validatePortablePathComponent("portable-name.md"), "portable-name.md");
  assert.throws(
    () => validateTraversalBounds(FILE_LIMITS.entries + 1, 0),
    (error) => error.code === "artifact-entry-limit",
  );
  assert.throws(
    () => validateTraversalBounds(0, FILE_LIMITS.directoryDepth + 1),
    (error) => error.code === "artifact-depth-limit",
  );
});

test("rejects unknown, host, development, Skill, and packaging tree entries", async () => {
  for (const relativePath of [
    "unknown.txt",
    ".codex-plugin/plugin.json",
    "skills/other/SKILL.md",
    "scripts/packaging/private.mjs",
    "test/fixture.txt",
    "docs/cache/output.txt",
    "docs/private.log",
  ]) {
    await withArtifact({}, async ({ pluginRoot }) => {
      await writeArtifactFile(pluginRoot, relativePath);
      await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "path-not-allowed");
    });
  }
});

test("requires the complete artifact and dependency license profile", async () => {
  for (const relativePath of [
    "LICENSE",
    CANONICAL_SKILL,
    "scripts/better-harness.mjs",
    "node_modules/@vscode/tree-sitter-wasm/package.json",
    "node_modules/@vscode/tree-sitter-wasm/LICENSE",
    "node_modules/esbuild-wasm/LICENSE.md",
  ]) {
    await withArtifact({}, async ({ pluginRoot }) => {
      await rm(path.join(pluginRoot, ...relativePath.split("/")));
      await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "required-file-missing");
    });
  }

  await withArtifact({}, async ({ pluginRoot }) => {
    const license = path.join(pluginRoot, "LICENSE");
    await rm(license);
    await mkdir(license);
    await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "required-file-missing");
  });
});

test("rejects a missing transitive Markdown target", async () => {
  await withArtifact({}, async ({ pluginRoot }) => {
    await writeArtifactFile(pluginRoot, "references/direct.md", "[Missing](../docs/missing.md)\n");
    await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "required-file-missing");
  });
});

test("rejects case-insensitive or NFC path identity collisions where constructable", async (context) => {
  let exercised = false;
  for (const pair of [
    ["docs/Case.md", "docs/case.md"],
    ["docs/caf\u00e9.md", "docs/cafe\u0301.md"],
  ]) {
    await withArtifact({}, async ({ pluginRoot }) => {
      await writeArtifactFile(pluginRoot, pair[0]);
      await writeArtifactFile(pluginRoot, pair[1]);
      const names = await readdir(path.join(pluginRoot, "docs"));
      if (!pair.every((relative) => names.includes(path.basename(relative)))) return;
      exercised = true;
      await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "path-identity-collision");
    });
  }
  if (!exercised) context.skip("filesystem does not preserve a constructable case or NFC collision");
});

test("rejects special files where a FIFO can be created", async (context) => {
  if (process.platform === "win32") {
    context.skip("portable FIFO creation is unavailable on Windows");
    return;
  }
  await withArtifact({}, async ({ pluginRoot }) => {
    const fifo = path.join(pluginRoot, "docs", "fixture.fifo");
    const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    if (created.status !== 0) {
      context.skip("mkfifo is unavailable in this environment");
      return;
    }
    await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "special-file-forbidden");
  });
});

test("CLI help and JSON envelopes are parser-safe and imports have no side effects", async () => {
  const imported = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(pathToFileURL(verifierPath).href)})`],
    { encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");

  const help = spawnSync(process.execPath, [verifierPath, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--plugin-root <path>/u);

  for (const args of [["--json"], ["--json", "--unknown"], ["--json", "--plugin-root"]]) {
    const failure = spawnSync(process.execPath, [verifierPath, ...args], { encoding: "utf8" });
    assert.equal(failure.status, 1);
    assert.equal(failure.stderr, "");
    const envelope = JSON.parse(failure.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(typeof envelope.error.code, "string");
  }

  const duplicate = spawnSync(
    process.execPath,
    [verifierPath, "--json", "--plugin-root", "one", "--plugin-root", "two"],
    { encoding: "utf8" },
  );
  assert.equal(duplicate.status, 1);
  assert.equal(JSON.parse(duplicate.stdout).error.code, "argument-duplicate");

  await withArtifact({}, async ({ pluginRoot }) => {
    const success = spawnSync(
      process.execPath,
      [verifierPath, "--plugin-root", pluginRoot, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(success.status, 0, success.stderr);
    const envelope = JSON.parse(success.stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.pluginName, "better-harness");
    assert.equal(success.stdout.includes(pluginRoot), false);

    const missingRoot = path.join(pluginRoot, "private", "missing");
    const failure = spawnSync(
      process.execPath,
      [verifierPath, `--plugin-root=${missingRoot}`, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout.includes(missingRoot), false);
    assert.equal(JSON.parse(failure.stdout).error.code, "plugin-root-missing");
  });
});

test("rejects symbolic links when the platform permits creating one", async (context) => {
  await withArtifact({}, async ({ pluginRoot }) => {
    const target = path.join(pluginRoot, "docs", "guide.md");
    const link = path.join(pluginRoot, "docs", "linked.md");
    try {
      await symlink(target, link, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        context.skip(`symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.equal((await lstat(link)).isSymbolicLink(), true);
    await expectCode(verifyAntigravityPluginArtifact(pluginRoot), "symlink-forbidden");
  });
});

test("builds, verifies, runs, and atomically replaces the real pinned artifact", async () => {
  const container = await mkdtemp(path.join(os.tmpdir(), "better-harness-antigravity-build-"));
  const outputRoot = path.join(container, "better-harness");
  try {
    const first = await buildAntigravityPluginArtifact({ repoRoot: repositoryRoot, outputRoot });
    assert.equal(first.replaced, false);
    assert.deepEqual(first.publication, {
      state: "published",
      backupCleanup: "complete",
      replaced: false,
    });
    assert.deepEqual(first.warnings, []);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(outputRoot, "plugin.json"), "utf8")),
      JSON.parse(await readFile(path.join(repositoryRoot, "scripts/packaging/antigravity/plugin-manifest.json"), "utf8")),
    );
    for (const relative of [CANONICAL_SKILL, "DESIGN.md", "references/project-harness/observability.md"]) {
      assert.deepEqual(
        await readFile(path.join(outputRoot, ...relative.split("/"))),
        await readFile(path.join(repositoryRoot, ...relative.split("/"))),
      );
    }
    assert.deepEqual(await readdir(path.join(outputRoot, "skills")), ["better-harness"]);
    assert.deepEqual(
      Object.keys(JSON.parse(await readFile(path.join(outputRoot, "package.json"), "utf8"))).sort(),
      ["bin", "dependencies", "engines", "license", "name", "private", "type", "version"],
    );
    for (const relative of [".agents", ".github", "test", "scripts/packaging"]) {
      assert.equal(await lstat(path.join(outputRoot, ...relative.split("/"))).catch(() => null), null);
    }
    const verified = await verifyAntigravityPluginArtifact(outputRoot);
    assert.deepEqual(
      { nodes: verified.markdownClosure.nodes, edges: verified.markdownClosure.edges, files: verified.markdownClosure.files.length },
      { nodes: 93, edges: 290, files: 96 },
    );
    assert.equal(verified.runtimeClosure.modules, 19);
    const help = spawnSync(process.execPath, ["scripts/better-harness.mjs", "--help"], {
      cwd: outputRoot,
      encoding: "utf8",
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Better Harness CLI/u);

    await writeArtifactFile(outputRoot, "docs/old-sentinel.md", "old\n");
    const second = await buildAntigravityPluginArtifact({ repoRoot: repositoryRoot, outputRoot });
    assert.equal(second.replaced, true);
    assert.deepEqual(second.publication, {
      state: "published",
      backupCleanup: "complete",
      replaced: true,
    });
    assert.equal(await lstat(path.join(outputRoot, "docs/old-sentinel.md")).catch(() => null), null);
    await verifyAntigravityPluginArtifact(outputRoot);
    assert.equal(
      (await readdir(container)).some((name) => name.includes("stage-") || name.includes("backup-")),
      false,
    );
  } finally {
    await rm(container, { recursive: true, force: true });
  }
}, 30_000);

test("preserves unowned and full-invalid destinations before copying", async () => {
  const repoRoot = await createSourceRepo();
  const container = await mkdtemp(path.join(os.tmpdir(), "better-harness-antigravity-owned-"));
  try {
    for (const kind of ["unowned", "marker-only"]) {
      const parent = path.join(container, kind);
      const outputRoot = path.join(parent, "better-harness");
      await writeArtifactFile(outputRoot, "sentinel.txt", `${kind}\n`);
      if (kind === "marker-only") {
        await writeArtifactFile(
          outputRoot,
          ANTIGRAVITY_ARTIFACT_MARKER,
          `${JSON.stringify(baseMarker())}\n`,
        );
      }
      await expectCode(
        buildAntigravityPluginArtifact({ repoRoot, outputRoot }),
        "destination-unowned",
      );
      assert.equal(await readFile(path.join(outputRoot, "sentinel.txt"), "utf8"), `${kind}\n`);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(container, { recursive: true, force: true });
  }
});

test("fails closed on source metadata, dependency, and staged closure errors", async () => {
  const cases = [
    { manifestText: '{"name":"better-harness","extra":true}\n', code: "source-manifest-invalid" },
    { manifestText: "{\n", code: "source-manifest-invalid" },
    {
      packageJson: baseSourcePackage({
        dependencies: {
          "@vscode/tree-sitter-wasm": "1.0.0",
          "esbuild-wasm": "1.0.0",
          unexpected: "1.0.0",
        },
      }),
      code: "source-dependencies-invalid",
    },
  ];
  for (const scenario of cases) {
    const repoRoot = await createSourceRepo(scenario);
    const parent = await mkdtemp(path.join(os.tmpdir(), "better-harness-antigravity-invalid-"));
    try {
      await expectCode(
        buildAntigravityPluginArtifact({ repoRoot, outputRoot: path.join(parent, "better-harness") }),
        scenario.code,
      );
      assert.deepEqual(await readdir(parent), []);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    }
  }

  const repoRoot = await createSourceRepo();
  const parent = await mkdtemp(path.join(os.tmpdir(), "better-harness-antigravity-stage-invalid-"));
  try {
    await rm(path.join(repoRoot, "node_modules/esbuild-wasm/LICENSE.md"));
    await expectCode(
      buildAntigravityPluginArtifact({ repoRoot, outputRoot: path.join(parent, "better-harness") }),
      "dependency-license-invalid",
    );
    assert.deepEqual(await readdir(parent), []);
    await writeArtifactFile(repoRoot, "node_modules/esbuild-wasm/LICENSE.md");
    await writeArtifactFile(repoRoot, CANONICAL_SKILL, "[missing](../../references/missing.md)\n");
    await expectCode(
      buildAntigravityPluginArtifact({ repoRoot, outputRoot: path.join(parent, "better-harness") }),
      "required-file-missing",
    );
    assert.deepEqual(await readdir(parent), []);
    await writeArtifactFile(repoRoot, CANONICAL_SKILL, "# Better Harness\n");
    await rm(path.join(repoRoot, "README.md"));
    await expectCode(
      buildAntigravityPluginArtifact({ repoRoot, outputRoot: path.join(parent, "better-harness") }),
      "source-entry-unreadable",
    );
    assert.deepEqual(await readdir(parent), []);
    await writeArtifactFile(repoRoot, "README.md");
    await rm(path.join(repoRoot, "node_modules/esbuild-wasm/package.json"));
    await expectCode(
      buildAntigravityPluginArtifact({ repoRoot, outputRoot: path.join(parent, "better-harness") }),
      "dependency-package-invalid",
    );
    assert.deepEqual(await readdir(parent), []);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  }
});

test("rejects source and output-parent symlinks when the platform permits them", async (context) => {
  const repoRoot = await createSourceRepo();
  const parent = await mkdtemp(path.join(os.tmpdir(), "better-harness-antigravity-symlink-"));
  try {
    const sourceTarget = path.join(repoRoot, "docs-target.md");
    const sourceLink = path.join(repoRoot, "docs", "linked.md");
    await writeArtifactFile(repoRoot, "docs-target.md");
    await mkdir(path.dirname(sourceLink), { recursive: true });
    try {
      await symlink(sourceTarget, sourceLink, "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        context.skip(`source/output symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await expectCode(
      buildAntigravityPluginArtifact({ repoRoot, outputRoot: path.join(parent, "better-harness") }),
      "source-symlink-forbidden",
    );

    await rm(sourceLink);
    const linkedParent = path.join(parent, "linked-parent");
    await symlink(repoRoot, linkedParent, "junction");
    await expectCode(
      buildAntigravityPluginArtifact({ repoRoot, outputRoot: path.join(linkedParent, "better-harness") }),
      "output-overlap",
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  }
});

test("plans output boundaries without writes and rechecks canonical authority after parent creation", async () => {
  const repoRoot = await createSourceRepo();
  const external = await mkdtemp(path.join(os.tmpdir(), "better-harness-antigravity-boundary-"));
  try {
    const rejectedParent = path.join(repoRoot, "missing", "deep");
    await expectCode(
      assertOutputBoundary(repoRoot, path.join(rejectedParent, "better-harness")),
      "output-overlap",
    );
    assert.equal(await lstat(path.join(repoRoot, "missing")).catch(() => null), null);

    const approvedParent = path.join(external, "approved", "deep");
    const approvedOutput = path.join(approvedParent, "better-harness");
    const preflight = await assertOutputBoundary(repoRoot, approvedOutput);
    assert.equal(await lstat(path.join(external, "approved")).catch(() => null), null);
    await mkdir(preflight.resolvedParent, { recursive: true });
    const postCreate = await assertOutputBoundary(repoRoot, approvedOutput);
    assert.equal(postCreate.canonicalParent, await realpath(approvedParent));
    assert.equal(postCreate.canonicalOutput, path.join(await realpath(approvedParent), "better-harness"));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("rejects a parent junction retargeted into the repository between boundary checks", async (context) => {
  const repoRoot = await createSourceRepo();
  const external = await mkdtemp(path.join(os.tmpdir(), "better-harness-antigravity-retarget-"));
  const approvedTarget = path.join(external, "approved-target");
  const linkedParent = path.join(external, "linked-parent");
  await mkdir(approvedTarget);
  try {
    try {
      await symlink(approvedTarget, linkedParent, "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        context.skip(`junction retarget unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const outputRoot = path.join(linkedParent, "deep", "better-harness");
    const preflight = await assertOutputBoundary(repoRoot, outputRoot);
    await mkdir(preflight.canonicalParent, { recursive: true });
    await rm(linkedParent);
    await symlink(repoRoot, linkedParent, "junction");
    assert.ok(await lstat(path.join(approvedTarget, "deep")));
    assert.equal(await lstat(path.join(repoRoot, "deep")).catch(() => null), null);
    await expectCode(assertOutputBoundary(repoRoot, outputRoot), "output-overlap");
    assert.equal(await lstat(path.join(repoRoot, "deep")).catch(() => null), null);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("pins boundary mkdir to the safe canonical parent across a pre-mkdir junction retarget", async (context) => {
  const repoRoot = await createSourceRepo();
  const external = await mkdtemp(path.join(os.tmpdir(), "better-harness-antigravity-mkdir-race-"));
  const approvedTarget = path.join(external, "approved-target");
  const linkedParent = path.join(external, "linked-parent");
  await mkdir(approvedTarget);
  try {
    try {
      await symlink(approvedTarget, linkedParent, "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        context.skip(`junction retarget unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const outputRoot = path.join(linkedParent, "deep", "better-harness");
    const expectedCanonicalParent = path.join(await realpath(approvedTarget), "deep");
    let mkdirCalls = 0;
    let publicationCalls = 0;
    await expectCode(
      buildAntigravityPluginArtifact({
        repoRoot,
        outputRoot,
        boundaryOperations: {
          mkdir: async (target, options) => {
            mkdirCalls += 1;
            assert.equal(target, expectedCanonicalParent);
            assert.notEqual(target, path.dirname(outputRoot));
            await rm(linkedParent);
            await symlink(repoRoot, linkedParent, "junction");
            await mkdir(target, options);
          },
        },
        operations: {
          rename: async () => { publicationCalls += 1; },
          remove: async () => { publicationCalls += 1; },
        },
      }),
      "output-overlap",
    );
    assert.equal(mkdirCalls, 1);
    assert.equal(publicationCalls, 0);
    assert.ok(await lstat(expectedCanonicalParent));
    assert.equal(await lstat(path.join(repoRoot, "deep")).catch(() => null), null);
    assert.equal(await lstat(path.join(repoRoot, "deep", "better-harness")).catch(() => null), null);
    assert.equal(
      (await readdir(approvedTarget)).some((name) => name.includes("stage-") || name.includes("backup-")),
      false,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("publishes only after full backup verification and restores verified backup on publish failure", async () => {
  for (const rollbackFails of [false, true]) {
    const { container, outputRoot, stageRoot } = await createPublishFixture();
    let renameCalls = 0;
    const operations = {
      rename: async (source, destination) => {
        renameCalls += 1;
        if (renameCalls === 2 || (rollbackFails && renameCalls === 3)) throw new Error("injected");
        await rename(source, destination);
      },
      remove: rm,
    };
    try {
      await expectCode(
        publishStagedArtifact({ stageRoot, outputRoot, replaceExisting: true, operations }),
        rollbackFails ? "publish-rollback-failed" : "publish-failed",
      );
      if (rollbackFails) {
        assert.equal(await lstat(outputRoot).catch(() => null), null);
        const backups = (await readdir(container)).filter((name) => name.includes("antigravity-backup-"));
        assert.equal(backups.length, 1);
        await verifyAntigravityPluginArtifact(path.join(container, backups[0], "better-harness"));
      } else {
        await verifyAntigravityPluginArtifact(outputRoot);
        assert.equal((await readdir(container)).some((name) => name.includes("backup-")), false);
      }
      assert.ok(await lstat(stageRoot));
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  }
});

test("reports a stable first-backup-rename failure and bounds empty-container cleanup", async () => {
  for (const cleanupFails of [false, true]) {
    const { container, outputRoot, stageRoot } = await createPublishFixture();
    let removeCalls = 0;
    try {
      await assert.rejects(
        publishStagedArtifact({
          stageRoot,
          outputRoot,
          replaceExisting: true,
          operations: {
            rename: async () => { throw new Error("injected first rename failure"); },
            remove: async (...args) => {
              removeCalls += 1;
              if (cleanupFails) throw new Error("injected cleanup failure");
              await rm(...args);
            },
          },
        }),
        (error) => {
          assert.equal(error.code, "publish-backup-rename-failed");
          assert.equal(error.publication.state, "not-published-destination-unchanged");
          assert.equal(error.publication.backupCleanup, cleanupFails ? "pending" : "complete");
          assert.equal(JSON.stringify(error).includes(container), false);
          return true;
        },
      );
      assert.equal(removeCalls, 1);
      await verifyAntigravityPluginArtifact(outputRoot);
      await verifyAntigravityPluginArtifact(stageRoot);
      const backups = (await readdir(container)).filter((name) => name.includes("antigravity-backup-"));
      assert.equal(backups.length, cleanupFails ? 1 : 0);
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  }
});

test("revalidates the actual moved destination and restores concurrent unowned or corrupt swaps", async () => {
  for (const swapKind of ["unowned", "corrupt"] ) {
    const { container, outputRoot, stageRoot } = await createPublishFixture();
    const originalRoot = path.join(container, "original-container", "better-harness");
    const swappedRoot = path.join(container, "concurrent-swap");
    try {
      await mkdir(path.dirname(originalRoot));
      await rename(outputRoot, originalRoot);
      if (swapKind === "unowned") {
        await writeArtifactFile(swappedRoot, "concurrent.txt", "preserve me\n");
      } else {
        await cp(originalRoot, swappedRoot, { recursive: true });
        await writeArtifactFile(swappedRoot, ANTIGRAVITY_ARTIFACT_MARKER, "{}\n");
        await writeArtifactFile(swappedRoot, "docs/concurrent.md", "preserve me\n");
      }
      await rename(swappedRoot, outputRoot);

      await assert.rejects(
        publishStagedArtifact({ stageRoot, outputRoot, replaceExisting: true }),
        (error) => {
          assert.equal(error.code, "destination-changed");
          assert.equal(error.publication.state, "not-published-destination-restored");
          return true;
        },
      );
      const sentinel = swapKind === "unowned" ? "concurrent.txt" : "docs/concurrent.md";
      assert.equal(await readFile(path.join(outputRoot, ...sentinel.split("/")), "utf8"), "preserve me\n");
      await verifyAntigravityPluginArtifact(originalRoot);
      await verifyAntigravityPluginArtifact(stageRoot);
      assert.equal((await readdir(container)).some((name) => name.includes("backup-")), false);
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  }
});

test("retains the moved concurrent tree when destination revalidation rollback conflicts", async () => {
  const { container, outputRoot, stageRoot } = await createPublishFixture();
  const originalRoot = path.join(container, "original-container", "better-harness");
  const swappedRoot = path.join(container, "concurrent-swap");
  await mkdir(path.dirname(originalRoot));
  await rename(outputRoot, originalRoot);
  await writeArtifactFile(swappedRoot, "concurrent.txt", "preserve me\n");
  await rename(swappedRoot, outputRoot);
  let renameCalls = 0;
  try {
    await assert.rejects(
      publishStagedArtifact({
        stageRoot,
        outputRoot,
        replaceExisting: true,
        operations: {
          rename: async (source, destination) => {
            renameCalls += 1;
            if (renameCalls === 2) {
              await writeArtifactFile(outputRoot, "conflict.txt", "also preserve me\n");
              throw new Error("injected rollback conflict");
            }
            await rename(source, destination);
          },
          remove: rm,
        },
      }),
      (error) => {
        assert.equal(error.code, "destination-revalidation-rollback-failed");
        assert.equal(error.publication.state, "not-published-backup-retained");
        assert.equal(JSON.stringify(error).includes(container), false);
        return true;
      },
    );
    assert.equal(await readFile(path.join(outputRoot, "conflict.txt"), "utf8"), "also preserve me\n");
    const backups = (await readdir(container)).filter((name) => name.includes("antigravity-backup-"));
    assert.equal(backups.length, 1);
    assert.equal(
      await readFile(path.join(container, backups[0], "better-harness", "concurrent.txt"), "utf8"),
      "preserve me\n",
    );
    await verifyAntigravityPluginArtifact(stageRoot);
    await verifyAntigravityPluginArtifact(originalRoot);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("restores a concurrent destination symlink without dereferencing it when supported", async (context) => {
  const { container, outputRoot, stageRoot } = await createPublishFixture();
  const originalRoot = path.join(container, "original-container", "better-harness");
  const targetRoot = path.join(container, "concurrent-target");
  try {
    await mkdir(path.dirname(originalRoot));
    await rename(outputRoot, originalRoot);
    await writeArtifactFile(targetRoot, "sentinel.txt", "preserve target\n");
    try {
      await symlink(targetRoot, outputRoot, "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        context.skip(`destination symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await expectCode(
      publishStagedArtifact({ stageRoot, outputRoot, replaceExisting: true }),
      "destination-changed",
    );
    assert.equal((await lstat(outputRoot)).isSymbolicLink(), true);
    assert.equal(await readFile(path.join(targetRoot, "sentinel.txt"), "utf8"), "preserve target\n");
    await verifyAntigravityPluginArtifact(stageRoot);
    await verifyAntigravityPluginArtifact(originalRoot);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});

test("returns published cleanup-pending state and renders safe JSON and human warnings", async () => {
  const repoRoot = await createSourceRepo();
  const container = await mkdtemp(path.join(os.tmpdir(), "better-harness-antigravity-cleanup-"));
  const outputRoot = path.join(container, "better-harness");
  try {
    await buildAntigravityPluginArtifact({ repoRoot, outputRoot });
    await writeArtifactFile(repoRoot, "README.md", "new artifact\n");
    let removeCalls = 0;
    let renameCalls = 0;
    const result = await buildAntigravityPluginArtifact({
      repoRoot,
      outputRoot,
      operations: {
        rename: async (source, destination) => {
          renameCalls += 1;
          await rename(source, destination);
        },
        remove: async () => {
          removeCalls += 1;
          throw new Error("injected backup cleanup failure");
        },
      },
    });
    assert.equal(renameCalls, 2);
    assert.equal(removeCalls, 1);
    assert.equal(result.publication.state, "published");
    assert.equal(result.publication.backupCleanup, "pending");
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, "backup-cleanup-pending");
    assert.equal(await readFile(path.join(outputRoot, "README.md"), "utf8"), "new artifact\n");
    await verifyAntigravityPluginArtifact(outputRoot);
    const backups = (await readdir(container)).filter((name) => name.includes("antigravity-backup-"));
    assert.equal(backups.length, 1);
    assert.equal(
      await readFile(path.join(container, backups[0], "better-harness", "README.md"), "utf8"),
      "fixture\n",
    );

    const human = formatBuildSuccess(result);
    assert.match(human, /backup-cleanup-pending/u);
    assert.match(human, /state=published backupCleanup=pending/u);
    assert.equal(human.includes(container), false);
    const jsonText = formatBuildSuccess(result, { json: true });
    const json = JSON.parse(jsonText);
    assert.equal(json.ok, true);
    assert.equal(json.data.publication.state, "published");
    assert.equal(json.warnings[0].code, "backup-cleanup-pending");
    assert.equal(jsonText.includes(container), false);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(container, { recursive: true, force: true });
  }
});

test("builder CLI and output boundaries fail closed without path disclosure", async () => {
  const imported = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(pathToFileURL(builderPath).href)})`],
    { encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");
  const help = spawnSync(process.execPath, [builderPath, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--out <path>/u);
  for (const args of [["--json"], ["--json", "--unknown"], ["--json", "--out"], ["--json", "--out", "one", "--out", "two"]]) {
    const result = spawnSync(process.execPath, [builderPath, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).ok, false);
  }

  const privatePath = path.join(os.tmpdir(), "private-builder-fixture", "wrong-name");
  const failure = spawnSync(
    process.execPath,
    [builderPath, "--json", "--out", privatePath],
    { encoding: "utf8" },
  );
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout.includes(privatePath), false);
  assert.equal(JSON.parse(failure.stdout).error.code, "output-invalid");
  await expectCode(
    buildAntigravityPluginArtifact({ repoRoot: repositoryRoot, outputRoot: path.join(repositoryRoot, "docs", "better-harness") }),
    "output-overlap",
  );
});
