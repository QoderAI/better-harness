#!/usr/bin/env node
import { createServer } from "node:http";
import { existsSync, readFileSync, watch } from "node:fs";
import path from "node:path";

import {
  formatServerUrl,
  isDirectModule,
  openBrowser,
  parsePreviewPort,
} from "../scripts/harness-analysis/canvas-preview/index.mjs";

function send(res, status, type, body) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": type,
  });
  res.end(body);
}

function injectPreviewScript(html) {
  const script = `<script>
window.__betterHarnessPreview = window.__betterHarnessPreview || { version: null };
(function pollBetterHarnessPreview() {
  async function check() {
    try {
      const response = await fetch("/__preview_version", { cache: "no-store" });
      const version = await response.text();
      if (window.__betterHarnessPreview.version === null) {
        window.__betterHarnessPreview.version = version;
      } else if (window.__betterHarnessPreview.version !== version) {
        window.location.reload();
        return;
      }
    } catch {}
    setTimeout(check, 1000);
  }
  check();
})();
</script>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${script}\n</body>`);
  }

  return `${html}\n${script}`;
}

function parseArgs(argv) {
  const args = {
    host: "127.0.0.1",
    port: 58576,
    watch: false,
    open: false,
    positional: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      args.host = argv[++index];
    } else if (arg === "--port") {
      args.port = parsePreviewPort(argv[++index], args.port);
    } else if (arg === "--watch") {
      args.watch = true;
    } else if (arg === "--open") {
      args.open = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      args.positional.push(arg);
    }
  }

  if (args.positional.length === 0) {
    throw new Error("Usage: node dev/html-preview.mjs <report.html> [--host 127.0.0.1] [--port 58576] [--watch] [--open]");
  }

  return {
    reportPath: args.positional[0],
    host: args.host,
    port: args.port,
    watch: args.watch,
    open: args.open,
  };
}

export async function createHtmlPreviewServer({
  reportPath,
  host = "127.0.0.1",
  port = 58576,
  watch: watchMode = false,
  open = false,
} = {}) {
  const resolvedReportPath = path.resolve(reportPath ?? "");
  if (!reportPath || !existsSync(resolvedReportPath)) {
    throw new Error(`HTML report not found: ${resolvedReportPath}`);
  }

  let version = Date.now();
  let watcher = null;

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      if (url.pathname === "/" || url.pathname === "/report.html") {
        return send(
          res,
          200,
          "text/html; charset=utf-8",
          injectPreviewScript(readFileSync(resolvedReportPath, "utf8")),
        );
      }

      if (url.pathname === "/health") {
        return send(res, 200, "text/plain; charset=utf-8", "ok");
      }

      if (url.pathname === "/__preview_version") {
        return send(res, 200, "text/plain; charset=utf-8", String(version));
      }

      return send(res, 404, "text/plain; charset=utf-8", `Not found: ${url.pathname}`);
    } catch (error) {
      return send(res, 500, "text/plain; charset=utf-8", String(error?.stack ?? error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  if (watchMode) {
    watcher = watch(resolvedReportPath, () => {
      version = Date.now();
    });
  }

  const url = formatServerUrl(server.address(), host);
  if (open) {
    openBrowser(url);
  }

  return {
    server,
    url,
    reportPath: resolvedReportPath,
    close: async () => {
      watcher?.close();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const preview = await createHtmlPreviewServer(options);
  console.log(`[html-preview] Serving ${preview.reportPath}`);
  console.log(`[html-preview] ${preview.url}`);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      await preview.close();
      process.exit(0);
    });
  }
}

if (isDirectModule(import.meta.url)) {
  main().catch((error) => {
    console.error("[html-preview] error:", error);
    process.exit(1);
  });
}
