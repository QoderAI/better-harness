import { useEffect, useState } from "react";
import { parseVerdict, summarizeVerdict, type CompareSummary } from "./compare-model.js";

type LoadState =
  | { phase: "loading" }
  | { phase: "missing"; detail: string }
  | { phase: "ready"; summary: CompareSummary };

export function CompareView(): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("api/evidence");
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Evidence request failed (${response.status}).`);
        }
        const summary = summarizeVerdict(parseVerdict(await response.json()));
        if (!cancelled) {
          setState({ phase: "ready", summary });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ phase: "missing", detail: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === "loading") {
    return <p className="evidence-loading" role="status">Loading compare evidence…</p>;
  }
  if (state.phase === "missing") {
    return (
      <section className="evidence-empty" role="alert">
        <h1>No compare evidence is loaded</h1>
        <p className="evidence-empty-reason">{state.detail}</p>
        <p>
          Produce a verdict with <code>harness-compare run &lt;experiment.json&gt; --out &lt;dir&gt;</code>,
          then start the studio with <code>--evidence &lt;dir&gt;</code>.
        </p>
      </section>
    );
  }
  const { summary } = state;
  const sufficient = summary.evidence.pairs >= summary.evidence.minimumMatchedPairs;
  const withinGuardrail = summary.evidence.costWithinGuardrail;
  return (
    <section className="evidence-report">
      <section className="decision-summary" aria-labelledby="decision-summary-title">
        <header><div><small>Decision</small><h2 id="decision-summary-title">{summary.reason}</h2></div><strong className={`verdict-${summary.status}`}>{summary.status.replaceAll("_", " ")}</strong></header>
        <dl>
          <div><dt>Evidence</dt><dd className={sufficient ? "status-success" : "status-warning"}>{sufficient ? "Sufficient" : "More pairs required"}</dd><small>{summary.evidence.pairs} matched · minimum {summary.evidence.minimumMatchedPairs}</small></div>
          <div><dt>Quality delta</dt><dd>{summary.evidence.meanScoreDelta >= 0 ? "+" : ""}{summary.evidence.meanScoreDelta}</dd><small>{summary.evidence.candidateWins} candidate · {summary.evidence.baselineWins} baseline · {summary.evidence.ties} tied</small></div>
          <div><dt>Cost guardrail</dt><dd className={withinGuardrail ? "status-success" : "status-danger"}>{summary.evidence.costRatio === null ? (withinGuardrail ? "No spend" : "Unavailable") : `${summary.evidence.costRatio.toFixed(2)}×`}</dd><small>Maximum {summary.evidence.maxCostRatio.toFixed(2)}× per completed trial</small></div>
          <div><dt>Treatment</dt><dd>{summary.treatmentAxis}</dd><small>Single declared comparison axis</small></div>
        </dl>
      </section>
      <section className="evidence-table-pane" aria-labelledby="variant-table-title">
      <header><h2 id="variant-table-title">Variant aggregates</h2><span>Supporting evidence</span></header>
      <div className="table-scroll" role="region" aria-label="Variant comparison" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Variant</th>
              <th className="numeric">Passed</th>
              <th className="numeric">Pass rate</th>
              <th className="numeric">Mean score</th>
              <th className="numeric">Infra errors</th>
              <th className="numeric">Cost (USD)</th>
              <th className="numeric">Cost / trial</th>
              <th className="numeric">Credits</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={row.variant}>
                <th>{row.label}</th>
                <td className="numeric">{row.passedTrials}/{row.completedTrials}</td>
                <td className="numeric">{(row.passRate * 100).toFixed(0)}%</td>
                <td className="numeric">{row.meanScore}</td>
                <td className="numeric">{row.infrastructureErrors}</td>
                <td className="numeric">{row.totalCostUsd.toFixed(4)}</td>
                <td className="numeric">{row.costPerCompletedTrialUsd.toFixed(4)}</td>
                <td className="numeric">{row.totalCredits.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </section>
      <section className="evidence-table-pane" aria-labelledby="trial-table-title">
      <header><h2 id="trial-table-title">Trials</h2><span>{summary.trials.length} recorded rows</span></header>
      <div className="table-scroll" role="region" aria-label="Trial details" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Variant</th>
              <th className="numeric">#</th>
              <th>Harness</th>
              <th>Profile</th>
              <th>Outcome</th>
              <th className="numeric">Duration</th>
              <th>Changed files</th>
            </tr>
          </thead>
          <tbody>
            {summary.trials.map((trial) => (
              <tr key={`${trial.variant}-${trial.trial}`}>
                <td>{trial.variant}</td>
                <td className="numeric">{trial.trial}</td>
                <td>{trial.harnessId}</td>
                <td>{trial.runtimeProfile}</td>
                <td className={trial.classification === "passed" ? "status-success" : trial.classification === "failed" ? "status-danger" : undefined}>{trial.classification}</td>
                <td className="numeric">{(trial.durationMs / 1000).toFixed(1)}s</td>
                <td>{trial.changedFiles.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </section>
      <p className="evidence-manifest"><span>Manifest</span><code>{summary.manifestHash}</code></p>
    </section>
  );
}
