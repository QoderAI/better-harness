const ANSI_SEQUENCE_RE = /\u001B\[[0-?]*[ -/]*[@-~]/gu;
const INVALID = Symbol("invalid-result-facts");

const ESLINT_SUMMARY_RE = /^\s*(?:[\u2716\u2718]\s*)?(\d+)\s+problems?\s+\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)\s*$/u;
const FOUND_ERRORS_RE = /^\s*Found\s+(\d+)\s+errors?(?:\s+in\s+\d+\s+files?)?\.?\s*$/u;
const PYTEST_PASSED_FIRST_RE = /^\s*(?:=+\s*)?(\d+)\s+passed,\s*(\d+)\s+failed(?:\s+in\s+\d+(?:\.\d+)?s)?(?:\s*=+)?\s*$/u;
const PYTEST_FAILED_FIRST_RE = /^\s*(?:=+\s*)?(\d+)\s+failed,\s*(\d+)\s+passed(?:\s+in\s+\d+(?:\.\d+)?s)?(?:\s*=+)?\s*$/u;
const JEST_SUMMARY_RE = /^\s*Tests:\s*(\d+)\s+failed,\s*(\d+)\s+passed(?:,\s*(\d+)\s+total)?\s*$/u;
const VITEST_SUMMARY_RE = /^\s*Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed(?:\s*\((\d+)\))?\s*$/u;

/**
 * Extract privacy-safe numeric aggregates from strong command-result summaries.
 *
 * The parser deliberately returns no source text, command, path, identifier, or
 * inferred category. Conflicting or internally inconsistent summaries fail
 * closed instead of being added together.
 *
 * @param {string} output
 * @returns {{ errors?: number, warnings?: number, testsPassed?: number, testsFailed?: number } | null}
 */
export function parseResultFacts(output) {
  if (typeof output !== "string" || output.trim().length === 0) return null;

  const facts = {};
  let matched = false;

  for (const rawLine of output.replace(ANSI_SEQUENCE_RE, "").split(/\r?\n/u)) {
    const candidate = parseSummaryLine(rawLine);
    if (candidate === INVALID) return null;
    if (!candidate) continue;
    matched = true;

    for (const [key, value] of Object.entries(candidate)) {
      if (Object.hasOwn(facts, key) && facts[key] !== value) return null;
      facts[key] = value;
    }
  }

  return matched ? facts : null;
}

function parseSummaryLine(line) {
  let match = line.match(ESLINT_SUMMARY_RE);
  if (match) {
    const [total, errors, warnings] = match.slice(1).map(parseCount);
    if ([total, errors, warnings].includes(null) || total !== errors + warnings) return INVALID;
    return { errors, warnings };
  }

  match = line.match(FOUND_ERRORS_RE);
  if (match) {
    const errors = parseCount(match[1]);
    return errors === null ? INVALID : { errors };
  }

  match = line.match(PYTEST_PASSED_FIRST_RE);
  if (match) {
    const testsPassed = parseCount(match[1]);
    const testsFailed = parseCount(match[2]);
    return testsPassed === null || testsFailed === null
      ? INVALID
      : { testsPassed, testsFailed };
  }

  match = line.match(PYTEST_FAILED_FIRST_RE);
  if (match) {
    const testsFailed = parseCount(match[1]);
    const testsPassed = parseCount(match[2]);
    return testsPassed === null || testsFailed === null
      ? INVALID
      : { testsPassed, testsFailed };
  }

  match = line.match(JEST_SUMMARY_RE);
  if (match) return testSummary(match[2], match[1], match[3]);

  match = line.match(VITEST_SUMMARY_RE);
  if (match) return testSummary(match[2], match[1], match[3]);

  return null;
}

function testSummary(passedValue, failedValue, totalValue) {
  const testsPassed = parseCount(passedValue);
  const testsFailed = parseCount(failedValue);
  if (testsPassed === null || testsFailed === null) return INVALID;

  if (totalValue !== undefined) {
    const total = parseCount(totalValue);
    if (total === null || total !== testsPassed + testsFailed) return INVALID;
  }

  return { testsPassed, testsFailed };
}

function parseCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}
