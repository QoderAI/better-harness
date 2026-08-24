import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "vitest";
import { fileURLToPath } from "node:url";

import {
  usageReportTemplate,
  validateUsageReport,
} from "../../scripts/session-analysis/validate-usage-report.mjs";
import { applyUsageSemanticReview, summarizeModelFit } from "../../scripts/session-analysis/usage-semantic-review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VALIDATOR = path.join(ROOT, "scripts/session-analysis/validate-usage-report.mjs");

function source(overrides = {}) {
  return {
    scope: { workspace: "/workspace/ide-client" },
    selection: { eligibleCount: 266, analyzedCount: 266 },
    insights: {
      keySignals: {
        usageEfficiency: {
          accountingMode: "effort-proxy",
          coverage: { analyzedSessionCount: 266, responseCount: 140, nonZeroUsageCount: 0 },
          longSessions: { longActiveCount: 10, wallOnlyCount: 4 },
          candidates: [{ candidateReasons: ["active-long"] }],
          outcomeReview: { comparableModelOutcomeEvidence: false, reviewedActiveLongCount: 1 },
          ...overrides,
        },
      },
    },
  };
}

function validReport() {
  return `# Qoder 会话使用效率报告

项目：ide-client
范围：workspace-only

## 结论

重复活跃长会话值得优先做任务边界复核。

## 覆盖与计费口径

- 分析会话：266/266
- 活跃长会话：10
- 仅墙钟长会话：4
- 语义复核长会话：1/10
- 计费口径：effort-proxy
- 模型响应：140
- 非零 usage：0/140
- 当前无法精确计算 token/credits，只报告活跃分钟和模型请求代理。
- 未复核长会话不推断任务族或结果。

## 关键问题

### P1：长会话集中

范围：已复核的活跃长会话
置信度：Medium
证据：S1 显示同类任务存在多次活跃执行。
影响：任务边界过大会增加重试和上下文恢复成本。
行动：建议拆小目标，并对同类任务执行受控模型 A/B。
节省口径：effort-proxy

## 长会话

墙钟跨度与活跃时间分开；仅墙钟会话不作为浪费证据。

## 模型与结果

目前没有可比结果样本，不归因于模型。

## 证据边界

候选会话只用 S1、S2 等临时别名，语义结论需人工复核。
`;
}

function validEnglishReport() {
  return `# Qoder Session Usage Efficiency Report

Project: ide-client
Scope: workspace-only

## Conclusion

Repeated active-long sessions deserve a focused task boundary review.

## Coverage and Accounting

- Analyzed sessions: 266/266
- Active long sessions: 10
- Wall-only long sessions: 4
- Reviewed active-long sessions: 1/10
- Accounting mode: effort-proxy
- Model responses: 140
- Non-zero usage: 0/140
- Exact token and credit counts are unavailable, so this report uses active minutes and model requests as effort proxies.
- Unreviewed long sessions do not support task family or outcome claims.

## Key Problems

### P1: Concentrated long sessions

Scope: Reviewed active-long sessions
Confidence: Medium
Evidence: S1 shows repeated active work in the same task family.
Impact: Oversized task boundaries increase retries and context recovery.
Action: Split the goal and run a controlled model A/B on comparable tasks.
Savings basis: effort-proxy

## Long Sessions

Wall span and active time remain separate; wall-only sessions are not waste evidence.

## Models and Outcomes

No comparable outcome samples exist, so this report does not attribute outcomes to a model.

## Evidence Boundary

Candidate sessions use temporary aliases such as S1 and S2; semantic conclusions require review.
`;
}

