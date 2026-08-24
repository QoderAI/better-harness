import { readFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { QoderRuntimeProfile } from "../exec/qoder-sdk.js";
import type { CompareTreatmentAxis } from "./aggregate.js";

const RelativePathSchema = Type.String({ minLength: 1, maxLength: 512 });
const IdentifierSchema = Type.String({ pattern: "^[_a-zA-Z][\\w-]*$" });
const QoderRuntimeProfileSchema = Type.Union([
  Type.Literal("qoder-default-v1"),
  Type.Literal("qoder-minimal-v1"),
]);

/** Host tools that reach the network and must be unavailable under a denied network. */
const NETWORK_TOOLS = ["WebFetch", "WebSearch"];

export const HarnessCompareManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal("harness-compare.v1"),
    harness: RelativePathSchema,
    variants: Type.Object(
      { baseline: IdentifierSchema, candidate: IdentifierSchema },
      { additionalProperties: false },
    ),
    runtimeProfiles: Type.Optional(Type.Object(
      {
        baseline: QoderRuntimeProfileSchema,
        candidate: QoderRuntimeProfileSchema,
      },
      { additionalProperties: false },
    )),
    task: Type.Object(
      {
        fixture: RelativePathSchema,
        prompt: RelativePathSchema,
        expectedFiles: Type.Array(RelativePathSchema, { minItems: 1, maxItems: 32, uniqueItems: true }),
        grader: Type.Object(
          { kind: Type.Literal("readme-package-v1"), contract: RelativePathSchema },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    runtime: Type.Object(
      {
        host: Type.Literal("qoder"),
        model: Type.String({ minLength: 1, maxLength: 128 }),
        tools: Type.Array(Type.String(), { minItems: 1, maxItems: 32, uniqueItems: true }),
        allowedTools: Type.Array(Type.String(), { maxItems: 32, uniqueItems: true }),
        disallowedTools: Type.Array(Type.String(), { maxItems: 32, uniqueItems: true }),
        permissionMode: Type.Literal("default"),
        maxTurns: Type.Integer({ minimum: 2, maximum: 50 }),
        timeoutMs: Type.Integer({ minimum: 1_000, maximum: 1_800_000 }),
        network: Type.Literal("deny"),
        enableFileCheckpointing: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    trials: Type.Object(
      {
        count: Type.Integer({ minimum: 1, maximum: 20 }),
        seed: Type.Integer({ minimum: 0, maximum: 4_294_967_295 }),
        order: Type.Literal("randomized"),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type HarnessCompareManifest = Static<typeof HarnessCompareManifestSchema>;
export type HarnessCompareVariant = "baseline" | "candidate";
export type ResolvedHarnessCompareRuntime = HarnessCompareManifest["runtime"] & {
  profile: QoderRuntimeProfile;
};

export interface LoadedHarnessCompareManifest {
  path: string;
  directory: string;
  value: HarnessCompareManifest;
  resolved: {
    harness: string;
    fixture: string;
    prompt: string;
    graderContract: string;
  };
}

export async function loadHarnessCompareManifest(path: string): Promise<LoadedHarnessCompareManifest> {
  const manifestPath = resolve(path);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read harness compare manifest '${path}': ${errorMessage(error)}`);
  }
  if (!Value.Check(HarnessCompareManifestSchema, value)) {
    const details = [...Value.Errors(HarnessCompareManifestSchema, value)]
      .slice(0, 8)
      .map((error) => `${error.path || "/"}: ${error.message}`)
      .join("; ");
    throw new Error(`Invalid harness-compare.v1 manifest: ${details}`);
  }
  validateManifestPolicy(value);
  const directory = resolve(manifestPath, "..");
  return {
    path: manifestPath,
    directory,
    value,
    resolved: {
      harness: resolveOwnedPath(directory, value.harness, "harness"),
      fixture: resolveOwnedPath(directory, value.task.fixture, "task.fixture"),
      prompt: resolveOwnedPath(directory, value.task.prompt, "task.prompt"),
      graderContract: resolveOwnedPath(directory, value.task.grader.contract, "task.grader.contract"),
    },
  };
}

export function resolveHarnessCompareRuntime(
  manifest: HarnessCompareManifest,
  variant: HarnessCompareVariant,
): ResolvedHarnessCompareRuntime {
  const profile = manifest.runtimeProfiles?.[variant] ?? "qoder-default-v1";
  return {
    ...manifest.runtime,
    profile,
    tools: profile === "qoder-minimal-v1"
      ? ["Read", "Write", "Edit", "Bash"]
      : [...manifest.runtime.tools],
  };
}

/**
 * The single variable this manifest moves.
 *
 * A comparison that changed harness *and* runtime profile cannot attribute an
 * outcome difference to either, so exactly one axis may differ.
 */
export function treatmentAxisFor(manifest: HarnessCompareManifest): CompareTreatmentAxis {
  return manifest.variants.baseline === manifest.variants.candidate ? "runtime-profile" : "harness";
}

function validateManifestPolicy(manifest: HarnessCompareManifest): void {
  const harnessDiffers = manifest.variants.baseline !== manifest.variants.candidate;
  const profileDiffers =
    manifest.runtimeProfiles !== undefined &&
    manifest.runtimeProfiles.baseline !== manifest.runtimeProfiles.candidate;
  if (!harnessDiffers && !profileDiffers) {
    throw new Error(
      "Invalid harness-compare.v1 manifest: baseline and candidate must differ by harness or runtime profile.",
    );
  }
  if (harnessDiffers && profileDiffers) {
    throw new Error(
      "Invalid harness-compare.v1 manifest: baseline and candidate must differ on exactly one " +
        "treatment axis; moving both harness and runtime profile confounds the comparison.",
    );
  }
  validateRuntimePolicy(manifest.runtime, "runtime");
  for (const variant of ["baseline", "candidate"] as const) {
    validateRuntimePolicy(resolveHarnessCompareRuntime(manifest, variant), `runtimeProfiles.${variant}`);
  }
  for (const path of [
    manifest.harness,
    manifest.task.fixture,
    manifest.task.prompt,
    manifest.task.grader.contract,
    ...manifest.task.expectedFiles,
  ]) {
    assertPortableRelativePath(path);
  }
}

function validateRuntimePolicy(runtime: HarnessCompareManifest["runtime"], label: string): void {
  const requiredTools = ["Read", "Edit", "Write", "Bash"];
  const supportedTools = new Set(["Read", "Glob", "Grep", "Edit", "Write", "Bash"]);
  const unsupportedTools = runtime.tools.filter((tool) => !supportedTools.has(tool));
  if (unsupportedTools.length > 0) {
    throw new Error(
      `Invalid harness-compare.v1 manifest: ${label} has unsupported visible tools: ${unsupportedTools.join(", ")}.`,
    );
  }
  for (const tool of requiredTools) {
    if (!runtime.tools.includes(tool)) {
      throw new Error(`Invalid harness-compare.v1 manifest: ${label}.tools must include '${tool}'.`);
    }
  }
  if (runtime.allowedTools.length > 0) {
    throw new Error("Invalid harness-compare.v1 manifest: allowedTools must be empty; every tool use requires the bounded permission callback.");
  }
  if (runtime.network === "deny") {
    for (const tool of NETWORK_TOOLS) {
      if (!runtime.disallowedTools.includes(tool)) {
        throw new Error(
          `Invalid harness-compare.v1 manifest: network 'deny' requires disallowedTools to include '${tool}'.`,
        );
      }
    }
  }
  const unavailableRequiredTools = requiredTools.filter((tool) => runtime.disallowedTools.includes(tool));
  if (unavailableRequiredTools.length > 0) {
    throw new Error(
      `Invalid harness-compare.v1 manifest: required tools are also disallowed: ${unavailableRequiredTools.join(", ")}.`,
    );
  }
}

function resolveOwnedPath(base: string, relativePath: string, label: string): string {
  assertPortableRelativePath(relativePath);
  const result = resolve(base, relativePath);
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  if (result !== base && !result.startsWith(prefix)) {
    throw new Error(`Invalid harness-compare.v1 manifest: ${label} escapes the manifest directory.`);
  }
  return result;
}

function assertPortableRelativePath(value: string): void {
  if (
    isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error(`Invalid harness-compare.v1 manifest path '${value}'; use a portable relative path.`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
