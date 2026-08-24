# Intent correlation claim contract

Use this contract to reason over a privacy-safe evidence packet without
promoting model interpretation to source truth.

## Evidence packet

`IntentCorrelationPacketV1` has these top-level fields:

```json
{
  "kind": "IntentCorrelationPacketV1",
  "schemaVersion": 1,
  "packetDigest": "sha256:<canonical digest>",
  "workspace": { "label": "repository label" },
  "inputs": [],
  "executionSlices": [],
  "files": [],
  "changeUnits": [],
  "commits": [],
  "artifacts": [],
  "validations": [],
  "observedEdges": [],
  "allowedRefs": [],
  "limitations": []
}
```

All `FileEvidence` paths are repository-relative and all usable evidence is named in
`allowedRefs`. An `ExecutionSlice` begins with one retained user input and ends
before the next retained input in that Session. A `ChangeUnit` is either a
verified `content-changed` hunk/blob delta or an unverified `edit-targeted` tool
target. These states are not interchangeable.

Observed edges may use `contains`, `read`, `edit-targeted`, `content-changed`,
`included-in`, `produced`, `validated-by`, or `correlated-with`. Their strength
is `direct`, `observed`, or `correlated`; an analysis cannot claim stronger
support than its cited evidence. A claim must cite its subject directly or cite
an observed edge whose subject, object, or evidence refs name that subject.

## Analysis output

Return one JSON object:

```json
{
  "kind": "IntentCorrelationAnalysisV1",
  "schemaVersion": 1,
  "packetDigest": "sha256:<copied from packet>",
  "intentProposals": [
    {
      "id": "intent:proposed:<stable-slug>",
      "title": "Short user-goal phrase",
      "summary": "Bounded explanation",
      "sourceRefs": ["input:..."],
      "reviewStatus": "proposed"
    }
  ],
  "claims": [
    {
      "id": "claim:<stable-slug>",
      "subjectRef": "input:...",
      "predicate": "creates",
      "objectRef": "intent:proposed:...",
      "evidenceRefs": ["edge:..."],
      "counterEvidenceRefs": [],
      "alternatives": [],
      "evidenceStrength": "observed",
      "confidence": {
        "semanticFit": "high",
        "temporalFit": "high",
        "changeFit": "medium",
        "acceptanceFit": "low"
      },
      "reason": "Why the cited evidence supports this proposal.",
      "limitations": ["What the packet cannot establish."],
      "reviewStatus": "proposed"
    }
  ],
  "unassignedRefs": [],
  "unresolved": [
    {
      "id": "question:<stable-slug>",
      "question": "A bounded question that evidence cannot resolve.",
      "evidenceRefs": ["change:..."]
    }
  ]
}
```

Allowed input-to-Intent predicates are `creates`, `refines`, `constrains`,
`clarifies`, `resumes`, `verifies`, and `meta`. Allowed change-to-Intent
predicates are `implements`, `tests`, `documents`, `refactors`, `generated`,
`incidental`, and `preexisting`. Allowed outcome predicates are `satisfies`,
`partially-satisfies`, `conflicts`, and `unverified`.

Confidence axes use only `low`, `medium`, or `high`. Do not compute or include an
overall score. `evidenceStrength` and confidence answer different questions:
strength describes the source, while confidence describes the fit of the
interpretation.

## Review semantics

The model owns only `proposed`. A human or a separate deterministic workflow may
later record `confirmed`, `rejected`, or `superseded`, but those values are not
valid in this analysis output. It is valid, and preferable, to leave refs
unassigned when evidence is ambiguous.
