import type { CommandResult } from "./process.js";
import { runCommand } from "./process.js";

export interface SandboxReceipt {
  policy: "trusted-fixture" | "isolated";
  envPolicy: "allowlist" | "inherited";
  envKeys: string[];
  networkPolicy: "denied" | "unverified";
  fsScope: "trial-root" | "host";
  permissionFlags: string[];
}

export interface TrialSandbox {
  run(command: string, args: string[], options: { cwd: string; timeoutMs: number }): Promise<CommandResult>;
  describe(): SandboxReceipt;
}

const PORTABLE_ENV_KEYS = [
  "PATH", "HOME", "TMP", "TEMP", "TMPDIR", "SystemRoot", "ComSpec", "PATHEXT",
  "LOCALAPPDATA", "APPDATA", "USERPROFILE", "npm_config_cache", "npm_config_offline",
  "npm_config_prefer_offline", "npm_config_ignore_scripts",
] as const;

export function trustedFixtureEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of PORTABLE_ENV_KEYS) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

export function createTrustedFixtureSandbox(): TrialSandbox {
  const env = trustedFixtureEnvironment();
  const permissionFlags = new Set<string>();
  return {
    async run(command, args, options) {
      for (const arg of args) {
        if (arg === "--permission" || arg.startsWith("--allow-fs-read=")) {
          permissionFlags.add(arg);
        }
      }
      return runCommand(command, args, { ...options, env });
    },
    describe() {
      return Object.freeze({
        policy: "trusted-fixture",
        envPolicy: "allowlist",
        envKeys: Object.freeze(Object.keys(env).sort()) as unknown as string[],
        networkPolicy: "unverified",
        fsScope: "trial-root",
        permissionFlags: Object.freeze([...permissionFlags].sort()) as unknown as string[],
      });
    },
  };
}

export function sandboxPolicyLabel(receipt: SandboxReceipt): string {
  return receipt.networkPolicy === "unverified"
    ? "trusted-fixture only — network not denied"
    : receipt.policy;
}
