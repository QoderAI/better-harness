# Example: Frontend Web Specification

Scope shape: a bulk review queue inside an internal operations console. Most risk
sits in the surface section, because the state machine and the disabled, loading,
and partial-failure states *are* the behavior. Section 2 is a contract this
surface consumes but does not own.

Values here are illustrative. Reuse the structure, not the names.

## 1. Requirement Overview

**Background.** Reviewers currently open one flagged submission per browser tab
and act on it individually. A reviewer handling 200 items a day spends most of the
time on navigation, and there is no way to see that two reviewers are working the
same item.

**In scope.** A queue view with server-side filtering, multi-select, a bulk
approve and bulk reject action, per-item outcome reporting for partial failures,
and a soft lock that shows when another reviewer holds an item.

**Out of scope.** The review policy itself, the flagging model, reviewer
permissions administration, and any change to the submission data model.

**Roles.** `Reviewer` acts on items. `Review Lead` additionally reassigns and
overrides a lock. `Auditor` has read-only access to the queue and outcomes.

**Glossary.**

- *Queue Item*: one flagged submission in a reviewable state.
- *Selection*: the reviewer's current multi-select set, scoped to the current
  filter and never spanning pages.
- *Soft Lock*: an advisory claim held by a reviewer, with a server-side expiry. It
  warns; it does not block a `Review Lead`.
- *Bulk Outcome*: the per-item result set returned by one bulk action, in which
  items may individually succeed or fail.

## 2. Consumed Interface Contract

This surface owns no tables. It records what it needs and who owns it.

**Owner.** Submission Review Service.

`GET /v1/review-queue?status&flagType&assignee&cursor&limit` returns
`{ items: QueueItem[], nextCursor: string | null, totalApprox: number }`.

`QueueItem` fields consumed:

| Field | Type | Null | Note |
| --- | --- | --- | --- |
| `id` | string | no | stable, used as the selection key |
| `flagType` | enum | no | `SPAM`, `ABUSE`, `QUALITY`, `LEGAL` |
| `submittedAt` | ISO 8601 | no | rendered in reviewer-local time |
| `priority` | int | no | 1 highest, 5 lowest |
| `lockedBy` | string | yes | reviewer display name, null when free |
| `lockExpiresAt` | ISO 8601 | yes | null when `lockedBy` is null |
| `version` | int | no | echoed back on every action |

`POST /v1/review-queue/actions` accepts
`{ action: 'APPROVE' | 'REJECT', items: [{ id, version }], reasonCode? }` and
returns `{ results: [{ id, status: 'OK' | 'FAILED', errorCode? }] }`. The
endpoint is partial-success by design: HTTP 200 with per-item failures is the
normal case, not an error.

`totalApprox` is explicitly approximate. The surface must never render it as an
exact count or use it for pagination arithmetic.

**Fields deliberately not consumed.** Full submission body, reporter identity, and
internal risk score. The queue shows enough to triage; opening an item is a
separate route.

## 3. Surface Specification: Operations Console

**Skeleton.**

Queue page = filter bar + selection toolbar + virtualized item table + outcome
drawer. The item detail route is a separate page and out of scope here.

**Component granularity.**

- *Filter bar* owns filter state and writes it to the URL. It is the single source
  of truth for the current query.
- *Item table* owns row rendering and virtualization only. It receives the
  selection set and emits selection intents; it holds no selection state itself.
- *Selection toolbar* owns the selection set, the bulk action buttons, and the
  confirmation dialog.
- *Outcome drawer* owns bulk result presentation and retry of failed items only.

A component never reaches across this boundary. The table cannot clear the
selection; it asks the toolbar to.

**View state machine.**

`Idle -> Loading` on mount or any filter change.
`Loading -> Ready` on a successful page fetch.
`Loading -> Error` on fetch failure, with a retry that returns to `Loading`.
`Ready -> Empty` when the filter yields zero items.
`Ready -> Submitting` on bulk action confirmation. The table becomes read-only.
`Submitting -> Reviewing Outcome` once results return, whether or not all items
succeeded.
`Reviewing Outcome -> Loading` when the drawer is dismissed, which re-fetches.

`Loading` and `Submitting` are distinct: `Loading` shows a skeleton table,
`Submitting` keeps the current rows visible and disables interaction. Collapsing
them into one boolean loses the fact that a reviewer must still see what they
just acted on.

**Actions and guards.**

| Action | Role | Disabled when |
| --- | --- | --- |
| Select row | Reviewer, Review Lead | state is `Submitting` |
| Select all on page | Reviewer, Review Lead | state is not `Ready` |
| Bulk approve | Reviewer, Review Lead | selection empty, or state is `Submitting` |
| Bulk reject | Reviewer, Review Lead | selection empty, or no reason code chosen |
| Override lock | Review Lead only | item is unlocked |
| Retry failed | Reviewer, Review Lead | no `FAILED` result in the drawer |

`Auditor` sees the table with every action control absent, not present-but-disabled.

**Interaction constraints.**

- Filter state lives in the URL so a queue view is shareable and survives reload.
- Changing any filter clears the selection. A selection that outlives its filter
  can act on rows the reviewer can no longer see.
- The selection never spans pages, and the toolbar states the selected count
  explicitly.
- Row height is fixed to keep virtualization stable; content that would wrap is
  truncated with the full value available on hover.
- Every destructive bulk action requires a confirmation naming the exact count.

## 4. Business Rules

- **BR-01.** The selection is scoped to the current filter and current page.
  Any filter change clears it.
- **BR-02.** Bulk reject requires a reason code before the action is enabled.
  Bulk approve requires none.
