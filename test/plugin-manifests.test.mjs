import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertExistingPath(relativePath) {
  assert.ok(statSync(path.join(ROOT, relativePath)).size > 0, `${relativePath} must exist`);
}

function resolvedSchema(schema, rootSchema) {
  if (!schema.$ref) return schema;
  assert.match(schema.$ref, /^#\/\$defs\//u);
  const name = schema.$ref.slice("#/$defs/".length);
  return rootSchema.$defs[name];
}

function schemaErrors(value, schema, rootSchema, location = "$") {
  const current = resolvedSchema(schema, rootSchema);
  if (current.oneOf) {
    return current.oneOf.some((candidate) => schemaErrors(value, candidate, rootSchema, location).length === 0)
      ? []
      : [`${location} does not match any allowed shape`];
  }
  if (current.type === "string") {
    if (typeof value !== "string") return [`${location} must be a string`];
    if (current.minLength && value.length < current.minLength) return [`${location} is too short`];
    if (current.pattern && !new RegExp(current.pattern, "u").test(value)) return [`${location} has an invalid format`];
    if (current.format === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(value)) {
      return [`${location} must be an email`];
    }
    if (current.format === "uri") {
      try {
        new URL(value);
      } catch {
        return [`${location} must be a URI`];
      }
    }
    return [];
  }
  if (current.type === "array") {
    if (!Array.isArray(value)) return [`${location} must be an array`];
    return current.items
      ? value.flatMap((item, index) => schemaErrors(item, current.items, rootSchema, `${location}[${index}]`))
      : [];
  }
  if (current.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [`${location} must be an object`];
    const errors = [];
    for (const required of current.required ?? []) {
      if (!(required in value)) errors.push(`${location}.${required} is required`);
    }
    if (current.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (current.properties ?? {}))) errors.push(`${location}.${key} is not allowed`);
      }
    }
    for (const [key, childSchema] of Object.entries(current.properties ?? {})) {
      if (key in value) errors.push(...schemaErrors(value[key], childSchema, rootSchema, `${location}.${key}`));
    }
    return errors;
  }
  return [];
}

function assertMatchesSchema(value, schema) {
  assert.deepEqual(schemaErrors(value, schema, schema), []);
}

test("Cursor manifests conform to the pinned official schemas", () => {
  const plugin = readJson(".cursor-plugin/plugin.json");
  const marketplace = readJson(".cursor-plugin/marketplace.json");
  const pluginSchema = readJson("test/fixtures/cursor-plugin-schemas/plugin.schema.json");
  const marketplaceSchema = readJson("test/fixtures/cursor-plugin-schemas/marketplace.schema.json");

  assertMatchesSchema(plugin, pluginSchema);
  assertMatchesSchema(marketplace, marketplaceSchema);
  assert.match(pluginSchema.$id, /cursor\.com\/schemas\/cursor-plugin\/plugin\.json/u);
  assert.match(marketplaceSchema.$id, /cursor\.com\/schemas\/cursor-plugin\/marketplace\.json/u);

  const invalidPlugin = structuredClone(plugin);
  invalidPlugin.descriptionZh = "unsupported";
  assert.match(schemaErrors(invalidPlugin, pluginSchema, pluginSchema).join("\n"), /descriptionZh is not allowed/u);
  const invalidMarketplace = structuredClone(marketplace);
  invalidMarketplace.plugins[0].version = plugin.version;
  assert.match(
    schemaErrors(invalidMarketplace, marketplaceSchema, marketplaceSchema).join("\n"),
    /plugins\[0\]\.version is not allowed/u,
  );
});

