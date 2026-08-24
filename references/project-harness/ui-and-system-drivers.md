# UI and System Drivers

Use this reference to choose **where the agent injects control** into the
system under verification — in-process, through a browser automation protocol,
by attaching to a running browser, through the operating system's input and
accessibility plane, or against a physical device — and to record what that
choice costs in observability, isolation, judging expense, and parallelism.

[Agent Verify Loop](agent-verify-loop.md) Scenario Families answer *what is
verified*. The [Verification Environment](verification-environment.md)
Fidelity Ladder answers *how real the dependencies are*. Neither distinguishes
a browser driven through an automation protocol from the same browser driven
through OS input events with screenshot judging: both are the `Web UI` family
and both can sit at Fidelity L3, yet their trigger shape, evidence set,
isolation model, cleanup obligations, and failure modes differ enough that an
agent cannot pick between them from those two axes alone. Without a stated
axis the choice is made by tool availability, not by the verification claim.

## Ownership Boundary

This reference owns:

- the three-axis decomposition of driving decisions (decision source,
  control-plane location, session origin);
- the D0..D4 drive plane ladder and its trade-off table;
- the technology-class map behind each plane;
- the within-plane filter on what failure evidence a driver emits for an agent;
- the degradation path when a tool boundary makes the chosen plane unreachable;
- the rule that drive adapters and observation adapters are selected and
  recorded separately; and
- the shared six-step execution skeleton with per-plane deltas.

It does not own the four verify-loop planes, the verdict domain, the
scenario families, or the regression-skeleton shape
([Agent Verify Loop](agent-verify-loop.md)); nor dependency fidelity, the
environment contract, oracle independence, or authorization boundaries
([Verification Environment](verification-environment.md)).

## Load When

- A UI, desktop, mobile, or terminal case needs a trigger and more than one
  driver class could exercise it.
- A verify loop is being designed around an attach-mode browser agent or a
  computer-use loop, and the evidence it can produce must be stated before
  the judging mode is chosen.
- A review finds screenshot-judged acceptance where structural evidence (DOM,
  accessibility tree, state store) was available one plane lower.
- A tool boundary blocks the driver the claim asked for, and the case needs a
  degradation path instead of an unstable automation.
- A case reuses a real logged-in profile or a running application window, and
  isolation, reset, or parallelism questions surface.

## Three Independent Axes

The popular two-way framing — "Playwright versus computer use" — conflates
three axes that are freely composable. Record them separately per case:

| Axis | One end | Other end |
| --- | --- | --- |
| Decision source | script-predefined steps | model decision at run time |
| Control-plane location | in-browser automation protocol | out-of-browser OS input plane |
| Session origin | fresh throwaway profile | existing real profile and login state |

Script-driven OS automation with a real profile, and model-driven decisions
over an automation-protocol driver attached to an existing browser, are both
valid and both in field use. The decision source determines the judging mode;
the control-plane location determines the available evidence; the session
origin determines isolation and reset obligations.

## Drive Plane Ladder

Planes are ordered by control-plane location. Observability decreases and
session realism increases monotonically along the ladder — isolation moves
the **opposite** way from Fidelity Ladder intuition, which is the gap this
reference closes.

| Plane | Control-plane location | Structural evidence | Session realism | Judging cost | Parallel-safe |
| --- | --- | --- | --- | --- | --- |
| D0 | In-process render tree | full | none (no real browser) | lowest | yes |
| D1 | In-browser automation protocol | DOM, accessibility tree, network, console | moderate (throwaway profile) | low | yes |
| D2 | In-browser agent attached to a running browser | mostly available | high (real profile and login state) | medium | no |
| D3 | OS input and accessibility plane | accessibility tree only, or pixels only | high (ordinary user session) | high | no |
| D4 | Physical or device plane | pixels only | highest | highest | device-bound |

A real-profile browser (D2) or an ordinary user session (D3) has **higher
session realism but lower isolation** than the Fidelity Ladder L3 isolated
real browser. Record this inversion in the case `constraints`; do not read a
real profile as a higher fidelity rung.

Select the cheapest plane whose evidence satisfies the claim, and escalate
only on `fail`, `unobserved`, or a claim that genuinely lives higher (window
focus, OS chrome, real login state, device hardware).

## Technology Classes per Plane

Named tools are examples of a class (provenance: 2026-08), not endorsements
or a closed list.

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

## Diagnostic Artifacts Are a Second Filter

Drivers inside one plane are not interchangeable for an agent. The plane
determines what evidence exists *while* the case runs; what the driver emits
determines whether the agent can localize a break *after* it fails. Filter
within the plane on that, because it sets the cost of the diagnose step in the
[Agent Verify Loop](agent-verify-loop.md) post-verdict sequence.

| Failure artifact the driver emits | What the agent can do after a `fail` |
| --- | --- |
| Structured step trace: each action with before/after snapshot, network, console | Localize offline from one run; no rerun needed |
| Recorded replay or video | Useful to a human; an agent can use it only as far as it can address frames or steps programmatically |
| Machine-readable result report (structured or JUnit-style) | Learn which assertion broke, not why; usually needs one more run |
| Logs only | Rerun with added instrumentation, repeatedly, and hope the failure reproduces |

Two consequences follow. First, a driver one plane lower that emits a
structured trace can be the better choice over a higher-plane driver that emits
only logs, when the claim allows either. Second, an agent should drive a
task-oriented wrapper command rather than a raw driver API: the wrapper is where
the trace, the result schema, and the cleanup guarantee live. See
[Agent-Friendly CLI](friendly-cli.md) for that contract.

