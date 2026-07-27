import { languageFor } from "../../blast-radius/config.mjs";
import { isTestFile as genericTestFile } from "../../blast-radius/parser.mjs";

import * as go from "./go.mjs";
import * as java from "./java.mjs";
import * as python from "./python.mjs";

export const TEST_MAPPING_RESOLVERS = [java, go, python];

export function resolverForLanguage(language) {
  return TEST_MAPPING_RESOLVERS.find((resolver) => resolver.language === language) ?? null;
}

export function isKnownTestFile(filePath) {
  const language = languageFor(filePath);
  if (!language) {
    return false;
  }
  const resolver = resolverForLanguage(language);
  return Boolean(resolver?.isTestFile(filePath)) || genericTestFile(filePath);
}

export function resolveSourceFile(sourceFile) {
  const language = languageFor(sourceFile) ?? "unknown";
  const resolver = resolverForLanguage(language);
  if (!resolver) {
    return {
      sourceFile,
      language,
      candidateTestFiles: [],
      canAssertMissing: false,
      confidence: "unknown",
      resolverKind: "unsupported",
    };
  }

  return {
    sourceFile,
    language,
    ...resolver.resolve(sourceFile),
  };
}
