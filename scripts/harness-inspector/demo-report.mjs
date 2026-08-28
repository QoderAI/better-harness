import { parseFeatureTreeMarkdown } from "./feature-tree.mjs";
import { buildHarnessInspectorReport } from "./report-model.mjs";
import { renderHarnessInspectorHtml } from "./render-html.mjs";

export const HARNESS_INSPECTOR_DEMO_GENERATED_AT = "2026-08-13T00:00:00.000Z";

const DEMO_COMMIT_HASHES = Object.freeze({
  retryPolicy: "e330bff085ef8768e621eec86555d08f85556b12",
  recoveryEvidence: "7a76488f1400af5428d55bbfa4954064c513583b",
  failureTelemetry: "19a6111aeb86bc5ec4d114f0a6a5cc131366b205",
});

const DEMO_FEATURE_TREE = `# Feature: Checkout reliability {#checkout-reliability}
- status: active
- evidence: declared

## Story: Add bounded payment retries {#bounded-payment-retries}
- stage: implementation
- evidence: declared
- spec: docs/specs/bounded-payment-retries.md
- prompt: Add a bounded retry policy for transient payment failures.
- session: codex/demo-retry-policy
- commit: ${DEMO_COMMIT_HASHES.retryPolicy.slice(0, 7)}

## Story: Explain payment failure telemetry {#payment-failure-telemetry}
- stage: validation
- evidence: candidate
- prompt: Make checkout failure telemetry easier to review.
- session: qoder/demo-payment-telemetry

# Feature: Delivery confidence {#delivery-confidence}
- status: active
- evidence: declared

## Story: Verify checkout recovery evidence {#checkout-recovery-evidence}
- stage: validation
- evidence: declared
- prompt: Verify the retry behavior and keep the evidence reviewable.
- commit: ${DEMO_COMMIT_HASHES.recoveryEvidence.slice(0, 7)}
`;

const at = (value) => Date.parse(value);

function call(step, {
  toolName,
  operation,
  actionLabel,
  family,
  startedAt,
  durationMs,
  detail,
  filePaths = [],
  status = "observed",
}) {
  return {
    id: `demo-call-${step}`,
    step,
    toolName,
    operation,
    actionLabel,
    family,
    status,
    durationStatus: Number.isFinite(durationMs) ? "observed" : "unobserved",
    ...(Number.isFinite(durationMs) ? { durationMs } : {}),
    startedAt: at(startedAt),
    detail,
    detailKind: "redacted-input-summary",
    filePaths,
  };
}

function session({
  sessionId,
  platform,
  prompt,
  response,
  firstSeen,
  lastSeen,
  model,
  calls,
  notes,
}) {
  const files = [...new Set(calls.flatMap((item) => item.filePaths ?? []))];
  const steps = [];
  calls.forEach((item, index) => {
    if (notes[index]) steps.push({ kind: "note", text: notes[index] });
    steps.push({ kind: "tool", callStep: item.step, toolName: item.toolName });
  });
  return {
    sessionId,
    platform,
    firstSeen,
    lastSeen,
    durationMs: at(lastSeen) - at(firstSeen),
    files,
    prompts: [{ text: prompt, timestamp: firstSeen }],
    promptCount: 1,
    promptObservationCount: 1,
    userTurnCount: 1,
    retainedUserTurnCount: 1,
    assistantMessageCount: notes.length + 1,
    toolCallCount: calls.length,
    fileEditCount: calls.filter((item) => item.operation === "edit-files").length,
    models: [model],
    tokenUsage: {
      inputTokens: 2_400,
      outputTokens: 980,
      cacheReadInputTokens: 320,
      cacheCreationInputTokens: 40,
      reasoningOutputTokens: 180,
      totalTokens: 3_380,
      basis: "model-inference",
      source: "public-demo-fixture",
      coverage: "observed",
    },
    runtime: { modelProvider: platform, cliVersion: "demo", effort: "medium" },
    timestampBasis: "native-event",
    contextManifest: {
      status: "observed",
      source: "public-demo-fixture",
      rawTextOmitted: true,
      usedTokens: 2_400,
      windowTokens: 16_000,
      percentFull: 15,
      compactionCount: 1,
      layers: [{ kind: "project-instructions", itemCount: 1 }],
      categories: [{ kind: "conversation", label: "Conversation", estimatedTokens: 1_600 }],
    },
    source: "public-demo-fixture",
    toolTrace: {
      schemaVersion: 2,
      totalCalls: calls.length,
      shownCalls: calls.length,
      truncated: false,
      calls: calls.map((item) => ({
        id: `T${item.step}`,
        step: item.step,
        toolName: item.toolName,
        status: item.status,
        durationStatus: item.durationStatus,
        ...(Number.isFinite(item.durationMs)
          ? { durationMs: item.durationMs, timingSource: "transcript-pair" }
          : {}),
      })),
    },
    toolActivity: {
      kind: "NormalizedToolActivityV1",
      schemaVersion: 1,
      calls,
    },
    dialogue: {
      truncated: false,
      turns: [{
        index: 1,
        anchorId: "turn-1",
        prompt: { text: prompt, timestamp: firstSeen },
        steps,
        toolCallCount: calls.length,
        messageCount: notes.length + calls.length + 2,
        response,
        durationMs: at(lastSeen) - at(firstSeen),
        startMs: at(firstSeen),
        endMs: at(lastSeen),
      }],
    },
  };
}

