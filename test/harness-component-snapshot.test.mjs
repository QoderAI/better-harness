import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectAgentCustomizeInventory } from "../scripts/agent-customize/index.mjs";
import {
  HarnessComponentSnapshotError,
  componentIdFor,
  createHarnessComponentSnapshot,
  diffHarnessComponentSnapshots,
  normalizeComponentRoute,
  parseRollbackReference,
  populationRefFromKey,
  resolveHarnessComponentRollbackReference,
  validateHarnessComponentSnapshot,
} from "../scripts/harness-component-snapshot/index.mjs";
import {
  assembleHarnessComponentSnapshot,
  collectWorkflowItems,
} from "../scripts/harness-component-snapshot/snapshot.mjs";

const FIXTURE = path.join(process.cwd(), "test", "fixtures", "harness-component-snapshot", "project");
const TEST_POPULATION_REF = populationRefFromKey("harness-component-snapshot-test");

async function fixtureWorkspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-component-snapshot-"));
  const workspace = path.join(root, "workspace");
  await cp(FIXTURE, workspace, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return workspace;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("Qoder project snapshot is deterministic, complete, private, and deeply frozen", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const first = await createHarnessComponentSnapshot({ workspace });
  const second = await createHarnessComponentSnapshot({ workspace });

  assert.deepEqual(first, second);
  assert.equal(validateHarnessComponentSnapshot(first), first);
  assertDeepFrozen(first);
  assert.deepEqual(
    Object.fromEntries(first.coverage.map((row) => [row.kind, row.count])),
    { rule: 2, skill: 2, hook: 1, command: 1, workflow: 2 },
  );
  assert.ok(first.components.every((component) => component.provider === "qoder" && component.scope === "project"));
  assert.ok(first.components.every((component) => component.activation.state === "unknown"));
  assert.ok(first.components.every((component) => component.activation.evidenceState === "unavailable"));
  assert.ok(first.components.every((component) => component.provenance.state === "observed"));
  assert.ok(first.components.every((component) => component.provenance.source === (
    component.kind === "workflow" ? "qoder-project-workflow-scan" : "qoder-project-inventory"
  )));
  assert.deepEqual(
    first.relationships,
    first.components.map((component) => ({
      type: "declared-in",
      sourceComponentId: component.id,
      targetArtifactRef: component.provenance.artifactRef,
    })),
  );

  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes(workspace), false);
  assert.equal(serialized.includes("PRIVATE-HOME-SENTINEL"), false);
  assert.equal(serialized.includes("FixtureOwner"), false);
  assert.equal(serialized.includes("preToolUse"), false);
  assert.equal(serialized.includes("Write"), false);
  assert.equal(serialized.includes("command"), true, "the component kind remains visible");
  assert.ok(first.components.every((component) => /^sha256:[a-f0-9]{64}$/u.test(component.revision)));
});

test("out-of-scope Qoder project assets are not collected or completeness gates", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const privateAgent = path.join(workspace, ".qoder", "agents", "a", "b", "c", "d", "e", "private.md");
  await mkdir(path.dirname(privateAgent), { recursive: true });
  await writeFile(privateAgent, "# PRIVATE-SUBAGENT-SENTINEL\n", "utf8");
  await writeFile(path.join(workspace, ".qoder", "mcp.json"), JSON.stringify({
    mcpServers: {
      private: { command: "PRIVATE-MCP-SENTINEL" },
    },
  }), "utf8");

  const inventory = await collectAgentCustomizeInventory({
    provider: "qoder",
    workspace,
    includeUserHome: false,
    projectCollections: ["rules", "skills", "hooks", "commands"],
  });
  assert.deepEqual(inventory.manage.subagents, []);
  assert.deepEqual(inventory.manage.mcps, []);

  const snapshot = await createHarnessComponentSnapshot({ workspace });
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("PRIVATE-SUBAGENT-SENTINEL"), false);
  assert.equal(serialized.includes("PRIVATE-MCP-SENTINEL"), false);

  await assert.rejects(
    () => collectAgentCustomizeInventory({
      provider: "qoder",
      workspace,
      includeUserHome: false,
      projectCollections: ["rules", "rules"],
    }),
    (error) => error instanceof TypeError && /unique supported/u.test(error.message),
  );
  await assert.rejects(
    () => collectAgentCustomizeInventory({ provider: "cursor", workspace, projectCollections: [] }),
    (error) => error instanceof TypeError && /only for the Qoder provider/u.test(error.message),
  );
});

