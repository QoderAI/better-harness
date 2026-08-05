import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePlanTarget,
  resolveStatusTarget,
} from "../scripts/plugin-lifecycle/target-resolution.mjs";

function rejectsWith(code, message, hint) {
  return (error) => {
    assert.equal(error.code, code);
    assert.equal(error.kind, "usage");
    if (message) assert.equal(error.message, message);
    if (hint) assert.equal(error.hint, hint);
    return true;
  };
}

test("status target resolution owns all-host, alias, surface, and home routing", () => {
  assert.equal(resolveStatusTarget().profiles.length, 8);

  const aliased = resolveStatusTarget({ host: "qwen-code", surface: "cli" });
  assert.equal(aliased.profiles[0].hostId, "qwen");
  assert.equal(aliased.surface.surfaceId, "cli");

  assert.throws(
    () => resolveStatusTarget({ host: "all", surface: "cli" }),
    rejectsWith("AMBIGUOUS_SURFACE", "--surface requires one explicit host."),
  );
  assert.throws(
    () => resolveStatusTarget({ host: "all", hostHome: "/isolated/home" }),
    rejectsWith("AMBIGUOUS_HOST_HOME", "--host-home requires one explicit host."),
  );
  assert.throws(
    () => resolveStatusTarget({ host: "missing" }),
    rejectsWith(
      "UNKNOWN_HOST",
      "Unknown host: missing",
      "Use one of: claude, codex, qoder, cursor, qwen, copilot, pi, workbuddy, or all.",
    ),
  );
  // Catalog hosts without a validated lifecycle contract stay unknown here
  // instead of borrowing another host's install route.
  for (const host of ["kimi", "grok"]) {
    assert.throws(
      () => resolveStatusTarget({ host }),
      rejectsWith("UNKNOWN_HOST", `Unknown host: ${host}`),
    );
  }
});

test("plan target resolution owns explicit host and multi-surface requirements", () => {
  for (const host of [undefined, "all", "auto"]) {
    assert.throws(
      () => resolvePlanTarget({ host }),
      rejectsWith("EXPLICIT_HOST_REQUIRED", "Plugin plans require one explicit host."),
    );
  }

  assert.throws(
    () => resolvePlanTarget({ host: "codex" }),
    rejectsWith(
      "AMBIGUOUS_HOST_SURFACE",
      "Codex has multiple lifecycle surfaces.",
      "Use --surface cli or --surface desktop.",
    ),
  );
  assert.throws(
    () => resolvePlanTarget({ host: "pi" }),
    rejectsWith(
      "AMBIGUOUS_HOST_SURFACE",
      "Pi has multiple lifecycle surfaces.",
      "Use --surface cli or --surface cli-session.",
    ),
  );
  assert.throws(
    () => resolvePlanTarget({ host: "claude", surface: "desktop" }),
    rejectsWith("UNKNOWN_HOST_SURFACE", "Unknown surface for Claude Code: desktop"),
  );
});

test("plan target resolution validates scope after alias and surface resolution", () => {
  const target = resolvePlanTarget({
    host: "qwen-code",
    surface: "cli",
    scope: "project",
  });
  assert.equal(target.profile.hostId, "qwen");
  assert.equal(target.surface.surfaceId, "cli");
  assert.equal(target.scope, "project");

  assert.throws(
    () => resolvePlanTarget({ host: "codex", surface: "desktop", scope: "project" }),
    rejectsWith(
      "UNSUPPORTED_SCOPE",
      "Codex/desktop does not support scope project.",
      "Use one of: user.",
    ),
  );
});
