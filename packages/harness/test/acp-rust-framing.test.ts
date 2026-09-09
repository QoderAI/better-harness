import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { compileHarness } from "../src/compiler/compile.js";
import { AcpRustExecutor } from "../src/exec/acp-rust.js";
import { resolveHarness } from "../src/resolver/resolve.js";
import { ACP_ADAPTER_DESCRIPTOR } from "../src/resolver/adapter-registry.js";

/**
 * Framing limits are enforced before any protocol parsing, so these drive a
 * stand-in host through `spawnHost` and need no staged Rust executable.
 */
const SOURCE = `
  language 0.3
  skill verify { description "Return verified evidence." }
  workflow single { session coder }
  harness live-acp {
    workflow single
    agent coder { use skill verify }
  }
  runtime acp { adapter "@harness/adapter-acp" }
  deployment live-acp-run { harness live-acp runtime acp }
`;

async function revisionUnderTest() {
  const { bundle } = await compileHarness(SOURCE);
  const { revision, report } = resolveHarness(bundle!, "live-acp", "acp", {
    adapter: () => ACP_ADAPTER_DESCRIPTOR,
  });
  expect(report.errors).toEqual([]);
  return { bundle: bundle!, revision: revision! };
}

/** Emits one oversized line, then idles so the client owns the lifecycle. */
function floodingHost(characters: number) {
  const script = `process.stdout.write("你".repeat(${characters}) + "\\n"); setInterval(() => {}, 1000);`;
  return (() => spawn(process.execPath, ["-e", script], { stdio: "pipe" })) as unknown as typeof spawn;
}

describe("ACP host framing", () => {
  it("counts the frame budget in bytes rather than UTF-16 units", async () => {
    // 6.5M CJK characters are ~19.5MB of UTF-8 but only 6.5M string units. A
    // character-counted budget admits them past a 16MiB limit and only trips
    // later, on parse — which reports the wrong fault and buffers 3x the budget.
    const { bundle, revision } = await revisionUnderTest();
    const executor = new AcpRustExecutor({
      hostExecutable: "/native/harness-acp-host",
      command: process.execPath,
      args: [],
      spawnHost: floodingHost(6_500_000),
    });
    const result = await executor.execute(revision, bundle, { prompt: "framing" });
    expect(result.exitCode).toBe(1);
    expect(result.errorOutput).toContain("exceeds its size limit");
  });
});
