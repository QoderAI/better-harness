import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function read(domain, name) {
  return readFileSync(
    path.join(ROOT, "references", domain, name),
    "utf8",
  );
}

function assertAfter(content, later, earlier, message) {
  const earlierIndex = content.indexOf(earlier);
  const laterIndex = content.indexOf(later);
  assert.ok(earlierIndex >= 0, `${message}: missing ${earlier}`);
  assert.ok(laterIndex > earlierIndex, `${message}: ${later} must follow ${earlier}`);
}

test("agent-customize routing keeps shared evidence before platform asset routes", () => {
  const content = read("agent-customize", "routing.md");
  assertAfter(content, "## Platform Notes", "## Evidence Rules", "routing");
  assertAfter(content, "asset-integrity <provider>", "## Platform Notes", "routing");
  assertAfter(content, "## Qoder Asset Route", "## Platform Notes", "routing");
  assertAfter(content, "## Codex Asset Route", "## Platform Notes", "routing");
});

test("Skill Discovery keeps shared coverage rules before native platform details", () => {
  const content = read("agent-customize", "skill-discovery.md");
  assertAfter(content, "## Platform Notes", "## Quality Bar", "Skill Discovery");
  assertAfter(content, "Try Qoder built-in", "## Platform Notes", "Skill Discovery");
  assertAfter(content, "`inferredSkillReads` only as a Skill file", "## Platform Notes", "Skill Discovery");
  assert.ok(content.indexOf("Try platform built-in") < content.indexOf("## Platform Notes"));
});

test("session diagnostics keeps the shared workflow before platform source roots", () => {
  const content = read("session-evidence", "sessions-diagnostics.md");
  assertAfter(content, "## Platform Notes", "## Output Rules", "Sessions Diagnostics");
  assertAfter(content, "~/.qoder/projects", "## Platform Notes", "Sessions Diagnostics");
  assertAfter(content, "~/.codex/audit-logs", "## Platform Notes", "Sessions Diagnostics");
  assertAfter(content, "~/.claude/projects", "## Platform Notes", "Sessions Diagnostics");
  assertAfter(content, "~/.cursor/projects", "## Platform Notes", "Sessions Diagnostics");
  assertAfter(content, "~/.qwen/projects", "## Platform Notes", "Sessions Diagnostics");
  assert.match(content, /Supported platforms: `qoder`, `codex`, `claude`, `cursor`, and `qwen`/);
  assert.match(content, /Never decode Cursor `store\.db`/);
  assert.ok(content.indexOf("session-analysis.mjs sources") < content.indexOf("## Platform Notes"));
});

test("MCP review keeps shared remediation before Qoder precedence", () => {
  const content = read("agent-customize", "mcp-review.md");
  assertAfter(content, "## Platform Notes", "## Remediation Order", "MCP Review");
  assertAfter(content, "QODER_HOME", "## Platform Notes", "MCP Review");
  assert.ok(
    content.indexOf("selected platform's supported configuration operations") <
      content.indexOf("## Platform Notes"),
  );
});
