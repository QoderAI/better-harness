import path from "node:path";

export const language = "java";

export function isTestFile(filePath) {
  const lowered = filePath.toLowerCase();
  return (
    lowered.includes("/src/test/java/") ||
    lowered.endsWith("test.java") ||
    lowered.endsWith("tests.java") ||
    lowered.endsWith("it.java")
  );
}

export function resolve(sourceFile) {
  const marker = "src/main/java/";
  const markerIndex = sourceFile.indexOf(marker);
  if (markerIndex === -1) {
    return {
      candidateTestFiles: [],
      canAssertMissing: false,
      confidence: "low",
      resolverKind: "java_path_heuristic",
    };
  }

  const prefix = sourceFile.slice(0, markerIndex);
  const suffix = sourceFile.slice(markerIndex + marker.length);
  const parsed = path.posix.parse(suffix);
  const testDirectory = path.posix.join(prefix, "src/test/java", parsed.dir);

  return {
    candidateTestFiles: [
      path.posix.join(testDirectory, `${parsed.name}Test.java`),
      path.posix.join(testDirectory, `${parsed.name}Tests.java`),
      path.posix.join(testDirectory, `${parsed.name}IT.java`),
    ],
    canAssertMissing: true,
    confidence: "high",
    resolverKind: "java_path_heuristic",
  };
}
