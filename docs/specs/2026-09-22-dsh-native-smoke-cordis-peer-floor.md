# Raise the DSH native smoke cordis pin to 4.0.3

## Traceability

- Spec ID: dsh-native-smoke-cordis-peer-floor-4-0-3
- Status: Implemented

## Intent

The two DeepSeek Harness native smoke installs pin `@deepseek-ai/cordis`
exactly and leave `@deepseek-ai/cordis-plugin-*` peers floating. A sibling
release that raises its cordis floor fails `npm install` with `ERESOLVE`
before any assertion runs. This bump follows the same contract as
[the 4.0.2 floor](2026-08-31-dsh-native-smoke-cordis-peer-floor.md).

## Acceptance Scenarios

- AC-1: `npm run test:dsh-native` and
  `npm run test:dsh-configured-assets-native` resolve their unlockfiled owner
  install and reach their existing pass output.
- AC-2: The DSH owner packages stay pinned at `DSH_NATIVE_VERSION`
  (`0.1.1-rc.2`). Only the cordis pin moves, from `4.0.2` to `4.0.3`.
- AC-3: Both pins still explain that they must stay at or above the highest
  cordis floor the floating sibling peers declare.

## Non-goals

- Adding a lockfile, offline cache, or `--legacy-peer-deps` escape.
- Pinning the cordis plugin family.
- Changing DSH adapter behavior, asset baselines, or session evidence.

## Plan and Tasks

1. Raise the `@deepseek-ai/cordis` pin from `4.0.2` to `4.0.3` in
   `scripts/dsh-skill-discovery/native-smoke.mjs` and
   `scripts/dsh-configured-assets/native-smoke.mjs`.
2. Confirm a dry resolve at `4.0.2` still fails and the same specs at `4.0.3`
   install, then run both smoke steps.

## Test and Review Evidence

- Root cause: `@deepseek-ai/cordis-plugin-group@1.0.3` was published
  2026-09-22T03:46:30Z with peer `@deepseek-ai/cordis@^4.0.3`. The same floor
  is declared by the current loader, hmr, include, timer, and logger-console
  releases. `@deepseek-ai/dsh-app-boot@0.1.1-rc.2` floats
  `cordis-plugin-group@^1.0.1`, so the exact `4.0.2` pin conflicts.
- Causality: a prefix install of `@deepseek-ai/cordis@4.0.2` with
  `@deepseek-ai/dsh-app-boot@0.1.1-rc.2` fails `ERESOLVE`. The same install at
  `4.0.3` adds 19 packages and selects cordis 4.0.3 with
  cordis-plugin-group 1.0.3.
- AC-1: `npm run test:dsh-native` reports `"discovery": "verified"` and
  `"dshVersion": "0.1.1-rc.2"`. `npm run test:dsh-configured-assets-native`
  reports `{"phase":"native-dsh","status":"pass"}` and
  `{"phase":"better-harness-comparison","status":"pass"}` with exit code 0
  on local darwin.
- AC-2: `DSH_NATIVE_VERSION` and `DSH_NATIVE_SOURCE_SHA` are unchanged.
- Risk: the next sibling release that raises the cordis floor fails the same
  install, on every open branch, before assertions run.
