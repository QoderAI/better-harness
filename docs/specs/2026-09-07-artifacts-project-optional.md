# Make Artifacts available without a Project

## Traceability
- Spec ID: artifacts-project-optional
- Status: Draft

## Intent
Artifacts opens as a usable workspace without requiring Project selection or a populated catalog.

## Acceptance Scenarios
- AC-1: An explicit Artifacts route bypasses the initial Project gate without invoking a picker.
- AC-2: Missing or empty catalogs render browse, list and preview panes with neutral empty states.
- AC-3: Existing configured catalogs and Project artifacts continue loading and previewing normally.
- AC-4: Keyboard focus, overflow and page errors are checked at wide, compact and narrow widths.

## Non-goals
No new filesystem discovery, global aggregation, or artifact write permissions. Startup landing choice is pending user preference; existing Sessions default is retained until resolved.

## Plan and Tasks
Make gating area-aware, render empty workspaces without fabricated catalog authority, update translations and availability, and run focused tests.

## Test and Review Evidence
Pending. Scope comes from direct maintainer request; AI implementation: Codex. Preserve unrelated unstaged work. Main risk: conflating page availability with data availability.
