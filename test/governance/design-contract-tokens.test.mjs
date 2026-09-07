// DESIGN.md is the visual source of truth and tokens.css is its only runtime
// source. Nothing but review kept the two aligned, so the contract could state
// one palette while the application shipped another — the failure mode that let
// an imperceptible surface ramp survive two token generations.
//
// This holds the shipped values to the declared ones. It deliberately checks the
// roles that carry structure (the ramp, chrome materials, interaction, text) and
// the metrics named in the contract's density rules, not every token: a role
// that exists only in code is a migration detail, while a role the contract
// names and the code contradicts is a defect.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));
const design = readFileSync(`${root}DESIGN.md`, "utf8");
const tokens = readFileSync(`${root}packages/harness-studio/src/app/styles/tokens.css`, "utf8");

function frontMatter(text) {
  if (!text.startsWith("---\n")) throw new Error("DESIGN.md has no YAML front matter");
  const end = text.indexOf("\n---", 3);
  if (end < 0) throw new Error("DESIGN.md front matter is unterminated");
  return parse(text.slice(4, end));
}

/**
 * Drops at-rule blocks so only the base declarations are read. The token file
 * raises targets to 44px inside a narrow-width `@media` block, and merging that
 * override into the base set would report it as the desktop metric.
 */
function baseCss(css) {
  let output = "";
  let cursor = 0;
  const atRule = /^[ \t]*@[\w-]+[^;{]*\{/gm;
  for (let match = atRule.exec(css); match !== null; match = atRule.exec(css)) {
    if (match.index < cursor) continue;
    output += css.slice(cursor, match.index);
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < css.length && depth > 0) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    cursor = index;
    atRule.lastIndex = index;
  }
  return output + css.slice(cursor);
}

/**
 * Collects declarations from every block matching `selector`, in order, so a
 * token file split into several `:root` blocks reads as one set. Reading only the
 * first block would silently report later tokens as missing.
 */
function declarations(css, selector) {
  const found = new Map();
  let cursor = 0;
  let blocks = 0;
  for (;;) {
    const start = css.indexOf(`${selector} {`, cursor);
    if (start < 0) break;
    const open = css.indexOf("{", start);
    const close = css.indexOf("\n}", open);
    if (close < 0) throw new Error(`tokens.css ${selector} block is unterminated`);
    for (const [, name, value] of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      found.set(name, value.trim());
    }
    blocks += 1;
    cursor = close;
  }
  if (blocks === 0) throw new Error(`tokens.css has no ${selector} block`);
  return found;
}

const contract = frontMatter(design);
const base = declarations(baseCss(tokens), ":root");
const light = declarations(baseCss(tokens), ':root[data-theme="light"]');

/** The contract writes colours in upper case; CSS ships them lower case. */
const sameColor = (declared, shipped) => shipped?.toLowerCase() === declared.toLowerCase();

// The light palette is the contract's base `colors` block; dark is an override
// map. `source: colors` records that relationship in the front matter.
const PALETTE_ROLES = [
  "primary", "primary-hover", "primary-soft", "on-primary", "focus",
  "text", "text-muted", "text-subtle",
  "canvas", "sidebar", "workspace", "panel", "surface",
  "titlebar", "statusbar", "surface-subtle",
  "surface-hover", "surface-active", "surface-selected",
  "success", "success-surface", "warning", "warning-surface", "danger", "danger-surface",
  "candidate", "candidate-surface",
];

describe("DESIGN.md and Studio tokens describe the same palette", () => {
  it("declares the light theme through the base colors block", () => {
    expect(contract.themes.light.source).toBe("colors");
  });

  for (const role of PALETTE_ROLES) {
    it(`ships the declared light ${role}`, () => {
      const declared = contract.colors[role];
      expect(declared, `DESIGN.md colors.${role} is missing`).toBeTypeOf("string");
      expect(sameColor(declared, light.get(`--color-${role}`))).toBe(true);
    });

    it(`ships the declared dark ${role}`, () => {
      const declared = contract.themes.dark[role];
      expect(declared, `DESIGN.md themes.dark.${role} is missing`).toBeTypeOf("string");
      expect(sameColor(declared, base.get(`--color-${role}`))).toBe(true);
    });
  }
});

describe("DESIGN.md and Studio tokens describe the same surface model", () => {
  it("keeps chrome materials out of the content ramp", () => {
    const ramp = contract["surface-ramp"].order;
    const chrome = contract["surface-ramp"].chrome;
    expect(ramp).toEqual(["canvas", "sidebar", "workspace", "panel", "surface"]);
    // A material measured against the content it borders cannot also be a step
    // in the ordered ramp; declaring it as both is what made `titlebar` look
    // like a ramp regression when it is simply a lighter toolbar.
    for (const material of chrome) expect(ramp).not.toContain(material);
  });

  it("points at the test that enforces the ramp floors", () => {
    const enforcer = contract["surface-ramp"]["enforced-by"];
    expect(enforcer).toBe("packages/harness-studio/test/design-tokens.test.ts");
    expect(() => readFileSync(`${root}${enforcer}`, "utf8")).not.toThrow();
  });

  it("follows the host appearance with a stated fallback", () => {
    expect(contract.themes.default).toBe("system");
    expect(contract.themes.fallback).toBe("dark");
    // The pre-paint resolver in index.html is what makes this true without a
    // theme flash, so the two must not disagree about the stored key.
    const html = readFileSync(`${root}packages/harness-studio/src/app/index.html`, "utf8");
    expect(html).toContain("prefers-color-scheme");
    expect(html).toContain("harness-studio-theme");
  });
});

describe("DESIGN.md and Studio tokens describe the same density", () => {
  const METRICS = [
    ["control-height", "--control-height"],
    ["toolbar-target", "--toolbar-target"],
    ["pane-header", "--pane-header-height"],
    ["row", "--row-height"],
    ["navigation-row", "--navigation-row-height"],
    ["titlebar", "--titlebar-height"],
    ["workbench-bar", "--workbench-bar-height"],
    ["statusbar", "--statusbar-height"],
    ["sidebar-width", "--sidebar-width"],
    ["secondary-pane-width", "--secondary-pane-width"],
    ["touch-target", "--touch-target"],
  ];

  for (const [role, token] of METRICS) {
    it(`ships the declared ${role}`, () => {
      const declared = contract.sizing[role];
      expect(declared, `DESIGN.md sizing.${role} is missing`).toBeTypeOf("string");
      expect(base.get(token)).toBe(declared);
    });
  }

  it("keeps a workbench toolbar shorter than the window's unified toolbar", () => {
    // The unified toolbar is tall because it carries the OS window controls. A
    // workbench bar inside the work area has no such job, and inheriting that
    // height is how inner toolbars became 52px by accident.
    const value = (role) => Number.parseInt(contract.sizing[role], 10);
    expect(value("workbench-bar")).toBeLessThan(value("titlebar"));
  });

  it("raises targets to the declared touch size at narrow widths", () => {
    // The desktop metrics are deliberately below 44px, so the contract's touch
    // rule only holds if the narrow breakpoint actually restates them. Reading
    // the override rather than the base set is the point of this check.
    const narrow = declarations(tokens.slice(tokens.indexOf("@media (max-width: 760px)")), ":root");
    const touch = Number.parseInt(contract.sizing["touch-target"], 10);
    for (const token of ["--control-height", "--toolbar-target", "--row-height", "--navigation-row-height"]) {
      expect(Number.parseInt(narrow.get(token) ?? "0", 10), token).toBeGreaterThanOrEqual(touch);
    }
    expect(narrow.get("--navigation-row-height")).toBe(contract.sizing["navigation-row-touch"]);
  });

  it("ships the declared shape scale", () => {
    for (const [role, declared] of Object.entries(contract.rounded)) {
      if (role === "none" || role === "full") continue;
      expect(base.get(`--radius-${role}`), `--radius-${role}`).toBe(declared);
    }
  });

  it("ships the declared body and metadata type sizes", () => {
    expect(base.get("--type-body-size")).toBe(contract.typography.body.fontSize);
    expect(base.get("--type-meta-size")).toBe(contract.typography.metadata.fontSize);
    // `metadata` is the floor for meaningful text, so nothing in the scale may
    // sit below it.
    const floor = Number.parseInt(contract.typography.metadata.fontSize, 10);
    for (const [name, value] of base) {
      if (!name.endsWith("-size") || !name.startsWith("--type-")) continue;
      expect(Number.parseInt(value, 10), `${name} is below the metadata floor`).toBeGreaterThanOrEqual(floor);
    }
  });
});
