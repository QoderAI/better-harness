# Building a Browser Verify Loop

A browser verify loop is easiest to understand as a repeatable answer to one
question:

> Can a user complete this browser journey, and can we prove what happened
> when it passed or failed?

The browser can already open pages, click buttons, read the DOM, take
screenshots, capture network calls, and collect console errors. Those are only
raw abilities. A verify loop turns them into a controlled cycle:

1. choose the journey to verify;
2. run that journey in an isolated browser session;
3. collect evidence from the page, the network, and the application state;
4. decide `pass`, `fail`, `unobserved`, or `blocked`;
5. if it fails, diagnose, repair, and rerun the **same** journey.

This document explains that construction pattern for browser-based systems and
embedded web runtimes such as web application containers. It uses the four-plane
model from
[agent-verify-loop.md](../../references/project-harness/agent-verify-loop.md)
and the D0–D4 drive-plane ladder from
[ui-and-system-drivers.md](../../references/project-harness/ui-and-system-drivers.md),
but keeps the explanation grounded in an everyday browser journey.

## Web Application Harness Architecture in ASCII

The original Web Application Harness diagram can be read as this layered stack:

```text
+----------------------------------------------------------------------------------------------+
|                         Web Application Plugin: Harness Built In                              |
+----------------------+------------------------+----------------------+------------------------+
| Live Preview         | Verify & UI Harness    | Browser-Use & Test   | Debug & Diagnosis      |
| - Web App            | - UI: screenshot + DOM | - observe -> reason  | - L1 summary + L2 diag |
| - Canvas             | - Logic: network/logs  |   -> act             | - errorType routing    |
| - React              | - Data: RUM/perf       | - structured cases   | - locate -> fix -> run |
| - page hot refresh   | - image load logs      | - DOM + visual back  | - raw evidence on pull |
+----------------------+------------------------+----------------------+------------------------+

+------------------------------------------------------+  +----------------------------------+
| Runtime Layer                                        |  | GUI Agent                        |
| Browser Runtime                    Web App Runtime   |  | MCP Tool | Custom Agent | CLI     |
+------------------------------------------------------+  | Figma MCP | Skill | Browser Use  |
| time-travel debug | screenshot/ruler/timeline | net   |  +----------------------------------+
| design diff       | XML/DOM/a11y tree         | trace |
| console/errors    | record & replay           | perf  |
+------------------------------------------------------+

+----------------------------------------------------------------------------------------------+
| Platforms                                                                                    |
+----------------------------------------------------------------------------------------------+
```

In verify-loop terms, the bottom runtime boxes provide observable facts, the
GUI-agent boxes provide ways to drive the system, and the top four cards are
the user-facing workflows that consume those capabilities.

## A Concrete Journey

Imagine the case is a checkout flow:

> Open `/checkout`, sign in as a demo user, fill the shipping form, submit the
> order, and see the confirmation page.

A normal browser automation script might stop at "the script clicked the submit
button". A verify loop does more. It records the input that made the run
reproducible, the visible result, the network behavior, the console state, and
any persisted side effect such as an order record or analytics event.

The same case is pinned by a **handle**:

```
/checkout + demo-user-profile + desktop-viewport + mocked-payment-network
```

That handle is the difference between "rerun the test" and "rerun the exact
same situation".

## The Practical Architecture

| Everyday question             | Verify-loop term | What it means in the checkout example                                                                         |
|-------------------------------|------------------|---------------------------------------------------------------------------------------------------------------|
| What journey are we checking? | Discover         | The story, design, or route says checkout must work.                                                          |
| Which journeys matter now?    | Scope            | A checkout component changed, so checkout cases are selected.                                                 |
| How do we run it repeatably?  | Exercise         | Start an isolated browser session, open `/checkout`, interact through element refs, and wait after each step. |
| How do we know it worked?     | Judge            | Check UI evidence, network evidence, console state, and persisted order state.                                |
| What happens if it fails?     | Repair loop      | Reproduce with the same handle, localize the failure, fix it, and rerun the same case.                        |

The architecture has four working parts:

1. **Case selection.** Start from intent sources such as stories, designs, or
   route ownership, then select only the journeys affected by the change.
