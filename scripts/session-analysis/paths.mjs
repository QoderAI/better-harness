import os from "node:os";
import path from "node:path";

export function expandHome(filePath) {
  if (!filePath) {
    return filePath;
  }
  if (filePath === "~") {
    return os.homedir();
  }
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

export function normalizeWorkspace(workspace) {
  return path.resolve(expandHome(workspace ?? process.cwd()));
}
