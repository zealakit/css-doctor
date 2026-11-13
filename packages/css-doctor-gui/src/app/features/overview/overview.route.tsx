import { Link } from "react-router-dom";

import { ReportLoaderForm } from "@/app/features/overview/report-loader-form";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  NoticeBanner,
  PageHeader,
  SeverityBadge,
} from "@/components/ui";
import { useReport } from "@/hooks/use-report";
import { useSettings } from "@/hooks/use-settings";
import { ROUTES } from "@/lib/constants";
import { formatBytes, formatScore } from "@/lib/utils/format";
import type { GuiReport } from "@shared/report-model";

export function OverviewRoute() {
  const {
    state,
    notice,
    clearNotice,
    refresh,
    reloadFromDisk,
    applyLoadedReport,
    reportLoadFailure,
    source,
    busy,
  } = useReport();
  const { settings } = useSettings();

  return (
    <section>
      <PageHeader
        title="Overview"
        description="Project health and diagnostics summary from a real CSS Doctor report."
      />

      {notice ? (
        <NoticeBanner message={notice} onDismiss={clearNotice} />
      ) : null}

      {state.status === "loading" ? (
        <LoadingState label="Loading report…" />
      ) : null}

      {state.status === "error" ? <ErrorState message={state.message} /> : null}

      {state.status === "empty" ? (
        <div className="overview-empty">
          <EmptyState
            title="No report loaded"
            description="Load a check/health/optimize/split/diff JSON file, upload from this device, or generate a check report."
          />
          <ReportLoaderForm
            onLoaded={applyLoadedReport}
            onError={reportLoadFailure}
          />
        </div>
      ) : null}

      {state.status === "ready" ? (
        <OverviewDashboard
          report={state.report}
          sourceLabel={
            settings.showFullPaths
              ? (source?.path ?? source?.label)
              : source?.label
          }
          reloadable={source?.reloadable === true}
          busy={busy}
          onRefresh={() => void refresh()}
          onReloadDisk={() => void reloadFromDisk()}
          onReplace={applyLoadedReport}
          onError={reportLoadFailure}
        />
      ) : null}

      <style>{`
        .overview-empty {
          display: grid;
          gap: 1.25rem;
        }
      `}</style>
    </section>
  );
}

type OverviewDashboardProps = {
  report: GuiReport;
  sourceLabel?: string;
  reloadable: boolean;
  busy: boolean;
  onRefresh: () => void;
  onReloadDisk: () => void;
  onReplace: Parameters<typeof ReportLoaderForm>[0]["onLoaded"];
  onError: (message: string, code?: string) => void;
};

