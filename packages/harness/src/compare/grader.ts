import { access, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { npmInvocation, type CommandResult } from "./process.js";
import { createTrustedFixtureSandbox, type TrialSandbox } from "./sandbox.js";

const ReadmeGraderContractSchema = Type.Object(
  {
    requiredHeadings: Type.Array(Type.String(), { minItems: 1, uniqueItems: true }),
    publicApi: Type.Array(Type.String(), { minItems: 1, uniqueItems: true }),
    requiredCodeTokens: Type.Array(Type.String(), { minItems: 1, uniqueItems: true }),
    requiredAnyCodeTokens: Type.Array(
      Type.Array(Type.String(), { minItems: 1, uniqueItems: true }),
      { uniqueItems: true },
    ),
    forbiddenClaims: Type.Array(Type.String(), { uniqueItems: true }),
    exampleLanguages: Type.Array(Type.String(), { minItems: 1, uniqueItems: true }),
    forbidRemoteLinks: Type.Boolean(),
  },
  { additionalProperties: false },
);

type ReadmeGraderContract = Static<typeof ReadmeGraderContractSchema>;

export interface GraderCheck {
  id: string;
  passed: boolean;
  hard: boolean;
  weight: number;
  detail: string;
  command?: CommandResult;
}

export interface ReadmeGrade {
  kind: "readme-package-v1";
  passed: boolean;
  score: number;
  checks: GraderCheck[];
}

interface MarkdownDocument {
  headings: string[];
  codeSpans: string[];
  codeBlocks: Array<{ language: string; section?: string; code: string }>;
  links: string[];
}

export async function gradeReadmePackage(options: {
  trialRoot: string;
  contractPath: string;
  changedFiles: string[];
  expectedFiles: string[];
  sandbox?: TrialSandbox;
}): Promise<ReadmeGrade> {
  const sandbox = options.sandbox ?? createTrustedFixtureSandbox();
  const contract = await loadContract(options.contractPath);
  const readmePath = resolve(options.trialRoot, "README.md");
  const checks: GraderCheck[] = [];
  const changed = [...options.changedFiles].sort();
  const expected = [...options.expectedFiles].sort();
  checks.push(check(
    "scope",
    arraysEqual(changed, expected),
    15,
    `changed=${JSON.stringify(changed)} expected=${JSON.stringify(expected)}`,
  ));

  let source = "";
  try {
    source = await readFile(readmePath, "utf8");
  } catch {
    checks.push(check("readme-exists", false, 85, "README.md was not created."));
    return summarize(checks);
  }
  const document = parseMarkdown(source);
  const normalizedHeadings = new Set(document.headings.map(normalizeText));
  const missingHeadings = contract.requiredHeadings.filter(
    (heading) => !normalizedHeadings.has(normalizeText(heading)),
  );
  checks.push(check(
    "structure",
    missingHeadings.length === 0,
    10,
    missingHeadings.length === 0 ? "All required sections are present." : `Missing headings: ${missingHeadings.join(", ")}`,
  ));

  const linkFailures = await validateLinks(document.links, readmePath, options.trialRoot, contract.forbidRemoteLinks);
  checks.push(check(
    "links",
    linkFailures.length === 0,
    5,
    linkFailures.length === 0 ? "All local links resolve and no remote links are claimed." : linkFailures.join("; "),
  ));

  const allCode = [...document.codeSpans, ...document.codeBlocks.map((block) => block.code)].join("\n");
  const packageJson = JSON.parse(await readFile(resolve(options.trialRoot, "package.json"), "utf8")) as {
    name?: string;
  };
  const installNeedle = `npm install ${packageJson.name ?? ""}`;
  checks.push(check(
    "installation",
    Boolean(packageJson.name) && allCode.includes(installNeedle),
    10,
    `Expected an installation command containing '${installNeedle}'.`,
  ));

  const realTrialRoot = await realpath(options.trialRoot);
  const publicExports = await readModuleExports(options.trialRoot, realTrialRoot, sandbox);
  const missingExports = contract.publicApi.filter((name) => !publicExports.names.includes(name));
  const undocumentedExports = contract.publicApi.filter((name) => !allCode.includes(name));
  checks.push({
    ...check(
      "public-api",
      missingExports.length === 0 && undocumentedExports.length === 0,
      15,
      publicExports.result.exitCode === 0
        ? `missing exports=${JSON.stringify(missingExports)} undocumented=${JSON.stringify(undocumentedExports)}`
        : "The package entry point could not be loaded in the restricted export probe.",
    ),
    ...(publicExports.result.exitCode !== 0
      ? { command: redactCommandResult(publicExports.result, options.trialRoot, realTrialRoot) }
      : {}),
  });

  const missingTokens = contract.requiredCodeTokens.filter((token) => !allCode.includes(token));
  const missingAlternatives = contract.requiredAnyCodeTokens.filter(
    (alternatives) => !alternatives.some((token) => allCode.includes(token)),
  );
  checks.push(check(
    "behavior-evidence",
    missingTokens.length === 0 && missingAlternatives.length === 0,
    15,
    missingTokens.length === 0 && missingAlternatives.length === 0
      ? "Required behavior tokens are documented."
      : `Missing code evidence: ${[
          ...missingTokens,
          ...missingAlternatives.map((alternatives) => `one of (${alternatives.join(" | ")})`),
        ].join(", ")}`,
  ));

  const quickStartBlocks = document.codeBlocks.filter(
    (block) => normalizeText(block.section ?? "") === "quick start" && contract.exampleLanguages.includes(block.language),
  );
  const exampleResults: CommandResult[] = [];
  for (let index = 0; index < quickStartBlocks.length; index += 1) {
    const temporaryExample = resolve(options.trialRoot, `.harness-readme-example-${index}.mjs`);
    try {
      const safetyError = validateExampleSafety(quickStartBlocks[index].code, packageJson.name ?? "");
      if (safetyError) {
        exampleResults.push({
          command: ["node", "<generated-example>"],
          exitCode: 1,
          stdout: "",
          stderr: safetyError,
          timedOut: false,
          durationMs: 0,
        });
      } else {
        await writeFile(temporaryExample, quickStartBlocks[index].code, "utf8");
        const realTemporaryExample = await realpath(temporaryExample);
        exampleResults.push(await sandbox.run(process.execPath, [
          "--permission",
          `--allow-fs-read=${realTrialRoot}`,
          realTemporaryExample,
        ], {
          cwd: options.trialRoot,
          timeoutMs: 30_000,
        }));
      }
    } finally {
      await unlink(temporaryExample).catch(() => undefined);
    }
  }
  const examplesPass = quickStartBlocks.length > 0 && exampleResults.every((result) => result.exitCode === 0 && !result.timedOut);
  checks.push({
    ...check(
      "quick-start",
      examplesPass,
      15,
      quickStartBlocks.length === 0
        ? "Quick Start has no executable ESM JavaScript fence."
        : `Executed ${quickStartBlocks.length} Quick Start example(s).`,
    ),
    ...(exampleResults[0] ? { command: redactCommandResult(exampleResults[0], options.trialRoot, realTrialRoot) } : {}),
  });

  const npmTest = npmInvocation(["test"]);
  const testResult = await sandbox.run(npmTest.command, npmTest.args, {
    cwd: options.trialRoot,
    timeoutMs: 60_000,
  });
  checks.push({
    ...check("package-tests", testResult.exitCode === 0 && !testResult.timedOut, 10, "Ran the fixture's existing test contract."),
    command: redactCommandResult(testResult, options.trialRoot),
  });

  const lowered = source.toLocaleLowerCase("en-US");
  const forbidden = contract.forbiddenClaims.filter((claim) => lowered.includes(claim.toLocaleLowerCase("en-US")));
  checks.push(check(
    "no-invented-capabilities",
    forbidden.length === 0,
    5,
    forbidden.length === 0 ? "No frozen forbidden claim was found." : `Forbidden claims: ${forbidden.join(", ")}`,
  ));
  return summarize(checks);
}

/**
 * Read the package's real exports from a separate permission-restricted process.
 *
 * The graded repository is agent-modified, so its module must never be imported
 * into the grader itself.
 */
async function readModuleExports(
  trialRoot: string,
  realTrialRoot: string,
  sandbox: TrialSandbox,
): Promise<{ names: string[]; result: CommandResult }> {
  const moduleUrl = pathToFileURL(resolve(realTrialRoot, "src/index.mjs")).href;
  const probe =
    `const module = await import(${JSON.stringify(moduleUrl)});\n` +
    `process.stdout.write(JSON.stringify(Object.keys(module)));\n`;
  const result = await sandbox.run(
    process.execPath,
    ["--permission", `--allow-fs-read=${realTrialRoot}`, "--input-type=module", "--eval", probe],
    { cwd: trialRoot, timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) {
    return { names: [], result };
  }
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    return {
      names: Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === "string") : [],
      result,
    };
  } catch {
    return { names: [], result };
  }
}

