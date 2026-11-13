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
import { formatBytes } from "@/lib/utils/format";
import type { GuiChunk } from "@shared/report-model";

export function SplittingRoute() {
  const { state } = useReport();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const splitting = state.status === "ready" ? state.report.splitting : null;

  const chunks = useMemo(() => {
    if (!splitting) {
      return [];
    }
    const needle = query.trim().toLowerCase();
    return splitting.chunks.filter((chunk) => {
      if (!needle) {
        return true;
      }
      return (
        chunk.name.toLowerCase().includes(needle) ||
        chunk.sourceFile.toLowerCase().includes(needle) ||
        chunk.kind.toLowerCase().includes(needle) ||
        (chunk.page ?? "").toLowerCase().includes(needle)
      );
    });
  }, [splitting, query]);

  const selected =
    chunks.find((chunk) => chunk.id === selectedId) ?? chunks[0] ?? null;

  return (
    <section>
      <PageHeader
        title="Splitting"
        description="Chunks emitted by Core optimize/split reports."
      />

      {state.status === "loading" ? (
        <LoadingState label="Loading splitting…" />
      ) : null}
      {state.status === "error" ? <ErrorState message={state.message} /> : null}
      {state.status === "empty" ? (
        <EmptyState
          title="No report loaded"
          description="Load optimize --json or split --json from Overview."
        />
      ) : null}

      {state.status === "ready" && !splitting ? (
        <EmptyState
          title="Splitting data unavailable"
          description="This report has no chunk metadata. Load an optimize/split JSON report."
        />
      ) : null}

      {state.status === "ready" && splitting ? (
        <div className="split">
          <div className="split__metrics">
            <MetricCard label="Status" value={splitting.status} />
            <MetricCard
              label="Input files"
              value={String(splitting.inputFileCount)}
            />
            <MetricCard label="Chunks" value={String(splitting.chunkCount)} />
            <MetricCard
              label="Total chunk bytes"
              value={formatBytes(splitting.totalChunkBytes)}
            />
            <MetricCard
              label="Oversized"
              value={String(splitting.oversizedCount)}
            />
            <MetricCard
              label="Ops"
              value={`${splitting.pageCoverageSplit ? "coverage" : "—"} / ${splitting.sizeBudgetSplit ? "budget" : "—"}`}
              hint="pageCoverageSplit / sizeBudgetSplit"
            />
          </div>

          {splitting.warnings.length > 0 ? (
            <article>
              <h3>Warnings</h3>
              <ul>
                {splitting.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </article>
          ) : null}

          <div className="split__toolbar">
            <label>
              Search chunks
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="name, file, kind, page…"
              />
            </label>
          </div>

          {chunks.length === 0 ? (
            <EmptyState
              title="No chunks match"
              description="Adjust search or load a report that emitted chunks."
            />
          ) : (
            <div className="split__layout">
              <div className="split__table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Kind</th>
                      <th>Class</th>
                      <th>Size</th>
                      <th>Source</th>
                      <th>Page</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chunks.map((chunk) => (
                      <tr
                        key={chunk.id}
                        data-selected={
                          selected?.id === chunk.id ? "true" : "false"
                        }
                        onClick={() => setSelectedId(chunk.id)}
                      >
                        <td>
                          <code>{chunk.name}</code>
                          {chunk.oversized ? " · oversized" : ""}
                        </td>
                        <td>{chunk.kind}</td>
                        <td>{chunk.classification}</td>
                        <td>{formatBytes(chunk.sizeBytes)}</td>
                        <td>{chunk.sourceFile}</td>
                        <td>{chunk.page ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <aside>
                {selected ? (
                  <ChunkDetail chunk={selected} />
                ) : (
                  <p className="split__muted">Select a chunk.</p>
                )}
              </aside>
            </div>
          )}

          {splitting.relatedDecisions.length > 0 ? (
            <article>
              <h3>Related decisions</h3>
              <ul className="split__decisions">
                {splitting.relatedDecisions.map((decision) => (
                  <li key={decision.id}>
                    <strong>{decision.title}</strong>
                    <p>{decision.explanation}</p>
                  </li>
                ))}
              </ul>
              <p className="split__muted">
                Full decision list:{" "}
                <Link to={ROUTES.OPTIMIZATION}>Optimization</Link>
              </p>
            </article>
          ) : null}

          <ul className="split__notes">
            {splitting.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <style>{splitStyles}</style>
    </section>
  );
}

function ChunkDetail({ chunk }: { chunk: GuiChunk }) {
  return (
    <div>
      <h3>{chunk.name}</h3>
      <dl>
        <div>
          <dt>Kind</dt>
          <dd>{chunk.kind}</dd>
        </div>
        <div>
          <dt>Classification</dt>
          <dd>{chunk.classification}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(chunk.sizeBytes)}</dd>
        </div>
        <div>
          <dt>Source file</dt>
          <dd>
            <Link
              to={`${ROUTES.FILES}?file=${encodeURIComponent(chunk.sourceFile)}`}
            >
              {chunk.sourceFile}
            </Link>
          </dd>
        </div>
        <div>
          <dt>Page</dt>
          <dd>{chunk.page ?? "—"}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>{chunk.oversized ? "oversized" : "within budget / n/a"}</dd>
        </div>
        <div>
          <dt>Variables chunk</dt>
          <dd>{chunk.variables ? "yes" : "no"}</dd>
        </div>
      </dl>
    </div>
  );
}

const splitStyles = `
  .split { display: grid; gap: 1rem; }
  .split__metrics {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }
  .split article {
    background: var(--cssd-bg-elevated);
    border: 1px solid var(--cssd-border);
    border-radius: var(--cssd-radius);
    padding: 1rem;
  }
  .split h3 { margin: 0 0 0.75rem; font-size: 0.95rem; }
  .split__toolbar label {
    display: grid;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--cssd-text-faint);
    text-transform: uppercase;
  }
  .split__toolbar input {
    border: 1px solid var(--cssd-border-strong);
    border-radius: 8px;
    background: var(--cssd-bg-elevated);
    color: var(--cssd-text);
    padding: 0.45rem 0.55rem;
    font: inherit;
  }
  .split__layout {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(0, 1.6fr) minmax(220px, 1fr);
  }
  .split__table-wrap {
    overflow: auto;
    border: 1px solid var(--cssd-border);
    border-radius: var(--cssd-radius);
    background: var(--cssd-bg-elevated);
  }
  .split table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .split th, .split td {
    text-align: left;
    padding: 0.55rem 0.65rem;
    border-bottom: 1px solid var(--cssd-border);
    vertical-align: top;
  }
  .split th {
    color: var(--cssd-text-faint);
    font-size: 0.72rem;
    text-transform: uppercase;
  }
  .split tbody tr { cursor: pointer; }
  .split tbody tr[data-selected="true"],
  .split tbody tr:hover {
    background: color-mix(in srgb, var(--cssd-accent-soft) 70%, transparent);
  }
  .split aside {
    background: var(--cssd-bg-elevated);
    border: 1px solid var(--cssd-border);
    border-radius: var(--cssd-radius);
    padding: 1rem;
  }
  .split aside dl { margin: 0; display: grid; gap: 0.55rem; }
  .split aside dt {
    color: var(--cssd-text-faint);
    font-size: 0.72rem;
    text-transform: uppercase;
  }
  .split aside dd { margin: 0.15rem 0 0; word-break: break-word; }
  .split__decisions { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.55rem; }
  .split__decisions p { margin: 0.2rem 0 0; color: var(--cssd-text-muted); font-size: 0.85rem; }
  .split__notes { margin: 0; padding-left: 1.1rem; color: var(--cssd-text-muted); font-size: 0.85rem; }
  .split__muted { margin: 0; color: var(--cssd-text-muted); font-size: 0.85rem; }
  @media (max-width: 960px) {
    .split__layout { grid-template-columns: 1fr; }
  }
`;
