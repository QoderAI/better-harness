#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDefaultCanvasPreviewFixture } from "./fixture.mjs";
import { isDirectModule, parsePreviewPort } from "./platform.mjs";
import { createCanvasPreviewServer } from "./server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../..");

export const CANVAS_PREVIEW_HELP = `Usage: better-harness harness preview-canvas [<report.canvas.tsx>] [options]

Serve a Qoder Canvas report for local inspection. Without a report path, the
command serves the bundled preview fixture.

Options:
  --host <host>         Listen host (default: 127.0.0.1)
  --port <port>         Listen port, or 0 for an available port (default: 58575)
  --watch               Rebuild after source changes
  --open                Open the local preview URL in the default browser
  --sdk-root <path>     Canvas SDK checkout containing out/ and media/
  --sdk-media <path>    Canvas runtime media directory
  -h, --help            Print help

The default loopback binding is local-only. This command does not provide
authentication or a hosted sharing service.
`;

function parseArgs(argv) {
  const args = {
    canvasPath: null,
    host: "127.0.0.1",
    port: 58575,
    watch: false,
    open: false,
    help: false,
    sdkRoot: undefined,
    sdkMedia: undefined,
    positional: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--host") {
      args.host = argv[++index];
    } else if (arg === "--port") {
      args.port = parsePreviewPort(argv[++index], args.port);
    } else if (arg === "--watch") {
      args.watch = true;
    } else if (arg === "--open") {
      args.open = true;
    } else if (arg === "--sdk-root") {
      args.sdkRoot = argv[++index];
    } else if (arg === "--sdk-media") {
      args.sdkMedia = argv[++index];
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      args.positional.push(arg);
    }
  }

  if (args.positional.length > 0) {
    args.canvasPath = args.positional[0];
  }

  return args;
}

export async function main(
  argv = process.argv.slice(2),
  {
    createDefaultFixture = createDefaultCanvasPreviewFixture,
    repoRoot = defaultRepoRoot,
  } = {},
) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(CANVAS_PREVIEW_HELP);
    return;
  }

  const fixture = options.canvasPath ? null : await createDefaultFixture({ repoRoot });
  const requestedCanvasPath = options.canvasPath ? path.resolve(process.cwd(), options.canvasPath) : null;
  const preview = await createCanvasPreviewServer({
    ...options,
    canvasPath: fixture?.canvasPath ?? requestedCanvasPath,
    repoRoot,
  });
  console.log(`[canvas-preview] Serving ${path.relative(repoRoot, preview.canvasPath)}`);
  console.log(`[canvas-preview] Canvas SDK ${preview.runtime.mediaDir ?? preview.runtime.sdkRoot}`);
  console.log(`[canvas-preview] ${preview.url}`);

  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await preview.close();
      await fixture?.close();
      process.exit(0);
    });
  }
}

if (isDirectModule(import.meta.url)) {
  main().catch((error) => {
    console.error("[canvas-preview] error:", error);
    process.exit(1);
  });
}
