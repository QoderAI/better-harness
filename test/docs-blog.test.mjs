import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function readUtf8(...segments) {
  return readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const BLOG_ROOT = ["docs", "blog"];
const POSTS = [
  {
    file: "2026-07-30-better-harness-in-qoder.md",
    slug: "better-harness-in-qoder",
    title: "Introducing Better Harness in Qoder",
    sections: [
      "How Better Harness diagnoses, improves, and rechecks the loop",
      "Agent customization: from capability inventory to actual use",
      "Real task sessions: reconstructing how the Agent Loop actually ran",
      "Project engineering foundations: make it findable, runnable, and verifiable",
      "Turn every Agent Loop into an asset for the next one",
    ],
  },
  {
    file: "2026-07-30-better-harness-is-now-open-source.md",
    slug: "better-harness-is-now-open-source",
    title: "/better-harness Goes Open Source",
    sections: [
      "Better Harness cares about what the agent did in the task",
      "The three-layer open-source system behind Better Harness",
      "Layer 1: Harness Engineering best practices",
      "Layer 2: the Agent Work Loop evaluation model",
      "Layer 3: a runnable engineering implementation",
      "Start with the first verifiable problem",
      "We know it is not complete",
    ],
  },
];

test("Docusaurus publishes a searchable Blog with localized navigation", () => {
  const config = readUtf8("docs", "docusaurus.config.js");
  const navbarZh = JSON.parse(
    readUtf8("docs", "i18n", "zh-Hans", "docusaurus-theme-classic", "navbar.json"),
  );
  const footerZh = JSON.parse(
    readUtf8("docs", "i18n", "zh-Hans", "docusaurus-theme-classic", "footer.json"),
  );

  assert.match(config, /blog:\s*\{[\s\S]*?path:\s*"blog"/u);
  assert.match(config, /routeBasePath:\s*"blog"/u);
  assert.match(config, /blogTitle:\s*"Better Harness Blog"/u);
  assert.match(config, /blogDescription:\s*[\s\S]*?"Engineering practices/u);
  assert.match(config, /showReadingTime:\s*true/u);
  assert.match(config, /to:\s*"\/blog"[\s\S]*?label:\s*"Blog"/u);
  assert.match(config, /indexBlog:\s*true/u);
  assert.equal(navbarZh["item.label.Blog"].message, "博客");
  assert.equal(footerZh["link.item.label.Blog"].message, "博客");
});

test("the Blog contains exactly the two requested English posts", () => {
  const markdownFiles = readdirSync(path.join(process.cwd(), ...BLOG_ROOT))
    .filter((entry) => entry.endsWith(".md"))
    .sort();

  assert.deepEqual(markdownFiles, POSTS.map((post) => post.file).sort());
  assert.match(
    readUtf8(...BLOG_ROOT, "authors.yml"),
    /qoder:[\s\S]*name: Qoder Team/u,
  );

  for (const post of POSTS) {
    const content = readUtf8(...BLOG_ROOT, post.file);
    assert.match(content, new RegExp(`slug: ${post.slug}`));
    assert.match(
      content,
      new RegExp(
        `title: "${post.title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}"`,
      ),
    );
    assert.match(content, /description:\s*\S/u);
    assert.match(content, /date: 2026-07-30T\d{2}:00:00\+08:00/u);
    assert.match(content, /authors: \[qoder\]/u);
    assert.match(content, /tags: \[[^\]]*better-harness[^\]]*\]/u);
    assert.equal((content.match(/<!-- truncate -->/gu) ?? []).length, 1);
    assert.doesNotMatch(content, /\p{Script=Han}/u);
    assert.doesNotMatch(content, /!\[[^\]]*\]\([^)]*\)/u);
    assert.doesNotMatch(content, /alidocs\.oss-cn-zhangjiakou\.aliyuncs\.com/u);
    assert.ok(content.split(/\s+/u).length > 1_000, `${post.file} is unexpectedly short`);

    for (const section of post.sections) {
      assert.match(
        content,
        new RegExp(
          `^#{2,3} ${section.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`,
          "mu",
        ),
      );
    }
  }
});

test("the open-source translation distinguishes launch history from current guidance", () => {
  const content = readUtf8(
    ...BLOG_ROOT,
    "2026-07-30-better-harness-is-now-open-source.md",
  );

  assert.match(content, /This table records the launch state/u);
  assert.match(content, /first three days, 100,000 people tried Better Harness/u);
  assert.match(content, /entrypoints differ by host/u);
  assert.match(
    content,
    /https:\/\/qoderai\.github\.io\/better-harness\/docs\/installation/u,
  );
  assert.match(content, /unexecuted host test as an explicit evidence\nboundary/u);
  assert.match(content, /30 real\nGitHub projects/u);
  assert.match(content, /producing 120\nstandardized reports/u);
  assert.match(content, /more than\n200 specs/u);
});