test("collector output order is irrelevant while Hook routing identity stays explicit", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const inventory = await collectAgentCustomizeInventory({
    provider: "qoder",
    workspace,
    includeUserHome: false,
  });
  const reversed = {
    ...inventory,
    manage: Object.fromEntries(Object.entries(inventory.manage)
      .map(([key, values]) => [key, [...values].reverse()])),
  };
  const workflowItems = [
    { filePath: path.join(workspace, ".agents", "workflows", "handoff.json") },
    { filePath: path.join(workspace, ".qoder", "workflows", "review.yml") },
  ];
  const normal = await createHarnessComponentSnapshot({ workspace });
  const reordered = await assembleHarnessComponentSnapshot({
    workspace,
    provider: "qoder",
    populationRef: normal.populationRef,
    inventory: reversed,
    workflowItems: workflowItems.reverse(),
  });
  assert.deepEqual(reordered, normal);
  const hook = normal.components.find((component) => component.kind === "hook");
  assert.match(hook.route, /#hook\/[a-f0-9]{16}\/0$/u);
});

test("component population limit is checked before any evidence file is read", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const missingFile = path.join(workspace, "must-not-be-read.md");
  const inventory = {
    provider: "qoder",
    manage: {
      rules: Array.from({ length: 20_001 }, () => ({ scope: "project", filePath: missingFile })),
      skills: [],
      hooks: [],
      commands: [],
    },
  };

  await assert.rejects(
    () => assembleHarnessComponentSnapshot({
      workspace,
      provider: "qoder",
      populationRef: TEST_POPULATION_REF,
      inventory,
      workflowItems: [],
    }),
    (error) => error instanceof HarnessComponentSnapshotError
      && error.code === "SNAPSHOT_COMPONENT_LIMIT_EXCEEDED",
  );
});

test("reordering distinct hook declarations keeps identity and changes ordered revisions", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const settingsPath = path.join(workspace, ".qoder", "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  settings.hooks.preToolUse.push({
    matcher: "Bash",
    hooks: [{ type: "command", command: "node scripts/check.mjs" }],
  });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  const before = await createHarnessComponentSnapshot({ workspace });
  settings.hooks.preToolUse.reverse();
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  const after = await createHarnessComponentSnapshot({ workspace });
  const beforeIds = before.components.filter((component) => component.kind === "hook").map((component) => component.id);
  const afterIds = after.components.filter((component) => component.kind === "hook").map((component) => component.id);
  assert.deepEqual(afterIds, beforeIds);
  const diff = diffHarnessComponentSnapshots(before, after, { limit: 100 });
  assert.equal(diff.counts.added, 0);
  assert.equal(diff.counts.removed, 0);
  assert.equal(diff.counts.changed, 2);
});

test("portable component routes keep identity independent from workspace and host separators", () => {
  assert.equal(normalizeComponentRoute(".qoder\\skills\\verify\\SKILL.md"), ".qoder/skills/verify/SKILL.md");
  assert.equal(normalizeComponentRoute(".qoder/skills/verify/SKILL.md"), ".qoder/skills/verify/SKILL.md");
  const identity = componentIdFor({
    provider: "qoder",
    scope: "project",
    populationRef: TEST_POPULATION_REF,
    kind: "skill",
    route: ".qoder\\skills\\verify\\SKILL.md",
  });
  assert.match(identity, /^hcs:qoder:project:[a-f0-9]{64}:skill:\.qoder\/skills\/verify\/SKILL\.md$/u);
  assert.throws(() => normalizeComponentRoute("C:\\Users\\owner\\skill.md"), { code: "UNSAFE_COMPONENT_ROUTE" });
  assert.throws(() => normalizeComponentRoute("C:private-skill.md"), { code: "UNSAFE_COMPONENT_ROUTE" });
  assert.throws(() => normalizeComponentRoute("/Users/owner/skill.md"), { code: "UNSAFE_COMPONENT_ROUTE" });
  assert.throws(() => normalizeComponentRoute("../outside.md"), { code: "UNSAFE_COMPONENT_ROUTE" });
  assert.throws(() => componentIdFor({ provider: "claude", scope: "project", populationRef: TEST_POPULATION_REF, kind: "skill", route: "skill.md" }), {
    code: "UNSUPPORTED_PROVIDER",
  });
  assert.throws(() => componentIdFor({ provider: "qoder", scope: "user", populationRef: TEST_POPULATION_REF, kind: "skill", route: "skill.md" }), {
    code: "UNSUPPORTED_SCOPE",
  });
});

