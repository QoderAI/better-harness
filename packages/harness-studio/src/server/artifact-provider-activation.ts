import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
import type {
  ArtifactExternalLane,
  ArtifactMatcher,
  ArtifactProviderActivation,
  ExternalArtifactProvider,
} from "./artifact-adapter-contract.js";
import { PROVIDER_HOSTED_CANVAS_TSX_FORMAT } from "./artifact-catalog.js";

export const ARTIFACT_PROVIDER_ACTIVATION_STATE_KIND = "HarnessStudioArtifactProviderActivationStateV1" as const;
export const QODER_LEGACY_IMPORT_ID = "qoder-canvas-manifest-v1" as const;
const MAX_STATE_BYTES = 1024 * 1024;

export interface ArtifactProviderMigrationMarker {
  id: typeof QODER_LEGACY_IMPORT_ID;
  sourceFingerprint: `sha256:${string}`;
  importedAt: string;
}

export interface ArtifactProviderActivationState {
  kind: typeof ARTIFACT_PROVIDER_ACTIVATION_STATE_KIND;
  activations: ArtifactProviderActivation[];
  migrations: ArtifactProviderMigrationMarker[];
}

export interface ArtifactProviderActivationStoreOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  now?: () => Date;
}

let writeQueue: Promise<void> = Promise.resolve();

export function defaultArtifactProviderStateRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  const platformPath = platform === "win32" ? win32 : posix;
  if (env.HARNESS_STUDIO_CONFIG_HOME !== undefined) return platformPath.resolve(env.HARNESS_STUDIO_CONFIG_HOME);
  if (platform === "darwin") return platformPath.join(home, "Library", "Application Support", "QoderAI", "HarnessStudio");
  if (platform === "win32") {
    const roaming = env.APPDATA === undefined
      ? platformPath.join(home, "AppData", "Roaming")
      : platformPath.resolve(env.APPDATA);
    return platformPath.join(roaming, "QoderAI", "HarnessStudio");
  }
  const xdg = env.XDG_CONFIG_HOME === undefined
    ? platformPath.join(home, ".config")
    : platformPath.resolve(env.XDG_CONFIG_HOME);
  return platformPath.join(xdg, "harness-studio");
}

export function artifactProviderActivationStatePath(options: ArtifactProviderActivationStoreOptions = {}): string {
  return join(resolve(options.root ?? defaultArtifactProviderStateRoot(options.env, options.platform, options.home)), "artifact-providers", "activations.json");
}