function commit({ hash, subject, authoredAt, files, matches }) {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    subject,
    authorName: "Demo Contributor",
    authoredAt,
    committedAt: authoredAt,
    fileCount: files.length,
    files,
    linesAdded: files.reduce((sum, file) => sum + file.added, 0),
    linesRemoved: files.reduce((sum, file) => sum + file.removed, 0),
    matches,
  };
}

function demoSessions() {
  return [
    session({
      sessionId: "demo-retry-policy",
      platform: "codex",
      prompt: "Add a bounded retry policy for transient payment failures and verify the behavior.",
      response: "Implemented a three-attempt retry policy, added focused coverage, and recorded the resulting commit evidence.",
      firstSeen: "2026-08-11T09:00:00.000Z",
      lastSeen: "2026-08-11T09:42:00.000Z",
      model: "demo-model-a",
      notes: [
        "I located the checkout boundary and its existing failure classifications.",
        "The retry policy should remain isolated from permanent payment failures.",
        "Focused tests now cover successful recovery and exhausted attempts.",
      ],
      calls: [
        call(1, {
          toolName: "Search",
          operation: "search-repository",
          actionLabel: "Search repository",
          family: "inspect",
          startedAt: "2026-08-11T09:03:00.000Z",
          durationMs: 1_100,
          detail: "Find the checkout payment boundary and existing retry behavior",
          filePaths: ["src/payments/checkout-service.ts"],
        }),
        call(2, {
          toolName: "Read",
          operation: "read-files",
          actionLabel: "Read files",
          family: "inspect",
          startedAt: "2026-08-11T09:08:00.000Z",
          durationMs: 900,
          detail: "Inspect payment failure categories and checkout tests",
          filePaths: ["src/payments/checkout-service.ts", "test/payments/checkout-service.test.ts"],
        }),
        call(3, {
          toolName: "ApplyPatch",
          operation: "edit-files",
          actionLabel: "Edit files",
          family: "change",
          startedAt: "2026-08-11T09:17:00.000Z",
          durationMs: 2_400,
          detail: "Add the bounded retry policy and integrate it with checkout",
          filePaths: ["src/payments/retry-policy.ts", "src/payments/checkout-service.ts"],
        }),
        call(4, {
          toolName: "ApplyPatch",
          operation: "edit-files",
          actionLabel: "Edit files",
          family: "change",
          startedAt: "2026-08-11T09:26:00.000Z",
          durationMs: 1_700,
          detail: "Add retry success and exhaustion scenarios",
          filePaths: ["test/payments/retry-policy.test.ts"],
        }),
        call(5, {
          toolName: "Test",
          operation: "run-tests",
          actionLabel: "Run tests",
          family: "verify",
          startedAt: "2026-08-11T09:33:00.000Z",
          durationMs: 18_000,
          detail: "Run the focused checkout retry tests",
          filePaths: ["test/payments/retry-policy.test.ts"],
        }),
        call(6, {
          toolName: "Git",
          operation: "create-commit",
          actionLabel: "Create commit",
          family: "deliver",
          startedAt: "2026-08-11T09:39:00.000Z",
          durationMs: 1_300,
          detail: "Create the bounded retry policy commit",
          filePaths: ["src/payments/retry-policy.ts", "src/payments/checkout-service.ts", "test/payments/retry-policy.test.ts"],
        }),
      ],
    }),
    session({
      sessionId: "demo-payment-telemetry",
      platform: "qoder",
      prompt: "Make checkout failure telemetry easier to review without exposing payment details.",
      response: "Added bounded failure categories and verified that telemetry excludes customer and payment payloads.",
      firstSeen: "2026-08-12T10:10:00.000Z",
      lastSeen: "2026-08-12T10:38:00.000Z",
      model: "demo-model-b",
      notes: [
        "The existing event shape mixes operational categories with provider detail.",
        "A bounded category field keeps the event useful without retaining sensitive payloads.",
      ],
      calls: [
        call(1, {
          toolName: "Search",
          operation: "search-repository",
          actionLabel: "Search repository",
          family: "inspect",
          startedAt: "2026-08-12T10:12:00.000Z",
          durationMs: 800,
          detail: "Find checkout failure telemetry producers",
          filePaths: ["src/telemetry/checkout-events.ts"],
        }),
        call(2, {
          toolName: "Read",
          operation: "read-files",
          actionLabel: "Read files",
          family: "inspect",
          startedAt: "2026-08-12T10:16:00.000Z",
          durationMs: 700,
          detail: "Inspect event fields and privacy tests",
          filePaths: ["src/telemetry/checkout-events.ts", "test/telemetry/checkout-events.test.ts"],
        }),
        call(3, {
          toolName: "ApplyPatch",
          operation: "edit-files",
          actionLabel: "Edit files",
          family: "change",
          startedAt: "2026-08-12T10:22:00.000Z",
          durationMs: 1_900,
          detail: "Add bounded failure categories to checkout telemetry",
          filePaths: ["src/telemetry/checkout-events.ts"],
        }),
        call(4, {
          toolName: "Test",
          operation: "run-tests",
          actionLabel: "Run tests",
          family: "verify",
          startedAt: "2026-08-12T10:31:00.000Z",
          durationMs: 12_000,
          detail: "Verify telemetry categories and payload redaction",
          filePaths: ["test/telemetry/checkout-events.test.ts"],
        }),
      ],
    }),
    session({
      sessionId: "demo-release-notes",
      platform: "codex",
      prompt: "Summarize the checkout release evidence for the weekly review.",
      response: "Prepared a review summary and left the session unmapped because no Feature Tree declaration identifies its delivery owner.",
      firstSeen: "2026-08-12T13:00:00.000Z",
      lastSeen: "2026-08-12T13:14:00.000Z",
      model: "demo-model-a",
      notes: ["The summary is contextual evidence and should not be promoted to authorship proof."],
      calls: [
        call(1, {
          toolName: "Read",
          operation: "read-files",
          actionLabel: "Read files",
          family: "inspect",
          startedAt: "2026-08-12T13:02:00.000Z",
          durationMs: 600,
          detail: "Review the public checkout release notes",
          filePaths: ["docs/releases/checkout-reliability.md"],
        }),
        call(2, {
          toolName: "ApplyPatch",
          operation: "edit-files",
          actionLabel: "Edit files",
          family: "change",
          startedAt: "2026-08-12T13:08:00.000Z",
          durationMs: 1_100,
          detail: "Clarify the observed retry and telemetry evidence",
          filePaths: ["docs/releases/checkout-reliability.md"],
        }),
      ],
    }),
  ];
}