## When the Chosen Plane Cannot Be Reached

Tool boundaries are real: vendor devtools may not expose element-level
automation, signing, account, or store review can gate a device plane, and
custom-rendered UI may publish no accessibility tree at all. Forcing an unstable
driver at such a boundary produces oscillating verdicts, which is worse than
admitting the boundary — a flaky judge teaches the loop to ignore the judge.

Degrade by **changing evidence type**, not by dropping to a lower drive plane
that shares the same wall. The usual move is to replace element-level UI
assertions with API and persisted-state assertions, and to hand the remaining
visual or experiential detail to scheduled human sampling. Record four things
with the case:

- the evidence class forfeited (for example, element-level interaction proof);
- the substitute evidence and what it does cover;
- the owner and cadence of the human sampling that covers the rest; and
- the decision itself, in whatever decision record the project uses, because a
  successor will otherwise read the gap as an oversight.

Such a case is **not** wholesale `unobserved`. The substitute evidence carries
its own verdict for what it checks, and the forfeited part is a named residual
gap in `constraints`. Recording the whole case as `unobserved` throws away
evidence that was actually collected; recording it as `pass` without naming the
gap is a false green.

## Drive and Observation Are Separate Choices

An automation-protocol driver is both driver and observer, which is why the
two roles are usually conflated. They must be chosen and recorded
independently: the drive adapter is an Exercise-plane asset, the observation
adapter is a Judge-plane asset. A low drive plane must be compensated with
**stronger side-effect evidence** — persisted state, emitted events, network
calls, backend records — never with model confidence.

Field transcripts confirm both the practice and the hazard. Sessions driving
through an OS accessibility plane used the accessibility tree itself as the
oracle (re-reading application state after each action), and sessions driving
an attached browser dumped DOM state as structured JSON for exact assertions —
both are correct plane/observation splits. But across 70 UI-verification
sessions, pixel-diff tooling appeared zero times while the driving model
visually judged its own screenshots hundreds of times, and most screenshot
paths were overwritten in place so no baseline survived the session.

When the same model both drives and judges, the loop has no independent
oracle and lands on the `Self-reported success` anti-pattern in
[Agent Verify Loop](agent-verify-loop.md). Before such a run may report
`pass`, it needs an independent oracle plus a known-bad control, per the
oracle-independence requirements in
[Verification Environment](verification-environment.md). A model-judged
screenshot read alone is `unobserved`, not `pass`.

## Shared Six-Step Pattern

Every plane runs the same skeleton; the differences concentrate in session
acquisition, state reset, and cleanup.

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

The real risk at D2 and D3 is not driving but reset and cleanup: reusing a
real profile means a run mutates user state, and an OS input plane is
exclusive, so concurrent runs corrupt each other. A missing terminal
condition at D3 turns a settling page into either a hung loop or a flaky
verdict — and fixed `sleep`/`wait <ms>` delays dominate field transcripts
where bounded polling with a deadline was needed.

Two locate-step rules from the same transcripts:

- Never cache positional handles (element indexes, coordinates) across
  actions; re-read the accessibility tree or DOM before every interaction,
  because any re-render invalidates them.
- Degrade deliberately: semantic selector → text/aria match → raw
  coordinates, and record which level the case ended on — a coordinate-level
  locate is a determinism liability that belongs in the case `constraints`.

## Self-Execution Wiring

A drive adapter becomes something an agent runs without prompting when:

- one named entrypoint command exercises the case end to end;
- the case `trigger` field records the drive adapter and the correlation
  handle, per the [Agent Verify Loop](agent-verify-loop.md) skeleton shape;
- plans start from the cheapest sufficient plane and escalate on `fail` or
  `unobserved`, never by default;
- output is machine-parseable verdict-first, using the four-valued verdict
  domain;
- an enforcement point fires when the agent claims completion — a claim
  without a matching drive-adapter run is non-passing evidence; and
- every diagnosed-and-repaired failure is promoted into the regression
  skeleton through the existing human gate.

## Anti-Patterns

- **Plane by availability:** choosing computer-use or an attach-mode agent
  because it is installed, when the claim needed only D0/D1 structural
  evidence.
- **Forcing an unstable plane:** insisting on element-level automation at a
  known tool boundary and living with oscillating verdicts, instead of
  degrading to another evidence type and recording the forfeited class, the
  substitute, the human-sampling owner, and the decision.
- **Realism read as fidelity:** treating a real-profile session as a higher
  fidelity rung instead of recording the isolation loss in `constraints`.
- **Same-model drive and judge:** the driving model visually approves its own
  screenshots; without an independent oracle and a known-bad control this is
  `unobserved`, not `pass`.
- **Baseline overwritten in place:** re-capturing to the same screenshot path
  destroys the before/after evidence chain; keep captures append-only within
  a run.
- **Cached positional handles:** reusing element indexes or coordinates
  across re-renders, producing clicks on the wrong control.
- **Fixed waits as terminal conditions:** `sleep`/`wait <ms>` instead of a
  settled-state probe with a deadline; eventual consistency becomes flaky
  verdicts.
- **Cleanup only on success:** D2/D3 cleanup that does not run after failure
  or timeout leaves mutated profiles and stolen window focus for the next
  run.
