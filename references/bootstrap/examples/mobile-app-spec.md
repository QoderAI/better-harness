# Example: Mobile App Specification

Scope shape: offline field inspection capture in a native mobile application.
This shape carries risk the other two examples do not: the client holds
authoritative state before sync, the network is optional, permissions are
revocable at any moment, background execution is bounded by the operating system,
and old app versions keep running because updates cannot be forced.

Values here are illustrative. Reuse the structure, not the names.

## 1. Requirement Overview

**Background.** Inspectors record equipment checks on paper at sites with no
usable connectivity and re-enter them the next morning. Transcription loses about
one form in twenty, and photo evidence is routinely lost because it never leaves
the personal camera roll.

**In scope.** Offline creation and editing of inspection reports, local photo
capture attached to a report, deferred sync with explicit conflict resolution,
sync status visibility, and minimum-version gating for schema-breaking changes.

**Out of scope.** Inspection scheduling, equipment master data editing, the
web-side review workflow, and any change to the server's report model beyond the
sync contract below.

**Roles.** `Inspector` creates and edits own reports on the device.
`Supervisor` additionally views a team roll-up, read-only on mobile.

**Glossary.**

- *Draft*: a report existing only in local storage, never sent to the server.
- *Pending Report*: a locally complete report queued for upload.
- *Sync Cycle*: one attempt to upload all Pending Reports and refresh assignments.
- *Conflict*: the server holds a newer revision of a report the device also
  changed since its last successful sync.
- *Local Retention Window*: how long a synced report and its photos remain on the
  device before local cleanup.

## 2. Data Model and Interface Contract

**Local store `report`** (device, SQLite)

| Column | Type | Null | Note |
| --- | --- | --- | --- |
| `local_id` | uuid | no | generated on device, primary key |
| `server_id` | string | yes | null until first successful upload |
| `assignment_id` | string | no | which scheduled check this answers |
| `state` | text | no | `DRAFT`, `PENDING`, `SYNCED`, `CONFLICT` |
| `payload` | json | no | answers, schema-versioned |
| `schema_version` | int | no | payload contract version |
| `base_revision` | int | yes | server revision this edit is based on |
| `updated_at_device` | timestamp | no | device clock, may be wrong |
| `attempt_count` | int | no | consecutive failed upload attempts |

**Local store `photo`** (device)

| Column | Type | Null | Note |
| --- | --- | --- | --- |
| `local_id` | uuid | no | primary key |
| `report_local_id` | uuid | no | owning report |
| `file_path` | text | no | app-private storage, not the shared gallery |
| `upload_state` | text | no | `PENDING`, `UPLOADED`, `FAILED` |
| `byte_size` | int | no | pre-compression size |

**Sync contract**

`POST /v1/reports/sync` accepts
`{ deviceId, appVersion, schemaVersion, reports: [{ localId, serverId?, assignmentId, payload, baseRevision? }] }`
and returns
`{ results: [{ localId, status: 'ACCEPTED' | 'CONFLICT' | 'REJECTED', serverId?, revision?, serverPayload?, errorCode? }], minSupportedAppVersion, serverSchemaVersion }`.

Photos upload separately via `POST /v1/reports/{serverId}/photos` as multipart,
one request per photo, after the owning report is `ACCEPTED`.

`GET /v1/assignments?since` returns assignments for offline pre-caching.

The response always carries `minSupportedAppVersion`, so a client learns it is
obsolete from an ordinary sync rather than needing a separate check.

## 3. Surface Specification: Mobile Application

**Skeleton.** Assignment list -> report form (multi-step) -> photo capture ->
sync status screen. A conflict resolution screen is reachable from the
assignment list and from the sync status screen.

**Component granularity.**

- *Assignment list* owns offline-first read from the local store and never blocks
  on the network.
- *Report form* owns answer state and local autosave. It writes to the local store
  on every step transition, not on final submit.
- *Photo capture* owns permission acquisition, compression, and local file
  writing. It returns a `local_id` and never holds image bytes in memory beyond
  the capture.
- *Sync engine* is not a screen. It owns queueing, retry, and conflict marking.
  No screen uploads directly.
- *Sync status screen* owns presentation of queue state and manual retry only.

**Report lifecycle state machine.**

`(none) -> DRAFT` on form start.
`DRAFT -> DRAFT` on every autosave; a draft is never lost by navigation or app
kill.
`DRAFT -> PENDING` when the inspector marks the report complete. This requires no
connectivity.
`PENDING -> SYNCED` on `ACCEPTED`, once all owned photos reach `UPLOADED`.
`PENDING -> CONFLICT` on `CONFLICT`.
`PENDING -> PENDING` on transport failure, with `attempt_count` incremented.
`CONFLICT -> PENDING` after the inspector resolves by keeping local changes.
`CONFLICT -> SYNCED` after the inspector resolves by accepting the server version.
`SYNCED` is terminal until local retention cleanup removes the row.

