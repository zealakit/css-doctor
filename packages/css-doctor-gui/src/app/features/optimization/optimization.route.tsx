import { useMemo, useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
  SizeCompare,
} from "@/components/ui";
import { useReport } from "@/hooks/use-report";
import { formatBytes } from "@/lib/utils/format";
import type { GuiOptimizationFile } from "@shared/report-model";

type OptTab = "overview" | "files" | "decisions" | "warnings";

export function OptimizationRoute() {
  const { state } = useReport();
  const [tab, setTab] = useState<OptTab>("overview");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"saved" | "input" | "path">("saved");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const optimization =
    state.status === "ready" ? state.report.optimization : null;

  const files = useMemo(() => {
    if (!optimization) {
      return [];
    }
    const needle = query.trim().toLowerCase();
    const next = optimization.files.filter((file) =>
      needle ? file.path.toLowerCase().includes(needle) : true,
    );
    return next.sort((left, right) => compareOptFiles(left, right, sort));
  }, [optimization, query, sort]);

  const selected =
    files.find((file) => file.path === selectedPath) ?? files[0] ?? null;

  return (
    <section>
      <PageHeader
        title="Optimization"
        description="Core optimize/split impact, operations, and decisions from loaded JSON."
      />

      {state.status === "loading" ? (
        <LoadingState label="Loading optimization…" />
      ) : null}
      {state.status === "error" ? <ErrorState message={state.message} /> : null}
      {state.status === "empty" ? (
        <EmptyState
          title="No report loaded"
          description="Load css-doctor optimize --json (or split --json) from Overview."
        />
      ) : null}

      {state.status === "ready" && !optimization ? (
        <EmptyState
          title="Optimization data missing"
          description="This report has no optimization section. Load optimize/split JSON, or keep using check for Analysis."
        />
      ) : null}

      {state.status === "ready" && optimization ? (
        <div className="opt">
          <div className="opt__tabs" role="tablist">
            {(
              [
                ["overview", "Overview"],
                ["files", "Files"],
                ["decisions", "Decisions"],
                ["warnings", "Warnings"],
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
            <div className="opt__panel">
              <div className="opt__metrics">
                <MetricCard
                  label="Command"
                  value={optimization.command}
                  hint={optimization.dryRun ? "dry-run" : "write mode report"}
                />
                <MetricCard
                  label="Input bytes"
                  value={formatBytes(optimization.summary.inputBytes)}
                />
                <MetricCard
                  label="Emitted bytes"
                  value={formatBytes(optimization.summary.emittedBytesTotal)}
                  hint="Core impact.emittedBytesTotal"
                />
                <MetricCard
                  label="Bytes eliminated (Core)"
                  value={formatBytes(optimization.summary.bytesEliminated)}
                  hint={
                    optimization.summary.eliminationPercent !== null
                      ? `${optimization.summary.eliminationPercent.toFixed(1)}% reported`
                      : "percent not provided"
                  }
                />
                <MetricCard
                  label="Redistributed"
                  value={formatBytes(optimization.summary.redistributedBytes)}
                  hint="Not the same as download savings"
                />
                <MetricCard
                  label="Chunks"
                  value={String(optimization.summary.chunksCreated)}
                />
              </div>

              <article>
                <h3>Size comparison</h3>
                <SizeCompare
                  beforeLabel="Input bytes"
                  afterLabel="Emitted bytes"
                  beforeBytes={optimization.summary.inputBytes}
                  afterBytes={optimization.summary.emittedBytesTotal}
                  formatBytes={formatBytes}
                  note="Emitted bytes are Core output sizes. Core bytesEliminated may include redistribution and should not be read as input−emitted alone."
                />
              </article>

              <article>
                <h3>Operations enabled</h3>
                <ul className="opt__ops">
                  {Object.entries(optimization.operations).map(
                    ([key, enabled]) => (
                      <li key={key} data-on={enabled ? "true" : "false"}>
                        <code>{key}</code>
                        <span>{enabled ? "on" : "off"}</span>
                      </li>
                    ),
                  )}
                </ul>
              </article>

              <ul className="opt__notes">
                {optimization.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {tab === "files" ? (
            <div className="opt__panel">
              <div className="opt__toolbar">
                <label className="opt__grow">
                  Search
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="file path…"
                  />
                </label>
                <label>
                  Sort
                  <select
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value as "saved" | "input" | "path")
                    }
                  >
                    <option value="saved">Bytes eliminated</option>
                    <option value="input">Input size</option>
                    <option value="path">Path</option>
                  </select>
                </label>
              </div>
              {files.length === 0 ? (
                <EmptyState
                  title="No files"
                  description="No optimization file rows in this report."
                />
              ) : (
                <div className="opt__split">
                  <div className="opt__table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Path</th>
                          <th>Input</th>
                          <th>Emitted</th>
                          <th>Eliminated</th>
                          <th>%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {files.map((file) => (
                          <tr
                            key={file.path}
                            data-selected={
                              selected?.path === file.path ? "true" : "false"
                            }
                            onClick={() => setSelectedPath(file.path)}
                          >
                            <td>{file.path}</td>
                            <td>{formatBytes(file.inputBytes)}</td>
                            <td>{formatBytes(file.emittedBytesTotal)}</td>
                            <td>{formatBytes(file.bytesEliminated)}</td>
                            <td>
                              {file.eliminationPercent !== null
                                ? `${file.eliminationPercent.toFixed(1)}%`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <aside>
                    {selected ? (
                      <>
                        <h3>{selected.path}</h3>
                        <SizeCompare
                          beforeLabel="Input"
                          afterLabel="Emitted"
                          beforeBytes={selected.inputBytes}
                          afterBytes={selected.emittedBytesTotal}
                          formatBytes={formatBytes}
                        />
                        <h4>Chunks</h4>
                        <ul className="opt__chunks">
                          {selected.chunks.map((chunk) => (
                            <li key={`${chunk.name}-${chunk.kind}`}>
                              <code>{chunk.name}</code>
                              <span>
                                {chunk.kind} · {formatBytes(chunk.sizeBytes)}
                                {chunk.oversized ? " · oversized" : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="opt__muted">Select a file.</p>
                    )}
                  </aside>
                </div>
              )}
            </div>
          ) : null}

          {tab === "decisions" ? (
            <div className="opt__panel">
              {optimization.decisions.length === 0 ? (
                <EmptyState
                  title="No decisions"
                  description="This optimize report did not include decision entries."
                />
              ) : (
                <div className="opt__table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Category</th>
                        <th>Changed</th>
                        <th>Impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optimization.decisions.map((decision) => (
                        <tr key={decision.id}>
                          <td>
                            <strong>{decision.title}</strong>
                            <p className="opt__muted">{decision.explanation}</p>
                          </td>
                          <td>
                            <code>{decision.category}</code>
                          </td>
                          <td>{decision.changed ? "yes" : "no"}</td>
                          <td>
                            {decision.bytesBefore !== undefined &&
                            decision.bytesBefore !== null
                              ? formatBytes(decision.bytesBefore)
                              : "—"}
                            {" → "}
                            {decision.bytesAfter !== undefined &&
                            decision.bytesAfter !== null
                              ? formatBytes(decision.bytesAfter)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {tab === "warnings" ? (
            <div className="opt__panel">
              {optimization.warnings.length === 0 ? (
                <EmptyState
                  title="No warnings"
                  description="Optimize report warnings array is empty."
                />
              ) : (
                <ul className="opt__warnings">
                  {optimization.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <style>{optStyles}</style>
    </section>
  );
}

function compareOptFiles(
  left: GuiOptimizationFile,
  right: GuiOptimizationFile,
  sort: "saved" | "input" | "path",
): number {
  if (sort === "path") {
    return left.path.localeCompare(right.path);
  }
  if (sort === "input") {
    return right.inputBytes - left.inputBytes;
  }
  return right.bytesEliminated - left.bytesEliminated;
}

const optStyles = `
  .opt { display: grid; gap: 1rem; }
  .opt__tabs { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .opt__tabs button {
    border: 1px solid var(--cssd-border-strong);
    background: transparent;
    color: var(--cssd-text-muted);
    border-radius: 8px;
    padding: 0.4rem 0.7rem;
    font: inherit;
    cursor: pointer;
  }
  .opt__tabs button.is-active {
    background: var(--cssd-accent-soft);
    color: var(--cssd-accent);
    border-color: var(--cssd-accent);
  }
  .opt__panel { display: grid; gap: 1rem; }
  .opt__metrics {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }
  .opt__panel > article {
    background: var(--cssd-bg-elevated);
    border: 1px solid var(--cssd-border);
    border-radius: var(--cssd-radius);
    padding: 1rem;
  }
  .opt__panel h3 { margin: 0 0 0.75rem; font-size: 0.95rem; }
  .opt__panel h4 { margin: 0.9rem 0 0.45rem; font-size: 0.85rem; }
  .opt__ops {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }
  .opt__ops li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.9rem;
  }
  .opt__ops li[data-on="true"] span { color: var(--cssd-success); }
  .opt__ops li[data-on="false"] span { color: var(--cssd-text-faint); }
  .opt__notes {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--cssd-text-muted);
    font-size: 0.85rem;
  }
  .opt__toolbar {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
  .opt__toolbar label {
    display: grid;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--cssd-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .opt__toolbar input,
  .opt__toolbar select {
    border: 1px solid var(--cssd-border-strong);
    border-radius: 8px;
    background: var(--cssd-bg-elevated);
    color: var(--cssd-text);
    padding: 0.45rem 0.55rem;
    font: inherit;
    text-transform: none;
  }
  .opt__grow { grid-column: 1 / -1; }
  .opt__split {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(0, 1.5fr) minmax(220px, 1fr);
  }
  .opt__table-wrap {
    overflow: auto;
    border: 1px solid var(--cssd-border);
    border-radius: var(--cssd-radius);
    background: var(--cssd-bg-elevated);
  }
  .opt table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  .opt th, .opt td {
    text-align: left;
    padding: 0.6rem 0.7rem;
    border-bottom: 1px solid var(--cssd-border);
    vertical-align: top;
  }
  .opt th {
    color: var(--cssd-text-faint);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .opt tbody tr { cursor: pointer; }
  .opt tbody tr[data-selected="true"],
  .opt tbody tr:hover {
    background: color-mix(in srgb, var(--cssd-accent-soft) 70%, transparent);
  }
  .opt__split aside {
    background: var(--cssd-bg-elevated);
    border: 1px solid var(--cssd-border);
    border-radius: var(--cssd-radius);
    padding: 1rem;
  }
  .opt__chunks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
    font-size: 0.85rem;
  }
  .opt__chunks li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .opt__warnings {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.45rem;
    color: var(--cssd-text-muted);
  }
  .opt__muted { margin: 0.25rem 0 0; color: var(--cssd-text-muted); font-size: 0.85rem; }
  @media (max-width: 960px) {
    .opt__split { grid-template-columns: 1fr; }
  }
`;
