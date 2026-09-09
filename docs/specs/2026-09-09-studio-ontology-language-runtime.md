# Studio Ontology Language Runtime

## Traceability

- Spec ID: studio-ontology-language-runtime
- Status: Core implementation verified locally (macOS arm64, 6 of 11 languages
  native); Desktop/Electron wiring, packaging, and WASM grammar loading for
  the remaining 5 languages are not started
- Request: analyze Zed's tech stack for the memories Ontology module, decide
  between Rust+XPC+WASM-per-language and a Node/`web-tree-sitter` approach,
  record the decision, and start the implementation
- ADR: [Ontology Language Analysis Runtime](../adrs/ontology-language-runtime.md) (`ADR-0009`)

## Intent

Studio's memories module wants an Ontology view of a target project. Memories
are a summarized recollection of a session; they are not a structural index
of source code, so the entity layer (functions, classes, interfaces, …) has
to come from parsing. ADR-0009 decided that parsing runs in a new Rust
sidecar, `harness-ontology-service`, alongside the existing `oxc-service` /
`acp-host` / `evidence-host` hosts, using native tree-sitter for the engine
and letting individual language grammars load as WASM modules rather than
being permanently statically linked.

This spec covers the first slice: the host itself (wire protocol, grammar
registry, entity extraction, NSXPC bridge) and six languages working
end-to-end natively. It does not cover wiring the host into
`studio-runtime.mjs`/Desktop, packaging, or the WASM loading path for the
other five languages — those are follow-ups, matching how
`2026-09-08-rust-evidence-host.md` split its first six host adapters from
`2026-09-08-rust-evidence-host-remaining-adapters.md`.

## Acceptance Scenarios

- **AC-1** Given the built `harness-ontology-service` binary, when a
  `host.describe` request is sent over stdio, then the response reports
  `protocol: "ontology-rust-0.1.0+jsonl-v1"`, the process pid, and
  `platforms: ["stdio", "nsxpc"]`.
- **AC-2** Given the same binary, when a `languages.list` request is sent,
  then the response lists all eleven registered languages (`rust`, `python`,
  `go`, `typescript`, `tsx`, `javascript`, `java`, `csharp`, `swift`,
  `kotlin`, `sql`) each with `id`, `displayName`, `extensions`, and `source`
  (`"native"` for the first six, `"wasm-pending"` for the last five).
- **AC-3** Given source text for any of the six native languages, when
  `ontology.extract` runs with an explicit `language` or a recognized
  filename extension, then the result contains `language`, `source:
  "native"`, and a nested `entities` tree (`kind`, `name`, byte/row/column
  `range`, `children`) whose nesting matches the source's actual lexical
  containment (a method inside a class is that class entity's child, not a
  sibling).
- **AC-4** Given a `wasm-pending` language (Java, C#, Swift, Kotlin, or SQL),
  when `ontology.extract` runs against it, then the response is an explicit
  `grammar-unavailable` error, never a silent empty `entities: []` and never
  a panic.
- **AC-5** Given an unknown language id, an unrecognized filename extension
  with no `language` override, or source over 2 MiB, then `ontology.extract`
  fails with `language-not-found` or `source-limit` respectively, and the
  process keeps serving subsequent requests.
- **AC-6** The JSONL envelope matches the existing three hosts: `version: 1`,
  4 MiB request / 16 MiB response ceilings, fail-closed on malformed frames,
  unknown methods, unknown fields, and a non-`1`/zero `id`or `version`.
- **AC-7** Given macOS, the crate provides `harness-ontology-xpc`
  (`NSXPCListener` service, exported protocol `HarnessOntologyProtocol`,
  service name `com.qoder.harness-studio.ontology`) and
  `harness-ontology-client` (NSXPC-to-stdio forwarder), structurally
  identical to `harness-oxc-service`'s pair — same request/response framing,
  same 30s reply deadline, same `pid`/`bridgePid`/`transport` identity proof
  the Node wrapper would check. Off macOS both exit non-zero.
- **AC-8** Native tests cover: envelope faults (AC-6), each of the six native
  languages producing at least one correctly-named, correctly-nested entity,
  extension-based language inference, and both `wasm-pending` and
  unknown-language/extension error paths (AC-4, AC-5).

## Non-goals

- Wiring `studio-runtime.mjs` / Desktop to spawn this host, a Node
  `createRustOntologyService` client wrapper, or any Studio UI for the
  Ontology view. This spec is the driver only.
- Desktop packaging (`rust.mjs` staging, `after-pack.mjs` signing, a
  development `Harness Ontology.app`) — follow the pattern
  `2026-09-08-rust-evidence-host.md`'s Packaging section already
  established, once there is a Node caller to stage the binary for.
- Loading real `.wasm` grammar buffers for Java, C#, Swift, Kotlin, or SQL.
  `GrammarSource::WasmPending` and the `wasm` cargo feature on `tree-sitter`
  are wired so this is additive, not a redesign, but fetching/building each
  `.wasm` (via `tree-sitter build --wasm` or a vendored prebuilt package) and
  exercising `tree_sitter::WasmStore::load_language` is unstarted.
- Cross-file relationships — calls, imports, type hierarchy. This service
  reports what one file defines, not how files relate; ADR-0009's Decision
  is explicit that this is a separate, later design (candidates: reuse
  `oxc_semantic` for JS/TS, or a `stack-graphs`-style resolver for the rest).
- Confirming the Java/C#/Swift/Kotlin/SQL grammar choices against Zed's
  actual `zed-industries/extensions` pins — that repository was not
  reachable during this work; the ADR's table is the best available
  evidence (crates.io adoption), not a verified match. `[NEEDS
  CLARIFICATION: confirm before treating the pending grammar table as
  final]`.
- Caching parsed trees, parser/query reuse across requests, or any
  performance work beyond what falls out of native tree-sitter. Each
  `ontology.extract` call parses fresh.
- Go's plain `type Foo = Bar` alias entities (only `struct`/`interface`
  type specs are captured today — see the comment in `languages/go.rs`).

