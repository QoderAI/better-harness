# Consistent evidence navigation and comparison controls

## Traceability
- Spec ID: studio-evidence-navigation-clarity
- Status: Implemented; local verification complete

## Intent
Follow the maintainer's screenshot review: simplify the sidebar, make Memory's
Agent selection match Customizations, identify Performance Sessions by user
intent with consistent timing, and allow a one-Agent live run in Compare.

## Acceptance Scenarios
- AC-1: The sidebar omits the restored-project helper and the All time helper.
  Memory follows Customizations in View navigation and keeps its global scope.
- AC-2: Memory and Customizations share the Agent facet selector behavior,
  including counts, selection state, and keyboard access.
- AC-3: Performance uses the same elapsed-time basis in its list and detail;
  first user prompts identify Sessions when available. No Combined activity
  time headline or rounded detail containers remain.
- AC-6: Category names and durations share the distribution color. Hovering or
  keyboard-focusing a bar segment, legend item, or category row highlights all
  three; row edge and legend underline provide cues beyond color.
- AC-4: Compare starts exactly one selected Agent, still rejects zero Agents,
  and preserves multi-Agent runs and cancellation/permission behavior.
- AC-5: Browser verification covers changed surfaces at wide, compact, and
  narrow sizes, keyboard focus, overflow, and console/page errors. Native
  Performance fixtures cover prompt selection and safe metadata extraction.

## Non-goals
New host adapters, generated conversation titles, changing timing attribution,
turning Memory into project-scoped data, automatic scans or Agent runs, release
packaging, publishing, or commits.

## Plan and Tasks
1. Reuse the existing sidebar and Agent facet patterns through a shared component.
2. Align displayed timing to observed elapsed duration, retain diagnostic metrics
   behind the existing details, and recover bounded first user prompts.
3. Lower live Compare's selection floor to one with appropriate single-run copy.
4. Run focused behavior tests, native tests/build, browser visual checks, and
   desktop smoke alongside the startup/explicit-scan verification.

## Test and Review Evidence
- AC-1–AC-2: sidebar order and removed helpers pass in all six scan layouts;
  Memory Agent selection/keyboard filtering passes at three widths, including
  unchanged authorized reading and snapshot behavior. Customizations retains
  category/Agent composition, counts, retry, and keyboard selection.
- AC-3: native tests verify first main user prompt selection, child/model prompt
  exclusion, fallback labels, and redaction. Four browser cases use raw logs
  processed by the built Rust executable: list/detail elapsed values match,
  square containers render, nested timing details and focus restoration work,
  and dark Chinese/zoomed layouts remain bounded.
- AC-6: Category names and durations share the distribution color. Hovering or
  keyboard-focusing a bar segment, legend item, or category row highlights all
  three; row edge and legend underline provide cues beyond color.
- AC-4: one-Agent launch, completion, and follow-up pass through the actual ACP
  fixture. Existing two/three-Agent flows, permissions, streaming, and NSXPC
  coverage pass. Single-Agent layouts have screenshots at three widths.
- AC-5: 29 distinct focused browser cases passed across scan, Memory,
  Customizations, Compare, Debugger, and Performance. Relevant screenshots are
  under `packages/harness-studio/test-results/`, `navigation-final/`, and
  `evidence-final/`; no asserted console/page errors or overflow remained.
- Studio build, Rust suites/build, 23 focused server cases, eight doc-link tests,
  and both clean/existing-profile native desktop checks passed.
- Review Readiness Check: user-requested maintenance with no supplied Story id;
  the two specs cover the local diff. All files remain unstaged. No generated
  routing-graph diff, release metadata change, commit, installation, or publish
  occurred. This session records AI authorship; external CI was not inspected.
- AC-6: four Performance browser cases pass after linking category colors and
  hover/focus state. Tests compare the rendered duration color with its bar,
  verify linked highlights from the row and keyboard-focused legend, and retain
  expansion and evidence focus behavior. Wide/compact/narrow linked screenshots
  are under `packages/harness-studio/test-results/performance-linking/`.
  Studio build and preview health/Canvas runtime checks also pass.
- Risk: missing prompt evidence must remain an honest fallback; overlapping
  category activity must not be described as additive elapsed duration.
