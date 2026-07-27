const ANSI = {
  bold: ["\x1b[1m", "\x1b[22m"],
  cyan: ["\x1b[36m", "\x1b[39m"],
  dim: ["\x1b[2m", "\x1b[22m"],
};

export function shouldUseColor({ env = process.env, stream = process.stdout } = {}) {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY);
}

export function createStyle(enabled = false) {
  const apply = ([open, close], value) => (enabled ? `${open}${value}${close}` : value);
  return {
    bold: (value) => apply(ANSI.bold, value),
    cyan: (value) => apply(ANSI.cyan, value),
    dim: (value) => apply(ANSI.dim, value),
  };
}

export function stripTrailingPeriod(value) {
  return String(value ?? "").replace(/\.$/, "");
}

function wrapWords(value, width) {
  const words = String(value ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current.length + 1 + word.length) > width) {
      lines.push(current);
      current = word;
      continue;
    }
    current = `${current} ${word}`;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export function formatRows(rows, {
  leftWidth = 24,
  indent = 2,
  maxWidth = 96,
  style = createStyle(false),
} = {}) {
  const leftIndent = " ".repeat(indent);
  const rightIndent = " ".repeat(indent + leftWidth + 1);
  const rightWidth = Math.max(32, maxWidth - indent - leftWidth - 1);
  const lines = [];

  for (const row of rows) {
    const rightLines = wrapWords(stripTrailingPeriod(row.right), rightWidth);
    lines.push(`${leftIndent}${style.cyan(row.left.padEnd(leftWidth))} ${rightLines[0]}`);
    for (const line of rightLines.slice(1)) {
      lines.push(`${rightIndent}${line}`);
    }
    if (row.detail) {
      for (const line of wrapWords(row.detail, rightWidth)) {
        lines.push(`${rightIndent}${style.dim(line)}`);
      }
    }
  }

  return lines;
}
