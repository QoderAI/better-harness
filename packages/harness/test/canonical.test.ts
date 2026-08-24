import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../src/ir/canonical.js";

describe("browser-safe canonical hashing", () => {
  it("matches the SHA-256 standard vectors without a Node builtin", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(canonicalJson({ z: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"z":1}');
  });
});
