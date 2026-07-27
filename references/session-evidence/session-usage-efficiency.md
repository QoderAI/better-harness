# Session Usage Efficiency

Use this reference for explicit Qoder or Codex session-usage, long-session,
token/credit, model-choice, or low-result analysis. It produces one
workspace-scoped report; it is not a repository readiness score and does not
rank people. Set `<platform>` to the active evidence host and preserve it in
every session-analysis command.

Use the `<cli>` facade resolved by
[Harness execution routing](../../skills/better-harness/SKILL.md#execution-routing).

## Read-only Inline Flow

When the user asks for an inline assessment and does not authorize artifacts,
run only:

```text
<cli> session-analysis usage-summary --platform <platform> --workspace <target> --selection all-eligible --limit 1000 --format json
```

This command does not accept `--output` and must not write report or scratch
files. Read only its bounded selection, accounting, coverage, long-session,
model-usage, outcome-review, and evidence-boundary fields.

- When `eligibleCount` is zero, state that usage/model efficiency is
  unmeasurable and stop.
- When `requiresSemanticReview` is true, report the deterministic boundary but
  do not infer task families, outcomes, savings, or a better model. Those claims
  require the durable semantic-review flow below.
- Do not run repository tests, builds, preview servers, or ad-hoc JSON probes
  for an inline usage answer. Do not create a temporary file inside the target.

## Durable Report Flow

Use this flow only when the user requests a durable usage report.

1. Probe the active platform's sources for the named workspace.
2. Run a full deterministic census, not a 40-session or latest-N sample:

   ```bash
   node scripts/session-analysis.mjs insights --platform <platform> --workspace <target> --selection all-eligible --limit 1000 --format json --output <run>/insights.json
   ```

   Use this repository-root entrypoint exactly. Never invoke
   `scripts/session-analysis/cli.mjs`; it is an argument parser, not the analyzer
   CLI. Continue only when stdout returns `{"ok":true,"output":...}` for the
   requested path. A pre-existing `insights.json` does not prove this step ran.
   When the user supplied a reviewed, versioned model price table, add
   `--pricing-table <pricing.json>`. Never fetch or guess prices. `exact` means
   reproducible actual cost for observed usage, not predicted savings.

3. Read exactly `source.insights.keySignals.usageEfficiency` and
   `source.selection` from the saved CLI result. Do not probe alternate key
   paths, print the full object, or create an ad-hoc summary file. Record:
   selection, likely user-thread/child-agent counts, active/wall long-session
   counts, request/token coverage, attributed and unattributed model-request
   counts, accounting mode, model mix, candidate strata, and opportunities.
   Model totals count one canonical request lifecycle: prefer
   `model.request.started`, join its matching `model.response.completed` usage,
   and retain completion-only records when the start event is unavailable.
   Never count assistant thinking, tool-use, or text fragments as separate
   model requests. User-prompt counts include only user-authored prompt content;
   `tool_result` messages are tool evidence, not prompts.
   Active-long candidate rows retain at most four privacy-safe
   `userInputSummary` values plus a workspace-scoped, non-reversible
   `sessionRef` for the report handoff. Filter injected
   AGENTS/skill/environment text, redact private paths, stable ids, and
   credential-shaped values, and truncate the summary; do not substitute a
   session id or generic duration sentence for the user's task.
4. Build one bounded private review packet instead of printing the full signal
   or opening eight complete transcripts:

   ```bash
   node scripts/session-analysis/usage-review-packet.mjs --source <run>/insights.json --workspace <target> --limit 8 [--session-ref <qsr1-...>]... --output <run>/.review-packet.json
   ```

   The packet preserves representation from `candidateReasons`: `active-long`,
   `model-requests`, `nonzero-usage`, `execution-friction`, and `wall-only`.
   Without `--session-ref`, do not review only the longest rows. A report AI Fix
   may pass the displayed references to select exact candidates and may carry
   their raw session ids as private action transport. Raw ids and excerpts are
   private evidence only; never copy them into the final report, review JSON,
   visible Canvas rows, or evidence tags.
5. Read only the source markers and `.review-packet.json`; do not dump the full
   `usageEfficiency` object into model context. Write a private structured
   review with `schemaVersion: 1` and one `reviews[]` row per reviewed alias:
   `alias`, `taskFamily`, `outcome`, `friction`, `confidence`, and a 12-240
   character `evidenceReason`. Apply it deterministically:

   ```bash
   node scripts/session-analysis/usage-semantic-review.mjs --source <run>/insights.json --packet <run>/.review-packet.json --review <run>/.review.json --output <run>/insights.reviewed.json
   ```

   Use the reviewed source for the report. Do not manually set
   `comparableModelOutcomeEvidence` or a candidate model.
6. Write the reader report, validate it against `insights.reviewed.json`, revise until
   validation passes:

   ```bash
   node scripts/session-analysis/validate-usage-report.mjs --source <run>/insights.reviewed.json --report <run>/report.md
   ```
7. Delete `.review-packet.json` and `.review.json` after validation. Do not create `/tmp` summaries
   or any other sidecar. Finish with exactly
   `insights.reviewed.json` and `report.md` in the run directory. If generation exceeds
   three minutes or validation still fails after two revisions, stop and return
   the validator errors instead of entering another analysis route.

## Semantic Review

Assign a temporary report alias `S1`, `S2`, and so on. For each reviewed
candidate record only:

- task family: `implementation`, `debugging`, `architecture`,
  `report-analysis`, `review`, `setup-runtime`, or `other`;
- outcome: `fully-achieved`, `mostly-achieved`, `partially-achieved`,
  `not-achieved`, or `unclear`;
- friction: `wrong-direction`, `repeated-tool-failure`, `validation-gap`,
  `requirement-ambiguity`, `user-interruption`, `context-resume-bloat`, or
  `none-observed`;
- observed model mix and token status, or `unavailable`;
- confidence and a short redacted evidence reason.

Tool failures alone do not prove a poor outcome. A long session alone does not
prove wasted tokens, poor decomposition, bad tooling, or a model mismatch.
Agent self-report alone does not prove completion.

## Decision Rules

- **Long-session review lead**: before semantic review, show estimated active
  minutes, population ratio, estimate parameters, role, failures, safe task
  summary, and `sessionRef`; do not emit a finding or priority move. Recommend
  a smaller goal, fork, or separable subagent/Expert role only after reviewed
  repeated active-long work shows a separable task family and relevant
  friction. Wall-only spans are idle/resume evidence.
- **High consumption, low outcome**: require non-zero token evidence or label
  consumption as an effort proxy using active minutes, model requests, and
  retry loops. Pair it with a reviewed partial/not-achieved outcome.
- **Model-fit candidate**: require at least two Medium/High-confidence reviewed
  samples per model in the same task family across at least two models. Rank
  outcome first, then active duration, request count, and exact cost when all
  compared samples have it. Without that evidence, recommend only a controlled
  model A/B; do not claim a weaker model caused failure. Session length alone
  never selects a better model, and the report must not emit the template's
  candidate-model field until comparable evidence exists. An A/B plan may
  name the models being compared without designating either as the candidate.
- **Tool/runtime problem**: repeated permission, path, environment, or tool
  errors route to preflight, logging, or workflow repair before model advice.
- **Repeated playbook**: route to Loop Discovery; create or extend a Skill only
  after stable intent, procedure, validation, and missing existing coverage are
  demonstrated.

## Accounting Boundary

Use the analyzer's accounting mode exactly:

- `exact`: non-zero usage coverage and a versioned credit/price table support a
  reproducible calculation;
- `host-estimated`: some non-zero host usage exists, but exact credits or price
  are unavailable;
- `effort-proxy`: usage is missing or zero-filled; report active minutes,
  requests, and retry loops only.

Never convert missing usage to zero cost. Never attach an exact token, credit,
currency, or savings number to `effort-proxy`. For `host-estimated`, token totals
may be reported only where present; credits remain unavailable without a
versioned conversion table. State naturally but explicitly that exact token and
credits are unavailable; the validator accepts equivalent Chinese wording and
does not require a magic sentence.

## Report Contract

Write in the user's requested language when it normalizes to English (`en`) or
Chinese (`zh-CN`). The portable validator owns exact contracts for both locales
and selects one from the canonical title. For any other requested language,
stop and report that durable validation is unavailable instead of claiming a
validated localized report. Obtain the selected skeleton only when needed:

```bash
node scripts/session-analysis/validate-usage-report.mjs --print-template <en|zh-CN>
```

Keep every emitted heading and label exact. Replace placeholders with
source-backed values; do not copy the template into permanent Markdown
guidance or translate its validator-owned markers. Remove optional
partial-review, exact-cost, pricing-version, or candidate-model rows when they
do not apply; unresolved placeholders and inapplicable rows fail validation.

Return one to three problems. Each problem names evidence, impact, action,
savings mode, and confidence. When comparable model/outcome evidence is false,
the report must mention a controlled model A/B. Keep the report under 160 lines.
When semantic review covers fewer than all active-long sessions, retain the
template's partial-review boundary sentence and limit task-family/outcome claims
to the reviewed aliases.

When an AI Fix cites active-long sessions, list the bounded aliases with user
input summary, active minutes, candidate role, and failure count. If the active
population exceeds four, state that the list is a 4/N view. Start with semantic
review of those aliases; do not edit product code or create a durable asset
until the review identifies a repeated cause and its correct owner.

Each `### Pn` section keeps every problem-field label emitted by the template so
validation can inspect it independently. For exact accounting, fill the emitted
actual-cost and pricing-version markers. This is observed actual cost, never a
counterfactual saving. When structured comparison identifies a candidate, fill
the template's candidate-model marker and name the supporting task family.

## Quality Gate

Reject the report when it:

- uses sampled evidence to answer a full-count question;
- calls a child-agent candidate an independent user chat without a boundary;
- treats wall span as active work;
- reports zero or exact cost from zero-filled usage;
- blames a model without comparable task-family outcomes;
- copies raw local evidence or stable identifiers;
- gives more than three key problems;
- omits validator output or claims success after validation failed.
- probes JSON keys or dumps the full efficiency object instead of using the
  documented source paths and bounded review packet.
