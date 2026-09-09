# Ontology Language Analysis Runtime

## Traceability

- ADR ID: `ADR-0008`
- Status: Proposed
- Decision date: 2026-09-09
- Spec: [Studio Ontology Language Runtime](../specs/2026-09-09-studio-ontology-language-runtime.md)

## Context

Studio's memories module needs an Ontology view of a target project: typed
entities (functions, classes, interfaces, modules, …) and, eventually, the
relationships between them (calls, imports, inheritance). Memories alone
cannot supply this — they are the model's summarized recollection of a
session, not a structural index of the source tree. Building the entity layer
requires parsing source directly.

We looked at how Zed (`/Users/phodal/test/zed`, a mature Rust editor built by
the creators of tree-sitter) is built, since it does exactly this kind of
per-file structural analysis across a large language set. Its shape:

- A native `tree-sitter` core plus one `tree-sitter-<language>` crate per
  first-party language (Rust, Python, Go, TypeScript/TSX, Bash, C, C++, CSS,
  HTML, JSON, YAML, Markdown, …), statically linked.
- Each language ships four to ten small `.scm` tree-sitter query files
  (`highlights`, `outline`, `brackets`, `indents`, `injections`, `overrides`,
  `runnables`, `textobjects`, `debugger`), compiled into a generic
  capture-index-driven `Grammar` struct (`language_core::grammar`) rather than
  bespoke per-language Rust code.
- Languages outside that first-party set are community extensions that ship a
  grammar as a `.wasm` module, loaded at runtime through tree-sitter's own
  `wasm` feature (`tree_sitter::WasmStore`, backed by `wasmtime-c-api`) —
  Zed's core binary never statically links most of the languages it supports.
- Critically, **tree-sitter in Zed never resolves cross-file relationships**.
  `call_hierarchy` and `project_symbols` — anything that answers "who calls
  this" or "where is this defined elsewhere" — is answered entirely by the
  Language Server Protocol. Tree-sitter's job stops at one file's syntax tree
  and the structural queries run over it.

Separately, this repository already runs three Rust sidecars from
`packages/better-harness-desktop/rust` — `harness-oxc-service`,
`harness-acp-host`, `harness-evidence-host` — each a newline-delimited-JSON
process Node spawns over stdio, with an additional NSXPC transport on macOS
(`harness-<name>-xpc` / `harness-<name>-client`, a byte-for-byte JSONL
forwarder). `harness-oxc-service` already builds a real semantic layer
(scopes, bindings, references) for JS/TS via `oxc_semantic` — that is a
stronger foundation for JS/TS ontology data than a tree-sitter outline query
would be, and this decision does not replace it.

The open question this ADR resolves: given we need Java, Rust, TypeScript,
JavaScript, Go, Python, C#, Swift, Kotlin, and SQL coverage, should the host
be Rust with grammars loaded as WASM modules (Zed's own split), and should any
of this instead just be a Node/`web-tree-sitter` module given Studio is
already an Electron/Node codebase?

## Decision

- **A fourth Rust sidecar, `harness-ontology-service`**, joins
  `oxc-service` / `acp-host` / `evidence-host` under
  `packages/better-harness-desktop/rust`, with the same NDJSON-over-stdio
  wire shape (`version`/`id`/`method`/`params`, 4 MiB request / 16 MiB
  response ceilings, fail-closed on malformed or oversized frames) and the
  same NSXPC bridge structure on macOS. Node's role stays a thin client, as
  it already is for the other three hosts.
- **We are not doing this in Node with `web-tree-sitter`.** Bulk ontology
  extraction is a CPU-bound, whole-tree parse over potentially the entire
  target project — exactly the kind of work the existing three sidecars
  already exist to keep off the Node event loop. Adding a second parsing
  runtime (WASM-in-Node) beside the Rust one already used for JS/TS
  (`oxc_semantic`) would split this capability across two toolchains for no
  offsetting benefit; `web-tree-sitter`'s WASM-hosted engine is also
  measurably slower than tree-sitter's native core for large-file/bulk
  parsing, which is the dominant cost here, not per-keystroke latency.
- **The parsing engine is native `tree-sitter`; grammars load as WASM
  modules loaded at runtime, not statically linked per language**, using
  tree-sitter's own `wasm` feature (`tree_sitter::WasmStore`, `wasmtime`
  under the hood) — the same split Zed itself uses between its first-party
  languages and its extension marketplace. A `GrammarSource` enum keeps both
  paths live: `Native` (a linked `tree-sitter-*` crate) and `WasmPending`
  (registered and routable, grammar bytes supplied later). This means adding
  or updating a language does not require recompiling or redistributing the
  host binary once WASM loading is wired up.