test("host plugin manifests expose canonical Better Harness resources", () => {
  const qoder = readJson(".qoder-plugin/plugin.json");
  const claude = readJson(".claude-plugin/plugin.json");
  const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
  const cursor = readJson(".cursor-plugin/plugin.json");
  const codex = readJson(".codex-plugin/plugin.json");
  const qwen = readJson("qwen-extension.json");
  const cursorMarketplace = readJson(".cursor-plugin/marketplace.json");
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");

  assert.equal(packageJson.name, "@qoderai/better-harness");
  assert.equal(packageJson.description, qoder.description);
  assert.deepEqual(packageJson.bin, {
    "better-harness": "scripts/better-harness.mjs",
  });
  assert.equal(qoder.name, "better-harness");
  assert.equal(qoder.displayName, "Better Harness");
  assert.equal(qoder.version, packageJson.version);

  assert.equal(claude.name, qoder.name);
  assert.equal(claude.version, qoder.version);
  assert.equal(claude.description, qoder.description);
  assert.equal(claude.author.name, qoder.author.name);
  assert.equal(claude.author.email, qoder.author.email);
  assert.deepEqual(Object.keys(claude.author).sort(), ["email", "name"]);
  assert.ok(claude.keywords.includes("skills"));
  assert.equal(claude.license, "MIT");

  assert.equal(cursor.name, qoder.name);
  assert.equal(cursor.displayName, qoder.displayName);
  assert.equal(cursor.version, qoder.version);
  assert.equal(cursor.description, qoder.description);
  assert.equal(cursor.author.name, qoder.author.name);
  assert.equal(cursor.author.email, qoder.author.email);
  assert.deepEqual(Object.keys(cursor.author).sort(), ["email", "name"]);
  assert.deepEqual(cursor.keywords, qoder.keywords);
  assert.equal(cursor.category, qoder.category);
  assert.deepEqual(cursor.tags, qoder.tags);
  assert.equal(cursor.skills, "./skills/");
  assert.equal(qoder.hooks, undefined);
  assert.equal(cursor.hooks, undefined);

  assert.equal(codex.name, qoder.name);
  assert.equal(codex.version, qoder.version);
  assert.equal(codex.description, qoder.description);
  assert.deepEqual(codex.author, qoder.author);
  assert.deepEqual(codex.keywords, qoder.keywords);
  assert.equal(codex.skills, "./skills/");
  assert.equal(codex.interface.displayName, qoder.displayName);
  assert.equal(codex.interface.developerName, qoder.author.name);
  assert.equal(codex.interface.category, qoder.category);
  assert.equal(codex.hooks, undefined);
  assert.equal(codex.license, "MIT");

  assert.equal(qwen.name, qoder.name);
  assert.equal(qwen.version, qoder.version);
  assert.equal(qwen.description, qoder.description);
  assert.equal(qwen.displayName, qoder.displayName);
  assert.equal(qwen.contextFileName, "QWEN.md");
  assert.equal(qwen.skills, "./skills/");
  assert.equal(cursor.license, "MIT");
  assert.equal(qoder.license, "MIT");
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.publishConfig.access, "public");
  assert.equal(packageJson.publishConfig.provenance, true);
  assert.equal(packageJson.publishConfig.registry, "https://registry.npmjs.org/");
  assert.equal(packageLock.name, packageJson.name);
  assert.equal(packageLock.packages[""].name, packageJson.name);
  assert.equal(packageLock.packages[""].license, packageJson.license);
  assert.match(packageJson.scripts["publish:dry-run"], /registry\.npmjs\.org/u);
  for (const manifest of [qoder, claude, cursor, codex]) {
    assert.equal(manifest.homepage, "https://github.com/QoderAI/better-harness");
    assert.equal(manifest.repository, "https://github.com/QoderAI/better-harness");
  }
  assert.equal(codex.interface.privacyPolicyURL, "https://qoder.com/en/privacy-policy");
  assert.equal(codex.interface.termsOfServiceURL, "https://qoder.com/product-service");

  assertExistingPath("references/loop-engineering/loop-blueprint.md");
  assertExistingPath("skills/better-harness/SKILL.md");
  assert.equal(existsSync(path.join(ROOT, "skills/loop-blueprint")), false);
  assert.equal(existsSync(path.join(ROOT, "skills/harness")), false);
  assertExistingPath("hooks/hooks.json.template");

  assert.equal(cursorMarketplace.name, "better-harness");
  assert.deepEqual(cursorMarketplace.owner, cursor.author);
  assert.equal(cursorMarketplace.metadata.description, claudeMarketplace.description);
  assert.equal(cursorMarketplace.plugins.length, 1);
  assert.equal(cursorMarketplace.plugins[0].name, cursor.name);
  assert.equal(cursorMarketplace.plugins[0].description, cursor.description);
  assert.equal(cursorMarketplace.plugins[0].source, "./");
  assert.equal(cursorMarketplace.plugins[0].version, undefined);
  assert.equal(cursorMarketplace.plugins[0].author, undefined);

  assert.equal(claudeMarketplace.name, "better-harness");
  assert.deepEqual(claudeMarketplace.owner, claude.author);
  assert.equal(claudeMarketplace.plugins.length, 1);
  assert.equal(claudeMarketplace.plugins[0].name, claude.name);
  assert.equal(claudeMarketplace.plugins[0].description, claude.description);
  assert.equal(claudeMarketplace.plugins[0].version, claude.version);
  assert.equal(claudeMarketplace.plugins[0].source, "./");
  assert.deepEqual(claudeMarketplace.plugins[0].author, claude.author);
});

