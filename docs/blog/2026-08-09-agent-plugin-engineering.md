---
slug: agent-plugin-engineering
title: "How Agent Plugins Become Engineered: Five Practices from Better Harness"
description: Writing a capability into SKILL.md is easy. Keeping it discoverable, executable, and provably better across users, projects, and hosts is an engineering problem.
date: 2026-08-09T14:10:00+08:00
authors: [qoder]
tags: [better-harness, agent-plugin, agent-skills, spec-driven, evaluation]
---

Writing a capability into a `SKILL.md` and packaging it as an Agent plugin is
not hard. The hard part comes later: once that capability is invoked over and
over by different users, in different projects, and on different Agent hosts,
how do you guarantee that it is still triggered, executed, and verified
correctly? And how do you prove that a change made it better rather than worse?

Drawing on how Better Harness is actually developed, this post walks through
five engineering practices - spec-driven behavior, context orchestration,
deterministic verification, behavioral evaluation, and the evidence loop - that
move a plugin capability from "it works when I run it" to a software asset that
is verifiable, maintainable, and safe to evolve.

<!-- truncate -->

## Prologue: starting from Agent plugins

Over the past three months, alongside designing the Canvas-based Agentic UI
system, our other ongoing investment at Qoder has been building the Agent plugin
ecosystem. From curating existing software-engineering workflow plugins in the
community to creating plugins such as Architecture Visualization and Design
Review, we have been trying to package capabilities that used to live scattered
across different roles and different tools into something an Agent can discover
and call.

In the Architecture Visualization plugin, for example, the Agent can render the
dependency relationships between architecture modules directly on Canvas and
share the result with teammates so they can understand the structure of the
system.

At the beginning, a plugin felt mostly like an extension of the Agent's
capability boundary: whatever was missing, we added a Skill, a tool, or a
workflow for it. But as the plugins grew in number and complexity, another
question surfaced:

How should these capabilities be maintained over the long run?

Building Better Harness made that question impossible to avoid. Better Harness
targets workflow analysis and continuous improvement for coding agents, and it
contains a core Skill, a large amount of JavaScript, reference material,
evaluation logic, and adapters for different Agent hosts.

Once those capabilities became part of a plugin that has to be maintained over
time, we realized the problem was no longer "how do I write a good `SKILL.md`".

### What exactly is an Agent Plugin?

> If you are already familiar with Agent Plugins and Agent Skills, skip to the
> next section.

Put simply, an Agent Plugin is the delivery and distribution boundary of a
capability, and a Skill is a unit inside it that an Agent can discover and
execute independently. A typical plugin can contain Skills, MCP servers, hooks,
and host-specific extensions at the same time:

```
my-plugin/
├── plugin.json
├── skills/
│   └── summarize/
│       ├── SKILL.md
│       ├── scripts/
│       └── references/
├── mcp.json
└── com.example.client/
    └── hooks/
```

A `SKILL.md` is not the plugin itself; it is closer to an entry point for one
capability inside it. It describes when the capability should be discovered, how
it should be executed, and which additional material and tools need to be read
next. If a Skill is just a prompt you occasionally use yourself, that
distinction hardly matters. The moment it enters a plugin and gets invoked
repeatedly by different users, projects, and hosts, it does.

### Why do plugins need engineering?

For personal use, writing down the task and the steps is usually enough. Once a
plugin is called repeatedly across users, projects, and hosts, a set of problems
that look a lot like software engineering appear on their own:

- **Behavioral contract: how is it supposed to work?** Which situations should
  trigger it and which should not; what context does it need, which tools may it
  call, and which behaviors are forbidden?
- **Change verification: is it still correct after a change?** When a Skill, a
  script, or a reference document changes, how do you confirm that the existing
  capability was not broken and that a fixed problem does not come back?
- **Environment compatibility: does it still work elsewhere?** When the model,
  the Agent, the host, or the runtime changes, can the capability still be
  discovered, loaded, and executed correctly?
