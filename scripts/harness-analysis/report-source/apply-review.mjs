import { validateHarnessReportSource, validateReaderOverview } from "./source.mjs";
import {
  projectTaskLoopFindings,
  validateTaskLoopFindings,
} from "../task-loop-report.mjs";
import { validateHarnessReviewBinding } from "./review-packet.mjs";
import { applyEpisodeReviews, normalizeDeliveryReviews } from "./episode-review.mjs";

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateReviewedFindings(source, reviewedFindings) {
  for (const finding of rows(reviewedFindings)) {
    const id = String(finding?.id ?? "");
    const title = String(finding?.title ?? "").trim();
    if (/(?:^|[-_.])unverified(?:$|[-_.])/iu.test(id)
      || /(?:无法|未能)(?:核实|确认|验证)|\b(?:unable to|could not|cannot) verify\b/iu.test(title)) {
      throw new Error(`repositoryEvidence.findings must keep unverified evidence in the review boundary: ${id || title}`);
    }
    if (id === "session-post-edit-validation-gap") {
      throw new Error("repositoryEvidence.findings cannot use the retired generic post-edit validation gap; keep it as a session-evidence review lead until a concrete owner-backed problem is confirmed");
    }
  }
}

function mergeReviewedFindings(source, reviewedFindings) {
  const sourceFindings = rows(source?.repositoryEvidence?.findings);
  const reviewed = clone(rows(reviewedFindings));
  validateReviewedFindings(source, reviewed);
  const sourceById = new Map(sourceFindings.map((finding) => [String(finding?.id ?? ""), clone(finding)]));
  const merged = [];
  const reviewedIds = new Set();
  for (const finding of reviewed) {
    const id = String(finding?.id ?? "");
    const generated = sourceById.get(id);
    let candidate;
    if (generated?.projectionPolicy === "required") {
      candidate = generated;
    } else {
      candidate = {
        ...(generated ?? {}),
        ...finding,
      };
    }
    merged.push(candidate);
    reviewedIds.add(id);
  }
  for (const [id, finding] of sourceById) {
    if (reviewedIds.has(id)) continue;
    merged.push(finding);
  }
  return merged;
}

function mergeReviewedDiagnosticCoverage(generatedReviews, reviewedReviews) {
  const generatedById = new Map(rows(generatedReviews)
    .map((review) => [String(review?.id ?? ""), clone(review)]));
  return rows(reviewedReviews).map((review) => ({
    ...(generatedById.get(String(review?.id ?? "")) ?? {}),
    ...clone(review),
  }));
}

function requireEvidenceRows(expectedIds, suppliedRows, label) {
  const supplied = new Map(rows(suppliedRows).map((row) => [row?.id, row]));
  return expectedIds.map((id) => {
    const row = supplied.get(id);
    if (!row || row.status !== "reviewed" || typeof row.summary !== "string" || row.summary.trim() === "" || rows(row.evidenceRefs).length === 0) {
      throw new Error(`${label} requires a reviewed summary and evidenceRefs for ${id}`);
    }
    return clone(row);
  });
}

function requireScoreRows(expectedIds, suppliedRows) {
  const supplied = new Map(rows(suppliedRows).map((row) => [row?.id, row]));
  return expectedIds.map((id) => {
    const row = supplied.get(id);
    if (!row || !Number.isInteger(row.score) || !["low", "medium", "high"].includes(row.confidence)
      || typeof row.reason !== "string" || row.reason.trim() === ""
      || typeof row.readerSummary !== "string" || row.readerSummary.trim() === ""
      || rows(row.evidenceRefs).length === 0) {
      throw new Error(`scoreReview requires score, confidence, reason, readerSummary, and evidenceRefs for ${id}`);
    }
    return clone(row);
  });
}

