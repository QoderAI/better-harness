import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUPPORTED_PACKAGES = new Map([
  ["better-harness", "package.json"],
  ["harness", "packages/harness/package.json"],
  ["harness-studio", "packages/harness-studio/package.json"],
]);

export function resolveNpmDistTag(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  const prerelease = match[4];
  if (!prerelease) {
    return "latest";
  }

  const channelMatch = /^(alpha|beta|rc)(?:\d+)?$/.exec(prerelease.split(".")[0]);
  if (!channelMatch) {
    throw new Error(`Unsupported prerelease channel: ${prerelease}`);
  }
  return channelMatch[1];
}

export async function resolvePackageRelease(packageName, repositoryRoot = process.cwd()) {
  const manifestPath = SUPPORTED_PACKAGES.get(packageName);
  if (!manifestPath) {
    throw new Error(`Unsupported release package: ${packageName}`);
  }

  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, manifestPath), "utf8"));
  return {
    packageName,
    version: manifest.version,
    tag: resolveNpmDistTag(manifest.version),
  };
}

async function main() {
  const [packageName] = process.argv.slice(2);
  if (!packageName) {
    throw new Error("Usage: npm-dist-tag.mjs <package>");
  }

  const release = await resolvePackageRelease(packageName);
  const output = `version=${release.version}\ntag=${release.tag}\n`;
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, output, "utf8");
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
