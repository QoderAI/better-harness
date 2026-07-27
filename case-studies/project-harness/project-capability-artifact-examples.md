# Project Capability Artifact Examples

Use this catalog when a finding needs one concrete `expectedArtifact` label.
Name what the user receives after the repair, not the tool used to create it.
Keep installation choices, prerequisites, alternatives, and validation detail in
`aiFixPrompt`.

| `expectedArtifact` | What the user receives | Typical examples |
|---|---|---|
| `Document` | A navigable project or architecture reference | component catalog, ownership map, architecture boundary guide |
| `Rule` | Agent-consumed project instructions | scoped `AGENTS.md` route, risk or validation guidance |
| `Skill` | A reusable multi-step workflow | environment doctor, affected validation, local MR review |
| `Hook` | A lifecycle trigger around an existing deterministic action | post-edit focused checks, Stop or pre-push guard |
| `Script` | A deterministic executable helper | cross-platform setup, doctor, reset, or focused-check script |
| `Test` | Executable proof of a behavior or constraint | smoke test, architecture test, schema compatibility check |
| `Config` | A reproducible tool, environment, pipeline, or approval configuration | mise, Dev Container, CI job, tool allowlist, merge approval settings |
| `MCP` | A configured remote-context integration | GitLab project and merge-request connection |
| `Code` | A focused runtime or product implementation | missing behavior that is not better owned by a surface above |

`Reference` maps to `Document`: reference describes the role of the material,
while the concrete artifact delivered to the user is a document. `CLI`,
`Command`, and named tools such as `glab`, Nx, or Trivy are normally detected
tools or prerequisites, not expected artifacts by themselves.
`CI Gate` and `Permission` are outcomes or control boundaries, not artifact
types. Name their concrete carrier instead: usually `Config`, `Test`, `Hook`, or
`Rule`.

## Five-stage examples

| Software Fluency stage | Likely artifact examples |
|---|---|
| Context Map | `Document`, `Rule`, `MCP` |
| Environment Readiness | `Skill`, `Script`, `Config` |
| Fast Feedback | `Skill`, `Hook`, `Script`, `Test` |
| Quality Gates | `Hook`, `Rule`, `Test`, `Config` |
| Change Safety | `MCP`, `Skill`, `Hook`, `Config`, `Rule` |

Prefer the smallest durable owner. For example, a Hook should call an existing
deterministic command; it should not reimplement test selection. A one-time CLI
access gap should not become a Skill until the workflow is repeated and stable.
