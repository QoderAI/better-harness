import { canonicalJson, contentHash } from "../ir/canonical.js";
import {
  CUSTOMIZATION_CATALOG_KIND,
  CUSTOMIZATION_SCHEMA_VERSION,
  type CustomizationCatalogSummaryV1,
  type CustomizationCatalogV1,
  type CustomizationDefinitionV1,
  type CustomizationDigest,
} from "./model.js";

const DEFINITION_KINDS: readonly CustomizationDefinitionV1["kind"][] = [
  "instruction",
  "agent-skill",
  "prompt-command",
  "agent-definition",
  "hook",
  "mcp-server-definition",
];

export function customizationId(namespace: string, identity: unknown): string {
  return `${namespace}:${contentHash(identity).slice("sha256:".length)}`;
}

export function customizationRevision(value: unknown): CustomizationDigest {
  return contentHash(value) as CustomizationDigest;
}

export function summarizeCustomizationCatalog(catalog: CustomizationCatalogV1): CustomizationCatalogSummaryV1 {
  const definitionsByKind = Object.fromEntries(DEFINITION_KINDS.map((kind) => [kind, 0])) as Record<
    CustomizationDefinitionV1["kind"],
    number
  >;
  for (const definition of catalog.definitions) definitionsByKind[definition.kind] += 1;
  return {
    packageCount: catalog.packages.length,
    definitionCount: catalog.definitions.length,
    installationCount: catalog.installations.length,
    exposureCount: catalog.exposures.length,
    registrationCount: catalog.registrations.length,
    runtimeObservationCount: catalog.runtimeObservations.length,
    definitionsByKind,
    hosts: catalog.hosts.map((host) => ({
      ...host,
      definitions: new Set([
        ...catalog.exposures.filter((item) => item.hostId === host.id).map((item) => item.definitionId),
        ...catalog.registrations.filter((item) => item.hostId === host.id).map((item) => item.definitionId),
      ]).size,
      packages: new Set(catalog.installations.filter((item) => item.hostId === host.id).map((item) => item.packageId)).size,
      registrations: catalog.registrations.filter((item) => item.hostId === host.id).length,
    })),
  };
}

export function isCustomizationCatalogV1(value: unknown): value is CustomizationCatalogV1 {
  if (!isRecord(value)) return false;
  return value.kind === CUSTOMIZATION_CATALOG_KIND
    && value.schemaVersion === CUSTOMIZATION_SCHEMA_VERSION
    && typeof value.generatedAt === "string"
    && isRecord(value.workspace)
    && typeof value.workspace.label === "string"
    && typeof value.workspace.evidenceId === "string"
    && Array.isArray(value.hosts)
    && Array.isArray(value.packages)
    && Array.isArray(value.definitions)
    && value.definitions.every((definition) => isRecord(definition) && DEFINITION_KINDS.includes(definition.kind as CustomizationDefinitionV1["kind"]))
    && Array.isArray(value.installations)
    && Array.isArray(value.exposures)
    && Array.isArray(value.registrations)
    && Array.isArray(value.runtimeObservations);
}

export function assertCustomizationCatalogV1(value: unknown): asserts value is CustomizationCatalogV1 {
  if (!isCustomizationCatalogV1(value)) throw new TypeError("Invalid Better Harness Customization Catalog V1 document.");
  const catalog = value;
  assertUniqueIds("package", catalog.packages);
  assertUniqueIds("definition", catalog.definitions);
  assertUniqueIds("installation", catalog.installations);
  assertUniqueIds("exposure", catalog.exposures);
  assertUniqueIds("registration", catalog.registrations);
  assertUniqueIds("runtime observation", catalog.runtimeObservations);

  const packageIds = new Set(catalog.packages.map(({ id }) => id));
  const definitionIds = new Set(catalog.definitions.map(({ id }) => id));
  for (const installation of catalog.installations) {
    if (!packageIds.has(installation.packageId)) throw new TypeError(`Installation '${installation.id}' references an unknown package.`);
  }
  for (const exposure of catalog.exposures) {
    if (!definitionIds.has(exposure.definitionId)) throw new TypeError(`Exposure '${exposure.id}' references an unknown definition.`);
    if (exposure.contributedByPackageId !== undefined && !packageIds.has(exposure.contributedByPackageId)) {
      throw new TypeError(`Exposure '${exposure.id}' references an unknown contributing package.`);
    }
  }
  for (const registration of catalog.registrations) {
    if (!definitionIds.has(registration.definitionId)) throw new TypeError(`Registration '${registration.id}' references an unknown definition.`);
  }
}

export function canonicalCustomizationCatalog(catalog: CustomizationCatalogV1): string {
  assertCustomizationCatalogV1(catalog);
  return canonicalJson(catalog);
}

function assertUniqueIds(label: string, values: readonly { id: string }[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value.id || seen.has(value.id)) throw new TypeError(`Customization catalog contains a duplicate or empty ${label} id.`);
    seen.add(value.id);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
