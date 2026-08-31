# Unbreak the DSH native smoke install against floating cordis peers

## Traceability

- Spec ID: dsh-native-smoke-cordis-peer-floor
- Status: Implemented

## Intent

Restore the two DeepSeek Harness native smoke steps, which fail during `npm
install` before any assertion runs. Both steps pin `@deepseek-ai/cordis`
exactly while leaving the sibling `@deepseek-ai/cordis-plugin-*` peers to float,
so an upstream sibling release that raises its cordis floor breaks the install
on every branch at once.

## Acceptance Scenarios

- AC-1: `npm run test:dsh-native` and
  `npm run test:dsh-configured-assets-native` resolve their unlockfiled owner
  install and reach their existing pass output.
- AC-2: The DSH owner packages stay pinned at `DSH_NATIVE_VERSION`, and the
  existing per-package version assertion still guards them, so the fix does not
  widen what the smoke steps accept.
- AC-3: Each pin records why it must track the highest cordis floor the floating
  sibling peers declare, so the next sibling release is diagnosed as a peer-floor
  bump rather than a smoke-test regression.

## Non-goals

- Adding a lockfile, offline cache, or `--legacy-peer-deps` escape to the smoke
  installs. Resolving against the live registry is the contract these steps
  verify.
- Pinning the whole cordis plugin family. That is the durable fix but changes
  what the smoke steps observe, so it needs its own decision.
- Changing DSH adapter behavior, asset baselines, or session evidence.

## Plan and Tasks

1. Raise the `@deepseek-ai/cordis` pin from `4.0.1` to `4.0.2` in
   `scripts/dsh-skill-discovery/native-smoke.mjs` and
   `scripts/dsh-configured-assets/native-smoke.mjs`.
2. Comment both pins with the peer-floor coupling that makes them fragile.
3. Verify both smoke steps end to end, and verify the failure is causal by
   resolving the same specs at the old and new pin.

## Test and Review Evidence

- Root cause: `@deepseek-ai/cordis-plugin-group@1.0.2` was published
  2026-08-30T13:13:18Z with peer `@deepseek-ai/cordis@^4.0.2`. It reaches the
  smoke install as a floating peer of `@deepseek-ai/dsh-app-boot@0.1.1-rc.2`
  (`^1.0.1`), which conflicts with the exact `4.0.1` pin. The last green `main`
  CI run predates that publish by about nine hours, so the break is upstream
  drift rather than a repository change.
- AC-1: `npm run test:dsh-native` reports `"discovery": "verified"`, and
  `npm run test:dsh-configured-assets-native` reports
  `{"phase":"native-dsh","status":"pass"}` plus
  `{"phase":"better-harness-comparison","status":"pass"}` with exit code 0 on
  local darwin.
- Causality: a dry-run resolve of `@deepseek-ai/cordis@4.0.1` with
  `@deepseek-ai/dsh-app-boot@0.1.1-rc.2` fails `ERESOLVE`; the same resolve at
  `4.0.2` adds 19 packages, selecting cordis 4.0.2 and
  cordis-plugin-group 1.0.2.
- AC-2: `DSH_NATIVE_VERSION` and `DSH_NATIVE_SOURCE_SHA` are unchanged, and the
  smoke output still reports `"dshVersion":"0.1.1-rc.2"` and the pinned source
  SHA.
- Risk: this only moves the floor to today's sibling requirement. Any future
  `cordis-plugin-*` release that raises the floor again will fail the same way,
  on every open branch, before tests run. Treat a sudden repository-wide red at
  the `test:dsh-*` steps as a peer-floor bump first.
