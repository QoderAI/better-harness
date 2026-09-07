# Simplify Studio navigation and page titles

## Traceability
- Spec ID: studio-remove-inputs
- Status: Implemented

## Intent
Remove the Inputs page and redundant project label preceding every page title, as requested by the maintainer.

## Acceptance Scenarios
- AC-1: Navigation offers six views without Inputs; old Inputs routes fall back to Sessions.
- AC-2: All page headers show only the view title; project selection remains available in the sidebar.
- AC-3: Remove Inputs component, translations, styles, and dedicated GET endpoint; preserve shared input evidence used by intent correlation.
- AC-4: Shell navigation, keyboard focus, and bounded layout work at wide, compact, and narrow sizes.

## Non-goals
Changing shared intent correlation contracts, release metadata, or unrelated in-progress work.

## Plan and Tasks
Remove page ownership and update existing navigation tests. Build, run focused unit and browser checks, and inspect screenshots.

## Test and Review Evidence
AC-1–AC-3: focused Studio unit tests: 76 passed; TypeScript check passed. AC-4: project-shell and language Playwright suites: 10 passed, including keyboard focus, console errors, overflow and screenshots at 1440, 1024 and 390 pixels. Doc link tests: 8 passed; routing graph regenerated without changes. Existing preview /health and /canvas-module.js return HTTP 200 (new preview launch found the port already occupied). Main risk is stale navigation expectations and accidental removal of shared evidence. AI implementation: Codex. Existing unstaged changes are preserved; no commit requested.
