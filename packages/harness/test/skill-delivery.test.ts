import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileHarness } from "../src/compiler/compile.js";
import { buildRunPreamble } from "../src/exec/executor.js";
import {
  HarnessSkillDeliveryError,
  MAX_DELIVERED_SKILL_BYTES,
  loadSkillDeliveries,
} from "../src/exec/skill-delivery.js";
import type { HarnessIrBundle, HarnessRevision } from "../src/ir/index.js";
import { describeAdapter } from "../src/resolver/adapter-descriptor.js";
import { resolveHarness } from "../src/resolver/resolve.js";
import { lockCapabilitySources } from "../src/resolver/source-lock.js";

const ADAPTER = describeAdapter({ adapterId: "@harness/adapter-qoder" });

const SOURCE = `
language 0.3
skill deep-guide {
  source "./skills/deep-guide"
}
workflow single { session coder }
harness h {
  workflow single
  agent coder { use skill deep-guide }
}
runtime qoder { adapter "@harness/adapter-qoder" }
deployment h-qoder { harness h runtime qoder }
`;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "harness-skill-delivery-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSkill(body: string, extras: Record<string, string> = {}): Promise<void> {
  const directory = join(root, "skills", "deep-guide");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), body, "utf8");
  for (const [name, content] of Object.entries(extras)) {
    const target = join(directory, name);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

async function resolveFixture(): Promise<{ revision: HarnessRevision; bundle: HarnessIrBundle }> {
  const compiled = await compileHarness(SOURCE);
  const bundle = compiled.bundle!;
  const sourceLocks = await lockCapabilitySources(bundle, { root });
  const { revision, report } = resolveHarness(bundle, "h", "qoder", { adapter: ADAPTER, sourceLocks });
  expect(report.errors).toEqual([]);
  return { revision: revision!, bundle };
}

describe("loadSkillDeliveries", () => {
  it("puts the skill's own text into the run preamble instead of its path", async () => {
    await writeSkill("STEP 1: never edit generated files.\nSTEP 2: run the suite before reporting done.\n");
    const { revision, bundle } = await resolveFixture();

    const deliveries = await loadSkillDeliveries(revision, bundle, { sourceRoot: root });
    const { preamble, warnings } = buildRunPreamble(revision, bundle, undefined, deliveries);

    expect(deliveries.get("deep-guide")?.body).toContain("STEP 1: never edit generated files.");
    expect(preamble).toContain("## Skill: deep-guide");
    expect(preamble).toContain("STEP 2: run the suite before reporting done.");
    expect(warnings).toEqual([]);
  });

  it("names the files a skill can progressively disclose without inlining them", async () => {
    await writeSkill("Entry guidance.\n", { "references/api.md": "# deep reference\n" });
    const { revision, bundle } = await resolveFixture();

    const deliveries = await loadSkillDeliveries(revision, bundle, { sourceRoot: root });
    const { preamble } = buildRunPreamble(revision, bundle, undefined, deliveries);

    expect(deliveries.get("deep-guide")?.references).toEqual(["references/api.md"]);
    expect(preamble).toContain("references/api.md");
    expect(preamble).not.toContain("# deep reference");
  });

  it("reports truncation rather than silently trimming an oversized skill", async () => {
    await writeSkill(`${"g".repeat(MAX_DELIVERED_SKILL_BYTES + 500)}\n`);
    const { revision, bundle } = await resolveFixture();

    const deliveries = await loadSkillDeliveries(revision, bundle, { sourceRoot: root });
    const { warnings } = buildRunPreamble(revision, bundle, undefined, deliveries);

    expect(deliveries.get("deep-guide")?.truncated).toBe(true);
    expect(Buffer.byteLength(deliveries.get("deep-guide")!.body, "utf8")).toBe(
      MAX_DELIVERED_SKILL_BYTES,
    );
    expect(warnings.join("\n")).toContain("was truncated");
  });

  it("fails closed when a skill directory has no entry file to deliver", async () => {
    const directory = join(root, "skills", "deep-guide");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "notes.md"), "not the entry file\n", "utf8");
    const { revision, bundle } = await resolveFixture();

    await expect(loadSkillDeliveries(revision, bundle, { sourceRoot: root })).rejects.toThrow(
      HarnessSkillDeliveryError,
    );
  });

  it("refuses to deliver a source-backed skill without the root it was locked against", async () => {
    await writeSkill("Entry guidance.\n");
    const { revision, bundle } = await resolveFixture();

    await expect(loadSkillDeliveries(revision, bundle)).rejects.toThrow(HarnessSkillDeliveryError);
  });

  it("warns when a caller builds a preamble without loading the skill's source", async () => {
    await writeSkill("Entry guidance.\n");
    const { revision, bundle } = await resolveFixture();

    const { preamble, warnings } = buildRunPreamble(revision, bundle);

    expect(preamble).not.toContain("Entry guidance.");
    expect(warnings.join("\n")).toContain("no content was delivered into this run");
  });

  it("needs no delivery for a skill whose whole contract is its inline description", async () => {
    const compiled = await compileHarness(`
      language 0.3
      skill inline { description "Prove the change with a test." }
      workflow single { session coder }
      harness h {
        workflow single
        agent coder { use skill inline }
      }
      runtime qoder { adapter "@harness/adapter-qoder" }
      deployment h-qoder { harness h runtime qoder }
    `);
    const bundle = compiled.bundle!;
    const { revision } = resolveHarness(bundle, "h", "qoder", { adapter: ADAPTER });

    const deliveries = await loadSkillDeliveries(revision!, bundle);
    const { preamble } = buildRunPreamble(revision!, bundle, undefined, deliveries);

    expect(deliveries.size).toBe(0);
    expect(preamble).toContain("Prove the change with a test.");
  });
});
