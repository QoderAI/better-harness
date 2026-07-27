# Mode Rules

## Traceability Rules

Find Story/issue evidence in order: `Story:` footer or explicit PR field;
subject/body tokens like `[A-Z][A-Z0-9]{1,9}-[0-9]+`, `STORY-123`, or
repo-established `#123`; branch or PR text; doc/spec path or historical commits
mentioning the same token. Count only literal visible tokens. Do not infer a
Story from topic similarity, timestamps, branch slugs, or repeated module names.

If Story/issue evidence exists, search for Spec evidence: explicit `Spec:`;
matching local docs; historical spec-doc commits like `docs(spec): ...`; key
terms from the commit summary.

If Spec evidence exists, verify it is linked back to the same literal Story
when one exists, then compare changed files and tests against the spec's
Acceptance Scenarios, Plan and Tasks, and Test and Review Evidence. Classify
code-without-spec, spec-without-code, and spec-drift separately.

Classify evidence as **confirmed**, **candidate**, **missing**, or
**unavailable**. External trackers and CR links are unavailable unless actually
opened or provided.

## Analysis Rules

For **Review Readiness Check**, inspect Story evidence, Spec, Test, Risk, AI,
Refs; changed files/modules, generated code, sensitive paths, deleted guards,
staged vs unstaged split, unrelated changes; tests from changed test files,
`Test:`, validation output, or CI text.

For **Spec Preparation**, first find a literal Story/issue or ask for one if it
is required and unavailable. Draft or update the spec with AC ids, non-goals,
plan/tasks, and test/review evidence. End with a normal commit-body sentence
that mentions the Story when present, spec path, and validation evidence.

For **Review Retrospective**, aggregate before expanding: separate
automation/merge commits first so `scm-auto`, CodeFlow, or merge commits do not
skew developer metrics; count type/scope, Story evidence, Spec, Test, Risk, AI,
Refs; identify Story IDs without local Spec, spec-doc-before-implementation
patterns, large commits, mixed scopes, weak subjects, rework words, repeated
same-module fixes, and AI/automation markers.

Do not rank people or infer intent. Frame history findings as review-system
improvements.
