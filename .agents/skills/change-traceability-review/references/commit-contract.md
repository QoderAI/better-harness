# Commit Contract

Treat Conventional Commits as baseline. The body should read like normal prose,
not a form. For spec-backed work, include a literal Story/issue token, spec
path or URL, and test evidence in a sentence:

```text
Implements HD-123 using docs/specs/hd-123-review-gate.md. The change keeps hook
behavior cross-platform and was validated with npm test.
```

Use `Story:`, `Spec:`, `Test:`, `Risk:`, `AI:`, or `Refs:` trailers only when a
reviewer, host tool, or external workflow explicitly requires them. Missing
evidence is different from explicit evidence: `Spec: none` is not proof that no
Spec is needed.

Report detailed risk, AI markers, and references in the Review Readiness Check
instead of forcing every commit body into a checklist.

Prefer one focused commit per coherent spec task. If a commit spans multiple AC
ids or modules, the body should summarize the split so reviewers can map diff
hunks back to the spec. If implementation changes the intended behavior, update
the spec in the same commit or in an immediately preceding spec commit and cite
that path/hash.
