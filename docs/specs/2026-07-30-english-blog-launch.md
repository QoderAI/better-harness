# Publish the First English Blog Posts

## Traceability

- Spec ID: `english-blog-launch`
- Status: Implemented

## Intent

Turn the existing GitHub Pages documentation site into a small project blog
and publish faithful English editions of two supplied Chinese Better Harness
articles. Readers should be able to discover the posts from the site
navigation and local search, read them without broken remote-image placeholders,
and follow current installation guidance when launch-era host details have
since changed.

## Acceptance Scenarios

- BLOG-AC-1: The Docusaurus classic preset serves a blog at `/blog`, exposes a
  visible Blog navbar item, and keeps the existing homepage and `/docs` routes
  unchanged. The Simplified Chinese navbar localizes the Blog label even though
  this batch publishes English post content only.
- BLOG-AC-2: The article about Better Harness inside Qoder is published as an
  English Markdown post with a stable slug, publication date, description,
  author, tags, excerpt boundary, and the original heading/list/table/code
  structure where applicable. Its meaning remains faithful to the supplied
  Chinese source.
- BLOG-AC-3: The open-source announcement is published with the same metadata
  quality and preserves its evidence-bound explanation of Findings, the three
  open-source layers, and contribution paths.
- BLOG-AC-4: Image Markdown from both supplied articles is intentionally
  omitted. The published posts contain no hotlinked Alibaba Docs images, empty
  image placeholders, or image-only narrative references that make the text
  unreadable.
- BLOG-AC-5: Launch-era support tables and universal invocation wording are not
  silently presented as current product documentation. The translation marks
  that material as launch context and points readers to the current
  Installation page for supported hosts and host-specific entrypoints.
- BLOG-AC-6: Credential-free local search indexes Blog content in English and
  can navigate from a Blog result to the correct route under the
  `/better-harness/` GitHub Pages base path.
- BLOG-AC-7: Automated checks protect the Blog preset, navbar/search exposure,
  post metadata, stable slugs, expected translated sections, absence of remote
  images, and the current-guidance notice. The documentation link graph, both
  locale builds, package boundaries, whitespace checks, and production-browser
  routes complete successfully.

## Non-goals

- Do not publish the supplied Chinese originals as localized Blog posts in this
  batch.
- Do not recreate, download, or redesign the omitted article images.
- Do not rewrite the articles into product documentation or change their main
  argument, evidence model, or launch narrative.
- Do not add comments, analytics, newsletters, a CMS, or a second Blog plugin.
- Do not modify the source files in `/Users/phodal/Downloads`, deploy GitHub
  Pages, publish packages, stage files, or create a commit.

## Plan and Tasks

1. Enable the classic Blog plugin with explicit reading-time and edit-link
   settings, add Blog navigation, and include Blog content in local search.
2. Add a shared Qoder author record and two date-prefixed English posts under
   `docs/blog/` with stable slugs and curated metadata.
3. Translate each supplied source directly, remove all image Markdown, and add
   a short editorial note wherever launch-era entrypoints could otherwise
   conflict with the current Installation contract.
4. Add focused source-contract tests for configuration, metadata, content,
   images, and support-boundary language.
5. Regenerate the documentation link graph and validate the Docusaurus builds,
   generated search indexes, root package boundaries, production Blog routes,
   responsive layout, keyboard search, and browser console output.

## Test and Review Evidence

- BLOG-AC-1 and BLOG-AC-6: run the Docusaurus production build for both locales,
  inspect generated `/blog` routes and search indexes, and exercise the navbar
  and keyboard search in a production browser under the configured base path.
- BLOG-AC-2 through BLOG-AC-5: run focused Blog source-contract tests and review
  the rendered post headings, tables, code blocks, links, and excerpt cards.
- BLOG-AC-7: run
  `node scripts/doc-link-graph/cli.mjs skills/better-harness`, the focused
  documentation tests, `npm run pack:verify`, and `git diff --check`.
- Before handoff, use Change Traceability Review in Review Readiness mode and
  keep CI, GitHub Pages deployment, and external link health explicitly
  unobserved unless they are directly checked.

### Observed Implementation Evidence

- The two English posts render with stable slugs, Qoder Team authorship,
  descriptions, timestamps, tags, reading times, excerpt boundaries, and no
  Markdown or rendered article images. The supplied files under
  `/Users/phodal/Downloads` were not modified.
- Focused Blog and documentation-DX tests passed 8/8 checks; the broader focused
  documentation suite passed 30/30 checks; and the full repository test suite
  completed successfully.
- The documentation link graph regenerated as 34 files and 50 links with no
  stale generated output. `git diff --check` and the staged-diff whitespace
  check passed.
- English and Simplified Chinese production builds completed successfully. Both
  generated local-search indexes contain the two Blog posts, and both sitemaps
  expose the Blog list, post, archive, author, and tag routes under the GitHub
  Pages base path.
- Production-browser checks exercised the English Blog list, both post routes,
  the keyboard search shortcut and result navigation, a 390-by-844 mobile
  viewport, and the Simplified Chinese Blog entry with its intentional English
  fallback. The final titles are `/better-harness Goes Open Source` and
  `Introducing Better Harness in Qoder`; no horizontal overflow, article
  images, console warnings, or page errors were observed.
- `npm run pack:verify` passed with 342 root npm-package entries and 365 runtime
  ZIP entries, preserving the separate site/package boundaries.
- CI, the deployed GitHub Pages site, and external link health remain unobserved
  in this local implementation pass.

## Risks

- **Translation drift:** smoothing the English can change the evidence boundary
  or imply stronger product guarantees. Mitigation: preserve the source section
  sequence, lists, caveats, and distinction between available assets and
  observed task behavior.
- **Historical claims presented as current:** the open-source announcement
  names the four launch hosts and a shared slash command, while the live docs
  now publish a broader host matrix with host-specific entrypoints. Mitigation:
  label the table as launch context and link to current installation guidance.
- **Locale duplication:** without Chinese Blog source files, Docusaurus may
  render the English posts as fallback content on the Simplified Chinese site.
  Mitigation: localize the navigation label, state the English-only content
  boundary in this spec, and validate both locale builds without claiming a
  Chinese translation.
- **Search/base-path drift:** Blog search can work locally but link outside the
  GitHub Pages base path. Mitigation: test the production build under
  `/better-harness/` and click a Blog search result.
- **Packaging leakage:** enabling the Blog can accidentally add site content to
  the root npm or runtime ZIP artifacts. Mitigation: rerun package verification
  only after the site build has completed and inspect the separate boundaries.