## Plan and Tasks

### Capability shape

```
Studio Node (not built in this slice)
  createRustOntologyService({ executable, transport })
    -- JSONL stdio --
  harness-ontology-client          (macOS)
    -- NSXPC performRequest:reply: --
  harness-ontology-xpc             (launchd)
    -- stdio --
  harness-ontology-service         (driver; Windows/Linux spawn this directly)
```

### Wire

Newline-delimited JSON, envelope identical in shape to `oxc-service` /
`evidence-host`: `{ version, id, method, params }` in, `{ version, id, pid,
result }` or `{ version, id, error: { code } }` out.

| method | params | result |
| --- | --- | --- |
| `host.describe` | `{}` | `{ protocol, pid, platforms }` |
| `languages.list` | `{}` | `{ languages: [{ id, displayName, extensions, source }] }` |
| `ontology.extract` | `{ filename, language?, source }` | `{ language, source, entities }` |

### Grammar registry (`src/grammar.rs`, `src/languages/`)

`GrammarSource::Native(fn() -> tree_sitter::Language)` for a linked crate, or
`GrammarSource::WasmPending` for a language with no grammar loaded yet. Each
native language is one module under `src/languages/` supplying its grammar
function and an original entity query (`@item.<kind>` / `@name` captures);
`src/languages/pending.rs` supplies the five `WasmPending` entries. Adding
WASM loading later means adding a `Wasm { name, bytes }` variant and a
`tree_sitter::WasmStore`-backed `LanguageEntry::language()` branch — the
wire protocol and `entity.rs` do not change.

### Entity extraction (`src/entity.rs`)

Parse once, run the language's query once via `QueryCursor`, collect
`(kind, name, byte range)` per `@item.*`/`@name` match pair, then
reconstruct nesting with a stack keyed on byte-range containment (an item
closes, and attaches to whatever remains below it, once the next item's
start byte reaches or passes its end byte). This generalizes the
depth-only stack Zed's `Buffer::outline_items_containing_internal` uses
into actual parent/child `Entity` nesting.

### Packaging note (for the follow-up, not this slice)

Same shape as `evidence-host`: `harness-ontology-service` in
`Resources/native` (all platforms) and inside the `.xpc` on macOS,
`harness-ontology-client` in `Contents/MacOS`,
`com.qoder.harness-studio.ontology.xpc` holding `harness-ontology-xpc` plus
the nested driver, and a development `Harness Ontology.app` so launchd can
find the service without modifying Electron.app.

## Test and Review Evidence

Local macOS arm64, Rust 1.96.0 (via `cargo +1.96.0`, since the shell default
resolved to 1.95.0 and every other Rust crate in this repo pins
`rust-version = "1.96"`), 2026-09-09:

