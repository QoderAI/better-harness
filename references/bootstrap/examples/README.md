# Specification Examples

These examples calibrate `../spec-structure.md` against three delivery shapes.
Read the contract first; these documents show what each required section looks
like when it is actually finished, not what to paste into a new project.

## How To Use

- Match the example whose delivery shape resembles the target, then rewrite every
  value against observed facts about that target.
- Reuse the section order, the id schemes, and the level of decision detail.
  Never reuse table names, endpoints, error codes, thresholds, or role names.
- Each example is deliberately narrow. One complete specification for a small
  scope teaches more than a broad document with open decisions.
- Where an example names a technology, the contract shape depends on it. Swap the
  technology and the section stays; swap the section and the contract breaks.

## Index

- `backend-service-spec.md`: an order settlement service with an RPC contract,
  public REST endpoints, an event enumeration, and two consuming surfaces. This
  is the multi-surface case that instantiates the surface section twice.
- `frontend-web-spec.md`: an operations console feature with a page skeleton,
  component granularity, an explicit view state machine, and interaction
  constraints over a contract it consumes but does not own.
- `mobile-app-spec.md`: a field inspection application with offline capture,
  conflict resolution on sync, runtime permissions, background work, and release
  gating across versions that cannot be forced to update.

## What Differs By Stack

The required sections never change, but their weight does:

- A backend service puts most of its risk in section 2, and its exception
  scenarios are error-code contracts other teams depend on.
- A frontend surface puts most of its risk in section 3, because the state
  machine and the disabled or loading states are the behavior. Its section 2 is a
  consumed contract, so it records the fields it needs and who owns them.
- A mobile application adds risk that the other two do not have: the client is
  stateful, the network is optional, permissions are revocable, and old versions
  keep running. Those constraints belong in named rules, not in prose.
