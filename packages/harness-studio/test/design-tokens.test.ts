import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards the palette contract from docs/specs/2026-09-07-studio-macos-app-shell.md
 * (AC-1..AC-3) against the shipped token file.
 *
 * The surface ramp is the layout's primary structural mechanism, and the
 * previous palette let it decay to 1.19:1 across six named surfaces — every
 * region rendered as the same slab while each individual text pair still passed
 * AA. Contrast assertions on text alone cannot catch that, so this parses the
 * declarations and computes the boundary ratios the layout actually depends on.
 */

const tokensPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "styles", "tokens.css");

/** Reads every custom-property declaration under one selector, merging repeats. */
function declarations(css: string, selector: string): Map<string, string> {
  const found = new Map<string, string>();
  let cursor = 0;
  let blocks = 0;
  for (;;) {
    const start = css.indexOf(selector, cursor);
    if (start < 0) break;
    const open = css.indexOf("{", start);
    const close = css.indexOf("\n}", open);
    if (open < 0 || close < 0) throw new Error(`tokens.css ${selector} block is unterminated`);
    for (const [, name, value] of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      found.set(name, value.trim());
    }
    blocks += 1;
    cursor = close;
  }
  if (blocks === 0) throw new Error(`tokens.css has no ${selector} block`);
  return found;
}

function channels(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex !== null) {
    const value = Number.parseInt(hex[1], 16);
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color.trim());
  if (rgb !== null) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`Cannot read a color from ${color}`);
}

function luminance(color: string): number {
  const linear = channels(color).map((channel) => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Boundaries the layout separates with a ramp step alone, carrying no hairline. */
const RAMP_STEPS = [
  ["--color-canvas", "--color-sidebar"],
  ["--color-sidebar", "--color-workspace"],
  ["--color-titlebar", "--color-workspace"],
  ["--color-statusbar", "--color-workspace"],
  ["--color-surface-subtle", "--color-surface"],
] as const;

/** Every surface meaningful text is set on. */
const TEXT_BEDS = [
  "--color-canvas",
  "--color-sidebar",
  "--color-workspace",
  "--color-panel",
  "--color-surface",
  "--color-titlebar",
  "--color-statusbar",
  "--color-surface-subtle",
  "--color-surface-hover",
  "--color-surface-active",
  "--color-surface-selected",
] as const;

const NEUTRAL_BEDS = [
  "--color-workspace",
  "--color-sidebar",
  "--color-surface",
  "--color-panel",
  "--color-titlebar",
  "--color-statusbar",
  "--color-surface-subtle",
] as const;

const css = await readFile(tokensPath, "utf8");
const dark = declarations(css, ":root {");
const light = declarations(css, ':root[data-theme="light"]');

// The light block only overrides what differs, so unset roles inherit the base.
const themes = {
  dark: (name: string): string => {
    const value = dark.get(name);
    if (value === undefined) throw new Error(`tokens.css is missing ${name}`);
    return value;
  },
  light: (name: string): string => {
    const value = light.get(name) ?? dark.get(name);
    if (value === undefined) throw new Error(`tokens.css is missing ${name}`);
    return value;
  },
};

describe.each(Object.entries(themes))("%s theme palette", (_theme, token) => {
  it("keeps every borderless region boundary perceptible (AC-1)", () => {
    const measured = RAMP_STEPS.map(([back, front]) => ({
      boundary: `${back} -> ${front}`,
      ratio: Number(contrast(token(back), token(front)).toFixed(3)),
    }));
    expect(measured.filter((entry) => entry.ratio < 1.12)).toEqual([]);
  });

  it("spans a usable content ramp from canvas to surface (AC-1)", () => {
    expect(contrast(token("--color-canvas"), token("--color-surface"))).toBeGreaterThanOrEqual(1.35);
  });

  it("separates hover and pressed from the row beneath them (AC-1)", () => {
    const states: [string, string][] = [
      ["--color-surface", "--color-surface-hover"],
      ["--color-surface-hover", "--color-surface-active"],
      ["--color-workspace", "--color-surface-hover"],
      ["--color-workspace", "--color-surface-selected"],
    ];
    const flat = states
      .map(([base, state]) => ({ pair: `${base} -> ${state}`, ratio: Number(contrast(token(base), token(state)).toFixed(3)) }))
      .filter((entry) => entry.ratio < 1.06);
    expect(flat).toEqual([]);
  });

  it("meets AA for every text role on every surface it lands on (AC-2)", () => {
    const roles = ["--color-text", "--color-text-muted", "--color-text-subtle"];
    const failures = roles.flatMap((role) => TEXT_BEDS
      .map((bed) => ({ pair: `${role} on ${bed}`, ratio: Number(contrast(token(role), token(bed)).toFixed(2)) }))
      .filter((entry) => entry.ratio < 4.5));
    expect(failures).toEqual([]);
  });

  it("meets AA for the interaction role as text and as a fill (AC-2)", () => {
    const asText = NEUTRAL_BEDS
      .map((bed) => ({ pair: `--color-primary on ${bed}`, ratio: Number(contrast(token("--color-primary"), token(bed)).toFixed(2)) }))
      .filter((entry) => entry.ratio < 4.5);
    expect(asText).toEqual([]);
    expect(contrast(token("--color-on-primary"), token("--color-primary"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--color-on-primary"), token("--color-primary-hover"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--color-primary"), token("--color-primary-soft"))).toBeGreaterThanOrEqual(4.5);
  });

  it("meets AA for every evidence state role (AC-3)", () => {
    const roles = ["--color-success", "--color-warning", "--color-danger", "--color-candidate"];
    const beds = ["--color-workspace", "--color-surface", "--color-panel", "--color-surface-subtle", "--color-sidebar", "--color-titlebar"];
    const failures = roles.flatMap((role) => beds
      .map((bed) => ({ pair: `${role} on ${bed}`, ratio: Number(contrast(token(role), token(bed)).toFixed(2)) }))
      .filter((entry) => entry.ratio < 4.5));
    expect(failures).toEqual([]);
  });

  it("draws focus at 3:1 against every region it is offset over (AC-3)", () => {
    // Focus uses outline-offset, so it lands on the region behind the control,
    // never on the control's own fill.
    const failures = NEUTRAL_BEDS
      .map((bed) => ({ pair: `--color-focus on ${bed}`, ratio: Number(contrast(token("--color-focus"), token(bed)).toFixed(2)) }))
      .filter((entry) => entry.ratio < 3);
    expect(failures).toEqual([]);
  });
});

describe("token file shape", () => {
  it("defines the light theme as an override of the base block", () => {
    expect(light.size).toBeGreaterThan(0);
    expect(dark.get("--color-canvas")).not.toEqual(light.get("--color-canvas"));
  });

  it("keeps the system UI stack and bundles no web font", () => {
    const ui = themes.dark("--font-ui");
    expect(ui).toContain("system-ui");
    expect(css).not.toContain("@import");
    expect(css).not.toContain("@font-face");
  });

  it("keeps the meaningful-text floor at 12px", () => {
    const floors = ["--type-meta-size", "--type-pane-size"];
    for (const name of floors) expect(Number.parseFloat(themes.dark(name))).toBeGreaterThanOrEqual(12);
  });
});
