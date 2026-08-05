# Specification Structure

A specification is complete when an implementer, human or agent, can build the
change without inventing a decision. This contract lists the required sections,
the id schemes that make behavior traceable, and the gates that decide whether
the document is ready for implementation.

Scope note: this describes a product requirement specification written for a
target project. It is not the convention for this repository's own change specs
under `docs/specs/`.

## Required Sections

Write these in order. Section 3 repeats once per delivery surface; every other
section appears exactly once.

1. **Requirement Overview** — business background, in-scope and out-of-scope
   statements, affected roles, and a glossary for every domain term the rest of
   the document uses.
2. **Data Model and Interface Contract** — new and changed tables with column
   types and nullability, service contracts, public endpoints with request and
   response shapes, enumerations, and message or event payloads.
3. **Surface Specification** — for each delivery surface: the page or screen
   skeleton, component granularity, the state machine of each stateful view, and
   the action list with the permission that guards each action.
4. **Business Rules** — numbered `BR-01`, `BR-02`, ... Each rule is one testable
   statement that resolves to a single implementation site.
5. **Exception Scenarios** — numbered `E-01`, `E-02`, ... Each scenario names the
   trigger, the user-visible message on each affected surface, and the backend
   error code behind it.
6. **Acceptance Criteria** — numbered `AC-01`, `AC-02`, ... grouped by role. Each
   criterion is a `Given / When / Then` triple. Coverage spans normal, exception,
   and boundary cases.
7. **Open Questions and Decision Record** — unresolved items with an owner and a
   needed-by date, plus the decisions already taken with their rejected
   alternatives.

A two-surface project such as an admin console plus a mini-program instantiates
section 3 twice and so reads as eight parts. That count belongs to the project,
not to the contract. A single-surface service reads as seven parts, and a
three-surface product reads as nine.

## Id and Traceability Rules

- Ids are stable and append-only. When a rule dies, mark it withdrawn and keep
  the number; never renumber the list, because commits, tests, and review
  comments already cite the old ids.
- Every `BR-*` resolves to one implementation site. A rule that needs three
  unrelated code paths is really three rules.
- Every `E-*` maps the surfaced message to the error code that produces it, so
  the frontend text and the backend contract cannot drift apart silently.
- Every `AC-*` references the `BR-*` or `E-*` ids it exercises. Any rule or
  exception with no referencing criterion is unverified and blocks the gate
  below.
- Numbering is per specification, not global across the project.

## Completeness Gates

Do not enter implementation while any gate fails:

- **Term gate:** every domain term used in a rule appears in the glossary.
- **Contract gate:** every field a surface displays or submits exists in section
  2 with a type, and every enumerated value is listed.
- **Rule gate:** every `BR-*` is testable, meaning a reviewer can name the input
  that makes it pass and the input that makes it fail.
- **Exception gate:** every failure path a rule implies has an `E-*` entry.
  Silent failure is a specification defect, not an implementation detail.
- **Coverage gate:** every `BR-*` and `E-*` is referenced by at least one `AC-*`,
  and the criteria include at least one boundary case.
- **Decision gate:** no open question blocks a rule that is in scope for this
  iteration. Move the blocked rule out of scope or resolve the question.

Mark anything still undecided explicitly rather than guessing. An unresolved
marker is a legitimate specification state; a plausible invented value is not.

## Anti-Patterns

- **Prose without ids.** Paragraphs describing behavior cannot be cited by a
  test, a commit, or a review comment.
- **Screenshot as spec.** An image fixes a layout but states no rule, no state
  transition, and no permission.
- **Happy path only.** Sections 5 and 6 carry most of the implementation risk;
  omitting them moves the cost into debugging.
- **Restating the schema as the rule.** A column type is a contract, not a
  business rule. `BR-*` states what the system must decide, not what it stores.
- **Copying a section from another project.** Reuse the section list; rewrite the
  content against observed facts about this target.
- **Deferring acceptance to review time.** Criteria written after the code exists
  describe the implementation instead of constraining it.

## Read Next

- Use `examples/README.md` to calibrate a concrete section against a comparable
  stack.
- Use the Bootstrap domain index for the boundaries of this domain and the
  routes onward to verification design, instruction owners, and repeated-work
  owners.
