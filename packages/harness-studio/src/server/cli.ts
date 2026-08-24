#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startHarnessStudioServer } from "./server.js";
import { readSourceCatalogFile } from "./source-catalog.js";
import { runWalnutBootstrapCli } from "./walnut-cli.js";
import { runArtifactProviderCli } from "./artifact-provider-cli.js";
import { createBundledAgentCustomizationCollector } from "./customization-collector.js";

const HELP = `harness-studio — local studio for harness runs and compare evidence

Usage:
  harness-studio [options]
  harness-studio walnut <probe|install|verify|remove> [options]
  harness-studio artifact-provider <list|activate|deactivate> [options]
  harness-studio --help

Options:
  --inspector <file>  self-contained Harness Inspector HTML (enables Inspector)
                      (default: .qoder/better-harness-runs/harness-inspector/inspector.html when present)
  --evidence <dir>    harness-compare evidence directory (enables Compare results)
  --harness <file>    .harness file to serve for live runs (enables Debugger)
  --experiment <file> harness-experiment.v1 manifest (enables Compare bench)
  --experiment-out <dir>
                      Evidence root for experiment runs
  --history-catalog <file>
                      checkpoint-history.v1 source for the Builder picker
  --experiment-locks <dir>
                      Durable root for content-addressed experiment locks
  --runs <dir>        Durable directory for saved Debugger runs
                      (default: .harness-studio-runs under --cwd)
  --artifacts <dir>   Optional artifact directory to preload read-only
  --canvas-viewers <dir>
                      Provisioned format viewers (default: ~/.qoder/canvas/canvases)
  --canvas-sdk-root <dir>
                      Canvas SDK checkout used by provisioned viewers
  --canvas-sdk-media <dir>
                      Prebuilt Canvas SDK media directory
  --provider-state <dir>
                      Studio-private external provider activation state
  --walnut-cache <dir> Studio-owned Walnut cache root
  --source-catalog <file>
                      JSON catalog of bounded switchable Studio inputs
  --harness-id <id>   Harness to resolve (default: the file's only harness)
  --runtime <id>      Target runtime (default: the file's only target)
  --acp-agent <cmd>   Server-owned ACP Agent executable (requires --harness)
  --acp-arg <arg>     Repeatable argv item for --acp-agent
  --port <n>          Listen port (default: 3311)
  --host <addr>       Bind address (default: 127.0.0.1)
  --cwd <dir>         Working directory for executor runs (default: process cwd)
  --source-root <dir> Root a 'source' skill's path locks and delivers against
                      (default: the directory containing --harness)
  --unsafe-allow-remote
                      Permit a non-loopback --host. The studio's /agui endpoint is
                      unauthenticated and runs a coding agent in --cwd.
  -h, --help          Print help without reading any file or opening a port
`;

export interface HarnessStudioCliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Resolve the skill root owned by an optional `.harness` document. */
export function resolveHarnessStudioSourceRoot(
  harness: string | undefined,
  explicitRoot?: string,
): string | undefined {
  return explicitRoot ?? (harness !== undefined ? dirname(resolve(harness)) : undefined);
}

