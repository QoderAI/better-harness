function hexValue(text) {
  return /^[\da-f]+$/i.test(text) ? Number.parseInt(text, 16) : null;
}

function decodeModuleString(raw) {
  const quote = raw[0];
  if ((quote !== '"' && quote !== "'") || raw.at(-1) !== quote) return null;
  let decoded = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }

    const escaped = raw[++index];
    if (escaped === undefined || index >= raw.length) return null;
    const simple = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      0: "\0",
      "\\": "\\",
      "'": "'",
      '"': '"',
    };
    if (Object.hasOwn(simple, escaped)) {
      decoded += simple[escaped];
      continue;
    }
    if (escaped === "\n" || escaped === "\u2028" || escaped === "\u2029") continue;
    if (escaped === "\r") {
      if (raw[index + 1] === "\n") index += 1;
      continue;
    }
    if (escaped === "x") {
      const value = hexValue(raw.slice(index + 1, index + 3));
      if (value === null) return null;
      decoded += String.fromCodePoint(value);
      index += 2;
      continue;
    }
    if (escaped === "u") {
      if (raw[index + 1] === "{") {
        const close = raw.indexOf("}", index + 2);
        if (close < 0) return null;
        const value = hexValue(raw.slice(index + 2, close));
        if (value === null || value > 0x10ffff) return null;
        decoded += String.fromCodePoint(value);
        index = close;
        continue;
      }
      const value = hexValue(raw.slice(index + 1, index + 5));
      if (value === null) return null;
      decoded += String.fromCodePoint(value);
      index += 4;
      continue;
    }
    decoded += escaped;
  }
  return decoded;
}

function isIdentifierStart(character) {
  return character === "$" || character === "_" || /[A-Za-z]/.test(character) || character?.codePointAt(0) > 0x7f;
}

function isIdentifierPart(character) {
  return isIdentifierStart(character) || /\d/.test(character);
}

// Keep the user-facing render path dependency-free. Full Canvas validation still
// delegates TSX compilation to the SDK transform; this scanner owns only module
// imports, re-exports, dynamic imports, and enough lexical structure to avoid
// treating comments, literals, regular expressions, or JSX copy as code.
const REGEX_PREFIX_KEYWORDS = new Set([
  "await", "case", "delete", "do", "else", "in", "instanceof", "of", "return", "throw", "typeof", "void", "yield",
]);
const REGEX_PREFIX_PUNCTUATORS = new Set([
  "(", "[", "{", ",", ";", ":", "=", "!", "?", "&&", "||", "??", "=>",
  "+", "-", "*", "%", "&", "|", "^", "~", "==", "===", "!=", "!==",
]);
const JSX_PREFIX_KEYWORDS = new Set(["case", "return", "throw", "yield"]);
const JSX_PREFIX_PUNCTUATORS = new Set(["(", "[", "{", ",", ":", "=", "?", "=>", "&&", "||", "??"]);

function canStartRegex(previous) {
  if (!previous) return true;
  if (previous.type === "identifier") {
    return REGEX_PREFIX_KEYWORDS.has(previous.value);
  }
  if (previous.type !== "punctuator") return false;
  return REGEX_PREFIX_PUNCTUATORS.has(previous.value);
}

function canStartJsx(previous) {
  if (!previous) return true;
  if (previous.type === "identifier") {
    return JSX_PREFIX_KEYWORDS.has(previous.value);
  }
  return previous.type === "punctuator" && JSX_PREFIX_PUNCTUATORS.has(previous.value);
}

function looksLikeJsxStart(source, index, previous) {
  if (!canStartJsx(previous)) return false;
  const next = source[index + 1];
  if (next === ">") return true;
  if (next === "/") return source[index + 2] === ">" || isIdentifierStart(source[index + 2]);
  if (!isIdentifierStart(next)) return false;
  const tagEnd = source.indexOf(">", index + 1);
  const tagHead = source.slice(index, tagEnd < 0 ? source.length : tagEnd);
  return !/^<[A-Za-z_$][\w$]*(?:\s*)(?:,|extends\b)/.test(tagHead);
}

