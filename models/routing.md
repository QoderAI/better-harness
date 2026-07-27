# Maturity Model Routing

## Built-In Route

| Route                     | Use when                                                                                                                                       | Load                                                                                         | Notes                                                                                                                                                                                                                                         |
|---------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Default Harness readiness | The user asks for `/better-harness`, readiness, a report, recurring friction, or does not name a model.                                               | [`agent-work-loop.md`](agent-work-loop.md) directly.                                         | Use `session-rich` with reviewed task evidence; otherwise use `session-limited` and lead with inspected project evidence. Combine the lead, session, and project inputs into five independently scored dimensions without a headline average. |
| Static project scan       | The user explicitly requests a repository-only/static score or invokes the quickstart static surface.                                          | [`software-fluency.md`](software-fluency.md)                                                 | Software Fluency owns that explicit static output and may also guide the independent project evidence pass. Session absence alone does not select it for `/better-harness`.                                                                          |
| Harness evidence lens     | The report needs detailed harness diagnosis, static evidence honesty, agent work-radius scoring, or F0-F4 submetric detail.                    | [`harness-engineering.md`](harness-engineering.md)                                           | Supporting evidence contract, not a second default maturity score.                                                                                                                                                                            |
| Repeated Friction Triage  | The user reports recurring errors, corrections, skipped review, setup/validation failure, permission or Hook friction, or capability-use gaps. | Harness `skills/better-harness/SKILL.md#execution-routing` first; then one or more existing owners. | A trigger router, not a score model. Repetition can trigger Software Fluency inspection, linked Agent Work Loop analysis, Customization Checkup, or owner-gated Skill Discovery; it is not scoring evidence by itself.                        |

The default model is Agent Work Loop . Session probing sets evidence richness, not model selection:
reviewed Task Episodes use `session-rich`; partial or absent behavior evidence uses `session-limited` and
keeps unavailable claims `Unobserved`. Every durable report launches the session and project passes concurrently.

The project pass may use Software Fluency's five capability questions without creating a second score model. The
lead reconciles both briefs with its neutral evidence brief and authors the retained Agent Work Loop findings
directly. `report.source.json` is only an evidence envelope, not a scoring owner.

## Case Study Route

Do not select case-study examples as active built-in models. When the user asks
for Factory-style criteria coverage, migration context, or corpus comparison,
inspect [`case-studies/factory/model/factory-readiness.md`](../case-studies/factory/model/factory-readiness.md)
as reference material and project useful criteria into the selected built-in
model.
