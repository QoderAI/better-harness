import {
  SYNTAX,
  languageForNameOrId,
  syntaxForLanguage,
} from "./languages.generated.mjs";

const LF = 10;
const CR = 13;
const SPACE = 32;
const TAB = 9;
const SLASH = 47;
const STAR = 42;
const HASH = 35;
const DASH = 45;
const LT = 60;
const GT = 62;
const BANG = 33;
const BACKSLASH = 92;
const SINGLE_QUOTE = 39;
const DOUBLE_QUOTE = 34;
const BACKTICK = 96;
const HTML_COMMENT_OPEN = Buffer.from("<!--");

function isWhitespace(byte) {
  return byte === SPACE || byte === TAB || byte === CR || byte === 11 || byte === 12;
}

function isQuote(byte) {
  return byte === SINGLE_QUOTE || byte === DOUBLE_QUOTE || byte === BACKTICK;
}

function hasQuoteMarker(buffer) {
  return buffer.indexOf(SINGLE_QUOTE) !== -1
    || buffer.indexOf(DOUBLE_QUOTE) !== -1
    || buffer.indexOf(BACKTICK) !== -1;
}

function finishLine(counts, hasCode, hasComment) {
  counts.lines += 1;
  if (hasCode) {
    counts.code += 1;
  } else if (hasComment) {
    counts.comment += 1;
  } else {
    counts.blank += 1;
  }
}

export function countCStyle(buffer) {
  if (buffer.indexOf(SLASH) === -1 && !hasQuoteMarker(buffer)) {
    return countNoComment(buffer);
  }

  const counts = { blank: 0, comment: 0, code: 0, lines: 0 };
  let hasCode = false;
  let hasComment = false;
  let inBlock = false;
  let quote = 0;
  let escaped = false;

  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    const next = buffer[index + 1];

    if (byte === LF) {
      finishLine(counts, hasCode || quote !== 0, hasComment || inBlock);
      hasCode = false;
      hasComment = false;
      escaped = false;
      continue;
    }

    if (inBlock) {
      hasComment = true;
      if (byte === STAR && next === SLASH) {
        inBlock = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      hasCode = true;
      if (escaped) {
        escaped = false;
      } else if (byte === BACKSLASH) {
        escaped = true;
      } else if (byte === quote) {
        quote = 0;
      }
      continue;
    }

    if (isWhitespace(byte)) {
      continue;
    }

    if (byte === SLASH && next === SLASH) {
      hasComment = true;
      while (index + 1 < buffer.length && buffer[index + 1] !== LF) {
        index += 1;
      }
      continue;
    }

    if (byte === SLASH && next === STAR) {
      hasComment = true;
      inBlock = true;
      index += 1;
      continue;
    }

    hasCode = true;
    if (isQuote(byte)) {
      quote = byte;
      escaped = false;
    }
  }

  if (buffer.length > 0 && buffer[buffer.length - 1] !== LF) {
    finishLine(counts, hasCode, hasComment || inBlock);
  }
  return counts;
}

export function countCNested(buffer) {
  if (buffer.indexOf(SLASH) === -1 && !hasQuoteMarker(buffer)) {
    return countNoComment(buffer);
  }

  const counts = { blank: 0, comment: 0, code: 0, lines: 0 };
  let hasCode = false;
  let hasComment = false;
  let blockDepth = 0;
  let quote = 0;
  let escaped = false;

  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    const next = buffer[index + 1];

    if (byte === LF) {
      finishLine(counts, hasCode || quote !== 0, hasComment || blockDepth > 0);
      hasCode = false;
      hasComment = false;
      escaped = false;
      continue;
    }

    if (blockDepth > 0) {
      hasComment = true;
      if (byte === SLASH && next === STAR) {
        blockDepth += 1;
        index += 1;
      } else if (byte === STAR && next === SLASH) {
        blockDepth -= 1;
        index += 1;
      }
      continue;
    }

    if (quote) {
      hasCode = true;
      if (escaped) {
        escaped = false;
      } else if (byte === BACKSLASH) {
        escaped = true;
      } else if (byte === quote) {
        quote = 0;
      }
      continue;
    }

    if (isWhitespace(byte)) {
      continue;
    }

    if (byte === SLASH && next === SLASH) {
      hasComment = true;
      while (index + 1 < buffer.length && buffer[index + 1] !== LF) {
        index += 1;
      }
      continue;
    }

    if (byte === SLASH && next === STAR) {
      hasComment = true;
      blockDepth = 1;
      index += 1;
      continue;
    }

    hasCode = true;
    if (isQuote(byte)) {
      quote = byte;
      escaped = false;
    }
  }

  if (buffer.length > 0 && buffer[buffer.length - 1] !== LF) {
    finishLine(counts, hasCode, hasComment || blockDepth > 0);
  }
  return counts;
}

