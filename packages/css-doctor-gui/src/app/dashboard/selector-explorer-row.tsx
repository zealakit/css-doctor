import { useState, type ReactNode } from "react";

import {
  categoryLabel,
  statusLabel,
  type SelectorExplorerRow as SelectorExplorerRowModel,
} from "@shared/selector-explorer";

import { ClassFileList } from "./class-file-list";

type SelectorExplorerRowProps = {
  row: SelectorExplorerRowModel;
};

export function SelectorExplorerRow({ row }: SelectorExplorerRowProps) {
  const [expanded, setExpanded] = useState(false);
  const usageUnavailable = row.usages === null;
  const hasDetail =
    row.notes.length > 0 ||
    row.partialElements > 0 ||
    row.unresolvedElements > 0 ||
    row.hasUnprovenRuntimeState ||
    row.hasUnprovenPositional ||
    row.sources !== undefined ||
    row.legacyProjection ||
    row.definitions.some(
      (item) => item.line !== undefined || item.column !== undefined,
    );

  return (
    <>
      <tr className={expanded ? "is-expanded" : undefined}>
        <td>
          <div className="dashboard__selector-cell">
            {hasDetail ? (
              <button
                type="button"
                className="dashboard__expand"
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? `Hide details for ${row.selector}`
                    : `Show details for ${row.selector}`
                }
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "▾" : "▸"}
              </button>
            ) : (
              <span className="dashboard__expand-spacer" aria-hidden="true" />
            )}
            <code className="dashboard__class">{row.selector}</code>
          </div>
        </td>
        <td>
          <span className={`dashboard__kind dashboard__kind--${row.category}`}>
            {categoryLabel(row.category)}
          </span>
        </td>
        <td>
          <span
            className={`dashboard__status dashboard__status--${row.status}`}
            title={statusTitle(row)}
          >
            {statusLabel(row.status)}
          </span>
          {row.level ? (
            <span
              className={`dashboard__level dashboard__level--${row.level}`}
              title={`${row.level} confidence${
                row.sources?.length ? ` · ${row.sources.join(" + ")}` : ""
              }`}
            >
              {row.level}
            </span>
          ) : null}
        </td>
        <td className="numeric">
          {row.usageCount === null ? (
            <span className="dashboard__note">—</span>
          ) : (
            <span className="dashboard__metric">{row.usageCount}</span>
          )}
        </td>
        <td className="numeric">
          {row.fileCount === null ? (
            <span className="dashboard__note">—</span>
          ) : (
            <span className="dashboard__metric">{row.fileCount}</span>
          )}
        </td>
        <td>
          <ClassFileList
            files={row.definitions.map((item) => ({
              file: item.file,
              count: item.count,
            }))}
            showCounts
            emptyLabel="Unavailable"
          />
        </td>
        <td>
          <ClassFileList
            files={
              usageUnavailable
                ? []
                : (row.usages ?? []).map((item) => ({
                    file: item.file,
                    count: item.count,
                  }))
            }
            showCounts
            emptyLabel={usageUnavailable ? "Unavailable" : "None"}
          />
        </td>
      </tr>
      {expanded ? (
        <tr className="dashboard__detail-row">
          <td colSpan={7}>
            <SelectorDetailPanel row={row} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SelectorDetailPanel({ row }: { row: SelectorExplorerRowModel }) {
  return (
    <div className="dashboard__detail">
      <dl className="dashboard__detail-grid">
        <div>
          <dt>Selector</dt>
          <dd>
            <code>{row.selector}</code>
          </dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{categoryLabel(row.category)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{statusLabel(row.status)}</dd>
        </div>
        <div>
          <dt>Confirmed usages</dt>
          <dd>{row.usageCount === null ? "Unavailable" : row.usageCount}</dd>
        </div>
      </dl>

      {row.definitions.length > 0 ? (
        <DetailBlock title="Created In (definitions)">
          <ul>
            {row.definitions.map((item) => (
              <li key={`def:${item.file}:${item.line ?? 0}`}>
                <code>{item.file}</code>
                {typeof item.line === "number" ? (
                  <span className="dashboard__note">
                    {" "}
                    :{item.line}
                    {typeof item.column === "number" ? `:${item.column}` : ""}
                  </span>
                ) : null}
                <span className="dashboard__note"> ×{item.count}</span>
              </li>
            ))}
          </ul>
        </DetailBlock>
      ) : (
        <DetailBlock title="Created In (definitions)">
          <p className="dashboard__note">Unavailable</p>
        </DetailBlock>
      )}

      <DetailBlock title="Used In (confirmed matches)">
        {row.usages === null ? (
          <p className="dashboard__note">Unavailable</p>
        ) : row.usages.length === 0 ? (
          <p className="dashboard__note">None</p>
        ) : (
          <ul>
            {row.usages.map((item) => (
              <li key={`use:${item.file}`}>
                <code>{item.file}</code>
                <span className="dashboard__note"> ({item.count})</span>
              </li>
            ))}
          </ul>
        )}
      </DetailBlock>

      {(row.partialElements > 0 ||
        row.unresolvedElements > 0 ||
        row.hasUnprovenRuntimeState ||
        row.hasUnprovenPositional) && (
        <DetailBlock title="Matching evidence">
          <ul>
            {row.partialElements > 0 ? (
              <li>
                Partial element matches: {row.partialElements} (not counted as
                confirmed usage)
              </li>
            ) : null}
            {row.unresolvedElements > 0 ? (
              <li>Unresolved elements: {row.unresolvedElements}</li>
            ) : null}
            {row.hasUnprovenRuntimeState ? (
              <li>
                Includes unproven runtime state (e.g. :hover / :focus) — not
                observed at runtime
              </li>
            ) : null}
            {row.hasUnprovenPositional ? (
              <li>
                Includes unproven positional pseudo (e.g. :nth-child) — not
                fully verified statically
              </li>
            ) : null}
          </ul>
        </DetailBlock>
      )}

      {row.level ? (
        <DetailBlock title="Confidence">
          <ul>
            <li>
              Level: {row.level}
              {row.sources?.length
                ? ` (evidence: ${row.sources.join(", ")})`
                : ""}
            </li>
          </ul>
        </DetailBlock>
      ) : null}

      {row.notes.length > 0 ? (
        <DetailBlock title="Analysis notes">
          <ul>
            {row.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </DetailBlock>
      ) : null}
    </div>
  );
}

function DetailBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="dashboard__detail-block">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function statusTitle(row: SelectorExplorerRowModel): string {
  switch (row.status) {
    case "used":
      return "Confirmed structural match in scanned markup";
    case "unused":
      return "No matching evidence within supported analysis";
    case "partial":
      return "Partial matching evidence only — not confirmed usage";
    case "unknown":
      return "Insufficient evidence — unknown is not the same as unused";
    default:
      return "";
  }
}
