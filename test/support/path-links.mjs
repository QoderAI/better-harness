import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const LINK_ERROR_CODES = new Set(["EACCES", "EINVAL", "ENOSYS", "EPERM"]);

export async function createDirectoryLink(target, linkPath) {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

async function detectFileLinkSupport() {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-file-link-"));
  try {
    const target = path.join(root, "target.txt");
    await writeFile(target, "target\n", "utf8");
    await symlink(target, path.join(root, "link.txt"), "file");
    return true;
  } catch (error) {
    if (LINK_ERROR_CODES.has(error?.code)) return false;
    throw error;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

let fileLinkSupport;

export async function fileLinksSupported() {
  fileLinkSupport ??= detectFileLinkSupport();
  return fileLinkSupport;
}

export async function skipWithoutFileLink(t) {
  if (await fileLinksSupported()) return false;
  t.skip("file symlink creation is not permitted on this host");
  return true;
}