/** The Inspector CLI's conventional local output path, discovered only under this fixed location. */
export async function discoverDefaultInspectorReport(cwd: string): Promise<string | undefined> {
  const candidate = join(cwd, ".qoder", "better-harness-runs", "harness-inspector", "inspector.html");
  try {
    await access(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

interface ParsedArgs {
  inspector?: string;
  evidence?: string;
  harness?: string;
  experiment?: string;
  experimentOut?: string;
  historyCatalog?: string;
  experimentLocks?: string;
  harnessId?: string;
  runtime?: string;
  acpAgent?: string;
  acpArgs: string[];
  runs?: string;
  artifacts?: string;
  canvasViewers?: string;
  canvasSdkRoot?: string;
  canvasSdkMedia?: string;
  providerState?: string;
  walnutCache?: string;
  sourceCatalog?: string;
  port: number;
  host: string;
  allowRemote: boolean;
  cwd?: string;
  sourceRoot?: string;
  help: boolean;
  error?: string;
}

export function parseHarnessStudioArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { port: 3311, host: "127.0.0.1", allowRemote: false, help: false, acpArgs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const takeValue = (): string | undefined => {
      index += 1;
      return argv[index];
    };
    switch (arg) {
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "--evidence":
        parsed.evidence = takeValue();
        break;
      case "--inspector":
        parsed.inspector = takeValue();
        break;
      case "--harness":
        parsed.harness = takeValue();
        break;
      case "--experiment":
        parsed.experiment = takeValue();
        break;
      case "--experiment-out":
        parsed.experimentOut = takeValue();
        break;
      case "--history-catalog":
        parsed.historyCatalog = takeValue();
        break;
      case "--experiment-locks":
        parsed.experimentLocks = takeValue();
        break;
      case "--harness-id":
        parsed.harnessId = takeValue();
        break;
      case "--runtime":
        parsed.runtime = takeValue();
        break;
      case "--acp-agent":
        parsed.acpAgent = takeValue();
        break;
      case "--acp-arg": {
        const value = takeValue();
        if (value !== undefined) parsed.acpArgs.push(value);
        break;
      }
      case "--runs":
        parsed.runs = takeValue();
        break;
      case "--artifacts":
        parsed.artifacts = takeValue();
        break;
      case "--canvas-viewers":
        parsed.canvasViewers = takeValue();
        break;
      case "--canvas-sdk-root":
        parsed.canvasSdkRoot = takeValue();
        break;
      case "--canvas-sdk-media":
        parsed.canvasSdkMedia = takeValue();
        break;
      case "--provider-state":
        parsed.providerState = takeValue();
        break;
      case "--walnut-cache":
        parsed.walnutCache = takeValue();
        break;
      case "--source-catalog":
        parsed.sourceCatalog = takeValue();
        break;
      case "--host":
        parsed.host = takeValue() ?? parsed.host;
        break;
      case "--unsafe-allow-remote":
        parsed.allowRemote = true;
        break;
      case "--cwd":
        parsed.cwd = takeValue();
        break;
      case "--source-root":
        parsed.sourceRoot = takeValue();
        break;
      case "--port": {
        const value = Number(takeValue());
        if (!Number.isInteger(value) || value < 0 || value > 65535) {
          parsed.error = "--port must be an integer between 0 and 65535.";
        } else {
          parsed.port = value;
        }
        break;
      }
      default:
        parsed.error = `Unknown option '${arg}'.`;
    }
  }
  return parsed;
}

/** The built React app ships next to the compiled server inside dist/. */
export function defaultAppDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "app");
}

