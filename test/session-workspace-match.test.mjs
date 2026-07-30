import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_WORKSPACE_SCOPE_KIND,
  WORKSPACE_CWD_MATCH,
  WORKSPACE_PATH_CLASS,
  WORKSPACE_QUALIFICATION_STATUS,
  WORKSPACE_SESSION_MATCH,
  classifyWorkspaceCwd,
  classifyWorkspacePathFact,
  qualifyWorkspaceSession,
  summarizeWorkspaceQualifications,
  validateWorkspaceMatchTopology,
} from "../scripts/session-analysis/workspace-match.mjs";

function memberTopology(overrides = {}) {
  return {
    kind: "better-harness.workspace-topology",
    schemaVersion: 1,
    requestedWorkspace: "/repo/extensions/assistant",
    gitRoot: "/repo",
    target: {
      kind: "workspace-member",
      route: "extensions/assistant",
      memberRoute: "extensions/assistant",
      memberMatch: "exact",
    },
    ...overrides,
  };
}

test("validates and normalizes the session-critical workspace topology", () => {
  const scope = validateWorkspaceMatchTopology(memberTopology({
    requestedWorkspace: "/repo/extensions/assistant/",
    gitRoot: "/repo/",
  }));

  assert.equal(scope.kind, SESSION_WORKSPACE_SCOPE_KIND);
  assert.equal(scope.requestedWorkspace, "/repo/extensions/assistant");
  assert.equal(scope.gitRoot, "/repo");
  assert.equal(scope.target.kind, "workspace-member");
  assert.equal(Object.isFrozen(scope), true);
  assert.equal(Object.isFrozen(scope.target), true);
});

test("rejects topology mismatches without echoing path values", () => {
  const invalid = [
    { ...memberTopology(), kind: "wrong" },
    { ...memberTopology(), schemaVersion: 2 },
    { ...memberTopology(), requestedWorkspace: "relative/package" },
    { ...memberTopology(), requestedWorkspace: "/repo/extensions/other" },
    {
      ...memberTopology(),
      target: { ...memberTopology().target, route: "extensions/../assistant" },
    },
    {
      ...memberTopology(),
      target: { ...memberTopology().target, memberRoute: "extensions/other" },
    },
  ];

  for (const topology of invalid) {
    assert.throws(
      () => validateWorkspaceMatchTopology(topology),
      (error) => error.code === "INVALID_WORKSPACE_TOPOLOGY"
        && !String(error.message).includes("/repo/extensions/assistant"),
    );
  }
});

test("validates repo-root, repo-subtree, and standalone invariants", () => {
  const root = validateWorkspaceMatchTopology({
    kind: "better-harness.workspace-topology",
    schemaVersion: 1,
    requestedWorkspace: "/repo",
    gitRoot: "/repo",
    target: { kind: "repo-root", route: ".", memberRoute: null, memberMatch: "none" },
  });
  const subtree = validateWorkspaceMatchTopology({
    kind: "better-harness.workspace-topology",
    schemaVersion: 1,
    requestedWorkspace: "/repo/tools/checks",
    gitRoot: "/repo",
    target: { kind: "repo-subtree", route: "tools/checks", memberRoute: null, memberMatch: "none" },
  });
  const standalone = validateWorkspaceMatchTopology({
    kind: "better-harness.workspace-topology",
    schemaVersion: 1,
    requestedWorkspace: "/standalone",
    gitRoot: null,
    target: { kind: "standalone", route: ".", memberRoute: null, memberMatch: "none" },
  });

  assert.equal(root.target.kind, "repo-root");
  assert.equal(subtree.target.kind, "repo-subtree");
  assert.equal(standalone.gitRoot, null);
});

test("classifies direct CWDs, exact Git-root candidates, and sibling prefixes safely", () => {
  const scope = validateWorkspaceMatchTopology(memberTopology());

  assert.equal(classifyWorkspaceCwd("/repo/extensions/assistant", scope), WORKSPACE_CWD_MATCH.DIRECT);
  assert.equal(classifyWorkspaceCwd("/repo/extensions/assistant/src", scope), WORKSPACE_CWD_MATCH.DIRECT);
  assert.equal(classifyWorkspaceCwd("/repo", scope), WORKSPACE_CWD_MATCH.ROOT_CANDIDATE);
  assert.equal(classifyWorkspaceCwd("/repo/extensions/assistant-tools", scope), WORKSPACE_CWD_MATCH.UNMATCHED);
  assert.equal(classifyWorkspaceCwd("/repo/extensions", scope), WORKSPACE_CWD_MATCH.UNMATCHED);
  assert.equal(classifyWorkspaceCwd("relative", scope), WORKSPACE_CWD_MATCH.UNMATCHED);
});

