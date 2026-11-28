/**
 * Bounded, read-only Codex project TOML inventory.
 *
 * The parser only materializes declaration metadata. It never evaluates a
 * command, resolves an MCP transport, or reads credentials. Malformed TOML is
 * rejected as one invalid file so duplicate keys/tables cannot create phantom
 * assets; unrelated parser failures are not silently converted to zero counts.
 */
import { open, readdir } from "node:fs/promises";
import path from "node:path";

import {
  evidence,
  normalizeMcpServer,
  sortByName,
  withoutExtension,
} from "../core/items.mjs";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const MAX_CODEX_TOML_BYTES = 256_000;

async function readBoundedText(filePath) {
  const handle = await open(filePath, "r").catch(() => null);
  if (!handle) return null;
  try {
    const info = await handle.stat();
    if (info.size > MAX_CODEX_TOML_BYTES) return null;
    const buffer = Buffer.alloc(MAX_CODEX_TOML_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead > MAX_CODEX_TOML_BYTES ? null : buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

function tomlError(message) {
  return Object.assign(new Error(`invalid Codex TOML: ${message}`), {
    code: "INVALID_CODEX_TOML",
  });
}

class TomlParser {
  constructor(text) {
    this.text = String(text ?? "").replace(/^\uFEFF/u, "");
    this.index = 0;
    this.root = Object.create(null);
    this.current = this.root;
    this.explicitTables = new Set();
  }

  fail(message) {
    throw tomlError(`${message} at offset ${this.index}`);
  }

  peek(value) {
    return this.text.startsWith(value, this.index);
  }

  consume(value) {
    if (!this.peek(value)) this.fail(`expected ${JSON.stringify(value)}`);
    this.index += value.length;
  }

  skipHorizontal() {
    while (this.text[this.index] === " " || this.text[this.index] === "\t") {
      this.index += 1;
    }
  }

  skipComment() {
    if (this.text[this.index] !== "#") return;
    while (this.index < this.text.length && !/[\r\n]/u.test(this.text[this.index])) {
      this.index += 1;
    }
  }

  skipWhitespace() {
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === " " || character === "\t" || character === "\r" || character === "\n") {
        this.index += 1;
        continue;
      }
      if (character === "#") {
        this.skipComment();
        continue;
      }
      break;
    }
  }

  finishStatement() {
    this.skipHorizontal();
    this.skipComment();
    if (this.index >= this.text.length) return;
    if (this.text[this.index] === "\r") {
      this.index += 1;
      if (this.text[this.index] === "\n") this.index += 1;
      return;
    }
    if (this.text[this.index] === "\n") {
      this.index += 1;
      return;
    }
    this.fail("unexpected content after statement");
  }

  parseKeyPart() {
    this.skipHorizontal();
    const quote = this.text[this.index];
    if (quote === '"' || quote === "'") {
      if (this.peek(`${quote}${quote}${quote}`)) this.fail("multiline strings are not valid keys");
      const value = quote === '"' ? this.parseBasicString() : this.parseLiteralString();
      if (!value) this.fail("empty key");
      return value;
    }
    const match = this.text.slice(this.index).match(/^[A-Za-z0-9_-]+/u);
    if (!match) this.fail("expected key");
    this.index += match[0].length;
    return match[0];
  }

  parseKeyPath() {
    const parts = [this.parseKeyPart()];
    this.skipHorizontal();
    while (this.text[this.index] === ".") {
      this.index += 1;
      parts.push(this.parseKeyPart());
      this.skipHorizontal();
    }
    return parts;
  }

  parseBasicString() {
    this.consume('"');
    let result = "";
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === '"') {
        this.index += 1;
        return result;
      }
      if (character === "\r" || character === "\n") this.fail("newline in basic string");
      if (character !== "\\") {
        result += character;
        this.index += 1;
        continue;
      }
      this.index += 1;
      result += this.parseEscape();
    }
    this.fail("unterminated basic string");
  }

  parseEscape() {
    const character = this.text[this.index];
    if (character === undefined) this.fail("unterminated escape");
    this.index += 1;
    const escapes = {
      b: "\b",
      t: "\t",
      n: "\n",
      f: "\f",
      r: "\r",
      '"': '"',
      "\\": "\\",
    };
    if (Object.hasOwn(escapes, character)) return escapes[character];
    if (character === "u" || character === "U") {
      const length = character === "u" ? 4 : 8;
      const digits = this.text.slice(this.index, this.index + length);
      if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`, "u").test(digits)) this.fail("invalid unicode escape");
      this.index += length;
      const codePoint = Number.parseInt(digits, 16);
      if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        this.fail("invalid unicode code point");
      }
      return String.fromCodePoint(codePoint);
    }
    this.fail("unsupported escape");
  }

  parseLiteralString() {
    this.consume("'");
    const start = this.index;
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === "'") {
        const value = this.text.slice(start, this.index);
        this.index += 1;
        return value;
      }
      if (character === "\r" || character === "\n") this.fail("newline in literal string");
      this.index += 1;
    }
    this.fail("unterminated literal string");
  }

  parseMultilineBasicString() {
    this.consume('"""');
    if (this.peek("\r\n")) this.index += 2;
    else if (this.text[this.index] === "\n") this.index += 1;
    let result = "";
    while (this.index < this.text.length) {
      if (this.peek('"""')) {
        this.index += 3;
        return result;
      }
      const character = this.text[this.index];
      if (character === "\\") {
        const next = this.text[this.index + 1];
        if (next === "\r" || next === "\n" || next === " " || next === "\t") {
          this.index += 1;
          while (/[ \t\r\n]/u.test(this.text[this.index] ?? "")) this.index += 1;
          continue;
        }
        this.index += 1;
        result += this.parseEscape();
        continue;
      }
      if (character === "\r") {
        if (this.text[this.index + 1] !== "\n") this.fail("bare carriage return");
        result += "\n";
        this.index += 2;
        continue;
      }
      result += character;
      this.index += 1;
    }
    this.fail("unterminated multiline basic string");
  }

  parseMultilineLiteralString() {
    this.consume("'''");
    if (this.peek("\r\n")) this.index += 2;
    else if (this.text[this.index] === "\n") this.index += 1;
    const start = this.index;
    while (this.index < this.text.length) {
      if (this.peek("'''")) {
        const value = this.text.slice(start, this.index).replace(/\r\n/gu, "\n");
        this.index += 3;
        return value;
      }
      if (this.text[this.index] === "\r" && this.text[this.index + 1] !== "\n") {
        this.fail("bare carriage return");
      }
      this.index += 1;
    }
    this.fail("unterminated multiline literal string");
  }

  parseArray() {
    this.consume("[");
    const values = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return values;
    }
    while (this.index < this.text.length) {
      values.push(this.parseValue());
      this.skipWhitespace();
      if (this.text[this.index] === "]") {
        this.index += 1;
        return values;
      }
      this.consume(",");
      this.skipWhitespace();
      if (this.text[this.index] === "]") {
        this.index += 1;
        return values;
      }
    }
    this.fail("unterminated array");
  }

  parseInlineTable() {
    this.consume("{");
    const value = Object.create(null);
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return value;
    }
    while (this.index < this.text.length) {
      const keyPath = this.parseKeyPath();
      this.consume("=");
      this.assign(value, keyPath, this.parseValue());
      this.skipWhitespace();
      if (this.text[this.index] === "}") {
        this.index += 1;
        return value;
      }
      this.consume(",");
      this.skipWhitespace();
      if (this.text[this.index] === "}") this.fail("trailing comma in inline table");
    }
    this.fail("unterminated inline table");
  }

  parseBareValue() {
    const start = this.index;
    while (this.index < this.text.length && !/[ \t\r\n#,}\]]/u.test(this.text[this.index])) {
      this.index += 1;
    }
    const raw = this.text.slice(start, this.index);
    if (!raw) this.fail("expected value");
    if (raw === "true") return true;
    if (raw === "false") return false;
    const numeric = raw.replace(/_/gu, "");
    if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(numeric)) {
      return Number(numeric);
    }
    if (/^[+-]?(?:0x[0-9A-Fa-f]+|0o[0-7]+|0b[01]+)$/u.test(numeric)) {
      return Number(numeric);
    }
    if (/^(?:\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/u.test(raw)) {
      return raw;
    }
    if (/^[+-]?(?:inf|nan)$/u.test(raw)) return raw;
    this.fail(`unsupported bare value ${JSON.stringify(raw)}`);
  }

  parseValue() {
    this.skipWhitespace();
    const character = this.text[this.index];
    if (character === '"') {
      return this.peek('"""') ? this.parseMultilineBasicString() : this.parseBasicString();
    }
    if (character === "'") {
      return this.peek("'''") ? this.parseMultilineLiteralString() : this.parseLiteralString();
    }
    if (character === "[") return this.parseArray();
    if (character === "{") return this.parseInlineTable();
    return this.parseBareValue();
  }

  assign(target, keyPath, value) {
    let current = target;
    for (const key of keyPath.slice(0, -1)) {
      if (!Object.hasOwn(current, key)) current[key] = Object.create(null);
      if (!isRecord(current[key])) this.fail(`key ${JSON.stringify(key)} is already a value`);
      current = current[key];
    }
    const key = keyPath.at(-1);
    if (Object.hasOwn(current, key)) this.fail(`duplicate key ${JSON.stringify(key)}`);
    current[key] = value;
  }

  tableAt(keyPath) {
    let current = this.root;
    for (const key of keyPath) {
      if (!Object.hasOwn(current, key)) current[key] = Object.create(null);
      if (Array.isArray(current[key])) {
        if (current[key].length === 0) this.fail(`table ${JSON.stringify(key)} has no array element`);
        current = current[key].at(-1);
      } else {
        if (!isRecord(current[key])) this.fail(`table ${JSON.stringify(key)} is already a value`);
        current = current[key];
      }
    }
    return current;
  }

  parseHeader() {
    this.consume("[");
    const arrayTable = this.text[this.index] === "[";
    if (arrayTable) this.index += 1;
    const keyPath = this.parseKeyPath();
    this.consume("]");
    if (arrayTable) this.consume("]");
    if (!arrayTable) {
      const identity = JSON.stringify(keyPath);
      if (this.explicitTables.has(identity)) this.fail("duplicate table");
      this.explicitTables.add(identity);
      this.current = this.tableAt(keyPath);
      return;
    }
    const parent = this.tableAt(keyPath.slice(0, -1));
    const key = keyPath.at(-1);
    if (!Object.hasOwn(parent, key)) parent[key] = [];
    if (!Array.isArray(parent[key])) this.fail(`array table ${JSON.stringify(key)} conflicts with a value`);
    const element = Object.create(null);
    parent[key].push(element);
    this.current = element;
  }

  parse() {
    while (this.index < this.text.length) {
      this.skipWhitespace();
      if (this.index >= this.text.length) break;
      if (this.text[this.index] === "[") this.parseHeader();
      else {
        const keyPath = this.parseKeyPath();
        this.consume("=");
        this.assign(this.current, keyPath, this.parseValue());
      }
      this.finishStatement();
    }
    return this.root;
  }
}

export function parseCodexToml(text) {
  return new TomlParser(text).parse();
}

export function parseCodexAgentToml(text, fallbackName) {
  const declaration = parseCodexToml(text);
  if (!isRecord(declaration)) return undefined;
  const declaredName = declaration.name;
  if (declaredName !== undefined && (typeof declaredName !== "string" || !declaredName.trim())) {
    return undefined;
  }
  return {
    name: typeof declaredName === "string" && declaredName.trim()
      ? declaredName.trim()
      : fallbackName,
    description: typeof declaration.description === "string" ? declaration.description : "",
    developerInstructionsLength: typeof declaration.developer_instructions === "string"
      ? declaration.developer_instructions.length
      : 0,
  };
}

export function parseCodexMcpServersToml(text) {
  const declaration = parseCodexToml(text);
  if (!isRecord(declaration?.mcp_servers)) return [];
  return Object.entries(declaration.mcp_servers)
    .filter(([, value]) => isRecord(value))
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function collectCodexProjectTomlAssets(root, sourceLabel, workspace) {
  const subagents = [];
  const agentsRoot = path.join(root, "agents");
  const entries = await readdir(agentsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".toml") continue;
    const filePath = path.join(agentsRoot, entry.name);
    const text = await readBoundedText(filePath);
    if (typeof text !== "string") continue;
    let metadata;
    try {
      metadata = parseCodexAgentToml(text, withoutExtension(filePath));
    } catch (error) {
      if (error?.code !== "INVALID_CODEX_TOML") throw error;
      continue;
    }
    if (!metadata) continue;
    const fallbackName = withoutExtension(filePath);
    subagents.push({
      id: `project:subagent:${filePath}`,
      kind: "subagent",
      scope: "project",
      sourceLabel,
      sourceKind: "codex-toml",
      format: "toml",
      filePath,
      name: metadata.name,
      declaredName: metadata.name !== fallbackName ? metadata.name : undefined,
      description: metadata.description,
      developerInstructionsLength: metadata.developerInstructionsLength,
      evidence: evidence(filePath, workspace),
    });
  }

  const mcps = [];
  const configPath = path.join(root, "config.toml");
  const configText = await readBoundedText(configPath);
  if (typeof configText === "string") {
    let servers;
    try {
      servers = parseCodexMcpServersToml(configText);
    } catch (error) {
      if (error?.code !== "INVALID_CODEX_TOML") throw error;
      servers = [];
    }
    for (const { name, value } of servers) {
      mcps.push({
        ...normalizeMcpServer(name, value, {
          scope: "project",
          sourceLabel,
          filePath: configPath,
          rootForEvidence: workspace,
        }),
        sourceKind: "codex-toml",
      });
    }
  }
  return {
    subagents: subagents.sort(sortByName),
    mcps: mcps.sort(sortByName),
  };
}
