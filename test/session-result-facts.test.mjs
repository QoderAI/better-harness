import assert from "node:assert/strict";
import test from "node:test";

import { parseResultFacts } from "../scripts/session-analysis/result-facts.mjs";

test("result facts extract ESLint aggregates without retaining output", () => {
  assert.deepEqual(parseResultFacts("12 problems (8 errors, 4 warnings)"), {
    errors: 8,
    warnings: 4,
  });
  assert.deepEqual(parseResultFacts("\u001b[31m✖ 1 problem (1 error, 0 warnings)\u001b[39m"), {
    errors: 1,
    warnings: 0,
  });
  assert.deepEqual(parseResultFacts("0 problems (0 errors, 0 warnings)"), {
    errors: 0,
    warnings: 0,
  });
});

test("result facts extract strong Found errors summaries", () => {
  assert.deepEqual(parseResultFacts("Found 7 errors"), { errors: 7 });
  assert.deepEqual(parseResultFacts("Found 1 error in 1 file."), { errors: 1 });
  assert.deepEqual(parseResultFacts("Found 0 errors."), { errors: 0 });
});

test("result facts extract pytest aggregates in either canonical order", () => {
  assert.deepEqual(parseResultFacts("5 passed, 2 failed"), {
    testsPassed: 5,
    testsFailed: 2,
  });
  assert.deepEqual(parseResultFacts("=== 2 failed, 5 passed in 0.42s ==="), {
    testsPassed: 5,
    testsFailed: 2,
  });
  assert.deepEqual(parseResultFacts("8 passed, 0 failed"), {
    testsPassed: 8,
    testsFailed: 0,
  });
});

test("result facts extract Jest and Vitest aggregates with checked totals", () => {
  assert.deepEqual(parseResultFacts("Tests: 3 failed, 9 passed"), {
    testsPassed: 9,
    testsFailed: 3,
  });
  assert.deepEqual(parseResultFacts("Tests: 0 failed, 12 passed, 12 total"), {
    testsPassed: 12,
    testsFailed: 0,
  });
  assert.deepEqual(parseResultFacts("Tests 2 failed | 6 passed"), {
    testsPassed: 6,
    testsFailed: 2,
  });
  assert.deepEqual(parseResultFacts("Tests 0 failed | 6 passed (6)"), {
    testsPassed: 6,
    testsFailed: 0,
  });
});

test("result facts merge agreeing strong summaries and preserve zero values", () => {
  assert.deepEqual(
    parseResultFacts([
      "0 problems (0 errors, 0 warnings)",
      "Tests: 0 failed, 4 passed, 4 total",
    ].join("\r\n")),
    {
      errors: 0,
      warnings: 0,
      testsPassed: 4,
      testsFailed: 0,
    },
  );
  assert.deepEqual(parseResultFacts("Found 2 errors\nFound 2 errors"), { errors: 2 });
});

test("result facts fail closed for conflicting or inconsistent summaries", () => {
  assert.equal(parseResultFacts("Found 2 errors\nFound 3 errors"), null);
  assert.equal(parseResultFacts("3 problems (2 errors, 0 warnings)"), null);
  assert.equal(parseResultFacts("Tests: 1 failed, 2 passed, 99 total"), null);
  assert.equal(parseResultFacts("Tests 1 failed | 2 passed (9)"), null);
  assert.equal(parseResultFacts("2 passed, 1 failed\n3 passed, 1 failed"), null);
});

test("result facts reject fuzzy prose, partial summaries, and non-string input", () => {
  const rejected = [
    "There were probably 3 lint errors.",
    "Found several errors",
    "The docs say: Found 2 errors after setup.",
    "2 passed, maybe 1 failed",
    "Tests: 2 failed",
    "Tests 2 failed and 4 passed",
    "3 problems (2 errors, one warning)",
    "1 passed, 2 failed, 3 skipped",
    "",
    "unstructured command output",
    null,
    { output: "Found 2 errors" },
  ];

  for (const value of rejected) {
    assert.equal(parseResultFacts(value), null, String(value));
  }
});

test("result facts expose only numeric aggregates", () => {
  const privateOutput = [
    "/Users/private/project/private-file.ts",
    "secret=do-not-copy",
    "Tests: 1 failed, 2 passed, 3 total",
  ].join("\n");
  const facts = parseResultFacts(privateOutput);

  assert.deepEqual(facts, { testsPassed: 2, testsFailed: 1 });
  assert.equal(JSON.stringify(facts).includes("private"), false);
  assert.ok(Object.values(facts).every(Number.isSafeInteger));
});
