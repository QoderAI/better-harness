# Prompt-cache TTL cues in idle windows

## Traceability

- Spec ID: inspector-idle-cache-ttl-cues
- Status: Implemented

## Intent

Help a reviewer notice when a long interval inside a tool-call idle window may
have crossed the prompt-cache lifetime used by the selected model policy. The
timeline must remain compact: it exposes the pricing-risk state with a thin
warning-colour top border, while a separate docked policy pane owns model,
retention, pricing-basis, and official-source detail.

Provider policies are mutable reference data rather than report evidence. The
report selects the best matching profile from the observed provider and model,
lets the reader choose another reference profile, links every row to the
provider's official documentation, and explicitly tells the reader to prefer
the latest official policy. A model response observed inside an idle window
resets the elapsed interval used by the cue because it is evidence of another
inference in that otherwise tool-free span.

## Acceptance Scenarios

- AC-1: An observed-time idle window whose longest interval without an observed
  model response reaches the selected profile's comparable TTL displays a 3px
  warning-colour border on the top edge only. The idle label remains unchanged
  and contains no cache or pricing copy.
- AC-2: Prompt-cache policy is represented by a deterministic model containing
  provider/model matching, cache mode, TTL/retention, pricing basis, official
  documentation URL, and whether the TTL is comparable. Unknown or unpublished
  TTLs do not produce a timeline cue.
- AC-3: A docked policy pane below the full chart shows the current reference,
  three rows by default, official links for every profile, a latest-policy
  notice, and a disclosure for the remaining profiles. Compact Turn charts do
  not repeat the pane.
- AC-4: The chart description, idle tooltip, policy notice, and visible legend
  explain that the boundary indicates a possible loss of lower cache-read
  pricing. They do not claim observed cache expiry, a cache miss, a price, or
  billed savings.
- AC-5: Call-sequence charts, gaps below the applicable TTL, and gaps split by
  observed model responses into shorter intervals do not display the cue.
- AC-6: The selected-event detail, Session View action, call statistics, and
  chart legends occupy one non-wrapping docked status row instead of four lines.
  It uses bounded horizontal overflow where the viewport cannot fit every item,
  and shows no instructional placeholder before an event is selected.
- AC-7: The cue, policy pane, links, selector, disclosure, and status row remain
  usable at wide, compact, and narrow layouts with visible keyboard focus and no
  document-level horizontal overflow. The expanded activity disclosure keeps
  `Open session` and `focus view` on the same header row.

## Non-goals

- Estimating provider charges, savings, or cache hit probability.
- Proving the cache write time, expiry time, cache key, hit, miss, or retention
  configuration used by a provider request.
- Changing prompt-caching configuration or choosing a TTL for the user.
- Adding another timeline lane or changing idle-window compression.
- Fetching or refreshing provider policy data over the network from a generated
  report; the links and latest-policy notice keep mutable facts reviewable.

## Plan and Tasks

1. Add a portable prompt-cache profile model and deterministic resolver outside
   the UI renderer; embed the same serializable data and functions in the
   self-contained Inspector document.
2. Compare idle gaps only with the selected profile's comparable TTL and render
   a warning-colour SVG line on the gap's top edge without changing its label.
3. Add a docked policy pane with the observed reference, selector, compact table,
   disclosure, official links, and latest-policy notice.
4. Replace the existing chart inspector and multi-line legend footer with one
   status row that retains selection detail, Session View navigation, summary,
   and redundant text/icon legends.
5. Add focused behavior tests for profile resolution, provider boundaries,
   unpublished TTLs, response resets, generated links, and compact markup.
6. Render a real local Inspector report, exercise policy selection and Session
   navigation in a browser, inspect console/page errors, and capture wide,
   compact, and narrow evidence.

## Test and Review Evidence

- AC-1 through AC-6: `npx vitest run
  test/reporting/harness-inspector-cache-gap.test.mjs
  test/reporting/harness-inspector-timeline-scale.test.mjs
  test/reporting/harness-inspector.test.mjs
  test/reporting/harness-inspector-demo.test.mjs
  test/reporting/harness-inspector-commit-compaction.test.mjs
  test/skills-docs/doc-link-graph.test.mjs` passed 60 tests in 6 files.
- AC-2/AC-3/AC-4/AC-6: the generated Inspector report retains all seven
  official policy links, shows three model rows by default, expands to seven,
  keeps the latest-policy notice visible, and renders one chart status row.
- AC-1/AC-3/AC-6/AC-7: `npm run inspector:visual-check` passed 18 surfaces at
  1440 by 900, 1024 by 768, and 390 by 844. The check exercised model selection,
  profile disclosure, event focus, and the Session View action, with zero
  document overflow, clipped controls, console errors, or page errors.
- AC-7: `npm run preview` returned HTTP 200 for `/health` and
  `/canvas-module.js`.
- Risk: tool-call timing and model-response timing are observed evidence, but
  provider cache storage is not. All user-facing copy must preserve that
  distinction.
