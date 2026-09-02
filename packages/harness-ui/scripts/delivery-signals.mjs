// Project the delivery-behavior signals the session analyzer already produces
// into a Dashboard-shaped, path-free summary.
//
// `buildUsageSummary` keeps token and selection accounting, but the same
// `insights` object also carries what the agent actually did: whether edits
// were followed by validation, whether Task Episodes closed, which tools and
// hooks ran, and where execution hit friction. Those answer "is the harness
// working", which no token count can. Evidence refs stay behind: they carry
// absolute session-file paths that must not travel into a rendered page.

const MAX_ROWS = 8;

function count(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function label(value) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 120) : null;
}

/** Named rows without their evidence refs. */
function namedRows(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({ name: label(entry?.name), count: count(entry?.count) }))
    .filter((entry) => entry.name !== null)
    .slice(0, MAX_ROWS);
}

/**
 * One host's delivery behavior. Returns null when the host produced no insight
 * pack at all, so a missing host stays missing instead of reading as zeros.
 */
export function projectDeliverySignals(insights) {
  const signals = insights?.keySignals;
  if (!signals) return null;
  const afterEdit = signals.validationAfterEdit ?? {};
  const episodes = insights.episodeSummary ?? {};
  const closure = episodes.closure ?? {};
  return {
    validationAfterEdit: {
      status: label(afterEdit.status) ?? "no-edit-observed",
      editCount: count(afterEdit.editCount),
      validationAfterEditCount: count(afterEdit.validationAfterEditCount),
      relevantValidationCount: count(afterEdit.relevantValidationCount),
    },
    validationCommands: namedRows(signals.validation?.commandMatches),
    episodes: {
      episodeCount: count(episodes.episodeCount),
      eligibleEpisodeCount: count(closure.eligibleEpisodeCount),
      closedEpisodeCount: count(closure.closedEpisodeCount),
      unobservedClosureCount: count(episodes.unobservedClosureCount),
    },
    // Source warnings are collection coverage, not execution friction; they are
    // already reported as warning codes and would double-count here.
    friction: namedRows(
      (Array.isArray(signals.friction) ? signals.friction : [])
        .filter((entry) => !String(entry?.name ?? "").startsWith("source-warning:")),
    ),
    topTools: namedRows(signals.topTools),
    observedHooks: namedRows(signals.topHooks),
  };
}

function sumRows(rowsByHost) {
  const totals = new Map();
  for (const rows of rowsByHost) {
    for (const row of rows) totals.set(row.name, (totals.get(row.name) ?? 0) + row.count);
  }
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_ROWS)
    .map(([name, total]) => ({ name, count: total }));
}

/**
 * Combine hosts. `status` is the strongest observation across hosts: one host
 * that validated after an edit does not erase another host that did not, so the
 * counts stay summed and the status only reports what was seen somewhere.
 */
export function aggregateDeliverySignals(rows) {
  const observed = rows.filter(Boolean);
  if (observed.length === 0) return null;

  const editCount = observed.reduce((total, row) => total + row.validationAfterEdit.editCount, 0);
  const validationAfterEditCount = observed.reduce((total, row) => total + row.validationAfterEdit.validationAfterEditCount, 0);
  const status = validationAfterEditCount > 0
    ? "validated-after-edit"
    : editCount > 0
      ? "edit-without-validation"
      : "no-edit-observed";

  return {
    validationAfterEdit: {
      status,
      editCount,
      validationAfterEditCount,
      relevantValidationCount: observed.reduce((total, row) => total + row.validationAfterEdit.relevantValidationCount, 0),
    },
    validationCommands: sumRows(observed.map((row) => row.validationCommands)),
    episodes: {
      episodeCount: observed.reduce((total, row) => total + row.episodes.episodeCount, 0),
      eligibleEpisodeCount: observed.reduce((total, row) => total + row.episodes.eligibleEpisodeCount, 0),
      closedEpisodeCount: observed.reduce((total, row) => total + row.episodes.closedEpisodeCount, 0),
      unobservedClosureCount: observed.reduce((total, row) => total + row.episodes.unobservedClosureCount, 0),
    },
    friction: sumRows(observed.map((row) => row.friction)),
    topTools: sumRows(observed.map((row) => row.topTools)),
    observedHooks: sumRows(observed.map((row) => row.observedHooks)),
  };
}