test("usage report validator emits English and Chinese templates only on request", () => {
  const template = usageReportTemplate("zh-CN");
  const englishTemplate = usageReportTemplate("en-US");
  assert.match(template, /^# Qoder 会话使用效率报告/mu);
  assert.match(template, /^## 覆盖与计费口径$/mu);
  assert.match(template, /^分析会话：<analyzed>\/<eligible>$/mu);
  assert.match(template, /^候选模型：<model>$/mu);
  assert.match(englishTemplate, /^# Qoder Session Usage Efficiency Report/mu);
  assert.match(englishTemplate, /^## Coverage and Accounting$/mu);
  assert.match(englishTemplate, /^Analyzed sessions: <analyzed>\/<eligible>$/mu);
  assert.match(englishTemplate, /^Candidate model: <model>$/mu);
  assert.throws(() => usageReportTemplate("fr"), /expected en or zh-CN/);
  assert.throws(() => usageReportTemplate("zh-TW"), /expected en or zh-CN/);

  const result = spawnSync(process.execPath, [VALIDATOR, "--print-template", "zh-CN"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, template);

  const englishResult = spawnSync(process.execPath, [VALIDATOR, "--print-template", "en"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(englishResult.status, 0, englishResult.stderr);
  assert.equal(englishResult.stdout, englishTemplate);
});

test("usage report validator accepts an honest effort-proxy report", () => {
  assert.deepEqual(validateUsageReport({ source: source(), report: validReport() }), []);
  const naturalChinese = validReport().replace(
    "当前无法精确计算 token/credits，只报告活跃分钟和模型请求代理。",
    "确切 token 数不可用，信用额度也不可得，只报告活跃分钟和模型请求代理。",
  );
  assert.deepEqual(validateUsageReport({ source: source(), report: naturalChinese }), []);
  assert.deepEqual(validateUsageReport({ source: source(), report: validEnglishReport() }), []);
});

test("usage report validator rejects unresolved and inapplicable template rows", () => {
  const unresolved = validReport().replace(
    "- 非零 usage：0/140",
    "- 非零 usage：0/140\n- 实际成本：<amount> <currency>\n- 价格版本：<version>",
  );
  const errors = validateUsageReport({ source: source(), report: unresolved });
  assert.ok(errors.some((error) => error.includes("template placeholder: <amount>")));
  assert.ok(errors.some((error) => error.includes("non-exact accounting must remove")));

  const concreteButInapplicable = unresolved
    .replace("<amount> <currency>", "1.25 USD")
    .replace("<version>", "reviewed-2026-07");
  assert.ok(validateUsageReport({ source: source(), report: concreteButInapplicable })
    .some((error) => error.includes("non-exact accounting must remove")));
});

test("usage report validator rejects unsupported savings, model causation, and private ids", () => {
  const report = validReport()
    .replace("当前无法精确计算 token/credits，只报告活跃分钟和模型请求代理。", "预计节省 120000 tokens。")
    .replace("建议拆小目标，并对同类任务执行受控模型 A/B。", "建议直接更换模型。")
    .replace("目前没有可比结果样本，不归因于模型。", "因为使用 performance 模型导致任务失败。")
    .replace("候选会话只用 S1、S2 等临时别名", "候选会话 task-abc123 位于 /Users/example/session.jsonl");
  const errors = validateUsageReport({ source: source(), report });
  assert.ok(errors.some((error) => error.includes("exact token")));
  assert.ok(errors.some((error) => error.includes("controlled model A/B")));
  assert.ok(errors.some((error) => error.includes("model causation")));
  assert.ok(errors.some((error) => error.includes("absolute user paths")));

  const english = validEnglishReport()
    .replace("Exact token and credit counts are unavailable", "This setup could save 120000 tokens")
    .replace("run a controlled model A/B", "switch models immediately")
    .replace(
      "No comparable outcome samples exist, so this report does not attribute outcomes to a model.",
      "The model caused the task to fail.",
    );
  const englishErrors = validateUsageReport({ source: source(), report: english });
  assert.ok(englishErrors.some((error) => error.includes("exact token")));
  assert.ok(englishErrors.some((error) => error.includes("controlled model A/B")));
  assert.ok(englishErrors.some((error) => error.includes("model causation")));
});

test("usage report validator accepts negated model causation and rejects candidate labels without comparison", () => {
  const negated = validReport().replace(
    "目前没有可比结果样本，不归因于模型。",
    "目前无法判断模型选择是否影响结果，任何模型更弱导致失败的推断都缺乏依据。",
  );
  assert.deepEqual(validateUsageReport({ source: source(), report: negated }), []);
  const candidate = negated.replace("## 模型与结果", "## 模型与结果\n\n候选模型：performance");
  assert.ok(validateUsageReport({ source: source(), report: candidate }).some((error) => error.includes("must not name a candidate model")));
});

test("usage report validator requires exact source markers", () => {
  const report = validReport().replace("活跃长会话：10", "活跃长会话：9");
  const errors = validateUsageReport({ source: source(), report });
  assert.ok(errors.some((error) => error.includes("活跃长会话：10")));
});

test("usage report validator accepts exact actual cost and rejects incomplete problem fields", () => {
  const exactSource = source({
    accountingMode: "exact",
    actualCost: { available: true, amount: 1.25, currency: "USD", pricingVersion: "reviewed-2026-07" },
    coverage: { analyzedSessionCount: 266, responseCount: 140, nonZeroUsageCount: 140, exactCreditsAvailable: true },
  });
  exactSource.insights.keySignals.usageEfficiency.actualCost = exactSource.insights.keySignals.usageEfficiency.actualCost;
  const report = validReport()
    .replace("计费口径：effort-proxy", "计费口径：exact\n- 实际成本：1.25 USD\n- 价格版本：reviewed-2026-07")
    .replace("非零 usage：0/140", "非零 usage：140/140")
    .replace("当前无法精确计算 token/credits，只报告活跃分钟和模型请求代理。", "精确计费来自版本化价格表与完整 usage。")
    .replace("节省口径：effort-proxy", "节省口径：exact-actual-cost-only");
  assert.deepEqual(validateUsageReport({ source: exactSource, report }), []);

  const englishReport = validEnglishReport()
    .replace("Accounting mode: effort-proxy", "Accounting mode: exact\n- Actual cost: 1.25 USD\n- Pricing version: reviewed-2026-07")
    .replace("Non-zero usage: 0/140", "Non-zero usage: 140/140")
    .replace(
      "Exact token and credit counts are unavailable, so this report uses active minutes and model requests as effort proxies.",
      "Exact accounting uses complete usage and the reviewed pricing table.",
    )
    .replace("Savings basis: effort-proxy", "Savings basis: exact-actual-cost-only");
  assert.deepEqual(validateUsageReport({ source: exactSource, report: englishReport }), []);

  const incomplete = report.replace("影响：任务边界过大会增加重试和上下文恢复成本。\n", "");
  assert.ok(validateUsageReport({ source: exactSource, report: incomplete }).some((error) => error.includes("影响：")));
});

test("usage report validator accepts an English candidate model only with comparable evidence", () => {
  const candidateSource = source({
    outcomeReview: {
      comparableModelOutcomeEvidence: true,
      reviewedActiveLongCount: 10,
      comparisons: [{ candidateModel: "performance" }],
    },
  });
  const report = validEnglishReport()
    .replace("Reviewed active-long sessions: 1/10", "Reviewed active-long sessions: 10/10")
    .replace("- Unreviewed long sessions do not support task family or outcome claims.\n", "")
    .replace(
      "No comparable outcome samples exist, so this report does not attribute outcomes to a model.",
      "Comparable reviewed outcomes support this recommendation.\n\nCandidate model: performance",
    );
  assert.deepEqual(validateUsageReport({ source: candidateSource, report }), []);
});

test("structured semantic review recommends a candidate model only for comparable task families", () => {
  const candidates = [
    ["S1", "performance", 30, "fully-achieved"],
    ["S2", "performance", 35, "mostly-achieved"],
    ["S3", "ultimate", 60, "partially-achieved"],
    ["S4", "ultimate", 70, "not-achieved"],
  ];
  const packet = { candidates: candidates.map(([alias, model, activeMinutes], index) => ({
    alias,
    sessionRef: `qsr1-${String(index + 1).repeat(24)}`,
    activeMinutes,
    responseCount: 2,
    modelUsage: [{ model }],
    candidateReasons: ["active-long"],
  })) };
  const review = {
    schemaVersion: 1,
    reviews: candidates.map(([alias, _model, _minutes, outcome]) => ({
      alias,
      taskFamily: "debugging",
      outcome,
      friction: "none-observed",
      confidence: "Medium",
      evidenceReason: `Reviewed outcome evidence for ${alias}.`,
    })),
  };
  const summary = summarizeModelFit({ packet, review });
  assert.equal(summary.status, "candidate-model-fit");
  assert.equal(summary.comparisons[0].candidateModel, "performance");
  assert.equal(summary.reviewedSessionRefs.length, 4);
  assert.equal(summary.reviewedActiveLongSessionRefs.length, 4);

  const sparse = summarizeModelFit({ packet, review: { ...review, reviews: review.reviews.slice(0, 2) } });
  assert.equal(sparse.status, "controlled-a-b-required");
  const applied = applyUsageSemanticReview({ source: source(), packet, review });
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.source.insights.keySignals.usageEfficiency.outcomeReview.comparableModelOutcomeEvidence, true);
  assert.equal(applied.source.insights.keySignals.usageEfficiency.outcomeReview.reviewedActiveLongCount, 4);
  assert.equal(applied.source.insights.keySignals.usageEfficiency.outcomeReview.reviewedActiveLongSessionRefs.length, 4);
});
