# Example: Backend Service Specification

Scope shape: a merchant settlement service. Most risk sits in the interface
contract, and two surfaces consume it. This example instantiates the surface
section twice, so it reads as eight parts.

Values here are illustrative. Reuse the structure, not the names.

## 1. Requirement Overview

**Background.** Merchant payouts are currently computed by a nightly script whose
output nobody can explain to a merchant. Support cannot answer "why is this
amount lower than last week", and disputes are resolved by manual spreadsheet.

**In scope.** Daily settlement computation for completed orders, an auditable
statement per merchant per day, an operations review and adjustment path, and
merchant-facing statement visibility.

**Out of scope.** Payment execution, tax withholding, cross-currency conversion,
and refund policy itself. Settlement consumes refund records; it does not decide
them.

**Roles.** `Merchant` reads own statements. `Operator` reviews and adjusts.
`Finance Approver` approves adjustments above a threshold. `Service Consumer` is
another internal service calling the contract.

**Glossary.**

- *Settlement Day*: a closed 24-hour window in the merchant's configured
  timezone. Orders are assigned by completion time, not creation time.
- *Statement*: the immutable computed result for one merchant and one Settlement
  Day.
- *Adjustment*: a signed correction attached to an existing Statement. It never
  edits the Statement; it appends.
- *Settled Amount*: gross order value minus platform commission minus refunds
  minus the sum of applied Adjustments.

## 2. Data Model and Interface Contract

**Table `settlement_statement`** (new)

| Column | Type | Null | Note |
| --- | --- | --- | --- |
| `id` | bigint | no | primary key |
| `merchant_id` | bigint | no | unique with `settlement_day` |
| `settlement_day` | date | no | merchant-local day |
| `gross_amount` | decimal(18,4) | no | minor-unit safe |
| `commission_amount` | decimal(18,4) | no | non-negative |
| `refund_amount` | decimal(18,4) | no | non-negative |
| `settled_amount` | decimal(18,4) | no | may be negative |
| `status` | varchar(16) | no | see `StatementStatus` |
| `computed_at` | timestamp | no | UTC |
| `version` | int | no | optimistic lock |

**Table `settlement_adjustment`** (new)

| Column | Type | Null | Note |
| --- | --- | --- | --- |
| `id` | bigint | no | primary key |
| `statement_id` | bigint | no | foreign key |
| `amount` | decimal(18,4) | no | signed, non-zero |
| `reason_code` | varchar(32) | no | see `AdjustmentReason` |
| `operator_id` | bigint | no | who requested |
| `approver_id` | bigint | yes | null until approved |
| `state` | varchar(16) | no | `PENDING`, `APPROVED`, `REJECTED` |

**Enumerations.**

- `StatementStatus`: `COMPUTING`, `READY`, `UNDER_REVIEW`, `CLOSED`.
- `AdjustmentReason`: `MISSING_ORDER`, `DUPLICATE_CHARGE`, `COMMISSION_ERROR`,
  `DISPUTE_RESOLUTION`, `OTHER`. `OTHER` requires a free-text note.

**RPC contract `SettlementQueryService`** (internal, consumed by other services)

- `getStatement(merchantId, settlementDay) -> StatementView`
- `listStatements(merchantId, dayRange, pageRequest) -> Page<StatementSummary>`
- Read-only. Idempotent. No method mutates state.

**REST endpoints** (operations console and merchant app)

- `GET /v1/settlements?merchantId&from&to&status` -> paginated summaries.
- `GET /v1/settlements/{id}` -> full statement with applied adjustments.
- `POST /v1/settlements/{id}/adjustments` -> creates a `PENDING` adjustment.
  Requires an `Idempotency-Key` header.
- `POST /v1/settlements/{id}/close` -> transitions `READY` or `UNDER_REVIEW` to
  `CLOSED`.

**Emitted events.** `SettlementReadyEvent`, `SettlementAdjustedEvent`,
`SettlementClosedEvent`. Each carries `merchantId`, `settlementDay`,
`statementId`, `settledAmount`, and `version`. Consumers must tolerate redelivery
and use `version` to discard stale payloads.

## 3a. Surface Specification: Operations Console

**Skeleton.** Statement list page -> statement detail page -> adjustment drawer.

**Component granularity.** The list owns filtering and pagination only. The
detail page owns the amount breakdown and the adjustment history. The drawer owns
adjustment entry and its own validation. The drawer never mutates the detail
page's data directly; it reloads the statement on success.

**State machine (statement detail).**

`READY -> UNDER_REVIEW` when a `PENDING` adjustment exists.
`UNDER_REVIEW -> READY` when all adjustments reach `APPROVED` or `REJECTED`.
`READY -> CLOSED` on explicit close. `CLOSED` is terminal and read-only.

**Actions.** View breakdown (`Operator`, `Finance Approver`); request adjustment
(`Operator`, disabled when `CLOSED`); approve or reject adjustment
(`Finance Approver` only, and never the requesting operator); close statement
(`Finance Approver`, disabled while any adjustment is `PENDING`).

## 3b. Surface Specification: Merchant Mini-Program

**Skeleton.** Statement history list -> statement detail. Read-only throughout.

**Component granularity.** Reuses the platform list and detail shells. The amount
breakdown component is shared with the console but rendered in a merchant-facing
label set.

**State machine.** Merchants observe two states only: `Processing` (maps to
`COMPUTING` and `UNDER_REVIEW`) and `Available` (maps to `READY` and `CLOSED`).
Internal review states are never exposed.

**Interaction constraints.** No adjustment entry. Pull-to-refresh re-fetches. A
statement absent for a requested day renders an empty state, never an error.

