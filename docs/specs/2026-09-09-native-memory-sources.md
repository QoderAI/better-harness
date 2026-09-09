# Native Memory sources in Studio

## Traceability
- Spec ID: native-memory-sources
- Status: Implemented; analysis and persistent promotion are follow-up scope
- Request: maintainer-provided native Memory discovery, Memory Inbox design and Rust implementation; no tracker issue assigned.
- AI: Codex implementation in feat/studio-memory-sources, based on origin/main 0c09b891; maintainer requested PR delivery.

## Intent
Expose native agent Memory through a global **Memory** workbench. Keep source provenance and explicit read authorization. The source reader is functional; candidate review is an explicitly labeled design preview. The maintainer corrected the product name from Knowledge to Memory and requested Rust ownership with future asynchronous analysis across multiple projects and AST evidence.

## Acceptance scenarios
- AC-1: Claude, Codex, Qoder and Qwen share validated source/document contracts. Other hosts expose unavailable coverage without database or transcript scanning.
- AC-2: Claude supports native project memory and autoMemoryDirectory, sharing Git repository identity across worktrees. Exclude CLAUDE.md and subagent memory.
- AC-3: Codex honors CODEX_HOME and explicit home overrides. Qoder preserves the existing inventory's account/global/projects qualification as host-observed implementation detail. Legacy reports remain backward compatible; parity fixtures compare the Rust projection with the existing inventory owner.
- AC-4: Qwen distinguishes checkout project, user, pinned and repository team memory. Exclude QWEN.md; do not reconcile projects by basename.
- AC-5: Discovery is metadata-only. Reads require a document id, matching scope and explicit content authorization. Bound size/depth/entry counts, reject symbolic links, and return digest, capture time, native identity and workspace qualification.
- AC-6: The global Memory entry opens Inbox and Inspector. Sources opens the actual source/document table and Markdown reader. Filters, keyboard focus, loading/empty/error states and bounded panes work at wide, compact and narrow sizes.
- AC-7: CLI sources/list/read rejects unknown flags. Content reads require include-memories with include-memory-content and scope/id.
- AC-8: Preview candidates are labeled examples. Accept/Edit/Reject and owner routing affect preview state only. Accepted project items leave Inbox, retain provenance in Inspector, and omit Agent identity on Project cards. Personal Memory stays outside Project; conflicts require review acknowledgment. No real ADR/Wiki writes or extraction are claimed.
- AC-9: Rust Evidence Host owns discovery and snapshots. JavaScript is transport, CLI and validation only; there is no JavaScript filesystem fallback. Desktop reuses its supervised Evidence Host, including macOS NSXPC; standalone Studio/CLI uses asynchronous native stdio calls. Missing executables fail explicitly.
- AC-10: A versioned future analysis contract carries a project set, revision-pinned AST evidence and authorized snapshot references, with job progress, cancellation and partial failure. No analysis engine or job endpoint is enabled in this slice.

## Ownership and implementation
- Native implementation: packages/better-harness-desktop/rust/evidence-host/src/memory.rs, exposed as memory.discover and memory.read through the existing versioned JSONL/NSXPC dispatcher.
- Existing desktop Rust build/staging packages the modified Evidence Host; no new service locator or parallel runtime is introduced.
- scripts/memory/index.mjs is the asynchronous stdio bridge; contract.mjs validates metadata, and cli.mjs parses the bounded read interface.
- Studio memoryProvider injection uses the desktop's existing native transport. Browser requests cannot provide host homes or filesystem roots; the server resolves the selected workspace and rejects stale reads after a workspace change.
- Global route: /#/memory. Native source reader: /#/memory-sources. Candidate rendering lives in memory-review/MemoryWorkbench.tsx; MemoryView.tsx owns source browsing. Shared Studio tokens, DataTable, roving tabs and Markdown renderer are reused.
- Native bodies are not prefetched, cached in browser storage or serialized into normal Harness reports. Scans exclude instructions, sessions, caches, databases and hidden paths. Reads are limited to 1 MiB; scans to depth 8 and 10000 entries per root with partial coverage.
- Native process calls do not block the Studio event loop. Calls have bounded frames and timeouts; a timed-out supervised request rejects its promise and terminates the active bridge. Git workspace qualification has a three-second bound.

