import { useMemo, useState } from "react";

import {
  DistributionBars,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
} from "@/components/ui";
import { useReport } from "@/hooks/use-report";
import { formatBytes } from "@/lib/utils/format";
import type { GuiFileInsight, GuiSelectorRow } from "@shared/report-model";

type AnalysisTab = "overview" | "files" | "selectors" | "dead";

export function AnalysisRoute() {
  const { state } = useReport();
  const [tab, setTab] = useState<AnalysisTab>("overview");
  const [fileQuery, setFileQuery] = useState("");
  const [fileSort, setFileSort] = useState<"size" | "selectors" | "path">(
    "size",
  );
  const [selectorQuery, setSelectorQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const analysis = state.status === "ready" ? state.report.cssAnalysis : null;

  const files = useMemo(() => {
    if (!analysis) {
      return [];
    }
    const needle = fileQuery.trim().toLowerCase();
    const next = analysis.files.filter((file) =>
      needle ? file.path.toLowerCase().includes(needle) : true,
    );
    return next.sort((left, right) => compareFiles(left, right, fileSort));
  }, [analysis, fileQuery, fileSort]);

  const selectors = useMemo(() => {
    if (!analysis) {
      return [];
    }
    const needle = selectorQuery.trim().toLowerCase();
    return analysis.selectors.filter((selector) => {
      if (selectedFile && selector.filePath !== selectedFile) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return (
        selector.raw.toLowerCase().includes(needle) ||
        selector.filePath.toLowerCase().includes(needle) ||
        selector.kinds.some((kind) => kind.toLowerCase().includes(needle))
      );
    });
  }, [analysis, selectorQuery, selectedFile]);

  return (
    <section>
      <PageHeader
        title="CSS Analysis"
        description="Explore Core analyzeCss metrics from the loaded check report."
      />

      {state.status === "loading" ? (
        <LoadingState label="Loading analysis…" />
      ) : null}
      {state.status === "error" ? <ErrorState message={state.message} /> : null}
      {state.status === "empty" ? (
        <EmptyState
          title="No report loaded"
          description="Load or generate a check report from Overview first."
        />
      ) : null}

      {state.status === "ready" && !analysis ? (
        <EmptyState
          title="Analysis data missing"
          description="This report does not include analyzeCss file results (for example health-only JSON)."
        />
      ) : null}

      {state.status === "ready" && analysis ? (
        <div className="analysis">
          <div className="analysis__tabs" role="tablist">
            {(
              [
                ["overview", "Overview"],
                ["files", "Files"],
                ["selectors", "Selectors"],
                ["dead", "Dead CSS candidates"],
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

          {tab === "overview" ? (
            <div className="analysis__panel">
              <div className="analysis__metrics">
                <MetricCard
                  label="Files"
                  value={String(analysis.totals.files)}
                />
                <MetricCard
                  label="Total size"
                  value={formatBytes(analysis.totals.sizeBytes)}
                />
                <MetricCard
                  label="Selectors"
                  value={String(analysis.totals.selectors)}
                />
                <MetricCard
                  label="Declarations"
                  value={String(analysis.totals.declarations)}
                  hint={`${analysis.totals.importantDeclarations} !important`}
                />
                <MetricCard
                  label="Rules"
                  value={String(analysis.totals.rules)}
                />
                <MetricCard
                  label="Max nesting"
                  value={String(analysis.totals.maxNestingDepth)}
                />
              </div>
              <div className="analysis__grid">
                <article>
                  <DistributionBars
                    title="Selector kinds (Core)"
                    items={analysis.kindDistribution}
                  />
                </article>
                <article>
                  <DistributionBars
                    title="Specificity buckets (from Core specificity)"
                    items={analysis.specificityBuckets}
                  />
                </article>
              </div>
              <article>
                <h3>Not available in this report</h3>
                <ul className="analysis__missing">
                  <li>
                    At-rule inventory:{" "}
                    {analysis.atRules === null ? "missing" : "present"}
                  </li>
                  <li>
                    Page usage / coverage:{" "}
                    {analysis.usage === null ? "missing" : "present"}
                  </li>
                </ul>
                <ul className="analysis__notes">
                  {analysis.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </article>
            </div>
          ) : null}

          {tab === "files" ? (
            <div className="analysis__panel">
              <div className="analysis__toolbar">
                <label>
                  Search files
                  <input
                    value={fileQuery}
                    onChange={(event) => setFileQuery(event.target.value)}
                    placeholder="path…"
                  />
                </label>
                <label>
                  Sort
                  <select
                    value={fileSort}
                    onChange={(event) =>
                      setFileSort(
                        event.target.value as "size" | "selectors" | "path",
                      )
                    }
                  >
                    <option value="size">Size</option>
                    <option value="selectors">Selectors</option>
                    <option value="path">Path</option>
                  </select>
                </label>
              </div>
              {files.length === 0 ? (
                <EmptyState
                  title="No files match"
                  description="Try another search."
                />
              ) : (
                <div className="analysis__split">
                  <div className="analysis__table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Path</th>
                          <th>Size</th>
                          <th>Selectors</th>
                          <th>Decls</th>
                          <th>Issues</th>
                        </tr>
                      </thead>
                      <tbody>
                        {files.map((file) => (
                          <tr
                            key={file.path}
                            data-selected={
                              selectedFile === file.path ? "true" : "false"
                            }
                            onClick={() => setSelectedFile(file.path)}
                          >
                            <td>{file.path}</td>
                            <td>{formatBytes(file.sizeBytes)}</td>
                            <td>{file.selectorCount ?? "—"}</td>
                            <td>{file.declarationCount ?? "—"}</td>
                            <td>{file.issueCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <aside>
                    {selectedFile ? (
                      <FileDetail
                        file={
                          files.find((item) => item.path === selectedFile) ??
                          null
                        }
                      />
                    ) : (
                      <p className="analysis__muted">Select a file.</p>
                    )}
                  </aside>
                </div>
              )}
            </div>
          ) : null}

          {tab === "selectors" ? (
            <div className="analysis__panel">
              <div className="analysis__toolbar">
                <label className="analysis__grow">
                  Search selectors
                  <input
                    value={selectorQuery}
                    onChange={(event) => setSelectorQuery(event.target.value)}
                    placeholder="selector, kind, file…"
                  />
                </label>
                <label>
                  File filter
                  <select
                    value={selectedFile ?? "all"}
                    onChange={(event) =>
                      setSelectedFile(
                        event.target.value === "all"
                          ? null
                          : event.target.value,
                      )
                    }
                  >
                    <option value="all">All files</option>
                    {analysis.files.map((file) => (
                      <option key={file.path} value={file.path}>
                        {file.path}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <SelectorTable rows={selectors} />
            </div>
          ) : null}

          {tab === "dead" ? (
            <div className="analysis__panel">
              {analysis.deadCssCandidates.length === 0 ? (
                <EmptyState
                  title="No dead CSS candidates"
                  description="No empty-rule / dead_* diagnostics were present in this report."
                />
              ) : (
                <>
                  <p className="analysis__muted">
                    Status is always <code>candidate</code> — not confirmed
                    unused via page usage.
                  </p>
                  <div className="analysis__table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Message</th>
                          <th>File</th>
                          <th>Selector</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.deadCssCandidates.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <code>{item.code}</code>
                            </td>
                            <td>{item.message}</td>
                            <td>{item.filePath ?? "—"}</td>
                            <td>{item.selector ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <style>{analysisStyles}</style>
    </section>
  );
}

function FileDetail({ file }: { file: GuiFileInsight | null }) {
  if (!file) {
    return <p className="analysis__muted">File not found.</p>;
  }
  return (
    <div>
      <h3>{file.path}</h3>
      <dl>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(file.sizeBytes)}</dd>
        </div>
        <div>
          <dt>Selectors</dt>
          <dd>{file.selectorCount ?? "—"}</dd>
        </div>
        <div>
          <dt>Rules</dt>
          <dd>{file.ruleCount ?? "—"}</dd>
        </div>
        <div>
          <dt>Declarations</dt>
          <dd>{file.declarationCount ?? "—"}</dd>
        </div>
        <div>
          <dt>!important</dt>
          <dd>{file.importantDeclarationCount ?? "—"}</dd>
        </div>
        <div>
          <dt>Unique classes / ids / tags</dt>
          <dd>
            {file.uniqueClassCount ?? "—"} / {file.uniqueIdCount ?? "—"} /{" "}
            {file.uniqueTagCount ?? "—"}
          </dd>
        </div>
        <div>
          <dt>Max nesting</dt>
          <dd>{file.maxNestingDepth ?? "—"}</dd>
        </div>
        <div>
          <dt>OK</dt>
          <dd>{file.ok ? "yes" : "no"}</dd>
        </div>
      </dl>
    </div>
  );
}

function SelectorTable({ rows }: { rows: GuiSelectorRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No selectors match"
        description="Adjust search or file filter."
      />
    );
  }
  return (
    <div className="analysis__table-wrap">
      <table>
        <thead>
          <tr>
            <th>Selector</th>
            <th>Kinds</th>
            <th>Specificity</th>
            <th>File</th>
            <th>Loc</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <code>{row.raw}</code>
              </td>
              <td>{row.kinds.join(", ") || "—"}</td>
              <td>
                {row.specificityIds},{row.specificityClasses},
                {row.specificityTypes}
              </td>
              <td>{row.filePath}</td>
              <td>
                {row.line !== undefined
                  ? `${row.line}:${row.column ?? 0}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function compareFiles(
  left: GuiFileInsight,
  right: GuiFileInsight,
  sort: "size" | "selectors" | "path",
): number {
  if (sort === "path") {
    return left.path.localeCompare(right.path);
  }
  if (sort === "selectors") {
    return (right.selectorCount ?? 0) - (left.selectorCount ?? 0);
  }
  return right.sizeBytes - left.sizeBytes;
}

const analysisStyles = `
  .analysis { display: grid; gap: 1rem; }
  .analysis__tabs { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .analysis__tabs button {
    border: 1px solid var(--cssd-border-strong);
    background: transparent;
    color: var(--cssd-text-muted);
    border-radius: 8px;
    padding: 0.4rem 0.7rem;
    font: inherit;
    cursor: pointer;
  }
  .analysis__tabs button.is-active {
    background: var(--cssd-accent-soft);
    color: var(--cssd-accent);
    border-color: var(--cssd-accent);
  }
  .analysis__panel { display: grid; gap: 1rem; }
  .analysis__metrics {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }
  .analysis__grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }
  .analysis__grid article,
  .analysis__panel > article,
  .analysis__split aside {
    background: var(--cssd-bg-elevated);
    border: 1px solid var(--cssd-border);
    border-radius: var(--cssd-radius);
    padding: 1rem;
  }
  .analysis__toolbar {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
  .analysis__toolbar label {
    display: grid;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--cssd-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .analysis__toolbar input,
  .analysis__toolbar select {
    border: 1px solid var(--cssd-border-strong);
    border-radius: 8px;
    background: var(--cssd-bg-elevated);
    color: var(--cssd-text);
    padding: 0.45rem 0.55rem;
    font: inherit;
    text-transform: none;
  }
  .analysis__grow { grid-column: 1 / -1; }
  .analysis__split {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(0, 1.5fr) minmax(220px, 1fr);
  }
  .analysis__table-wrap {
    overflow: auto;
    border: 1px solid var(--cssd-border);
    border-radius: var(--cssd-radius);
    background: var(--cssd-bg-elevated);
  }
  .analysis table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  .analysis th, .analysis td {
    text-align: left;
    padding: 0.6rem 0.7rem;
    border-bottom: 1px solid var(--cssd-border);
    vertical-align: top;
  }
  .analysis th {
    color: var(--cssd-text-faint);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .analysis tbody tr { cursor: pointer; }
  .analysis tbody tr[data-selected="true"],
  .analysis tbody tr:hover {
    background: color-mix(in srgb, var(--cssd-accent-soft) 70%, transparent);
  }
  .analysis__muted { margin: 0; color: var(--cssd-text-muted); font-size: 0.9rem; }
  .analysis__notes, .analysis__missing {
    margin: 0.5rem 0 0;
    padding-left: 1.1rem;
    color: var(--cssd-text-muted);
    font-size: 0.85rem;
  }
  .analysis aside h3 { margin: 0 0 0.75rem; font-size: 0.95rem; word-break: break-word; }
  .analysis aside dl { margin: 0; display: grid; gap: 0.55rem; }
  .analysis aside dt {
    color: var(--cssd-text-faint);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .analysis aside dd { margin: 0.15rem 0 0; }
  @media (max-width: 960px) {
    .analysis__split { grid-template-columns: 1fr; }
  }
`;