| AC | Evidence |
| --- | --- |
| AC-1 | `wire::tests::host_describe_reports_protocol_and_pid`; manual stdio run confirmed `protocol":"ontology-rust-0.1.0+jsonl-v1"` and matching pid. |
| AC-2 | Manual stdio `languages.list` run returned all 11 ids with correct `source` labels (6 `native`, 5 `wasm-pending`). |
| AC-3 | `entity::tests::nests_a_method_inside_a_class`, `rust_captures_struct_impl_and_method`, `go_captures_struct_and_method_with_receiver`, `typescript_captures_interface_and_class_method`, `tsx_and_javascript_share_the_typescript_grammar_family`, `sibling_functions_stay_at_the_same_level`, `language_is_inferred_from_filename_when_omitted`. Manual stdio run against a Python class+method confirmed real byte/row/column ranges. |
| AC-4 | `entity::tests::wasm_pending_language_is_explicit_not_silent` (`.java` source resolves to `grammar-unavailable`, not empty entities). |
| AC-5 | `entity::tests::unknown_language_and_extension_are_rejected`, `oversized_source_is_rejected_before_parsing`. |
| AC-6 | `wire::tests::rejects_unknown_fields_versions_and_methods`, `truncated_and_oversized_frames_are_bounded`. |
| AC-7 | `cargo +1.96.0 test` built `harness-ontology-xpc` and `harness-ontology-client` successfully on macOS (objc2/NSXPC compiles clean); behavior is a mechanical mirror of `harness-oxc-service::nsxpc`, not independently exercised over a live launchd connection in this slice. |
| AC-8 | `cargo +1.96.0 test` in `rust/ontology-service`: 13 passed, 0 failed. |

```
cargo +1.96.0 test
running 13 tests
test entity::tests::wasm_pending_language_is_explicit_not_silent ... ok
test entity::tests::unknown_language_and_extension_are_rejected ... ok
test entity::tests::oversized_source_is_rejected_before_parsing ... ok
test wire::tests::host_describe_reports_protocol_and_pid ... ok
test wire::tests::rejects_unknown_fields_versions_and_methods ... ok
test wire::tests::truncated_and_oversized_frames_are_bounded ... ok
test entity::tests::go_captures_struct_and_method_with_receiver ... ok
test entity::tests::nests_a_method_inside_a_class ... ok
test entity::tests::language_is_inferred_from_filename_when_omitted ... ok
test entity::tests::sibling_functions_stay_at_the_same_level ... ok
test entity::tests::rust_captures_struct_impl_and_method ... ok
test entity::tests::typescript_captures_interface_and_class_method ... ok
test entity::tests::tsx_and_javascript_share_the_typescript_grammar_family ... ok
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

Manual end-to-end stdio smoke test (`cargo +1.96.0 run --bin
harness-ontology-service`, three piped requests):
`host.describe` → `{"protocol":"ontology-rust-0.1.0+jsonl-v1","pid":41191,"platforms":["stdio","nsxpc"]}`;
`languages.list` → all 11 languages with correct `source`; `ontology.extract`
on a two-line Python class → `Greeter` (class) containing `hello` (function)
with correct byte/row/column ranges.

`cargo +1.96.0 fmt` applied; `cargo +1.96.0 clippy` was not run (the `clippy`
component is not installed for the 1.96.0 toolchain in this environment —
`rustup component add --toolchain 1.96.0-aarch64-apple-darwin clippy` is
needed before that gate can be closed).

`cargo +1.96.0 build --release --bins` (exercising `lto = "thin"`/`strip`)
succeeded. Binary sizes (macOS arm64):

| Binary | Size | Notes |
| --- | --- | --- |
| `harness-ontology-client` | 687 KB | NSXPC-to-stdio forwarder; no tree-sitter or wasmtime linked |
| `harness-ontology-service` | 7.0 MB | Driver: tree-sitter core + 4 native grammar crates + wasmtime (for the `wasm` feature, unused by any grammar yet) |
| `harness-ontology-xpc` | 7.0 MB | NSXPC listener; links the same library as the driver, so it matches its size |

Most of the 7.0 MB is wasmtime's Cranelift JIT backend, pulled in by the
`wasm` feature even though no `.wasm` grammar is loaded yet — worth
revisiting (a lighter-weight WASM runtime, or making `wasm` an opt-in
feature the desktop build enables only once a language actually needs it)
once real WASM grammar loading is implemented, so this is noted here rather
than treated as a settled cost.

Risk: the Java/C#/Swift/Kotlin/SQL grammar choices in ADR-0009 are picked by
crates.io download counts, not a confirmed match to Zed's own extension
pins — treat that table as a starting point for the WASM-loading follow-up,
not a settled dependency lock. The entity queries are original (see
ADR-0009's Decision on why), so their coverage is narrower than an
editor-grade outline: no field/const/static/macro entities, and Go's plain
type aliases are not captured. None of this is wired to Studio yet; the
Ontology UI has nothing to call today.
