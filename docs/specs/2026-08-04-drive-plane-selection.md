# Drive plane selection for agent verification

## Traceability

- Spec ID: drive-plane-selection
- Status: Implemented

## Intent

Add a companion reference for `references/project-harness/agent-verify-loop.md`
that owns the missing axis in the current verification model: **where the agent
injects control into the system under verification**, and what that choice costs
in observability, isolation, and judging expense.

The existing model has two axes and neither answers the question:

- `agent-verify-loop.md` Scenario Families answers *what is verified* (service
  chain, web UI, mini-program, mobile app, CLI, pipeline, model output, IaC).
- `verification-environment.md` Fidelity Ladder answers *how real the
  dependencies are* (L0 preflight .. L5 real-boundary calibration).

Neither distinguishes a browser driven through an in-browser automation protocol
from the same browser driven through operating-system input events with
screenshot-based judging. Both are the `Web UI` family, and both can sit at
Fidelity Ladder L3, yet their trigger shape, evidence set, isolation model,
cleanup obligations, parallelism limits, and failure modes differ enough that an
agent cannot pick between them from the current references. Coding agents now
reach for browser-automation drivers, attach-mode browser agents, and
computer-use desktop loops interchangeably; without a stated axis the choice is
made by tool availability rather than by the verification claim.

The reference must also record the concrete technology classes behind each
plane, because the recurring failure is not choosing the wrong family — it is
assuming that a driver which can read the DOM and a driver which can only see
pixels produce evidence of the same strength.

## Recorded Field Observations

Provenance: a field write-up contrasting a Playwright-based verification chain
with a Windows desktop automation chain, reviewed on 2026-08-04, plus repository
observations from `AGENTS.md` and
`scripts/harness-analysis/validate-canvas.mjs`. No new services or tests were
run for this spec; these are design inputs, not runtime validation.

A second evidence source was collected on 2026-08-04 by scanning local Codex
session transcripts (`~/.codex/sessions` rollout JSONL): 70 sessions containing
UI-verification evidence, 57,879 extracted commands plus all tool calls. The
scan scripts are local one-offs (not repository assets); headline counts are
recorded here so the reference does not depend on private transcripts:

- Attach-mode browser driving (`agent-browser --cdp` against a running
  Electron/IDE instance) appeared in 25/70 sessions (1,041 commands) — the D2
  plane below — while OS accessibility driving
  (`computer_use.get_app_state`/`click` by element index) accounted for ~490
  tool calls — the D3 plane.
- Observation split in the wild: accessibility-tree snapshots (667) and DOM
  `eval` state dumps (299) served as structural oracles; screenshots (151
  captures, 240 `view_image` model-judged reads) served as the visual channel.
- Pixel-diff tooling was used 0 times in 70 sessions; masks 3 times; viewport
  pinning in 4/70 sessions. The de-facto visual judge was the driving model's
  own multimodal read — exactly the same-model drive/judge hazard DPS-AC-4
  addresses.
- 166 of 236 distinct screenshot paths were overwritten and re-viewed under
  the same name, so no visual baseline survived a session; naming idioms were
  before/after (41) and numbered step sequences (40) rather than
  baseline/expected (4).
- Fixed waits (`wait <ms>`/`sleep`) appeared in 29/70 sessions (999 commands)
  versus bounded polling loops in 17/70 — terminal conditions are the
  exception, not the rule, at D2/D3.
- The observed D3 loop shape was `list_apps → get_app_state → click(element
  index) → get_app_state` (state re-read as judge; element indexes never
  cached), and the observed locate fallback ladder was CSS selector →
  text/aria match → raw coordinates from a previous DOM `eval`.

### The compared chains

```text
Playwright chain:
  test code -> Playwright client -> browser automation protocol (CDP)
    -> BrowserContext/Page -> DOM locators, protocol-level input, page events
    -> target page

Desktop chain:
  model visual decision -> desktop screenshot -> visible controls and state
    -> step driver -> window focus (accessibility/automation API)
    -> OS mouse/keyboard events -> existing browser profile and session
    -> target page -> before/after screenshots plus a JSON step record
```

