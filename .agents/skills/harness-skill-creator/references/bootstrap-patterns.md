# Bootstrap Patterns

Use this after reading the source chain; extract transferable skill shape, not source policy.

## Pattern Extraction

| Source surface    | What to extract                                         | What to leave behind                   |
|-------------------|---------------------------------------------------------|----------------------------------------|
| Entry `SKILL.md`  | Trigger scope, non-goals, first-hop routing             | Long explanation and product names     |
| References        | Evidence boundaries, output contracts, validation gates | Source-only organization policy        |
| Scripts           | Stable commands that prove behavior                     | Exploratory debugging commands         |
| Templates         | Required output fields and reader contract              | Decorative examples                    |
| Tests             | Parser-safe assertions and failure cases                | Snapshot noise                         |
| Plugin/host files | Discovery path and wrapper shape                        | Host-specific implementation detail    |
| Forward-test logs | Repeated model failures to guard against                | Model self-reports without local proof |

For a `harness-analysis`-like source, the reusable shape is:

1. short entrypoint
2. first-hop references
3. deterministic validator
4. visible output contract
5. model smoke that is weaker than local validation

## Minimum Skill Shape

Start with one canonical skill:

```text
skills/<name>/
  SKILL.md
  references/<one-pattern-file>.md
```

Add more only when there is a concrete consumer:

- `scripts/` only for repeated deterministic automation.
- extra references only when the first reference grows into independent topics.
- `.agents/skills/<name>/` only as a wrapper, mirror, or host-only skill with `mirror.json`.
- `agents/openai.yaml` only as concise UI metadata, not behavior ownership.
- validation gates as target-owned commands or portable Node/Python checks, not ad-hoc Unix-only `grep`/`find` snippets.

## Forward-Test Loop

Run qodercli from a neutral directory with explicit paths. Keep prompts small.

Prompt contract:

```text
Use $harness-skill-creator from <harness-root> to inspect <target-repo>.
Do not write files or emit tool calls. Return a compact JSON object with:
status, skill_name, trigger, files, source_evidence, validation_gates,
rejection_risks. `files` is string[], rooted under skills/<skill_name>/.
If evidence is thin, use status "insufficient-evidence".
Keep it under 40 lines.
```

Each iteration records target, command, contract pass/fail, line count, failures
to convert into skill rules, and local checks run afterward.

Reject a round when the output:

- omits frontmatter or trigger ownership
- emits pseudo tool calls, shell probes, or an inspection plan instead of a skill map
- proposes broad report generation instead of skill creation
- returns file objects or paths outside `skills/<skill_name>/`
- invents unsupported install, network, server, migration, or dependency-change commands
- defaults to Unix-only search commands instead of portable or target-owned validators
- copies source product policy as if it were universal
- claims filesystem or git cleanliness without local verification

## Simplicity Test

Before finishing, delete any rule that does not protect one of these outcomes:

1. the right skill triggers
2. the generated skill is short
3. the generated skill has valid frontmatter and links
4. the evidence boundary is honest
5. qodercli failure produces a better next rule
