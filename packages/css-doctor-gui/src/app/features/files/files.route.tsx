import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { useReport } from "@/hooks/use-report";
import { ROUTES } from "@/lib/constants";
import { formatBytes } from "@/lib/utils/format";
import { buildExplorerFiles } from "@shared/explorer";
import type { GuiExplorerFile } from "@shared/report-model";

type SortKey = "path" | "size" | "selectors" | "diagnostics";

export function FilesRoute() {
  const { state } = useReport();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("path");
  const selectedPath = params.get("file");

  const files = useMemo(() => {
    if (state.status !== "ready") {
      return [];
    }
    const all = buildExplorerFiles(state.report);
    const needle = query.trim().toLowerCase();
    const filtered = all.filter((file) =>
      needle ? file.path.toLowerCase().includes(needle) : true,
    );
    return filtered.sort((left, right) => compareExplorer(left, right, sort));
  }, [state, query, sort]);

  const selected =
    files.find((file) => file.path === selectedPath) ?? files[0] ?? null;

  return (
    <section>
      <PageHeader
        title="Files"
        description="CSS files referenced by the loaded report (not a full filesystem browser)."
      />

      {state.status === "loading" ? (
        <LoadingState label="Loading files…" />
      ) : null}
      {state.status === "error" ? <ErrorState message={state.message} /> : null}
      {state.status === "empty" ? (
        <EmptyState
          title="No report loaded"
          description="Load a report from Overview first."
        />
      ) : null}

      {state.status === "ready" ? (
        files.length === 0 ? (
          <EmptyState
            title="No files in report"
            description="This report does not reference any CSS file paths."
          />
        ) : (
          <div className="files">
            <div className="files__toolbar">
              <label className="files__grow">
                Search
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="path…"
                />
              </label>
              <label>
                Sort
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortKey)}
                >
                  <option value="path">Path</option>
                  <option value="size">Size</option>
                  <option value="selectors">Selectors</option>
                  <option value="diagnostics">Diagnostics</option>
                </select>
              </label>
            </div>

            <div className="files__layout">
              <div className="files__table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th>Size</th>
                      <th>Selectors</th>
                      <th>Diagnostics</th>
                      <th>Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file) => (
                      <tr
                        key={file.path}
                        data-selected={
                          selected?.path === file.path ? "true" : "false"
                        }
                        onClick={() =>
                          setParams({ file: file.path }, { replace: true })
                        }
                      >
                        <td>{file.path}</td>
                        <td>
                          {file.sizeBytes !== undefined
                            ? formatBytes(file.sizeBytes)
                            : "—"}
                        </td>
                        <td>{file.selectorCount ?? "—"}</td>
                        <td>{file.diagnosticCount ?? 0}</td>
                        <td className="files__flags">
                          {file.hasAnalysis ? "A" : ""}
                          {file.hasOptimization ? "O" : ""}
                          {file.hasSplitting ? "S" : ""}
                          {file.hasRegression ? "R" : ""}
                          {file.qualityRegressed ? "!" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <aside>
                {selected ? (
                  <FileDetail file={selected} />
                ) : (
                  <p className="files__muted">Select a file.</p>
                )}
              </aside>
            </div>
          </div>
        )
      ) : null}

      <style>{filesStyles}</style>
    </section>
  );
}

