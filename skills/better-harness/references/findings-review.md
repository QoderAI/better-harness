# Findings Quality Gates

Use this compact checklist while the lead drafts `findings.json`. Do not launch
another Agent, add a second reconciliation pass, edit the target, or repair a
finding during report generation.

## Inputs and Boundary

Use the resolved scope and authority, compact Step 1 baseline, three specialist
briefs, analyzer JSON envelope, draft `findings.json`, and adjacent `canvas.json`
only when the provider produced one. Open only a few target-owned files or
command declarations named by a candidate when necessary. Do not reopen raw
Sessions, Memory bodies, private caches, or broad project history, and do not
rerun asset scanners.

The three specialist briefs are candidate evidence, not report truth. The
analyzer owns machine facts. The lead owns selection, severity, dimension
scores, candidate promotion, and prose.

## Review Gates

Review the draft as a first-time user would:

Any failed gate blocks rendering even when the draft already has five findings.
Inspect every reader-visible string in both JSON files; instructions that say
private data must not be copied do not make an already embedded value safe.

1. **Evidence eligibility:** Retain only an observed consequence, an explicit
   governing requirement, or a deterministic present defect such as a direct
   secret, malformed active config, or exact same-scope collision. Count,
   length, search absence, similarity, unavailable evidence, detector `none`,
   and theoretical risk remain leads. Unreviewed Session or Learning Capture
   gaps stay in the evidence boundary. Resolve aliases to one canonical asset
   and discard example literals.
2. **Concrete reader value:** Each title names a specific observed consequence,
   not an internal detector, maturity concept, or abstract mechanism. The reason
   separates fact, inference, owner, provider, and uncertainty. Do not use a
   number in a title merely to imply severity.
   Provider-only evidence stays provider-labelled; cross-provider synthesis
   cannot turn one provider's absence into a project defect.
3. **Fact consistency:** Repeated counts come from the same canonical envelope.
   Different populations name their scope and measurement basis. The overview,
   dimensions, findings, and coverage rows do not contradict one another.
4. **Asset accountability:** Every authorized nonzero Rules, Skills, MCP,
   Memory, Agent, Hook, Command, Workflow, and Plugin surface appears in
   coverage. `inspectedSurfaces` contains only content actually opened. Exact
   integrity candidates are accounted for; similarity leads are not promoted.
   Inventory never proves selection, use, usefulness, or outcome.
   When Memory volume is high, require a bounded disposition for exact
   collisions, near matches, conflict/staleness, and unknown coverage: confirmed,
   metadata lead, unobserved, or deferred. Do not demand Memory-body proof outside
   authority; a count alone is not a disposition. An exact same-scope title
   collision is an ordinary `Low` governance finding unless corroborated current
   impact justifies a higher severity; near matches remain deferred. When project Skills are zero,
   trace every repeated Session procedure candidate through existing coverage.
   Two distinct comparable Episodes with no existing owner require a Low Skill-coverage finding;
   otherwise the draft must state the evidence reason for not promoting one.
5. **Privacy:** Reader output contains no secret value, raw prompt, stable
   Session id or analysis reference, raw or summarized prompt, user-home asset
   path, Memory title/path, or private cache layout. Long-session rows keep only
   anonymous aliases, role, duration, and aggregate failures; the review button
   regenerates its private packet without embedding locators.
6. **Executable repair:** Every command, tool, owner, and capability in an
   `aiFixPrompt` was discovered in the target or provider contract. Global,
   credential, production, PR, issue, or other external writes are explicit
   authorization preconditions. Credential repair includes revocation or
   rotation, but never assumes an environment-reference syntax, shell profile,
   restart route, or provider action before discovery and separate authority.
   Memory collision repair remains metadata review until same scope and bodies
   are verified; merge or deletion always requires separate authority. For
   Qoder Memory, require the discovered `SearchMemory` -> `update_memory` route;
   for project Wiki or Knowledge Cards, use a discovered `/knowledge` handoff.
   Never edit generated Memory files directly or substitute one owner for the
   other. When exact collisions coexist with many near-title leads, review a
   bounded batch and report the remaining count instead of embedding every
   title in one prompt.
7. **Score discipline:** Confirmed Memory or Skill integrity findings remain
   pending in Asset Health / Repair Progress until independent repair review.
   Counts, configuration, or same-window repair never earn Learning Capture or
   Loop Effectiveness credit. Memory credit requires retrieval, relevance,
   application, and a later improved outcome; Skill credit requires selection,
   task-relevant invocation, validation, and a later improved outcome. Enforce
   the Agent Work Loop Learning Capture ceilings: uncovered applicable demand
   stays at 59 or lower, current-task exercise without later comparison at 74
   or lower, and 100 requires a later comparable improved outcome. An adequately
   reviewed no-candidate window does not require either asset.
8. **Candidate promotion:** New reports do not write `summary.suggestions`.
   A candidate that passes normal finding eligibility becomes an ordinary
   `Low` finding with the standard consequence, owner, expected output,
   verifier, `aiFixPrompt`, and dimension links. A try-existing, working-pattern,
   loop, or horizon opportunity without a current consequence remains deferred.
   Skill or Memory promotion still requires two distinct comparable Task Episodes and
   the observed -> built-in -> configured -> extend -> create ladder. Never invent `/` or `$` invocation syntax.

Retain every distinct supported finding. Five is a coverage floor for a normal
evidence-rich report, never a target total or deletion threshold. Keep findings
beyond five when they have independent consequences or owners; only the three
priority moves are ranked down. Fewer findings are valid when evidence is
sparse. Reject filler, exact duplicates, and unsupported absence claims rather
than deleting eligible findings for presentation density.

## Stop

Render only after every gate passes and the working reconciliation accounts for
each omitted candidate as an exact merge, unsupported lead, or explicit defer.