function readQuotedString(source, start) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += source[index + 1] === "\r" && source[index + 2] === "\n" ? 3 : 2;
      continue;
    }
    if (character === quote) {
      const raw = source.slice(start, index + 1);
      return { end: index + 1, raw, value: decodeModuleString(raw), syntaxError: false };
    }
    if (character === "\n" || character === "\r" || character === "\u2028" || character === "\u2029") {
      return { end: index, raw: source.slice(start, index), value: null, syntaxError: true };
    }
    index += 1;
  }
  return { end: source.length, raw: source.slice(start), value: null, syntaxError: true };
}

function readRegexLiteral(source, start) {
  let index = start + 1;
  let inCharacterClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "[" && !inCharacterClass) {
      inCharacterClass = true;
      index += 1;
      continue;
    }
    if (character === "]" && inCharacterClass) {
      inCharacterClass = false;
      index += 1;
      continue;
    }
    if (character === "/" && !inCharacterClass) {
      index += 1;
      while (/[A-Za-z]/.test(source[index] ?? "")) index += 1;
      return { end: index, syntaxError: false };
    }
    if (character === "\n" || character === "\r" || character === "\u2028" || character === "\u2029") {
      return { end: index, syntaxError: true };
    }
    index += 1;
  }
  return { end: source.length, syntaxError: true };
}

const PUNCTUATORS = [
  ">>>=", "**=", "&&=", "||=", "??=", "===", "!==", ">>>", "<<=", ">>=", "...", "=>", "?.", "??",
  "&&", "||", "++", "--", "**", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "<<", ">>", "(", ")", "[", "]", "{", "}", ".", ",", ";", ":", "?", "=", "!", "+", "-", "*", "/",
  "%", "&", "|", "^", "~", "<", ">", "#", "@",
];