test("population references reject cross-project reuse and preserve explicit relocation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-component-population-"));
  const firstWorkspace = path.join(root, "first");
  const secondWorkspace = path.join(root, "second");
  await Promise.all([
    cp(FIXTURE, firstWorkspace, { recursive: true }),
    cp(FIXTURE, secondWorkspace, { recursive: true }),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = await createHarnessComponentSnapshot({ workspace: firstWorkspace });
  const second = await createHarnessComponentSnapshot({ workspace: secondWorkspace });
  assert.notEqual(first.populationRef, second.populationRef);
  assert.throws(() => diffHarnessComponentSnapshots(first, second), { code: "SNAPSHOT_POPULATION_MISMATCH" });
  assert.throws(
    () => resolveHarnessComponentRollbackReference(second, first.components[0].rollbackReference),
    { code: "ROLLBACK_COMPONENT_NOT_FOUND" },
  );

  const explicitFirst = await createHarnessComponentSnapshot({ workspace: firstWorkspace, populationKey: "portable-project" });
  const explicitSecond = await createHarnessComponentSnapshot({ workspace: secondWorkspace, populationKey: "portable-project" });
  assert.deepEqual(explicitFirst, explicitSecond);
  assert.equal(JSON.stringify(explicitFirst).includes("portable-project"), false);
});