## Future asynchronous multi-project analysis
The proposed TypeScript boundary is packages/harness-studio/src/contracts/memory-analysis.ts, explicitly marked as not yet enabled.

Input identity is an explicit set of server-resolved remembered project IDs, repository identities and revisions. Dirty trees additionally need a content digest. It is never inferred from the currently selected Studio workspace. Memory inputs are previously authorized immutable snapshot digests; accepting an analysis job must not authorize future arbitrary global Memory reads.

AST evidence carries project ID, revision, repository-relative path, content digest, language, parser name/version, symbol and byte range. A future worker may reuse the OXC capability where applicable; unsupported languages must produce explicit partial coverage, never invented AST evidence. Parsing and analysis run outside the UI process.

Planned job lifecycle: queued -> running -> succeeded / partial / failed / cancelled. Results are immutable artifacts. Monotonic sequence cursors support reconnect/polling, progress is bounded metadata, and per-project failures remain visible. Cancellation must stop work and prevent result publication. Persistence, scheduling, retries, analysis algorithms and job endpoints belong to the follow-up implementation.

## Native runtime setup
Desktop build: npm run build:rust --workspace=@qoder-ai/better-harness-desktop. It stages the executable under dist/native using the platform's executable suffix and packages the existing NSXPC service on macOS.

Standalone Studio/CLI may set BETTER_HARNESS_EVIDENCE_HOST to the built stdio executable. Repository development also resolves the desktop dist/native executable. No compiler is invoked automatically at runtime. npm-only installations need an explicitly provisioned native executable; they do not silently revert to a JavaScript reader.

Native integration tests run with that environment variable or a staged executable. Without either, the root native integration suite is explicitly skipped; cargo tests remain independently runnable. Use cargo +1.96.0 test --locked --manifest-path packages/better-harness-desktop/rust/evidence-host/Cargo.toml for native tests.

## Non-goals
Semantic extraction, merging, deduplication, embeddings, ontology generation, native Memory writes/deletion, persistent candidate promotion, cross-agent project reconciliation, and database/cache/transcript scraping. Instruction files remain configured assets.

## Test and review evidence
- Rust Evidence Host: 41 tests passed, including four direct Memory tests and existing session/stdio regressions.
- Native bridge + existing inventory: 21 tests passed with the Rust executable, covering four hosts, home overrides, Git worktrees, metadata-only output, digest/provenance, authorization, scope mismatch, size and symbolic-link rejection. Parity coverage compares legacy inventory qualification.
- Studio build passed. Focused native bridge/shell/design-token suite: 37 passed; includes Memory dispatch and timeout rejection.
- Playwright: 10 passed against built Studio using the Rust executable. Covers source API authorization/no-store/same-origin, stale reads, Inbox/Inspector/Promotion, editing/rejection/conflicts, personal routing and filter consistency.
- Light/dark screenshots at 1440x900, 1024x768 and 390x844 are saved under packages/harness-studio/test-results. Wide and narrow screenshots inspected; keyboard interaction, bounded overflow and zero console/page errors verified.
- Earlier full Studio suite had 596 passes and two pre-existing date-range failures. The unchanged tests use fixed September 8 fixtures but re-resolve against the current day. This Rust revision uses focused regression checks.
- Earlier Canvas preview returned healthy /health and HTTP 200 /canvas-module.js with the installed Qoder IDE SDK. Packaging verification passed before the Rust migration; current packaged/installed desktop and hosted Windows/Linux CI remain unverified.

Review readiness: the maintainer request and this spec provide scope evidence; no external issue/CI status is inferred. The PR scope is Memory, the native host bridge, legacy parity seam, Studio and tests. No release metadata or unrelated checkout work changed. Browser tests use synthetic native homes; actual user Memory bodies are not used as acceptance fixtures.

Native references: [Claude memory](https://code.claude.com/docs/en/memory), [Qwen memory](https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/). Qoder remains host-observed; existing Codex/Qoder inventory is the compatibility baseline.