test("does not create root candidates for repo-root, subtree, or standalone targets", () => {
  const rootScope = validateWorkspaceMatchTopology({
    kind: "better-harness.workspace-topology",
    schemaVersion: 1,
    requestedWorkspace: "/repo",
    gitRoot: "/repo",
    target: { kind: "repo-root", route: ".", memberRoute: null, memberMatch: "none" },
  });
  const subtreeScope = validateWorkspaceMatchTopology({
    kind: "better-harness.workspace-topology",
    schemaVersion: 1,
    requestedWorkspace: "/repo/tools",
    gitRoot: "/repo",
    target: { kind: "repo-subtree", route: "tools", memberRoute: null, memberMatch: "none" },
  });
  const standaloneScope = validateWorkspaceMatchTopology({
    kind: "better-harness.workspace-topology",
    schemaVersion: 1,
    requestedWorkspace: "/standalone",
    gitRoot: null,
    target: { kind: "standalone", route: ".", memberRoute: null, memberMatch: "none" },
  });

  assert.equal(classifyWorkspaceCwd("/repo", rootScope), WORKSPACE_CWD_MATCH.DIRECT);
  assert.equal(classifyWorkspaceCwd("/repo", subtreeScope), WORKSPACE_CWD_MATCH.UNMATCHED);
  assert.equal(classifyWorkspaceCwd("/standalone", standaloneScope), WORKSPACE_CWD_MATCH.DIRECT);
});

test("classifies absolute and relative path facts with segment-safe containment", () => {
  const scope = validateWorkspaceMatchTopology(memberTopology());

  assert.equal(classifyWorkspacePathFact("/repo/extensions/assistant/src/a.ts", scope), WORKSPACE_PATH_CLASS.TARGET);
  assert.equal(
    classifyWorkspacePathFact("extensions/assistant/src/a.ts", scope, { cwd: "/repo" }),
    WORKSPACE_PATH_CLASS.TARGET,
  );
  assert.equal(
    classifyWorkspacePathFact({ filePath: "src/a.ts", cwd: "/repo/extensions/assistant" }, scope),
    WORKSPACE_PATH_CLASS.TARGET,
  );
  assert.equal(
    classifyWorkspacePathFact("/repo/extensions/assistant-tools/src/a.ts", scope),
    WORKSPACE_PATH_CLASS.GIT_OTHER,
  );
  assert.equal(
    classifyWorkspacePathFact("extensions/assistant/../other/a.ts", scope, { cwd: "/repo" }),
    WORKSPACE_PATH_CLASS.GIT_OTHER,
  );
  assert.equal(classifyWorkspacePathFact("/outside/a.ts", scope), WORKSPACE_PATH_CLASS.OUTSIDE_GIT);
  assert.equal(classifyWorkspacePathFact("", scope, { cwd: "/repo" }), WORKSPACE_PATH_CLASS.UNRESOLVED);
  assert.equal(classifyWorkspacePathFact("relative.ts", scope), WORKSPACE_PATH_CLASS.UNRESOLVED);
});

test("keeps direct-CWD behavior independent of root preflight state", () => {
  const scope = validateWorkspaceMatchTopology(memberTopology());
  const qualification = qualifyWorkspaceSession({
    cwd: "/repo/extensions/assistant/src",
    pathFacts: [],
    truncated: true,
  }, scope);

  assert.equal(qualification.qualified, true);
  assert.equal(qualification.status, WORKSPACE_QUALIFICATION_STATUS.DIRECT);
  assert.equal(qualification.workspaceMatch, WORKSPACE_SESSION_MATCH.DIRECT_CWD);
  assert.equal(qualification.diagnostics.basis, "cwd");
  assert.equal(qualification.diagnostics.truncated, false);
});

test("qualifies a root-CWD session only from positive target-only path facts", () => {
  const scope = validateWorkspaceMatchTopology(memberTopology());
  const qualification = qualifyWorkspaceSession({
    cwd: "/repo",
    pathFacts: [
      { path: "extensions/assistant/src/a.ts" },
      { filePath: "/repo/extensions/assistant/test/a.test.ts" },
    ],
  }, scope);

  assert.equal(qualification.qualified, true);
  assert.equal(qualification.status, WORKSPACE_QUALIFICATION_STATUS.TARGET_ONLY);
  assert.equal(qualification.workspaceMatch, WORKSPACE_SESSION_MATCH.ROOT_CWD);
  assert.deepEqual(qualification.diagnostics.pathFacts, {
    observed: 2,
    target: 2,
    foreign: 0,
    unresolved: 0,
  });
  const serialized = JSON.stringify(qualification);
  assert.doesNotMatch(serialized, /extensions|assistant|\/repo/u);
});