**Actions and guards.**

| Action | Role | Disabled when |
| --- | --- | --- |
| Start report | Inspector | assignment already has a non-`SYNCED` report |
| Mark complete | Inspector | any required answer missing |
| Capture photo | Inspector | camera permission denied, or report is `SYNCED` |
| Manual sync | Inspector, Supervisor | a Sync Cycle is already running |
| Resolve conflict | Inspector | report is not `CONFLICT` |
| View team roll-up | Supervisor only | no cached roll-up and device offline |

**Offline and connectivity constraints.**

- Every screen except the team roll-up is fully usable offline. Offline is the
  default assumption, not a degraded mode.
- The app never shows a blocking spinner for a network call an inspector did not
  initiate.
- Sync status is always visible as a persistent indicator with the Pending count.

**Platform constraints.**

- Photos are written to app-private storage, never to the shared gallery.
- Background sync uses the platform's deferred job mechanism and must assume the
  operating system may not run it for hours. It is an optimization; foreground
  sync is the guaranteed path.
- Runtime permissions may be revoked between launches, so every capture rechecks
  rather than trusting a cached grant.

## 4. Business Rules

- **BR-01.** A Draft is autosaved on every step transition and survives app
  termination, device restart, and app update.
- **BR-02.** `local_id` is generated on the device, so a report has a stable
  identity before it ever reaches the server. Upload is idempotent on `local_id`.
- **BR-03.** Marking a report complete requires no connectivity and always
  succeeds locally when required answers are present.
- **BR-04.** Reports upload in creation order. A single failing report does not
  block the rest of the queue.
- **BR-05.** A report is `SYNCED` only when the report is `ACCEPTED` *and* every
  owned photo is `UPLOADED`. A report with a failed photo stays `PENDING`.
- **BR-06.** Conflicts are resolved by the inspector, never automatically.
  Last-write-wins is not permitted, because the discarded revision is field
  evidence.
- **BR-07.** The device clock is untrusted. `updated_at_device` is diagnostic
  only; ordering and conflict decisions use `base_revision` and server revisions.
- **BR-08.** Retry uses exponential backoff with a ceiling. After the configured
  attempt ceiling the report stays `PENDING` and surfaces for manual action rather
  than retrying forever.
- **BR-09.** Camera permission is rechecked at every capture. A denied permission
  degrades to a report without photos; it never blocks report completion.
- **BR-10.** Photos are compressed before local write, and a single report's total
  photo payload is capped. The cap is stated during capture, not at sync time.
- **BR-11.** When the sync response reports `minSupportedAppVersion` above the
  running version, the app blocks new report creation, still allows upload of
  existing Pending Reports, and prompts for update. Data is never stranded by
  version gating.
- **BR-12.** A `SYNCED` report and its photos are removed from the device after
  the Local Retention Window. Nothing is deleted while any owned photo is not
  `UPLOADED`.
- **BR-13.** Local storage below the configured floor blocks new photo capture
  before it blocks report creation, since a report without photos is still useful.

## 5. Exception Scenarios

- **E-01.** No connectivity during a Sync Cycle. Sync indicator shows "Waiting
  for network. {n} reports pending." No error dialog. Code `SYNC_OFFLINE`. This is
  an expected state, not a failure.
- **E-02.** Server returns `CONFLICT`. Report shows a conflict badge and the
  assignment list surfaces "Needs your review." Code `REPORT_CONFLICT`. The local
  revision is retained in full until resolution.
- **E-03.** Server returns `REJECTED` for an invalid payload. Report shows "This
  report could not be accepted." with the server reason. Code
  `REPORT_REJECTED`. The report leaves the retry queue and awaits editing.
- **E-04.** Photo upload fails after the report is accepted. Report stays
  `PENDING` with "Photos still uploading ({k} left)." Code `PHOTO_UPLOAD_FAILED`.
- **E-05.** Camera permission denied. Capture screen shows "Photos are disabled.
  You can still complete this report." with a link to system settings. Code
  `PERMISSION_CAMERA_DENIED`.
- **E-06.** Camera permission revoked between launches while the report has
  existing photos. Existing photos are retained and still upload; new capture is
  blocked. Code `PERMISSION_CAMERA_REVOKED`.
- **E-07.** Device storage below the floor. Capture blocked with "Not enough space
  for photos. Free space or sync pending reports." Code `STORAGE_LOW`.
- **E-08.** App version below `minSupportedAppVersion`. Blocking prompt "Update
  required to create new reports." with upload of existing Pending Reports still
  running. Code `APP_VERSION_UNSUPPORTED`.
