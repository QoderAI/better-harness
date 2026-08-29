import { describe, expect, it } from "vitest";
import { resources } from "../src/app/i18n/resources.js";

type LooseTree = Record<string, string | LooseTree>;

const en = resources.en as unknown as LooseTree;
const zh = resources["zh-CN"] as unknown as LooseTree;

function leafEntries(value: LooseTree, prefix = ""): Array<[string, string]> {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof child === "string" ? [[path, child]] : leafEntries(child, path);
  });
}

function interpolationVariables(value: string): string[] {
  return [...value.matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1]!).sort();
}

describe("Studio i18n resource parity", () => {
  it("exports the same namespaces in every language", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps the en and zh-CN key trees structurally identical", () => {
    for (const ns of Object.keys(en)) {
      const enKeys = leafEntries(en[ns]!).map(([key]) => key).sort();
      const zhKeys = leafEntries(zh[ns]!).map(([key]) => key).sort();
      expect(zhKeys, `namespace ${ns}`).toEqual(enKeys);
    }
  });

  it("keeps interpolation variables identical per key", () => {
    for (const ns of Object.keys(en)) {
      const enLeaves = new Map(leafEntries(en[ns]!));
      const zhLeaves = new Map(leafEntries(zh[ns]!));
      for (const [key, enValue] of enLeaves) {
        const zhValue = zhLeaves.get(key);
        expect(zhValue, `${ns}.${key}`).toBeDefined();
        expect(interpolationVariables(zhValue!), `${ns}.${key}`).toEqual(interpolationVariables(enValue));
      }
    }
  });

  it("uses plural suffixes consistently between languages", () => {
    for (const ns of Object.keys(en)) {
      const enKeys = new Set(leafEntries(en[ns]!).map(([key]) => key));
      const zhKeys = new Set(leafEntries(zh[ns]!).map(([key]) => key));
      for (const key of enKeys) {
        if (key.endsWith("_other") && zhKeys.has(key)) {
          expect(zhKeys.has(key.replace(/_other$/, "")), `${ns}.${key} pair`).toBe(true);
        }
      }
    }
  });
});