test("rejects mixed root-CWD activity without exposing the foreign path", () => {
  const scope = validateWorkspaceMatchTopology(memberTopology());
  const qualification = qualifyWorkspaceSession({
    cwd: "/repo",
    pathFacts: [
      "extensions/assistant/src/a.ts",
      "extensions/other/src/b.ts",
      "/outside/private.txt",
    ],
  }, scope);

  assert.equal(qualification.qualified, false);
  assert.equal(qualification.status, WORKSPACE_QUALIFICATION_STATUS.MIXED);
  assert.equal(qualification.workspaceMatch, null);
  assert.deepEqual(qualification.diagnostics.pathFacts, {
    observed: 3,
    target: 1,
    foreign: 2,
    unresolved: 0,
  });
  assert.doesNotMatch(JSON.stringify(qualification), /other|outside|private/u);
});

test("distinguishes no-target, ambiguous, truncated, and unmatched root candidates", () => {
  const scope = validateWorkspaceMatchTopology(memberTopology());
  const noTarget = qualifyWorkspaceSession({ cwd: "/repo", pathFacts: ["extensions/other/a.ts"] }, scope);
  const ambiguous = qualifyWorkspaceSession({
    cwd: "/repo",
    pathFacts: ["extensions/assistant/a.ts", { path: "", cwd: "/repo" }],
  }, scope);
  const truncated = qualifyWorkspaceSession({
    cwd: "/repo",
    pathFacts: ["extensions/assistant/a.ts", "extensions/other/a.ts"],
    truncated: true,
  }, scope);
  const unmatched = qualifyWorkspaceSession({
    cwd: "/repo/extensions/other",
    pathFacts: ["/repo/extensions/assistant/a.ts"],
  }, scope);

  assert.equal(noTarget.status, WORKSPACE_QUALIFICATION_STATUS.NO_TARGET);
  assert.equal(ambiguous.status, WORKSPACE_QUALIFICATION_STATUS.AMBIGUOUS);
  assert.equal(truncated.status, WORKSPACE_QUALIFICATION_STATUS.TRUNCATED);
  assert.equal(unmatched.status, WORKSPACE_QUALIFICATION_STATUS.UNMATCHED_CWD);
  assert.equal([noTarget, ambiguous, truncated, unmatched].every((item) => !item.qualified), true);
});

test("supports Windows paths without relying on the current host platform", () => {
  const scope = validateWorkspaceMatchTopology({
    kind: "better-harness.workspace-topology",
    schemaVersion: 1,
    requestedWorkspace: "C:\\repo\\extensions\\assistant",
    gitRoot: "C:\\repo",
    target: {
      kind: "workspace-member",
      route: "extensions/assistant",
      memberRoute: "extensions/assistant",
      memberMatch: "exact",
    },
  });

  assert.equal(classifyWorkspaceCwd("c:\\REPO", scope), WORKSPACE_CWD_MATCH.ROOT_CANDIDATE);
  assert.equal(
    classifyWorkspacePathFact("extensions\\assistant\\src\\a.ts", scope, { cwd: "C:\\repo" }),
    WORKSPACE_PATH_CLASS.TARGET,
  );
  assert.equal(
    classifyWorkspacePathFact("C:\\repo\\extensions\\assistant-tools\\a.ts", scope),
    WORKSPACE_PATH_CLASS.GIT_OTHER,
  );
});

test("aggregates privacy-safe qualification diagnostics", () => {
  const scope = validateWorkspaceMatchTopology(memberTopology());
  const qualifications = [
    qualifyWorkspaceSession({ cwd: "/repo/extensions/assistant" }, scope),
    qualifyWorkspaceSession({ cwd: "/repo", pathFacts: ["extensions/assistant/a.ts"] }, scope),
    qualifyWorkspaceSession({ cwd: "/repo", pathFacts: ["extensions/other/a.ts"] }, scope),
    qualifyWorkspaceSession({
      cwd: "/repo",
      pathFacts: ["extensions/assistant/a.ts", "extensions/other/a.ts"],
    }, scope),
    qualifyWorkspaceSession({ cwd: "/repo", pathFacts: [{ path: "" }] }, scope),
    qualifyWorkspaceSession({ cwd: "/repo", pathFacts: [], truncated: true }, scope),
    qualifyWorkspaceSession({ cwd: "/repo/extensions/other" }, scope),
  ];
  const summary = summarizeWorkspaceQualifications(qualifications);

  assert.deepEqual(summary, {
    basis: "workspace-match-aggregate",
    sessions: 7,
    qualified: { directCwd: 1, rootCwd: 1 },
    omitted: {
      unmatchedCwd: 1,
      noTargetActivity: 1,
      mixedActivity: 1,
      ambiguousActivity: 1,
      truncatedPreflight: 1,
    },
  });
  assert.doesNotMatch(JSON.stringify(summary), /repo|extensions|assistant/u);
});