function FileDetail({ file }: { file: GuiExplorerFile }) {
  const encoded = encodeURIComponent(file.path);
  return (
    <div>
      <h3>{file.path}</h3>
      <dl>
        <div>
          <dt>Size</dt>
          <dd>
            {file.sizeBytes !== undefined ? formatBytes(file.sizeBytes) : "—"}
          </dd>
        </div>
        <div>
          <dt>Selectors / declarations</dt>
          <dd>
            {file.selectorCount ?? "—"} / {file.declarationCount ?? "—"}
          </dd>
        </div>
        <div>
          <dt>Diagnostics count</dt>
          <dd>{file.diagnosticCount ?? 0}</dd>
        </div>
        <div>
          <dt>Chunks</dt>
          <dd>{file.chunkNames.length ? file.chunkNames.join(", ") : "—"}</dd>
        </div>
        <div>
          <dt>Quality regressed</dt>
          <dd>
            {file.qualityRegressed === undefined
              ? "—"
              : file.qualityRegressed
                ? "yes"
                : "no"}
          </dd>
        </div>
      </dl>
      <nav className="files__nav">
        {file.hasAnalysis ? (
          <Link to={ROUTES.ANALYSIS}>CSS Analysis</Link>
        ) : null}
        <Link to={`${ROUTES.DIAGNOSTICS}`}>Diagnostics</Link>
        {file.hasOptimization ? (
          <Link to={ROUTES.OPTIMIZATION}>Optimization</Link>
        ) : null}
        {file.hasSplitting ? (
          <Link to={ROUTES.SPLITTING}>Splitting</Link>
        ) : null}
        {file.hasRegression ? (
          <Link to={ROUTES.REGRESSION}>Regression</Link>
        ) : null}
        <Link to={`${ROUTES.FILES}?file=${encoded}`}>Permalink</Link>
      </nav>
      <p className="files__muted">
        Flags: A=analysis O=optimization S=splitting R=regression
        !=qualityRegressed
      </p>
    </div>
  );
}

function compareExplorer(
  left: GuiExplorerFile,
  right: GuiExplorerFile,
  sort: SortKey,
): number {
  if (sort === "size") {
    return (right.sizeBytes ?? 0) - (left.sizeBytes ?? 0);
  }
  if (sort === "selectors") {
    return (right.selectorCount ?? 0) - (left.selectorCount ?? 0);
  }
  if (sort === "diagnostics") {
    return (right.diagnosticCount ?? 0) - (left.diagnosticCount ?? 0);
  }
  return left.path.localeCompare(right.path);
}

const filesStyles = `
  .files { display: grid; gap: 1rem; }
  .files__toolbar {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }
  .files__toolbar label {
    display: grid;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--cssd-text-faint);
    text-transform: uppercase;
  }
  .files__toolbar input,
  .files__toolbar select {
    border: 1px solid var(--cssd-border-strong);
    border-radius: 8px;
    background: var(--cssd-bg-elevated);
    color: var(--cssd-text);
    padding: 0.45rem 0.55rem;
    font: inherit;
    text-transform: none;
  }
  .files__grow { grid-column: 1 / -1; }
  .files__layout {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(0, 1.6fr) minmax(220px, 1fr);
  }
  .files__table-wrap {
    overflow: auto;
    border: 1px solid var(--cssd-border);
    border-radius: var(--cssd-radius);
    background: var(--cssd-bg-elevated);
  }
  .files table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .files th, .files td {
    text-align: left;
    padding: 0.55rem 0.65rem;
    border-bottom: 1px solid var(--cssd-border);
    vertical-align: top;
  }
  .files th {
    color: var(--cssd-text-faint);
    font-size: 0.72rem;
    text-transform: uppercase;
  }
  .files tbody tr { cursor: pointer; }
  .files tbody tr[data-selected="true"],
  .files tbody tr:hover {
    background: color-mix(in srgb, var(--cssd-accent-soft) 70%, transparent);
  }
  .files__flags { letter-spacing: 0.08em; color: var(--cssd-accent); }
  .files aside {
    background: var(--cssd-bg-elevated);
    border: 1px solid var(--cssd-border);
    border-radius: var(--cssd-radius);
    padding: 1rem;
  }
  .files aside h3 { margin: 0 0 0.75rem; font-size: 0.95rem; word-break: break-word; }
  .files aside dl { margin: 0; display: grid; gap: 0.5rem; }
  .files aside dt {
    color: var(--cssd-text-faint);
    font-size: 0.72rem;
    text-transform: uppercase;
  }
  .files aside dd { margin: 0.15rem 0 0; }
  .files__nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    margin-top: 1rem;
  }
  .files__muted { margin: 0.75rem 0 0; color: var(--cssd-text-muted); font-size: 0.8rem; }
  @media (max-width: 960px) {
    .files__layout { grid-template-columns: 1fr; }
  }
`;