/** In-process CLI entry; returns the exit code (0 keeps the server running). */
export async function runHarnessStudioCli(argv: string[], io: HarnessStudioCliIo): Promise<number> {
  if (argv[0] === "walnut") return await runWalnutBootstrapCli(argv.slice(1), io);
  if (argv[0] === "artifact-provider") return await runArtifactProviderCli(argv.slice(1), io);
  const parsed = parseHarnessStudioArgs(argv);
  if (parsed.help) {
    io.stdout(HELP);
    return 0;
  }
  if (parsed.error !== undefined) {
    io.stderr(`${parsed.error}\n`);
    return 2;
  }
  // The Inspector CLI writes to one conventional local path; discovering it
  // keeps `harness-studio` usable in a repository without restating flags.
  const discoveredInspector = parsed.inspector === undefined
    ? await discoverDefaultInspectorReport(parsed.cwd ?? process.cwd())
    : undefined;
  const inspectorPath = parsed.inspector ?? discoveredInspector;
  const sourceCatalog = parsed.sourceCatalog === undefined ? [] : await readSourceCatalogFile(parsed.sourceCatalog);
  const harnessSource = parsed.harness !== undefined ? await readFile(parsed.harness, "utf8") : undefined;
  if (parsed.acpAgent !== undefined && harnessSource === undefined) {
    io.stderr("--acp-agent requires --harness so the ACP runtime contract is explicit.\n");
    return 2;
  }
  // Skills are conventionally declared relative to their `.harness` file (see
  // examples/*.harness), so loading one without a flag still delivers them.
  const sourceRoot = resolveHarnessStudioSourceRoot(parsed.harness, parsed.sourceRoot);
  const started = await startHarnessStudioServer({
    appDir: defaultAppDir(),
    port: parsed.port,
    host: parsed.host,
    allowRemote: parsed.allowRemote,
    customizationCollector: createBundledAgentCustomizationCollector(),
    ...(inspectorPath !== undefined ? { inspectorReportPath: resolve(inspectorPath) } : {}),
    ...(parsed.evidence !== undefined ? { evidenceDir: resolve(parsed.evidence) } : {}),
    ...(harnessSource !== undefined ? { harnessSource } : {}),
    ...(parsed.harnessId !== undefined ? { harnessId: parsed.harnessId } : {}),
    ...(parsed.runtime !== undefined ? { runtimeId: parsed.runtime } : {}),
    ...(parsed.acpAgent !== undefined && harnessSource !== undefined ? {
      acpAgent: {
        command: parsed.acpAgent,
        args: parsed.acpArgs,
        harnessSource,
        ...(parsed.harnessId !== undefined ? { harnessId: parsed.harnessId } : {}),
        runtimeId: "acp",
      },
    } : {}),
    ...(parsed.runs !== undefined ? { runDirectory: resolve(parsed.runs) } : {}),
    ...(parsed.artifacts !== undefined ? { artifactDirectory: resolve(parsed.artifacts) } : {}),
    ...(parsed.canvasViewers !== undefined ? { canvasViewerRoot: resolve(parsed.canvasViewers) } : {}),
    ...(parsed.canvasSdkRoot !== undefined ? { canvasSdkRoot: resolve(parsed.canvasSdkRoot) } : {}),
    ...(parsed.canvasSdkMedia !== undefined ? { canvasSdkMedia: resolve(parsed.canvasSdkMedia) } : {}),
    ...(parsed.providerState !== undefined ? { artifactProviderStateRoot: resolve(parsed.providerState) } : {}),
    ...(parsed.walnutCache !== undefined ? { walnutCacheRoot: resolve(parsed.walnutCache) } : {}),
    ...(sourceCatalog.length > 0 ? { sourceCatalog } : {}),
    ...(parsed.cwd !== undefined ? { cwd: parsed.cwd } : {}),
    ...(sourceRoot !== undefined ? { sourceRoot } : {}),
    ...(parsed.experiment !== undefined ? { experimentManifestPath: resolve(parsed.experiment) } : {}),
    ...(parsed.experimentOut !== undefined ? { experimentOutputDirectory: resolve(parsed.experimentOut) } : {}),
    ...(parsed.historyCatalog !== undefined ? { checkpointHistoryCatalogPath: resolve(parsed.historyCatalog) } : {}),
    ...(parsed.experimentLocks !== undefined ? { experimentLockDirectory: resolve(parsed.experimentLocks) } : {}),
  });
  if (parsed.allowRemote) {
    io.stderr(
      `Warning: ${started.url} is reachable beyond loopback and has no authentication. ` +
        `Anyone who can route to it can run a coding agent in ${parsed.cwd ?? process.cwd()}.\n`,
    );
  }
  if (discoveredInspector !== undefined) {
    io.stdout(`Inspector report: ${discoveredInspector} (auto-discovered)\n`);
  }
  io.stdout(`Harness Studio: ${started.url}\n`);
  return 0;
}

const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runHarnessStudioCli(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  }).then(
    (code) => {
      if (code !== 0) {
        process.exit(code);
      }
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