- **BR-03.** An item held by another reviewer's unexpired Soft Lock is selectable
  but renders a lock badge, and a `Reviewer` submitting it expects it may fail.
- **BR-04.** A `Review Lead` may override an unexpired lock. The override is
  recorded with the previous holder.
- **BR-05.** Each item is submitted with the `version` the surface rendered.
  A stale version fails that item without affecting the rest of the batch.
- **BR-06.** Partial success is a normal outcome. The drawer always shows both
  the succeeded and the failed set, even when every item succeeded.
- **BR-07.** Retry from the drawer resubmits only `FAILED` items, using versions
  refreshed at retry time rather than the stale rendered ones.
- **BR-08.** Dismissing the drawer re-fetches the queue. The surface never patches
  rows locally from a bulk result, because the server may have changed adjacent
  state.
- **BR-09.** Bulk selection is capped at 100 items per action. The cap is stated
  in the toolbar before it is reached, not as an error after submission.
- **BR-10.** `totalApprox` renders with an explicit approximation affordance and
  is never used to compute page count.

## 5. Exception Scenarios

- **E-01.** Queue fetch fails. State `Error`, message "Could not load the review
  queue." with a retry action. Code `QUEUE_FETCH_FAILED`. Existing rows are
  cleared rather than left stale.
- **E-02.** Bulk action request fails entirely at transport level. State returns
  to `Ready` with the selection preserved and "No items were changed. Try again."
  Code `BULK_ACTION_UNAVAILABLE`. Preserving the selection matters: the reviewer
  must not rebuild a 100-item selection after a network blip.
- **E-03.** Item fails on stale version. Drawer row shows "Changed by someone
  else. Refreshed for retry." Code `ITEM_VERSION_CONFLICT`.
- **E-04.** Item fails on an active lock held by another reviewer. Drawer row
  shows "Locked by {name}." Code `ITEM_LOCKED`.
- **E-05.** Item no longer in a reviewable state. Drawer row shows "Already
  resolved." Code `ITEM_NOT_REVIEWABLE`. This is not presented as a reviewer error.
- **E-06.** Selection cap exceeded via select-all. Toolbar shows "Only the first
  100 items are selected." and the action stays enabled. Code
  `SELECTION_CAP_APPLIED`. The cap is applied, not the action refused.
- **E-07.** Reject submitted with no reason code, reachable only by direct API
  use. Code `REASON_CODE_REQUIRED`; the surface's own guard prevents it.
- **E-08.** Session expires mid-action. The surface routes to re-authentication
  and restores the filter from the URL, but not the selection. Code
  `SESSION_EXPIRED`. The specification states the selection is lost so nobody
  implements a false recovery.
- **E-09.** `Auditor` reaches the page. Actions are absent and no bulk endpoint is
  called. No error message is shown; read-only is a valid mode, not a failure.

## 6. Acceptance Criteria

**Reviewer**

- **AC-01** (BR-02, normal). Given three selected items, when the reviewer opens
  bulk reject, then submit stays disabled until a reason code is chosen, and the
  confirmation names three items.
- **AC-02** (BR-01, boundary). Given a selection of ten items, when the reviewer
  changes the flag type filter, then the selection is cleared and the toolbar
  actions become disabled.
- **AC-03** (BR-05, BR-06, E-03, exception). Given a batch of five where one item
  changed server-side, when the reviewer submits bulk approve, then four report
  `OK`, one reports `ITEM_VERSION_CONFLICT`, and the drawer shows both sets.
- **AC-04** (BR-07, exception). Given a drawer with two `FAILED` items, when the
  reviewer retries, then only those two are resubmitted with refreshed versions
  and the succeeded items are not touched.
- **AC-05** (BR-08, normal). Given a completed bulk action, when the reviewer
  dismisses the drawer, then the queue re-fetches and the state passes through
  `Loading` rather than patching rows in place.
- **AC-06** (BR-09, E-06, boundary). Given a filter matching 340 items, when the
  reviewer uses select-all on the page, then at most 100 are selected and the cap
  notice is visible before submission.
- **AC-07** (E-02, exception). Given a bulk submit that fails at transport level,
  when the error surfaces, then the selection is still intact and no item shows a
  changed outcome.

**Review Lead**

- **AC-08** (BR-04, normal). Given an item locked by another reviewer, when the
  lead overrides the lock, then the row updates to show the lead as holder and the
  previous holder is recorded.

**Auditor**

- **AC-09** (E-09, boundary). Given an auditor session, when the queue page
  loads, then rows render, no action control is present in the DOM, and no bulk
  endpoint is called.

**Any role**

- **AC-10** (BR-10, boundary). Given `totalApprox` of 340, when the queue
  renders, then the count carries an approximation affordance and pagination is
  driven by `nextCursor` alone.

## 7. Open Questions and Decision Record

**Open.**

- Whether the 100-item cap should be configurable per role. Owner: Review Lead
  group. Does not block BR-09, which implements a constant first.
- Keyboard shortcut set for selection and bulk actions. Owner: Design. Deferred
  out of this iteration.

**Decided.**

- Selection clears on filter change. Preserving it across filters was rejected
  because it lets a reviewer act on rows they can no longer see.
- Locks are advisory rather than blocking. Hard locking was rejected because an
  abandoned tab would strand items until expiry with no override path.
- Partial success renders as a normal outcome drawer rather than an error toast.
  A toast was rejected because it cannot carry per-item results or a retry.
- The surface re-fetches instead of patching rows from bulk results. Local
  patching was rejected because the server can change adjacent items the response
  does not mention.
