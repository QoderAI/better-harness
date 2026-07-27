# Import the public repository

## Traceability

- Spec ID: public-repository-import
- Status: Implemented

## Intent

Create a public-ready Better Harness repository snapshot without inheriting the
private repository history. The new local repository must contain the reviewed
current product tree, omit ignored and private workspace state, and expose only
one root commit with public project authorship.

## Acceptance Scenarios

- AC-1: The import contains exactly the source repository's tracked snapshot
  plus the reviewed public-import spec and explicit sanitization edits; ignored
  files, the source `.git` directory, caches, build output, and local IDE state
  are absent.
- AC-2: Public content contains no personal absolute workspace path, private
  Git remote or registry, internal email address, private key, or live access
  token. Security-test fixtures remain recognizably synthetic.
- AC-3: The imported project passes the documentation-link, secret-scan,
  complete test, and package-verification gates from the new repository.
- AC-4: The new repository uses `main`, has
  `https://github.com/QoderAI/better-harness.git` as `origin`, and contains
  exactly one commit authored with the public project identity.
- AC-5: The source repository remains unchanged, and no remote push occurs as
  part of the local import.

## Non-goals

- Publishing an npm release or configuring npm trusted publishing.
- Pushing the initial commit, changing GitHub visibility, or configuring branch
  protection and repository settings.
- Rewriting or sanitizing the private repository's existing Git history.
- Broad product refactors unrelated to removing current-tree publication risk.

## Plan and Tasks

1. Export only tracked files from the clean source tree into an ignored staging
   directory; never copy the source `.git` directory or ignored files. (AC-1)
2. Scan text and media metadata for credentials, private paths, internal
   infrastructure, and non-public author identities; make narrow redactions in
   the staged snapshot. (AC-2)
3. Run focused documentation and secret checks, then the complete test and
   package-verification gates against the staged snapshot. (AC-3)
4. Copy the verified snapshot to the adjacent target, initialize `main`, set
   repository-local public author metadata and `origin`, and create the sole
   initial commit. (AC-4)
5. Re-run repository-history, tree, remote, status, and source-diff checks after
   the commit. Do not push. (AC-4, AC-5)

## Test and Review Evidence

- AC-1/AC-2: compare the staged manifest with `git ls-files`; scan the staged
  tree for private paths, internal domains, secret formats, archives, symlinks,
  and unexpected large files.
- AC-3: run `node --test test/doc-link-graph.test.mjs`, the project secret
  scanner, `npm test`, `npm run pack:verify`, and `git diff --check`.
- AC-4: verify `git rev-list --count HEAD` is `1`, the sole commit has no
  parent, its author/committer use the public identity, the branch is `main`,
  and `origin` is the intended GitHub URL.
- AC-5: compare source `git status --porcelain=v1` before and after the import,
  and confirm no push command was executed.
- Risk: synthetic credential fixtures can resemble secrets. Keep them only when
  they are necessary to test redaction behavior and ensure the project scanner
  recognizes them as fixtures rather than live credentials.
- Risk: public tests may intentionally model company-specific tooling. Remove
  identifying infrastructure and email details without weakening the behavior
  the fixtures cover.

## Implementation Evidence

- Exported 409 source-tracked files from a clean source tree and added only this
  import spec. The source `.git`, all 1,680 ignored files, build artifacts,
  caches, and IDE state were excluded.
- Replaced one personal absolute workspace path, private repository-specific
  smoke-test names and topology, and three internal fixture email addresses.
  The public scan found no remaining private Git remote, internal registry,
  personal path, or internal email marker.
- `node scripts/agent-guardrails/secret-scan.mjs . --json --fail-on high`
  reported 0 Critical and 0 High findings. The remaining 14 Medium findings are
  synthetic security fixtures or identifier-shaped false positives.
- `node --test test/doc-link-graph.test.mjs` passed 5 tests, and `npm test`
  passed all 824 tests in a loopback-capable environment. The initial sandboxed
  run passed 821 tests and failed only the three preview listeners with
  `listen EPERM`.
- `NPM_CONFIG_CACHE=/private/tmp/better-harness-public-npm-cache npm run
  pack:verify` passed with 294 npm entries and 328 runtime-zip entries. The
  isolated cache avoided a pre-existing ownership problem in the user npm
  cache without modifying global state.
- The local repository uses `main`, the public `Qoder <dev@qoder.com>` identity,
  the intended GitHub `origin`, and one parentless root commit. No push was
  performed.
