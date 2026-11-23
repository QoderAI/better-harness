/**
 * Tolerant reader for the JSON5 dialect OpenClaw uses for openclaw.json.
 *
 * Only the constructs a hand-edited OpenClaw config relies on are normalized:
 * line and block comments, trailing commas, unquoted identifier keys, and
 * single-quoted strings. Everything else stays a parse error, so a config this
 * reader cannot understand is reported as unparsed instead of being silently
 * treated as empty.
 */
import { readFile } from "node:fs/promises";

const IDENTIFIER_START = /[A-Za-z_$]/u;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/u;

function readDoubleQuoted(text, start) {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === '"') return index + 1;
    index += 1;
  }
  throw new SyntaxError("unterminated double-quoted string");
}

function readSingleQuoted(text, start) {
  let literal = '"';
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") {
      const escaped = text[index + 1];
      if (escaped === undefined) break;
      if (escaped === "'") literal += "'";
      else if (escaped === '"') literal += '\\"';
      else literal += `\\${escaped}`;
      index += 2;
      continue;
    }
    if (character === "'") return { literal: `${literal}"`, nextIndex: index + 1 };
    if (character === '"') {
      literal += '\\"';
      index += 1;
      continue;
    }
    if (character === "\n") break;
    literal += character;
    index += 1;
  }
  throw new SyntaxError("unterminated single-quoted string");
}

export function normalizeJson5Text(text) {
  if (typeof text !== "string") {
    throw new TypeError("normalizeJson5Text expects a string");
  }
  let output = "";
  let previous = "";
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end === -1) throw new SyntaxError("unterminated block comment");
      index = end + 2;
      continue;
    }
    if (character === '"') {
      const end = readDoubleQuoted(text, index);
      output += text.slice(index, end);
      previous = '"';
      index = end;
      continue;
    }
    if (character === "'") {
      const { literal, nextIndex } = readSingleQuoted(text, index);
      output += literal;
      previous = '"';
      index = nextIndex;
      continue;
    }
    if ((previous === "{" || previous === ",") && IDENTIFIER_START.test(character)) {
      let end = index + 1;
      while (end < text.length && IDENTIFIER_PART.test(text[end])) end += 1;
      const identifier = text.slice(index, end);
      let cursor = end;
      while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
      if (text[cursor] === ":") {
        output += `"${identifier}"`;
        previous = '"';
      } else {
        output += identifier;
        previous = identifier.at(-1) ?? previous;
      }
      index = end;
      continue;
    }
    output += character;
    if (!/\s/u.test(character)) previous = character;
    index += 1;
  }
  return output;
}

export function stripTrailingCommas(text) {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      const end = readDoubleQuoted(text, index);
      output += text.slice(index, end);
      index = end;
      continue;
    }
    if (character === ",") {
      let cursor = index + 1;
      while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
      if (text[cursor] === "}" || text[cursor] === "]") {
        index += 1;
        continue;
      }
    }
    output += character;
    index += 1;
  }
  return output;
}

export function parseJson5Text(text) {
  try {
    return { ok: true, value: JSON.parse(text), format: "json" };
  } catch {
    // Fall through to the JSON5 subset.
  }
  try {
    return { ok: true, value: JSON.parse(stripTrailingCommas(normalizeJson5Text(text))), format: "json5" };
  } catch (error) {
    return {
      ok: false,
      value: undefined,
      format: "invalid",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readJson5File(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return { ok: false, exists: false, value: undefined, format: "missing" };
  }
  const parsed = parseJson5Text(text);
  if (!parsed.ok) {
    // A config that only holds comments is an empty config, not a broken one.
    try {
      if (stripTrailingCommas(normalizeJson5Text(text)).trim() === "") {
        return { ok: true, exists: true, value: {}, format: "empty" };
      }
    } catch {
      // Keep the original parse failure below.
    }
  }
  return { ...parsed, exists: true };
}
