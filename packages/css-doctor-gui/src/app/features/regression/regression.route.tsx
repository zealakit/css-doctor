import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
} from "@/components/ui";
import { useReport } from "@/hooks/use-report";
import { ROUTES } from "@/lib/constants";
import { formatBytes, formatScore } from "@/lib/utils/format";
import type { GuiDiagnosticDiffEntry } from "@shared/report-model";

type DiffTab = "overview" | "metrics" | "diagnostics" | "files";

export function RegressionRoute() {
  const { state } = useReport();
  const [tab, setTab] = useState<DiffTab>("overview");
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<
    "new" | "resolved" | "persistent" | "changed"
  >("new");

  const regression = state.status === "ready" ? state.report.regression : null;

  const diagnosticRows = useMemo(() => {
    if (!regression?.diagnostics) {
      return [];
    }
    const list = regression.diagnostics[bucket];
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return list;
    }
    return list.filter((item) =>
      [item.fingerprint, item.code, item.message, item.filePath, item.selector]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [regression, bucket, query]);

  return (
    <section>
      <PageHeader
        title="Regression"
        description="Baseline vs current comparison from css-doctor diff --json."
      />

      {state.status === "loading" ? (
        <LoadingState label="Loading regression…" />
      ) : null}
      {state.status === "error" ? <ErrorState message={state.message} /> : null}
      {state.status === "empty" ? (
        <EmptyState
          title="No report loaded"
          description="Load diff --json from Overview after creating a baseline."
        />
      ) : null}

      {state.status === "ready" && !regression ? (
        <EmptyState
          title="Regression data unavailable"
          description="This report has no diff/regression section."
        />
      ) : null}

      {state.status === "ready" && regression ? (
        <div className="reg">
          <div className="reg__metrics">
            <MetricCard
              label="Comparison"
              value={regression.comparisonStatus}
            />
            <MetricCard
              label="Core status"
              value={regression.status ?? "—"}
              hint={
                regression.status === null
                  ? "No Core status (comparison incomplete)"
                  : undefined
              }
            />
            <MetricCard
              label="Score Δ"
              value={
                regression.scoreChange === null
                  ? "—"
                  : String(regression.scoreChange)
              }
            />
            <MetricCard
              label="Baseline path"
              value={regression.baselinePath ? "set" : "—"}
              hint={regression.baselinePath}
            />
          </div>

          {regression.comparisonStatus !== "completed" ? (
            <EmptyState
              title={`Comparison: ${regression.comparisonStatus}`}
              description={
                regression.errors[0] ??
                regression.notes.join(" ") ??
                "No completed Core comparison payload."
              }
            />
          ) : null}

          {regression.comparisonStatus === "completed" ? (
            <>
              <div className="reg__tabs" role="tablist">
                {(
                  [
                    ["overview", "Overview"],
                    ["metrics", "Metrics"],
                    ["diagnostics", "Diagnostics"],
                    ["files", "Files"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    className={tab === id ? "is-active" : undefined}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "overview" &&
              regression.baseline &&
              regression.current ? (
                <div className="reg__panel">
                  {regression.status === "healthy" ? (
                    <EmptyState
                      title="No changes detected"
                      description="Core status is healthy — baseline and current fingerprints match within comparison thresholds."
                    />
                  ) : null}
                  <div className="reg__snapshots">
                    <SnapshotCard title="Baseline" snap={regression.baseline} />
                    <SnapshotCard title="Current" snap={regression.current} />
                  </div>
                  {regression.qualityGates ? (
                    <article>
                      <h3>
                        Quality gates:{" "}
                        {regression.qualityGates.passed ? "passed" : "failed"}
                      </h3>
                      <ul>
                        {regression.qualityGates.results.map((result) => (
                          <li key={result.id}>
                            <strong>{result.label}</strong>:{" "}
                            {result.passed ? "pass" : "fail"} — {result.detail}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ) : null}
                  {regression.warnings.length > 0 ? (
                    <article>
                      <h3>Warnings</h3>
                      <ul>
                        {regression.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </article>
                  ) : null}
                </div>
              ) : null}

              {tab === "metrics" && regression.changes ? (
                <div className="reg__panel">
                  <div className="reg__table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th>Baseline</th>
                          <th>Current</th>
                          <th>Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>CSS size</td>
                          <td>
                            {formatBytes(regression.changes.cssSize.baseline)}
                          </td>
                          <td>
                            {formatBytes(regression.changes.cssSize.current)}
                          </td>
                          <td>
                            {formatBytes(
                              regression.changes.cssSize.changeBytes,
                            )}{" "}
                            ({regression.changes.cssSize.changePercent ?? "—"}%)
                          </td>
                        </tr>
                        <tr>
                          <td>Rules</td>
                          <td>{regression.changes.rules.baseline}</td>
                          <td>{regression.changes.rules.current}</td>
                          <td>{regression.changes.rules.change}</td>
                        </tr>
                        <tr>
                          <td>Selectors</td>
                          <td>{regression.changes.selectors.baseline}</td>
                          <td>{regression.changes.selectors.current}</td>
                          <td>{regression.changes.selectors.change}</td>
                        </tr>
                        <tr>
                          <td>Declarations</td>
                          <td>{regression.changes.declarations.baseline}</td>
                          <td>{regression.changes.declarations.current}</td>
                          <td>{regression.changes.declarations.change}</td>
                        </tr>
                        {regression.changes.dimensions.map((dimension) => (
                          <tr key={dimension.id}>
                            <td>{dimension.id}</td>
                            <td>
                              {dimension.evaluatedBaseline
                                ? formatScore(dimension.baseline)
                                : "n/a"}
                            </td>
                            <td>
                              {dimension.evaluatedCurrent
                                ? formatScore(dimension.current)
                                : "n/a"}
                            </td>
                            <td>
                              {dimension.change === null
                                ? "—"
                                : String(dimension.change)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="reg__muted">
                    Status labels are Core-owned; deltas are not auto-classified
                    as regressions by the GUI.
                  </p>
                </div>
              ) : null}

              {tab === "diagnostics" && regression.diagnostics ? (
                <div className="reg__panel">
                  <div className="reg__toolbar">
                    <label>
                      Bucket
                      <select
                        value={bucket}
                        onChange={(event) =>
                          setBucket(
                            event.target.value as
                              | "new"
                              | "resolved"
                              | "persistent"
                              | "changed",
                          )
                        }
                      >
                        <option value="new">
                          New ({regression.diagnostics.new.length})
                        </option>
                        <option value="resolved">
                          Resolved ({regression.diagnostics.resolved.length})
                        </option>
                        <option value="persistent">
                          Persistent ({regression.diagnostics.persistent.length}
                          )
                        </option>
                        <option value="changed">
                          Changed ({regression.diagnostics.changed.length})
                        </option>
                      </select>
                    </label>
                    <label className="reg__grow">
                      Search
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="fingerprint, code, file…"
                      />
                    </label>
                  </div>
                  <DiagnosticDiffTable rows={diagnosticRows} />
                </div>
              ) : null}

              {tab === "files" && regression.files ? (
                <div className="reg__panel">
                  <p className="reg__muted">
                    Unchanged files: {regression.files.unchanged}
                  </p>
                  <FileDiffSection
                    title="Regressed"
                    rows={regression.files.regressed}
                  />
                  <FileDiffSection
                    title="Modified"
                    rows={regression.files.modified}
                  />
                  <FileDiffSection
                    title="Added"
                    rows={regression.files.added}
                  />
                  <FileDiffSection
                    title="Removed"
                    rows={regression.files.removed}
                  />
                </div>
              ) : null}
            </>
          ) : null}

          <ul className="reg__notes">
            {regression.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <style>{regStyles}</style>
    </section>
  );
}

function SnapshotCard({
  title,
  snap,
}: {
  title: string;
  snap: {
    score: number;
    grade: string;
    status: string;
    timestamp: string;
    toolVersion: string;
    sizeBytes: number;
    files: number;
  };
}) {
  return (
    <article>
      <h3>{title}</h3>
      <dl>
        <div>
          <dt>Score</dt>
          <dd>
            {formatScore(snap.score)} ({snap.grade} · {snap.status})
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(snap.sizeBytes)}</dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>{snap.files}</dd>
        </div>
        <div>
          <dt>Timestamp</dt>
          <dd>{snap.timestamp || "—"}</dd>
        </div>
        <div>
          <dt>Tool</dt>
          <dd>{snap.toolVersion || "—"}</dd>
        </div>
      </dl>
    </article>
  );
}

function DiagnosticDiffTable({ rows }: { rows: GuiDiagnosticDiffEntry[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No findings in this bucket"
        description="Try another bucket or clear search."
      />
    );
  }
  return (
    <div className="reg__table-wrap">
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Severity</th>
            <th>Message</th>
            <th>File</th>
            <th>Fingerprint</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.fingerprint}>
              <td>
                <code>{row.code}</code>
              </td>
              <td>{row.severity}</td>
              <td>{row.message}</td>
              <td>
                {row.filePath ? (
                  <Link
                    to={`${ROUTES.FILES}?file=${encodeURIComponent(row.filePath)}`}
                  >
                    {row.filePath}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td>
                <code>{row.fingerprint}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileDiffSection({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    path: string;
    baselineSizeBytes?: number | null;
    currentSizeBytes?: number | null;
    qualityRegressed: boolean;
  }>;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <article>
      <h3>
        {title} ({rows.length})
      </h3>
      <ul>
        {rows.map((row) => (
          <li key={`${title}-${row.path}`}>
            <Link to={`${ROUTES.FILES}?file=${encodeURIComponent(row.path)}`}>
              {row.path}
            </Link>
            {row.qualityRegressed ? " · qualityRegressed" : ""}
          </li>
        ))}
      </ul>
    </article>
  );
}

const regStyles = `
  .reg { display: grid; gap: 1rem; }
  .reg__metrics {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }
  .reg__tabs { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .reg__tabs button {
    border: 1px solid var(--cssd-border-strong);
    background: transparent;
    color: var(--cssd-text-muted);
    border-radius: 8px;
    padding: 0.4rem 0.7rem;
    font: inherit;
    cursor: pointer;
  }
  .reg__tabs button.is-active {
    background: var(--cssd-accent-soft);
    color: var(--cssd-accent);
    border-color: var(--cssd-accent);
  }
  .reg__panel { display: grid; gap: 1rem; }
  .reg__snapshots {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
  .reg article {
    background: var(--cssd-bg-elevated);
    border: 1px solid var(--cssd-border);
    border-radius: var(--cssd-radius);
    padding: 1rem;
  }
  .reg h3 { margin: 0 0 0.75rem; font-size: 0.95rem; }
  .reg dl { margin: 0; display: grid; gap: 0.5rem; }
  .reg dt {
    color: var(--cssd-text-faint);
    font-size: 0.72rem;
    text-transform: uppercase;
  }
  .reg dd { margin: 0.15rem 0 0; word-break: break-word; }
  .reg__toolbar {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }
  .reg__toolbar label {
    display: grid;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--cssd-text-faint);
    text-transform: uppercase;
  }
  .reg__toolbar input,
  .reg__toolbar select {
    border: 1px solid var(--cssd-border-strong);
    border-radius: 8px;
    background: var(--cssd-bg-elevated);
    color: var(--cssd-text);
    padding: 0.45rem 0.55rem;
    font: inherit;
    text-transform: none;
  }
  .reg__grow { grid-column: 1 / -1; }
  .reg__table-wrap {
    overflow: auto;
    border: 1px solid var(--cssd-border);
    border-radius: var(--cssd-radius);
    background: var(--cssd-bg-elevated);
  }
  .reg table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .reg th, .reg td {
    text-align: left;
    padding: 0.55rem 0.65rem;
    border-bottom: 1px solid var(--cssd-border);
    vertical-align: top;
  }
  .reg th {
    color: var(--cssd-text-faint);
    font-size: 0.72rem;
    text-transform: uppercase;
  }
  .reg__notes { margin: 0; padding-left: 1.1rem; color: var(--cssd-text-muted); font-size: 0.85rem; }
  .reg__muted { margin: 0; color: var(--cssd-text-muted); font-size: 0.85rem; }
`;
