---
name: harness-skill-creator
description: Use when bootstrapping or tightening the smallest harness-oriented skill from an existing repository, workflow, evaluation corpus, or harness-analysis chain. Trigger for meta skills, reusable harness workflows, Qoder/Codex plugin skill sets, skill blueprints, and harness-analysis-like skills that need evidence-backed references, validation gates, and qodercli forward-tests.
---

# Harness Skill Creator

Create the smallest skill that makes another agent repeat one harness job with
evidence, validation, and clear ownership.

## Workflow

1. Resolve source, target, and host: canonical `skills/<name>/`, `.agents/skills/` wrapper, or both.
2. Inspect the source chain before designing: entry `SKILL.md`, first-hop
   references, scripts, validators, templates, specs, tests, plugin manifests,
   and any real smoke evidence.
3. Load `references/bootstrap-patterns.md` after the first inventory. Use it to
   extract patterns, not product-specific rules.
4. Draft the minimum viable skill map:
   - skill name and trigger sentence
   - one job the skill owns
   - files to create under `skills/<skill-name>/`, usually `SKILL.md` plus one reference
   - evidence boundary and validation commands
   - forward-test prompt and pass/fail gates
5. Initialize new canonical skills with the system `skill-creator` helper when
   available. Add `scripts/` only for stable repeated automation; keep ad-hoc
   evaluation prompts out of runtime scripts.
6. Write the `SKILL.md` as a router. Put trigger conditions in frontmatter
   `description`, keep the body short, and route detailed rules to first-hop
   references.
7. Validate locally, then forward-test. Treat qodercli output as model evidence;
   local validators and file inspection decide pass/fail.

## Design Gates

- Prefer one skill over a stage tree until the target process proves multiple
  reusable stages.
- Copy ownership shape, not product names, branch policy, private commands, or
  source-specific team routing.
- Keep `.agents/skills/` as a wrapper or mirror when the workflow is shared by
  the plugin; canonical judgment belongs under root `skills/`.
- Do not add install, network, server, migration, or dependency-changing
  commands unless the user requested them and source evidence supports them.
- Prefer portable Node/Python validators or target-owned commands. Do not default generated validation gates to Unix-only `grep`/`find` checks.
- In attachment-only or no-tools forward-tests, never emit tool-call markup, shell probes, or inspection plans; return the skill map with `status: "insufficient-evidence"` when needed.
- Forward-test `files` is a string array of `skills/<skill-name>/...` paths, not objects.
- If the generated skill cannot pass `quick_validate.py <skill-dir>`, do not
  describe it as usable.
- After any forward-test, verify git status or file inventory for every repo the
  model was allowed to read or write.

## Validation

Run the narrowest useful gates for the created skill:

```bash
python3 <skill-creator-root>/scripts/quick_validate.py <skill-dir>
qodercli --cwd <neutral-dir> --plugin-dir <harness-root> -p "<forward-test prompt>"
qodercli plugin validate <harness-root>
```

Reject missing frontmatter, stale placeholders, broken links, unsupported
commands, source-only assumptions, pseudo tool calls, or broad reports.