export async function readArtifactProviderActivationState(
  options: ArtifactProviderActivationStoreOptions = {},
): Promise<ArtifactProviderActivationState> {
  try {
    const bytes = await readFile(artifactProviderActivationStatePath(options));
    if (bytes.byteLength > MAX_STATE_BYTES) throw new Error("Artifact provider activation state exceeds the size limit.");
    return parseActivationState(JSON.parse(bytes.toString("utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }
}

export async function activateArtifactContribution(
  provider: ExternalArtifactProvider,
  contributionId: string,
  lane: ArtifactExternalLane,
  matcher: ArtifactMatcher,
  options: ArtifactProviderActivationStoreOptions = {},
): Promise<ArtifactProviderActivationState> {
  const contribution = provider.contributions.find((candidate) => candidate.id === contributionId);
  if (contribution === undefined) throw new Error(`Provider '${provider.id}' has no contribution '${contributionId}'.`);
  assertMatcher(matcher);
  if (lane === "external-override" && matcherNamesAuthoredCodeFormat(matcher)) {
    throw new Error("Protected authored TSX and JSX formats cannot be activated as external overrides.");
  }
  return await updateState(options, (state) => ({
    ...state,
    activations: [
      ...state.activations.filter((candidate) => !(candidate.providerId === provider.id && candidate.contributionId === contributionId)),
      activationFor(provider, contributionId, lane, matcher, "explicit", options.now),
    ],
  }));
}

export async function deactivateArtifactContribution(
  providerId: string,
  contributionId: string,
  options: ArtifactProviderActivationStoreOptions = {},
): Promise<ArtifactProviderActivationState> {
  return await updateState(options, (state) => ({
    ...state,
    activations: state.activations.filter((candidate) => !(candidate.providerId === providerId
      && candidate.contributionId === contributionId)),
  }));
}

/** Import legacy Qoder precedence once for one exact discovery-source identity. */
export async function importLegacyQoderActivationsOnce(
  providers: readonly ExternalArtifactProvider[],
  sourceFingerprint: `sha256:${string}`,
  options: ArtifactProviderActivationStoreOptions = {},
): Promise<ArtifactProviderActivationState> {
  return await updateState(options, (state) => {
    if (state.migrations.some((marker) => marker.id === QODER_LEGACY_IMPORT_ID)) return state;
    const imported: ArtifactProviderActivation[] = [];
    for (const provider of providers) {
      for (const contribution of provider.contributions) {
        if (contribution.legacyOverrideRequested !== true) continue;
        const matcher = legacyDataMatcher(contribution.matcher);
        if (matcher === undefined) continue;
        imported.push(activationFor(provider, contribution.id, "external-override", matcher, "legacy-import", options.now));
      }
    }
    const importedAt = (options.now ?? (() => new Date()))().toISOString();
    return {
      ...state,
      activations: [...state.activations, ...imported.filter((candidate) => !state.activations.some((existing) =>
        existing.providerId === candidate.providerId && existing.contributionId === candidate.contributionId))],
      migrations: [...state.migrations, { id: QODER_LEGACY_IMPORT_ID, sourceFingerprint, importedAt }],
    };
  });
}

export function activationSourceFingerprint(source: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function activationFor(
  provider: ExternalArtifactProvider,
  contributionId: string,
  lane: ArtifactExternalLane,
  matcher: ArtifactMatcher,
  consent: ArtifactProviderActivation["consent"],
  now: ArtifactProviderActivationStoreOptions["now"],
): ArtifactProviderActivation {
  const contribution = provider.contributions.find((candidate) => candidate.id === contributionId)!;
  return {
    providerId: provider.id,
    contributionId,
    fingerprint: provider.fingerprint,
    lane,
    matcher: normalizeMatcher(matcher),
    contributionSupport: contribution.support,
    ...(contribution.adapterExecutionProfile === undefined ? {} : { adapterExecutionProfile: contribution.adapterExecutionProfile }),
    ...(contribution.surface.kind === "external-hosted"
      ? { surfaceSecurityProfile: contribution.surface.securityProfileId }
      : {}),
    consent,
    activatedAt: (now ?? (() => new Date()))().toISOString(),
  };
}

async function updateState(
  options: ArtifactProviderActivationStoreOptions,
  update: (state: ArtifactProviderActivationState) => ArtifactProviderActivationState,
): Promise<ArtifactProviderActivationState> {
  let result = emptyState();
  const operation = writeQueue.then(async () => {
    const state = await readArtifactProviderActivationState(options);
    result = parseActivationState(update(state));
    const path = artifactProviderActivationStatePath(options);
    await mkdir(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.activations-${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(result, undefined, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  });
  writeQueue = operation.catch(() => undefined);
  await operation;
  return result;
}

function emptyState(): ArtifactProviderActivationState {
  return { kind: ARTIFACT_PROVIDER_ACTIVATION_STATE_KIND, activations: [], migrations: [] };
}

function parseActivationState(value: unknown): ArtifactProviderActivationState {
  if (!isRecord(value) || value.kind !== ARTIFACT_PROVIDER_ACTIVATION_STATE_KIND
    || !Array.isArray(value.activations) || !Array.isArray(value.migrations)) {
    throw new Error("Artifact provider activation state is invalid.");
  }
  const activations = value.activations.map(parseActivation);
  const migrations = value.migrations.map((marker) => {
    if (!isRecord(marker) || marker.id !== QODER_LEGACY_IMPORT_ID || !isDigest(marker.sourceFingerprint)
      || typeof marker.importedAt !== "string") throw new Error("Artifact provider migration marker is invalid.");
    return { id: marker.id, sourceFingerprint: marker.sourceFingerprint, importedAt: marker.importedAt };
  });
  return { kind: ARTIFACT_PROVIDER_ACTIVATION_STATE_KIND, activations, migrations };
}

function parseActivation(value: unknown): ArtifactProviderActivation {
  if (!isRecord(value) || typeof value.providerId !== "string" || typeof value.contributionId !== "string"
    || !isDigest(value.fingerprint) || !["external-override", "external-fallback"].includes(String(value.lane))
    || !["reviewed", "experimental-local"].includes(String(value.contributionSupport))
    || !["explicit", "legacy-import"].includes(String(value.consent)) || typeof value.activatedAt !== "string") {
    throw new Error("Artifact provider activation is invalid.");
  }
  const matcher = parseMatcher(value.matcher);
  const adapterExecutionProfile = value.adapterExecutionProfile;
  if (adapterExecutionProfile !== undefined && !["trusted-local-process", "confined-wasm"].includes(String(adapterExecutionProfile))) {
    throw new Error("Artifact provider adapter profile is invalid.");
  }
  const surfaceSecurityProfile = value.surfaceSecurityProfile;
  if (surfaceSecurityProfile !== undefined && surfaceSecurityProfile !== "opaque-web-v1") {
    throw new Error("Artifact provider surface profile is invalid.");
  }
  return {
    providerId: value.providerId,
    contributionId: value.contributionId,
    fingerprint: value.fingerprint,
    lane: value.lane as ArtifactExternalLane,
    matcher,
    contributionSupport: value.contributionSupport as ArtifactProviderActivation["contributionSupport"],
    ...(adapterExecutionProfile === undefined ? {} : { adapterExecutionProfile: adapterExecutionProfile as ArtifactProviderActivation["adapterExecutionProfile"] }),
    ...(surfaceSecurityProfile === undefined ? {} : { surfaceSecurityProfile: "opaque-web-v1" }),
    consent: value.consent as ArtifactProviderActivation["consent"],
    activatedAt: value.activatedAt,
  };
}

function parseMatcher(value: unknown): ArtifactMatcher {
  if (!isRecord(value)) throw new Error("Artifact provider matcher is invalid.");
  const matcher: ArtifactMatcher = {
    ...(parseStringArray(value.formats, "formats")),
    ...(parseStringArray(value.extensions, "extensions")),
    ...(parseStringArray(value.pathGlobs, "pathGlobs")),
  };
  assertMatcher(matcher);
  return normalizeMatcher(matcher);
}

function parseStringArray(value: unknown, key: keyof ArtifactMatcher): Partial<ArtifactMatcher> {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length > 64 || value.some((item) => typeof item !== "string" || item.length === 0 || item.length > 256)) {
    throw new Error(`Artifact provider matcher '${key}' is invalid.`);
  }
  return { [key]: value };
}

function normalizeMatcher(matcher: ArtifactMatcher): ArtifactMatcher {
  return {
    ...(matcher.formats === undefined ? {} : { formats: [...new Set(matcher.formats.map((value) => value.toLowerCase()))].sort() }),
    ...(matcher.extensions === undefined ? {} : { extensions: [...new Set(matcher.extensions.map((value) => value.replace(/^\./u, "").toLowerCase()))].sort() }),
    ...(matcher.pathGlobs === undefined ? {} : { pathGlobs: [...new Set(matcher.pathGlobs.map((value) => value.replaceAll("\\", "/")))].sort() }),
  };
}

function assertMatcher(matcher: ArtifactMatcher): void {
  if ((matcher.formats?.length ?? 0) + (matcher.extensions?.length ?? 0) + (matcher.pathGlobs?.length ?? 0) === 0) {
    throw new Error("Artifact provider activation requires a non-empty matcher scope.");
  }
  for (const glob of matcher.pathGlobs ?? []) {
    if (glob.startsWith("/") || glob.includes("..") || /^[a-z]:/iu.test(glob)) {
      throw new Error("Artifact provider activation path globs must be portable relative paths.");
    }
  }
}

function legacyDataMatcher(matcher: ArtifactMatcher): ArtifactMatcher | undefined {
  const protectedValues = new Set([
    "tsx",
    "jsx",
    "svg",
    "mmd",
    "mermaid",
    PROVIDER_HOSTED_CANVAS_TSX_FORMAT,
  ]);
  const formats = (matcher.formats ?? []).filter((value) => !protectedValues.has(value.toLowerCase()));
  const extensions = (matcher.extensions ?? []).filter((value) => !protectedValues.has(value.replace(/^\./u, "").toLowerCase()));
  const pathGlobs = (matcher.pathGlobs ?? []).filter((value) => {
    const extension = value.match(/\.([a-z0-9]+)$/iu)?.[1]?.toLowerCase();
    return extension === undefined || !protectedValues.has(extension);
  });
  if (formats.length + extensions.length + pathGlobs.length === 0) return undefined;
  return normalizeMatcher({
    ...(formats.length === 0 ? {} : { formats }),
    ...(extensions.length === 0 ? {} : { extensions }),
    ...(pathGlobs.length === 0 ? {} : { pathGlobs }),
  });
}

function matcherNamesAuthoredCodeFormat(matcher: ArtifactMatcher): boolean {
  const protectedValues = new Set(["tsx", "jsx", PROVIDER_HOSTED_CANVAS_TSX_FORMAT]);
  if ([...(matcher.formats ?? []), ...(matcher.extensions ?? [])]
    .some((value) => protectedValues.has(value.replace(/^\./u, "").toLowerCase()))) return true;
  return (matcher.pathGlobs ?? []).some((value) => {
    const extension = value.match(/\.([a-z0-9]+)$/iu)?.[1]?.toLowerCase();
    return extension !== undefined && protectedValues.has(extension);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}
