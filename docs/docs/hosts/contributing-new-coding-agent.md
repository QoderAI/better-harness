---
id: contributing-new-coding-agent
title: Contributing a Coding Agent Host
sidebar_position: 2
---

# Contributing a New Coding Agent Host

Host support is an evidence-backed set of claims, not one manifest or one
transcript parser. A contribution can support only the slices the host exposes,
as long as partial and unavailable coverage stays explicit.

The complete, canonical workflow lives in the repository:

- [New Coding Agent contribution guide](https://github.com/QoderAI/better-harness/blob/main/docs/adapters/contributing-new-coding-agent.md)
- [Repository agent instructions](https://github.com/QoderAI/better-harness/blob/main/AGENTS.md)
- [Community extension map](https://github.com/QoderAI/better-harness/blob/main/docs/community.md)
- [Architecture principles](https://github.com/QoderAI/better-harness/blob/main/docs/ARCHITECTURE.md)

## Define the support boundary first

| Slice | Required decision |
| --- | --- |
| Native contract | Host/version and primary source verified |
| Shell | Native, source-local, generated, or none |
| Configured assets | Available, partial, or unavailable scopes |
| Session evidence | Available, partial, or unavailable fields and events |
| Shared registration | Only capabilities that are actually implemented |
| Output | Existing Canvas, HTML, Markdown, or a justified new mode |
| Packaging | Public npm, runtime bundle, source-only, or none |

A shell does not establish session support, and a parser does not establish
native Skill discovery. Record each claim in a dated spec with stable acceptance
ids and an evidence route.

## Contribution workflow

1. Read the host's versioned, primary contract for manifests, paths,
   configuration precedence, workspace identity, events, and privacy boundaries.
2. Keep any host shell thin; canonical judgment remains in shared Skills,
   models, references, templates, and capability-owned scripts.
3. Add configured-asset and session adapters independently. Use sanitized
   fixtures, reject foreign-workspace evidence, and represent missing fields as
   unobserved rather than zero.
4. Propagate the host id only through registries whose capabilities exist.
   Prefer an explicit unsupported error to fallback through another host.
5. Verify focused tests, the full suite, native-host smoke paths, package
   boundaries, and Windows/macOS/Linux behavior proportional to the change.
6. Update the [adapter matrix](./adapter-matrix) and submit Story/Spec/Test/Risk
   evidence through the repository pull request template.

## Worked examples

- [PR #6 — Qwen Code](https://github.com/QoderAI/better-harness/pull/6)
  demonstrates why native source checks, environment precedence, privacy, and
  case-insensitive filesystem coverage must supplement synthetic tests.
- [PR #22 — GitHub Copilot](https://github.com/QoderAI/better-harness/pull/22)
  demonstrates spec-led separation of shell, assets, sessions, registries,
  documentation, and evidence-honesty boundaries.

Pull requests can change during review. Use them as worked examples, then defer
to the current repository instructions and canonical guide.
