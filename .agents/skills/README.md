# Agent Skill Mirrors

`.agents/skills/` is for repo-local host skills, host wrappers, and generated
mirrors. It is not the canonical home for shared workflows; put those in root
`skills/`.

Each `.agents/skills/<skill>/` directory must include `mirror.json`:

- `host-only`: authored only for this host or repo-local agent surface.
- `wrapper`: thin wrapper around a canonical source.
- `generated-mirror`: generated copy of a canonical source; do not hand-edit.

Until the validator described in the directory-structure ADR is implemented,
review each file manually for `schemaVersion`, an allowed `mirror_type`, and
the rationale or source pointer required by that type.
