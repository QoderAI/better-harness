import path from "node:path";

export function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

export function normalizeRelativePath(repoRoot, filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  return toPosix(path.relative(repoRoot, absolute));
}

export function unique(items) {
  return [...new Set(items)];
}

export function countLines(text) {
  if (text.length === 0) {
    return 0;
  }
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const raw = normalized.split("\n").length;
  return normalized.endsWith("\n") ? raw - 1 : raw;
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern, { caseInsensitive = false } = {}) {
  let source = "^";
  const normalized = pattern.replaceAll("\\", "/").replace(/^\/+/, "");

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*" && next === "*") {
      if (normalized[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  source += "$";
  return new RegExp(source, caseInsensitive ? "i" : "");
}

export function matchesAnyPattern(value, patterns, options = {}) {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => globToRegExp(pattern, options).test(value));
}
