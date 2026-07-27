import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  enrichFindingWithRecommendation,
  findingsRecommendCatalog,
  lookupFindingRecommendation,
} from "../scripts/findings-recommend.mjs";

const REQUIRED_AGENT_LINT_IDS = [
  "no-agent-entrypoint",
  "no-canonical-agents-md",
  "multi-entrypoint-review",
  "root-length-hard-cap",
  "root-length-overloaded",
  "root-length-borderline",
  "root-length-acceptable",
  "missing-local-reference",
  "long-root-without-progressive-references",
  "missing-verification-command",
  "missing-risk-controls",
  "missing-project-facts",
  "missing-decision-rules",
].map((id) => `agent-lint.agents-md-review.${id}`);

const REQUIRED_REVIEW_TRIGGER_IDS = [
  "review-trigger.change-test-evidence.large-change-without-tests",
  "review-trigger.change-test-evidence.missing-mapped-tests",
];

function assertLocalizedField(entry, field) {
  assert.equal(typeof entry[field], "object", `${field} should be localized`);
  assert.equal(typeof entry[field]["zh-CN"], "string", `${field}.zh-CN should be present`);
  assert.equal(typeof entry[field].en, "string", `${field}.en should be present`);
  const minLength = ["aiFixLabel", "title"].includes(field) ? 2 : 8;
  assert.ok(entry[field]["zh-CN"].length >= minLength, `${field}.zh-CN should be user-friendly`);
  assert.ok(entry[field].en.length >= minLength, `${field}.en should be user-friendly`);
}

function assertPlainLanguageZhTitle(id, title) {
  assert.match(title, /^[\u4e00-\u9fff]+$/u, `${id} title should be Chinese-only for compact cards`);
  assert.ok(title.length >= 12 && title.length <= 22, `${id} title should be 12-22 Chinese characters`);
  assert.doesNotMatch(title, /^(缺少|检测到|失败|未更新)/u, `${id} title should avoid scanner-style wording`);
}

test("findings recommendations use a map catalog with user-friendly localized fields", async () => {
  const raw = JSON.parse(await readFile(path.resolve("scripts/findings-recommend/findings-recommend.json"), "utf8"));
  const catalog = findingsRecommendCatalog();
  const requiredIds = [...REQUIRED_AGENT_LINT_IDS, ...REQUIRED_REVIEW_TRIGGER_IDS];

  assert.deepEqual(Object.keys(raw).sort(), ["findings", "summary"]);
  assert.deepEqual(raw, catalog);
  assert.equal(catalog.summary.kind, "better-harness.findings-recommend");
  assert.equal(catalog.summary.schemaVersion, 1);
  assert.equal(Array.isArray(catalog.findings), false);
  assert.equal(typeof catalog.findings, "object");

  for (const id of requiredIds) {
    assert.ok(catalog.findings[id], `catalog should include ${id}`);
  }

  for (const [id, entry] of Object.entries(catalog.findings)) {
    assert.equal(id.trim(), id);
    assert.equal(typeof entry.source, "string", `${id} should declare source`);
    assert.equal(typeof entry.category, "string", `${id} should declare category`);
    assert.equal(typeof entry.domain, "string", `${id} should declare domain`);
    for (const field of ["title", "why", "recommendation", "passCheck", "aiFixLabel"]) {
      assertLocalizedField(entry, field);
    }
    assertPlainLanguageZhTitle(id, entry.title["zh-CN"]);
    assert.equal("suggestion" in entry, false, `${id} should use recommendation, not suggestion`);
  }
});

test("findings recommendation lookup resolves canonical ids and aliases", () => {
  assert.equal(
    lookupFindingRecommendation("missing-local-reference").id,
    "agent-lint.agents-md-review.missing-local-reference",
  );
  assert.equal(
    lookupFindingRecommendation("agent-instructions.missing-local-reference").id,
    "agent-lint.agents-md-review.missing-local-reference",
  );
  assert.equal(
    lookupFindingRecommendation("change-test-evidence.large-change-without-tests").id,
    "review-trigger.change-test-evidence.large-change-without-tests",
  );
  assert.equal(lookupFindingRecommendation("unknown.finding.id"), null);
});

test("finding recommendation enrichment preserves evidence and adds localized action fields", () => {
  const enriched = enrichFindingWithRecommendation({
    id: "missing-verification-command",
    severity: "warning",
    evidence: "package.json has scripts, but AGENTS.md has no command.",
    remediation: "Add test commands.",
  });

  assert.equal(enriched.evidence, "package.json has scripts, but AGENTS.md has no command.");
  assert.equal(enriched.remediation, "Add test commands.");
  assert.deepEqual(enriched.recommendationId, "agent-lint.agents-md-review.missing-verification-command");
  assert.deepEqual(enriched.title, {
    "zh-CN": "验证路径不清会削弱收尾质量",
    en: "Verification command is missing",
  });
  assert.match(enriched.why["zh-CN"], /最小验证路径/);
  assert.match(enriched.recommendation.en, /build\/test\/lint\/typecheck/);
  assert.match(enriched.passCheck["zh-CN"], /至少一个可执行验证命令/);
  assert.deepEqual(enriched.aiFixLabel, {
    "zh-CN": "补充验证命令",
    en: "Add validation command",
  });
  assert.deepEqual(enriched.suggestion, {
    en: enriched.recommendation.en,
    zh: enriched.recommendation["zh-CN"],
    "zh-CN": enriched.recommendation["zh-CN"],
  });
});
