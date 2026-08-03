# Qwen Extension Dangling Context File Reference

Remove the `contextFileName` declaration from `qwen-extension.json` because it
references a `QWEN.md` file that does not exist in the repository and is not
included in the published npm package.

## Traceability

- Spec ID: 2026-07-29-qwen-extension-context-file
- Story: none; justified maintenance on the Qwen host manifest
- Status: Implemented

## Intent

`qwen-extension.json` declares `"contextFileName": "QWEN.md"`, but no `QWEN.md`
exists at the repository root, and `package.json` `files` does not include one,
so the published package cannot ship it either.

The reference is user-visible: Qwen Code `0.21.1` announces it before the
install confirmation in both registration paths — `qwen extensions link
<local-path>` and `qwen extensions install <git-repository-url>` — with the
same message (observed on Windows with isolated `QWEN_HOME` directories):

```text
This extension will append info to your QWEN.md context using QWEN.md
```

The extension promises durable context that it cannot deliver. The existing
manifest test pins the dangling value instead of catching it
(`test/plugin-manifests.test.mjs` asserts
`qwen.contextFileName === "QWEN.md"`).

Better Harness manifests should not declare files they do not ship. The
extension's behavior is fully owned by the canonical root `skills/` directory,
which the manifest already routes through `"skills": "./skills/"`; no shipped
behavior depends on an extension-owned context file.

## Acceptance Scenarios

- AC-1: `qwen-extension.json` no longer contains a `contextFileName` field; the
  remaining fields (`name`, `version`, `displayName`, `description`, `skills`)
  are unchanged.
- AC-2: `test/plugin-manifests.test.mjs` asserts that `qwen.contextFileName`
  is `undefined`, so a future reintroduction without the shipped file is
  caught at review time.
- AC-3: `node --test test/plugin-manifests.test.mjs` passes.
- AC-4: `npm run pack:verify` passes; the packaged `qwen-extension.json` stays
  version-aligned with `package.json`.
- AC-5: With Qwen Code `0.21.1`, both local `extensions link` and Git URL
  `extensions install --ref fix/qwen-context-manifest` still discover the
  `better-harness` Skill but no longer print the missing-`QWEN.md` context
  promise before confirmation. The Git install can complete and appear in
  `extensions list` inside an isolated `QWEN_HOME` without invoking an LLM.

## Non-Goals

- No new `QWEN.md` context file. What durable context, if any, the extension
  should inject into every Qwen session is a product decision; if maintainers
  want one, adding the file plus a `files` entry and an existence test is a
  separate change.
- No change to the Qwen configured-asset provider or session analyzer; the
  workspace-level `QWEN.md` inventory in
  `scripts/agent-customize/providers/qwen.mjs` reads the user's repository,
  not this extension manifest, and stays as is.
- No change to the other host manifests.

## Plan

1. Remove the `contextFileName` line from `qwen-extension.json`.
2. Update the Qwen manifest assertion in `test/plugin-manifests.test.mjs` to
   require the field to be absent.
3. Compare current upstream and the fix with Qwen Code `0.21.1` using isolated
   homes, covering local link, Git URL install/ref selection, Skill discovery,
   and installed-extension listing without starting a model session.

## Test Evidence

- `node --test test/plugin-manifests.test.mjs`
- `npm run pack:verify`
- `QWEN_HOME=<isolated-base> qwen extensions link <current-upstream-path>`
- `QWEN_HOME=<isolated-base-install> qwen extensions install
  https://github.com/QoderAI/better-harness.git`
- `QWEN_HOME=<isolated-fix> qwen extensions link <fixed-worktree-path>`
- `QWEN_HOME=<isolated-fix-install> qwen extensions install
  https://github.com/KDB-Wind/better-harness.git --ref
  fix/qwen-context-manifest --consent`
- `QWEN_HOME=<isolated-fix-install> qwen extensions list`

The isolated native-host checks do not open a chat or call an LLM. The
upstream link/install prompts include the dangling context message; the fixed
link/install prompts omit it while retaining the Skill declaration. The
completed fixed install is confined to the temporary `QWEN_HOME`.

Observed on 2026-07-30 after refreshing onto
`main@30047662936e996b433f1d0ee0bcb582c0b839f0`:

- Qwen Code `0.21.1` produced the expected upstream/fixed prompt difference;
  the fixed Git-ref install completed and `extensions list` reported version
  `0.3.0`, the fork source, the requested ref, and the `better-harness` Skill.
- `node --test test/plugin-manifests.test.mjs
  test/doc-link-graph.test.mjs` passed 9/9.
- `npm run pack:verify` passed with 319 npm entries and 343 runtime ZIP
  entries.
- `npm test` reported 881 tests: 876 passed, 2 failed, and 3 skipped. The
  unmodified current-upstream worktree produced the same two failures: an
  environment-provided ancestor `CLAUDE.md`, and a Windows Git-failure fixture
  that returned zero instead of the expected nonzero status.