function demoCorrelation() {
  return {
    schemaVersion: 1,
    commits: [
      commit({
        hash: DEMO_COMMIT_HASHES.retryPolicy,
        subject: "feat(checkout): add bounded payment retries",
        authoredAt: "2026-08-11T09:40:00.000Z",
        files: [
          { path: "src/payments/retry-policy.ts", added: 54, removed: 0 },
          { path: "src/payments/checkout-service.ts", added: 18, removed: 4 },
          { path: "test/payments/retry-policy.test.ts", added: 72, removed: 0 },
        ],
        matches: [{
          sessionId: "demo-retry-policy",
          platform: "codex",
          confidence: "explicit",
          evidence: {
            linkType: "harness-session",
            commitObservedInCall: "A6",
            timeOverlap: true,
            overlappingFileCount: 3,
            overlappingFiles: ["src/payments/retry-policy.ts", "src/payments/checkout-service.ts", "test/payments/retry-policy.test.ts"],
            cwdWithinRepo: true,
          },
        }],
      }),
      commit({
        hash: DEMO_COMMIT_HASHES.recoveryEvidence,
        subject: "test(checkout): verify retry recovery evidence",
        authoredAt: "2026-08-12T09:30:00.000Z",
        files: [
          { path: "test/payments/retry-policy.test.ts", added: 36, removed: 5 },
          { path: "docs/verification/checkout-recovery.md", added: 28, removed: 0 },
          { path: "docs/releases/checkout-reliability.md", added: 12, removed: 2 },
        ],
        matches: [{
          sessionId: "demo-retry-policy",
          platform: "codex",
          confidence: "high",
          evidence: {
            linkType: null,
            commitObservedInCall: null,
            timeOverlap: false,
            overlappingFileCount: 1,
            overlappingFiles: ["test/payments/retry-policy.test.ts"],
            cwdWithinRepo: true,
          },
        }],
      }),
      commit({
        hash: DEMO_COMMIT_HASHES.failureTelemetry,
        subject: "feat(telemetry): classify checkout failures",
        authoredAt: "2026-08-12T10:36:00.000Z",
        files: [
          { path: "src/telemetry/checkout-events.ts", added: 31, removed: 12 },
          { path: "test/telemetry/checkout-events.test.ts", added: 44, removed: 3 },
        ],
        matches: [{
          sessionId: "demo-payment-telemetry",
          platform: "qoder",
          confidence: "high",
          evidence: {
            linkType: null,
            commitObservedInCall: null,
            timeOverlap: true,
            overlappingFileCount: 2,
            overlappingFiles: ["src/telemetry/checkout-events.ts", "test/telemetry/checkout-events.test.ts"],
            cwdWithinRepo: true,
          },
        }],
      }),
    ],
  };
}

export function buildHarnessInspectorDemoReport() {
  const report = buildHarnessInspectorReport({
    repoRoot: "/demo/atlas-checkout",
    featureTree: parseFeatureTreeMarkdown(DEMO_FEATURE_TREE, {
      source: "/demo/atlas-checkout/.better-harness/feature-tree.md",
    }),
    sessions: demoSessions(),
    correlation: demoCorrelation(),
    providers: [
      { platform: "codex", status: "ok", discovered: 2 },
      { platform: "qoder", status: "ok", discovered: 1 },
    ],
    filters: {
      platform: "codex,qoder",
      since: "2026-08-11",
      until: "2026-08-12",
      commitLimit: 3,
      sessionLimit: 3,
    },
    diagnostics: ["This deterministic public sample uses fictional English data and does not read a local workspace."],
  });
  report.generatedAt = HARNESS_INSPECTOR_DEMO_GENERATED_AT;
  return report;
}

export function renderHarnessInspectorDemoHtml() {
  return renderHarnessInspectorHtml(buildHarnessInspectorDemoReport(), {
    contextLabel: "English sample data · no live workspace access",
    robots: "noindex, follow",
    sample: true,
  });
}
