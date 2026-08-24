# Compare a minimal Qoder coding runtime

## Traceability

- Spec ID: qoder-minimal-runtime-profile
- Status: Implemented

## Intent

Provide a named, evidence-bearing Qoder runtime profile that presents the model
with the same four fundamental coding tools as Pi while suppressing optional SDK
context sources. Let one harness comparison hold the task and composition fixed
while assigning different named runtime profiles to the baseline and candidate,
so a successful README artifact can test the profile rather than merely prove
that the SDK returned a result.

## Acceptance Scenarios

- AC-1: `QoderSdkExecutor` accepts `qoder-minimal-v1` and sends exactly `Read`,
  `Write`, `Edit`, and `Bash`, an explicit minimal system prompt, no filesystem
  setting sources, empty SDK selections for skills/plugins/extensions, no
  configured MCP servers, strict MCP isolation, an ephemeral session, and the
  existing bounded permission callback to the official Qoder Agent SDK.
- AC-2: The runtime receipt names the selected profile and records non-secret
  context-isolation facts without persisting the system-prompt body or any
  credential. Contradictory options that would weaken the named minimal profile
  fail before the SDK is loaded.
- AC-3: A `harness-compare.v1` manifest may explicitly assign a named Qoder
  profile to each variant. The comparison resolves the effective runtime per
  trial, records the profile in trial evidence, and permits both variants to use
  the same composition only when the profile assignment differs.
- AC-4: Existing manifests with no per-variant profile assignment retain their
  current tool set, runtime behavior, and validation policy. Their existing
  evidence fields remain intact, with `qoder-default-v1` added explicitly.
- AC-5: Deterministic tests prove profile forwarding, fail-closed validation,
  variant routing, and backward compatibility. A real SDK smoke runs the frozen
  README task once under each profile and grades the resulting file and changed
  file scope.

## Non-goals

- Replacing Qoder's qodercli/worker agent loop with a bare model loop.
- Implementing host-owned `read`, `patch`, or `run` MCP tools in this change.
- Claiming that one README trial establishes general coding quality or a
  statistically significant performance improvement.
- Changing the `.harness` grammar, adding a host adapter, publishing a package,
  or editing release metadata.

## Plan and Tasks

1. Add a public Qoder runtime-profile type and a frozen `qoder-minimal-v1`
   contract to the executor, including conflict validation and evidence fields.
2. Extend the additive `harness-compare.v1` manifest surface with explicit
   baseline/candidate profile assignment and resolve it per trial.
3. Add an isolated profile-comparison example that holds the grounded
   composition, fixture, prompt, grader, model, permissions, and trial order
   constant.
4. Add behavior tests and documentation for profile semantics and comparison
   limits.
5. Run focused package checks, repository gates, and one real SDK trial per
   profile; retain generated evidence outside the source tree.

## Test and Review Evidence

- AC-1/AC-2: the isolated staged checkout passed 56 package behavior tests. The executor test
  observes the exact four-tool SDK options, empty optional context sources,
  strict MCP configuration, cwd-bearing system prompt, prompt-free receipt,
  and fail-closed conflict validation.
- AC-3/AC-4: manifest and runner tests prove that an unchanged v1 manifest
  keeps `qoder-default-v1`, while the isolated profile experiment routes the
  same composition through six-tool default and four-tool minimal runtimes and
  records each profile in trial evidence.
- AC-5: a real Qoder SDK trial under each profile changed only `README.md` and
  passed all nine deterministic grader checks with score 100. After repairing
  missing cwd context found by the first smoke, both final trials completed in
  five turns with no permission denial. The observed credits were 12.449909 for
  default and 9.785649 for minimal; one trial is insufficient to claim a stable
  efficiency improvement, so the aggregate verdict remains `need_more_work`.
  The minimal init event exposed exactly `Bash`, `Edit`, `Read`, and `Write` as
  tools. It still inventoried installed skill metadata, which is not treated as
  proof that the files were absent; `skills: []` and the missing `Skill` tool
  are the bounded model-context/invocation evidence.
  Trial artifacts were retained outside the repository for local review and
  were not added to the package or source tree.
- Isolated staged-checkout verification: `harness:generated` and
  `harness:build` passed; all seven package test files / 56 tests passed; and
  the documentation link graph passed six checks. Earlier whole-tree gates also
  passed 94 root test files / 1,324 tests and root pack verification with 526 npm
  and 548 runtime-zip entries; those whole-tree counts include concurrent local
  work and are supporting evidence rather than the staged-slice proof.
- Verification qualification: the composite `npm run check` cannot report a
  zero exit while a concurrent, uncommitted DSL grammar change legitimately
  differs from `HEAD`, because `check:generated` rejects every generated diff.
  Its root-test stage passed, and all remaining stages were run individually.
- Risk: four tools may increase discovery attempts because `Glob` and `Grep`
  are hidden. The first smoke confirmed this risk when missing cwd context led
  to five denied path guesses; the repaired profile made the working directory
  explicit and the final smoke had no denials.
- Risk: filesystem settings and optional SDK resources can silently expand
  context. The executor sends explicit empty collections and strict MCP config,
  and the runtime receipt records those values.
- Risk: the working tree contains concurrent DSL sugar and compare-hardening
  changes. Final review must preserve them and distinguish their ownership from
  this profile slice rather than staging the complete dirty tree.
