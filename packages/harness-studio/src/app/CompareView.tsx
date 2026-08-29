import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseVerdict, summarizeVerdict, type CompareSummary } from "./compare-model.js";

type LoadState =
  | { phase: "loading" }
  | { phase: "missing"; detail: string }
  | { phase: "ready"; summary: CompareSummary };

export function CompareView(): React.JSX.Element {
  const { t } = useTranslation("compare");
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
    return <p className="evidence-loading" role="status">{t("evidence.loading")}</p>;
  }
  if (state.phase === "missing") {
    return (
      <section className="evidence-empty" role="alert">
        <h1>{t("evidence.emptyTitle")}</h1>
        <p className="evidence-empty-reason">{state.detail}</p>
        <p>
          {t("evidence.emptyHintBefore")} <code>harness-compare run &lt;experiment.json&gt; --out &lt;dir&gt;</code>
          {t("evidence.emptyHintAfter")} <code>--evidence &lt;dir&gt;</code>.
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
        <header><div><small>{t("evidence.decision")}</small><h2 id="decision-summary-title">{summary.reason}</h2></div><strong className={`verdict-${summary.status}`}>{summary.status.replaceAll("_", " ")}</strong></header>
        <dl>
          <div><dt>{t("evidence.evidence")}</dt><dd className={sufficient ? "status-success" : "status-warning"}>{sufficient ? t("evidence.sufficient") : t("evidence.morePairsRequired")}</dd><small>{t("evidence.matchedSummary", { pairs: summary.evidence.pairs, minimum: summary.evidence.minimumMatchedPairs })}</small></div>
          <div><dt>{t("evidence.qualityDelta")}</dt><dd>{summary.evidence.meanScoreDelta >= 0 ? "+" : ""}{summary.evidence.meanScoreDelta}</dd><small>{t("evidence.tieSummary", { candidates: summary.evidence.candidateWins, baseline: summary.evidence.baselineWins, ties: summary.evidence.ties })}</small></div>
          <div><dt>{t("evidence.costGuardrail")}</dt><dd className={withinGuardrail ? "status-success" : "status-danger"}>{summary.evidence.costRatio === null ? (withinGuardrail ? t("evidence.noSpend") : t("evidence.unavailable")) : `${summary.evidence.costRatio.toFixed(2)}×`}</dd><small>{t("evidence.maxCost", { ratio: summary.evidence.maxCostRatio.toFixed(2) })}</small></div>
          <div><dt>{t("evidence.treatment")}</dt><dd>{summary.treatmentAxis}</dd><small>{t("evidence.singleAxis")}</small></div>
        </dl>
      </section>
      <section className="evidence-table-pane" aria-labelledby="variant-table-title">
      <header><h2 id="variant-table-title">{t("evidence.variantAggregates")}</h2><span>{t("evidence.supportingEvidence")}</span></header>
      <div className="table-scroll" role="region" aria-label={t("evidence.variantAria")} tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>{t("evidence.cols.variant")}</th>
              <th className="numeric">{t("evidence.cols.passed")}</th>
              <th className="numeric">{t("evidence.cols.passRate")}</th>
              <th className="numeric">{t("evidence.cols.meanScore")}</th>
              <th className="numeric">{t("evidence.cols.infraErrors")}</th>
              <th className="numeric">{t("evidence.cols.costUsd")}</th>
              <th className="numeric">{t("evidence.cols.costPerTrial")}</th>
              <th className="numeric">{t("evidence.cols.credits")}</th>
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
      <header><h2 id="trial-table-title">{t("evidence.trials")}</h2><span>{t("evidence.recordedRows", { count: summary.trials.length })}</span></header>
      <div className="table-scroll" role="region" aria-label={t("evidence.trialAria")} tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>{t("evidence.trialCols.variant")}</th>
              <th className="numeric">{t("evidence.trialCols.index")}</th>
              <th>{t("evidence.trialCols.harness")}</th>
              <th>{t("evidence.trialCols.profile")}</th>
              <th>{t("evidence.trialCols.outcome")}</th>
              <th className="numeric">{t("evidence.trialCols.duration")}</th>
              <th>{t("evidence.trialCols.changedFiles")}</th>
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
      <p className="evidence-manifest"><span>{t("evidence.manifest")}</span><code>{summary.manifestHash}</code></p>
    </section>
  );
}
