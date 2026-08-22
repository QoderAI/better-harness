# Verified DeepSeek Harness Skill Discovery

## Traceability

- Spec ID: deepseek-harness-skill-discovery
- Story: #99
- Status: Draft

## Intent

[Issue #99](https://github.com/QoderAI/better-harness/issues/99) advances
DeepSeek Harness (DSH) by one bounded maturity step:

```text
Partial adapter -> Verified install/discovery -> Public Quickstart
                    ^ Story #99 stops here
```

Better Harness already supports DSH `sessionAnalysis` under Story #93. DSH has
no Better Harness-supported, verified native route for loading the canonical
Better Harness Skill. This Story defines that route and its trust and invocation
contract. It does not add the complete report loop or full host support.

The user outcome is:

> A DSH user can configure one documented DSH-native discovery route, have DSH
> load the canonical Better Harness Skill from the complete Better Harness
> root, explicitly invoke `/better-harness`, and Better Harness can verify that
> the winning Skill is canonical and unavailable for model-initiated
> invocation.

### Native contract evidence

The qualified npm prerelease is `@deepseek-ai/dsh@0.1.1-rc.2`; its tag and
current `master` both resolve to
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. The audited owners are
byte-identical to the prior `dsh-v0.1.1-rc.1` audit at
`528c682e061696f5a160f363f236ecbf53cbd006`. Support remains pinned to these
source-owned contracts:

1. [`FileSystemSkillProvider`, root ranking, `customSkillDirs`, path resolution, and `resourceBase`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/skill/skill-filesystem/src/index.ts)
2. [Skill registry identity and winning-candidate behavior](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/skill/skill/src/index.ts)
3. [Slash injection and the model-facing Skill tool](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/skill/tool-skill/src/index.ts)
4. [Base/headless Skill composition](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/bundle/base/cordis.patch.yml)
5. [Web host composition and preset-owned Skill rows](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/bundle/web-app/cordis.patch.yml)
6. [Standard preset](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/apps/cli/config/agent-presets/standard/agent.cordis.yml), [code preset](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/apps/cli/config/agent-presets/code/agent.cordis.yml), [Cordis preset](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/apps/cli/config/agent-presets/cordis/agent.cordis.yml), and [minimal preset](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/apps/cli/config/agent-presets/minimal/agent.cordis.yml)

Later DSH releases are not implicitly qualified. Implementation must relock
these owners and update evidence if the developer-preview contract moves.

### Canonical route and runtime boundary

The sole supported route is to configure the active DSH
`skill-filesystem.customSkillDirs` with the absolute path:

```text
<BETTER_HARNESS_ROOT>/skills
```

This native route discovers `skills/better-harness/SKILL.md` with
`resourceBase` equal to `<BETTER_HARNESS_ROOT>/skills/better-harness`. Two
parents above that Skill directory is the complete Better Harness root, so its
`scripts/`, `references/`, `models/`, and `templates/` resources remain valid.
It creates no copied state and requires no symlink or junction privileges.
At the Better Harness spec baseline
`465e9bdfe4d9330a45d019ab192eac7bf1ed47ea`, the [canonical Skill
frontmatter](https://github.com/QoderAI/better-harness/blob/465e9bdfe4d9330a45d019ab192eac7bf1ed47ea/skills/better-harness/SKILL.md)
contains only `name` and `description`; its description says to invoke only
through the slash command, but those two fields alone leave both DSH invocation
surfaces enabled.

The qualified modes are:

- headless/base, through its active global `skill-filesystem` instance;
- Web with the selected `standard`, `code`, or `cordis` user preset, through
  that preset's active scoped `skill-filesystem` instance.

Web `minimal` is unsupported because its preset does not mount the required
Skill filesystem/loader. This Story does not add it. A standalone Skill copy,
a symlink/junction installation, and a project-local copied Skill are negative
controls, not canonical installation routes.

DSH resolves `customSkillDirs` through the process working directory and does
not expand `~`; therefore documentation and verification require an absolute
path. Verification must address the active instance rather than merely finding
the same configuration key in an inactive Web composition layer.

### Canonical identity and trust

Discovery of a Skill named `better-harness` is insufficient. DSH's default
precedence lets project `.dsh/skills` and `.agents/skills` candidates outrank a
custom root. A project-local same-name Skill may therefore win legitimately
under DSH rules.

Verified install/discovery requires the winning definition's source, resolved
Skill file path, and directory `resourceBase` to identify
`<BETTER_HARNESS_ROOT>/skills/better-harness` under the expected complete root.
It must also establish the two-parent root invariant and the required root
resources. A shadow, stale root, malformed candidate, or identity mismatch must
fail closed without redesigning DSH precedence.

### Explicit-only policy decision

The product outcome is fixed: a direct user `/better-harness` gesture loads and
injects the winning canonical Skill deterministically before model execution,
while DSH's model-facing Skill catalog/tool cannot invoke it.

The implementation mechanism is deliberately unspecified. Implementation must
investigate existing shared frontmatter, host-specific policy,
verifier/configuration behavior, or another existing mechanism and select the
smallest evidenced cross-host-safe option. In particular, this specification
does not prescribe adding `disable-model-invocation` to the shared Skill. Any
shared metadata or parser change must remain compatible with all affected
canonical Skill consumers and validators.

If implementation research shows that every available mechanism requires a
breaking shared Skill-contract trade-off, stop and return the decision to the
maintainer rather than weakening either invocation outcome.

## Acceptance Scenarios

### AC-1: Canonical discovery route

Exactly one supported documented route configures the absolute
`<BETTER_HARNESS_ROOT>/skills` path through the active DSH
`skill-filesystem.customSkillDirs`. Standalone copy, symlink/junction, and
project-local copy are not claimed as canonical routes.

### AC-2: Runtime boundary

The route is qualified for headless/base and for a selected Web `standard`,
`code`, or `cordis` user preset. Web `minimal` remains explicitly unsupported.

### AC-3: Native discovery smoke

A pinned, credential-free native DSH smoke discovers `better-harness` and
proves that the winning source and path are canonical, its `resourceBase` is
`<BETTER_HARNESS_ROOT>/skills/better-harness`, the two-parent root invariant
holds, and the required CLI/root resources exist.

### AC-4: Explicit invocation

A direct user `/better-harness` gesture deterministically loads and injects the
winning canonical Skill body before model execution.

### AC-5: Explicit-only invocation

DSH model-initiated Better Harness Skill invocation is unavailable while direct
user slash invocation remains available. The implementation mechanism is
intentionally unspecified.

### AC-6: Cross-host safety

If implementation changes shared canonical Skill frontmatter, metadata, or
parsing behavior, every affected current Better Harness Skill consumer,
runtime, packaging path, and validator remains compatible.

### AC-7: Shadowing and trust

A higher-precedence same-name Skill is never reported as canonical. Verification
binds the winning source, resolved path, and `resourceBase` to the expected
Better Harness root without changing DSH precedence.

### AC-8: Invalid or stale configuration

A malformed candidate, missing or stale Better Harness root, unsupported path
form, or invalid canonical identity fails or reports deterministically and
never produces a false Verified install/discovery result.

### AC-9: Cross-platform paths

The canonical setup requires no symlink privileges and validates relevant
macOS, Linux, and Windows behavior, including paths with spaces and Unicode.
Documentation requires an absolute path and states that `~` is not expanded
and relative values depend on DSH's process working directory.

### AC-10: Maturity claim

After all acceptance scenarios pass, documentation may identify DSH as
**Verified install/discovery** only for the qualified runtime/preset boundary.
Configured assets, report routing, lifecycle, the complete report workflow,
and Public Quickstart remain unclaimed.

## Non-goals

- configured-assets inventory
- evidence-bundle/report registration
- output routing
- report rendering
- full `/better-harness -> report` end-to-end support
- Public Quickstart promotion
- plugin lifecycle
- MCP/profile product support
- session-analysis changes
- new DSH persistence/schema support
- provider-backed report end-to-end testing
- Web `minimal` preset support
- DSH upstream modification
- full DSH host support
- unrelated Better Harness cleanup

These exclusions are outside this Story, not permanent product decisions.

## Plan and Tasks

1. Lock the current native DSH release, source SHA, and contract-owner evidence.
2. Add RED native discovery and verification tests where appropriate.
3. Establish the canonical active `customSkillDirs` configuration route.
4. Prove canonical winning identity, path, `resourceBase`, and root resources.
5. Prove deterministic direct-user slash injection before model execution.
6. Investigate explicit-only implementation mechanisms without assuming one.
7. Select the smallest mechanism that preserves current cross-host contracts.
8. Prove the DSH model-facing path cannot invoke Better Harness.
9. Run the affected cross-host consumer, validator, and packaging regressions.
10. Add bounded path, stale-root, malformed-candidate, and shadowing negatives.
11. Update installation documentation and the support maturity matrix.
12. Run the complete repository readiness and attribution gates.

No plan item is implemented by this specification commit.

## Test and Review Evidence

### Native credential-free proof

Pin the official DSH build and run the real filesystem provider, Skill registry,
and slash pre-step owner without a provider/API credential. The fixture must use
a complete Better Harness source checkout or npm package root. Capture bounded
assertions for discovery source/path/`resourceBase`, root resolution and required
resources, slash-body injection ordering, and absence from or rejection by the
model-facing catalog/tool. Do not substitute a Better Harness-only parser or a
mocked provider for the native ownership boundary.

### Negative and trust proof

Bounded fixtures cover a higher-precedence project-local same-name shadow,
malformed candidate, stale or missing Better Harness root, standalone-copy
negative control, symlink negative/control behavior where useful, relative
`customSkillDirs`, literal `~`, spaces, and Unicode. They exist to prevent false
verification claims, not to expand this Story into general filesystem support.

### Cross-host compatibility proof

Before choosing a shared-policy mechanism, enumerate the affected consumers
from the current repository rather than relying on a frozen host list. At spec
preparation time the shared Skill is consumed or packaged through Qoder,
Claude, Cursor, Codex, Qwen Code, GitHub Copilot, Kimi, Pi, and the generated
Antigravity artifact; current manual/inventory routes also cover Grok and
WorkBuddy. Any shared metadata or parser change must pass the applicable Skill
contract, manifest, lifecycle, packaging, artifact, and host-specific validators
for the then-current affected set. An unaffected consumer needs no invented
test, but an affected consumer may not be omitted.

### Acceptance evidence map

| Contract | Required evidence |
| --- | --- |
| AC-1, AC-2 | Configuration documentation plus active headless and selected Web preset composition proof |
| AC-3 | Pinned native filesystem-provider discovery smoke and root/resource assertions |
| AC-4, AC-5 | Native pre-step slash injection plus model catalog/tool exclusion or rejection |
| AC-6 | Then-current affected consumer, validator, and packaging regression suite |
| AC-7, AC-8 | Shadow, malformed, stale-root, copy, and unsupported-path negative fixtures |
| AC-9 | macOS/Linux/Windows path tests, including absolute, spaces, and Unicode cases |
| AC-10 | Documentation and support-matrix assertions bounded to Verified install/discovery |

### Risks

| Risk | Mitigation/test | Residual boundary |
| --- | --- | --- |
| Shared Skill metadata incompatibility | Research mechanisms first; run every affected consumer and validator gate for shared changes | Stop for maintainer direction if every mechanism is breaking |
| Wrong active DSH Web preset/config owner | Assert the selected preset's scoped `skill-filesystem` wins; document the active owner | Only standard/code/cordis are qualified |
| Same-name project-local Skill shadowing | Negative fixture verifies winning source/path/`resourceBase`, not name alone | DSH precedence is unchanged; the install is reported unverified |
| Stale absolute Better Harness root | Validate canonical Skill, two-parent root, CLI, and required root resources | Moving the root requires configuration update and re-verification |
| Cross-platform path behavior | Exercise Windows, macOS, Linux, spaces, Unicode, relative, and literal-`~` cases | Canonical documentation requires an absolute path and no symlink guarantee |
| DSH developer-preview contract churn | Pin release/SHA and relock owner files before implementation and release claims | New DSH versions require requalification |

### Documentation claim boundary

After all ACs pass, documentation may say:

> DSH has Verified install/discovery for the qualified runtime/preset boundary.

It must not say that DSH is fully supported, Public Quickstart-ready, or that
the complete `/better-harness` report workflow is supported.

Specification review must trace Story #99 through AC-1..AC-10, native evidence
ownership, canonical trust, cross-host compatibility, negative tests, risks,
non-goals, and the maturity claim. Readiness requires zero BLOCKER and zero
MUST FIX findings. Any SHOULD FIX item must be explicit and non-blocking.