- **Outcome assessment: did it actually make the Agent better?** Even if the
  Skill is triggered correctly and executed fully, how do you show that it
  improved the result of a real task compared with not using it?

None of these are solved by "writing a more detailed prompt". They map onto very
familiar software-engineering problems: defining contracts, verifying changes,
managing compatibility, and assessing real effect. Take them further and you
land on specifications, knowledge and dependency organization, interface and
permission boundaries, automated tests, regression verification, and
cross-model, cross-host behavioral evaluation.

It was during the development of Better Harness that we gradually started to
understand Skills differently:

> Once a Skill leaves the personal-prompt stage and enters a plugin ecosystem,
> the problems it faces look increasingly like software, not prompting.

The five engineering practices below follow from that shift.

## 1. Spec-driven: write Agent behavior as a verifiable contract

Spec-driven development is the part we started practicing earliest in Better
Harness. The core idea is to write down "when to act, what to do, and how well
it must be done" as a verifiable contract before implementation.

Our [`AGENTS.md`](https://github.com/QoderAI/better-harness/blob/main/AGENTS.md)
states it directly:

> For non-trivial behavior changes to Skills, scripts, templates, host adapters,
> or review workflows, establish a spec and traceable acceptance criteria first.

A spec has to answer at least a few questions: which requests should trigger the
capability and which similar-sounding requests should not; what information must
be read and which tools may be called; which behaviors are explicitly
forbidden; whether the Agent should stop, degrade, or hand back to a human when
evidence is insufficient; and finally, what evidence proves the implementation
matches the intent.

Every acceptance criterion should carry a stable id such as AC-01 or AC-02, each
mapped to implementation, test, and review evidence. One of our boundary-hardening
specs, for instance, decomposes reproduced problems into AC-01 through AC-09.

Concrete examples: when the Agent scans written content, it must not echo
secrets; when analyzing one workspace, it must not quietly count sessions from
other directories; when the Git baseline cannot be established, it must stop
explicitly instead of disguising failure as "no changes". AC-09 then closes the
loop with a full test and packaging verification.

Specs themselves need review. In the
[`triangulate-spec-review`](https://github.com/QoderAI/better-harness/blob/main/.agents/skills/triangulate-spec-review/SKILL.md)
Skill, we have at least two - usually three - review Agents inspect the same
context from different angles: implementation complexity, ease of use, and
long-term evolution. A lead Agent merges duplicate findings, checks evidence, and
edits the document; the other reviewers only provide independent judgment and do
not touch files. The value of being spec-driven is exactly this: ambiguity moves
from run time to design time.

Spec-driven work has a boundary too. When acceptance criteria are written too
finely, AI tends to turn tests into word-by-word matching against the Skill text
instead of verifying real behavior, which makes the tests less stable. A spec
should constrain observable behavior, not freeze specific wording.

A spec defines how a capability should work. The next step is making sure the
Agent can actually find the knowledge that supports that behavior while it runs.

## 2. Context orchestration: make Skill knowledge arrive when it is needed

Agent Skills generally rely on progressive disclosure: knowledge should not all
enter the context at once, but unfold as the task requires.

> The host first reads `name` and `description` to complete discovery, loads the
> full `SKILL.md` only after deciding to use the Skill, and pulls finer material
> into context as the task demands. This is essentially context engineering for
> Agents: rather than pushing all knowledge into the model at once, you design
> when knowledge appears, where it enters from, and how it stays traceable.

Translated into directory structure, the entry point should stay short:

```
my-skill/
├── SKILL.md          # trigger conditions, main flow, stop conditions
├── references/       # judgment rules loaded on demand
├── scripts/          # deterministic logic that can be re-run
└── assets/           # templates and delivery skeletons
```

`SKILL.md` owns triggering, routing, and stop conditions; detailed judgment goes
into `references/`; stable executable logic goes into `scripts/`; templates and
delivery skeletons go into `assets/`.

In practice, though, we found that splitting knowledge apart is not enough: a
file existing does not mean the Agent can find it, and having been referenced
once does not mean the path still resolves after a refactor.

So we protect knowledge routing along three axes:

- **Discoverable:** bring relevant material into the Agent's knowledge path
  through explicit entry points and references in `SKILL.md`, rather than relying
  on ad-hoc search.
- **Reachable:** use
  [automated tests](https://github.com/QoderAI/better-harness/blob/main/test/doc-link-graph.test.mjs)
  to check that relative links resolve and that every document a Skill needs is
  genuinely routed from its entry point.
- **Traceable:** generate a Mermaid graph from the real Markdown references with
  a [doc-link-graph generator](https://github.com/QoderAI/better-harness/blob/main/scripts/doc-link-graph/cli.mjs),
  and verify that the generated output still matches the current reference
  relationships.

That way the Markdown references themselves are the source of truth, and the
graph is only a verifiable projection of knowledge routing. When documents move,
links break, or routing changes, a machine notices in time instead of relying on
maintainers to sync manually.

The goal of context orchestration is not to make the Agent read more, but to
make the right knowledge enter the context at the right moment through a path
that still works. Once knowledge arrives reliably, the next question is which
boundaries should be decided by a program rather than guessed by a model.

## 3. Deterministic verification: give the machine what it can decide

Not every question inside a Skill or a plugin should be handed to the model.
Keywords, regular expressions, and program checks are well suited to problems
with clear boundaries and decidable outcomes - metadata, directory structure,
broken links, data formats, deprecated names, permission declarations. What they
cannot do is prove that the Agent understood the task, and they are no substitute
for semantic quality review.

In Better Harness we hold those boundaries with three deterministic layers:

- **Lint:** check file headers, directory structure, broken links, data formats,
  and permission declarations, catching cheap and decidable problems early.
- **Unit tests:** verify deterministic logic such as scripts, parsers, and
  template transforms, so basic capabilities still hold after a change.
- **Contract tests:** verify what a command or entry point is actually allowed to
  do, including inputs and outputs, error states, artifact locations, and
  side-effect boundaries.

A representative example is how Better Harness tests the `--help` path.
[`better-harness-cli.test.mjs`](https://github.com/QoderAI/better-harness/blob/main/test/better-harness-cli.test.mjs)
does not merely check that the help text is correct; it further verifies that
running a help command must not read the workspace, write files, wait on standard
input, spawn a child process, or access the network. If any one of those side
effects occurs, the test fails.

What is really being verified here is not what the help text looks like, but what
this entry point is and is not permitted to do. That is the value of
deterministic verification: boundaries that model behavior can easily paper over
become engineering constraints that are checked automatically and regressed
continuously. In an Agent system, models are better at understanding, planning,
and trading off; deterministic programs are better at verifying, constraining,
and refusing.

> If a program can decide it, do not make the model guess. If it needs semantic
> judgment, do not force it into a string assertion.

Deterministic verification only guards decidable boundaries, though. It cannot
prove the Agent actually follows the Skill in a real task. That requires
behavioral evaluation.

## 4. Behavioral evaluation: verify the Agent really does it

A Skill existing, being discovered, being loaded, being executed, and finally
producing an improvement are five different things. Passing static checks only
says that the files and scripts have no obvious defects. Whether the Agent
chooses the Skill at the right moment, performs the key steps, and stops when
evidence is insufficient still needs behavioral evaluation.

In Better Harness we usually prepare three kinds of scenarios: positive cases
that should trigger, negative cases that should not, and boundary cases worded
similarly but with a different intent. During execution we watch four things:

- **Selection:** was it used when it should be, and not misfired when it should
  not be?
- **Context:** did it read the material it genuinely needed?
- **Execution:** did the key steps, tools, and permissions stay within the
  constraints?
- **Outcome:** can the final artifact pass independent verification?

The same scenario also needs repeated runs, because one success only proves that
this particular run worked, not that the behavior is stable.

At the host boundary, Better Harness additionally runs end-to-end verification
through the real Qoder CLI and plugin loading chain, launched from a neutral
directory:

```
python3 <skill-creator-root>/scripts/quick_validate.py <skill-dir>
qodercli --cwd <neutral-dir> --plugin-dir <plugin-root> -p "<forward-test-prompt>"
qodercli plugin validate <plugin-root>
```

Starting from a neutral directory prevents the Agent from accidentally borrowing
configuration, context, or undeclared dependencies from the current repository,
which would make "it works" look more optimistic than reality. At the same time,
whatever `qodercli` answers counts only as model-behavior evidence; whether the
run passes is still decided by deterministic evidence such as the local
validator, artifact inspection, and Git status.

Simulated cases cover exceptional and boundary situations; real host tests verify
whether the chain from plugin loading to Skill discovery, material reading, tool
invocation, and final delivery is genuinely connected. What behavioral evaluation
sets out to prove is not that the Agent has *seen* the Skill, but that the key
behaviors the Skill requires actually happened.

Proving that the Agent executed the Skill, however, is still not proof that the
Skill produced a better result. That belongs to the evidence loop.

## 5. Evidence loop: prove the Skill works before talking about self-evolution

Behavioral evaluation answers "did the Agent follow the Skill". The evidence loop
goes one step further: given the same task, does the Agent actually do better
*with* this Skill?

In Better Harness this is designed as an
[evaluation execution protocol](https://github.com/QoderAI/better-harness/blob/main/references/agent-customize/skill-eval.md).
Holding the task, model, tools, permissions, and test environment constant, we
run three arms: no Skill, current Skill version, candidate Skill version.

An evaluation looks at more than the final success rate. It also observes whether
the key steps were executed, whether verification was complete, the time and
token cost, and whether extra side effects appeared. Otherwise a Skill that looks
"better" may simply be using more permissions or more resources.

One failure mode deserves special attention: fake usage, where the Agent finds
the Skill and reads `SKILL.md` but never performs the steps it requires. Better
Harness calls this **routed-but-not-applied**.

So we keep judging along an evidence chain:

- **Does it exist?** Are the Skill and its supporting mechanisms present?
- **Can it be found?** Can a real task discover and select it?
- **Was it executed?** Did the required key steps actually happen?
- **Is it effective?** Compared with not using the Skill, did the result improve?

In the [Agent Work Loop](https://github.com/QoderAI/better-harness/blob/main/models/agent-work-loop.md)
this maps to **Present → Wired → Exercised → Outcome-supported**. There is a
single governing principle: a conclusion may only go as far as the evidence goes.

That also matches where recent Skill-evaluation research is heading. SkillsBench
focuses on the outcome difference between using and not using a Skill on the same
task; Skill Coverage further checks whether the behaviors a Skill requires really
appear in the execution trace. The former answers "did the result get better",
the latter "did the process actually happen".

Outcome improvement and process coverage are both required; neither alone is
enough. Only after that evidence chain is in place does self-evolution become
meaningful. Otherwise Trace2Skill, EvoSkill, CoEvoSkills, or SkillOpt may just
help an Agent produce more unverified Skills faster.

Skill evolution should not start from "generate more experience". It should start
from proving that this change really made the next run better.

## Conclusion

The core of Agent plugin engineering is not writing more elaborate Skills. It is
treating the capabilities inside a plugin as software assets: constrain behavior
with specs, organize knowledge with context orchestration, hold boundaries with
deterministic verification, confirm execution with behavioral evaluation, and
judge effect with controlled comparison.

When those mechanisms work together, a plugin finally moves from "it works when I
run it" to "verifiable, maintainable, and safe to evolve".

Developing Agent plugins as software also means that every change should leave
behind enough evidence to show that it got better.
