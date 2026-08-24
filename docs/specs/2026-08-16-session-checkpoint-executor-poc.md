# Continue a Pi session checkpoint into a new Git commit

## Traceability

- Spec ID: session-checkpoint-executor-poc
- Status: Implemented

## Intent

Prove the smallest safe execution path that combines an immutable Git source
checkpoint with one exact point in a coding-agent session. Given a repository,
a base commit, a Pi session JSONL file, a session entry id, and a continuation
prompt, Better Harness creates an isolated detached worktree, continues the Pi
conversation from that entry, and records the resulting file changes as a new
commit whose single parent is the resolved base commit.

The POC treats the Git commit and the Pi entry as a caller-supplied checkpoint
pair. It records and revalidates both halves, but it cannot infer that the
historical worktree used by the original session exactly matched the supplied
commit. The resulting commit is kept reachable through a namespaced ref; no
user branch, index, or working tree is switched or updated.

## Acceptance Scenarios

- AC-1: `harness-session-executor plan` resolves the repository, base commit
  and tree, parses the Pi JSONL session without rewriting it, validates the
  selected entry's parent chain, and writes a versioned plan containing full
  immutable ids and SHA-256 digests. Planning does not create a worktree,
  commit, or ref.
- AC-2: `harness-session-executor run --plan <file> --yes` revalidates the plan
  digest, base commit/tree, source session digest, session identity, selected
  entry, and output-ref absence before invoking a model or mutating Git state.
- AC-3: execution forks the Pi JSONL into execution-owned metadata, selects the
  exact entry as the active leaf, and continues it inside a detached worktree at
  the base commit. The live Pi runtime exposes only repository-contained read,
  list, edit, and write tools; shell commands, extensions, skills, prompt
  templates, deletion, and paths through `.git` are unavailable. The runner
  also aborts after 64 tool calls or 15 minutes.
- AC-4: when the continuation changes files, the executor stages only the
  isolated worktree and creates a commit with exactly one parent (the base
  commit), deterministic provenance trailers, and a
  `refs/better-harness/session-executions/<plan-id>` ref. The caller's current
  branch, index, and worktree remain unchanged.
- AC-5: the executor stores the validated plan, continued Pi JSONL, and a
  versioned receipt under Git-common-dir metadata. The receipt identifies the
  source checkpoint, execution session, result commit/tree/ref, and changed
  paths without embedding the continuation prompt.
- AC-6: a missing or changed checkpoint, an existing output ref, model/tool
  failure, or an empty diff fails closed without creating the output ref. A
  failed run removes its execution-owned worktree and incomplete artifact
  directory when possible.
- AC-7: focused tests exercise plan validation, Pi branch selection, path
  containment, commit parent/ref creation, no-change failure, and source
  worktree preservation without making a model request.

## Non-goals

- Supporting Codex, Qoder, Claude, Grok, or arbitrary JSONL formats in this
  first slice. The plan names `provider: "pi"`; later providers need explicit
  checkpoint adapters with equivalent validation and continuation semantics.
- Reconstructing dirty files, untracked files, the index, environment state, or
  external side effects that existed between historical Git commits. An
  arbitrary POC checkpoint means one Pi entry paired with one committed Git
  tree, not a byte-for-byte machine snapshot.
- Moving, force-updating, merging, cherry-picking, or checking out a user
  branch. Consumers decide how to adopt the namespaced result ref.
- A hardened multi-tenant sandbox. Path containment and an isolated worktree
  bound model-driven file effects for a local trusted-user POC; they are not an
  OS security boundary against a concurrent hostile process.
- Bash, test execution, dependency installation, network tools, file deletion,
  rename support, parallel runs of the same plan, crash recovery, or automatic
  retry. These require a later capability and durability contract.
- Inferring or repairing the semantic relationship between the supplied base
  commit and session entry.

## Plan and Tasks

1. Add a provider-neutral plan/apply core under
   `packages/harness/src/session-executor/` so the checkpoint contract can
   compose with the DSL/IR and existing executor adapters. It owns canonical
   plan hashing, Git fact resolution, immutable preflight, an isolated
   worktree lifecycle, commit creation, a namespaced ref, and receipts.
2. Add a Pi checkpoint adapter that forks the source JSONL, branches to the
   selected entry, and runs the continuation with contained custom tool
   definitions and project extensions disabled.
3. Add a package-owned `harness-session-executor` CLI with `plan` and `run`
   subcommands. Require an explicit plan output, continuation prompt or prompt
   file, commit message, and `--yes` for run. Keep CLI parsing outside the core
   API so a future DSL compiler can create the same typed plan directly.
4. Export the Node-only contract as `@qoder-ai/harness/session-executor`.
   Keep it out of the browser-safe package root (the Git executor owns Node
   process and filesystem APIs), and do not couple the root Better Harness
   script bundle to an unpublished workspace build.
5. Add behavior tests with temporary Git repositories and an injected fake
   continuation runner; use the installed Pi SDK only to verify real session
   branch semantics without contacting a model.

## Test and Review Evidence

- AC-1/AC-2/AC-4/AC-5/AC-6/AC-7:
  `npm test -w @qoder-ai/harness` — 15 files and 152 tests pass. The eight
  session-executor tests use temporary Git repositories to prove plan
  tamper/session-change rejection, one-parent commit and namespaced-ref
  creation, caller worktree preservation, no-change cleanup, and the CLI
  confirmation gate without making a model request.
- AC-3/AC-7: the same focused suite calls Pi's installed public
  `SessionManager.forkFrom()` and `branch()` against a branched JSONL fixture,
  then proves the selected entry is the active leaf and the source JSONL is
  unchanged. Containment tests cover repository paths, lexical escapes,
  `.git`, and symlink escapes on platforms that support the fixture.
- Packaging: `npm pack --dry-run --ignore-scripts -w @qoder-ai/harness --json`
  includes the compiled `dist/session-executor` API, declarations, and CLI.
- Live model execution was not used as test evidence. The real runner is built
  and type-checked against Pi 0.84.2; its model/auth availability remains a
  local run-time precondition.
- Risk: Pi JSONL is a host-owned evolving format. The POC records the source
  header version and delegates execution-session creation to Pi's public
  `SessionManager` API instead of rewriting JSONL itself.
- Risk: a model can make broad source edits inside the isolated repository.
  The run requires an explicit confirmation, excludes shell and extension
  surfaces, and leaves adoption of the result ref to a separate user action.
- Risk: Git object creation precedes the atomic ref update. A failed ref race
  can leave an unreachable commit object, but it cannot move an existing ref.
