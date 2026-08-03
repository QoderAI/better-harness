import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertExistingFile(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  assert.ok(existsSync(filePath), `${relativePath} must exist`);
  assert.ok(statSync(filePath).size > 0, `${relativePath} must not be empty`);
}

function assertReferencedPathExists(ownerPath, referencedPath) {
  const resolvedPath = path.resolve(path.dirname(path.join(ROOT, ownerPath)), referencedPath);
  assert.ok(existsSync(resolvedPath), `${ownerPath} reference ${referencedPath} must resolve`);
}

test("Better Harness keeps one compact five-step owner", () => {
  const skill = read("skills/better-harness/SKILL.md");
  const description = skill.match(/^description: (.+)$/m)?.[1] ?? "";

  assert.match(skill, /^name: better-harness$/m);
  assert.match(description, /^Use when /);
  assert.match(description, /\/better-harness/);
  assert.match(description, /Invoke only via slash command/);
  for (const keyword of [
    "lifecycle controls",
    "repeated work",
    "project feedback",
    "agent assets",
    "session outcomes",
    "repair planning",
    "durable reports",
    "finding-bound fixes",
    "manual direct fixes",
  ]) assert.match(description, new RegExp(keyword));
  assert.ok(skill.split("\n").length < 220, "root Skill must remain compact");
  assert.ok(Buffer.byteLength(skill) < 12_000, "root Skill must stay below the prompt budget");

  const steps = [
    "## Step 1: Resolve Scope and Collect the Evidence Bundle",
    "## Step 2: Run Three Independent Evidence Passes",
    "## Step 3: Lead Reconciliation and Regrading",
    "## Report Output — Step 4: Render an Authorized Report",
    "## Step 5: Follow Up",
  ];
  let previous = -1;
  for (const heading of steps) {
    const current = skill.indexOf(heading);
    assert.ok(current > previous, `${heading} must appear in order`);
    previous = current;
  }

  assert.match(skill, /scripts\/better-harness\.mjs/);
  assert.match(skill, /previous 7 days; normal uses five and the previous 30 days/);
  assert.match(skill, /Keep providers separate/);
  assert.match(skill, /three fresh, read-only agents in parallel/);
  assert.match(skill, /fork_turns: "none"/);
  assert.match(skill, /hard cap of three delegated agents/);
  assert.match(skill, /harness evidence-bundle[^\n]+--depth <quick\|normal>/);
  assert.match(skill, /bundle maps `--include-user-home` to the analyzer's\s+global-capability boundary/);
  assert.match(skill, /reference-local free-form return contract/);
  assert.match(skill, /three to five candidates/);
  assert.match(skill, /fewer when evidence is\s+sparse/);
  assert.match(skill, /lead alone/);
  assert.match(skill, /Start by retaining every specialist candidate/);
  assert.match(skill, /Never\s+drop an eligible finding to reach five rows/);
  assert.match(skill, /writes every distinct supported finding and freezes final severity/);
  assert.match(skill, /shape at most\s+three priority moves/);
  assert.match(skill, /Repair Progress; Loop Effectiveness waits/);
  assert.match(skill, /separate independent post-fix agent/);
});

test("Qoder and Cursor default to Canvas while portable providers retain durable HTML", () => {
  const skill = read("skills/better-harness/SKILL.md");
  const routing = read("templates/reporting/routing.md");
  const adapters = read("docs/adapters/README.md");
  const readme = read("README.md");

  assert.match(skill, /Default Qoder\/Cursor to durable Canvas; default others to durable HTML/);
  assert.match(skill, /explicit inline or no-files request writes nothing/);
  assert.match(skill, /Other providers: <mode>=html; <host-root>=<target>\/\.<provider>\/better-harness/);
  assert.doesNotMatch(skill, /(?:Claude Code|Codex): <mode>=html/);
  // The per-route artifact inventory is owned by routing.md, not duplicated in the
  // byte-budgeted root Skill.
  assert.match(routing, /renderer-owned `findings\.json`, `canvas\.json`, `report\.canvas\.tsx` \| `cursor-canvas\.md`/);
  assert.match(routing, /renderer-owned `findings\.json`, `report\.md`, `report\.html` \| `html-visual\.md`/);
  assert.match(skill, /Succeed only on\s+`status: pass`/);
  assert.match(skill, /Never hand-write\s+Canvas, Markdown, or HTML/);
  assert.match(
    routing,
    /Portable HTML report \| Active host is Claude Code, Codex, Qwen Code, GitHub Copilot, Pi, Kimi Code, WorkBuddy, or Grok, or a portable visual is explicitly requested \|/,
  );
  assert.match(routing, /Cursor Canvas report \| Active host is Cursor \|/);
  assert.match(routing, /Inline only \| Inline or no-files output is explicitly requested \| none; inline analysis writes nothing/);
  assert.match(adapters, /Claude Code[^\n]+scripts\/session-analysis\/platforms\/claude\.mjs[^\n]+self-contained HTML \+ Markdown/);
  assert.match(adapters, /Cursor[^\n]+scripts\/session-analysis\/platforms\/cursor\.mjs[^\n]+cursor-canvas/);
  assert.match(adapters, /Pi[^\n]+scripts\/session-analysis\/platforms\/pi\.mjs[^\n]+self-contained HTML \+ Markdown/);
  assert.doesNotMatch(adapters, /Inline repository review only|No Claude\s+session-evidence adapter/);
  assert.match(readme, /Claude Code defaults to a self-contained `report\.html`/);
  assert.match(readme, /\.claude\/better-harness/);
});

test("Codex README examples use host-specific skill invocation syntax", () => {
  for (const readmePath of ["README.md", "README.zh-CN.md"]) {
    const readme = read(readmePath);
    const desktop = readme.match(/#### Codex Desktop\n([\s\S]*?)\n#### Codex CLI/u)?.[1] ?? "";
    const cli = readme.match(/#### Codex CLI\n([\s\S]*?)\n### Qoder/u)?.[1] ?? "";

    assert.match(desktop, /^@better-harness(?:[ \t]|$)/mu);
    assert.match(cli, /^\$better-harness:better-harness(?:[ \t]|$)/mu);
    assert.doesNotMatch(desktop, /^[ \t]*\/better-harness(?:[ \t]|$)/mu);
    assert.doesNotMatch(cli, /^[ \t]*\/better-harness(?:[ \t]|$)/mu);
  }
});

test("Step 1 establishes one provider-labelled evidence bundle", () => {
  const skill = read("skills/better-harness/SKILL.md");

  assert.match(skill, /one versioned evidence bundle per authorized\s+provider/);
  assert.match(skill, /harness evidence-bundle --platform <provider>/);
  assert.match(skill, /Qoder project Memory title metadata is part of\s+the selected workspace baseline/);
  assert.match(skill, /For Codex,\s+Memory metadata requires `--include-memories`/);
  assert.match(skill, /user\/global or installed-Plugin\s+metadata requires `--include-user-home`/);
  assert.match(skill, /Apply both when both scopes are\s+authorized/);
  assert.match(skill, /Neither flag authorizes Memory bodies/);
  assert.match(skill, /from\s+one shared asset snapshot/);
  assert.match(skill, /`bundle\.context\.topology\.target`/);
  assert.match(skill, /report `kind`, `route`, and `packageRoute`/);
  assert.match(skill, /`memberRoute` or `null`/);
  assert.match(skill, /Providers must agree/);
  assert.match(skill, /bounded `lint`, `inventory`, and `integrity` envelopes/);
  assert.match(skill, /individual [\s\S]+command only to diagnose a named unavailable or evidence-loss stage/);
  assert.doesNotMatch(skill, /<cli> agent-lint --workspace <target>/);
  assert.match(skill, /Rules,\s+Skills, MCP, Memory, Agents, Hooks, Commands, Workflows, and Plugins/);
  assert.match(skill, /Zero or high counts never create findings or scores/);
  assert.match(skill, /normal Qoder\s+report with project Memories blocks when the integrity stage is\s+unavailable/);
  assert.match(skill, /do not\s+substitute diagnostic output into the bundle or rerun all owners/);
  assert.match(skill, /historical-insight access require explicit scope/);
  assert.match(skill, /provider discovers or the user supplies a historical insight source/);
  assert.match(skill, /Never assume or search a conventional path/);
  assert.doesNotMatch(skill, /~\/ai\/insights/);

  const bundleCommand = skill.match(/<cli> harness evidence-bundle[^\n]+/u)?.[0] ?? "";
  assert.match(bundleCommand, /--since <window-start>/);
  assert.match(bundleCommand, /--until <window-end>/);
  assert.match(bundleCommand, /--format json/);
});

test("Session Evidence prioritizes repeated workflows without opening raw sessions", () => {
  const root = read("skills/better-harness/SKILL.md");
  const ownerPath = "skills/better-harness/references/session-evidence.md";
  const session = read(ownerPath);
  const discovery = read("skills/better-harness/references/session-repeated-workflows.md");

  assert.ok(session.split("\n").length < 120);
  assert.ok(Buffer.byteLength(session) < 7_000);
  assert.ok(discovery.split("\n").length < 100);
  assert.ok(Buffer.byteLength(discovery) < 7_000);
  assert.match(
    root,
    /\[Sessions Diagnostics\]\(\.\.\/\.\.\/references\/session-evidence\/sessions-diagnostics\.md\)/,
  );
  assert.match(root, /provider-labelled facts envelopes from\s+`bundle\.lanes\.sessionEvidence\.data`/);
  assert.match(root, /using only the production `facts` route/);
  assert.match(root, /Do not pass the complete bundle,\s+collection reference, debug output, or raw sessions to Agent 1/);
  assert.match(root, /\[Session Evidence\]\(references\/session-evidence\.md\)/);
  assert.match(root, /\[Repeated Workflow Discovery\]\(references\/session-repeated-workflows\.md\)/);
  assert.match(root, /compact Step 1\s+asset counts needed to notice zero Skills/);
  assert.match(session, /Keep Qoder, Codex, and other providers separate/);
  assert.match(session, /Do not run analyzers, open raw sessions\/events, inspect project files/);
  assert.match(session, /no project Skills/);
  assert.match(session, /at least two distinct comparable Task\s+Episodes/);
  assert.match(session, /tests, lint, build, review, regression/);
  assert.match(session, /browser reproduction or a correlated backend\s+diagnosis/);
  assert.match(session, /procedure demand/);
  assert.match(session, /knowledge demand/);
  assert.match(session, /lead to compare with existing asset coverage/);
  assert.doesNotMatch(session, /~\/ai\/insights/);
  assert.match(session, /exists -> retrieved -> relevant -> applied -> later outcome improved/);
  assert.match(session, /three to five potential findings/);
  assert.match(session, /no fixed fields or JSON schema/);
  assert.match(session, /Do not assign final\s+severity, score, repair, or recommendation/);
  assert.doesNotMatch(session, /### Potential Finding \d|\| Candidate \|/u);
});

test("Project Evidence starts from core churn, tests, and an observable debug chain", () => {
  const root = read("skills/better-harness/SKILL.md");
  const ownerPath = "skills/better-harness/references/project-harness.md";
  const project = read(ownerPath);

  assert.ok(project.split("\n").length < 120);
  assert.ok(Buffer.byteLength(project) < 7_000);
  assert.match(root, /`bundle\.lanes\.projectHarness\.data`/);
  assert.match(root, /\[Project Harness Evidence\]\(references\/project-harness\.md\)/);
  assert.match(project, /30\/90\/180-day history/);
  assert.match(project, /responsibility-heavy or long methods/);
  assert.match(project, /focused tests mapped to that path/);
  assert.match(project, /trigger, boundary\/decision, failure or recovery, and result path/);
  assert.match(project, /Observability for AI Debugging/);
  for (const gate of ["discoverable", "runnable", "readable", "correlatable", "verifiable", "safe and reversible"]) {
    assert.ok(project.includes(gate), `project prompt must keep ${gate}`);
  }
  assert.match(project, /test, lint, type, contract, integration, E2E, browser/);
  assert.match(project, /architecture, security, schema, migration/);
  assert.match(project, /scripts\/review-trigger\//);
  assert.match(project, /presence alone is not a recommendation/);
  assert.match(project, /no fixed fields or JSON schema/);

  const dimensions = {
    "Context Map": ["Task Entrypoint", "Context & Boundary Map", "Risk & Next-Step Route"],
    "Environment Readiness": ["Environment Readiness Entry", "Run & Doctor Command Surface", "State Reset & Isolation"],
    "Fast Feedback": ["Validation Signal Layers", "Signal Speed & Actionability", "Affected Check Routing"],
    "Quality Gates": ["Rule Coverage", "Enforcement Gate Strength", "Rule Repair Path"],
    "Change Safety": ["Agent Lifecycle Guardrails", "Merge Acceptance Path", "Side-Effect, Permission & Recovery Boundary"],
  };
  for (const [dimension, submetrics] of Object.entries(dimensions)) {
    assert.ok(project.includes(`**${dimension}**`), `project prompt must preserve ${dimension}`);
    for (const submetric of submetrics) {
      assert.ok(project.includes(submetric), `project prompt must preserve ${submetric}`);
    }
  }
  assert.match(project, /Observability is cross-cutting evidence, not a sixth dimension/);
  assert.match(project, /Churn and method length are risk leads, not defects/);
});

test("Agent Customize consumes integrity evidence and investigates quality, not counts", () => {
  const root = read("skills/better-harness/SKILL.md");
  const ownerPath = "skills/better-harness/references/agent-customize.md";
  const customize = read(ownerPath);

  assert.ok(customize.split("\n").length < 120);
  assert.ok(Buffer.byteLength(customize) < 7_000);
  assert.match(root, /\[Agent Customize Evidence\]\(references\/agent-customize\.md\)/);
  assert.match(root, /consumes\s+the deterministic envelopes and must not rerun their commands/);
  assert.match(customize, /consume them rather than rerunning scanners/);
  assert.match(customize, /including selected-workspace Qoder Memory\s+title metadata/);
  assert.match(customize, /Counts route inspection; they do not create findings or scores/);
  assert.match(customize, /Zero project Skills/);
  assert.match(customize, /Many Memories require exact\/near duplicate, conflict, provenance, staleness/);
  assert.match(customize, /Many MCPs require capability overlap/);
  assert.match(customize, /Multiple Plugins require canonical-name, capability-fingerprint, version/);
  assert.match(customize, /short `AGENTS\.md` is not defective by length/);
  assert.match(customize, /exact same-scope Memory-title collisions and verified Plugin\s+name\/capability overlaps/);
  assert.match(customize, /near-title and plugin-family similarity as manual review leads only/);
  assert.match(customize, /Presence:[\s\S]+Content:[\s\S]+Use:[\s\S]+Outcome:/);
  assert.match(customize, /exists -> retrieved -> relevant -> applied -> later outcome improved/);
  assert.match(customize, /trigger quality, procedural content, routing, overlap/);
  assert.match(customize, /Build the Asset Coverage Map/);
  assert.match(customize, /canonical owner, and active or\s+shadowed version relationship/);
  assert.match(customize, /task\/procedure family/);
  assert.match(customize, /One\s+exact duplicate title does not imply that other Memories are healthy/);
  assert.match(customize, /Do not infer a missing Memory from inventory alone/);
  assert.match(customize, /Installation or\s+configuration proves availability only/);
  assert.match(customize, /no fixed fields or JSON schema/);
  assert.match(customize, /prioritize authorized lint errors/);
  assert.match(customize, /canonical file identity/);
  assert.match(customize, /every authorized surface as inspected, inventory-only, unavailable,\s+or not applicable/);
  assert.match(customize, /never omit one silently/);
  assert.match(customize, /Qoder Memories are nonzero but integrity is unavailable/);
  assert.match(customize, /Never return user-home Memory paths or\s+titles/);
  for (const reference of [
    "agents-md-review.md",
    "skill-review.md",
    "skill-discovery.md",
    "mcp-review.md",
    "memory-review.md",
    "custom-agents-review.md",
    "hooks-review.md",
    "knowledge-assets-review.md",
    "global-assets.md",
  ]) {
    assert.match(customize, new RegExp(`references/agent-customize/${reference.replace(".", "\\.")}`));
    assertReferencedPathExists(ownerPath, `../../../references/agent-customize/${reference}`);
  }
  assert.match(customize, /do not expand authority or asset limits/);
});

test("lead owns provider-aware finding eligibility and candidate promotion", () => {
  const skill = read("skills/better-harness/SKILL.md");
  const reviewPath = "skills/better-harness/references/findings-review.md";
  const review = read(reviewPath);
  const workLoop = read("models/agent-work-loop.md");
  const reconciliation = read("skills/better-harness/references/asset-demand-reconciliation.md");
  const template = JSON.parse(read("templates/reporting/harness-findings.input.json"));

  assert.match(skill, /Merge only candidates with the same target, observed consequence, owner, and\s+repair route/);
  assert.match(skill, /preserve independent consequences/);
  assert.match(skill, /assigns final severity and one primary Agent Work Loop check/);
  assert.match(skill, /dimension scores independently from findings count/);
  assert.match(skill, /\[Findings Quality Gates\]\(references\/findings-review\.md\)/);
  assertReferencedPathExists("skills/better-harness/SKILL.md", "references/findings-review.md");
  assert.match(review, /Provider-only evidence stays provider-labelled/);
  assert.match(review, /cross-provider synthesis\s+cannot turn one provider's absence into a project defect/);
  assert.match(review, /two distinct\s+comparable Task Episodes/);
  assert.match(skill, /\[Asset Demand Reconciliation\]\(references\/asset-demand-reconciliation\.md\)/);
  assert.match(reconciliation, /An absent asset and an uncovered repeated demand are different facts/);
  assert.match(review, /deterministic present defect/);
  assert.match(review, /search absence[\s\S]+remain leads/);
  assert.match(review, /Repeated counts come from the same canonical envelope/);
  assert.match(skill, /user's request language unless explicitly changed/);
  assert.match(review, /Every command, tool, owner, and capability[\s\S]+discovered in the target/);
  assert.match(review, /external writes are explicit\s+authorization preconditions/);
  assert.match(review, /Credential repair includes revocation or\s+rotation/);
  assert.match(review, /Resolve aliases to one canonical asset/);
  assert.match(review, /Every authorized nonzero Rules, Skills, MCP/);
  assert.match(review, /When Memory volume is high, require a bounded disposition for exact\s+collisions/);
  assert.match(review, /When project Skills are zero,\s+trace every repeated\s+Session procedure candidate/);
  assert.match(review, /Two distinct comparable Episodes with no existing owner require a Low Skill-coverage finding/);
  assert.match(review, /Never invent `\/` or `\$` invocation syntax/);
  assert.match(review, /exact same-scope title\s+collision is an ordinary `Low` governance finding/);
  assert.match(review, /New reports do not write `summary\.suggestions`/);
  assert.match(review, /candidate that passes normal finding eligibility becomes an ordinary\s+`Low` finding/);
  assert.match(review, /`SearchMemory` -> `update_memory` route/);
  assert.match(review, /discovered `\/knowledge` handoff/);
  assert.match(review, /review a\s+bounded batch and report the remaining count/);
  assert.match(skill, /Do not author `summary\.suggestions` in a new report/);
  assert.match(skill, /ordinary `Low` finding only when it passes/);
  assert.equal(Object.hasOwn(template.summary, "suggestions"), false);
  assert.match(review, /Retain every distinct supported finding/);
  assert.match(review, /Five is a coverage floor/);
  assert.match(review, /only the three\s+priority moves are ranked down/);
  assert.match(skill, /Do not launch a fourth review agent/);
  assert.match(skill, /lead applies the quality gates\s+once/);
  assert.match(skill, /\[Open the report\]\(<renderer-path>\)/);
  assert.match(skill, /Link the renderer-reported primary report/);
  assert.match(skill, /never return inline-code paths, a\s+bare directory, or an output-file inventory/);
  assert.doesNotMatch(skill, /fresh read-only review agent|returns `PASS`/);
  assert.doesNotMatch(review, /`PASS` or `REVISE`|After `REVISE`/);
  assert.match(review, /analyzer JSON envelope/);
  assert.match(review, /Confirmed Memory or Skill integrity findings remain\s+pending in Asset Health \/ Repair Progress/);
  assert.match(review, /uncovered applicable demand\s+stays at 59 or lower/);
  assert.ok(review.split("\n").length < 120);
  assert.ok(Buffer.byteLength(review) < 7_000);
  assert.ok(reconciliation.split("\n").length < 120);
  assert.ok(Buffer.byteLength(reconciliation) < 7_000);
  assert.match(reconciliation, /Session demand with Agent Customize coverage/);
  assert.match(reconciliation, /Skill Discovery/);
  assert.match(reconciliation, /Memory Review/);
  assert.match(reconciliation, /available -> installed -> discovered -> selected -> invoked/);
  assert.match(reconciliation, /cannot alone establish durable Loop Effectiveness/);
  assert.match(reconciliation, /not a new\s+specialist schema/);
  assert.match(workLoop, /never derive a dimension score from finding counts/);
  assert.match(workLoop, /current-task\s+exercise without a later comparison at 74/);
  assert.match(workLoop, /pending Asset Health \/ Repair Progress finding/);
});

test("support tracks shape recommendations after findings and scores freeze", () => {
  const root = read("skills/better-harness/SKILL.md");
  const trackPaths = {
    bootstrap: "skills/better-harness/references/support-bootstrap.md",
    operationalize: "skills/better-harness/references/support-operationalize.md",
    optimize: "skills/better-harness/references/support-optimize.md",
  };

  assert.match(root, /After findings and dimension scores are frozen/);
  assert.match(root, /user-journey\s+labels, never score thresholds/);
  assert.match(root, /Read only the selected track/);
  assert.match(root, /\*\*Undetermined:\*\* the evidence required to select a track is unavailable/);
  assert.match(root, /must not add a finding, change severity, rescore a dimension/);

  for (const [track, ownerPath] of Object.entries(trackPaths)) {
    assertExistingFile(ownerPath);
    const content = read(ownerPath);
    assert.ok(content.split("\n").length < 120, `${track} support must stay compact`);
    assert.ok(Buffer.byteLength(content) < 7_000, `${track} support must stay below the prompt budget`);
    assert.match(root, new RegExp(`references\\/support-${track}\\.md`));
    assert.doesNotMatch(content, /score\s*(?:>=|<=|>|<|between)/i);
  }

  const bootstrap = read(trackPaths.bootstrap);
  assert.match(bootstrap, /user explicitly asks for initial coding-agent project\s+guidance/);
  assert.match(bootstrap, /Do not select it merely because[\s\S]+assets have a zero count/);
  assert.match(bootstrap, /smallest useful owner/);
  assert.match(bootstrap, /Good AGENTS\.md Example Fragments/);
  assert.match(bootstrap, /requires a separate task-local request/);

  const operationalize = read(trackPaths.operationalize);
  assert.match(operationalize, /Present -> Wired -> Exercised/);
  assert.match(operationalize, /advances one real mechanism by one\s+observable state/);
  assert.match(operationalize, /Project Capability Artifact Examples/);
  assert.match(operationalize, /remain attached to a retained finding/);

  const optimize = read(trackPaths.optimize);
  assert.match(optimize, /at least two distinct comparable Task Episodes/);
  assert.match(optimize, /observed capability, host built-in, configured owner, extension/);
  assert.match(optimize, /later comparable outcome/);
  assert.match(optimize, /Frontend Bug Reproduction Skill/);
  assert.match(optimize, /prefer discover, select, invoke,\s+exercise, or narrowly extend it/);
});

test("finding-bound fixes remain slash-command owned and independently reassessed", () => {
  const skill = read("skills/better-harness/SKILL.md");
  const fixPath = "skills/better-harness/references/finding-bound-fix.md";
  const fix = read(fixPath);
  const canvas = read("templates/canvas/better-harness-insights.canvas.tsx");
  const html = read("scripts/harness-analysis/renderers/html.mjs");

  assert.match(skill, /`<better-harness-fix-output>`: \[Finding-bound Fix\]/);
  assert.doesNotMatch(skill, /legacy fix callbacks/);
  assert.match(skill, /\[Finding-bound Fix\]\(references\/finding-bound-fix\.md\)/);
  assert.match(fix, /initiating handoff must explicitly invoke `\/better-harness`/);
  assert.match(fix, /better-harness-fix-output/);
  assert.match(fix, /harness workspace-topology --workspace <workspacePath> --json/);
  assert.match(fix, /structured\s+`target`/);
  assert.match(fix, /complete `kind`, `packageRoute`, and `ownerRoute`/);
  assert.match(fix, /present-but-incomplete target is invalid/);
  assert.match(fix, /repo-root\|workspace-member\|repo-subtree\|standalone/);
  assert.match(fix, /mismatch fails closed/);
  assert.match(fix, /`requestedWorkspace` for standalone/);
  assert.match(fix, /smallest\s+owner for inspection, mutation,\s+and verification/);
  assert.match(fix, /legacy report with no `target` field at all/);
  assert.match(fix, /do not invent\s+`packageRoute` or `ownerRoute`/);
  assert.match(fix, /exactly one fresh read-only subagent/);
  assert.match(fix, /Agent Work Loop/);
  assert.match(fix, /asset-integrity/);
  assert.match(fix, /Repair Progress/);
  assert.match(fix, /Loop Effectiveness/);
  assert.match(fix, /harness record-fix-output/);
  assert.doesNotMatch(canvas, /TaskLoopOutcomeMetrics/);
  assert.match(html, /Codex Evidence Score \(Loop Effectiveness\)/);
  assert.match(html, /Asset Health \/ Repair Progress/);
});

test("manual direct fixes do not require report callbacks or mutate report state", () => {
  const skill = read("skills/better-harness/SKILL.md");
  const directFixPath = "skills/better-harness/references/manual-direct-fix.md";
  assertExistingFile(directFixPath);
  const directFix = read(directFixPath);

  assert.match(skill, /No callback plus leading `fix`, `repair`, or `\\u4fee\\u590d`:[\s\S]+\[Manual Direct Fix\]\(references\/manual-direct-fix\.md\)/i);
  assert.match(skill, /Review\/evaluation\/reporting or mixed review-and-fix: Step 1/i);
  assert.match(directFix, /first instruction is an explicit[\s\S]+`fix`, `repair`, or `\\u4fee\\u590d` \(Chinese `fix`\) directive/i);
  assert.match(directFix, /`review my harness and fix issues` remains on the ordinary[\s\S]+review route/i);
  assert.match(directFix, /concrete problem or requested outcome/i);
  assert.match(directFix, /smallest relevant owner/i);
  assert.match(directFix, /smallest relevant validation/i);
  assert.match(directFix, /must not (?:search for|discover)[\s\S]+`findings\.json`/i);
  assert.match(directFix, /must not (?:read|update)[\s\S]+`findings\.json`/i);
  assert.match(directFix, /do not ask[\s\S]+`workspacePath`[\s\S]+`findingsPath`[\s\S]+`findingId`[\s\S]+`expectedRevision`/i);
  assert.match(directFix, /must not claim[\s\S]+Repair Progress/i);
});

test("bug-diagnosis examples remain provider-neutral evidence-bound Skill shapes", () => {
  const exampleRoot = "case-studies/agent-customize/bug-diagnosis-skills";
  const frontendPath = `${exampleRoot}/reproduce-frontend-bug/SKILL.md`;
  const backendPath = `${exampleRoot}/diagnose-backend-bug/SKILL.md`;
  const frontend = read(frontendPath);
  const backend = read(backendPath);

  for (const requiredPath of [
    frontendPath,
    backendPath,
    `${exampleRoot}/reproduce-frontend-bug/agents/openai.yaml`,
    `${exampleRoot}/diagnose-backend-bug/agents/openai.yaml`,
  ]) assertExistingFile(requiredPath);

  for (const example of [frontend, backend]) {
    assert.match(example, /GitHub Issues, Jira, Aone/);
    assert.match(example, /untrusted evidence/);
    assert.match(example, /Do not edit product code/);
    assert.doesNotMatch(example, /\[TODO:/);
  }
  assert.match(frontend, /Reproduced \| Intermittent \| Not reproduced \| Blocked/);
  assert.match(backend, /Confirmed \| Narrowed \| Not reproduced \| Blocked/);
});

test("changed Better Harness Markdown links resolve", () => {
  const owners = [
    "skills/better-harness/SKILL.md",
    "skills/better-harness/references/session-evidence.md",
    "skills/better-harness/references/session-repeated-workflows.md",
    "skills/better-harness/references/project-harness.md",
    "skills/better-harness/references/agent-customize.md",
    "skills/better-harness/references/asset-demand-reconciliation.md",
    "skills/better-harness/references/findings-review.md",
    "skills/better-harness/references/finding-bound-fix.md",
    "skills/better-harness/references/support-bootstrap.md",
    "skills/better-harness/references/support-operationalize.md",
    "skills/better-harness/references/support-optimize.md",
  ];

  for (const owner of owners) {
    const content = read(owner);
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)#]+\.md)(?:#[^)]+)?\)/gu)) {
      assertReferencedPathExists(owner, match[1]);
    }
  }
});