test("npm packaging includes every host manifest while the runtime bundle stays Qoder-specific", () => {
  const packageJson = readJson("package.json");
  const releaseMetadata = `${readText("package.json")}\n${readText("package-lock.json")}`;
  assert.doesNotMatch(releaseMetadata, /@ali\/better-harness|registry\.anpm|registry\.npmmirror/u);
  for (const publicPath of [
    ".claude-plugin/",
    ".codex-plugin/",
    ".cursor-plugin/",
    ".qoder-plugin/",
    "qwen-extension.json",
    "AGENTS.md",
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "case-studies/",
    "docs/",
  ]) {
    assert.ok(packageJson.files.includes(publicPath), `npm package should include ${publicPath}`);
  }
  assert.ok(packageJson.files.includes("!scripts/packaging/"), "npm package should exclude source-local host builders");
  assert.equal(packageJson.files.includes("schemas/"), false, "npm package should not expose retired schemas");

  const bundleScript = readText("scripts/npm-package/create-bundle.mjs");
  for (const rootFile of [
    "AGENTS.md",
    "LICENSE",
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
  ]) {
    assert.match(bundleScript, new RegExp(`"${rootFile.replaceAll(".", "\\.")}"`, "u"));
  }
  assert.match(bundleScript, /"\.qoder-plugin"/u);
  assert.match(bundleScript, /"case-studies"/u);
  assert.match(bundleScript, /"docs"/u);
  assert.doesNotMatch(bundleScript, /"\.claude-plugin"/u);
  assert.doesNotMatch(bundleScript, /"\.codex-plugin"/u);
  assert.doesNotMatch(bundleScript, /"\.cursor-plugin"/u);
  assert.doesNotMatch(bundleScript, /"schemas"/u);

  const verifyScript = readText("scripts/npm-package/verify-pack.mjs");
  assert.match(verifyScript, /package\/LICENSE/u);
  assert.match(verifyScript, /package\/AGENTS\.md/u);
  assert.match(verifyScript, /package\/CONTRIBUTING\.md/u);
  assert.match(verifyScript, /package\/case-studies\/factory\/model\/factory-readiness\.md/u);
  assert.match(verifyScript, /package\/docs\/glossary\.md/u);
  assert.match(verifyScript, /^\s*"LICENSE",$/mu);
  assert.match(verifyScript, /vendor\/tree-sitter-wasm\/LICENSE/u);
  assert.match(verifyScript, /vendor\/esbuild-wasm\/LICENSE\.md/u);
  assert.match(verifyScript, /package\/\.qoder-plugin\/plugin\.json/u);
  assert.match(verifyScript, /package\/\.claude-plugin\/plugin\.json/u);
  assert.match(verifyScript, /package\/\.claude-plugin\/marketplace\.json/u);
  assert.match(verifyScript, /package\/\.codex-plugin\/plugin\.json/u);
  assert.match(verifyScript, /package\/\.cursor-plugin\/plugin\.json/u);
  assert.match(verifyScript, /package\/\.cursor-plugin\/marketplace\.json/u);
  assert.match(verifyScript, /package\/qwen-extension\.json/u);
  assert.doesNotMatch(verifyScript, /package\/schemas\/proactive-trigger\.v1\.schema\.json/u);
  assert.doesNotMatch(verifyScript, /package\/scripts\/proactive\/trigger\.mjs/u);
  assert.match(verifyScript, /package\/scripts\/review-trigger\/cli\.mjs/u);
  assert.match(verifyScript, /package\/hooks\/hooks\.json/u);
  assert.match(verifyScript, /\.qoder-plugin\/plugin\.json/u);
  assert.match(verifyScript, /qwen-extension\.json/u);
  assert.match(verifyScript, /"\.claude-plugin\/"/u);
  assert.match(verifyScript, /"\.codex-plugin\/"/u);
  assert.match(verifyScript, /"\.cursor-plugin\/"/u);
  assert.match(verifyScript, /"qwen-extension\.json"/u);
  assert.match(verifyScript, /package\/scripts\/packaging\//u);
  assert.match(verifyScript, /"scripts\/packaging\/"/u);
  assert.doesNotMatch(verifyScript, /schemas\/proactive-event\.v1\.schema\.json/u);
  assert.doesNotMatch(verifyScript, /scripts\/proactive\/trigger\.mjs/u);
  assert.match(verifyScript, /scripts\/review-trigger\/cli\.mjs/u);
});