test("workspace evidence roots are scoped to each snapshot assembly", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-component-read-context-"));
  const firstWorkspace = path.join(root, "first");
  const secondWorkspace = path.join(root, "second");
  const workspaceAlias = path.join(root, "workspace");
  await Promise.all([
    cp(FIXTURE, firstWorkspace, { recursive: true }),
    cp(FIXTURE, secondWorkspace, { recursive: true }),
  ]);
  await writeFile(path.join(secondWorkspace, ".qoder", "workflows", "review.yml"), "name: changed\n", "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));

  try {
    await symlink(firstWorkspace, workspaceAlias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
      t.skip(`workspace alias unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const options = {
    workspace: workspaceAlias,
    provider: "qoder",
    populationRef: TEST_POPULATION_REF,
    inventory: {
      provider: "qoder",
      manage: { rules: [], skills: [], hooks: [], commands: [] },
    },
    workflowItems: [{ filePath: path.join(workspaceAlias, ".qoder", "workflows", "review.yml") }],
  };
  const first = await assembleHarnessComponentSnapshot(options);
  await rm(workspaceAlias, { recursive: true, force: true });
  await symlink(secondWorkspace, workspaceAlias, process.platform === "win32" ? "junction" : "dir");
  const second = await assembleHarnessComponentSnapshot(options);

  assert.equal(first.components[0].id, second.components[0].id);
  assert.notEqual(first.components[0].revision, second.components[0].revision);
});

test("inventory completeness fails closed on malformed, deep, and truncated sources", async (t) => {
  const malformedWorkspace = await fixtureWorkspace(t);
  const privateParserSentinel = `PRIVATE-HOOK-PARSER-SENTINEL:${malformedWorkspace}`;
  await writeFile(path.join(malformedWorkspace, ".qoder", "settings.json"), privateParserSentinel, "utf8");
  await assert.rejects(
    () => createHarnessComponentSnapshot({ workspace: malformedWorkspace }),
    (error) => {
      assert.ok(error instanceof HarnessComponentSnapshotError);
      assert.equal(error.code, "INVALID_HOOK_CONFIG");
      assert.equal(error.message, "cannot read or parse Qoder hook configuration");
      assert.equal(error.message.includes(malformedWorkspace), false);
      assert.equal(error.message.includes(privateParserSentinel), false);
      return true;
    },
  );

  const deepWorkspace = await fixtureWorkspace(t);
  const deepCommand = path.join(deepWorkspace, ".qoder", "commands", "a", "b", "c", "d", "e");
  await mkdir(deepCommand, { recursive: true });
  await writeFile(path.join(deepCommand, "deep.md"), "# Deep\n", "utf8");
  await assert.rejects(
    () => createHarnessComponentSnapshot({ workspace: deepWorkspace }),
    (error) => error instanceof HarnessComponentSnapshotError && error.code === "INVENTORY_DEPTH_EXCEEDED",
  );

  const workflowWorkspace = await fixtureWorkspace(t);
  await writeFile(path.join(workflowWorkspace, ".qoder", "workflows", "second.yml"), "name: second\n", "utf8");
  await assert.rejects(
    () => collectWorkflowItems(workflowWorkspace, { maxFiles: 1 }),
    (error) => error instanceof HarnessComponentSnapshotError && error.code === "INVENTORY_LIMIT_EXCEEDED",
  );
  const deepWorkflow = path.join(workflowWorkspace, ".qoder", "workflows", "a", "b", "c", "d", "e");
  await mkdir(deepWorkflow, { recursive: true });
  await writeFile(path.join(deepWorkflow, "deep.yml"), "name: deep\n", "utf8");
  await assert.rejects(
    () => createHarnessComponentSnapshot({ workspace: workflowWorkspace }),
    (error) => error instanceof HarnessComponentSnapshotError && error.code === "INVENTORY_DEPTH_EXCEEDED",
  );
});

test("workspace scope rejects user-home aliases and regular files", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const previousQoderHome = process.env.QODER_HOME;
  process.env.QODER_HOME = path.join(workspace, ".qoder");
  t.after(() => {
    if (previousQoderHome === undefined) delete process.env.QODER_HOME;
    else process.env.QODER_HOME = previousQoderHome;
  });
  await assert.rejects(
    () => createHarnessComponentSnapshot({ workspace }),
    (error) => error instanceof HarnessComponentSnapshotError && error.code === "AMBIGUOUS_QODER_SCOPE",
  );
  await assert.rejects(
    () => createHarnessComponentSnapshot({ workspace: path.join(workspace, ".qoder") }),
    (error) => error instanceof HarnessComponentSnapshotError && error.code === "AMBIGUOUS_QODER_SCOPE",
  );

  const filePath = path.join(path.dirname(workspace), "not-a-workspace.txt");
  await writeFile(filePath, "file\n", "utf8");
  await assert.rejects(
    () => createHarnessComponentSnapshot({ workspace: filePath }),
    (error) => error instanceof HarnessComponentSnapshotError && error.code === "WORKSPACE_NOT_FOUND",
  );
});

test("tilde QODER_HOME aliases cannot masquerade as project scope", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-component-home-alias-"));
  const qoderHome = path.join(root, ".qoder");
  await cp(FIXTURE, qoderHome, { recursive: true });
  const previousQoderHome = process.env.QODER_HOME;
  const originalHomedir = os.homedir;
  process.env.QODER_HOME = "~/.qoder";
  os.homedir = () => root;
  t.after(async () => {
    os.homedir = originalHomedir;
    if (previousQoderHome === undefined) delete process.env.QODER_HOME;
    else process.env.QODER_HOME = previousQoderHome;
    await rm(root, { recursive: true, force: true });
  });

  await assert.rejects(
    () => createHarnessComponentSnapshot({ workspace: qoderHome }),
    (error) => error instanceof HarnessComponentSnapshotError && error.code === "AMBIGUOUS_QODER_SCOPE",
  );
});

test("direct project control-file symlinks cannot escape before inventory reads", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const outside = path.join(path.dirname(workspace), "outside-settings.json");
  const settingsPath = path.join(workspace, ".qoder", "settings.json");
  await writeFile(outside, JSON.stringify({ private: "PRIVATE-HOME-SENTINEL" }), "utf8");
  await rm(settingsPath);
  try {
    await symlink(outside, settingsPath, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
      t.skip(`symlink unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    () => createHarnessComponentSnapshot({ workspace }),
    (error) => error instanceof HarnessComponentSnapshotError && error.code === "PROJECT_READ_OUTSIDE_WORKSPACE",
  );
});

test("collector root junctions cannot hide an external incomplete population", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const outsideRoot = path.join(path.dirname(workspace), "outside-rules");
  const rulesRoot = path.join(workspace, ".qoder", "rules");
  await mkdir(outsideRoot, { recursive: true });
  await writeFile(path.join(outsideRoot, "private.txt"), "PRIVATE-HOME-SENTINEL\n", "utf8");
  await rm(rulesRoot, { recursive: true, force: true });
  try {
    await symlink(outsideRoot, rulesRoot, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
      t.skip(`junction/symlink unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    () => createHarnessComponentSnapshot({ workspace }),
    (error) => error instanceof HarnessComponentSnapshotError && error.code === "PROJECT_READ_OUTSIDE_WORKSPACE",
  );
});

test("content revision changes without changing identity or activation", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const before = await createHarnessComponentSnapshot({ workspace });
  const skillPath = path.join(workspace, ".qoder", "skills", "verify", "SKILL.md");
  await writeFile(skillPath, `${await readFile(skillPath, "utf8")}\nRun the portable smoke test.\n`, "utf8");
  const after = await createHarnessComponentSnapshot({ workspace });
  const beforeSkill = before.components.find((component) => component.route === ".qoder/skills/verify/SKILL.md");
  const afterSkill = after.components.find((component) => component.route === beforeSkill.route);

  assert.equal(afterSkill.id, beforeSkill.id);
  assert.equal(afterSkill.identityDigest, beforeSkill.identityDigest);
  assert.notEqual(afterSkill.revision, beforeSkill.revision);
  assert.deepEqual(afterSkill.activation, beforeSkill.activation);
  const diff = diffHarnessComponentSnapshots(before, after);
  assert.deepEqual(
    diff.entries.find((entry) => entry.componentId === beforeSkill.id).changedDimensions,
    ["content"],
  );
});

test("Skill resources and Hook scripts participate in their component revision", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const before = await createHarnessComponentSnapshot({ workspace });
  const skill = before.components.find((component) => component.route === ".qoder/skills/verify/SKILL.md");
  const hook = before.components.find((component) => component.kind === "hook");

  const referencePath = path.join(workspace, ".qoder", "skills", "verify", "references", "check.md");
  await writeFile(referencePath, `${await readFile(referencePath, "utf8")}\nAdditional check.\n`, "utf8");
  const afterReference = await createHarnessComponentSnapshot({ workspace });
  const skillAfterReference = afterReference.components.find((component) => component.id === skill.id);
  const hookAfterReference = afterReference.components.find((component) => component.id === hook.id);
  assert.notEqual(skillAfterReference.revision, skill.revision);
  assert.equal(hookAfterReference.revision, hook.revision);

  const scriptPath = path.join(workspace, "scripts", "check.mjs");
  await writeFile(scriptPath, `${await readFile(scriptPath, "utf8")}\n`, "utf8");
  const afterScript = await createHarnessComponentSnapshot({ workspace });
  const hookAfterScript = afterScript.components.find((component) => component.id === hook.id);
  assert.notEqual(hookAfterScript.revision, hookAfterReference.revision);
  assert.equal(hookAfterScript.id, hook.id);
});

test("bounded diff reports added, removed, changed, and unchanged independently", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const before = await createHarnessComponentSnapshot({ workspace });
  const skillPath = path.join(workspace, ".qoder", "skills", "verify", "SKILL.md");
  await writeFile(skillPath, `${await readFile(skillPath, "utf8")}\nChanged.\n`, "utf8");
  await rm(path.join(workspace, ".qoder", "rules", "review.md"));
  await writeFile(path.join(workspace, ".qoder", "workflows", "release.yml"), "name: release\n", "utf8");
  const after = await createHarnessComponentSnapshot({ workspace });
  const full = diffHarnessComponentSnapshots(before, after, { limit: 100 });

  assert.equal(full.counts.added, 1);
  assert.equal(full.counts.removed, 1);
  assert.equal(full.counts.changed, 1);
  assert.ok(full.counts.unchanged > 0);
  assert.deepEqual(new Set(full.entries.map((entry) => entry.status)), new Set(["added", "removed", "changed", "unchanged"]));
  const bounded = diffHarnessComponentSnapshots(before, after, { limit: 2 });
  assert.equal(bounded.entries.length, 2);
  assert.equal(bounded.totalEntries, full.totalEntries);
  assert.equal(bounded.truncated, true);
  assert.deepEqual(bounded.counts, full.counts);
  assert.equal(bounded.entries.some((entry) => entry.status === "unchanged"), false);

  const significant = diffHarnessComponentSnapshots(before, after, { limit: 3 });
  assert.deepEqual(
    significant.entries.map((entry) => entry.status),
    ["changed", "added", "removed"],
  );
  assert.throws(() => diffHarnessComponentSnapshots(before, after, { limit: 1001 }), { code: "INVALID_DIFF_LIMIT" });
});

test("validation and diff fail closed for stale, tampered, and mismatched snapshots", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const snapshot = await createHarnessComponentSnapshot({ workspace });

  const stale = clone(snapshot);
  stale.components[0].revision = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateHarnessComponentSnapshot(stale), { code: "ROLLBACK_REFERENCE_MISMATCH" });

  const relationship = clone(snapshot);
  relationship.relationships[0].sourceComponentId = "hcs:qoder:project:rule:missing.md";
  assert.throws(() => validateHarnessComponentSnapshot(relationship), { code: "UNKNOWN_RELATIONSHIP_SOURCE" });

  const population = clone(snapshot);
  population.provider = "claude";
  assert.throws(() => diffHarnessComponentSnapshots(snapshot, population), { code: "UNSUPPORTED_SNAPSHOT_POPULATION" });

  const outside = path.join(path.dirname(workspace), "outside.md");
  await writeFile(outside, "outside\n", "utf8");
  const inventory = {
    provider: "qoder",
    manage: { rules: [{ scope: "project", filePath: outside }], skills: [], hooks: [], commands: [] },
  };
  await assert.rejects(
    () => assembleHarnessComponentSnapshot({
      workspace,
      provider: "qoder",
      populationRef: snapshot.populationRef,
      inventory,
      workflowItems: [],
    }),
    (error) => error instanceof HarnessComponentSnapshotError && error.code === "COMPONENT_FILE_OUTSIDE_WORKSPACE",
  );

  const relativeInventory = {
    provider: "qoder",
    manage: {
      rules: [{ scope: "project", filePath: "AGENTS.md" }],
      skills: [],
      hooks: [],
      commands: [],
    },
  };
  const relative = await assembleHarnessComponentSnapshot({
    workspace,
    provider: "qoder",
    populationRef: snapshot.populationRef,
    inventory: relativeInventory,
    workflowItems: [],
  });
  assert.equal(relative.components[0].route, "AGENTS.md");
});

test("rollback references resolve exact revisions without authorizing mutation", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const snapshot = await createHarnessComponentSnapshot({ workspace });
  const component = snapshot.components[0];
  assert.deepEqual(parseRollbackReference(component.rollbackReference), {
    componentId: component.id,
    revision: component.revision,
  });
  const resolved = resolveHarnessComponentRollbackReference(snapshot, component.rollbackReference);
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.mutationAuthorized, false);
  assert.equal(resolved.componentId, component.id);
  assert.equal(Object.hasOwn(resolved, "content"), false);

  assert.throws(
    () => parseRollbackReference(`harness-component:v1:not-a-component?revision=sha256%3A${"0".repeat(64)}`),
    { code: "INVALID_ROLLBACK_REFERENCE" },
  );

  const alternate = component.revision.endsWith("0") ? "1" : "0";
  const foreign = component.rollbackReference.slice(0, -1) + alternate;
  assert.throws(() => resolveHarnessComponentRollbackReference(snapshot, foreign), { code: "ROLLBACK_REVISION_MISMATCH" });
});
