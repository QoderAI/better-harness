import path from "node:path";

export const language = "go";

export function isTestFile(filePath) {
  return filePath.toLowerCase().endsWith("_test.go");
}

export function resolve(sourceFile) {
  const parsed = path.posix.parse(sourceFile);
  if (parsed.name.endsWith("_test")) {
    return {
      candidateTestFiles: [],
      canAssertMissing: false,
      confidence: "unknown",
      resolverKind: "go_path_heuristic",
    };
  }

  return {
    candidateTestFiles: [path.posix.join(parsed.dir, `${parsed.name}_test.go`)],
    canAssertMissing: true,
    confidence: "high",
    resolverKind: "go_path_heuristic",
  };
}