export function countHashStyle(buffer) {
  if (buffer.indexOf(HASH) === -1 && !hasQuoteMarker(buffer)) {
    return countNoComment(buffer);
  }

  const counts = { blank: 0, comment: 0, code: 0, lines: 0 };
  let hasCode = false;
  let hasComment = false;
  let quote = 0;
  let escaped = false;

  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];

    if (byte === LF) {
      finishLine(counts, hasCode || quote !== 0, hasComment);
      hasCode = false;
      hasComment = false;
      escaped = false;
      continue;
    }

    if (quote) {
      hasCode = true;
      if (escaped) {
        escaped = false;
      } else if (byte === BACKSLASH) {
        escaped = true;
      } else if (byte === quote) {
        quote = 0;
      }
      continue;
    }

    if (isWhitespace(byte)) {
      continue;
    }

    if (byte === HASH) {
      hasComment = true;
      while (index + 1 < buffer.length && buffer[index + 1] !== LF) {
        index += 1;
      }
      continue;
    }

    hasCode = true;
    if (isQuote(byte)) {
      quote = byte;
      escaped = false;
    }
  }

  if (buffer.length > 0 && buffer[buffer.length - 1] !== LF) {
    finishLine(counts, hasCode, hasComment);
  }
  return counts;
}

export function countHtmlStyle(buffer) {
  if (buffer.indexOf(HTML_COMMENT_OPEN) === -1) {
    return countNoComment(buffer);
  }

  const counts = { blank: 0, comment: 0, code: 0, lines: 0 };
  let hasCode = false;
  let hasComment = false;
  let inComment = false;

  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    const next = buffer[index + 1];
    const third = buffer[index + 2];
    const fourth = buffer[index + 3];

    if (byte === LF) {
      finishLine(counts, hasCode, hasComment || inComment);
      hasCode = false;
      hasComment = false;
      continue;
    }

    if (inComment) {
      hasComment = true;
      if (byte === DASH && next === DASH && third === GT) {
        inComment = false;
        index += 2;
      }
      continue;
    }

    if (isWhitespace(byte)) {
      continue;
    }

    if (byte === LT && next === BANG && third === DASH && fourth === DASH) {
      hasComment = true;
      inComment = true;
      index += 3;
      continue;
    }

    hasCode = true;
  }

  if (buffer.length > 0 && buffer[buffer.length - 1] !== LF) {
    finishLine(counts, hasCode, hasComment || inComment);
  }
  return counts;
}

export function countNoComment(buffer) {
  const counts = { blank: 0, comment: 0, code: 0, lines: 0 };
  let hasCode = false;

  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte === LF) {
      finishLine(counts, hasCode, false);
      hasCode = false;
      continue;
    }
    if (!isWhitespace(byte)) {
      hasCode = true;
    }
  }

  if (buffer.length > 0 && buffer[buffer.length - 1] !== LF) {
    finishLine(counts, hasCode, false);
  }
  return counts;
}

export function countBufferBySyntax(buffer, syntax) {
  if (syntax === SYNTAX.C_STYLE) {
    return countCStyle(buffer);
  }
  if (syntax === SYNTAX.C_NESTED) {
    return countCNested(buffer);
  }
  if (syntax === SYNTAX.HASH) {
    return countHashStyle(buffer);
  }
  if (syntax === SYNTAX.HTML) {
    return countHtmlStyle(buffer);
  }
  if (syntax === SYNTAX.NO_COMMENT) {
    return countNoComment(buffer);
  }
  return null;
}

export function countBufferForLanguage(buffer, languageNameOrId) {
  const languageId = languageForNameOrId(languageNameOrId);
  if (!languageId) {
    throw new Error(`unsupported language: ${languageNameOrId}`);
  }
  const counts = countBufferBySyntax(buffer, syntaxForLanguage(languageId));
  if (!counts) {
    throw new Error(`unsupported scanner for language: ${languageNameOrId}`);
  }
  return counts;
}
