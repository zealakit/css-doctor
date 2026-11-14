import type {
  SelectorExplorerRow as SelectorExplorerRowModel,
  SelectorExplorerSortDir,
  SelectorExplorerSortKey,
} from "@shared/selector-explorer";

import { SelectorExplorerRow } from "./selector-explorer-row";

type SelectorExplorerTableProps = {
  rows: SelectorExplorerRowModel[];
  emptyMessage: string;
  sortKey: SelectorExplorerSortKey;
  sortDir: SelectorExplorerSortDir;
  onSort: (key: SelectorExplorerSortKey) => void;
};

export function SelectorExplorerTable({
  rows,
  emptyMessage,
  sortKey,
  sortDir,
  onSort,
}: SelectorExplorerTableProps) {
  if (rows.length === 0) {
    return (
      <div className="dashboard__table-wrap dashboard__table-wrap--empty">
        <p className="dashboard__note">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="dashboard__table-wrap">
      <table className="dashboard__table">
        <thead>
          <tr>
            <SortableHeader
              label="Selector"
              columnKey="selector"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label="Type"
              columnKey="type"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label="Status"
              columnKey="status"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label="Usages"
              columnKey="usages"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              numeric
            />
            <th scope="col" className="numeric">
              Files
            </th>
            <th scope="col">Created In</th>
            <th scope="col">Used In</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <SelectorExplorerRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader(props: {
  label: string;
  columnKey: SelectorExplorerSortKey;
  sortKey: SelectorExplorerSortKey;
  sortDir: SelectorExplorerSortDir;
  onSort: (key: SelectorExplorerSortKey) => void;
  numeric?: boolean;
}) {
  const active = props.sortKey === props.columnKey;
  const indicator = active ? (props.sortDir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th
      scope="col"
      className={props.numeric ? "numeric" : undefined}
      aria-sort={
        active ? (props.sortDir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        className={
          active ? "dashboard__sort-btn is-active" : "dashboard__sort-btn"
        }
        onClick={() => props.onSort(props.columnKey)}
      >
        {props.label}
        {indicator}
      </button>
    </th>
  );
}
