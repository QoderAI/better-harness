# Studio project switcher, sidebar toggle, and resizable sidebar

## Traceability

- Spec ID: `studio-project-switcher-sidebar`
- Status: in progress

## Intent

The sidebar puts two navigation levels in one list. Views are rendered *inside*
the active project's entry, so with two Projects open the second one lands
*below* the view list:

```
项目 2
  better-harness      ← active project
  视图
    总览 … 对比        ← views, nested in the active project
  canvas-sdk          ← a sibling Project, stranded under the views
```

A reader cannot tell that `对比` belongs to `better-harness` and that
`canvas-sdk` is its sibling rather than another view. This also contradicts
DESIGN.md's own navigation rule, which says the sidebar lists objects in the
active tool and that these levels must not duplicate one another.

Two interaction gaps compound it:

- The icon at the top of the sidebar is a decorative `GitBranch` glyph with no
  behaviour. The real sidebar toggle, `.studio-nav-toggle`, is `display: none`
  above 1080px, so a wide window has **no way to collapse the sidebar at all**.
- The sidebar is a fixed 236px. Nothing in the repository implements a
  drag-to-resize sash; `--sash-size` is defined but unused, and the one
  `role="separator"` in `InspectorWorkbench` is a static divider.

## Non-goals

- Redesigning Compare. The Compare view needs to lead with a typed requirement
  and two ACP Agents rather than two discovered Sessions, but that changes the
  server-side availability contract (`experimentEnabled` is
  `state.activeManifestPath !== undefined`) and the surface ordering in
  `compareSurfaces`, not the shell. It gets its own spec.
- Resizing the secondary panes inside workbenches. Only the primary sidebar
  becomes resizable here.

## Acceptance criteria

- **AC-1:** The sidebar holds one navigation level. A Project switcher sits at
  the top; below it is a flat list of Views for the active Project. No Project
  row appears below the View list.
- **AC-2:** The switcher names the active Project and opens a menu listing every
  remembered Project, each removable, plus the action that opens another
  Project. Selecting a Project activates it.
- **AC-3:** The top of the sidebar carries a working sidebar toggle in place of
  the decorative brand glyph. Collapsing the sidebar leaves a toggle reachable
  in the toolbar, so the action is reversible at every width.
- **AC-4:** With the sidebar collapsed on macOS, the OS window controls keep
  their inset: the reserved space moves from the sidebar header to the toolbar
  rather than leaving the traffic lights over application content.
- **AC-5:** A resize sash between the sidebar and the content column supports
  pointer drag, is keyboard operable (arrows step, Home/End jump), exposes
  `role="separator"` with `aria-valuenow`/`aria-valuemin`/`aria-valuemax`, and
  shows a hover and focus affordance.
- **AC-6:** Sidebar width is clamped between `sidebar-min-width` and
  `sidebar-max-width` and survives a reload. Collapsed/expanded state also
  survives a reload.
- **AC-7:** Roving tabindex still yields exactly one tab stop in the View list,
  and arrows/Home/End move within it.
- **AC-8:** The narrow overlay behaviour is unchanged: below 1080px the sidebar
  is off-canvas, the toolbar toggle opens it, and choosing a Project closes it
  and returns focus to the toggle.
- **AC-9:** No document-level horizontal overflow and no console or page errors
  at 1440×900, 1024×768, and 390×844 in both themes.

## Plan

1. Restructure `ProjectSidebar.tsx`: switcher at the top, one flat
   `.studio-project-views` section, roving tabindex over Views only.
2. Add sidebar collapse state and width state in `App.tsx`, persisted locally,
   applied as an inline `--sidebar-width` on the shell root.
3. Add the sash as a keyboard-operable `role="separator"`.
4. Rework `shell.css`: collapsed grid, sash affordance, switcher menu, and the
   window-control inset moving between sidebar header and toolbar.
5. Add `--sidebar-min-width` / `--sidebar-max-width` tokens and record the new
   navigation and sizing rules in `DESIGN.md`.
6. Update the tests that located Projects inside the sidebar list, and the nav
   landmark name now that it carries only Views.

## Test and review evidence

- `npm run harness-studio:test` and `:test:browser`.
- `npx vitest run test/governance/design-contract-tokens.test.mjs` for the new
  sizing tokens.
- Screenshots at the three review widths in both themes.

## Risk

- **Test coupling.** Six assertions locate the nav landmark by its old name and
  four locate a per-Project Views section. The Views section keeps its
  `{{label}} Views` label so those four stay valid; the landmark is renamed
  because it no longer carries Projects, and its references are updated.
- **Persisted width.** A stored width from a wide session must not strand a
  narrow window, so the value is clamped on read and ignored below 1080px where
  the sidebar is an overlay.