The first keeps the control plane inside the browser or its automation
protocol, so the driver reads the DOM, manages contexts, and usually runs a
throwaway profile. The second keeps the control plane outside the browser: it
does not read the target page DOM, does not create a browser context, does not
inject scripts, and does not alter browser-exposed automation properties, so the
page runs inside the user's ordinary session, tab, and window lifecycle. The
cost is that structural evidence disappears and judging falls back to pixels
plus side effects.

### Decomposition into three independent axes

The two chains differ on three axes that are freely composable, not a binary
choice. Recording them separately is the point of this change.

| Axis | Playwright chain | Desktop chain |
| --- | --- | --- |
| Decision source | script-predefined steps | model decision at run time |
| Control-plane location | in-browser automation protocol | out-of-browser OS input plane |
| Session origin | fresh throwaway profile | existing real profile and login state |

Other combinations are valid and already in field use: script-driven OS
automation with a real profile, and model-driven decisions over an
automation-protocol driver attached to an existing browser. Collapsing the three
axes into "Playwright versus computer use" hides that the decision source
determines the judging mode, while the control-plane location determines the
available evidence.

### Drive planes

| Plane | Control-plane location | Structural evidence | Session realism | Judging cost | Parallel-safe |
| --- | --- | --- | --- | --- | --- |
| D0 | In-process render tree | full | none (no real browser) | lowest | yes |
| D1 | In-browser automation protocol | DOM, accessibility tree, network, console | moderate (throwaway profile) | low | yes |
| D2 | In-browser agent attached to a running browser | mostly available | high (real profile and login state) | medium | no |
| D3 | OS input and accessibility plane | accessibility tree only, or pixels only | high (ordinary user session) | high | no |
| D4 | Physical or device plane | pixels only | highest | highest | device-bound |

Observability decreases and session realism increases monotonically along the
ladder; isolation moves the opposite way from Fidelity Ladder intuition, which
is the concrete gap this reference closes.

### Technology classes per plane

Named tools are examples of a class, in the style of the
`verification-environment.md` cross-stack table, not endorsements or a closed
list.

| Plane | Technology class | Examples |
| --- | --- | --- |
| D0 | Component render harness | Testing-library style renderers, jsdom, in-browser component runners |
| D1 | Automation-protocol driver | Playwright, Puppeteer, Selenium/WebDriver, WebDriver BiDi, raw Chrome DevTools Protocol |
| D2 | Attach-mode browser agent | Extension or DevTools-protocol agents attached to an already-running browser, browser-control MCP servers |
| D3 | OS input driver | Windows UI Automation and `pywinauto`, cross-platform input synthesis such as `PyAutoGUI`, macOS Accessibility API and System Events scripting, X11/Wayland input tools |
| D3 | Computer-use agent loop | Screenshot-in, action-out model loops that emit click/type/scroll steps |
| D3 | Terminal/TUI driver | Pseudo-terminal drivers, `tmux` control mode, expect-style scripts |
| D3/D4 | Mobile driver | ADB and `uiautomator`, Appium, XCUITest, Maestro, device farms |
| D1' | Vendor devtools driver | Mini-program devtools automation, platform emulators and simulators |
| Observation only | Network observation and virtualization | Recording/forwarding proxies, service virtualizers |
| Observation only | Vision judge | Vision-model screenshot judging against a rubric |
| Observation only | State oracle | Direct state, table, log, or trace queries |

### Drive plane and observation plane must be named separately

An automation-protocol driver is both driver and observer, which is why the two
roles are usually conflated. The desktop chain separates them: it drives through
the OS and observes through screenshots plus a JSON step record. The transferable
rule is that a drive adapter (an Exercise-plane asset) and an observation adapter
(a Judge-plane asset) are chosen independently, and a low drive plane must be
compensated with stronger side-effect evidence — persisted state, emitted
events, network calls, backend records — rather than with model confidence.

When the same model both drives and judges, the loop has no independent oracle
and lands directly on the existing `Self-reported success` anti-pattern.

### Shared six-step pattern

Every plane runs the same skeleton, and the differences concentrate in three
steps.

