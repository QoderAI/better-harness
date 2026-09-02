# Inspector trailing-slash Pages 404

## Traceability

- Spec ID: inspector-trailing-slash
- Story: #132
- Status: Implemented

## Intent

GitHub Pages currently 404s `https://qoderai.github.io/better-harness/inspector/`
while the slash-less URL is 200. The homepage, README, and some navbar links
still point at the trailing-slash URL. No-JS readers, crawlers, and link
checkers should get the Inspector page instead of a 404 HTML document.

Keep `trailingSlash: false` as the canonical URL policy. Do not flip the whole
site to directory URLs.

## Acceptance Scenarios

- AC-1: After a production docs build, GitHub Pages-style static lookup finds
  both `inspector.html` and `inspector/index.html` for English and Simplified
  Chinese. Serving either path returns Inspector HTML, not `404.html`.
- AC-2: Homepage Inspector preview and "Open the interactive sample" links use
  the slash-less `/inspector` path. Navbar Inspector uses the same slash-less
  path.
- AC-3: README English and Simplified Chinese Inspector sample URLs use
  `https://qoderai.github.io/better-harness/inspector` without a trailing slash.
- AC-4: Canonical, sitemap, and Open Graph URLs remain slash-less
  `/better-harness/inspector`. The trailing-slash file is an alias for static
  hosts, not a second canonical route.
- AC-5: Existing demo directory routes such as
  `/demo/harness-inspector/` keep their trailing slash because they are real
  `index.html` directories, not Docusaurus page aliases.

## Non-goals

- Changing `trailingSlash` for the whole Docusaurus site.
- Adding a GitHub Pages 301/302, which static Pages cannot emit for this host.
- Rewriting every historical `/inspector/` mention in older specs.
- Changing Inspector demo iframe content, Workbench behavior, or locales.

## Plan and Tasks

1. Keep `docs/docusaurus.config.js` `trailingSlash: false`.
2. Add a postbuild copy of `inspector.html` to `inspector/index.html` for `en`
   and `zh-Hans`, so Pages serves `/inspector/` as 200.
3. Point homepage and navbar Inspector links at `/inspector`.
4. Point README Inspector sample URLs at the slash-less public URL.
5. Add focused tests that assert the alias files, postbuild wiring, and README
   public URLs without grepping the whole repository.

Decision rationale: GitHub Pages serves `file.html` for `/file` and
`file/index.html` for `/file/`, but does not redirect between them. Docusaurus
`trailingSlash: false` only emits `inspector.html`, which is why the homepage
trailing-slash href 404s. Copying the same HTML into `inspector/index.html`
makes both URLs 200 without changing canonical URLs. Pages still cannot 301.

## Test and Review Evidence

- AC-1: focused Vitest coverage copies a fake `inspector.html` into a temp
  build tree and asserts English and `zh-Hans` `inspector/index.html` exist
  with the same Inspector title, not 404 HTML.
- AC-1: `docs/package.json` `postbuild` runs the alias step after
  `docusaurus build`.
- AC-2/AC-3: focused assertions on homepage `useBaseUrl("/inspector")`, navbar
  `to: "/inspector"`, and README public URLs.
- AC-4/AC-5: production `docs` build leaves sitemap/canonical slash-less and
  keeps `/demo/harness-inspector/` as a directory route.
- Manual: `curl -sSI` both public URLs after Pages deploy; neither is 404.
