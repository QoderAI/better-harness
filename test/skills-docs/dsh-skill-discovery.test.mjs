import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

let dsh;
try {
  dsh = await import("../../scripts/dsh-skill-discovery/index.mjs");
} catch {
  dsh = undefined;
}

function requireSubject() {
  assert.ok(dsh, "the DSH verified-discovery owner must exist");
  return dsh;
}

function canonicalSkill(paths, overrides = {}) {
  return {
    name: "better-harness",
    source: "custom",
    provider: "skill-filesystem",
    path: paths.skillFile,
    resourceBase: { kind: "directory", path: paths.skillDirectory },
    invocation: { modelInvocable: true, userInvocable: true },
    content: "Canonical Better Harness body.",
    ...overrides,
  };
}

function completeInspector(paths, overrides = new Map()) {
  const expected = new Map([
    [paths.root, { kind: "directory", symbolicLink: false }],
    [paths.skillsRoot, { kind: "directory", symbolicLink: false }],
    [paths.skillDirectory, { kind: "directory", symbolicLink: false }],
    [paths.skillFile, { kind: "file", symbolicLink: false }],
    [paths.cli, { kind: "file", symbolicLink: false }],
    ...paths.resourceDirectories.map((entry) => [entry, { kind: "directory", symbolicLink: false }]),
  ]);
  return async (target) => overrides.has(target) ? overrides.get(target) : expected.get(target);
}

test("DSH verification binds the winning native definition to the complete canonical root", async () => {
  const subject = requireSubject();
  const root = path.resolve("/tmp/Better Harness 演示");
  const paths = subject.resolveCanonicalPaths(root);
  const result = await subject.verifyCanonicalSkill({
    betterHarnessRoot: root,
    skill: canonicalSkill(paths),
    inspectPath: completeInspector(paths),
  });

  assert.equal(result.verified, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(path.dirname(path.dirname(result.paths.skillDirectory)), result.paths.root);
});

test("DSH verification fails closed for shadows, wrong roots, missing resources, and links", async () => {
  const subject = requireSubject();
  const root = path.resolve("/tmp/better-harness-root");
  const paths = subject.resolveCanonicalPaths(root);
  const shadow = canonicalSkill(paths, {
    source: "project-dsh",
    path: path.join(root, "workspace/.dsh/skills/better-harness/SKILL.md"),
    resourceBase: { kind: "directory", path: path.join(root, "workspace/.dsh/skills/better-harness") },
  });
  const shadowResult = await subject.verifyCanonicalSkill({
    betterHarnessRoot: root,
    skill: shadow,
    inspectPath: completeInspector(paths),
  });
  assert.equal(shadowResult.verified, false);
  assert.deepEqual(shadowResult.reasons, [
    "winner-source-mismatch",
    "winner-path-mismatch",
    "resource-base-mismatch",
    "root-invariant-mismatch",
  ]);

  const missing = new Map([[paths.cli, undefined]]);
  const missingResult = await subject.verifyCanonicalSkill({
    betterHarnessRoot: root,
    skill: canonicalSkill(paths),
    inspectPath: completeInspector(paths, missing),
  });
  assert.equal(missingResult.verified, false);
  assert.deepEqual(missingResult.reasons, ["required-resource-missing:scripts/better-harness.mjs"]);

  const linked = new Map([[paths.skillDirectory, { kind: "directory", symbolicLink: true }]]);
  const linkedResult = await subject.verifyCanonicalSkill({
    betterHarnessRoot: root,
    skill: canonicalSkill(paths),
    inspectPath: completeInspector(paths, linked),
  });
  assert.equal(linkedResult.verified, false);
  assert.deepEqual(linkedResult.reasons, ["symbolic-link-not-supported:skills/better-harness"]);
});

test("DSH verification accepts a skipped malformed shadow only when native DSH returns the canonical winner", async () => {
  const subject = requireSubject();
  const root = path.resolve("/tmp/better-harness-root");
  const paths = subject.resolveCanonicalPaths(root);
  const canonical = await subject.verifyCanonicalSkill({
    betterHarnessRoot: root,
    skill: canonicalSkill(paths),
    inspectPath: completeInspector(paths),
  });
  const absent = await subject.verifyCanonicalSkill({
    betterHarnessRoot: root,
    skill: undefined,
    inspectPath: completeInspector(paths),
  });

  assert.equal(canonical.verified, true);
  assert.deepEqual(absent.reasons, ["skill-not-discovered"]);
});

test("DSH path contract covers POSIX and Windows absolute roots with spaces and Unicode", () => {
  const subject = requireSubject();
  const posix = subject.resolveCanonicalPaths("/opt/Better Harness/工程", { pathApi: path.posix });
  assert.equal(posix.skillFile, "/opt/Better Harness/工程/skills/better-harness/SKILL.md");

  const windows = subject.resolveCanonicalPaths("C:\\Tools\\Better Harness\\工程", { pathApi: path.win32 });
  assert.equal(windows.skillFile, "C:\\Tools\\Better Harness\\工程\\skills\\better-harness\\SKILL.md");

  assert.throws(() => subject.resolveCanonicalPaths("relative/better-harness"), /absolute/);
  assert.throws(() => subject.resolveCanonicalPaths("~/better-harness"), /absolute|tilde/);
});

test("DSH policy rejects only model-facing Better Harness Skill calls", () => {
  const subject = requireSubject();
  assert.match(
    subject.guardBetterHarnessModelInvocation({ name: "skill", arguments: { name: "better-harness" } }),
    /explicit \/better-harness/,
  );
  assert.equal(subject.guardBetterHarnessModelInvocation({ name: "skill", arguments: { name: "another-skill" } }), undefined);
  assert.equal(subject.guardBetterHarnessModelInvocation({ name: "bash", arguments: { name: "better-harness" } }), undefined);
});

test("DSH plugin verifies direct-user gestures and leaves native slash injection to tool-skill", async () => {
  const subject = requireSubject();
  const root = path.resolve("/tmp/better-harness-root");
  const paths = subject.resolveCanonicalPaths(root);
  const guards = [];
  const listeners = [];
  const ctx = {
    tools: { guard: (guard) => guards.push(guard) },
    skills: { get: async () => canonicalSkill(paths) },
    on: (name, listener) => listeners.push({ name, listener }),
  };
  subject.createPlugin(completeInspector(paths))(ctx, { betterHarnessRoot: root });

  assert.equal(guards.length, 1);
  const preStep = listeners.find((entry) => entry.name === "agent/pre-step")?.listener;
  assert.equal(typeof preStep, "function");
  const messages = [{ source: { kind: "user" }, content: [{ type: "text", text: "please run /better-harness now" }] }];
  const downstream = { kind: "enter", messages: [{ source: { kind: "plugin" }, content: [] }] };
  assert.equal(await preStep({
    agent: { session: { header: { cwd: "/workspace" } } },
    messages,
    signal: new AbortController().signal,
  }, async () => downstream), downstream);

  ctx.skills.get = async () => canonicalSkill(paths, { source: "project-agents" });
  await assert.rejects(() => preStep({
    agent: { session: { header: { cwd: "/workspace" } } },
    messages,
    signal: new AbortController().signal,
  }, async () => downstream), /winner-source-mismatch/);
});
