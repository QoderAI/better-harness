import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  analyzeRepository,
  extractSymbolsFromSource,
  parseUnifiedDiff,
  runHook,
} from "../../hooks/git-scripts/blast-radius.mjs";

const hookPath = path.resolve("hooks/git-scripts/blast-radius.mjs");

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stderr}`);
  }
  return result.stdout;
}

async function makeRepo(files) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "better-harness-blast-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);

  for (const [filePath, content] of Object.entries(files)) {
    const abs = path.join(repo, filePath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }

  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "initial"]);
  return repo;
}

test("parseUnifiedDiff maps changed line ranges to current files", () => {
  const diff = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index 111..222 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -3,0 +4,2 @@",
    "+const enabled = true;",
    "+run(enabled);",
    "@@ -12,3 +15,4 @@",
    " existing();",
    "-old();",
    "+newCall();",
  ].join("\n");

  assert.deepEqual(parseUnifiedDiff(diff), {
    "src/app.ts": [
      [4, 5],
      [15, 18],
    ],
  });
});

test("analyzeRepository stays quiet for ignored documentation-only changes", async () => {
  const repo = await makeRepo({
    "README.md": "initial\n",
    "src/app.ts": "export function ok() {\n  return true;\n}\n",
    ".better-harness/blast-radius.json": JSON.stringify({
      ignore: ["**/*.md"],
      thresholds: { reviewScore: 10, changedLines: { warn: 1, high: 2 } },
    }),
  });

  try {
    await writeFile(path.join(repo, "README.md"), "initial\nmore docs\n");
    const report = await analyzeRepository(repo);

    assert.equal(report.shouldReview, false);
    assert.equal(report.metrics.changedFiles, 0);
    assert.equal(report.metrics.changedLines, 0);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("analyzeRepository short-circuits clean worktrees without parsing source files", async () => {
  const repo = await makeRepo({
    "src/app.ts": "export function app() {\n  return 1;\n}\n",
  });

  try {
    const report = await analyzeRepository(repo);

    assert.equal(report.status, "ok");
    assert.equal(report.shouldReview, false);
    assert.equal(report.metrics.changedFiles, 0);
    assert.equal(report.metrics.parsedFiles, 0);
    assert.deepEqual(report.changedFiles, []);
    assert.deepEqual(report.changedSymbols, []);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("analyzeRepository stays clean with a valid clean base ref", async () => {
  const repo = await makeRepo({
    "src/app.ts": "export function app() {\n  return 1;\n}\n",
  });

  try {
    const report = await analyzeRepository(repo, {
      config: {
        baseRef: "HEAD",
        ignore: [],
        core: [],
        thresholds: {
          reviewScore: 10,
          changedFiles: { warn: 5, high: 10, critical: 20 },
          changedLines: { warn: 50, high: 100, critical: 200 },
          changedSymbols: { warn: 5, high: 10, critical: 20 },
          impactedSymbols: { warn: 5, high: 10, critical: 20 },
          impactedFiles: { warn: 5, high: 10, critical: 20 },
          callerCount: { warn: 5, high: 10, critical: 20 },
        },
        limits: { maxSourceFiles: 100, blastRadiusDepth: 2, maxImpactSymbols: 100 },
      },
    });

    assert.equal(report.status, "ok");
    assert.equal(report.shouldReview, false);
    assert.equal(report.metrics.changedFiles, 0);
    assert.deepEqual(report.changedFiles, []);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("analyzeRepository fails closed when base ref is unavailable", async () => {
  const repo = await makeRepo({
    "src/core/payment.ts": [
      "export function charge(amount: number) {",
      "  if (amount <= 0) throw new Error('invalid');",
      "  return amount;",
      "}",
      "",
    ].join("\n"),
  });

  try {
    await writeFile(
      path.join(repo, "src/core/payment.ts"),
      [
        "export function charge(amount: number) {",
        "  return Math.abs(amount);",
        "}",
        "",
      ].join("\n"),
    );

    const report = await analyzeRepository(repo, {
      config: {
        baseRef: "origin/main",
        ignore: [],
        core: [{ name: "payment core", paths: ["src/core/**"], symbols: [], risk: "critical" }],
        thresholds: {
          reviewScore: 10,
          changedFiles: { warn: 5, high: 10, critical: 20 },
          changedLines: { warn: 50, high: 100, critical: 200 },
          changedSymbols: { warn: 5, high: 10, critical: 20 },
          impactedSymbols: { warn: 5, high: 10, critical: 20 },
          impactedFiles: { warn: 5, high: 10, critical: 20 },
          callerCount: { warn: 5, high: 10, critical: 20 },
        },
        limits: { maxSourceFiles: 100, blastRadiusDepth: 2, maxImpactSymbols: 100 },
      },
    });

    assert.equal(report.status, "error");
    assert.equal(report.shouldReview, true);
    assert.equal(report.severity, "critical");
    assert.match(report.error.message, /base ref/i);
    assert.match(report.error.ref, /origin\/main/);
    assert.match(report.reasons.join("\n"), /Blast radius could not verify git base ref/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("core path rules and change-size thresholds trigger review guidance", async () => {
  const repo = await makeRepo({
    "src/core/payment.ts": [
      "export function charge(amount: number) {",
      "  if (amount <= 0) throw new Error('invalid');",
      "  return amount;",
      "}",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: {
        reviewScore: 20,
        changedLines: { warn: 2, high: 4 },
      },
      core: [
        {
          name: "payment core",
          paths: ["src/core/**"],
          risk: "high",
        },
      ],
    }),
  });

  try {
    await writeFile(
      path.join(repo, "src/core/payment.ts"),
      [
        "export function charge(amount: number) {",
        "  // relaxed during test",
        "  if (amount < -100) throw new Error('invalid');",
        "  const normalized = Math.abs(amount);",
        "  return normalized;",
        "}",
        "",
      ].join("\n"),
    );

    const report = await analyzeRepository(repo);

    assert.equal(report.shouldReview, true);
    assert.equal(report.coreHits[0].rule, "payment core");
    assert.match(report.reasons.join("\n"), /Changed core code/);
    assert.ok(report.metrics.changedLines >= 4);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("tree-sitter maps changed TypeScript functions and counts callers", async () => {
  const repo = await makeRepo({
    "src/core/auth.ts": [
      "export function verifyAccess(user: { role: string }) {",
      "  return user.role === 'admin';",
      "}",
      "",
      "export function login(role: string) {",
      "  return verifyAccess({ role });",
      "}",
      "",
    ].join("\n"),
    "src/features/a.ts": [
      "import { verifyAccess } from '../core/auth';",
      "export function routeA(role: string) { return verifyAccess({ role }); }",
      "export function routeB(role: string) { return verifyAccess({ role }); }",
      "export function routeC(role: string) { return verifyAccess({ role }); }",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: {
        reviewScore: 15,
        callerCount: { warn: 2, high: 3, critical: 10 },
      },
      core: [{ name: "auth core", symbols: ["verify*"], risk: "high" }],
    }),
  });

  try {
    const authPath = path.join(repo, "src/core/auth.ts");
    const auth = await readFile(authPath, "utf8");
    await writeFile(
      authPath,
      auth.replace(
        "return user.role === 'admin';",
        "const role = user.role.trim();\n  return role === 'admin' || role === 'owner';",
      ),
    );

    const report = await analyzeRepository(repo);
    const symbol = report.changedSymbols.find((item) => item.name === "verifyAccess");

    assert.ok(symbol, "expected verifyAccess to be mapped from the changed range");
    assert.equal(symbol.parser, "tree-sitter");
    assert.ok(symbol.callerCount >= 3);
    assert.equal(report.changedSymbols.some((item) => item.name === "role"), false);
    assert.match(report.reasons.join("\n"), /High blast radius/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("blast radius walks transitive callers with reverse BFS", async () => {
  const repo = await makeRepo({
    "src/core/auth.ts": [
      "export function verifyAccess(user: { role: string }) {",
      "  return user.role === 'admin';",
      "}",
      "",
    ].join("\n"),
    "src/features/routes.ts": [
      "import { verifyAccess } from '../core/auth';",
      "export function routeA(role: string) { return verifyAccess({ role }); }",
      "export function routeB(role: string) { return verifyAccess({ role }); }",
      "export function routeC(role: string) { return verifyAccess({ role }); }",
      "",
    ].join("\n"),
    "src/features/page.ts": [
      "import { routeA } from './routes';",
      "export function renderPage(role: string) { return routeA(role); }",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: {
        reviewScore: 15,
        callerCount: { warn: 2, high: 3, critical: 10 },
        impactedSymbols: { warn: 2, high: 4, critical: 10 },
      },
      limits: { blastRadiusDepth: 2 },
      core: [{ name: "auth core", symbols: ["verify*"], risk: "high" }],
    }),
  });

  try {
    const authPath = path.join(repo, "src/core/auth.ts");
    const auth = await readFile(authPath, "utf8");
    await writeFile(
      authPath,
      auth.replace(
        "return user.role === 'admin';",
        "return user.role === 'admin' || user.role === 'owner';",
      ),
    );

    const report = await analyzeRepository(repo);
    const affectedNames = report.affectedSymbols.map((item) => item.name);

    assert.ok(affectedNames.includes("routeA"));
    assert.ok(affectedNames.includes("renderPage"));
    assert.ok(report.metrics.impactedSymbols >= 4);
    assert.match(report.reasons.join("\n"), /Blast radius reaches/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("import resolver follows named aliases and avoids unrelated same-name modules", async () => {
  const repo = await makeRepo({
    "src/core/auth.ts": [
      "export function verifyAccess(role: string) {",
      "  return role === 'admin';",
      "}",
      "",
    ].join("\n"),
    "src/core/metrics.ts": [
      "export function verifyAccess(metric: string) {",
      "  return metric.length > 0;",
      "}",
      "",
    ].join("\n"),
    "src/features/auth-route.ts": [
      "import { verifyAccess as canAccess } from '../core/auth';",
      "export function authRoute(role: string) { return canAccess(role); }",
      "",
    ].join("\n"),
    "src/features/metrics-route.ts": [
      "import { verifyAccess } from '../core/metrics';",
      "export function metricsRoute(metric: string) { return verifyAccess(metric); }",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10, impactedSymbols: { warn: 1, high: 3, critical: 10 } },
      core: [{ name: "auth core", paths: ["src/core/auth.ts"], symbols: ["verify*"], risk: "high" }],
    }),
  });

  try {
    const authPath = path.join(repo, "src/core/auth.ts");
    const auth = await readFile(authPath, "utf8");
    await writeFile(
      authPath,
      auth.replace("role === 'admin'", "role === 'admin' || role === 'owner'"),
    );

    const report = await analyzeRepository(repo);
    const affectedNames = report.affectedSymbols.map((item) => item.name);

    assert.ok(affectedNames.includes("authRoute"));
    assert.equal(affectedNames.includes("metricsRoute"), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("import resolver follows namespace imports", async () => {
	const repo = await makeRepo({
		"src/core/auth.ts": [
			"export function verifyAccess(role: string) {",
      "  return role === 'admin';",
      "}",
      "",
    ].join("\n"),
    "src/features/route.ts": [
      "import * as auth from '../core/auth';",
      "export function route(role: string) { return auth.verifyAccess(role); }",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10 },
      core: [{ name: "auth core", symbols: ["verify*"], risk: "high" }],
    }),
  });

  try {
    const authPath = path.join(repo, "src/core/auth.ts");
    const auth = await readFile(authPath, "utf8");
    await writeFile(
      authPath,
      auth.replace("role === 'admin'", "role === 'admin' || role === 'owner'"),
    );

    const report = await analyzeRepository(repo);

    assert.ok(report.affectedSymbols.some((item) => item.name === "route"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("typescript resolver maps runtime .js specifiers to source .ts files", async () => {
  const repo = await makeRepo({
    "src/core/auth.ts": [
      "export function verifyAccess(role: string) {",
      "  return role === 'admin';",
      "}",
      "",
    ].join("\n"),
    "src/features/route.ts": [
      "import { verifyAccess } from '../core/auth.js';",
      "export function route(role: string) { return verifyAccess(role); }",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10, impactedSymbols: { warn: 1, high: 3, critical: 10 } },
      core: [{ name: "auth core", symbols: ["verify*"], risk: "high" }],
    }),
  });

  try {
    const authPath = path.join(repo, "src/core/auth.ts");
    const auth = await readFile(authPath, "utf8");
    await writeFile(
      authPath,
      auth.replace("role === 'admin'", "role === 'admin' || role === 'owner'"),
    );

    const report = await analyzeRepository(repo);

    assert.ok(report.affectedSymbols.some((item) => item.name === "route"));
    assert.ok(report.changedSymbols.some((item) => item.name === "verifyAccess" && item.callerCount > 0));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("typescript resolver follows tsconfig path aliases", async () => {
  const repo = await makeRepo({
    "tsconfig.json": [
      "{",
      "  // common Vite/Next-style alias",
      "  \"compilerOptions\": {",
      "    \"baseUrl\": \".\",",
      "    \"paths\": {",
      "      \"@/*\": [\"src/*\"],",
      "    },",
      "  },",
      "}",
      "",
    ].join("\n"),
    "src/core/auth.ts": [
      "export function verifyAccess(role: string) {",
      "  return role === 'admin';",
      "}",
      "",
    ].join("\n"),
    "src/features/route.ts": [
      "import { verifyAccess as canAccess } from '@/core/auth';",
      "export function route(role: string) { return canAccess(role); }",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10, impactedSymbols: { warn: 1, high: 3, critical: 10 } },
      core: [{ name: "auth core", paths: ["src/core/auth.ts"], symbols: ["verify*"], risk: "high" }],
    }),
  });

  try {
    const authPath = path.join(repo, "src/core/auth.ts");
    const auth = await readFile(authPath, "utf8");
    await writeFile(
      authPath,
      auth.replace("role === 'admin'", "role === 'admin' || role === 'owner'"),
    );

    const report = await analyzeRepository(repo);

    assert.ok(report.affectedSymbols.some((item) => item.name === "route"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("typescript resolver does not treat bare local-looking imports as aliases without tsconfig", async () => {
  const repo = await makeRepo({
    "src/core/auth.ts": [
      "export function verifyAccess(role: string) {",
      "  return role === 'admin';",
      "}",
      "",
    ].join("\n"),
    "src/features/route.ts": [
      "import { verifyAccess } from 'src/core/auth';",
      "export function route(role: string) { return verifyAccess(role); }",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10, impactedSymbols: { warn: 1, high: 3, critical: 10 } },
      core: [{ name: "auth core", paths: ["src/core/auth.ts"], symbols: ["verify*"], risk: "high" }],
    }),
  });

  try {
    const authPath = path.join(repo, "src/core/auth.ts");
    const auth = await readFile(authPath, "utf8");
    await writeFile(
      authPath,
      auth.replace("role === 'admin'", "role === 'admin' || role === 'owner'"),
    );

    const report = await analyzeRepository(repo);

    assert.equal(report.affectedSymbols.some((item) => item.name === "route"), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("javascript resolver does not treat arbitrary directories as modules", async () => {
  const repo = await makeRepo({
    "src/core/auth.ts": [
      "export function verifyAccess(role: string) {",
      "  return role === 'admin';",
      "}",
      "",
    ].join("\n"),
    "src/features/route.ts": [
      "import * as core from '../core';",
      "export function route(role: string) { return core.verifyAccess(role); }",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10, impactedSymbols: { warn: 1, high: 3, critical: 10 } },
      core: [{ name: "auth core", paths: ["src/core/auth.ts"], symbols: ["verify*"], risk: "high" }],
    }),
  });

  try {
    const authPath = path.join(repo, "src/core/auth.ts");
    const auth = await readFile(authPath, "utf8");
    await writeFile(
      authPath,
      auth.replace("role === 'admin'", "role === 'admin' || role === 'owner'"),
    );

    const report = await analyzeRepository(repo);

    assert.equal(report.affectedSymbols.some((item) => item.name === "route"), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("python import resolver follows from-import aliases and module aliases", async () => {
  const repo = await makeRepo({
    "service/core/token.py": [
      "def validate_token(token):",
      "    return len(token) > 10",
      "",
      "def decode(token):",
      "    return token",
      "",
    ].join("\n"),
    "service/routes.py": [
      "from service.core.token import validate_token as check",
      "import service.core.token as token_mod",
      "def route_a(token):",
      "    return check(token)",
      "def route_b(token):",
      "    return token_mod.validate_token(token)",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10, impactedSymbols: { warn: 1, high: 3, critical: 10 } },
      core: [{ name: "token core", paths: ["service/core/**"], symbols: ["validate*"], risk: "high" }],
    }),
  });

  try {
    const tokenPath = path.join(repo, "service/core/token.py");
    const source = await readFile(tokenPath, "utf8");
    await writeFile(
      tokenPath,
      source.replace("len(token) > 10", "len(token.strip()) > 5"),
    );

    const report = await analyzeRepository(repo);
    const affectedNames = report.affectedSymbols.map((item) => item.name);

    assert.ok(affectedNames.includes("route_a"));
    assert.ok(affectedNames.includes("route_b"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("python resolver follows relative imports and package submodule aliases", async () => {
  const repo = await makeRepo({
    "service/core/token.py": [
      "def validate_token(token):",
      "    return len(token) > 10",
      "",
    ].join("\n"),
    "service/routes.py": [
      "from .core.token import validate_token as check",
      "from service.core import token as token_mod",
      "def route_a(token):",
      "    return check(token)",
      "def route_b(token):",
      "    return token_mod.validate_token(token)",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10, impactedSymbols: { warn: 1, high: 3, critical: 10 } },
      core: [{ name: "token core", paths: ["service/core/**"], symbols: ["validate*"], risk: "high" }],
    }),
  });

  try {
    const tokenPath = path.join(repo, "service/core/token.py");
    const source = await readFile(tokenPath, "utf8");
    await writeFile(
      tokenPath,
      source.replace("len(token) > 10", "len(token.strip()) > 5"),
    );

    const report = await analyzeRepository(repo);
    const affectedNames = report.affectedSymbols.map((item) => item.name);

    assert.ok(affectedNames.includes("route_a"));
    assert.ok(affectedNames.includes("route_b"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("go import resolver follows package imports by directory", async () => {
  const repo = await makeRepo({
    "go.mod": "module example.com/app\n\ngo 1.22\n",
    "pkg/core/payment.go": [
      "package core",
      "",
      "func Charge(amount int) int {",
      "  return amount",
      "}",
      "",
    ].join("\n"),
    "pkg/app/app.go": [
      "package app",
      "",
      "import core \"example.com/app/pkg/core\"",
      "",
      "func Route() int {",
      "  return core.Charge(1)",
      "}",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10, impactedSymbols: { warn: 1, high: 3, critical: 10 } },
      core: [{ name: "payment core", paths: ["pkg/core/**"], symbols: ["Charge"], risk: "high" }],
    }),
  });

  try {
    const paymentPath = path.join(repo, "pkg/core/payment.go");
    const source = await readFile(paymentPath, "utf8");
    await writeFile(paymentPath, source.replace("return amount", "return amount + 1"));

    const report = await analyzeRepository(repo);
    const affectedNames = report.affectedSymbols.map((item) => item.name);

    assert.ok(affectedNames.includes("Route"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("overload resolver links string calls only to changed string overload", async () => {
  const repo = await makeRepo({
    "src/core/read.ts": [
      "export function read(id: string): string;",
      "export function read(id: number): string;",
      "export function read(id: string | number) {",
      "  return String(id);",
      "}",
      "",
    ].join("\n"),
    "src/features/use-read.ts": [
      "import { read } from '../core/read';",
      "export function useString() { return read('abc'); }",
      "export function useNumber() { return read(123); }",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10, impactedSymbols: { warn: 1, high: 3, critical: 10 } },
      core: [{ name: "read core", paths: ["src/core/**"], symbols: ["read"], risk: "high" }],
    }),
  });

  try {
    const readPath = path.join(repo, "src/core/read.ts");
    const source = await readFile(readPath, "utf8");
    await writeFile(
      readPath,
      source.replace(
        "export function read(id: string): string;",
        "export function read(id: string): string | undefined;",
      ),
    );

    const report = await analyzeRepository(repo);
    const changed = report.changedSymbols.find((item) => item.name === "read");
    const affectedNames = report.affectedSymbols.map((item) => item.name);

    assert.equal(changed.signature, "(string)");
    assert.ok(affectedNames.includes("useString"));
    assert.equal(affectedNames.includes("useNumber"), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("tree-sitter parser extracts symbols and calls across major languages", async () => {
  const fixtures = [
    {
      file: "src/app.js",
      source: "export function helper(x) { return x }\nconst run = () => helper(1);\n",
      symbols: ["helper", "run"],
      calls: ["helper"],
    },
    {
      file: "src/App.tsx",
      source: "export function App() { return <section>{format('x')}</section>; }\nfunction format(v: string) { return v; }\n",
      symbols: ["App", "format"],
      calls: ["format"],
    },
    {
      file: "cmd/main.go",
      source: "package main\nfunc Charge(amount int) int { return amount }\nfunc Route() int { return Charge(1) }\n",
      symbols: ["Charge", "Route"],
      calls: ["Charge"],
    },
    {
      file: "src/App.java",
      source: "class App { int charge(int amount) { return amount; } int route() { return charge(1); } }\n",
      symbols: ["App", "charge", "route"],
      calls: ["charge"],
    },
    {
      file: "service/app.py",
      source: "def charge(amount):\n    return amount\ndef route():\n    return charge(1)\n",
      symbols: ["charge", "route"],
      calls: ["charge"],
    },
    {
      file: "src/lib.rs",
      source: "pub fn charge(amount: i32) -> i32 { amount }\npub fn route() -> i32 { charge(1) }\n",
      symbols: ["charge", "route"],
      calls: ["charge"],
    },
  ];

  for (const fixture of fixtures) {
    const extracted = await extractSymbolsFromSource(fixture.file, fixture.source);
    const symbolNames = extracted.symbols.map((item) => item.name);
    const callNames = extracted.callSites.map((item) => item.rawName);

    for (const name of fixture.symbols) {
      assert.ok(symbolNames.includes(name), `${fixture.file} should include symbol ${name}`);
    }
    for (const name of fixture.calls) {
      assert.ok(callNames.includes(name), `${fixture.file} should include call ${name}`);
    }
  }
});

test("direct test coverage is detected for changed symbols", async () => {
  const repo = await makeRepo({
    "src/core/auth.ts": [
      "export function verifyAccess(role: string) {",
      "  return role === 'admin';",
      "}",
      "",
    ].join("\n"),
    "__tests__/auth.test.ts": [
      "import { verifyAccess } from '../src/core/auth';",
      "export function testVerifyAccess() { return verifyAccess('admin'); }",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10 },
      core: [{ name: "auth core", symbols: ["verify*"], risk: "high" }],
    }),
  });

  try {
    const authPath = path.join(repo, "src/core/auth.ts");
    const auth = await readFile(authPath, "utf8");
    await writeFile(
      authPath,
      auth.replace("role === 'admin'", "role === 'admin' || role === 'owner'"),
    );

    const report = await analyzeRepository(repo);
    const symbol = report.changedSymbols.find((item) => item.name === "verifyAccess");

    assert.ok(symbol.testFiles.includes("__tests__/auth.test.ts"));
    assert.equal(report.testGaps.some((item) => item.name === "verifyAccess"), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("removed security-like checks force review even below size thresholds", async () => {
  const repo = await makeRepo({
    "src/payment.ts": [
      "export function charge(amount: number) {",
      "  if (amount <= 0) throw new Error('invalid amount');",
      "  return amount;",
      "}",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 90, changedLines: { warn: 20, high: 40, critical: 80 } },
      core: [],
    }),
  });

  try {
    await writeFile(
      path.join(repo, "src/payment.ts"),
      "export function charge(amount: number) {\n  return amount;\n}\n",
    );

    const report = await analyzeRepository(repo);

    assert.equal(report.shouldReview, true);
    assert.equal(report.securityRemovals.length, 1);
    assert.match(report.reasons.join("\n"), /Removed security-like check/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("untracked directories are expanded to files", async () => {
  const repo = await makeRepo({
    "src/app.ts": "export function app() {\n  return 1;\n}\n",
  });

  try {
    await mkdir(path.join(repo, "test"), { recursive: true });
    await writeFile(
      path.join(repo, "test/new.test.ts"),
      "export function testApp() {\n  return true;\n}\n",
    );

    const report = await analyzeRepository(repo);

    assert.equal(report.changedFiles.some((item) => item.filePath === "test"), false);
    assert.equal(report.changedFiles.some((item) => item.filePath === "test/new.test.ts"), true);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("analyzeRepository ignores harness-owned artifacts by default", async () => {
  const repo = await makeRepo({
    "src/app.ts": "export function app() {\n  return 1;\n}\n",
  });

  try {
    await writeFile(path.join(repo, "AI_READINESS_FINDINGS.json"), "{\"findings\":[]}\n");
    await writeFile(path.join(repo, "REPORT_SUMMARY.txt"), "generated report\n");
    await writeFile(path.join(repo, "test-report.canvas.tsx"), "export const generated = true;\n");
    await mkdir(path.join(repo, ".qoder/better-harness/2026-07-01/000000-demo"), { recursive: true });
    await writeFile(path.join(repo, ".qoder/better-harness/2026-07-01/000000-demo/findings.json"), "{}\n");
    await writeFile(
      path.join(repo, ".qoder/better-harness/2026-07-01/000000-demo/report.canvas.tsx"),
      "export default function Report() { return null; }\n",
    );

    const artifactOnly = await analyzeRepository(repo);

    assert.equal(artifactOnly.status, "ok");
    assert.equal(artifactOnly.metrics.changedFiles, 0);
    assert.deepEqual(artifactOnly.changedFiles, []);

    await writeFile(path.join(repo, "src/new-feature.ts"), "export function feature() {\n  return 2;\n}\n");

    const withSource = await analyzeRepository(repo);

    assert.ok(withSource.changedFiles.some((item) => item.filePath === "src/new-feature.ts"));
    assert.equal(withSource.changedFiles.some((item) => item.filePath.startsWith(".qoder/")), false);
    assert.equal(withSource.changedFiles.some((item) => item.filePath === "AI_READINESS_FINDINGS.json"), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("runHook returns PostToolUse feedback and Stop blocks only once", async () => {
  const repo = await makeRepo({
    "src/auth/session.ts": [
      "export function validateSession(token: string) {",
      "  return token.length > 10;",
      "}",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10 },
      core: [{ name: "session core", paths: ["src/auth/**"], risk: "high" }],
    }),
  });

  try {
    await writeFile(
      path.join(repo, "src/auth/session.ts"),
      [
        "export function validateSession(token: string) {",
        "  const normalized = token.trim();",
        "  return normalized.length > 5;",
        "}",
        "",
      ].join("\n"),
    );

    const postTool = await runHook({
      cwd: repo,
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: path.join(repo, "src/auth/session.ts") },
    });
    assert.equal(postTool.exitCode, 0);
    assert.match(postTool.stdout, /PostToolUse/);
    assert.match(postTool.stdout, /AI review/);

    const firstStop = await runHook({
      cwd: repo,
      hook_event_name: "Stop",
      stop_hook_active: false,
    });
    assert.equal(firstStop.exitCode, 2);
    assert.match(firstStop.stderr, /AI review/);

    const secondStop = await runHook({
      cwd: repo,
      hook_event_name: "Stop",
      stop_hook_active: true,
    });
    assert.equal(secondStop.exitCode, 0);
    assert.equal(secondStop.stderr, "");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("Stop hook skips read-only sessions even when the worktree is dirty", async () => {
  const repo = await makeRepo({
    "src/auth/session.ts": [
      "export function validateSession(token: string) {",
      "  return token.length > 10;",
      "}",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10 },
      core: [{ name: "session core", paths: ["src/auth/**"], risk: "high" }],
    }),
  });

  try {
    await writeFile(
      path.join(repo, "src/auth/session.ts"),
      [
        "export function validateSession(token: string) {",
        "  const normalized = token.trim();",
        "  return normalized.length > 5;",
        "}",
        "",
      ].join("\n"),
    );

    const readOnlyStop = await runHook({
      cwd: repo,
      hook_event_name: "Stop",
      stop_hook_active: false,
    });

    assert.equal(readOnlyStop.exitCode, 0);
    assert.equal(readOnlyStop.stderr, "");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("CLI --json emits machine-readable analysis", async () => {
  const repo = await makeRepo({
    "src/app.ts": "export function app() {\n  return 1;\n}\n",
  });

  try {
    await writeFile(path.join(repo, "src/app.ts"), "export function app() {\n  return 2;\n}\n");
    const result = spawnSync("node", [hookPath, "--json", "--cwd", repo], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.metrics.changedFiles, 1);
    assert.equal(report.changedSymbols[0].name, "app");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("CLI hook mode honors stdin cwd and stop_hook_active", async () => {
  const repo = await makeRepo({
    "src/auth/session.ts": [
      "export function validateSession(token: string) {",
      "  return token.length > 10;",
      "}",
      "",
    ].join("\n"),
    ".better-harness/blast-radius.json": JSON.stringify({
      thresholds: { reviewScore: 10 },
      core: [{ name: "session core", paths: ["src/auth/**"], risk: "high" }],
    }),
  });

  try {
    await writeFile(
      path.join(repo, "src/auth/session.ts"),
      "export function validateSession(token: string) {\n  return token.trim().length > 5;\n}\n",
    );

    const postTool = spawnSync("node", [hookPath, "--mode=post-tool"], {
      input: JSON.stringify({
        cwd: repo,
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: path.join(repo, "src/auth/session.ts") },
      }),
      encoding: "utf8",
    });
    assert.equal(postTool.status, 0);

    const stop = spawnSync("node", [hookPath, "--mode=stop"], {
      input: JSON.stringify({ cwd: repo, hook_event_name: "Stop", stop_hook_active: false }),
      encoding: "utf8",
    });
    assert.equal(stop.status, 2);
    assert.match(stop.stderr, /session core/);

    const active = spawnSync("node", [hookPath, "--mode=stop"], {
      input: JSON.stringify({ cwd: repo, hook_event_name: "Stop", stop_hook_active: true }),
      encoding: "utf8",
    });
    assert.equal(active.status, 0);
    assert.equal(active.stderr, "");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