## 4. Business Rules

- **BR-01.** A Settlement Day closes at 00:00 in the merchant's configured
  timezone; orders are assigned by completion timestamp.
- **BR-02.** Only orders in a terminal completed state enter a statement.
  In-flight orders roll into the next Settlement Day.
- **BR-03.** `settled_amount` equals gross minus commission minus refunds minus
  the sum of `APPROVED` adjustments. `PENDING` adjustments never affect it.
- **BR-04.** A refund is deducted from the Settlement Day in which the refund
  completed, not the day of the original order.
- **BR-05.** `settled_amount` may be negative. A negative statement carries to
  the next day as an opening balance and is never silently clamped to zero.
- **BR-06.** An adjustment whose absolute value exceeds the configured approval
  threshold requires a `Finance Approver` distinct from the requesting operator.
- **BR-07.** A `CLOSED` statement accepts no new adjustment. Corrections after
  close are made as a new adjustment on the current open statement.
- **BR-08.** Recomputation is idempotent for the same input set and must not
  change a `CLOSED` statement.
- **BR-09.** Adjustment creation is deduplicated by `Idempotency-Key` for 24
  hours; a repeated key returns the original adjustment rather than a second one.
- **BR-10.** Every state transition writes an audit entry with actor, before
  state, after state, and reason code.

## 5. Exception Scenarios

- **E-01.** Merchant timezone unset. Console: "Merchant timezone is not
  configured." Mini-program: statement absent, empty state. Code
  `SETTLEMENT_TZ_MISSING`. Computation is skipped, not defaulted to UTC.
- **E-02.** Order data incomplete for the window. Statement stays `COMPUTING`
  past its deadline and raises an operational alert. Code
  `SETTLEMENT_SOURCE_INCOMPLETE`. A partial statement is never published.
- **E-03.** Adjustment amount zero. Console inline error "Amount must not be
  zero." Code `ADJUSTMENT_AMOUNT_INVALID`.
- **E-04.** Approver equals requester. Console: "An adjustment must be approved
  by a different person." Code `ADJUSTMENT_SELF_APPROVAL`.
- **E-05.** Adjustment on a `CLOSED` statement. Console: "This statement is
  closed. Raise the correction on the current period." Code
  `STATEMENT_CLOSED`.
- **E-06.** Close attempted with a `PENDING` adjustment. Console: "Resolve all
  pending adjustments before closing." Code `STATEMENT_HAS_PENDING`.
- **E-07.** Concurrent adjustment on the same statement loses the optimistic
  lock. Console re-reads and re-renders, then asks the operator to resubmit. Code
  `STATEMENT_VERSION_CONFLICT`.
- **E-08.** Repeated `Idempotency-Key` with a different payload. Code
  `IDEMPOTENCY_KEY_REUSED`; the request is rejected rather than merged.
- **E-09.** Consumer receives an out-of-order event. No user-visible message; the
  consumer discards payloads with a `version` lower than the one already applied.

## 6. Acceptance Criteria

**Operator**

- **AC-01** (BR-03, normal). Given a `READY` statement with an `APPROVED`
  adjustment of `-50.00`, when the operator opens the detail page, then
  `settled_amount` reflects the deduction and the adjustment appears in history.
- **AC-02** (BR-06, E-04, exception). Given an adjustment above the threshold,
  when the requesting operator tries to approve it, then approval is refused with
  `ADJUSTMENT_SELF_APPROVAL` and the adjustment stays `PENDING`.
- **AC-03** (BR-07, E-05, exception). Given a `CLOSED` statement, when the
  operator opens the adjustment drawer, then the submit action is disabled and the
  closed-statement message is shown.
- **AC-04** (BR-09, boundary). Given an adjustment request that timed out
  client-side, when the client retries with the same `Idempotency-Key`, then
  exactly one adjustment exists and the original is returned.

**Finance Approver**

- **AC-05** (BR-06, normal). Given a `PENDING` adjustment above the threshold,
  when a different approver approves it, then the statement returns to `READY`
  and `settled_amount` is recomputed.
- **AC-06** (BR-04, E-06, exception). Given a statement with one `PENDING`
  adjustment, when the approver attempts to close it, then close is refused with
  `STATEMENT_HAS_PENDING`.

**Merchant**

- **AC-07** (BR-05, boundary). Given a Settlement Day whose refunds exceed gross
  value, when the merchant opens the statement, then a negative settled amount is
  displayed and the carry-forward note is visible.
- **AC-08** (3b constraint, normal). Given a statement in `UNDER_REVIEW`, when
  the merchant opens the history list, then it renders as `Processing` and no
  internal review state or operator identity is exposed.

**Service Consumer**

- **AC-09** (BR-08, boundary). Given a recomputation over an unchanged input set,
  when `getStatement` is called before and after, then both responses are
  byte-identical including `version`.
- **AC-10** (E-09, exception). Given a redelivered `SettlementAdjustedEvent` with
  a stale `version`, when the consumer processes it, then the payload is discarded
  and no downstream write occurs.

## 7. Open Questions and Decision Record

**Open.**

- Approval threshold value and whether it varies by merchant tier. Owner:
  Finance. Blocks BR-06 rollout configuration, not its implementation.
- Retention period for `CLOSED` statements. Owner: Legal.

**Decided.**

- Adjustments append rather than edit the statement. Rejected in-place mutation
  because it destroys the audit trail that motivated this work.
- Negative settled amounts carry forward rather than clamp. Clamping was rejected
  because it hides the discrepancy the merchant is disputing.
- Merchants see two collapsed states. Exposing `UNDER_REVIEW` was rejected
  because it invites support contact about an internal process.
