# Align Studio CI contracts with the tightened Debugger chrome

## Traceability

- Spec ID: studio-ci-chrome-contracts
- Status: Implemented

## Intent

Main is red because Studio browser tests still describe the pre-unification
chrome, and the ACP host fails `cargo fmt --check` on two lines added with the
diagnostics work. Bring those CI contracts onto the chrome and formatting that
already shipped, without restoring retired labels or collapsing the composer
stylesheet back into workbench.

## Acceptance Scenarios

- AC-1: The Studio layout contract counts the four owned `/assets/*.css`
  sheets linked from `index.html` (`tokens.css`, `shell.css`, `workbench.css`,
  `live-composer.css`). Adding a fifth sheet still fails the contract.
- AC-2: Theme contrast is measured from a primary-fill control that exists on
  every Studio view: `button.primary`, `button.new-run`, or the selected
  sidebar View. A missing node must not throw `getComputedStyle` on `null`.
- AC-3: After opening Debugger on a discovered Project, the status bar names
  that Project and the title-bar action is `New live run`. The retired
  concatenated harness label is not required.
- AC-4: `cargo fmt --check` for `harness-acp-host` is clean on
  `connection.rs` and `services.rs`.
- AC-5: At the compact 1024px Debugger layout, the session notebook is at
  least half the grid width, so live trial evidence stays the primary pane.

## Non-goals

- Restoring Overview, Inputs, or the concatenated
  `Project default · Qoder · fixture-project` chrome.
- Merging `live-composer.css` into `workbench.css`.
- Changing theme tokens, ACP handshake behavior, or the live-run dialog.

## Plan and Tasks

1. Format the two ACP host hunks the way rustfmt 1.96 wraps them.
2. Name the four owned stylesheets in `assertRenderedContract`.
3. Guard the contrast helper with a selector that matches current chrome.
4. Point the Debugger workspace assertion at `.studio-status-bar` and
   `New live run`.
5. Shrink the default tree and inspector pane widths so a 1024px overlay
   layout still leaves the notebook at least half the grid.

## Test and Review Evidence

- AC-1/AC-2/AC-3/AC-5: Playwright
  `packages/harness-studio/test/browser/tool-call.spec.mjs` layout tests and
  `packages/harness-studio/test/browser/artifact-host.spec.mjs` theme and
  workspace tests. Full Studio browser suite: 65 passed.
- AC-4: `cargo fmt --check` in `packages/better-harness-desktop/rust/acp-host`.
- Risk: relaxing the stylesheet count to an un-named integer would hide a
  fifth sheet. Named filenames keep the original gate.
- Risk: a probe-only contrast check would pass with no on-screen primary fill.
  Measuring the selected View row covers the landing surface at 375px.