function OverviewDashboard({
  report,
  sourceLabel,
  reloadable,
  busy,
  onRefresh,
  onReloadDisk,
  onReplace,
  onError,
}: OverviewDashboardProps) {
  const topFindings = report.diagnostics.slice(0, 5);

  return (
    <div className="overview">
      <div className="overview__actions">
        <button type="button" onClick={onRefresh} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh session"}
        </button>
        <button
          type="button"
          onClick={onReloadDisk}
          disabled={busy || !reloadable}
          title={
            reloadable
              ? "Re-read the JSON file from disk"
              : "Only file-path reports can be reloaded from disk"
          }
        >
          Reload from disk
        </button>
        <details>
          <summary>Load / generate another report</summary>
          <ReportLoaderForm onLoaded={onReplace} onError={onError} />
        </details>
      </div>

      {sourceLabel ? (
        <p className="overview__muted">
          Active source: <code>{sourceLabel}</code>
        </p>
      ) : null}

      <div className="overview__metrics">
        <MetricCard
          label="Files"
          value={report.summary ? String(report.summary.fileCount) : "—"}
          hint={
            report.summary
              ? `${report.summary.analyzedFileCount} analyzed · ${report.summary.failedFileCount} failed`
              : "Not provided by this report"
          }
        />
        <MetricCard
          label="Total CSS size"
          value={formatBytes(report.summary?.totalSizeBytes)}
        />
        <MetricCard
          label="Health score"
          value={report.health ? formatScore(report.health.overall) : "—"}
          hint={
            report.health
              ? `${report.health.grade} · ${report.health.status}`
              : "Health data not in this report"
          }
        />
        <MetricCard
          label="Diagnostics"
          value={String(report.diagnosticCounts.total)}
          hint={`${report.diagnosticCounts.error} errors · ${report.diagnosticCounts.warning} warnings · ${report.diagnosticCounts.info} info`}
        />
      </div>

      <div className="overview__grid">
        <article>
          <h2>Report metadata</h2>
          <dl>
            <div>
              <dt>Source</dt>
              <dd>
                <code>{report.source.kind}</code> / {report.source.command}
              </dd>
            </div>
            <div>
              <dt>Generated</dt>
              <dd>{report.metadata.generatedAt ?? "—"}</dd>
            </div>
            <div>
              <dt>Loaded</dt>
              <dd>{report.loadedAt}</dd>
            </div>
            <div>
              <dt>Project cwd</dt>
              <dd>
                <code>{report.metadata.cwd ?? "—"}</code>
              </dd>
            </div>
            <div>
              <dt>Patterns</dt>
              <dd>
                {report.metadata.patterns?.length
                  ? report.metadata.patterns.join(", ")
                  : "—"}
              </dd>
            </div>
          </dl>
        </article>

        <article>
          <h2>Health dimensions</h2>
          {report.health ? (
            <ul className="overview__dimensions">
              {report.health.dimensions.map((dimension) => (
                <li key={dimension.id}>
                  <span>{dimension.id}</span>
                  <strong>
                    {dimension.evaluated ? formatScore(dimension.score) : "n/a"}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="overview__muted">
              No health dimensions in this report.
            </p>
          )}
        </article>
      </div>

      <article>
        <div className="overview__findings-head">
          <h2>Recent findings</h2>
          <Link to={ROUTES.DIAGNOSTICS}>Open diagnostics</Link>
        </div>
        {topFindings.length === 0 ? (
          <p className="overview__muted">No diagnostics in this report.</p>
        ) : (
          <ul className="overview__findings">
            {topFindings.map((finding) => (
              <li key={finding.id}>
                <SeverityBadge severity={finding.severity} />
                <div>
                  <strong>{finding.code}</strong>
                  <p>{finding.message}</p>
                  {finding.filePath ? <small>{finding.filePath}</small> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

      {report.optimization ? (
        <article>
          <div className="overview__findings-head">
            <h2>Optimization snapshot</h2>
            <Link to={ROUTES.OPTIMIZATION}>Open optimization</Link>
          </div>
          <p className="overview__muted">
            Input {formatBytes(report.optimization.summary.inputBytes)} →
            emitted {formatBytes(report.optimization.summary.emittedBytesTotal)}
            ; Core eliminated{" "}
            {formatBytes(report.optimization.summary.bytesEliminated)}.
          </p>
        </article>
      ) : (
        <p className="overview__muted">
          No optimization section in this report. Load optimize/split JSON to
          populate it.
        </p>
      )}

      {report.cssAnalysis ? (
        <p className="overview__muted">
          CSS analysis available ({report.cssAnalysis.totals.selectors}{" "}
          selectors). <Link to={ROUTES.ANALYSIS}>Open analysis</Link>
        </p>
      ) : null}

      <style>{`
        .overview {
          display: grid;
          gap: 1.25rem;
        }
        .overview__actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          align-items: start;
        }
        .overview__actions button,
        .overview__actions summary {
          border: 1px solid var(--cssd-border-strong);
          background: transparent;
          color: var(--cssd-text-muted);
          border-radius: 8px;
          padding: 0.4rem 0.7rem;
          cursor: pointer;
          font: inherit;
        }
        .overview__actions button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .overview__actions details {
          flex: 1 1 100%;
        }
        .overview__metrics {
          display: grid;
          gap: 0.85rem;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        }
        .overview__grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        }
        .overview article {
          background: var(--cssd-bg-elevated);
          border: 1px solid var(--cssd-border);
          border-radius: var(--cssd-radius);
          padding: 1rem;
        }
        .overview h2 {
          margin: 0 0 0.85rem;
          font-size: 0.95rem;
        }
        .overview dl {
          margin: 0;
          display: grid;
          gap: 0.65rem;
        }
        .overview dt {
          color: var(--cssd-text-faint);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .overview dd {
          margin: 0.2rem 0 0;
          word-break: break-word;
        }
        .overview__dimensions {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.45rem;
        }
        .overview__dimensions li {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          font-size: 0.9rem;
        }
        .overview__findings-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          margin-bottom: 0.75rem;
        }
        .overview__findings-head h2 {
          margin: 0;
        }
        .overview__findings {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.75rem;
        }
        .overview__findings li {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.75rem;
          align-items: start;
        }
        .overview__findings p {
          margin: 0.2rem 0 0;
          color: var(--cssd-text-muted);
          font-size: 0.9rem;
        }
        .overview__findings small {
          color: var(--cssd-text-faint);
        }
        .overview__muted {
          margin: 0;
          color: var(--cssd-text-muted);
          font-size: 0.9rem;
        }
      `}</style>
    </div>
  );
}
