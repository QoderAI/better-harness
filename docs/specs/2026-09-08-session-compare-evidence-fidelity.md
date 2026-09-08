# Preserve session evidence in Compare

## Traceability
- Spec ID: session-compare-evidence-fidelity
- Status: Implemented; local validation complete
- Request: Compare Sessions screenshot shows missing titles and generic tool sequences.

## Intent
Correct proven parser losses and carry retained evidence through to the comparison surface. A count or fallback name must not hide the user request, tool details, files, or retained responses.

## Acceptance Scenarios
- AC-1: Qoder counts requests once by call identity; shell and completion records update existing calls. Tool names, request details, status, paths and observed duration survive segmented, ordered logs.
- AC-2: Codex response-item user messages provide titles; injected environment/instruction blocks are not user requests. Function/custom requests correlate with outputs by call id, without counting output or echo records as new requests.
- AC-3: Actual outer Code Mode tool names remain honest; retained code/arguments are available as bounded, privacy-filtered detail rather than an unexplained repeated exec label.
- AC-4: Compare exposes retained prompts, responses, tool details/status/duration and file references, with relevant observed session metadata. Unknown values remain unavailable instead of zero or success.
- AC-5: Multi-file calls remain one call in Compare; resource projections cannot inflate sequences. Chronology is deterministic.
- AC-6: Fixture parser, provider/API and browser tests prove the chain. Validate the two screenshot sessions locally through the Rust host and Studio projection, reporting source/runtime and installed-host evidence separately.

## Non-goals
No new providers, arbitrary execution of stored code, interpretation of encrypted reasoning, billing estimates, release changes, native installation, or claims of complete parity for all provider formats. Keep the existing protocol additive and retain legacy comparison fields.

## Plan and Tasks
1. Extend the bounded Rust evidence model and repair the Qoder and Codex parsers using observed record shapes.
2. Preserve details and call identity through Inspector workspace projection; enrich the Compare response and UI using existing evidence types and semantic tokens.
3. Add synthetic privacy-safe fixtures for each observed failure; validate Rust discovery, JS projection, API and browser behavior.

## Test and Review Evidence
Initial source audit: Qoder matches every type containing tool and ignores data.tool_name; Codex ignores response_item user messages; Compare emits only tool.name and the provider expands one call per resource. The observed Qoder session has four request ids, while the old parser yields thirteen tool lifecycle entries. The screenshot Codex rollout contains six response-item user records; removing injected blocks while retaining the appended request yields five actual requests. AI implementation: Codex.


### Implementation boundaries
- Qoder requests are keyed by `tool_call_id`; shell records contribute exit/output metadata without becoming additional calls. Output sidecar paths are not opened. Missing result text remains unavailable.
- Codex uses native response-item messages when present and supports legacy event messages. Repeated user turns remain distinct; paired message echoes and duplicate call ids do not inflate counts. Encrypted reasoning is not interpreted.
- Models and token fields reflect recorded values. Cumulative Codex token snapshots replace earlier totals; Qoder inference records contribute observed fields. Missing token fields stay absent.
- Native text is capped at 8,000 characters per field, then shares a 64 KiB UTF-8 text budget per discovered session. Excerpts are marked, while call identity/count/status and message chronology remain intact. This is a bounded evidence snapshot, not a full transcript export.
- The shared Studio provider filters retained text before both Inspector and Debugger/Compare consume it, including quoted JSON credential fields. Multi-resource projections retain one source call identity.

### Acceptance evidence
| Coverage | Validation | Result |
| --- | --- | --- |
| AC-1, AC-2, AC-3, AC-5 | Rust parser fixtures for segmented ordering, lifecycle/output pairing, native/legacy messages, injected blocks, repeated turns, observed usage, explicit path fields and Unicode snapshot budgets | 21 passed locally with Rust 1.96 |
| AC-3, AC-4, AC-5 | Studio provider and HTTP comparison tests, including quoted-credential filtering, zero versus absent token fields, tool details and deduplication across multiple resources | 60 passed |
| AC-4, AC-6 | Playwright project/Compare flow: 1440×900, 1024×768, 390×844; keyboard expansion, bounded overflow and console/page error checks | Passed; screenshots retained under Studio test-results |
| AC-6 | Real Rust stdio host → bundled workspace provider → Studio HTTP comparison | Qoder: 4 Bash calls, 3 completed and 1 observed. Codex: 227 returned calls, 5 requests and 21 assistant messages. Both have actual titles and retained input detail |
| Transport | Real 100-session discovery after bounding | Approximately 6.2 MB response; Studio project open returned HTTP 200 in 44.4 seconds with the default host timeout |
| Build | Studio TypeScript and app build | Passed locally |
| Documentation | `test/skills-docs/doc-link-graph.test.mjs`; routing graph regeneration | 8 passed; routing graph unchanged |
| Preview | `npm run preview`; `/health` and `/canvas-module.js` | Both HTTP 200 |

### Review readiness
The change is linked to the reported Compare defect and ACs above; no external Story or CI receipt is claimed. Native schema additions require default fields in the existing provider constructors, without changing those providers' parsing behavior. The current diff also contains concurrent Git-history/date-filter work outside this spec; that work is excluded from this change's review and commit scope. Generated build files and test screenshots are not staged.

Remaining limits: validation uses a locally built Rust host and Studio preview on macOS, not a repackaged or installed desktop application. Windows/Linux CI was not run here. Very long histories retain bounded excerpts; unavailable source output, encrypted reasoning, and inferred inner Code Mode calls are not presented as recovered evidence.