- **E-09.** Local `schema_version` older than `serverSchemaVersion` for a queued
  report. The server migrates on accept when possible; otherwise it returns
  `REJECTED` with `SCHEMA_UNSUPPORTED` and the report requires the updated app.
- **E-10.** Background job never runs before the inspector opens the app. No
  message. The foreground Sync Cycle handles the queue on launch.
- **E-11.** App terminated mid-upload. On next launch the queue resumes from
  local state; because upload is idempotent on `local_id`, no duplicate report is
  created. Code path is silent to the inspector.
- **E-12.** Device clock significantly wrong. No user-visible message; ordering
  and conflict decisions ignore the device clock per BR-07.
- **E-13.** Supervisor opens the team roll-up offline with no cached data. Empty
  state "Team view needs a connection." Code `ROLLUP_REQUIRES_NETWORK`. This is
  the one screen allowed to require connectivity.

## 6. Acceptance Criteria

**Inspector**

- **AC-01** (BR-01, normal). Given a half-completed report, when the app is force
  terminated and relaunched, then the report reopens at the last completed step
  with all answers intact.
- **AC-02** (BR-03, E-01, normal). Given airplane mode, when the inspector marks
  a report complete, then it becomes `PENDING` locally, the pending count
  increments, and no error is shown.
- **AC-03** (BR-05, E-04, boundary). Given an accepted report with three photos
  where one upload fails, when sync finishes, then the report stays `PENDING` and
  displays one photo remaining.
- **AC-04** (BR-06, E-02, exception). Given the server holds a newer revision,
  when sync returns `CONFLICT`, then the report is marked `CONFLICT`, both
  revisions are viewable, and nothing is overwritten until the inspector chooses.
- **AC-05** (BR-06, normal). Given a `CONFLICT` report, when the inspector keeps
  local changes, then the report returns to `PENDING` with a refreshed
  `base_revision` and re-uploads on the next cycle.
- **AC-06** (BR-02, E-11, boundary). Given an upload interrupted by app
  termination, when the app relaunches and syncs, then exactly one server report
  exists for that `local_id`.
- **AC-07** (BR-04, boundary). Given five Pending Reports where the second is
  `REJECTED`, when the Sync Cycle runs, then the other four reach `SYNCED` and
  only the second remains for editing.
- **AC-08** (BR-09, E-05, exception). Given camera permission denied, when the
  inspector opens capture, then the guidance is shown, and marking the report
  complete still succeeds.
- **AC-09** (BR-09, E-06, exception). Given permission revoked between launches
  with two photos already captured, when the app relaunches and syncs, then both
  existing photos upload and new capture is blocked.
- **AC-10** (BR-13, E-07, boundary). Given storage below the floor, when the
  inspector attempts capture, then capture is blocked while starting and completing
  a report without photos still works.
- **AC-11** (BR-11, E-08, boundary). Given a running version below
  `minSupportedAppVersion` with two Pending Reports, when the app syncs, then the
  update prompt blocks new report creation and both pending reports still upload.
- **AC-12** (BR-10, boundary). Given photos that would exceed the per-report cap,
  when the inspector attempts one more capture, then the cap is stated at capture
  time and no oversized payload is queued.
- **AC-13** (BR-12, normal). Given a `SYNCED` report past the Local Retention
  Window with all photos `UPLOADED`, when cleanup runs, then the report and its
  local files are removed and the server copy is untouched.

**Supervisor**

- **AC-14** (E-13, exception). Given an offline device with no cached roll-up,
  when the supervisor opens the team view, then the empty state is shown and no
  other screen becomes unusable.

## 7. Open Questions and Decision Record

**Open.**

- Local Retention Window length. Owner: Field Operations. Blocks the BR-12
  configuration value, not the cleanup implementation.
- Per-report photo cap and compression target. Owner: Field Operations with
  Platform. Blocks the BR-10 constants.
- Whether `Supervisor` roll-up should pre-cache for offline use in a later
  iteration. Owner: Product. Explicitly out of scope now per E-13.

**Decided.**

- Conflicts are resolved by a human. Last-write-wins was rejected because the
  discarded revision is field evidence that cannot be recovered.
- Report identity is generated on the device. Server-assigned ids were rejected
  because they make offline creation and idempotent retry impossible.
- The device clock is untrusted for ordering. Using it was rejected because field
  devices are routinely wrong by hours after battery replacement.
- Version gating blocks creation but never upload. Blocking both was rejected
  because it would strand completed field work on an obsolete device.
- Background sync is an optimization, not the guaranteed path. Relying on it was
  rejected because neither platform guarantees timely execution.
