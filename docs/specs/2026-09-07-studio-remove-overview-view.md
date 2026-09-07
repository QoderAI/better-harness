# Remove the Studio Overview view and land on Sessions

## Traceability

- Spec ID: `studio-remove-overview-view`
- Status: in progress

## Intent

`Overview` is the first View in the Studio sidebar and the default landing area,
but it does not carry a decision the rest of the shell cannot already make:

- Its `Recent Sessions` pane is a truncated copy of the Sessions View, reached
  through one extra hop. Clicking a row navigates to Sessions anyway.
- Its `Workspace summary` facts (inputs, sessions, agents, artifacts,
  repository) restate the per-View `status` strings the sidebar already shows on
  every row, plus the status bar at the bottom of every View.
- Its `Next Actions` pane is a second rendering of the sidebar's View list.

So the landing surface of the workbench is a summary of the navigation next to
it, and a reader must leave it before doing anything. Removing it makes Sessions
— the retained evidence a reader actually opens Studio for — the landing View.

The Artifacts empty state has a related problem. When a Project is open and
simply has no changed artifacts, the empty state still offers
`Open Another Project`. Switching Projects is not the next step for that state,
and the sidebar's Project switcher already owns that action. The same action
remains correct in the *disconnected* Artifacts state, where it is the only way
forward.

## Non-goals

- Redesigning Sessions. It becomes the landing View unchanged, including its own
  disconnected empty state.
- Auditing `openProjectAction` in the other Views' empty states. In Inputs,
  Commits, Debugger, and Compare the empty state means "this Project cannot do
  this", where opening another Project is a real remedy. Only the Artifacts
  "no changed artifacts" state loses it.
- Persisting a per-reader landing View. The default stays a constant.

## Acceptance criteria

- **AC-1:** `Overview` no longer appears in the sidebar View list, and
  `overview` is no longer a member of `StudioArea`.
- **AC-2:** Loading Studio with no route, an unknown route, or an unparsable
  Project route lands on `Sessions`, and the toolbar title and status bar report
  Sessions.
- **AC-3:** A stale `#/overview` or `#/projects/<id>/overview` hash resolves to
  `Sessions` rather than a blank work area, keeping the Project segment when it
  is present.
- **AC-4:** Roving tabindex over the View list still yields exactly one tab stop,
  and arrow keys move from the first row (`Customizations`) onward.
- **AC-5:** The Artifacts empty state for an open Project with an empty catalog
  renders no `Open Another Project` button. The Artifacts state for a Project
  that is not connected keeps its `Open Project` action.
- **AC-6:** No `overview` i18n namespace, `area.overview` label,
  `destination.overviewStatus` status, `.control-overview` / `.overview-*` rule,
  or `studioOverview` model code remains in the package. Unrelated
  `usage-overview*` (Inspector) and `call-overview` / `overview-pair`
  (Experiment) styles are untouched.
- **AC-7:** No console or page errors and no document-level horizontal overflow
  at 1440×900, 1024×768, and 390×844.

## Plan

1. `studio-shell-model.ts`: drop `"overview"` from `StudioArea`, drop the
   `overview` destination, delete `studioOverview` and the
   `StudioOverviewModel` / `StudioOverviewMode` / `StudioOverviewAction` /
   `StudioOverviewFact` types, and export a `STUDIO_DEFAULT_AREA` constant.
2. `project-routing.ts`: fall back to `STUDIO_DEFAULT_AREA` instead of the
   hardcoded `"overview"`, and resolve a known-but-removed area the same way.
3. `App.tsx`: delete the `Overview` component, its render branch, the
   `overviewConfig` derivation, and the `overview` entry in `STUDIO_AREAS`;
   resolve the active destination through `STUDIO_DEFAULT_AREA`.
4. `ProjectSidebar.tsx`: remove the `overview` icon mapping and the now-unused
   `SquaresFour` import.
5. i18n: delete `en/overview.ts` and `zh-CN/overview.ts`, unregister the
   namespace, and remove `area.overview` / `destination.overviewStatus` from
   both `common.ts` files.
6. `shell.css`: remove the Overview block and its narrow-layout overrides.
7. `ArtifactsWorkspace.tsx`: stop passing `openProjectAction` into the
   "no changed artifacts" empty state.
8. Tests: delete `test/browser/overview.spec.mjs`, drop the `studioOverview`
   suites from `test/studio-shell-model.test.ts`, retarget the routing default in
   `test/studio-project.test.ts`, and update the landing assertions in
   `tool-call`, `language`, `project-shell`, and `artifact-host` browser specs.
9. `packages/harness-studio/README.md`: correct the View list.

## Test and review evidence

- `npm run typecheck` and `npx vitest run` in `packages/harness-studio`.
- `npx playwright test test/browser/project-shell.spec.mjs test/browser/tool-call.spec.mjs test/browser/language.spec.mjs`
  for the landing View, roving focus, and locale title.
- `npx playwright test test/browser/artifact-host.spec.mjs` for the Artifacts
  empty state and the post-open route.
- Screenshots at the three review widths.

## Risk

- **Stale bookmarks and Electron deep links.** Any retained `#/overview` hash
  must not strand the reader. `parseStudioLocation` already returns the default
  for an unknown area, so the removal turns those routes into Sessions; AC-3
  covers it explicitly.
- **Default-area drift.** Two places pick a landing View (hash parsing and the
  destination lookup in `App.tsx`). They are unified on one exported constant so
  the sidebar order can change without silently moving the landing View.
- **Test coupling.** Roughly a dozen browser assertions locate the landing View
  by the heading `Overview`. They are retargeted rather than relaxed, so a
  regression that lands on the wrong View still fails.
