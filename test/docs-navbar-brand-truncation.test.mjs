import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("docs navbar keeps the Better Harness brand from shrinking (AC-1, AC-3)", async () => {
  const css = await readFile(path.join(repoRoot, "docs", "src", "css", "custom.css"), "utf8");
  const brand = declarationsFor(css, ".navbar__brand");
  const title = declarationsFor(css, ".navbar__title");

  assert.equal(brand["flex-shrink"], "0");
  assert.equal(brand["min-width"], "auto");
  assert.equal(title.overflow, "visible");
  assert.equal(title["text-overflow"], "clip");
  assert.equal(title["white-space"], "nowrap");
});

test("compact laptop navbar padding covers 1280px before the mobile breakpoint (AC-2, AC-4)", async () => {
  const css = await readFile(path.join(repoRoot, "docs", "src", "css", "custom.css"), "utf8");
  const compact = mediaQueryContaining(css, ".navbar__search-input");

  assert.match(compact, /min-width:\s*997px/u);
  assert.match(compact, /max-width:\s*1400px/u);
  assert.equal(rangeIncludes(compact, 1280), true);
  assert.equal(rangeIncludes(compact, 1366), true);
  assert.equal(rangeIncludes(compact, 996), false);
});

function declarationsFor(css, selector) {
  const match = css.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]+)\\}`, "u"));
  assert.ok(match, `missing rule ${selector}`);
  const declarations = {};
  for (const line of match[1].split(";")) {
    const [property, value] = line.split(":").map((part) => part?.trim());
    if (property && value) {
      declarations[property] = value;
    }
  }
  return declarations;
}

function mediaQueryContaining(css, selector) {
  const blocks = [...css.matchAll(/@media\s*([^{]+)\{([\s\S]*?)\n\}/gu)];
  const block = blocks.find((entry) => entry[2].includes(selector));
  assert.ok(block, `missing media query for ${selector}`);
  return block[1].trim();
}

function rangeIncludes(query, width) {
  const min = Number(query.match(/min-width:\s*(\d+)px/u)?.[1] ?? Number.NaN);
  const max = Number(query.match(/max-width:\s*(\d+)px/u)?.[1] ?? Number.NaN);
  return width >= min && width <= max;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
