import { useMemo, useState } from "react";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoticeBanner,
} from "@/components/ui";
import { useReport } from "@/hooks/use-report";
import { useSettings } from "@/hooks/use-settings";
import {
  buildSelectorExplorerView,
  filterSelectorExplorerRows,
  type SelectorExplorerSortDir,
  type SelectorExplorerSortKey,
} from "@shared/selector-explorer";

import { ClassSearch } from "./class-search";
import { DashboardHeader } from "./dashboard-header";
import { OverviewStats } from "./overview-stats";
import { SelectorExplorerTable } from "./selector-explorer-table";
import {
  SelectorKindFilter,
  type SelectorKindFilterValue,
} from "./selector-kind-filter";
import {
  SelectorStatusFilter,
  type SelectorStatusFilterValue,
} from "./selector-status-filter";
import "./dashboard.css";

export function DashboardPage() {
  const { state, source, notice, clearNotice, busy, refresh } = useReport();
  const { settings, updateSettings } = useSettings();
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<SelectorKindFilterValue>("all");
  const [statusFilter, setStatusFilter] =
    useState<SelectorStatusFilterValue>("all");
  const [sortKey, setSortKey] = useState<SelectorExplorerSortKey>("usages");
  const [sortDir, setSortDir] = useState<SelectorExplorerSortDir>("desc");

  const resolvedTheme = settings.theme === "light" ? "light" : "dark";

  const explorerView = useMemo(() => {
    if (state.status !== "ready") {
      return null;
    }
    return buildSelectorExplorerView(state.report);
  }, [state]);

  const filteredRows = useMemo(() => {
    if (!explorerView) {
      return [];
    }
    return filterSelectorExplorerRows(explorerView.rows, {
      query,
      category: kindFilter,
      status: statusFilter,
      sortKey,
      sortDir,
    });
  }, [explorerView, query, kindFilter, statusFilter, sortKey, sortDir]);

  const runFailed =
    state.status === "ready" && state.report.metadata.success === false;
  const failureMessage =
    state.status === "ready" && state.report.metadata.errors.length > 0
      ? state.report.metadata.errors.join(" ")
      : "CSS analysis failed for this run.";
  const hasSelectorData = explorerView?.overview.available === true;

  const reportLabel =
    state.status === "ready"
      ? settings.showFullPaths
        ? (source?.path ?? source?.label ?? state.report.source.command)
        : (source?.label ?? state.report.source.command)
      : state.status === "empty"
        ? "No report"
        : state.status === "loading"
          ? "Loading…"
          : "Error";

  const clearFilters = () => {
    setQuery("");
    setKindFilter("all");
    setStatusFilter("all");
    setSortKey("usages");
    setSortDir("desc");
  };

  const handleSort = (key: SelectorExplorerSortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "usages" ? "desc" : "asc");
  };

  const filtersActive =
    query.trim().length > 0 ||
    kindFilter !== "all" ||
    statusFilter !== "all" ||
    sortKey !== "usages" ||
    sortDir !== "desc";

  return (
    <div className="dashboard">
      <DashboardHeader
        reportLabel={reportLabel}
        busy={busy}
        onRefresh={() => {
          void refresh();
        }}
        theme={resolvedTheme}
        onToggleTheme={() =>
          updateSettings({
            theme: resolvedTheme === "dark" ? "light" : "dark",
          })
        }
      />

      {notice ? (
        <NoticeBanner message={notice} onDismiss={clearNotice} />
      ) : null}

      {state.status === "loading" ? (
        <LoadingState label="Loading analysis report…" />
      ) : null}
      {state.status === "error" ? <ErrorState message={state.message} /> : null}
      {state.status === "empty" ? (
        <EmptyState
          title="No report available"
          description="Launch with `css-doctor gui` so the CLI can run check once and load this run's report. Browser refresh does not re-analyze CSS."
        />
      ) : null}

      {state.status === "ready" && runFailed && !hasSelectorData ? (
        <ErrorState message={failureMessage} />
      ) : null}

      {state.status === "ready" &&
      explorerView &&
      (hasSelectorData || !runFailed) ? (
        <>
          {runFailed ? <NoticeBanner message={failureMessage} /> : null}
          <OverviewStats overview={explorerView.overview} />
          <section
            className="dashboard__usage"
            aria-label="CSS selector explorer"
          >
            <div className="dashboard__section-heading">
              <h2 className="dashboard__section-title">Selector Explorer</h2>
              {filtersActive ? (
                <button
                  type="button"
                  className="dashboard__clear-filters"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              ) : null}
            </div>
            <div className="dashboard__table-panel">
              <div className="dashboard__table-toolbar">
                <ClassSearch value={query} onChange={setQuery} />
                <SelectorKindFilter
                  value={kindFilter}
                  onChange={setKindFilter}
                />
                <SelectorStatusFilter
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
              </div>
              <SelectorExplorerTable
                rows={filteredRows}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                emptyMessage={
                  explorerView.rows.length === 0
                    ? "No selector data in this report."
                    : "No selectors match your filters."
                }
              />
            </div>
          </section>
        </>
      ) : null}

      <style>{`
        .visually-hidden {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
      `}</style>
    </div>
  );
}