- **This slice ships six languages as `Native`** — Rust, Python, Go,
  TypeScript, TSX, and JavaScript (the last two reuse the TSX grammar, as
  Zed's own language configs do) — because their grammar crates are
  published, stable, and match Zed's own pinned versions where Zed vendors
  them directly:

  | Language | Crate | Version | Matches Zed |
  | --- | --- | --- | --- |
  | Rust | `tree-sitter-rust` | 0.24.2 | Yes — identical pin |
  | Python | `tree-sitter-python` | 0.25.0 | Yes — identical pin |
  | Go | `tree-sitter-go` | 0.25.0 | Yes — identical pin |
  | TypeScript / TSX / JavaScript | `tree-sitter-typescript` | 0.23.2 | Close — Zed pins a `zed-industries` fork of the same grammar for an upstream PR; we track the plain upstream release |

  Java, C#, Swift, Kotlin, and SQL are registered as `WasmPending` — visible
  in `host.describe` and routable, but `ontology.extract` reports
  `grammar-unavailable` until a `.wasm` grammar buffer is wired in (Spec
  task, not this ADR). Zed's own extensions for these languages live in its
  separate `zed-industries/extensions` marketplace repository, which we could
  not fetch to confirm exact pinned revisions; the candidate grammars, picked
  by adoption on crates.io, are `[NEEDS CLARIFICATION: confirm against Zed's
  extension registry before pinning]`:

  | Language | Candidate crate | Source repo | crates.io downloads |
  | --- | --- | --- | --- |
  | Java | `tree-sitter-java` | `tree-sitter/tree-sitter-java` | 10.9M |
  | C# | `tree-sitter-c-sharp` | `tree-sitter/tree-sitter-c-sharp` | 5.8M |
  | Swift | `tree-sitter-swift` | `alex-pinkus/tree-sitter-swift` | 5.1M |
  | Kotlin | `tree-sitter-kotlin-ng` | `tree-sitter-grammars/tree-sitter-kotlin` | 2.3M (vs. 0.4M for the older `fwcd/tree-sitter-kotlin`) |
  | SQL | `tree-sitter-sequel` | `derekstride/tree-sitter-sql` | 1.0M |

- **Per-language entity queries are original, not ported from Zed.** Zed's
  `.scm` query files are GPL-licensed editor outline queries with UI-specific
  concerns (test-runnable detection, breadcrumb context, nested variable
  capture) this use case does not need. We wrote a smaller, original query
  set per language — same `@item`/`@name` tree-sitter capture-naming
  convention (that convention is a mechanism, not Zed's expression), scoped
  to named declarations relevant to an ontology (classes, functions, methods,
  interfaces, structs, traits, enums, modules).
- **Cross-file relationships are explicitly out of this decision.** This
  service answers "what entities does this file define," not "who calls
  this" or "what does this import resolve to" — matching the boundary
  tree-sitter itself has in Zed. A later relationship-resolution stage can
  reuse `oxc_semantic`'s existing scope/binding data for JS/TS and will need
  its own design for the other languages (name/import resolution, or a
  `stack-graphs`-style approach) — not decided here.

## Consequences

Studio gains a per-file structural entity extractor for six languages today,
with the remaining five routable but inert until their grammars are loaded.
The wire, transport, and packaging shape is proven (three sibling hosts
already ship this way), so the new risk surface is narrow: the grammar
registry and the entity queries. Any future language addition is one
`languages::<name>` module (native) or one WASM buffer (pending) — it does
not touch the wire protocol. The explicit non-goal on cross-file
relationships means Studio's Ontology view cannot show call graphs or
inheritance edges from this service alone until a follow-up ADR picks a
resolution strategy; presenting only per-file entities in the interim must
not be framed as a full ontology graph.
