import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/compare/cli.js";

afterEach(() => vi.restoreAllMocks());

describe("harness-compare CLI", () => {
  it("prints discoverable help without running a comparison", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(main(["--help"])).resolves.toBe(0);

    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("harness-compare run <experiment.json>"));
  });

  it("rejects unknown commands on stderr", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(main(["compare"])).resolves.toBe(2);

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Expected: harness-compare run"));
  });
});
