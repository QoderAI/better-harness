# Docs Site SEO Index Hygiene

Tighten which pages of the Better Harness website enter search indexes, based
on an external SEO review of `https://qoderai.github.io/better-harness/`.

## Traceability

- Spec ID: 2026-07-31-docs-seo-index-hygiene
- Status: Implemented

## Intent

The review found the site's SEO baseline healthy but flagged two clusters of
issues: language/content mismatch (zh-Hans blog serving English fallback
posts) and low-value pages entering the index (on-site search, thin blog
taxonomy pages, and the checked-in demo report). This spec keeps those routes
crawlable while removing them from sitemaps and marking them `noindex,follow`
until they carry unique, correctly-localized content.

## Acceptance Scenarios

- AC1: `docs/docusaurus.config.js` sitemap `ignorePatterns` excludes
  `/search`, `/blog/tags*`, `/blog/authors*`, `/blog/archive`, and the whole
  `/zh-Hans/blog` tree in both locale sitemaps.
- AC2: `docs/src/theme/Root.js` emits `<meta name="robots" content="noindex,
  follow">` for the same routes, and for every zh-Hans blog route while no
  translated posts exist under
  `docs/i18n/zh-Hans/docusaurus-plugin-content-blog/`.
- AC3: `assets/demo/better-harness-report.html` (source of truth for
  `/demo/better-harness-report/`) declares `noindex,follow` and a meta
  description.
- AC4: The blog list page renders a visible `<h1>` with the configured blog
  title (`docs/src/theme/BlogListPage/index.js`, ejected from
  `@docusaurus/theme-classic` 3.10.2).
- AC5: `docs/static/img/favicon.svg` declares an intrinsic size of at least
  48x48 (96x96 chosen) per Google favicon guidance.

## Non-Goals

- Writing native Chinese blog articles. As they land under
  `docs/i18n/zh-Hans/docusaurus-plugin-content-blog/`, the fallback rule in
  `Root.js` allowlists each translated post's route
  (`TRANSLATED_ZH_BLOG_ROUTES`) so it becomes indexable while list, taxonomy,
  and still-English-fallback post routes stay `noindex`. The sitemap keeps the
  whole `/zh-Hans/blog` tree excluded until the blog is predominantly native
  Chinese, at which point the tree exclusion and the allowlist can both be
  dropped in favor of indexing the zh-Hans blog like the English one.
- A `robots.txt`. GitHub Pages project sites cannot serve one at the
  `qoderai.github.io` host root, so a copy under `/better-harness/` would be
  ignored by crawlers. Sitemap submission happens in Search Console instead.
- Custom domain, Site Name, and per-project favicon fixes; those require
  binding a dedicated domain and stay out of scope.

## Test Evidence

- `test/docs-site.test.mjs` — "low-value routes stay out of the sitemap and
  are marked noindex" covers AC1–AC5.
- Manual: `npm run build` in `docs/` and inspection of the generated
  `sitemap.xml`, `zh-Hans/sitemap.xml`, and rendered `meta[name=robots]` tags.
