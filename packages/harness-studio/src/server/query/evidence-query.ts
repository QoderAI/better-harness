import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Reads the frozen `harness-compare.v1` verdict as raw JSON text. */
export async function loadEvidenceVerdict(evidenceDir: string): Promise<string> {
  return readFile(join(evidenceDir, "verdict.json"), "utf8");
}