function tokenizeModule(sourceText) {
  const source = String(sourceText ?? "");
  let syntaxError = false;

  function scanJsx(start) {
    const expressionTokens = [];
    let index = start;
    let depth = 0;

    while (index < source.length) {
      if (source[index] !== "<") {
        index += 1;
        continue;
      }

      const closing = source[index + 1] === "/";
      let cursor = index + (closing ? 2 : 1);
      if (!closing) depth += 1;
      let selfClosing = false;
      let tagClosed = false;

      while (cursor < source.length) {
        const character = source[cursor];
        if (character === '"' || character === "'") {
          const attribute = readQuotedString(source, cursor);
          syntaxError ||= attribute.syntaxError;
          cursor = attribute.end;
          continue;
        }
        if (character === "{") {
          const expression = scan(cursor + 1, { stopAtTemplateBrace: true, staticAllowed: false });
          expressionTokens.push(...expression.tokens);
          if (!expression.closed) syntaxError = true;
          cursor = expression.index;
          continue;
        }
        if (character === ">") {
          selfClosing = !closing && source[cursor - 1] === "/";
          cursor += 1;
          tagClosed = true;
          break;
        }
        cursor += 1;
      }
      if (!tagClosed) return { tokens: expressionTokens, index: source.length, closed: false };
      if (closing || selfClosing) depth -= 1;
      index = cursor;
      if (depth === 0) return { tokens: expressionTokens, index, closed: true };

      while (index < source.length && source[index] !== "<") {
        if (source[index] === "{") {
          const expression = scan(index + 1, { stopAtTemplateBrace: true, staticAllowed: false });
          expressionTokens.push(...expression.tokens);
          if (!expression.closed) syntaxError = true;
          index = expression.index;
          continue;
        }
        index += 1;
      }
    }

    return { tokens: expressionTokens, index, closed: false };
  }

  function scan(start, { stopAtTemplateBrace = false, staticAllowed = true } = {}) {
    const tokens = [];
    let index = start;
    let braceDepth = 0;
    let bracketDepth = 0;
    let parenthesisDepth = 0;

    function addToken(type, value, tokenStart, end, extra = {}) {
      tokens.push({
        type,
        value,
        start: tokenStart,
        end,
        topLevel: staticAllowed && braceDepth === 0 && bracketDepth === 0 && parenthesisDepth === 0,
        ...extra,
      });
    }

    while (index < source.length) {
      const character = source[index];
      const next = source[index + 1];

      if (/\s/.test(character)) {
        index += 1;
        continue;
      }
      if (character === "/" && next === "/") {
        index += 2;
        while (index < source.length && !/[\r\n\u2028\u2029]/.test(source[index])) index += 1;
        continue;
      }
      if (character === "/" && next === "*") {
        const close = source.indexOf("*/", index + 2);
        if (close < 0) {
          syntaxError = true;
          return { tokens, index: source.length, closed: !stopAtTemplateBrace };
        }
        index = close + 2;
        continue;
      }
      if (character === "}" && stopAtTemplateBrace && braceDepth === 0) {
        return { tokens, index: index + 1, closed: true };
      }
      if (character === '"' || character === "'") {
        const parsed = readQuotedString(source, index);
        addToken("string", parsed.value, index, parsed.end, { raw: parsed.raw });
        syntaxError ||= parsed.syntaxError || parsed.value === null;
        index = parsed.end;
        continue;
      }
      if (character === "`") {
        const templateStart = index;
        const expressionTokens = [];
        index += 1;
        let closed = false;
        while (index < source.length) {
          if (source[index] === "\\") {
            index += 2;
            continue;
          }
          if (source[index] === "`") {
            index += 1;
            closed = true;
            break;
          }
          if (source[index] === "$" && source[index + 1] === "{") {
            const expression = scan(index + 2, { stopAtTemplateBrace: true, staticAllowed: false });
            expressionTokens.push(...expression.tokens);
            if (!expression.closed) syntaxError = true;
            index = expression.index;
            continue;
          }
          index += 1;
        }
        if (!closed) syntaxError = true;
        tokens.push(...expressionTokens);
        addToken("literal", "template", templateStart, index);
        continue;
      }
      if (character === "<" && looksLikeJsxStart(source, index, tokens.at(-1))) {
        const jsxStart = index;
        const jsx = scanJsx(index);
        tokens.push(...jsx.tokens);
        addToken("literal", "jsx", jsxStart, jsx.index);
        if (!jsx.closed) syntaxError = true;
        index = jsx.index;
        continue;
      }
      if (character === "/" && canStartRegex(tokens.at(-1))) {
        const parsed = readRegexLiteral(source, index);
        addToken("literal", "regex", index, parsed.end);
        syntaxError ||= parsed.syntaxError;
        index = parsed.end;
        continue;
      }
      if (isIdentifierStart(character)) {
        const tokenStart = index;
        index += 1;
        while (index < source.length && isIdentifierPart(source[index])) index += 1;
        addToken("identifier", source.slice(tokenStart, index), tokenStart, index);
        continue;
      }
      if (/\d/.test(character)) {
        const tokenStart = index;
        index += 1;
        while (index < source.length && /[\w.]/.test(source[index])) index += 1;
        addToken("literal", source.slice(tokenStart, index), tokenStart, index);
        continue;
      }

      const punctuator = PUNCTUATORS.find((candidate) => source.startsWith(candidate, index));
      if (!punctuator) {
        syntaxError = true;
        index += 1;
        continue;
      }
      const tokenStart = index;
      addToken("punctuator", punctuator, tokenStart, tokenStart + punctuator.length);
      index += punctuator.length;
      if (punctuator === "{") braceDepth += 1;
      else if (punctuator === "}") {
        if (braceDepth === 0) syntaxError = true;
        else braceDepth -= 1;
      } else if (punctuator === "[") bracketDepth += 1;
      else if (punctuator === "]") {
        if (bracketDepth === 0) syntaxError = true;
        else bracketDepth -= 1;
      } else if (punctuator === "(") parenthesisDepth += 1;
      else if (punctuator === ")") {
        if (parenthesisDepth === 0) syntaxError = true;
        else parenthesisDepth -= 1;
      }
    }

    if (braceDepth !== 0 || bracketDepth !== 0 || parenthesisDepth !== 0 || stopAtTemplateBrace) {
      syntaxError = true;
    }
    return { tokens, index, closed: !stopAtTemplateBrace };
  }

  const result = scan(0);
  return { tokens: result.tokens, syntaxError };
}