async function loadContract(path: string): Promise<ReadmeGraderContract> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!Value.Check(ReadmeGraderContractSchema, value)) {
    const detail = [...Value.Errors(ReadmeGraderContractSchema, value)]
      .map((error) => `${error.path || "/"}: ${error.message}`)
      .join("; ");
    throw new Error(`Invalid readme-package-v1 grader contract: ${detail}`);
  }
  return value;
}

function parseMarkdown(source: string): MarkdownDocument {
  const headings: string[] = [];
  const codeSpans: string[] = [];
  const codeBlocks: MarkdownDocument["codeBlocks"] = [];
  const links: string[] = [];
  let currentSection: string | undefined;
  let fence: { marker: string; language: string; section?: string; lines: string[] } | undefined;
  for (const line of source.split(/\r?\n/)) {
    const fenceMatch = line.match(/^ {0,3}(```+|~~~+)\s*([\w+-]*)\s*$/);
    if (fenceMatch) {
      if (!fence) {
        fence = { marker: fenceMatch[1][0], language: fenceMatch[2].toLowerCase(), section: currentSection, lines: [] };
      } else if (fence.marker === fenceMatch[1][0]) {
        codeBlocks.push({ language: fence.language, section: fence.section, code: fence.lines.join("\n") });
        fence = undefined;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    if (fence) {
      fence.lines.push(line);
      continue;
    }
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      currentSection = stripInlineMarkup(heading[1]);
      headings.push(currentSection);
    }
    for (const match of line.matchAll(/`([^`\n]+)`/g)) codeSpans.push(match[1]);
    for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) links.push(match[1]);
  }
  return { headings, codeSpans, codeBlocks, links };
}

async function validateLinks(
  links: string[],
  readmePath: string,
  trialRoot: string,
  forbidRemote: boolean,
): Promise<string[]> {
  const failures: string[] = [];
  for (const link of links) {
    if (/^(?:https?:)?\/\//i.test(link)) {
      if (forbidRemote) failures.push(`Remote link is not allowed: ${link}`);
      continue;
    }
    if (/^(?:mailto|data):/i.test(link) || link.startsWith("#")) continue;
    const pathPart = decodeURIComponent(link.split("#", 1)[0]);
    if (!pathPart) continue;
    const target = resolve(dirname(readmePath), pathPart);
    const fromRoot = relative(trialRoot, target);
    if (isAbsolute(fromRoot) || fromRoot.startsWith("..")) {
      failures.push(`Link escapes the repository: ${link}`);
      continue;
    }
    await access(target).catch(() => failures.push(`Missing local link target: ${link}`));
  }
  return failures;
}

function check(id: string, passed: boolean, weight: number, detail: string): GraderCheck {
  return { id, passed, hard: true, weight, detail };
}

function summarize(checks: GraderCheck[]): ReadmeGrade {
  const total = checks.reduce((sum, item) => sum + item.weight, 0);
  const earned = checks.reduce((sum, item) => sum + (item.passed ? item.weight : 0), 0);
  return {
    kind: "readme-package-v1",
    passed: checks.every((item) => !item.hard || item.passed),
    score: total === 0 ? 0 : Math.round((earned / total) * 100),
    checks,
  };
}

function redactCommandResult(result: CommandResult, root: string, realRoot = root): CommandResult {
  const replaceRoot = (value: string): string =>
    value.replaceAll(realRoot, "<trial-root>").replaceAll(root, "<trial-root>");
  return {
    ...result,
    command: result.command.map((value, index) =>
      index === 0 && value === process.execPath ? "node" : replaceRoot(value),
    ),
    stdout: replaceRoot(result.stdout),
    stderr: replaceRoot(result.stderr),
  };
}

function stripInlineMarkup(value: string): string {
  return value.replace(/[*_`]/g, "").trim();
}

function normalizeText(value: string): string {
  return stripInlineMarkup(value).toLocaleLowerCase("en-US");
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const UNSAFE_EXAMPLE_TOKEN = /\b(?:process|globalThis|fetch|WebSocket|require|eval|Function|child_process|worker_threads|Deno|Bun)\b|\bimport\s*\(|(?:node|https?|data|file):|__proto__|\.constructor\b/;

function validateExampleSafety(source: string, packageName: string): string | undefined {
  if (UNSAFE_EXAMPLE_TOKEN.test(source)) {
    return "Quick Start uses a capability outside the isolated example policy.";
  }
  for (const match of source.matchAll(/\b(?:import|export)\b[^;\n]*?\bfrom\s*["']([^"']+)["']/g)) {
    if (match[1] !== packageName) {
      return `Quick Start imports '${match[1]}', but only '${packageName}' is allowed.`;
    }
  }
  if (/\bimport\s*["']/.test(source)) {
    return "Quick Start side-effect imports are not allowed.";
  }
  return undefined;
}
