import { resolve } from "node:path";
import type { HarnessStudioCliIo } from "./cli.js";
import {
  defaultWalnutCacheRoot,
  installWalnutProvider,
  probeWalnutApplication,
  removeWalnutProvider,
  verifyActiveWalnutProvider,
} from "./walnut-bootstrap.js";

const HELP = `harness-studio walnut — Studio-private local Walnut bootstrap

Usage:
  harness-studio walnut probe [options]
  harness-studio walnut install --accept-local-experimental [options]
  harness-studio walnut verify [options]
  harness-studio walnut remove --yes [options]

Options:
  --app <path>       ChatGPT.app to inspect (default: /Applications/ChatGPT.app)
  --cache-root <dir> Override the Studio-private cache root
  --accept-local-experimental
                     Confirm local extraction from the installed application
  --yes              Confirm removal of the Studio-private Walnut cache
  --json             Emit the complete machine-readable result
  -h, --help         Print help
`;

interface ParsedWalnutArgs {
  command?: "probe" | "install" | "verify" | "remove";
  appPath?: string;
  cacheRoot?: string;
  acceptLocalExperimental: boolean;
  yes: boolean;
  json: boolean;
  help: boolean;
  error?: string;
}

export function parseWalnutArgs(argv: string[]): ParsedWalnutArgs {
  const parsed: ParsedWalnutArgs = {
    acceptLocalExperimental: false,
    yes: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const takeValue = (): string | undefined => {
      index += 1;
      return argv[index];
    };
    if (index === 0 && ["probe", "install", "verify", "remove"].includes(arg ?? "")) {
      parsed.command = arg as ParsedWalnutArgs["command"];
      continue;
    }
    switch (arg) {
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "--app":
        parsed.appPath = takeValue();
        if (parsed.appPath === undefined) parsed.error = "--app requires a path.";
        break;
      case "--cache-root":
        parsed.cacheRoot = takeValue();
        if (parsed.cacheRoot === undefined) parsed.error = "--cache-root requires a directory.";
        break;
      case "--accept-local-experimental":
        parsed.acceptLocalExperimental = true;
        break;
      case "--yes":
        parsed.yes = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        parsed.error = index === 0 ? `Unknown Walnut command '${arg}'.` : `Unknown Walnut option '${arg}'.`;
    }
  }
  if (parsed.command === undefined && !parsed.help && parsed.error === undefined) parsed.error = "A Walnut command is required.";
  return parsed;
}

export async function runWalnutBootstrapCli(argv: string[], io: HarnessStudioCliIo): Promise<number> {
  const parsed = parseWalnutArgs(argv);
  if (parsed.help) {
    io.stdout(HELP);
    return 0;
  }
  if (parsed.error !== undefined) {
    io.stderr(`${parsed.error}\n`);
    return 2;
  }
  const cacheRoot = resolve(parsed.cacheRoot ?? defaultWalnutCacheRoot());
  if (parsed.command === "probe") {
    const probe = await probeWalnutApplication({
      ...(parsed.appPath === undefined ? {} : { appPath: parsed.appPath }),
      cacheRoot,
    });
    writeResult(io, parsed.json, probe, probe.status === "available"
      ? `Walnut is available for Studio bootstrap (${probe.assets.length} reviewed assets).`
      : `Walnut is unavailable: ${probe.reason ?? "unknown reason"}`);
    return probe.status === "available" ? 0 : 3;
  }
  if (parsed.command === "install") {
    const probe = await probeWalnutApplication({
      ...(parsed.appPath === undefined ? {} : { appPath: parsed.appPath }),
      cacheRoot,
    });
    const receipt = await installWalnutProvider(probe, {
      acceptLocalExperimental: parsed.acceptLocalExperimental,
    });
    writeResult(io, parsed.json, receipt, `Installed the Studio-private Walnut runtime (${receipt.assets.length} assets).`);
    return 0;
  }
  if (parsed.command === "verify") {
    const verification = await verifyActiveWalnutProvider(cacheRoot);
    writeResult(io, parsed.json, verification, verification.ok
      ? "The Studio-private Walnut runtime is verified."
      : `Walnut verification failed: ${verification.reason ?? "unknown reason"}`);
    return verification.ok ? 0 : 3;
  }
  if (!parsed.yes) {
    io.stderr("Walnut removal requires --yes.\n");
    return 2;
  }
  const removal = await removeWalnutProvider(cacheRoot);
  writeResult(io, parsed.json, removal, removal.removed
    ? "Removed the Studio-private Walnut cache."
    : "No Studio-private Walnut cache was present.");
  return 0;
}

function writeResult(io: HarnessStudioCliIo, json: boolean, value: unknown, summary: string): void {
  io.stdout(json ? `${JSON.stringify(value, null, 2)}\n` : `${summary}\n`);
}
