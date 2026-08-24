# Compare harnesses with real coding outcomes

## Traceability

- Spec ID: harness-coding-compare
- Status: Implemented

## Intent

Add a reproducible Qoder-backed comparison workflow to `@qoder-ai/harness` so
maintainers can compare two DSL compositions by letting each one modify the
same isolated repository fixture and grading the resulting files. The first
benchmark creates a repository-grounded `README.md`; success is based on the
file diff and deterministic validation, not on whether an SDK returned text.

Keep the `.harness` language responsible for agent-harness assembly. A separate
versioned experiment manifest owns tasks, trials, runtime budgets, graders, and
artifact locations so evaluation policy does not become authored composition
syntax.

## Acceptance Scenarios

- AC-1: A full-surface `.harness` fixture exercises every component kind,
  permission domain/access, binding strength, degradation policy, and
  configuration value type. Tests assert compiled IR and resolution behavior,
  while focused invalid fixtures assert structured diagnostics.
- AC-2: A `harness-compare.v1` manifest parser rejects unknown fields, unsafe
  paths, unsupported hosts, invalid trial counts, missing compositions, and
  runtime settings that do not provide a bounded Qoder coding tool policy.
- AC-3: A comparison run copies the frozen task repository into a fresh
  directory for every variant and trial, resolves each composition, invokes
  the Qoder SDK, captures before/after file state, runs deterministic graders,
  and emits parser-safe JSON artifacts without changing the source fixture.
- AC-4: Qoder execution can receive explicit visible tools, auto-approved tools,
  disallowed tools, permission mode, model, turn limit, and a permission
  callback. Its result records the exact non-secret runtime receipt, SDK event
  trace, duration, turns, token usage, cost, session id, and terminal reason.
- AC-5: The README benchmark requires only `README.md` to change, parses its
  structure, resolves local links, executes its JavaScript example against the
  fixture package, checks documented public API and behavior against executable
  package contracts, rejects stale or invented capabilities, and runs the
  package's existing tests.
- AC-6: A deterministic fake-SDK end-to-end test proves the compare runner
  creates and grades real files. A native Qoder smoke, when local authentication
  is available, runs the same public compare command and retains its artifacts;
  unavailable authentication is reported separately from product correctness.
- AC-7: Package documentation explains the assembly/evaluation boundary, safe
  tool policy, CLI command, artifact layout, limitations, and validation
  commands. The package build, tests, generated-source check, document-link
  graph, and pack surface pass before commit.

## Non-goals

- Enabling Pi coding tools; the Pi v0.1 executor remains advisory and
  `noTools: "all"`.
- Treating one README task as proof of general coding-agent improvement.
- Adding a new Coding Agent host adapter or changing existing support claims.
- Allowing arbitrary shell commands, network access, destructive operations,
  or writes outside an isolated trial directory.
- Publishing a package, changing package versions, or editing release metadata.
- Using an LLM grader as the primary correctness decision.

## Plan and Tasks

1. Add a full-surface language fixture and behavior-focused compiler/resolver
   coverage.
2. Extend the Qoder executor with explicit coding options, a bounded
   permission callback seam, trace capture, usage metrics, and runtime receipt.
3. Add the versioned compare manifest contract, isolated trial runner,
   filesystem snapshot/diff evidence, command grader, aggregation, and CLI.
4. Add the frozen README fixture and a deterministic Markdown/package grader.
5. Test manifest failure modes, source-fixture immutability, variant isolation,
   real file creation, grader failures, artifacts, and safe tool decisions.
6. Document and run the focused package gates, native Qoder smoke when
   available, full repository gates, link graph regeneration, and pack checks.

The compare implementation remains under `packages/harness/src/compare/` and
uses only public compiler, resolver, and executor surfaces. It uses Node and Git
argument arrays for cross-platform execution and never invokes a shell string.

## Test and Review Evidence

- AC-1: `examples/full-surface.harness` compiles into schema-valid IR and
  resolves the satisfied and degraded requirement paths. The package suite
  asserts all eight component kinds, four strengths, permission alternatives,
  degradation policies, and configuration value types.
- AC-2/AC-3/AC-5: `test/compare.test.ts` exercises manifest policy failures,
  bounded tool decisions, real isolated file creation, standard Git patches,
  source-fixture immutability, deterministic README grading, redacted paths,
  and rejection of generated examples that request host capabilities.
- AC-4: `test/exec.test.ts` passes explicit Qoder SDK options through the
  injectable SDK seam and asserts runtime receipts, duration, turns, dollar
  cost, credits, usage, session/termination data, and recursive credential
  redaction.
