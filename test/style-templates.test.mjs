import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const HARNESS_REPORT_DIR = "templates/reporting";
const HARNESS_OUTPUT_MODE_DIR = HARNESS_REPORT_DIR;

const STYLE_FILES = [
  "analyst.md",
  "audit-scorecard.md",
  "consulting-deck.md",
  "editorial-insight.md",
  "engineering-diagnosis.md",
  "executive-dashboard.md",
  "transformation-playbook.md",
];

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("style files stay declarative and output-mode neutral", () => {
  const styleDir = path.join(ROOT, "templates/style");
  const styleFiles = readdirSync(styleDir)
    .filter((file) => file.endsWith(".md") && file !== "routing.md")
    .sort();
  const runtimeOrSdkTerms =
    /Qoder Canvas|qoder\/canvas|@ali|canvas-sdk|\.\.\/canvas-sdk|available Qoder Canvas primitives|Primary Qoder Canvas family|Supporting Qoder Canvas blocks/;
  const sdkExportNames =
    /`(?:Canvas|Section|Heading|Badge|Fluency|CapabilityHexMap|MaturityMatrix|ImprovementKataCard|RiskHeatmap|MetricsGrid|ReferencePanel|Timeline|AreaChart|BarChart|LineChart|PieChart|RadarChart|RadialBarChart|MultiplierBubbleChart|PriorityQuadrantChart|DocsSection|SendToChatButton|sendToChat|Table)`/;

  assert.deepEqual(styleFiles, STYLE_FILES);

  for (const file of styleFiles) {
    const text = read(`templates/style/${file}`);
    assert.match(text, /\n## Visualization Style\n/, `${file} must define Visualization Style`);
    assert.doesNotMatch(text, runtimeOrSdkTerms, `${file} must not own runtime or SDK rules`);
    assert.doesNotMatch(text, sdkExportNames, `${file} must not hard-code SDK exports`);
    assert.doesNotMatch(text, /```(?:tsx|jsx|html)/, `${file} must not include runnable UI examples`);
  }
});

test("readiness report template keeps markdown structure runtime-neutral", () => {
  const readinessReport = read(`${HARNESS_REPORT_DIR}/report-structure.md`);

  assert.ok(readinessReport.split("\n").length <= 80, "report-structure.md should stay compact");
  assert.match(readinessReport, /Markdown Body Skeleton/);
  assert.match(readinessReport, /Project Overview/);
  assert.match(readinessReport, /Harness Dimensions/);
  assert.match(readinessReport, /Issue Findings/);
  assert.match(readinessReport, /Next Recommendations/);
  assert.match(readinessReport, /Notes And Method/);
  assert.match(readinessReport, /Loop Engineering follow-ups/);
  assert.match(readinessReport, /New reports do not author `summary\.suggestions`/);
  assert.match(readinessReport, /ordinary `Low` finding/);
  assert.match(readinessReport, /selected\s+pattern or composition, owner, why the loop matters, expected artifact,\s+validation path, and stop condition or missing proof/);
  assert.doesNotMatch(readinessReport, /Findings-backed Canvas companion output|Legacy Qoder Canvas data output|HTML visual output|Markdown-only output/);
  assert.doesNotMatch(readinessReport, /chart\.canvas\.tsx|report\.canvas\.tsx|insights\.canvas|report\.html|qoder\/canvas/);
  assert.doesNotMatch(readinessReport, /templates\/common\/i18n|readiness-report-labels\.json|readiness-report\.zh-CN/);
});

test("harness report routing owns output-mode selection and exclusions", () => {
  const reportRouting = read("templates/reporting/routing.md");
  const projectTraits = read("templates/reporting/project-traits.md");

  assert.ok(reportRouting.split("\n").length <= 70, "reporting/routing.md should stay compact");
  assert.match(reportRouting, /## Core Contract/);
  assert.match(reportRouting, /## Reference Route/);
  assert.match(reportRouting, /## Output Route/);
  assert.match(reportRouting, /Project trait -> `project-traits\.md`/);
  assert.match(projectTraits, /## Axis Definitions/);
  assert.match(projectTraits, /## Output Shape/);
  assert.match(reportRouting, /Choose exactly one output route/);
  assert.match(reportRouting, /Qoder Canvas report/);
  assert.match(reportRouting, /Cursor Canvas report/);
  assert.match(reportRouting, /Portable HTML report/);
  assert.match(
    reportRouting,
    /Active host is Claude Code, Codex, Qwen Code, GitHub Copilot, Pi, or WorkBuddy, or a portable visual is explicitly requested \|/,
  );
  assert.match(reportRouting, /Markdown only/);
  assert.match(reportRouting, /Inline only/);
  assert.match(reportRouting, /inline analysis writes nothing/);
  assert.match(reportRouting, /renderer-owned `findings\.json`[\s\S]*`report\.canvas\.tsx`/);
  assert.doesNotMatch(reportRouting, /`chart\.canvas\.tsx`/);
  assert.match(reportRouting, /`report\.md`[\s\S]*`report\.html`/);
  assert.match(reportRouting, /`qoder-canvas\.md`/);
  assert.match(reportRouting, /`html-visual\.md`/);
  assert.match(reportRouting, /omit metadata lines, companion sections, and\s+files from other routes/);
  assert.doesNotMatch(reportRouting, /visual mode|selected visual template|template-routing\.md/i);
});

test("Qoder Canvas template keeps runtime, data, and action contracts", () => {
  const qoderCanvas = read(`${HARNESS_OUTPUT_MODE_DIR}/qoder-canvas.md`);

  assert.ok(qoderCanvas.split("\n").length <= 90, "qoder-canvas.md should stay scan-friendly");
  assert.match(qoderCanvas, /Qoder Canvas Output/);
  assert.match(qoderCanvas, /`\/better-harness` always uses Agent Work Loop/);
  assert.match(qoderCanvas, /visible artifact bundle is `findings\.json`, `canvas\.json`, and\s+`report\.canvas\.tsx`/);
  assert.match(qoderCanvas, /imports only `qoder\/canvas`,\s+`\.\/findings\.json`, and `\.\/canvas\.json`/);
  assert.match(qoderCanvas, /do not add helper modules, network\s+access/);
  assert.match(qoderCanvas, /Agent Work Loop renders\s+one compact SDK `Fluency` visual/);
  assert.match(qoderCanvas, /uses each row's `summary` as the only hover content/);
  assert.match(qoderCanvas, /do not repeat the dimension category or score/);
  assert.match(qoderCanvas, /must not average them\s+or synthesize another score, percentage, maturity level, radar, progress bar, or evidence-state count chart/);
  assert.match(qoderCanvas, /equal-height responsive Grid/);
  assert.match(qoderCanvas, /shared 190 px body height/);
  assert.match(qoderCanvas, /53-week,\s+365-day SDK/);
  assert.match(qoderCanvas, /square cells and date\/minutes hover labels/);
  assert.match(qoderCanvas, /cap the Grid at three columns/);
  assert.match(qoderCanvas, /at least 300 px/);
  assert.match(qoderCanvas, /`RiskHeatmap`/);
  assert.match(qoderCanvas, /`AreaChart`/);
  assert.doesNotMatch(qoderCanvas, /`LineChart`/);
  assert.doesNotMatch(qoderCanvas, /`BarChart`/);
  assert.doesNotMatch(qoderCanvas, /Project usage\s+heading tooltip/);
  assert.match(qoderCanvas, /plain Project usage heading/);
  assert.match(qoderCanvas, /show usage as unavailable, never `0\/0`/);
  assert.match(qoderCanvas, /Keep only the chart in the activity layer/);
  assert.match(qoderCanvas, /report header contains no IDE-only Better Harness jump/);
  assert.match(qoderCanvas, /Agent Customize uses one compact SDK `Table`/);
  assert.match(qoderCanvas, /activity frequency a user preference, model quality, or cost/);
  assert.match(qoderCanvas, /top five labels plus `Other`/);
  assert.match(qoderCanvas, /do not\s+repeat checks, refs, confidence, or evidence bridges as a chart/);
  assert.doesNotMatch(qoderCanvas, /categories \+ series/);
  assert.doesNotMatch(qoderCanvas, /`columns \+ rows`|`headers \+ rows`/);
  assert.doesNotMatch(qoderCanvas, /`MetricItem` as a\s+`MetricsGrid` item type/);
  assert.match(qoderCanvas, /Bind\s+`SendToChatButton\.text` to\s+`row\.aiFixPrompt`/);
  assert.match(qoderCanvas, /skills\/better-harness\/SKILL\.md#report-output/);
  assert.doesNotMatch(qoderCanvas, /target=\.\.\.|finding=\.\.\.|validation=\.\.\./);

  assert.doesNotMatch(qoderCanvas, /canvas-chat-handoffs\.md/);
  assert.doesNotMatch(qoderCanvas, /\p{Script=Han}/u);
  assert.doesNotMatch(qoderCanvas, /text=\{row\.prompt\}/);
  assert.doesNotMatch(qoderCanvas, /Action Pathways rows into visual data arrays exactly/);
  assert.doesNotMatch(qoderCanvas, /Qoder Canvas Example|```tsx/);
  assert.doesNotMatch(qoderCanvas, /Stat\/MetricItem/);
  assert.doesNotMatch(qoderCanvas, /Issue\s+Distribution|issue\s+distribution/);
});

test("harness output-mode templates stay English-only", () => {
  const outputModeDir = path.join(ROOT, HARNESS_OUTPUT_MODE_DIR);
  const outputModeFiles = readdirSync(outputModeDir)
    .filter((file) => ["html-visual.md", "qoder-canvas.md"].includes(file))
    .sort();

  assert.deepEqual(outputModeFiles, ["html-visual.md", "qoder-canvas.md"]);

  for (const file of outputModeFiles) {
    const text = read(`${HARNESS_OUTPUT_MODE_DIR}/${file}`);
    assert.doesNotMatch(text, /\p{Script=Han}/u, `${file} must not contain Chinese text`);
  }
});

test("HTML mode and style routing keep Canvas details out of reader output", () => {
  const skill = read("skills/better-harness/SKILL.md");
  const reportRouting = read("templates/reporting/routing.md");
  const styleRouting = read("templates/style/routing.md");
  const htmlVisual = read(`${HARNESS_OUTPUT_MODE_DIR}/html-visual.md`);
  const qoderCanvas = read(`${HARNESS_OUTPUT_MODE_DIR}/qoder-canvas.md`);
  const reportOutput = read("skills/better-harness/SKILL.md");

  assert.ok(styleRouting.split("\n").length <= 60, "style/routing.md should stay compact");
  assert.ok(htmlVisual.split("\n").length <= 105, "html-visual.md should stay compact");
  assert.match(skill, /## Report Output/);
  assert.doesNotMatch(skill, /references\/report-output\.md/);
  assert.match(reportOutput, /templates\/reporting\/routing\.md/);
  assert.doesNotMatch(skill, /references\/template-routing\.md/);
  assert.doesNotMatch(skill, /templates\/output-modes\/html-visual\.md/);
  assert.match(reportRouting, /`qoder-canvas\.md`/);
  assert.match(reportRouting, /`html-visual\.md`/);
  assert.match(styleRouting, /templates\/reporting\/routing\.md` owns\s+output-mode selection and mutual exclusions/);
  assert.doesNotMatch(styleRouting, /readiness-report\.md` owns output-mode selection/);
  assert.doesNotMatch(styleRouting, /## Visualization Mode Contract|Findings-backed Canvas report|Legacy Qoder Canvas data|Markdown-only/);
  assert.doesNotMatch([reportRouting, styleRouting].join("\n"), /better-harness|Better Harness|default for Qoder/);
  assert.match(styleRouting, /## Internal Style Labels/);
  assert.match(htmlVisual, /Keep the selected style id and\s+localized label out of visible Markdown/);
  assert.match(htmlVisual, /prefer an inline SVG\/CSS chart or matrix for the\s+style-selected framing part/);
  assert.match(htmlVisual, /instead of a standalone aggregate section/);
  assert.match(htmlVisual, /Tables and cards remain acceptable fallback\s+surfaces/);
  assert.doesNotMatch(reportOutput, new RegExp(["label", "Zh"].join("")));
  assert.doesNotMatch(
    [reportRouting, htmlVisual].join("\n"),
    /\p{Script=Han}/u,
    "reader report routing and HTML output-mode templates should not contain Chinese text",
  );

  assert.doesNotMatch(htmlVisual, /Qoder|Canvas|qoder\/canvas|report\.canvas\.tsx/);
  assert.doesNotMatch(
    [styleRouting, qoderCanvas, htmlVisual, reportOutput].join("\n"),
    /health-check\.md|Project Health|项目健康度/,
  );
});
