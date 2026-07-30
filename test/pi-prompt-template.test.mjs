import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(repoRoot, "prompts", "better-harness.md");

// Faithful reimplementation of Pi's prompt-template `substituteArgs` argument
// grammar (from @earendil-works/pi-coding-agent): $@ / $ARGUMENTS and $1..$N
// simple forms, plus the `${@:-default}` / `${ARGUMENTS:-default}` /
// `${N:-default}` default-value form that expands to the fallback when the
// referenced argument is empty. This keeps the supported syntax exercised
// in-repo so a future template edit that breaks it fails a test.
function substituteArgs(content, args) {
  const allArgs = args.join(" ");
  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$(ARGUMENTS|@|\d+)/gu,
    (_match, defaultTarget, defaultValue, simple) => {
      if (defaultTarget !== undefined) {
        const value = defaultTarget === "@" || defaultTarget === "ARGUMENTS"
          ? allArgs
          : args[parseInt(defaultTarget, 10) - 1];
        return value && value.length > 0 ? value : defaultValue;
      }
      if (simple === "ARGUMENTS" || simple === "@") return allArgs;
      return args[parseInt(simple, 10) - 1] ?? "";
    },
  );
}

test("the /better-harness prompt template uses a supported Pi default-value placeholder", () => {
  const template = readFileSync(templatePath, "utf8");
  assert.match(template, /^argument-hint: '[^']+'$/mu, "argument-hint must be a YAML string for Pi autocomplete");
  assert.match(template, /\$\{@:-[^}]+\}/u, "template should carry a ${@:-default} placeholder");
});

test("Pi argument substitution expands the template default form with and without arguments", () => {
  const template = readFileSync(templatePath, "utf8");
  const placeholder = template.match(/\$\{@:-([^}]+)\}/u);
  assert.ok(placeholder, "expected a ${@:-default} placeholder in the template");
  const fallback = placeholder[1];

  // No arguments -> the default text is used.
  const empty = substituteArgs(template, []);
  assert.ok(empty.includes(fallback), "no-argument expansion should include the default text");
  assert.doesNotMatch(empty, /\$\{@:-/u, "no-argument expansion should not leave the literal placeholder");

  // Arguments -> the joined arguments replace the placeholder.
  const withArgs = substituteArgs(template, ["one", "two"]);
  assert.ok(withArgs.includes("one two"), "argument expansion should join the args with a space");
  assert.doesNotMatch(withArgs, /\$\{@:-/u, "argument expansion should not leave the literal placeholder");
});
