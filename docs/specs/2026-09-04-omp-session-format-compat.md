# Spec: Oh My Pi session format compatibility in the Pi adapter

## Traceability

- **Spec ID:** OMP-01
- **Story:** none; maintainer-approved review follow-up on PR #143
- **Status:** implemented

## Intent

Oh My Pi (OMP) is a fork of Pi that shares the session transcript schema but
diverges in three observable ways. The Pi session adapter should read OMP session
trees when it is pointed at an OMP agent directory, without loosening any of the
workspace-isolation guarantees the Pi adapter already makes.

OMP is not a new host adapter: it has no host id, no capability profile, no
install shell, and no lifecycle target of its own. It is a recognized session
layout for the existing `pi` platform, reached with
`PI_CODING_AGENT_DIR=~/.omp/agent`.

## Observed OMP divergences

| Divergence | Pi | OMP |
| --- | --- | --- |
| Session directory name | absolute slug `--Users-ooxx-src-dotai--` | home-relative slug `-src-dotai` |
| JSONL preamble | first record is the `session` header | a `title` record precedes the header |
| Session forking | not observed | `/fork` copies every parent entry into a new file carrying `parentSession` |

## Acceptance scenarios

- **AC-1 — Home-relative discovery.** A workspace under the home directory
  resolves an additional `homeExact` variant (`~/src/dotai` → `-src-dotai`), and
  a session directory with that name is discovered.
- **AC-2 — Bounded home-relative prefix.** Subdirectory session directories match
  through `homePrefix` only across a separator boundary (`-src-dotai-packages-app`
  matches, `-src-dotaix` does not). A workspace whose only prefix-similar sibling
  has sessions reports its source root as absent.
- **AC-3 — Non-home workspaces unchanged.** A workspace outside the home
  directory exposes no home-relative variant, and the absolute `exact`/`prefix`
  contract is byte-identical to before.
- **AC-4 — Foreign-platform slug integrity.** A Windows-shaped workspace string
  keeps its drive letter on every host (`C:\workspace\project` →
  `--C--workspace-project--`) and never resolves against the host cwd. Only a
  host-native absolute path is eligible for a home-relative variant.
- **AC-5 — Title preamble.** Leading `title` records are skipped when locating
  the session header. Any other non-`session` record before the header still
  rejects the transcript fail-closed, and a second `session` header still rejects
  the whole file.
- **AC-6 — Fork deduplication.** When a fork's `parentSession` is also discovered
  in the same result, entries stamped before the fork point are read as the
  parent's and excluded from the fork, so each entry is counted once.
- **AC-7 — Orphan fork retention.** When the parent is not in the discovery
  result, the fork keeps its inherited entries: nothing else owns them, so
  dropping them would silently lose evidence.
- **AC-8 — Time range agreement.** A session's reported `firstSeen`/`lastSeen`
  always covers exactly the entries it yields, whether or not the fork cutoff
  applies.

## Design

`workspaceToPiSessionDirVariants` keeps the absolute slug derivation untouched
and adds `homeExact`/`homePrefix` when the workspace is a host-native absolute
path under the home directory. Slug normalization and home-relative derivation
read different inputs on purpose: the slug body keeps `path.win32` handling so a
Windows-shaped workspace string survives on a POSIX host, while the
home-relative body needs the host-native path because a foreign-platform path can
never be home-relative.

`probeTranscript` records `parentSessionId`, `forkTimestamp`, and a second
"owned" time range that excludes inherited entries. `discoverSessions` collects
every probe first, then decides per file whether the fork cutoff applies, because
the parent may be probed after its fork. The cutoff is stored on the source ref
rather than the session, so a session with several transcripts cannot leak one
file's cutoff onto another. `isInheritedForkEntry` is shared by discovery and
`readSession` so the reported time range and the yielded events cannot disagree.

## Non-goals

- Adding OMP to `scripts/host-support` as a distinct host id or capability
  profile.
- An OMP install shell, plugin manifest, or npm-packaged host artifact.
- Promoting OMP into the verified Quickstart set.
- Detecting an OMP agent directory automatically; the operator points at it with
  `PI_CODING_AGENT_DIR`.

## Risks

- The `parentSession` field name and the header-timestamp-as-fork-point rule come
  from observed OMP transcripts, not a published schema. If OMP renames the field,
  fork deduplication silently stops applying and forks report inherited entries
  again — the fail-open direction, which over-counts rather than loses evidence.
- Fork deduplication compares timestamps. An inherited entry without a timestamp,
  or one sharing the fork millisecond, stays with the fork.

## Test evidence

`test/sessions/session-analysis-providers.test.mjs`:

- `Pi derives OMP home-relative session directory names with a bounded prefix` (AC-1, AC-2, AC-3)
- `Pi discovers OMP home-relative session directories and skips the title preamble` (AC-1, AC-5)
- `Pi keeps a sibling OMP workspace out of the home-relative prefix match` (AC-2)
- `Pi discovers OMP subdirectory session dirs under the home-relative prefix` (AC-2)
- `Pi counts OMP inherited fork entries once when the parent session is discovered` (AC-6, AC-8)
- `Pi retains OMP inherited fork entries when the parent session is absent` (AC-7, AC-8)
- `Claude, Cursor, and Qwen workspace slugs cover Unix and Windows layouts` (AC-4)
- `Pi provider requires one authoritative first session header` (AC-5)

Each new assertion was mutation-checked: reverting the prefix boundary, the
`path.win32` slug handling, or the parent-existence condition fails exactly the
test that covers it.