export function applyReportSourceReview(sourceInput, reviewInput, { packet } = {}) {
  const source = clone(sourceInput);
  const review = reviewInput ?? {};
  if (packet !== undefined) {
    const bindingErrors = validateHarnessReviewBinding(source, review, packet);
    if (bindingErrors.length > 0) throw Object.assign(new Error(bindingErrors.join("; ")), { errors: bindingErrors });
  }
  const sourceEvidenceRefs = rows(review.sourceCandidate?.evidenceRefs);
  if (sourceEvidenceRefs.length === 0) throw new Error("sourceCandidate.evidenceRefs is required");
  if (review.readerOverview === undefined) throw new Error("readerOverview is required");
  const readerOverview = clone(review.readerOverview);
  const overviewErrors = validateReaderOverview(readerOverview, source.repositoryEvidence?.locale, "readerOverview");
  if (overviewErrors.length > 0) throw Object.assign(new Error(overviewErrors.join("; ")), { errors: overviewErrors });
  if (review.repositoryEvidence?.learningCaptureReview !== undefined) {
    throw new Error("repositoryEvidence.learningCaptureReview is retired; author the canonical Learning Capture reviewedChecks rows");
  }
  if (review.repositoryEvidence?.learningCaptureDiagnostics !== undefined) {
    throw new Error("repositoryEvidence.learningCaptureDiagnostics is generated and cannot be authored in review input");
  }
  if (review.repositoryEvidence?.workflowDemandDiagnostics !== undefined) {
    throw new Error("repositoryEvidence.workflowDemandDiagnostics is generated and cannot be authored in review input");
  }

  source.assessmentDecisions = rows(source.assessmentDecisions).map((decision) => {
    if (decision.kind === "source-candidate") {
      return { ...decision, status: "reviewed", evidenceRefs: clone(sourceEvidenceRefs) };
    }
    if (decision.kind === "repository-review") {
      const repositoryReview = review.repositoryReview ?? {};
      return {
        ...decision,
        status: "reviewed",
        reviewedFrameworks: requireEvidenceRows(decision.requiredFrameworks, repositoryReview.reviewedFrameworks, "repositoryReview.reviewedFrameworks"),
        reviewedChecks: requireEvidenceRows(decision.requiredChecks, repositoryReview.reviewedChecks, "repositoryReview.reviewedChecks"),
        reviewedSoftwareFluencyCapabilities: requireEvidenceRows(
          decision.requiredSoftwareFluencyCapabilities,
          repositoryReview.reviewedSoftwareFluencyCapabilities,
          "repositoryReview.reviewedSoftwareFluencyCapabilities",
        ),
      };
    }
    if (decision.kind === "score-review") {
      return {
        ...decision,
        status: "reviewed",
        dimensions: requireScoreRows(decision.dimensions.map((row) => row.id), review.scoreReview?.dimensions),
      };
    }
    return decision;
  });

  source.repositoryEvidence = {
    ...source.repositoryEvidence,
    readerOverview,
    ...(review.repositoryEvidence ? {
      ...(review.repositoryEvidence.findings !== undefined
        ? { findings: mergeReviewedFindings(source, review.repositoryEvidence.findings) }
        : {}),
      ...(review.repositoryEvidence.diagnosticCoverageReviews !== undefined
        ? {
          diagnosticCoverageReviews: mergeReviewedDiagnosticCoverage(
            source.repositoryEvidence?.diagnosticCoverageReviews,
            review.repositoryEvidence.diagnosticCoverageReviews,
          ),
        }
        : {}),
    } : {}),
  };
  if (review.episodeReviews !== undefined) applyEpisodeReviews(source, review.episodeReviews);
  const reviewedDelivery = review.deliveryReviews === undefined
    ? []
    : normalizeDeliveryReviews(source, review.deliveryReviews);
  const existingDelivery = rows(source.deliveryEvidence)
    .filter((row) => !String(row?.id ?? "").endsWith(":relevant-check"));
  const reviewedFocusedChecks = rows(source.taskEpisodes)
    .filter((episode) => episode?.closure?.status === "closed")
    .map((episode) => ({
      id: `${episode.id}:relevant-check`,
      episodeRef: episode.id,
      provider: "manual",
      kind: "validation",
      level: "relevant-focused-checks-passed",
      status: "passed",
      evidenceRefs: clone(episode.closure.evidenceRefs),
    }));
  source.deliveryEvidence = [...existingDelivery, ...reviewedFocusedChecks, ...reviewedDelivery];
  if (review.interventionLedger !== undefined) source.interventionLedger = clone(review.interventionLedger);

  const sourceErrors = validateHarnessReportSource(source);
  if (sourceErrors.length > 0) throw Object.assign(new Error(sourceErrors.join("; ")), { errors: sourceErrors });
  const projected = projectTaskLoopFindings(source);
  const projectionErrors = validateTaskLoopFindings(projected);
  if (projectionErrors.length > 0) throw Object.assign(new Error(projectionErrors.join("; ")), { errors: projectionErrors });
  return source;
}
