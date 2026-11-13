import { useMemo, useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SeverityBadge,
} from "@/components/ui";
import { useReport } from "@/hooks/use-report";
import type { GuiDiagnostic, GuiSeverity } from "@shared/report-model";

type SortKey = "severity" | "file" | "rule" | "location";

const SEVERITY_RANK: Record<GuiSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  unknown: 3,
};

export function DiagnosticsRoute() {
  const { state } = useReport();
  const [severity, setSeverity] = useState<"all" | GuiSeverity>("all");
  const [query, setQuery] = useState("");
  const [fileFilter, setFileFilter] = useState("all");
  const [ruleFilter, setRuleFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const diagnostics = state.status === "ready" ? state.report.diagnostics : [];

  const files = useMemo(
    () =>
      Array.from(
        new Set(
          diagnostics
            .map((item) => item.filePath)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort(),
    [diagnostics],
  );

  const rules = useMemo(
    () => Array.from(new Set(diagnostics.map((item) => item.code))).sort(),
    [diagnostics],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const next = diagnostics.filter((item) => {
      if (severity !== "all" && item.severity !== severity) {
        return false;
      }
      if (fileFilter !== "all" && item.filePath !== fileFilter) {
        return false;
      }
      if (ruleFilter !== "all" && item.code !== ruleFilter) {
        return false;
      }
      if (!needle) {
        return true;
      }
      const haystack = [
        item.message,
        item.code,
        item.filePath,
        item.selector,
        item.remediation,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });

    return next.sort((left, right) => compareDiagnostics(left, right, sortKey));
  }, [diagnostics, severity, fileFilter, ruleFilter, query, sortKey]);

  const selected =
    filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  return (
    <section>
      <PageHeader
        title="Diagnostics"
        description="Findings from the loaded CSS Doctor report."
      />

      {state.status === "loading" ? (
        <LoadingState label="Loading diagnostics…" />
      ) : null}
      {state.status === "error" ? <ErrorState message={state.message} /> : null}
      {state.status === "empty" ? (
        <EmptyState
          title="No report loaded"
          description="Load or generate a report from Overview first."
        />
      ) : null}

      {state.status === "ready" ? (
        <div className="diagnostics">
          <div className="diagnostics__toolbar">
            <label>
              Severity
              <select
                value={severity}
                onChange={(event) =>
                  setSeverity(event.target.value as "all" | GuiSeverity)
                }
              >
                <option value="all">All</option>
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label>
              File
              <select
                value={fileFilter}
                onChange={(event) => setFileFilter(event.target.value)}
              >
                <option value="all">All files</option>
                {files.map((file) => (
                  <option key={file} value={file}>
                    {file}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rule
              <select
                value={ruleFilter}
                onChange={(event) => setRuleFilter(event.target.value)}
              >
                <option value="all">All rules</option>
                {rules.map((rule) => (
                  <option key={rule} value={rule}>
                    {rule}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
              >
                <option value="severity">Severity</option>
                <option value="file">File</option>
                <option value="rule">Rule</option>
                <option value="location">Location</option>
              </select>
            </label>
            <label className="diagnostics__search">
              Search
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="message, selector, file…"
              />
            </label>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No matching diagnostics"
              description="Try clearing filters or search."
            />
          ) : (
            <div className="diagnostics__layout">
              <div className="diagnostics__table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Rule</th>
                      <th>Message</th>
                      <th>File</th>
                      <th>Loc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr
                        key={item.id}
                        data-selected={
                          selected?.id === item.id ? "true" : "false"
                        }
                        onClick={() => setSelectedId(item.id)}
                      >
                        <td>
                          <SeverityBadge severity={item.severity} />
                        </td>
                        <td>
                          <code>{item.code}</code>
                        </td>
                        <td>{item.message}</td>
                        <td>{item.filePath ?? "—"}</td>
                        <td>
                          {item.line !== undefined
                            ? `${item.line}:${item.column ?? 0}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <aside className="diagnostics__detail">
                {selected ? (
                  <>
                    <h2>Detail</h2>
                    <SeverityBadge severity={selected.severity} />
                    <dl>
                      <div>
                        <dt>Rule</dt>
                        <dd>
                          <code>{selected.code}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Message</dt>
                        <dd>{selected.message}</dd>
                      </div>
                      <div>
                        <dt>File</dt>
                        <dd>{selected.filePath ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Location</dt>
                        <dd>
                          {selected.line !== undefined
                            ? `line ${selected.line}, column ${selected.column ?? 0}`
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Selector</dt>
                        <dd>{selected.selector ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Suggested action</dt>
                        <dd>{selected.remediation ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Source</dt>
                        <dd>{selected.source}</dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <p>Select a diagnostic to inspect.</p>
                )}
              </aside>
            </div>
          )}
        </div>
      ) : null}

      <style>{`
        .diagnostics {
          display: grid;
          gap: 1rem;
        }
        .diagnostics__toolbar {
          display: grid;
          gap: 0.75rem;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        }
        .diagnostics__toolbar label {
          display: grid;
          gap: 0.3rem;
          font-size: 0.75rem;
          color: var(--cssd-text-faint);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .diagnostics__toolbar select,
        .diagnostics__toolbar input {
          border: 1px solid var(--cssd-border-strong);
          border-radius: 8px;
          background: var(--cssd-bg-elevated);
          color: var(--cssd-text);
          padding: 0.45rem 0.55rem;
          font: inherit;
          text-transform: none;
          letter-spacing: normal;
        }
        .diagnostics__search {
          grid-column: 1 / -1;
        }
        .diagnostics__layout {
          display: grid;
          gap: 1rem;
          grid-template-columns: minmax(0, 1.6fr) minmax(240px, 1fr);
        }
        .diagnostics__table-wrap {
          overflow: auto;
          border: 1px solid var(--cssd-border);
          border-radius: var(--cssd-radius);
          background: var(--cssd-bg-elevated);
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
        }
        th,
        td {
          text-align: left;
          padding: 0.65rem 0.75rem;
          border-bottom: 1px solid var(--cssd-border);
          vertical-align: top;
        }
        th {
          color: var(--cssd-text-faint);
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        tbody tr {
          cursor: pointer;
        }
        tbody tr[data-selected="true"],
        tbody tr:hover {
          background: color-mix(in srgb, var(--cssd-accent-soft) 70%, transparent);
        }
        .diagnostics__detail {
          border: 1px solid var(--cssd-border);
          border-radius: var(--cssd-radius);
          background: var(--cssd-bg-elevated);
          padding: 1rem;
          display: grid;
          gap: 0.75rem;
          align-content: start;
        }
        .diagnostics__detail h2 {
          margin: 0;
          font-size: 0.95rem;
        }
        .diagnostics__detail dl {
          margin: 0;
          display: grid;
          gap: 0.7rem;
        }
        .diagnostics__detail dt {
          color: var(--cssd-text-faint);
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .diagnostics__detail dd {
          margin: 0.2rem 0 0;
          word-break: break-word;
        }
        @media (max-width: 960px) {
          .diagnostics__layout {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}

function compareDiagnostics(
  left: GuiDiagnostic,
  right: GuiDiagnostic,
  sortKey: SortKey,
): number {
  if (sortKey === "severity") {
    return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  }
  if (sortKey === "file") {
    return (left.filePath ?? "").localeCompare(right.filePath ?? "");
  }
  if (sortKey === "rule") {
    return left.code.localeCompare(right.code);
  }
  const leftLine = left.line ?? Number.MAX_SAFE_INTEGER;
  const rightLine = right.line ?? Number.MAX_SAFE_INTEGER;
  if (leftLine !== rightLine) {
    return leftLine - rightLine;
  }
  return (left.column ?? 0) - (right.column ?? 0);
}