```text
acquire session -> reset state -> locate target -> apply action
  -> wait for terminal condition -> collect evidence and judge -> clean up
```

| Step | D1 | D2 | D3 |
| --- | --- | --- | --- |
| Acquire session | create a fresh context | attach to a running browser, require window focus | focus a real window, require foreground exclusivity |
| Reset state | context isolation is the reset | explicit sign-out or storage reset; no inherent isolation | scripted desktop and profile state reset |
| Locate target | selector or role query | selector or role query | accessibility tree, or template/text recognition on pixels |
| Wait | render-idle and network-idle signals | same as D1 | pixel stability plus a mandatory deadline |
| Collect evidence | DOM snapshot, screenshot, network, console | same as D1 | before/after screenshots, JSON step record, independent state oracle |
| Clean up | close the context | restore the user profile state | close windows, restore focus; must run after failure and timeout |

The real risk at D2 and D3 is not driving but reset and cleanup: reusing a real
profile means a run mutates user state, and an OS input plane is exclusive, so
concurrent runs corrupt each other. A missing terminal condition at D3 turns a
settling page into either a hung loop or a flaky verdict.

## Acceptance Scenarios

- **DPS-AC-1 (axis decomposition):** The reference separates decision source,
  control-plane location, and session origin as independent axes, and states
  that the popular two-way framing of automation-protocol versus computer-use
  driving conflates them.
- **DPS-AC-2 (drive plane ladder):** The reference defines drive planes D0
  through D4 by control-plane location, each with its available structural
  evidence, session realism, judging cost, and parallel-safety, and states the
  monotonic trade-off between observability and session realism.
- **DPS-AC-3 (plane and observation split):** The reference requires a drive
  adapter and an observation adapter to be selected and recorded separately, and
  requires a lower drive plane to compensate with side-effect evidence rather
  than model confidence.
- **DPS-AC-4 (independent judge at low planes):** When the driving model is also
  the judging model, the reference requires an independent oracle plus a
  known-bad control before a `pass` verdict is admissible, routing to the
  existing oracle-independence guidance.
- **DPS-AC-5 (technology map):** The reference records the technology classes
  behind each plane with concrete examples, labelled as class examples rather
  than a closed or endorsed list, including automation-protocol drivers,
  attach-mode browser agents, OS input drivers, computer-use loops, terminal
  drivers, mobile drivers, vendor devtools drivers, and observation-only
  adapters.
- **DPS-AC-6 (six-step pattern with per-plane deltas):** The reference gives one
  shared six-step execution skeleton and a per-plane delta table covering
  session acquisition, state reset, locating, terminal condition, evidence, and
  cleanup, and names reset, cleanup, and exclusivity as the dominant D2/D3
  risks.
- **DPS-AC-7 (isolation inversion recorded):** The reference states that a
  real-profile browser has higher session realism but lower isolation than the
  Fidelity Ladder L3 isolated real browser, and that this inversion must be
  recorded in the case `constraints` instead of being read as a higher rung.
- **DPS-AC-8 (self-execution wiring):** The reference states how a drive
  adapter becomes something an agent runs without prompting: a single named
  entrypoint command, the drive adapter and correlation handle recorded in the
  case `trigger` field, cost-tiered escalation from the cheapest sufficient
  plane, a machine-parseable verdict-first output using the four-valued verdict
  domain, an enforcement point that fires when the agent claims completion, and
  repaired failures promoted into the regression skeleton.
- **DPS-AC-9 (ownership and routing):** The reference declares its ownership
  boundary against `agent-verify-loop.md` (planes, verdicts, scenario families,
  skeleton shape) and `verification-environment.md` (dependency fidelity,
  environment contract, oracle independence). The Exercise plane in
  `agent-verify-loop.md` routes to it, `verification-environment.md` routes to
  it from its browser fidelity row or ladder note, and
  `references/project-harness/README.md` registers it under `Owns` and
  `Read Next`.
- **DPS-AC-10 (link integrity):** All relative Markdown links to and from the
  reference resolve, and `docs/better-harness-doc-links.mmd` is regenerated so
  the routing graph is not stale.

## Non-goals

- Ship an executable driver, adapter registry, screenshot-diff runner, or any
  runtime tooling; the reference stays prose.