- AC-6: A native SDK run used the frozen `performance` model for one H0 and one
  H1 trial. Both changed only `README.md`, both executable Quick Starts passed,
  both package test runs passed 3/3, and both deterministic scores were 100.
  H0 used 6 turns, 519,923 ms, and 82.219797 credits; H1 used 5 turns,
  63,633 ms, and 10.768145 credits. The result correctly remained
  `need_more_work` because a one-trial tie does not establish improvement.
  Evidence hashes were manifest
  `a2fc04c095c71152441f2095d731d0c4662f005d1b2970871a09cc364c1e66b5`,
  fixture `d70ee5ff320be019be3590e78792d262ed70e76139cf93cf88c1b048472453ba`,
  and harness
  `d522506d80f2bad6c6dfd4ffdcd0780193825ce461bf64c707d336940b6432df`.
  The H1 native patch was then replayed through the final Node permission-model
  grader and again scored 100 with its example and package tests passing.
- AC-7: `npm run check` passed 1,324 root tests, 52 package tests, generated
  source verification, package build, and pack verification (525 npm entries,
  547 runtime-zip entries). The focused documentation link graph passed six
  assertions. The final tarball contained 65 files (51.9 kB, shasum
  `82401bc9ca61f5df0ba872b2b5d485f224d10302`), installed into a
  clean temporary consumer, exposed a working `harness-compare` npm bin, and
  compiled/resolved the shipped full-surface DSL plus loaded the shipped
  `harness-compare.v1` manifest.
- Risk: Agent nondeterminism can create misleading one-shot wins. Preserve each
  trial independently and require multiple trials before an improvement claim.
- Risk: Tool approval mistakes can escape the fixture. Resolve every path
  against the trial root, allow only a narrow command vocabulary, deny network
  tools, and record every permission decision.
- Risk: Authentication, model availability, SDK workers, and machine resources
  can fail independently. Classify these as infrastructure failures and retain
  stderr/trace evidence rather than scoring them as task failures.
- Risk: SDK messages may contain sensitive data. Persist structured protocol
  events only after recursively redacting token/key/authorization fields; never
  store injected credentials in manifests, receipts, traces, or fixtures.

## Post-Review Corrections

A review of the merged change found eight defects. All are fixed, and each
behavioral fix is covered by a test in the package suite.

1. Validation commands spawned `npm` without a shell, which cannot start the
   Windows `npm.cmd` shim and aborted the whole comparison. `npmInvocation()`
   now resolves an `npm-cli.js` entry point, and a test runs it on the host.
2. A timed-out command killed only the direct child. Commands now run in their
   own process group and are stopped together with their children.
3. The shared task prompt stated the required README sections, grounding rules,
   install command, and validation duty, so the baseline received the candidate
   composition's content and the native AC-6 run tied at score 100. The prompt
   now states only the goal and the runtime tool policy; the documentation
   standard moved into the candidate composition's components. The runtime
   profile experiment keeps its explicit prompt because both of its arms share
   one composition.
4. Tests derived filesystem paths from `URL.pathname`, which is not a valid path
   on Windows. They now use `fileURLToPath()`.
5. Trace redaction shared one cycle set across sibling values, so an object
   referenced twice was recorded as `[Circular]`. Only the ancestor chain is
   tracked now.
6. The grader imported the agent-modified package entry point into its own
   process. Exports are now read by a separate `--permission` Node process, and
   a test proves a tampered entry point is graded without executing inside the
   grader.
7. Fixture copy, Git setup, patch capture, and grader breakage propagated out of
   a trial and discarded the whole run. Such failures are now recorded as that
   trial's `infrastructure_error` with retained evidence.
8. `runtime.network` was validated but never used, and `metrics.json` duplicated
   the full check list. Network denial now drives the web-tool requirement, and
   `metrics.json` keeps the grade summary while `validation.json` keeps checks.

The AC-6 native manifest, harness, and fixture hashes above belong to the
pre-correction prompt and harness files. They remain the honest record of that
run, but they no longer describe the current experiment: a fresh native run is
required before any comparative claim, and the baseline is now expected to score
lower than the candidate rather than tie.

Re-verified after the corrections: `npm run harness:generated`,
`npm run harness:build`, `npm run harness:test` (60 package tests),
`npx vitest run test/skills-docs/doc-link-graph.test.mjs` (6 assertions), and
root `npm test` (1,322 of 1,324; `test/plugins/host-support.test.mjs` and
`test/reporting/report-source-review.test.mjs` hit the 120 s limit under full
suite load and both pass in isolation). `npm run harness:generated` and
`npm pack --dry-run` were not re-established after these corrections: a separate
uncommitted change to the grammar, resolver, and `test/sugar.test.ts` is in
flight in the same worktree, so the generated-source diff is dirty and one sugar
test is red. Re-run both gates once that change is complete.
