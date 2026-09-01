import { isIP } from "node:net";

export class HarnessStudioRemoteBindError extends Error {
  constructor(readonly host: string) {
    super(
      `Refusing to bind Harness Studio to '${host}'. Its run endpoints can execute a coding agent ` +
        "with host tools and have no authentication. Bind to loopback and put an authenticated " +
        "gateway in front, or pass --unsafe-allow-remote to accept that risk explicitly.",
    );
    this.name = "HarnessStudioRemoteBindError";
  }
}

export function assertStudioBindAddressAllowed(host: string, allowRemote: boolean): void {
  if (allowRemote || isLoopbackBindAddress(host)) return;
  throw new HarnessStudioRemoteBindError(host);
}

function isLoopbackBindAddress(host: string): boolean {
  const hostname = host.trim().toLowerCase().replace(/^\[|\]$/gu, "");
  if (hostname === "localhost" || hostname === "::1") return true;
  return isIP(hostname) === 4 && hostname.startsWith("127.");
}
