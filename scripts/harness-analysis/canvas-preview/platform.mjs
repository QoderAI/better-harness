import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function parsePreviewPort(value, defaultPort) {
  if (value === undefined || value === null || value === "") {
    return defaultPort;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

export function browserOpenCommand(url, platform = process.platform) {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }

  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }

  return { command: "xdg-open", args: [url] };
}

export function openBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  const { command, args } = browserOpenCommand(url, platform);

  try {
    const child = spawnImpl(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on?.("error", () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

export function formatServerUrl(address, host) {
  if (!address || typeof address === "string") {
    throw new Error("Server address is unavailable");
  }

  const displayHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  const needsBrackets = displayHost.includes(":") && !displayHost.startsWith("[");
  const urlHost = needsBrackets ? `[${displayHost}]` : displayHost;
  return `http://${urlHost}:${address.port}`;
}

export function isDirectModule(importMetaUrl, argv = process.argv) {
  if (!argv[1]) {
    return false;
  }
  return fileURLToPath(importMetaUrl) === fileURLToPath(pathToFileURL(path.resolve(argv[1])));
}
