# Make Artifacts available without a Project

## Traceability
- Spec ID: artifacts-project-optional
- Status: Implemented

## Intent
Artifacts opens as a usable workspace without requiring Project selection or a populated catalog.

## Acceptance Scenarios
- AC-1: An explicit Artifacts route bypasses the initial Project gate without invoking a picker.
- AC-2: Missing or empty catalogs render browse, list and preview panes with neutral empty states.
- AC-3: Existing configured catalogs and Project artifacts continue loading and previewing normally.
- AC-4: Keyboard focus, overflow and page errors are checked at wide, compact and narrow widths.

## Non-goals
No new filesystem discovery, global aggregation, or artifact write permissions. Interpretation: default availability of the Artifacts page; existing Sessions startup landing remains unchanged.

## Plan and Tasks
Make gating area-aware, render empty workspaces without fabricated catalog authority, update translations and availability, and run focused tests.

## Test and Review Evidence
TypeScript and app build passed. Shell model/routing: 19 tests passed. Project-shell browser suite: 9 passed, including no-project cases at 1440/1024/390 widths with search, keyboard focus, zero page errors and bounded overflow. Artifact-host broad suite: 26 passed, 2 failed in existing theme-button and Debugger-title expectations; neither failure reports an artifact render failure. Artifact workspace regression also exposed an obsolete project-prefixed header expectation from the previous title cleanup; updated to the agreed Artifacts-only title. Documentation link tests: 8 passed; graph regenerated. Existing preview health and canvas-module endpoints returned 200; starting another preview found port 58575 occupied. Screenshots inspected at all three widths. Scope comes from direct maintainer request; AI implementation: Codex. Preserve unrelated unstaged work. Main risk: conflating page availability with data availability.