2. **Browser execution.** Run each selected journey in an isolated browser
   session. Use refs from the current browser snapshot instead of hand-written
   CSS or XPath selectors.
3. **Evidence collection.** Capture three kinds of evidence: what the user saw,
   what the browser/runtime reported, and what the system persisted.
4. **Verdict and repair.** Convert evidence into a verdict. Failed cases enter
   a bounded repair loop and must rerun with the same handle.

## Browser Execution: Two Useful Modes

A practical browser verify loop usually needs two browser modes:

| Mode               | Use it for                                                                  | Why it matters                                                                                                    |
|--------------------|-----------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| Regression browser | Routine CI and repeatable local verification                                | The loop owns the browser, fixtures, network mocks, viewport, and session. This is where stable baselines belong. |
| Real-state browser | Flows that require live login, real SSO, payment pages, or user-owned state | The loop attaches to a real browser but must isolate the agent from user-owned tabs and state.                    |

Use the regression browser first. Escalate to the real-state browser only when
the controlled environment cannot represent the case. If neither mode can
produce reliable UI evidence, change the evidence type: use API or persisted
state assertions plus scheduled human sampling instead of forcing a flaky
visual judgement.

## Evidence: What to Collect

A browser journey should produce evidence in three layers:

| Evidence layer   | Examples                                                           | Typical judgement                                                                |
|------------------|--------------------------------------------------------------------|----------------------------------------------------------------------------------|
| UI evidence      | screenshot, region screenshot, accessibility tree, DOM snapshot    | The confirmation page is visible; the expected button/text/role exists.          |
| Runtime evidence | console errors, network calls, request/response bodies, traces     | No console error; payment mock was called once; the submit request returned 200. |
| State evidence   | order record, emitted event, analytics event, storage/cookie state | The order exists with the expected id and user; required event was emitted.      |

Missing evidence is not success. If the screenshot cannot be taken or the
snapshot times out, the verdict is `unobserved`, not `pass`.

## Verdicts

Use four verdicts only:

- `pass`: required evidence was observed and matched the expectation.
- `fail`: evidence was observed and contradicted the expectation.
- `unobserved`: the loop could not collect the required evidence.
- `blocked`: the case could not run because the environment, permissions, or
  dependencies were unavailable.

This distinction keeps the loop honest. `unobserved` and `blocked` are not
soft passes; high-priority cases with those verdicts should block the run.

## The Repair Loop

When a case fails, do not immediately broaden the search. First rerun the same
handle and confirm the failure is reproducible.

```
run journey → judge evidence → fail
  → rerun same handle
  → localize with screenshot + console + network + trace
  → attribute to code, data, fixture, or environment
  → repair
  → rerun same handle
```

The loop should limit repair rounds. If the same case keeps failing after the
limit, preserve the evidence bundle and report the blocker instead of mutating
more code blindly.

## Evidence Bundle

Each case writes one evidence bundle:

```
<case-id>/
  verdict.json      # case handle, browser mode, judging rule, round, verdict
  screenshot.png    # full page or focused region
  snapshot.txt      # accessibility tree or DOM snapshot
  console.json      # console messages and runtime errors
  network.har       # requests, responses, timing, selected bodies
  state.json        # optional persisted-state or event evidence
```

This bundle is the real output of the verify loop. It lets a reviewer see what
was promised, what was run, what was observed, why the verdict was chosen, and
what changed after repair.

## Common Mistakes

- Treating browser automation as verification. Clicking a page is not a
  verdict.
- Using brittle selectors instead of snapshot refs.
- Allowing baselines to update automatically without human review.
- Recording missing evidence as `pass`.
- Running every browser case for every change instead of selecting cases by
  blast radius.
- Debugging from raw logs only, without a pinned case handle.

## References

- [agent-verify-loop.md](../../references/project-harness/agent-verify-loop.md):
  four-plane model, correlation handle, judging modes, verdict semantics
- [ui-and-system-drivers.md](../../references/project-harness/ui-and-system-drivers.md):
  D0–D4 drive-plane ladder and degradation rules
- [verification-environment.md](../../references/project-harness/verification-environment.md):
  verification environments and degraded-capability claims
