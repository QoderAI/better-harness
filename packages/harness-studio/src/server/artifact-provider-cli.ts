import { resolve } from "node:path";
import type { ArtifactExternalLane, ArtifactMatcher } from "./artifact-adapter-contract.js";
import {
  activateArtifactContribution,
  deactivateArtifactContribution,
  readArtifactProviderActivationState,
} from "./artifact-provider-activation.js";
import { discoverArtifactProviderRuntime, type DiscoverArtifactProviderRuntimeOptions } from "./artifact-provider-discovery.js";

const HELP = `harness-studio artifact-provider — manage local Artifact providers

Usage:
  harness-studio artifact-provider list [options]
  harness-studio artifact-provider activate --provider <id> --contribution <id> --lane <external-override|external-fallback> <scope> [options]
  harness-studio artifact-provider deactivate --provider <id> --contribution <id> [options]

Scope (activate requires at least one):
  --format <name>       normalized Artifact format
  --extension <ext>     lowercase file extension
  --path-glob <glob>    portable relative path glob

Options:
  --state-root <dir>       Studio-private activation state root
  --canvas-viewers <dir>   provisioned Qoder Canvas viewers
  --canvas-sdk-root <dir>  Canvas SDK checkout
  --canvas-sdk-media <dir> prebuilt Canvas SDK media
  --walnut-cache <dir>     Studio Walnut cache root
  --json                   emit browser-safe JSON
`;

export interface ArtifactProviderCliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface ParsedProviderArgs extends DiscoverArtifactProviderRuntimeOptions {
  command?: "list" | "activate" | "deactivate";
  providerId?: string;
  contributionId?: string;
  lane?: ArtifactExternalLane;
  matcher: { formats: string[]; extensions: string[]; pathGlobs: string[] };
  json: boolean;
  help: boolean;
  error?: string;
}

export function parseArtifactProviderArgs(argv: string[]): ParsedProviderArgs {
  const parsed: ParsedProviderArgs = { matcher: { formats: [], extensions: [], pathGlobs: [] }, json: false, help: false };
  const command = argv[0];
  if (command === "list" || command === "activate" || command === "deactivate") parsed.command = command;
  else if (command === "--help" || command === "-h" || command === undefined) parsed.help = true;
  else parsed.error = `Unknown artifact-provider command '${command}'.`;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const takeValue = (): string | undefined => argv[++index];
    switch (arg) {
      case "-h": case "--help": parsed.help = true; break;
      case "--json": parsed.json = true; break;
      case "--provider": parsed.providerId = takeValue(); break;
      case "--contribution": parsed.contributionId = takeValue(); break;
      case "--lane": {
        const lane = takeValue();
        if (lane === "external-override" || lane === "external-fallback") parsed.lane = lane;
        else parsed.error = "--lane must be external-override or external-fallback.";
        break;
      }
      case "--format": parsed.matcher.formats.push(takeValue() ?? ""); break;
      case "--extension": parsed.matcher.extensions.push(takeValue() ?? ""); break;
      case "--path-glob": parsed.matcher.pathGlobs.push(takeValue() ?? ""); break;
      case "--state-root": parsed.artifactProviderStateRoot = resolve(takeValue() ?? ""); break;
      case "--canvas-viewers": parsed.canvasViewerRoot = resolve(takeValue() ?? ""); break;
      case "--canvas-sdk-root": parsed.canvasSdkRoot = resolve(takeValue() ?? ""); break;
      case "--canvas-sdk-media": parsed.canvasSdkMedia = resolve(takeValue() ?? ""); break;
      case "--walnut-cache": parsed.walnutCacheRoot = resolve(takeValue() ?? ""); break;
      default: parsed.error = `Unknown artifact-provider option '${arg}'.`;
    }
  }
  if ([...parsed.matcher.formats, ...parsed.matcher.extensions, ...parsed.matcher.pathGlobs].some((value) => value === "")) {
    parsed.error = "Artifact provider options require a value.";
  }
  return parsed;
}

export async function runArtifactProviderCli(argv: string[], io: ArtifactProviderCliIo): Promise<number> {
  const parsed = parseArtifactProviderArgs(argv);
  if (parsed.help) { io.stdout(HELP); return 0; }
  if (parsed.error !== undefined || parsed.command === undefined) {
    io.stderr(`${parsed.error ?? "An artifact-provider command is required."}\n`);
    return 2;
  }
  try {
    if (parsed.command === "deactivate") {
      if (parsed.providerId === undefined || parsed.contributionId === undefined) {
        io.stderr("deactivate requires --provider and --contribution.\n");
        return 2;
      }
      const state = await deactivateArtifactContribution(parsed.providerId, parsed.contributionId, storeOptions(parsed));
      writeResult(io, parsed.json, { deactivated: true, activations: state.activations });
      return 0;
    }
    const runtime = await discoverArtifactProviderRuntime(parsed);
    if (parsed.command === "list") {
      const state = await readArtifactProviderActivationState(storeOptions(parsed));
      writeResult(io, parsed.json, { providers: runtime.statuses, activations: state.activations });
      return 0;
    }
    if (parsed.providerId === undefined || parsed.contributionId === undefined || parsed.lane === undefined) {
      io.stderr("activate requires --provider, --contribution, and --lane.\n");
      return 2;
    }
    const matcher = compactMatcher(parsed.matcher);
    if (Object.keys(matcher).length === 0) {
      io.stderr("activate requires --format, --extension, or --path-glob scope.\n");
      return 2;
    }
    const provider = runtime.providers.find((candidate) => candidate.id === parsed.providerId);
    if (provider === undefined) throw new Error(`Provider '${parsed.providerId}' is unavailable or failed receipt verification.`);
    const state = await activateArtifactContribution(provider, parsed.contributionId, parsed.lane, matcher, storeOptions(parsed));
    writeResult(io, parsed.json, { activated: true, activations: state.activations });
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function compactMatcher(matcher: ParsedProviderArgs["matcher"]): ArtifactMatcher {
  return {
    ...(matcher.formats.length === 0 ? {} : { formats: matcher.formats }),
    ...(matcher.extensions.length === 0 ? {} : { extensions: matcher.extensions }),
    ...(matcher.pathGlobs.length === 0 ? {} : { pathGlobs: matcher.pathGlobs }),
  };
}

function storeOptions(parsed: ParsedProviderArgs): { root?: string } {
  return parsed.artifactProviderStateRoot === undefined ? {} : { root: parsed.artifactProviderStateRoot };
}

function writeResult(io: ArtifactProviderCliIo, json: boolean, value: unknown): void {
  if (json) io.stdout(`${JSON.stringify(value, undefined, 2)}\n`);
  else {
    const record = value as { providers?: readonly { id: string; status: string }[]; activations?: readonly { providerId: string; contributionId: string; lane: string }[] };
    for (const provider of record.providers ?? []) io.stdout(`${provider.id}\t${provider.status}\n`);
    for (const activation of record.activations ?? []) io.stdout(`${activation.providerId}/${activation.contributionId}\t${activation.lane}\n`);
  }
}