function namedImportNames(clause) {
  const open = clause.findIndex((token) => token.value === "{");
  const close = clause.findLastIndex((token) => token.value === "}");
  if (open < 0 || close <= open) return [];
  const names = [];
  let segment = [];
  for (const token of clause.slice(open + 1, close + 1)) {
    if (token.value !== "," && token !== clause[close]) {
      segment.push(token);
      continue;
    }
    while (segment[0]?.value === "type") segment.shift();
    const name = segment.find((candidate) => candidate.type === "identifier" || candidate.type === "string")?.value;
    if (name) names.push(name);
    segment = [];
  }
  return names;
}

function importRecord(tokens, index) {
  const next = tokens[index + 1];
  if (!next) return { syntaxError: true, end: index + 1 };
  if (next.type === "string") {
    return {
      record: { source: next.value, defaultImport: null, namespaceImport: false, namedImports: [], sideEffectOnly: true },
      syntaxError: next.value === null,
      end: index + 2,
    };
  }

  let fromIndex = -1;
  let end = index + 1;
  for (; end < tokens.length; end += 1) {
    const token = tokens[end];
    if (token.value === ";" && token.topLevel) break;
    if (end > index + 1 && token.topLevel && (token.value === "import" || token.value === "export")) break;
    if (token.value === "from" && token.topLevel) {
      fromIndex = end;
      break;
    }
  }
  const source = tokens[fromIndex + 1];
  if (fromIndex < 0 || source?.type !== "string" || source.value === null) {
    return { syntaxError: true, end: Math.max(end, index + 1) };
  }
  const clause = tokens.slice(index + 1, fromIndex);
  const effectiveClause = clause[0]?.value === "type" ? clause.slice(1) : clause;
  const defaultCandidate = effectiveClause.find((token) => token.type === "identifier");
  return {
    record: {
      source: source.value,
      defaultImport: effectiveClause[0]?.value === "{" || effectiveClause[0]?.value === "*" ? null : defaultCandidate?.value ?? null,
      namespaceImport: clause.some((token) => token.value === "*"),
      namedImports: namedImportNames(clause),
      sideEffectOnly: false,
    },
    syntaxError: false,
    end: fromIndex + 2,
  };
}

function reexportSource(tokens, index) {
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token.value === ";" && token.topLevel) return { source: null, syntaxError: false, end: cursor + 1 };
    if (cursor > index + 1 && token.topLevel && (token.value === "import" || token.value === "export")) {
      return { source: null, syntaxError: false, end: cursor };
    }
    if (token.value !== "from" || !token.topLevel) continue;
    const source = tokens[cursor + 1];
    return {
      source: source?.type === "string" ? source.value : null,
      syntaxError: source?.type !== "string" || source.value === null,
      end: cursor + 2,
    };
  }
  return { source: null, syntaxError: false, end: index + 1 };
}

export function analyzeCanvasModuleBoundaries(sourceText) {
  const parsed = tokenizeModule(sourceText);
  const imports = [];
  const reexports = [];
  let dynamicImport = false;
  let syntaxError = parsed.syntaxError;

  for (let index = 0; index < parsed.tokens.length; index += 1) {
    const token = parsed.tokens[index];
    if (token.type !== "identifier") continue;
    if (token.value === "import") {
      const previous = parsed.tokens[index - 1];
      const next = parsed.tokens[index + 1];
      if (previous?.value === "." || previous?.value === "?.") continue;
      if (next?.value === "(") {
        dynamicImport = true;
        continue;
      }
      if (!token.topLevel || next?.value === ".") continue;
      const parsedImport = importRecord(parsed.tokens, index);
      syntaxError ||= parsedImport.syntaxError;
      if (parsedImport.record) imports.push(parsedImport.record);
      index = Math.max(index, parsedImport.end - 1);
      continue;
    }
    if (token.value === "export" && token.topLevel) {
      const parsedExport = reexportSource(parsed.tokens, index);
      syntaxError ||= parsedExport.syntaxError;
      if (parsedExport.source) reexports.push(parsedExport.source);
      index = Math.max(index, parsedExport.end - 1);
    }
  }

  return {
    syntaxError,
    dynamicImport,
    staticSources: Array.from(new Set([
      ...imports.map((record) => record.source),
      ...reexports,
    ])),
    imports,
    reexports: Array.from(new Set(reexports)),
  };
}
