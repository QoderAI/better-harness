/**
 * Skill delivery: turning a declared skill source into guidance the model reads.
 *
 * A skill's realization dimension is *delivered*, and prompt text genuinely can
 * deliver guidance — but only guidance it actually contains. A `source`
 * directory names progressive knowledge that lives on disk, so naming the path
 * in the preamble delivers nothing: the model cannot read a path. This module
 * reads the declared source and produces the text the executor inlines, so a
 * source-backed skill's `delivered` realization is backed by bytes that reached
 * the model.
 *
 * The read is bounded and fails closed. A source that cannot be delivered is an
 * error before the run starts, never a silent downgrade to a path reference.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { HarnessIrBundle, HarnessRevision, SkillIr } from "../ir/index.js";
import { resolveContainedSource } from "../resolver/source-lock.js";

/** Entry point of an Agent Skills source directory. */
export const SKILL_ENTRY_FILE = "SKILL.md";

/**
 * Largest skill body inlined into a run preamble. Progressive disclosure means
 * the entry file is the contract and the rest is read on demand, so a source
 * that blows past this is reported as truncated rather than silently eating the
 * context window.
 */
export const MAX_DELIVERED_SKILL_BYTES = 32_768;

/** Largest number of sibling files named as available references. */
const MAX_LISTED_REFERENCES = 64;

export interface SkillDelivery {
  capabilityId: string;
  /** The declared source, as written in the DSL. */
  source: string;
  /** Contained absolute path the body was read from, for callers that copy the tree. */
  absolutePath: string;
  /** True when the source is a directory whose entry file was delivered. */
  directory: boolean;
  /** Guidance text placed into the run preamble. */
  body: string;
  /** Other files under the source, named but not inlined. */
  references: string[];
  truncated: boolean;
  originalBytes: number;
}

export type SkillDeliveryMap = ReadonlyMap<string, SkillDelivery>;

export class HarnessSkillDeliveryError extends Error {
  constructor(
    readonly capabilityId: string,
    detail: string,
  ) {
    super(`Cannot deliver skill '${capabilityId}': ${detail}`);
    this.name = "HarnessSkillDeliveryError";
  }
}

/**
 * Read every source-backed skill this revision realizes.
 *
 * Skills whose whole contract is the inline `description` need no delivery:
 * their text is already in the IR and the preamble already carries it. Only a
 * `source` has content the run would otherwise never see.
 *
 * `sourceRoot` is the same root the revision's locks were created against, not
 * the task working directory, so moving the agent's cwd cannot retarget what a
 * skill delivers.
 */
export async function loadSkillDeliveries(
  revision: HarnessRevision,
  bundle: HarnessIrBundle,
  options: { sourceRoot?: string } = {},
): Promise<SkillDeliveryMap> {
  const pending = sourceBackedSkills(revision, bundle);
  if (pending.length === 0) {
    return new Map();
  }
  if (options.sourceRoot === undefined) {
    throw new HarnessSkillDeliveryError(
      pending[0].id,
      "the revision realizes skills backed by a source directory; provide the source root " +
        "those skills were locked against so their guidance can be delivered.",
    );
  }
  const deliveries = new Map<string, SkillDelivery>();
  for (const skill of pending) {
    deliveries.set(skill.id, await deliverOne(skill, options.sourceRoot));
  }
  return deliveries;
}

/**
 * Source-backed skills the revision actually realizes, deduplicated across the
 * agent roles that require them.
 */
function sourceBackedSkills(revision: HarnessRevision, bundle: HarnessIrBundle): SkillIr[] {
  const realized = new Set(
    revision.realization
      .filter(
        (realization) =>
          realization.capabilityKind === "skill" &&
          realization.state === "satisfied",
      )
      .map((realization) => realization.capabilityId),
  );
  return bundle.skills
    .filter((skill) => skill.source !== undefined && realized.has(skill.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function deliverOne(skill: SkillIr, sourceRoot: string): Promise<SkillDelivery> {
  const source = skill.source as string;
  let absolute: string;
  try {
    absolute = await resolveContainedSource(sourceRoot, source);
  } catch (error) {
    throw new HarnessSkillDeliveryError(skill.id, errorMessage(error));
  }
  const metadata = await stat(absolute).catch((error: unknown) => {
    throw new HarnessSkillDeliveryError(skill.id, errorMessage(error));
  });

  if (metadata.isFile()) {
    return buildDelivery(skill, source, absolute, false, await readFile(absolute, "utf8"), []);
  }
  if (!metadata.isDirectory()) {
    throw new HarnessSkillDeliveryError(skill.id, `'${source}' is neither a file nor a directory`);
  }
  const entryPath = join(absolute, SKILL_ENTRY_FILE);
  const entry = await readFile(entryPath, "utf8").catch(() => undefined);
  if (entry === undefined) {
    throw new HarnessSkillDeliveryError(
      skill.id,
      `'${source}' declares a skill directory with no ${SKILL_ENTRY_FILE}; the Agent Skills ` +
        `entry file is what a run delivers.`,
    );
  }
  return buildDelivery(skill, source, absolute, true, entry, await listReferences(absolute));
}

function buildDelivery(
  skill: SkillIr,
  source: string,
  absolutePath: string,
  directory: boolean,
  content: string,
  references: string[],
): SkillDelivery {
  const bytes = Buffer.from(content, "utf8");
  const truncated = bytes.byteLength > MAX_DELIVERED_SKILL_BYTES;
  return {
    capabilityId: skill.id,
    source,
    absolutePath,
    directory,
    body: truncated
      ? bytes.subarray(0, MAX_DELIVERED_SKILL_BYTES).toString("utf8")
      : content,
    references,
    truncated,
    originalBytes: bytes.byteLength,
  };
}

/** Sibling files under a skill directory, named so the model knows they exist. */
async function listReferences(directory: string): Promise<string[]> {
  const found: string[] = [];
  await walk(directory);
  return found.sort().slice(0, MAX_LISTED_REFERENCES);

  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (found.length >= MAX_LISTED_REFERENCES) {
        return;
      }
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && absolute !== join(directory, SKILL_ENTRY_FILE)) {
        found.push(relative(directory, absolute).replaceAll("\\", "/"));
      }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