- Provide guidance on evading bot detection, anti-automation controls, or risk
  systems. Session realism is scoped to verification fidelity on systems the
  team is authorized to exercise; verifying payment, login, or other
  high-authority flows keeps the authorization, read-only scope, redaction, and
  environment-boundary requirements already owned by
  `verification-environment.md`.
- Redefine or extend the Fidelity Ladder rungs, the four planes, the verdict
  domain, or the Scenario Families table. This change adds an axis and routes to
  it; it does not renumber existing calibrated models.
- Add rows to the Scenario Families table. That table answers what is verified;
  mixing in how the system is driven would blur both axes.
- Endorse a vendor, or claim that any named tool preserves a given behavior on a
  given platform.
- Change scoring models, report schemas, skills, scripts, templates, hooks, or
  host adapters.

## Plan and Tasks

1. Add `references/project-harness/ui-and-system-drivers.md` with the ownership
   boundary, a `Load When` block, the three-axis decomposition, the D0..D4 drive
   plane table, the technology-class map, the drive/observation split rule, the
   shared six-step pattern with per-plane deltas, the self-execution wiring, and
   an anti-pattern list.
2. Route the Exercise plane in `references/project-harness/agent-verify-loop.md`
   to the new reference with one sentence, without moving verdict, family, or
   skeleton ownership.
3. Route `references/project-harness/verification-environment.md` to the new
   reference where browser fidelity is selected, and record the
   realism-versus-isolation inversion as a pointer rather than a new rung.
4. Register the reference in `references/project-harness/README.md` under `Owns`
   and `Read Next`.
5. Regenerate the routing graph with
   `node scripts/doc-link-graph/cli.mjs skills/better-harness`, then run the
   focused link and model tests followed by the full suite.
6. Run a Review Readiness Check over the local diff before review.

## Test and Review Evidence

Implemented on 2026-08-04:

- `node scripts/doc-link-graph/cli.mjs skills/better-harness` — routing graph
  regenerated (36 files, 52 links).
- `node --test test/doc-link-graph.test.mjs` — 6/6 pass; relative link
  resolution and routing-graph freshness (DPS-AC-10).
- `node --test test/maturity-models.test.mjs` — 3/3 pass; consumer integrity
  for the routed references (DPS-AC-9).
- `npm test` — full suite, 1149/1149 pass.
- `git diff --check` — clean.
- DPS-AC-1..DPS-AC-8: manual contract review against the reference headings,
  tables, and anti-pattern list in
  `references/project-harness/ui-and-system-drivers.md`.

## Risks

- **Axis proliferation:** a third axis on top of scenario families and the
  fidelity ladder can make the model harder to apply than the problem it solves.
  Mitigate by keeping the new reference selection-only and routing rather than
  restating the other two models.
- **Tool-list decay:** named drivers and agent tools change faster than the
  framework. Mitigate by presenting them as class examples with a provenance
  date, matching the existing cross-stack table convention.
- **Realism read as fidelity:** a real-profile session can be mistaken for a
  higher fidelity rung, hiding lost isolation and unsafe parallelism. Mitigate
  with DPS-AC-7 and explicit reset/cleanup obligations.
- **Model-judged pixels:** at D3 and D4 the driving model can also judge the
  screenshots and produce consistently confident false passes. Mitigate with
  DPS-AC-4, requiring an independent oracle and a known-bad control.
- **Authorization drift:** discussion of real login state invites exercising
  production accounts. Mitigate by keeping the authorization boundary owned by
  `verification-environment.md` and restating it as a constraint, not guidance.

## Open Questions

- [NEEDS CLARIFICATION: whether a future change should add a Fidelity Ladder
  rung, or a per-rung isolation column, for real-profile and OS-driven sessions.
  This spec deliberately routes instead of renumbering, because the ladder is a
  calibrated consumer surface; changing it needs a maintainer decision.]
- [NEEDS CLARIFICATION: whether the repository's own visual verification
  contract in `AGENTS.md` should name its drive plane explicitly (currently a
  D1 automation-protocol driver against the preview URL) once the reference
  lands.]
