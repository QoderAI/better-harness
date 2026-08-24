import type { LanguageRegistration } from "shiki";

/**
 * TextMate grammar for the Harness DSL, registered with Shiki as the
 * `harness` language.
 */
export const harnessTextMateGrammar: LanguageRegistration = {
  name: "harness",
  scopeName: "source.harness",
  displayName: "Harness",
  patterns: [
    { include: "#comments" },
    { include: "#declarations" },
    { include: "#sections" },
    { include: "#constants" },
    { include: "#versions" },
    { include: "#durations" },
    { include: "#numbers" },
    { include: "#strings" },
  ],
  repository: {
    comments: {
      patterns: [
        { name: "comment.line.double-slash.harness", match: "//[^\\n]*" },
        { name: "comment.block.harness", begin: "/\\*", end: "\\*/" },
      ],
    },
    declarations: {
      patterns: [
        {
          match: "\\b(language)\\b\\s+([0-9]+\\.[0-9]+)",
          captures: {
            "1": { name: "keyword.declaration.harness" },
            "2": { name: "constant.other.version.harness" },
          },
        },
        {
          match:
            "\\b(harness|workflow|agent|skill|tool|mcp|runtime|deployment)\\b\\s+([_a-zA-Z][\\w-]*(?:\\.[_a-zA-Z][\\w-]*)*)",
          captures: {
            "1": { name: "keyword.declaration.harness" },
            "2": { name: "entity.name.type.harness" },
          },
        },
        {
          name: "keyword.control.harness",
          match: "\\b(use|require|connect|program|session|state-machine|on|stop|when)\\b|->",
        },
      ],
    },
    sections: {
      patterns: [
        {
          name: "keyword.other.section.harness",
          match:
            "\\b(source|description|contract|adapter|transport|url|command|env|entry|outcomes)\\b",
        },
      ],
    },
    constants: {
      patterns: [
        {
          name: "constant.language.transport.harness",
          match: "\\b(stdio|http|sse)\\b",
        },
      ],
    },
    versions: {
      patterns: [
        { name: "constant.other.version.harness", match: "\\b[0-9]+\\.[0-9]+\\b" },
      ],
    },
    durations: {
      patterns: [{ name: "constant.numeric.duration.harness", match: "\\b[0-9]+(ms|s|m|h)\\b" }],
    },
    numbers: {
      patterns: [{ name: "constant.numeric.integer.harness", match: "\\b[0-9]+\\b" }],
    },
    strings: {
      patterns: [{ name: "string.quoted.double.harness", match: '"[^"]*"' }],
    },
  },
};
