import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessRevision } from "../ir/index.js";
import type { CompareVariant, HarnessCompareVerdict } from "./aggregate.js";
import { parseHarnessCompareVerdict } from "./verdict.js";

export async function parseHarnessCompareVerdictDirectory(
  directory: string,
): Promise<HarnessCompareVerdict> {
  const verdict = parseHarnessCompareVerdict(
    JSON.parse(await readFile(join(directory, "verdict.json"), "utf8")) as unknown,
  );
  const revisions = new Map<CompareVariant, HarnessRevision>();
  for (const [variant, name] of [["baseline", "H0"], ["candidate", "H1"]] as const) {
    let revision: HarnessRevision;
    try {
      revision = JSON.parse(
        await readFile(join(directory, name, "revision.json"), "utf8"),
      ) as HarnessRevision;
    } catch (error) {
      throw new Error(`Invalid harness compare evidence directory: missing ${name}/revision.json.`, { cause: error });
    }
    revisions.set(variant, revision);
  }
  for (const trial of verdict.trials) {
    if (revisions.get(trial.variant)?.revisionId !== trial.revisionId) {
      throw new Error(
        `Invalid harness compare evidence directory: ${trial.variant} trial ${trial.trial} ` +
          "revisionId does not match its variant revision.json.",
      );
    }
  }
  return verdict;
}
