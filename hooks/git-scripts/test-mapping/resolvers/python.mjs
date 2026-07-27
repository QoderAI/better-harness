import path from "node:path";

export const language = "python";

export function isTestFile(filePath) {
  const lowered = filePath.toLowerCase();
  const baseName = path.posix.basename(lowered);
  return (
    lowered.includes("/tests/") ||
    lowered.includes("/test/") ||
    baseName.startsWith("test_") ||
    baseName.endsWith("_test.py") ||
    baseName.endsWith(".test.py")
  );
}

export function resolve(sourceFile) {
  const parsed = path.posix.parse(sourceFile);
  if (parsed.name === "__init__") {
    return {
      candidateTestFiles: [],
      canAssertMissing: false,
      confidence: "low",
      resolverKind: "python_path_heuristic",
    };
  }

  const testName = testModuleName(parsed.name);
  const mirrored = stripSourcePrefix(parsed.dir);
  const candidates = [
    path.posix.join(parsed.dir, `test_${testName}.py`),
    path.posix.join(parsed.dir, `${testName}_test.py`),
    path.posix.join("tests", mirrored, `test_${testName}.py`),
    path.posix.join("tests", `test_${testName}.py`),
  ];

  return {
    candidateTestFiles: candidates,
    canAssertMissing: true,
    confidence: "medium",
    resolverKind: "python_path_heuristic",
  };
}

function testModuleName(stem) {
  return stem.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || stem;
}

function stripSourcePrefix(directory) {
  if (directory === "src") {
    return "";
  }
  if (directory.startsWith("src/")) {
    return directory.slice("src/".length);
  }
  return directory;
}
