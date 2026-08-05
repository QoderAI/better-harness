# References

Human-readable guidance lives here when it does not need fixtures, schemas, or
runtime binding.

## Switchboard

- `session-evidence/`: bounded session collection, Task Episode diagnostics,
  reader-facing session insights, and usage-efficiency evidence.
- `project-harness/`: static project evidence, core-change inspection,
  observability, design contracts, acceptance controls, and recovery safeguards.
- `agent-customize/`: agent instructions, Skills, MCP, Memory, Hooks, Custom
  Agents, Plugins, and platform-specific asset guidance. Start with
  `agent-customize/routing.md`.
- `bootstrap/`: the 0 -> 1 move for a project with no coding-agent harness yet:
  the specification structure contract and stack-specific spec examples. Load
  this when a requirement is not yet complete enough to implement against.
- `loop-engineering/`: repeated-work and schedule-ready owner selection. Load
  this when a task may become a Skill, automation, hook, command, script,
  custom agent, MCP-backed loop, or rule.
- `tool-runtimes/`: support contracts for runtime discovery and execution
  boundaries. These are not practice domains.

Detector and signal guidance stays with its owning model, executable
capability, or skill-local contract. Promote shared prose only when two visible
workflow consumers need the same owner; do not recreate a generic detector
bucket.

## Historical Paths

- `references/coding-agent-practices/` was split by evidence owner. Use
  `session-evidence/`, `project-harness/`, or `agent-customize/`.
- `references/reliable-delivery/`, `references/ai-friendly/`,
  `references/coding-agent-observability/`, and
  `references/ai-friendly-engineering/` were folded into `project-harness/`.
- `references/coding-agent-practises/` was the historical misspelled path. Do
  not recreate it; route the document to its current evidence owner.
- `references/harness-practises/` was the historical misspelled harness path.
  Do not recreate it; use `references/project-harness/`.
- `references/harness-engineering/` was the former broad project domain. Do
  not recreate it; use
  `references/project-harness/`.
